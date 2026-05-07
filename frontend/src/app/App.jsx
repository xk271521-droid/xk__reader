import { useEffect, useRef, useState } from 'react'
import { Brain, Copy, LogIn, LogOut, Settings2, UserRound } from 'lucide-react'
import { AiConfigPage } from '../components/account/AiConfigPage'
import { UserCenterPage } from '../components/account/UserCenterPage'
import { HomePage } from '../components/home/HomePage'
import { StatusPanel } from '../components/layout/StatusPanel'
import { UtilityRail } from '../components/layout/UtilityRail'
import { FullTranslationReader } from '../components/reader/FullTranslationReader'
import { PaperReader } from '../components/reader/PaperReader'
import { SelectionInsightPanel } from '../components/reader/SelectionInsightPanel'
import { SideWorkspacePanel } from '../components/reader/SideWorkspacePanel'
import Login from '../log/Login.jsx'
import { useBackendStatus } from '../hooks/useBackendStatus'
import { usePdfReader } from '../hooks/usePdfReader'
import { useAnnotations } from '../hooks/useAnnotations'
import { usePaperNotes } from '../hooks/usePaperNotes'
import { usePdfSearch } from '../hooks/usePdfSearch'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { useSelectionInsight } from '../hooks/useSelectionInsight'
import {
  createImageBlockDraft,
  createQuoteBlockDraft,
  ensureInsertTarget,
  insertBlockIntoNotebooks,
} from '../components/reader/noteTree'
import {
  clearStoredAuthToken,
  fetchCurrentUser,
  getStoredAuthToken,
  storeAuthToken,
  uploadAvatar,
  updateCurrentUser,
} from '../services/authApi'
import {
  fetchFullTranslation,
  getPaperFileUrl,
  retryFullTranslation,
  startFullTranslation,
  streamFullTranslation,
} from '../services/paperReaderApi'
import {
  buildFullTranslationPages,
  hashTranslationPages,
} from '../components/reader/fullTranslationLayout'
import 'pdfjs-dist/web/pdf_viewer.css'
import '../styles/app.css'

