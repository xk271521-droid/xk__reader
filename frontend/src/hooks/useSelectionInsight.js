import { useEffect, useRef, useState } from 'react'
import { fetchSelectionInsight } from '../services/paperReaderApi'

function createInitialSelectionState() {
  return {
    text: '',
    translation: '',
    explanation: '',
    keywords: [],
    glossary: [],
    focusPoints: [],
    loading: false,
    error: '',
    visible: false,
    source: '',
    textKind: '',
    charCount: 0,
    wordCount: 0,
    requestedAt: 0,
    domain: 'it',
  }
}

function normalizeSelectedText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function getWordCount(text) {
  return text.split(/\s+/).filter(Boolean).length
}

function inferTextKind(text) {
  const words = getWordCount(text)
  if (words <= 1) return 'word'
  if (words >= 40) return 'passage'
  const looksLikeTitle =
    words >= 6 &&
    !/[.!?;:]\s*$/.test(text) &&
    text.slice(0, 1) === text.slice(0, 1).toUpperCase()
  if (looksLikeTitle) return 'title'
  if (words >= 10 || /[.!?;:]\s*$/.test(text)) return 'sentence'
  if (words <= 5) return 'phrase'
  return 'sentence'
}

function extractSurroundingContext(range, spanCount = 3) {
  try {
    const startEl = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer
    const endEl = range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : range.endContainer

    const textLayer = startEl?.closest('.textLayer')
    if (!textLayer) return ''

    const spans = Array.from(textLayer.querySelectorAll('span'))
    const startSpan = startEl.closest('span')
    const endSpan = endEl.closest('span')
    const startIdx = spans.indexOf(startSpan)
    const endIdx = spans.indexOf(endSpan)
    if (startIdx === -1 || endIdx === -1) return ''

    const ctxStart = Math.max(0, startIdx - spanCount)
    const ctxEnd = Math.min(spans.length - 1, endIdx + spanCount)
    const ctxSpans = []
    for (let i = ctxStart; i <= ctxEnd; i++) {
      ctxSpans.push(spans[i].textContent)
    }
    return ctxSpans.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

export function useSelectionInsight({ readerRef, paperTitle, paperSummary, currentProviderId }) {
  const activeRequestRef = useRef(0)
  const selectionTimerRef = useRef(null)
  const [selectionCard, setSelectionCard] = useState(createInitialSelectionState)

  const summaryRef = useRef(paperSummary)
  summaryRef.current = paperSummary
  const providerRef = useRef(currentProviderId)
  providerRef.current = currentProviderId

  function dismissSelectionCard() {
    activeRequestRef.current += 1
    window.clearTimeout(selectionTimerRef.current)
    setSelectionCard(createInitialSelectionState())
  }

  useEffect(
    () => () => {
      window.clearTimeout(selectionTimerRef.current)
    },
    [],
  )

  function handleSelection() {
    window.clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = window.setTimeout(loadSelectionInsight, 120)
  }

  async function loadSelectionInsight(domainOverride) {
    let selectedText
    let domain
    let surroundingContext = ''

    if (domainOverride !== undefined) {
      selectedText = selectionCard.text
      domain = domainOverride
    } else {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return
      }

      selectedText = normalizeSelectedText(selection.toString())
      if (selectedText.length < 2) {
        return
      }

      const readerElement = readerRef.current
      const range = selection.getRangeAt(0)
      if (!readerElement?.contains(range.commonAncestorContainer)) {
        return
      }

      domain = selectionCard.domain
      surroundingContext = extractSurroundingContext(range)
    }

    const requestId = activeRequestRef.current + 1
    const wordCount = getWordCount(selectedText)
    activeRequestRef.current = requestId

    setSelectionCard({
      ...createInitialSelectionState(),
      text: selectedText,
      loading: true,
      visible: true,
      source: '正在生成即时理解',
      textKind: inferTextKind(selectedText),
      charCount: selectedText.length,
      wordCount,
      requestedAt: Date.now(),
      domain,
    })

    try {
      const summary = summaryRef.current || undefined
      const providerId = providerRef.current || undefined

      const data = await fetchSelectionInsight({
        text: selectedText,
        paper_title: paperTitle,
        domain,
        ...(summary ? { summary } : {}),
        ...(surroundingContext ? { context: surroundingContext } : {}),
        ...(providerId ? { provider_id: providerId } : {}),
      })

      if (activeRequestRef.current !== requestId) {
        return
      }

      setSelectionCard((current) => ({
        ...current,
        translation: data.translation,
        explanation: data.explanation,
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        glossary: Array.isArray(data.glossary) ? data.glossary : [],
        focusPoints: Array.isArray(data.focus_points) ? data.focus_points : [],
        loading: false,
        source: data.source || '',
        textKind: data.text_kind || current.textKind,
      }))
    } catch {
      if (activeRequestRef.current !== requestId) {
        return
      }

      setSelectionCard((current) => ({
        ...current,
        loading: false,
        error: '暂时没有拿到即时理解结果，请检查后端是否正常运行。',
      }))
    }
  }

  function setDomain(domain) {
    setSelectionCard((current) => ({ ...current, domain }))
    loadSelectionInsight(domain)
  }

  return {
    selectionCard,
    handleSelection,
    dismissSelectionCard,
    setDomain,
  }
}
