import { useEffect, useRef, useState } from 'react'
import { fetchSelectionInsight } from '../services/paperReaderApi'
import {
  buildSelectionRequestKey,
  normalizeTranslationProvider,
  TRANSLATION_PROVIDERS,
} from './selectionInsightModel'

const TRANSLATION_PROVIDER_STORAGE_KEY = 'xk-reader.selection-translation-provider'
const FOLLOW_TRANSLATION_STORAGE_KEY = 'xk-reader.selection-follow-translation.v1'

function getStoredTranslationProvider() {
  if (typeof window === 'undefined') return TRANSLATION_PROVIDERS.BAIDU
  try {
    return normalizeTranslationProvider(window.localStorage.getItem(TRANSLATION_PROVIDER_STORAGE_KEY))
  } catch {
    return TRANSLATION_PROVIDERS.BAIDU
  }
}

function storeTranslationProvider(provider) {
  try {
    window.localStorage.setItem(TRANSLATION_PROVIDER_STORAGE_KEY, provider)
  } catch {
    // Private browsing can deny storage; keep the selected value for this session.
  }
}

function getStoredFollowTranslationEnabled() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(FOLLOW_TRANSLATION_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function storeFollowTranslationEnabled(enabled) {
  try {
    window.localStorage.setItem(FOLLOW_TRANSLATION_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Private browsing can deny storage; retain the choice for the current session.
  }
}

function createInitialSelectionState() {
  return {
    text: '',
    translation: '',
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
    domain: '',
    pageNumber: 0,
    startChar: 0,
    endChar: 0,
    rects: [],
    anchorRect: null,
    anchorElement: null,
    anchorClientRect: null,
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

export function useSelectionInsight({ paperTitle }) {
  const activeRequestRef = useRef(0)
  const selectionTimerRef = useRef(null)
  const lastSelectionKeyRef = useRef('')
  const latestSelectionRef = useRef(null)
  const [selectionCard, setSelectionCard] = useState(createInitialSelectionState)
  const [translationProvider, setTranslationProvider] = useState(getStoredTranslationProvider)
  const [followTranslationEnabled, setFollowTranslationEnabled] = useState(getStoredFollowTranslationEnabled)
  const [followPanelDismissed, setFollowPanelDismissed] = useState(false)
  useEffect(() => () => {
    clearTimeout(selectionTimerRef.current)
  }, [])

  function dismissSelectionCard() {
    activeRequestRef.current += 1
    lastSelectionKeyRef.current = ''
    latestSelectionRef.current = null
    setFollowPanelDismissed(false)
    clearTimeout(selectionTimerRef.current)
    setSelectionCard(createInitialSelectionState())
  }

  function handleSelection(selectionPayload) {
    const selectionKey = buildSelectionRequestKey(selectionPayload)
    if (!selectionKey) return
    if (selectionKey === lastSelectionKeyRef.current) {
      setFollowPanelDismissed(false)
      return
    }
    lastSelectionKeyRef.current = selectionKey
    latestSelectionRef.current = selectionPayload
    setFollowPanelDismissed(false)
    clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = setTimeout(() => {
      loadSelectionInsight(selectionPayload)
    }, 60)
  }

  async function loadSelectionInsight(explicitSelection, selectedProvider = translationProvider) {
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
      anchorElement: selectionMeta.anchorElement || null,
      anchorClientRect: selectionMeta.anchorClientRect || null,
      contextBefore: selectionMeta.contextBefore || '',
      contextAfter: selectionMeta.contextAfter || '',
    })

    try {
      const data = await fetchSelectionInsight({
        text: selectedText,
        paper_title: paperTitle,
        domain,
        translation_provider: selectedProvider,
        context: context || undefined,
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
    } catch (error) {
      if (activeRequestRef.current !== requestId) {
        return
      }
      if (error?.message) {
        setSelectionCard((current) => ({ ...current, loading: false, error: error.message }))
        return
      }
      setSelectionCard((current) => ({
        ...current,
        loading: false,
        error: '网络好像开小差了，刷新后再试一次。',
      }))
    }
  }

  function changeTranslationProvider(nextProvider) {
    const normalizedProvider = normalizeTranslationProvider(nextProvider)
    if (normalizedProvider === translationProvider) return

    setTranslationProvider(normalizedProvider)
    storeTranslationProvider(normalizedProvider)

    if (latestSelectionRef.current?.text) {
      clearTimeout(selectionTimerRef.current)
      loadSelectionInsight(latestSelectionRef.current, normalizedProvider)
    }
  }

  function changeFollowTranslationEnabled(nextEnabled) {
    const enabled = Boolean(nextEnabled)
    setFollowTranslationEnabled(enabled)
    storeFollowTranslationEnabled(enabled)
    if (enabled && latestSelectionRef.current?.text) {
      setFollowPanelDismissed(false)
    }
  }

  function dismissFollowPanel() {
    setFollowPanelDismissed(true)
  }

  return {
    selectionCard,
    translationProvider,
    changeTranslationProvider,
    followTranslationEnabled,
    changeFollowTranslationEnabled,
    followPanelVisible: followTranslationEnabled && selectionCard.visible && !followPanelDismissed,
    dismissFollowPanel,
    handleSelection,
    dismissSelectionCard,
  }
}