function sanitizeDownloadName(value, fallback = 'paper') {
  const text = String(value || fallback)
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

function splitAuthors(authorText) {
  return String(authorText || '')
    .split(/;|；|, and | and /i)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getCitationYear(metadata) {
  const values = [
    metadata?.year,
    metadata?.published,
    metadata?.publicationDate,
    metadata?.creationDate,
    metadata?.modificationDate,
  ]
  for (const value of values) {
    const year = String(value || '').match(/\b(19|20)\d{2}\b/)?.[0]
    if (year) return year
  }
  return ''
}

function normalizeCitationSource(metadata) {
  return {
    title: String(metadata?.title || '').trim() || '未命名论文',
    authors: splitAuthors(metadata?.author),
    journal: String(metadata?.subject || metadata?.journal || '').trim(),
    year: getCitationYear(metadata),
    doi: String(metadata?.doi || '').trim(),
  }
}

function joinChineseAuthors(authors) {
  if (!authors.length) return '佚名'
  return authors.join(', ')
}

function joinMlaAuthors(authors) {
  if (!authors.length) return 'Unknown Author'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]}, and ${authors[1]}`
  return `${authors[0]}, et al.`
}

function buildCitationText(format, metadata, fileName) {
  const source = normalizeCitationSource({
    ...metadata,
    title: metadata?.title || sanitizeDownloadName(fileName),
  })
  const title = source.title
  const journal = source.journal || '期刊信息缺失'
  const year = source.year || '出版年不详'
  const doiPart = source.doi ? ` DOI: ${source.doi}.` : ''

  if (format === 'mla') {
    const mlaYear = source.year || 'n.d.'
    const mlaJournal = source.journal ? ` ${source.journal},` : ''
    const mlaDoi = source.doi ? ` doi:${source.doi}.` : ''
    return `${joinMlaAuthors(source.authors)}. "${title}."${mlaJournal} ${mlaYear}.${mlaDoi}`.replace(/\s+/g, ' ').trim()
  }

  if (format === 'cajcd') {
    return `${joinChineseAuthors(source.authors)}. ${title}[J/OL]. ${journal}, ${year}.${doiPart}`.trim()
  }

  return `${joinChineseAuthors(source.authors)}. ${title}[J]. ${journal}, ${year}.${doiPart}`.trim()
}

function triggerTextDownload(content, fileName) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function normalizeFullTranslationStatus(value) {
  return ['idle', 'running', 'completed', 'error'].includes(value) ? value : 'idle'
}

function getFullTranslationProgress(payload) {
  const total = Number(payload?.total_units) || 0
  const completed = Number(payload?.completed_units) || 0
  if (payload?.status === 'completed') return 100
  if (total <= 0) return payload?.status === 'running' ? 3 : 0
  return Math.max(3, Math.min(99, (completed / total) * 100))
}

function App() {
  const readerRef = useRef(null)
  const userMenuRef = useRef(null)
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState('')
  const [activeTool, setActiveTool] = useState('select')
  const [isThumbnailsOpen, setIsThumbnailsOpen] = useState(false)
  const [isUtilityRailCollapsed, setIsUtilityRailCollapsed] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [isAuthViewOpen, setIsAuthViewOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [accountSection, setAccountSection] = useState('')
  const [chatMessages, setChatMessages] = useState({})
  const [chatInput, setChatInput] = useState({})
  const [chatAsking, setChatAsking] = useState({})
  const [chatInitialSuggestions, setChatInitialSuggestions] = useState({})
  const [chatInitialSuggestionsLoading, setChatInitialSuggestionsLoading] = useState({})
  const [chatFollowupLoadingMessageId, setChatFollowupLoadingMessageId] = useState({})
  const [providerLabel, setProviderLabel] = useState('')
  const [activeProviderId, setActiveProviderId] = useState(null)
  const [fullTranslation, setFullTranslation] = useState(null)
  const [fullTranslationStatus, setFullTranslationStatus] = useState('idle')
  const [fullTranslationProgress, setFullTranslationProgress] = useState(0)
  const [fullTranslationBusy, setFullTranslationBusy] = useState(false)
  const [isFullTranslationOpen, setIsFullTranslationOpen] = useState(false)
  const chatMessageCounterRef = useRef(0)
  const chatRequestCounterRef = useRef(0)
  const initialSuggestionRequestRef = useRef({})
  const initialSuggestionBatchRef = useRef({})
  const followupSuggestionRequestRef = useRef({})
  const fullTranslationPollRef = useRef(null)
  const serverStatus = useBackendStatus()

  // Get active AI provider name
  useEffect(function () {
    fetch('/api/providers', { headers: getStoredAuthToken() ? { Authorization: 'Bearer ' + getStoredAuthToken() } : {} })
      .then(function (r) { return r.json() })
      .then(function (d) {
        var a = (d && d.providers || []).find(function (p) { return p.is_active })
        if (a) {
          setProviderLabel(a.label + ' / ' + a.model)
          setActiveProviderId(a.id)
        } else {
          setProviderLabel('')
          setActiveProviderId(null)
        }
      })
      .catch(function () {})
  }, [currentUser])

  const {
    activeView,
    assignPaperToFolder,
    cancelImportConflict,
    closePaper,
    createFolder,
    deletePaper,
    deleteFolder,
    error,
    fileInputRef,
    fileName,
    fitToWidth,
    folders,
    goHome,
    handleFileChange,
    importConflict,
    isImporting,
    isLoading,
    metadata,
    openFilePicker,
    openTabs,
    pageMetrics,
    pageNumber,
    pageNumbers,
    pdfDocument,
    recentPapers,
    readingStats,
    recentReadings,
    renameFolder,
    resolveImportConflict,
    scale,
    setCurrentPage,
    switchToPaper,
    totalPages,
    uncategorizedFolderId,
    zoomIn,
    zoomOut,
    zoomBy,
    activePaperSummary,
    activePaperFullText,
  } = usePdfReader({ currentUser })
  const pdfSearch = usePdfSearch(readerRef, { pdfDocument, pageNumbers })
  const activePaperId = activeView !== 'home' ? Number(activeView) : null
  const {
    annotations,
    loading: annLoading,
    createAnnotation,
    deleteAnnotation,
    eraseAnnotationRange,
    restoreAnnotations,
  } = useAnnotations(activePaperId)
  const {
    notebooks,
    loading: notesLoading,
    saving: notesSaving,
    setNotebooks,
    saveNotebooks,
    createNotebookDraft,
  } = usePaperNotes(activePaperId)
  const [activeNoteTarget, setActiveNoteTarget] = useState(null)
  const [noteFocus, setNoteFocus] = useState(null)
  const [annotationUndoStacks, setAnnotationUndoStacks] = useState({})
  const eraseUndoSessionsRef = useRef(new Set())
  const activeFileUrl = activePaperId ? getPaperFileUrl(activePaperId) : null

  const thumbnailPanel = useResizableWidth({
    initialWidth: 300,
    minWidth: 160,
    maxWidth: 420,
  })
  const insightPanel = useResizableWidth({
    initialWidth: 300,
    minWidth: 180,
    maxWidth: 460,
  })
  const workspacePanel = useResizableWidth({
    initialWidth: 380,
    minWidth: 300,
    maxWidth: 620,
  })

  const { selectionCard, handleSelection, dismissSelectionCard, setDomain, aiEnabled, toggleAI } = useSelectionInsight({
    readerRef,
    paperTitle: metadata.title || fileName,
    paperSummary: activePaperSummary,
    activePaperFullText,
  })

  useEffect(() => {
    let cancelled = false
    const token = getStoredAuthToken()

    if (!token) {
      return undefined
    }

    async function restoreSession() {
      try {
        const user = await fetchCurrentUser(token)
        if (!cancelled) {
          setCurrentUser(user)
        }
      } catch {
        clearStoredAuthToken()
        if (!cancelled) {
          setCurrentUser(null)
        }
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  // Toolbar button ripple effect
  useEffect(() => {
    function handleRipple(event) {
      const btn = event.target.closest('.toolbar-icon-button, .toolbar-tool')
      if (!btn) return

      const ripple = document.createElement('span')
      ripple.className = 'ripple-effect'
      const rect = btn.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`
      ripple.style.width = `${size}px`
      ripple.style.height = `${size}px`
      btn.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove())
    }

    document.addEventListener('click', handleRipple)
    return () => document.removeEventListener('click', handleRipple)
  }, [])

  useEffect(() => {
    if (!isUserMenuOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isUserMenuOpen])

  const isHomeView = activeView === 'home'
  const isReaderView = activeView !== 'home'
  const isAccountView = Boolean(accountSection)
  const userInitials = (currentUser?.nickname || 'xk').slice(0, 2).toLowerCase()
  const activeChatMessages = chatMessages[activeView] || []
  const activeChatInput = chatInput[activeView] || ''
  const activeChatAsking = chatAsking[activeView] || false
  const activeInitialSuggestions = chatInitialSuggestions[activeView] || []
  const activeInitialSuggestionsLoading = chatInitialSuggestionsLoading[activeView] || false
  const activeFollowupLoadingMessageId = chatFollowupLoadingMessageId[activeView] || ''
  const paperReaderState = {
    error,
    fileName,
    fitToWidth,
    isLoading,
    metadata,
    pageMetrics,
    pageNumber,
    pageNumbers,
    pdfDocument,
    scale,
    setCurrentPage,
    totalPages,
    zoomIn,
    zoomOut,
  }
  const canUndoAnnotation = activePaperId
    ? (annotationUndoStacks[activePaperId]?.length || 0) > 0
    : false

  function applyFullTranslationState(payload) {
    const status = normalizeFullTranslationStatus(payload?.status)
    setFullTranslation(payload || null)
    setFullTranslationStatus(status)
    setFullTranslationProgress(getFullTranslationProgress(payload))
  }

  function clearFullTranslationPolling() {
    if (fullTranslationPollRef.current) {
      window.clearInterval(fullTranslationPollRef.current)
      fullTranslationPollRef.current = null
    }
  }

  function beginFullTranslationPolling(paperId) {
    clearFullTranslationPolling()
    if (!paperId) return
    fullTranslationPollRef.current = window.setInterval(async () => {
      try {
        const payload = await streamFullTranslation(paperId)
        applyFullTranslationState(payload)
        if (payload?.status !== 'running') {
          clearFullTranslationPolling()
        }
      } catch (err) {
        clearFullTranslationPolling()
        setFullTranslationStatus('error')
      }
    }, 1500)
  }

  useEffect(() => () => clearFullTranslationPolling(), [])

  useEffect(() => {
    let cancelled = false
    clearFullTranslationPolling()
    setIsFullTranslationOpen(false)

    if (!activePaperId) {
      setFullTranslation(null)
      setFullTranslationStatus('idle')
      setFullTranslationProgress(0)
      return undefined
    }

    async function restoreFullTranslationState() {
      try {
        const payload = await fetchFullTranslation(activePaperId)
        if (cancelled) return
        applyFullTranslationState(payload)
        if (payload?.status === 'running') {
          beginFullTranslationPolling(activePaperId)
        }
      } catch {
        if (!cancelled) {
          setFullTranslationStatus('idle')
          setFullTranslationProgress(0)
        }
      }
    }

    restoreFullTranslationState()
    return () => {
      cancelled = true
    }
  }, [activePaperId])

  function snapshotAnnotations(items) {
    return (items || []).map((annotation) => ({
      page_number: annotation.page_number,
      start_char: annotation.start_char,
      end_char: annotation.end_char,
      quote_text: annotation.quote_text,
      rects: annotation.rects || [],
      type: annotation.type,
      color: annotation.color || null,
      source: annotation.source || 'native',
      geometry_version: annotation.geometry_version || 'v1',
    }))
  }

  function pushAnnotationUndo(paperId, snapshot) {
    if (!paperId) return
    setAnnotationUndoStacks((prev) => {
      const stack = prev[paperId] || []
      return {
        ...prev,
        [paperId]: [...stack, snapshot].slice(-80),
      }
    })
  }

  function clearAnnotationUndo(paperId) {
    if (!paperId) return
    setAnnotationUndoStacks((prev) => {
      const next = { ...prev }
      delete next[paperId]
      return next
    })
    for (const sessionKey of Array.from(eraseUndoSessionsRef.current)) {
      if (sessionKey.startsWith(`${paperId}:`)) {
        eraseUndoSessionsRef.current.delete(sessionKey)
      }
    }
  }

  function handleScreenshotTranslate(selectionPayload) {
    if (!selectionPayload?.text) return
    handleSelection(selectionPayload)
  }

  function createChatMessageId(prefix) {
    chatMessageCounterRef.current += 1
    return `${prefix}-${Date.now()}-${chatMessageCounterRef.current}`
  }

  function nextChatRequestToken() {
    chatRequestCounterRef.current += 1
    return chatRequestCounterRef.current
  }

  function normalizeSuggestionQuestions(value) {
    if (!Array.isArray(value)) return []
    const questions = []
    const seen = new Set()

    value.forEach(function (item) {
      const text = String(item || '').trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      questions.push(text)
    })

    return questions.slice(0, 3)
  }

  function sameQuestionSet(left, right) {
    const leftText = normalizeSuggestionQuestions(left).join('\n')
    const rightText = normalizeSuggestionQuestions(right).join('\n')
    return Boolean(leftText) && leftText === rightText
  }

  function normalizeFollowupTitle(title, index) {
    const fallbackTitles = ['深入理解', '结果追问', '延伸应用']
    const text = String(title || '').trim()
    if (!text) return fallbackTitles[index] || `推荐问题 ${index + 1}`
    if (text.includes('迁移')) return '延伸应用'
    return text
  }

  function compactQuestionSubject(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length <= limit ? text : `${text.slice(0, limit).trim()}...`
  }

  function buildInitialSuggestionQuestions(chatContext, batchIndex = 0) {
    const subject = compactQuestionSubject(chatContext?.selected_text || chatContext?.paper_title, 36) || '这篇论文'
    const title = compactQuestionSubject(chatContext?.paper_title, 28) || '这篇论文'
    const batches = [
      [
        `${title} 的核心创新点是什么？`,
        `作者用了什么方法解决 ${subject} 相关问题？`,
        '实验结果最值得关注的是哪几项？',
      ],
      [
        `这篇论文主要想解决什么问题？`,
        `${subject} 在方法流程里起什么作用？`,
        '作者的结论有没有明显局限？',
      ],
      [
        `读这篇论文时应该先抓住哪条主线？`,
        '论文里的关键术语分别是什么意思？',
        '如果要复现这篇论文，第一步该看哪里？',
      ],
      [
        `这篇论文和已有方法最大的差别是什么？`,
        '哪些实验能证明作者的方法有效？',
        `${subject} 对后续研究有什么启发？`,
      ],
    ]

    return normalizeSuggestionQuestions(batches[Math.abs(batchIndex) % batches.length])
  }

  function normalizeFollowupGroups(value) {
    if (!Array.isArray(value)) return []

    return value
      .map(function (item, index) {
        const questions = normalizeSuggestionQuestions(item?.questions || [])
        if (!questions.length) return null

        return {
          title: normalizeFollowupTitle(item?.title, index),
          rationale: String(item?.rationale || '').trim(),
          questions,
        }
      })
      .filter(Boolean)
      .slice(0, 3)
  }

  function mergeQuestionPool(primary, fallback) {
    return normalizeSuggestionQuestions([...(primary || []), ...(fallback || [])])
  }

  function buildFallbackFollowupGroups(payload) {
    const subject = compactQuestionSubject(payload?.selectedText || payload?.paperTitle, 36) || '这篇论文'
    const lastQuestion = compactQuestionSubject(payload?.lastUserQuestion, 42) || '刚才这个问题'
    const legacyQuestions = normalizeSuggestionQuestions(payload?.legacyQuestions || [])

    return [
      {
        title: '深入理解',
        rationale: `围绕 ${subject} 继续拆方法、术语和设计逻辑。`,
        questions: mergeQuestionPool(
          legacyQuestions.slice(0, 1),
          [
            `${subject} 在整篇论文的方法里具体承担什么作用？`,
            `作者为什么这样设计 ${subject}？`,
            `如果只保留最关键的一步，这部分的核心逻辑是什么？`,
          ],
        ),
      },
      {
        title: '结果追问',
        rationale: `顺着“${lastQuestion}”继续追实验结果、对比和局限。`,
        questions: mergeQuestionPool(
          legacyQuestions.slice(1, 2),
          [
            `${lastQuestion} 对应的实验结果是怎么证明的？`,
            '和之前的方法相比，这篇论文提升最明显的是哪一项？',
            '作者有没有提到这个方法的局限或失效场景？',
          ],
        ),
      },
      {
        title: '延伸应用',
        rationale: '把当前论文结论延伸到复现、应用和阅读启发。',
        questions: mergeQuestionPool(
          legacyQuestions.slice(2, 3),
          [
            `${subject} 能迁移到别的任务或数据集上吗？`,
            '如果我想复现这篇论文，最先该准备什么？',
            '这部分结论对我继续读后文有什么帮助？',
          ],
        ),
      },
    ]
  }

  function buildPaperChatContext() {
    const fullTextContext = String(activePaperFullText || '').replace(/\s+/g, ' ').trim()
    const summaryContext = fullTextContext
      ? `论文全文前文摘录：${fullTextContext.slice(0, 3600)}`
      : (activePaperSummary || '')
    return {
      paper_title: metadata.title || fileName || '',
      summary: summaryContext,
      selected_text: selectionCard.text || '',
      provider_id: activeProviderId,
    }
  }

  function buildRecentChatMessages(messages) {
    return (messages || [])
      .filter(function (message) {
        return (message.role === 'user' || message.role === 'assistant') && (message.text || '').trim()
      })
      .slice(-6)
      .map(function (message) {
        return {
          role: message.role === 'assistant' ? 'assistant' : 'user',
          text: (message.text || '').trim(),
        }
      })
  }

  function clearMessageFollowups(messages) {
    return (messages || []).map(function (message) {
      if (!message?.followupGroups?.length) return message
      return { ...message, followupGroups: [] }
    })
  }

  function updateChatMessagesForView(viewKey, updater) {
    setChatMessages(function (previous) {
      return {
        ...previous,
        [viewKey]: updater(previous[viewKey] || []),
      }
    })
  }

  function handleAskAIText(text) {
    if (!text) return
    setActiveWorkspacePanel('ask')
    setChatInput(function (previous) {
      return {
        ...previous,
        [activeView]: text,
      }
    })
  }

  function handleDownloadOption(format) {
    const baseName = sanitizeDownloadName(metadata.title || fileName)

    if (format === 'pdf') {
      if (!activeFileUrl) {
        window.alert('当前 PDF 暂时没有可下载地址')
        return
      }
      const link = document.createElement('a')
      link.href = activeFileUrl
      link.download = fileName || `${baseName}.pdf`
      link.click()
      return
    }

    const citationText = buildCitationText(format, metadata, fileName)
    const suffixMap = {
      gbt7714: 'GB-T-7714-2015',
      cajcd: 'CAJ-CD',
      mla: 'MLA',
    }
    triggerTextDownload(citationText, `${baseName}-${suffixMap[format] || 'citation'}.txt`)
  }

  async function handleFullTranslate() {
    if (!activePaperId) return

    if (fullTranslationStatus === 'completed' && fullTranslation?.pages?.length) {
      setIsFullTranslationOpen(true)
      return
    }

    if (fullTranslationStatus === 'running' || fullTranslationBusy) {
      beginFullTranslationPolling(activePaperId)
      return
    }

    if (!pdfDocument) {
      window.alert('PDF 还在加载，稍等一下再启动全文翻译。')
      return
    }

    setFullTranslationBusy(true)
    try {
      const pages = await buildFullTranslationPages(pdfDocument, pageMetrics)
      if (!pages.length) {
        window.alert('没有提取到可翻译的正文内容。')
        return
      }
      const payload = {
        source_hash: hashTranslationPages(pages),
        pages,
        provider_id: activeProviderId || null,
      }
      const request = fullTranslationStatus === 'error' ? retryFullTranslation : startFullTranslation
      const result = await request(activePaperId, payload)
      applyFullTranslationState(result)
      if (result?.status === 'completed') {
        setIsFullTranslationOpen(true)
      } else {
        beginFullTranslationPolling(activePaperId)
      }
    } catch (err) {
      window.alert(err?.message || '全文翻译启动失败，请检查 AI 配置后重试。')
      setFullTranslationStatus('error')
    } finally {
      setFullTranslationBusy(false)
    }
  }

  async function fetchInitialSuggestions(force = false) {
    const viewKey = activeView
    if (!viewKey || viewKey === 'home') return

    const existingMessages = chatMessages[viewKey] || []
    const existingSuggestions = chatInitialSuggestions[viewKey] || []
    const isLoading = chatInitialSuggestionsLoading[viewKey] || false

    if (!force) {
      if (existingMessages.length > 0 || existingSuggestions.length > 0 || isLoading) {
        return
      }
    }

    const chatContext = buildPaperChatContext()
    const previousBatch = initialSuggestionBatchRef.current[viewKey] || 0
    const batchIndex = force ? previousBatch + 1 : previousBatch
    initialSuggestionBatchRef.current[viewKey] = batchIndex
    const fallbackQuestions = buildInitialSuggestionQuestions(chatContext, batchIndex)
    const requestToken = nextChatRequestToken()
    initialSuggestionRequestRef.current[viewKey] = requestToken
    setChatInitialSuggestionsLoading(function (previous) {
      return {
        ...previous,
        [viewKey]: true,
      }
    })

    try {
      const token = getStoredAuthToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const response = await fetch('/api/suggest-questions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'initial',
          ...chatContext,
          recent_messages: [],
        }),
      })
      const data = await response.json().catch(function () { return null })

      if (initialSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }

      const aiQuestions = normalizeSuggestionQuestions(data?.questions || [])
      const questions = (!aiQuestions.length || (force && sameQuestionSet(aiQuestions, existingSuggestions)))
        ? fallbackQuestions
        : aiQuestions
      setChatInitialSuggestions(function (previous) {
        return {
          ...previous,
          [viewKey]: questions,
        }
      })
    } catch (_) {
      if (initialSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }
      setChatInitialSuggestions(function (previous) {
        return {
          ...previous,
          [viewKey]: fallbackQuestions,
        }
      })
    } finally {
      if (initialSuggestionRequestRef.current[viewKey] === requestToken) {
        setChatInitialSuggestionsLoading(function (previous) {
          return {
            ...previous,
            [viewKey]: false,
          }
        })
      }
    }
  }

  async function fetchFollowupSuggestions({
    viewKey,
    assistantMessageId,
    lastUserQuestion,
    lastAssistantAnswer,
    messages,
    chatContext,
  }) {
    if (!viewKey || !assistantMessageId || !lastAssistantAnswer.trim()) return

    const fallbackGroups = buildFallbackFollowupGroups({
      paperTitle: chatContext?.paper_title,
      selectedText: chatContext?.selected_text,
      lastUserQuestion,
      lastAssistantAnswer,
      legacyQuestions: [],
    })

    const requestToken = nextChatRequestToken()
    followupSuggestionRequestRef.current[viewKey] = requestToken
    setChatFollowupLoadingMessageId(function (previous) {
      return {
        ...previous,
        [viewKey]: assistantMessageId,
      }
    })

    try {
      const token = getStoredAuthToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const response = await fetch('/api/suggest-questions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'followup',
          ...chatContext,
          last_user_question: lastUserQuestion,
          last_assistant_answer: lastAssistantAnswer,
          recent_messages: buildRecentChatMessages(messages),
        }),
      })
      const data = await response.json().catch(function () { return null })

      if (followupSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }

      const legacyQuestions = normalizeSuggestionQuestions(data?.questions || [])
      const groups = normalizeFollowupGroups(data?.groups || [])
      const resolvedGroups = groups.length
        ? groups
        : buildFallbackFollowupGroups({
            paperTitle: chatContext?.paper_title,
            selectedText: chatContext?.selected_text,
            lastUserQuestion,
            lastAssistantAnswer,
            legacyQuestions,
          })
      updateChatMessagesForView(viewKey, function (entries) {
        return entries.map(function (message) {
          if (message.id === assistantMessageId) {
            return { ...message, followupGroups: resolvedGroups }
          }
          if (message.followupGroups?.length) {
            return { ...message, followupGroups: [] }
          }
          return message
        })
      })
    } catch (_) {
      if (followupSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }

      updateChatMessagesForView(viewKey, function (entries) {
        return entries.map(function (message) {
          if (message.id === assistantMessageId) {
            return { ...message, followupGroups: fallbackGroups }
          }
          if (message.followupGroups?.length) {
            return { ...message, followupGroups: [] }
          }
          return message
        })
      })
    } finally {
      if (followupSuggestionRequestRef.current[viewKey] === requestToken) {
        setChatFollowupLoadingMessageId(function (previous) {
          return {
            ...previous,
            [viewKey]: '',
          }
        })
      }
    }
  }

  async function handleChatSubmit(rawQuestion) {
    const chatView = activeView
    const question = String(rawQuestion || chatInput[chatView] || '').trim()
    if (!question || !chatView || chatView === 'home') return

    const chatContext = buildPaperChatContext()
    const baseMessages = clearMessageFollowups(chatMessages[chatView] || [])
    const userMessage = {
      id: createChatMessageId('user'),
      role: 'user',
      text: question,
      status: 'done',
    }
    const assistantMessageId = createChatMessageId('assistant')
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      status: 'streaming',
      followupGroups: [],
    }

    followupSuggestionRequestRef.current[chatView] = null
    setChatFollowupLoadingMessageId(function (previous) {
      return {
        ...previous,
        [chatView]: '',
      }
    })
    setChatMessages(function (previous) {
      return {
        ...previous,
        [chatView]: baseMessages.concat([userMessage, assistantMessage]),
      }
    })
    setChatInput(function (previous) {
      return {
        ...previous,
        [chatView]: '',
      }
    })
    setChatAsking(function (previous) {
      return {
        ...previous,
        [chatView]: true,
      }
    })

    let aiText = ''
    let streamFailed = false

    try {
      const token = getStoredAuthToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const response = await fetch('/api/ask-stream', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question,
          selected_text: chatContext.selected_text,
          paper_title: chatContext.paper_title,
          summary: chatContext.summary,
          provider_id: chatContext.provider_id,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error('stream failed')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break

        buffer += decoder.decode(chunk.value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() || ''

        for (let i = 0; i < parts.length; i += 1) {
          const line = parts[i]
          if (!line.startsWith('data: ')) continue
          aiText += line.slice(6)

          updateChatMessagesForView(chatView, function (entries) {
            return entries.map(function (entry) {
              if (entry.id === assistantMessageId) {
                return {
                  ...entry,
                  text: aiText,
                  status: 'streaming',
                }
              }
              return entry
            })
          })
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        }
      }
    } catch (_) {
      streamFailed = true
    }

    const finalAssistantText = streamFailed
      ? 'AI 回答失败，请稍后再试。'
      : (aiText.trim() || 'AI 暂时没有返回内容。')
    const finalAssistantStatus = streamFailed ? 'error' : 'done'
    const finalMessages = baseMessages.concat([
      userMessage,
      {
        ...assistantMessage,
        text: finalAssistantText,
        status: finalAssistantStatus,
      },
    ])

    setChatMessages(function (previous) {
      return {
        ...previous,
        [chatView]: finalMessages,
      }
    })
    setChatAsking(function (previous) {
      return {
        ...previous,
        [chatView]: false,
      }
    })

    if (!streamFailed && aiText.trim()) {
      await fetchFollowupSuggestions({
        viewKey: chatView,
        assistantMessageId,
        lastUserQuestion: question,
        lastAssistantAnswer: finalAssistantText,
        messages: finalMessages,
        chatContext,
      })
    }
  }

  useEffect(() => {
    if (activeWorkspacePanel !== 'ask' || activeView === 'home') return
    if (activeChatMessages.length > 0) return
    if (activeInitialSuggestions.length > 0 || activeInitialSuggestionsLoading) return
    fetchInitialSuggestions(false)
  }, [
    activeWorkspacePanel,
    activeView,
    activeChatMessages.length,
    activeInitialSuggestions.length,
    activeInitialSuggestionsLoading,
    metadata.title,
    fileName,
    activePaperSummary,
    selectionCard.text,
  ])

  function applyNoteInsert(block) {
    if (!activePaperId || !block) return
    setActiveWorkspacePanel('notes')
    setNotebooks((previous) => {
      const inserted = insertBlockIntoNotebooks(previous, activeNoteTarget, block)
      setActiveNoteTarget(inserted.target)
      return inserted.notebooks
    })
  }

  async function handleInsertScreenshotNote(payload) {
    if (!activePaperId || !payload?.imageUrl) return
    applyNoteInsert(createImageBlockDraft(payload))
  }

  async function handleInsertSelectionNote(payload) {
    if (!activePaperId || !payload?.text) return
    applyNoteInsert(createQuoteBlockDraft(payload))
  }

  function handleCreateNotebook(kind) {
    if (!activePaperId) return
    setActiveWorkspacePanel('notes')
    createNotebookDraft(kind || 'blank')
  }

  async function handleSaveAllNotebooks(nextNotebooks) {
    if (!activePaperId) return null
    const saved = await saveNotebooks(nextNotebooks || notebooks)
    if (saved) {
      const prepared = ensureInsertTarget(saved, activeNoteTarget)
      setActiveNoteTarget(prepared.target)
    }
    return saved
  }

  function handleJumpToNoteAnchor(note) {
    if (!note?.page_number || note.start_char == null || note.end_char == null) return
    setCurrentPage(note.page_number)
    setNoteFocus({
      pageNumber: note.page_number,
      startChar: note.start_char,
      endChar: note.end_char,
      nonce: Date.now(),
    })
  }

  useEffect(() => {
    if (!noteFocus) return undefined
    const timer = window.setTimeout(() => setNoteFocus(null), 2800)
    return () => window.clearTimeout(timer)
  }, [noteFocus])

  async function handleCreateAnnotation(payload) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await createAnnotation(payload)
    if (result) pushAnnotationUndo(activePaperId, before)
    return result
  }

  async function handleDeleteAnnotation(annotationId) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await deleteAnnotation(annotationId)
    if (result) pushAnnotationUndo(activePaperId, before)
    return result
  }

  async function handleEraseAnnotationRange(payload) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await eraseAnnotationRange(payload)
    if (!result) return null

    const sessionKey = payload?.eraseSessionId
      ? `${activePaperId}:${payload.eraseSessionId}`
      : ''
    if (!sessionKey || !eraseUndoSessionsRef.current.has(sessionKey)) {
      pushAnnotationUndo(activePaperId, before)
      if (sessionKey) eraseUndoSessionsRef.current.add(sessionKey)
    }
    return result
  }

  async function handleUndoAnnotation() {
    if (!activePaperId) return
    const stack = annotationUndoStacks[activePaperId] || []
    const previous = stack[stack.length - 1]
    if (!previous) return

    const result = await restoreAnnotations(previous)
    if (!result) return

    setAnnotationUndoStacks((prev) => ({
      ...prev,
      [activePaperId]: (prev[activePaperId] || []).slice(0, -1),
    }))
  }

  function handleClosePaper(paperId) {
    clearAnnotationUndo(paperId)
    closePaper(paperId)
  }

  function handleLogout() {
    clearStoredAuthToken()
    localStorage.removeItem('xk_read_recent')
    setAnnotationUndoStacks({})
    setChatMessages({})
    setChatInput({})
    setChatAsking({})
    setChatInitialSuggestions({})
    setChatInitialSuggestionsLoading({})
    setChatFollowupLoadingMessageId({})
    initialSuggestionRequestRef.current = {}
    initialSuggestionBatchRef.current = {}
    followupSuggestionRequestRef.current = {}
    eraseUndoSessionsRef.current.clear()
    setCurrentUser(null)
    setIsUserMenuOpen(false)
    setAccountSection('')
    goHome()
  }

  function openAccountSection(section) {
    setAccountSection(section)
    setIsUserMenuOpen(false)
  }

  function handleCopyUid() {
    if (!currentUser?.uid || !navigator.clipboard) {
      return
    }

    navigator.clipboard.writeText(currentUser.uid).catch(() => {})
  }

  async function handleSaveProfile(payload) {
    const user = await updateCurrentUser(payload)
    setCurrentUser(user)
    return user
  }

  async function handleUploadAvatar(file) {
    const user = await uploadAvatar(file)
    setCurrentUser(user)
    return user
  }

  return (
    <div
      className={`app-shell${isAuthViewOpen ? ' app-shell--auth' : ''}${
        !isAuthViewOpen && isAccountView ? ' app-shell--account' : ''
      }`}
    >
      <input
        ref={fileInputRef}
        accept="application/pdf"
        className="hidden-input"
        multiple
        onChange={handleFileChange}
        type="file"
      />

      {!isAuthViewOpen && !isAccountView ? (
        <header className="topbar">
          <div className="brand-tabs">
            <div className="brand-mark">xk</div>
            <strong>xk 阅读</strong>
            <div className="topbar-tabs">
              <button
                type="button"
                className={`doc-tab doc-tab--home${isHomeView ? ' is-active' : ''}`}
                onClick={() => {
                  setAccountSection('')
                  goHome()
                }}
              >
                首页
              </button>

              {openTabs.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  className={`doc-tab${activeView === paper.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setAccountSection('')
                    switchToPaper(paper.id)
                  }}
                >
                  <span className="doc-tab__label">{paper.fileName.replace(/\.pdf$/i, '')}</span>
                  <span
                    aria-label={`关闭 ${paper.fileName}`}
                    className="doc-tab__close"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleClosePaper(paper.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        handleClosePaper(paper.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-meta">
            <StatusPanel label={serverStatus} />
            <button type="button" className="topbar-action">
              通知
            </button>
            <button type="button" className="topbar-action">
              客服
            </button>

            {currentUser ? (
              <div
                ref={userMenuRef}
                className="topbar-user-wrap"
                onMouseEnter={() => setIsUserMenuOpen(true)}
              >
                <button
                  type="button"
                  className="topbar-user"
                  aria-expanded={isUserMenuOpen}
                  onClick={() => setIsUserMenuOpen((value) => !value)}
                >
                  <span className="topbar-user__avatar">
                    {currentUser.avatar_url ? (
                      <img src={currentUser.avatar_url} alt={currentUser.nickname} />
                    ) : (
                      userInitials
                    )}
                  </span>
                  <span className="topbar-user__name">{currentUser.nickname}</span>
                </button>

                {isUserMenuOpen ? (
                  <div className="user-menu">
                    <div className="user-menu__header">
                      <div className="user-menu__avatar">
                        {currentUser.avatar_url ? (
                          <img src={currentUser.avatar_url} alt={currentUser.nickname} />
                        ) : (
                          userInitials
                        )}
                      </div>
                      <div className="user-menu__identity">
                        <strong>{currentUser.nickname}</strong>
                        <div className="user-menu__uid-inline">
                          <span>{`uid: ${currentUser.uid}`}</span>
                          <button type="button" onClick={handleCopyUid} aria-label="复制 UID">
                            <Copy />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="user-menu__actions">
                      <button type="button" onClick={() => openAccountSection('profile')}>
                        <UserRound />
                        <span>个人中心</span>
                      </button>
                      <button type="button" onClick={() => openAccountSection('settings')}>
                        <Settings2 />
                        <span>系统设置</span>
                      </button>
                      <button type="button" onClick={() => openAccountSection('ai-config')}>
                        <Brain />
                        <span>AI 配置</span>
                      </button>
                      <button type="button" className="is-danger" onClick={handleLogout}>
                        <LogOut />
                        <span>退出登录</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="topbar-action topbar-action--login"
                onClick={() => {
                  setAuthMode('login')
                  setIsAuthViewOpen(true)
                }}
              >
                <LogIn />
                <span>登录</span>
              </button>
            )}
          </div>
        </header>
      ) : null}

      <main className="workspace">
        {isAuthViewOpen ? (
          <div className="workspace-view workspace-view--auth is-active">
            <Login
              key={authMode}
              initialMode={authMode}
              onAuthSuccess={(authPayload) => {
                storeAuthToken(authPayload.access_token)
                setCurrentUser(authPayload.user)
                setIsAuthViewOpen(false)
              }}
            />
          </div>
        ) : null}

        <div
          className={`workspace-view workspace-view--home${
            !isAuthViewOpen && !isAccountView && isHomeView ? ' is-active' : ' is-hidden'
          }`}
        >
          <HomePage
            folders={folders}
            importConflict={importConflict}
            isImporting={isImporting}
            onCancelImportConflict={cancelImportConflict}
            onCreateFolder={createFolder}
            onDeleteFolder={deleteFolder}
            onDeletePaper={deletePaper}
            onMovePaper={assignPaperToFolder}
            onOpenFilePicker={openFilePicker}
            onOpenPaper={switchToPaper}
            onRenameFolder={renameFolder}
            onResolveImportConflict={resolveImportConflict}
            recentPapers={recentPapers}
            recentReadings={recentReadings}
            readingStats={readingStats}
            uncategorizedFolderId={uncategorizedFolderId}
          />
        </div>

        <div
          className={`workspace-view workspace-view--reader${
            !isAuthViewOpen && !isAccountView && isReaderView ? ' is-active' : ' is-hidden'
          }`}
        >
          {isFullTranslationOpen ? (
            <FullTranslationReader
              paperId={activePaperId}
              fileName={fileName}
              metadata={metadata}
              pageMetrics={pageMetrics}
              pageNumbers={pageNumbers}
              pdfDocument={pdfDocument}
              translation={fullTranslation}
              onBack={() => setIsFullTranslationOpen(false)}
            />
          ) : (
            <>
              <PaperReader
                pdfReader={paperReaderState}
                readerRef={readerRef}
                activeTool={activeTool}
                isThumbnailsOpen={isThumbnailsOpen}
                thumbnailWidth={thumbnailPanel.width}
                onThumbnailResizeStart={thumbnailPanel.startResizeLeft}
                onToggleThumbnails={() => setIsThumbnailsOpen((v) => !v)}
                onToolChange={setActiveTool}
                onSelect={handleSelection}
                onThumbnailPageClick={(pageNum) => {
                  setCurrentPage(pageNum)
                  const el = readerRef.current?.querySelector(`[data-page-number="${pageNum}"]`)
                  if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' })
                }}
                onWheelZoom={zoomBy}
                searchTerm={pdfSearch.searchTerm}
                onSearchChange={pdfSearch.onSearchChange}
                matchIndex={pdfSearch.matchIndex}
                matches={pdfSearch.matches}
                noteFocus={noteFocus}
                onSearchExecute={pdfSearch.performSearch}
                totalMatches={pdfSearch.totalMatches}
                onSearchPrev={pdfSearch.onSearchPrev}
                onSearchNext={pdfSearch.onSearchNext}
                canUndoAnnotation={canUndoAnnotation}
                onUndoAnnotation={handleUndoAnnotation}
                currentPaperId={activePaperId}
                annotations={annotations}
                onCreateAnnotation={handleCreateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onEraseAnnotationRange={handleEraseAnnotationRange}
                onInsertSelectionNote={handleInsertSelectionNote}
                onAskAI={function () { if (selectionCard.text) handleAskAIText(selectionCard.text) }}
                onScreenshotTranslate={handleScreenshotTranslate}
                onScreenshotAskAI={handleAskAIText}
                onScreenshotInsertNote={handleInsertScreenshotNote}
                onDownload={handleDownloadOption}
                fullTranslateActive={fullTranslationStatus === 'completed'}
                fullTranslateStatus={fullTranslationBusy ? 'running' : fullTranslationStatus}
                fullTranslateProgress={fullTranslationProgress}
                onFullTranslate={handleFullTranslate}
              />

              <div
                aria-label="调整即时理解面板宽度"
                aria-orientation="vertical"
                className="workspace-resizer"
                onPointerDown={insightPanel.startResize}
                role="separator"
              />

              <SelectionInsightPanel
                domain={selectionCard.domain}
                onDomainChange={setDomain}
                selectionCard={selectionCard}
                width={insightPanel.width}
                aiEnabled={aiEnabled}
                onToggleAI={toggleAI}
              />

              {activeWorkspacePanel ? (
                <div
                  aria-label="调整工作面板宽度"
                  aria-orientation="vertical"
                  className="workspace-resizer"
                  onPointerDown={workspacePanel.startResize}
                  role="separator"
                />
              ) : null}

              <SideWorkspacePanel
                activePanel={activeWorkspacePanel}
                paperId={activePaperId}
                fileName={fileName}
                metadata={metadata}
                currentUser={currentUser}
                width={workspacePanel.width}
                notebooks={notebooks}
                notesLoading={notesLoading}
                notesSaving={notesSaving}
                activeNoteTarget={activeNoteTarget}
                onCreateNotebook={handleCreateNotebook}
                onDraftChange={setNotebooks}
                onSaveNotebooks={handleSaveAllNotebooks}
                onSetActiveNoteTarget={setActiveNoteTarget}
                onJumpToNote={handleJumpToNoteAnchor}
                chatMessages={activeChatMessages}
                chatInput={activeChatInput}
                chatAsking={activeChatAsking}
                chatInitialSuggestions={activeInitialSuggestions}
                chatInitialSuggestionsLoading={activeInitialSuggestionsLoading}
                chatFollowupLoadingMessageId={activeFollowupLoadingMessageId}
                providerLabel={providerLabel}
                onChatInputChange={function (value) {
                  setChatInput(function (previous) {
                    return {
                      ...previous,
                      [activeView]: value,
                    }
                  })
                }}
                onChatSubmit={handleChatSubmit}
                onRefreshInitialSuggestions={function () { fetchInitialSuggestions(true) }}
              />

              <UtilityRail
                activeItem={activeWorkspacePanel}
                collapsed={isUtilityRailCollapsed}
                onSelect={setActiveWorkspacePanel}
                onToggleCollapsed={() => setIsUtilityRailCollapsed((value) => !value)}
              />
            </>
          )}
        </div>

        <div
          className={`workspace-view workspace-view--account${
            !isAuthViewOpen && isAccountView ? ' is-active' : ' is-hidden'
          }`}
        >
          {accountSection === 'ai-config' ? (
            <AiConfigPage onBack={() => setAccountSection('')} />
          ) : (
            <UserCenterPage
            key={[
              accountSection || 'profile',
              currentUser?.uid || 'guest',
              currentUser?.nickname || '',
              currentUser?.education || '',
              currentUser?.occupation || '',
              currentUser?.organization || '',
              currentUser?.discipline || '',
              currentUser?.avatar_url || '',
            ].join(':')}
            activeSection={accountSection || 'profile'}
            currentUser={currentUser}
            onBack={() => setAccountSection('')}
            onSaveProfile={handleSaveProfile}
            onSectionChange={setAccountSection}
            onUploadAvatar={handleUploadAvatar}
          />
          )}
        </div>
      </main>
    </div>
  )
}

export default App
