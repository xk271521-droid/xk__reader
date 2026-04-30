import { useEffect, useRef, useState } from 'react'
import { fetchSelectionInsight } from '../services/paperReaderApi'

const initialSelectionState = {
  text: '',
  translation: '',
  explanation: '',
  keywords: [],
  loading: false,
  error: '',
  visible: false,
  source: '',
}

export function useSelectionInsight({ readerRef, paperTitle }) {
  const activeRequestRef = useRef(0)
  const selectionTimerRef = useRef(null)
  const [selectionCard, setSelectionCard] = useState(initialSelectionState)

  function dismissSelectionCard() {
    activeRequestRef.current += 1
    setSelectionCard(initialSelectionState)
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
    selectionTimerRef.current = window.setTimeout(loadSelectionInsight, 80)
  }

  async function loadSelectionInsight() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return
    }

    const selectedText = selection.toString().replace(/\s+/g, ' ').trim()
    if (selectedText.length < 3) {
      return
    }

    const readerElement = readerRef.current
    const range = selection.getRangeAt(0)
    if (!readerElement?.contains(range.commonAncestorContainer)) {
      return
    }

    const requestId = activeRequestRef.current + 1
    activeRequestRef.current = requestId

    setSelectionCard({
      text: selectedText,
      translation: '',
      explanation: '',
      keywords: [],
      loading: true,
      error: '',
      visible: true,
      source: '',
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
        keywords: data.keywords,
        loading: false,
        source: data.source,
      }))
    } catch {
      if (activeRequestRef.current !== requestId) {
        return
      }

      setSelectionCard((current) => ({
        ...current,
        loading: false,
        error: '暂时没有拿到解释结果，请检查后端是否正在运行。',
      }))
    }
  }

  return {
    selectionCard,
    handleSelection,
    dismissSelectionCard,
  }
}
