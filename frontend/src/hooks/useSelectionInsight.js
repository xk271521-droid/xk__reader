import { useEffect, useRef, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'
import { fetchAiProviders, fetchSelectionInsight, fetchSelectionInsightExplain } from '../services/paperReaderApi'

function createInitialSelectionState() {
  return {
    text: '',
    translation: '',
    explanation: '',
    keywords: [],
    glossary: [],
    focusPoints: [],
    loading: false,
    explaining: false,
    error: '',
    visible: false,
    source: '',
    textKind: '',
    charCount: 0,
    wordCount: 0,
    requestedAt: 0,
    domain: '',
    pageNumber: 0,
    startChar: 0,
    endChar: 0,
    rects: [],
    anchorRect: null,
    contextBefore: '',
    contextAfter: '',
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
  if (words >= 6 && !/[.!?;:]\s*$/.test(text) && text[0] === text[0].toUpperCase()) return 'title'
  if (words >= 10 || /[.!?;:]\s*$/.test(text)) return 'sentence'
  if (words <= 5) return 'phrase'
  return 'sentence'
}

const NL = String.fromCharCode(10)

export function useSelectionInsight({ paperTitle, paperSummary }) {
  const activeRequestRef = useRef(0)
  const selectionTimerRef = useRef(null)
  const [selectionCard, setSelectionCard] = useState(createInitialSelectionState)
  const [aiEnabled, setAiEnabled] = useState(true)
  const summaryRef = useRef(paperSummary)
  const providerRef = useRef(null)
  const explRef = useRef('')

  useEffect(() => {
    summaryRef.current = paperSummary
  }, [paperSummary])

  useEffect(() => {
    let cancelled = false
    fetchAiProviders()
      .then((data) => {
        if (cancelled) return
        const activeProvider = (data?.providers || []).find((provider) => provider.is_active)
        if (activeProvider) {
          providerRef.current = activeProvider.id
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => () => {
    clearTimeout(selectionTimerRef.current)
  }, [])

  function dismissSelectionCard() {
    activeRequestRef.current += 1
    clearTimeout(selectionTimerRef.current)
    setSelectionCard(createInitialSelectionState())
  }

  function handleSelection(selectionPayload) {
    clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = setTimeout(() => {
      loadSelectionInsight(selectionPayload)
    }, 60)
  }

  async function loadSelectionInsight(explicitSelection) {
    let selectedText = ''
    let domain = selectionCard.domain
    let context = ''
    let selectionMeta = null

    if (explicitSelection && explicitSelection.text) {
      selectedText = normalizeSelectedText(explicitSelection.text)
      selectionMeta = explicitSelection
      context = [
        explicitSelection.contextBefore || '',
        selectedText,
        explicitSelection.contextAfter || '',
      ].filter(Boolean).join(' ').trim()
    }

    if (selectedText.length < 2 || !selectionMeta) {
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
      domain,
      pageNumber: selectionMeta.pageNumber || 0,
      startChar: selectionMeta.startChar || 0,
      endChar: selectionMeta.endChar || 0,
      rects: selectionMeta.rects || [],
      anchorRect: selectionMeta.anchorRect || null,
      contextBefore: selectionMeta.contextBefore || '',
      contextAfter: selectionMeta.contextAfter || '',
    })

    try {
      const summary = summaryRef.current || undefined
      const providerId = providerRef.current || undefined
      const data = await fetchSelectionInsight({
        text: selectedText,
        paper_title: paperTitle,
        domain,
        summary,
        context: context || undefined,
        provider_id: providerId || undefined,
      })

      if (activeRequestRef.current !== requestId) {
        return
      }

      setSelectionCard((current) => ({
        ...current,
        translation: data.translation,
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        glossary: Array.isArray(data.glossary) ? data.glossary : [],
        focusPoints: Array.isArray(data.focus_points) ? data.focus_points : [],
        loading: false,
        source: data.source || '',
        textKind: data.text_kind || current.textKind,
      }))

      if (aiEnabled && providerId && wordCount >= 5) {
        setSelectionCard((current) => ({ ...current, explaining: true, explanation: '' }))
        explRef.current = ''
        try {
          const token = getStoredAuthToken()
          const response = await fetch('/api/selection-insight/explain-stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              text: selectedText,
              paper_title: paperTitle,
              summary,
              context: context || undefined,
              provider_id: providerId,
            }),
          })

          if (response.ok) {
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              buffer += decoder.decode(chunk.value, { stream: true })
              const parts = buffer.split(NL)
              buffer = parts.pop()
              for (const line of parts) {
                if (!line.startsWith('data: ')) continue
                const token = line.slice(6)
                if (activeRequestRef.current !== requestId) return
                explRef.current += token
                setSelectionCard((current) => ({ ...current, explanation: explRef.current }))
                await new Promise((resolve) => setTimeout(resolve, 0))
              }
            }
          }
        } catch {
          void 0
        }

        if (activeRequestRef.current !== requestId) {
          return
        }

        if (!explRef.current) {
          try {
            const fallback = await fetchSelectionInsightExplain({
              text: selectedText,
              paper_title: paperTitle,
              summary,
              context: context || undefined,
              provider_id: providerId,
            })
            if (activeRequestRef.current === requestId && fallback?.explanation) {
              setSelectionCard((current) => ({ ...current, explanation: fallback.explanation }))
            }
          } catch {
            void 0
          }
        }

        if (activeRequestRef.current === requestId) {
          setSelectionCard((current) => ({ ...current, explaining: false }))
        }
      }
    } catch {
      if (activeRequestRef.current !== requestId) {
        return
      }
      setSelectionCard((current) => ({
        ...current,
        loading: false,
        explaining: false,
        error: '网络好像开小差了，刷新后再试一次。',
      }))
    }
  }

  function toggleAI() {
    setAiEnabled((previous) => {
      if (previous) {
        activeRequestRef.current += 1
        setSelectionCard((current) => ({ ...current, explaining: false, explanation: '' }))
      }
      return !previous
    })
  }

  return {
    selectionCard,
    handleSelection,
    dismissSelectionCard,
    aiEnabled,
    toggleAI,
  }
}
