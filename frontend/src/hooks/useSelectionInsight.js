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

  if (words <= 1) {
    return 'word'
  }

  if (words >= 40) {
    return 'passage'
  }

  const looksLikeTitle =
    words >= 6 &&
    !/[.!?;:]\s*$/.test(text) &&
    text.slice(0, 1) === text.slice(0, 1).toUpperCase()

  if (looksLikeTitle) {
    return 'title'
  }

  if (words >= 10 || /[.!?;:]\s*$/.test(text)) {
    return 'sentence'
  }

  if (words <= 5) {
    return 'phrase'
  }

  return 'sentence'
}

export function useSelectionInsight({ readerRef, paperTitle }) {
  const activeRequestRef = useRef(0)
  const selectionTimerRef = useRef(null)
  const [selectionCard, setSelectionCard] = useState(createInitialSelectionState)

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

  useEffect(() => {
    function handlePointerDown(event) {
      if (!selectionCard.visible) {
        return
      }

      if (readerRef.current?.contains(event.target)) {
        return
      }

      dismissSelectionCard()
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [readerRef, selectionCard.visible])

  function handleSelection() {
    window.clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = window.setTimeout(loadSelectionInsight, 120)
  }

  async function loadSelectionInsight() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return
    }

    const selectedText = normalizeSelectedText(selection.toString())
    if (selectedText.length < 2) {
      return
    }

    const readerElement = readerRef.current
    const range = selection.getRangeAt(0)
    if (!readerElement?.contains(range.commonAncestorContainer)) {
      return
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
    })

    try {
      const data = await fetchSelectionInsight({
        text: selectedText,
        paper_title: paperTitle,
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

  return {
    selectionCard,
    handleSelection,
    dismissSelectionCard,
  }
}
