import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'
import { createPdfLoadingTask } from '../services/pdfjsClient'
import {
  readReadingSessionSnapshot,
  removeReadingSessionSnapshot,
  saveReadingSessionSnapshot,
} from '../components/reader/readingSessionStorage'
import {
  buildImportProgress,
  createDuplicateImportConflict,
  createImportFailureConflict,
  resolveImportTargetFolderId,
} from '../components/home/importWorkflowModel'
import {
  mergeImportedServerPaper,
  shouldRefreshImportedMetadata,
} from '../components/home/importMetadataModel'
import {
  createFolder as apiCreateFolder,
  deleteFolder as apiDeleteFolder,
  deletePaper as apiDeletePaper,
  emptyTrash as apiEmptyTrash,
  fetchFolders,
  fetchPapers,
  fetchAiProviders,
  fetchPaperSummary,
  fetchReadingStats,
  fetchTrashPapers,
  getPaperFileUrl,
  permanentlyDeletePaper as apiPermanentlyDeletePaper,
  recordReadingEvent,
  renameFolder as apiRenameFolder,
  refreshPaperMetadata as apiRefreshPaperMetadata,
  restorePaperFromTrash as apiRestorePaperFromTrash,
  syncReadingRecords,
  updateReadingDuration,
  updatePaper as apiUpdatePaper,
  uploadPaper,
} from '../services/paperReaderApi'

const DEFAULT_SCALE = 1.35
const MIN_SCALE = 0.9
const MAX_SCALE = 4.0
const SCALE_STEP = 0.15
const EMPTY_METADATA = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: '',
  producer: '',
  creationDate: '',
  modificationDate: '',
  doi: '',
  arxivId: '',
  fileSize: '',
  pageCount: 0,
}

function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function formatFileSize(size) {
  if (!size) {
    return ''
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function normalizePdfDate(rawDate) {
  if (!rawDate || !rawDate.startsWith('D:')) {
    return rawDate || ''
  }

  const year = rawDate.slice(2, 6)
  const month = rawDate.slice(6, 8)
  const day = rawDate.slice(8, 10)
  return [year, month, day].filter(Boolean).join('-')
}

function cleanMetadataText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function findDoi(text) {
  return (text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0] ?? '').replace(/[),.;]+$/, '')
}

function findArxivId(text) {
  const match = String(text || '').match(/\b(?:arXiv:\s*)?(\d{4}\.\d{4,5})(v\d+)?\b/i)
  if (!match) return ''
  return `${match[1]}${match[2] || ''}`
}

function isWeakMetadataTitle(title, fileName = '') {
  const cleanedTitle = cleanMetadataText(title)
  const cleanedFile = cleanMetadataText(fileName).replace(/\.pdf$/i, '')
  if (!cleanedTitle) return true
  if (cleanedFile && cleanedTitle.toLowerCase() === cleanedFile.toLowerCase()) return true
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(cleanedTitle)) return true
  if (/^arxiv[:\s-]*\d{4}\.\d{4,5}(v\d+)?$/i.test(cleanedTitle)) return true
  return false
}

function isFrontMatterNoise(line) {
  return (
    /^arxiv:/i.test(line)
    || /^\d{4}\.\d{4,5}(v\d+)?\b/i.test(line)
    || /^doi\b/i.test(line)
    || /^https?:\/\//i.test(line)
    || /^submitted\b/i.test(line)
    || /^published\b/i.test(line)
    || /^preprint\b/i.test(line)
    || /^copyright\b/i.test(line)
    || /^\d+$/.test(line)
  )
}

function isLikelyAffiliationLine(line) {
  return /\b(university|institute|department|school|college|laboratory|lab|academy|google|microsoft|facebook|meta|openai|research|@)\b/i.test(line)
}

function isLikelyAuthorLine(line) {
  if (!line || isLikelyAffiliationLine(line)) return false
  const separators = (line.match(/[,;]/g) || []).length
  const hasAnd = /\band\b/i.test(line)
  const capitalizedWords = line.match(/\b[A-Z][A-Za-z.'-]{1,}\b/g) || []
  const titleVocabulary = /\b(algorithm|analysis|approach|based|benchmark|dataset|detection|estimation|framework|learning|method|model|neural|network|networks|recognition|survey|system|towards?|using|with|via|for|of)\b/i
  if (capitalizedWords.length < 2 || line.length > 160) return false
  if (separators > 0 || hasAnd) return true
  return capitalizedWords.length <= 6 && !/[.!?]$/.test(line) && !titleVocabulary.test(line)
}

function extractAbstractFromLines(lines, abstractIndex) {
  if (abstractIndex < 0) return ''
  const chunks = []
  const first = lines[abstractIndex].replace(/^abstract[\s.:-]*/i, '').trim()
  if (first) chunks.push(first)
  for (let index = abstractIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^(keywords|index terms|ccs concepts)\b/i.test(line)) break
    if (/^(\d+\.?\s*)?(introduction|1\s+introduction)\b/i.test(line)) break
    chunks.push(line)
    if (chunks.join(' ').length > 1200) break
  }
  return cleanMetadataText(chunks.join(' ')).slice(0, 1200)
}

function extractKeywordsFromLines(lines) {
  const index = lines.findIndex((line) => /^(keywords|index terms)\b/i.test(line))
  if (index < 0) return ''
  const first = lines[index].replace(/^(keywords|index terms)[\s.:-]*/i, '').trim()
  const next = lines[index + 1] && !/^(abstract|introduction)\b/i.test(lines[index + 1])
    ? lines[index + 1]
    : ''
  return cleanMetadataText([first, next].filter(Boolean).join(' ')).slice(0, 400)
}

function extractFrontMatterHints(firstPagesText, info, file) {
  const rawText = [firstPagesText, info.Title, info.Subject, info.Keywords, file.name].filter(Boolean).join('\n')
  const lines = firstPagesText
    .split(/\n+/)
    .map(cleanMetadataText)
    .filter(Boolean)
  const abstractIndex = lines.findIndex((line) => /^abstract\b/i.test(line))
  const arxivId = findArxivId(rawText)
  const arxivCategory = rawText.match(/\[([a-z-]+\.[A-Z]{2}(?:\.[A-Z]{2})?)\]/)?.[1] || ''
  const frontMatter = lines
    .slice(0, abstractIndex >= 0 ? abstractIndex : Math.min(lines.length, 18))
    .filter((line) => !isFrontMatterNoise(line))

  let title = ''
  let titleEndIndex = -1
  for (let index = 0; index < frontMatter.length; index += 1) {
    const line = frontMatter[index]
    if (title && isLikelyAuthorLine(line)) break
    if (title && isLikelyAffiliationLine(line)) break
    title = [title, line].filter(Boolean).join(' ')
    titleEndIndex = index
    if (title.length > 24 && /[.!?]$/.test(line)) break
    if (title.length > 160) break
  }

  const authorLines = []
  for (let index = titleEndIndex + 1; index < frontMatter.length; index += 1) {
    const line = frontMatter[index]
    if (isLikelyAffiliationLine(line)) break
    if (isLikelyAuthorLine(line)) {
      authorLines.push(line)
      if (authorLines.length >= 3) break
    } else if (authorLines.length > 0) {
      break
    }
  }

  return {
    title: cleanMetadataText(title).slice(0, 300),
    author: cleanMetadataText(authorLines.join('; ')).slice(0, 500),
    subject: extractAbstractFromLines(lines, abstractIndex),
    keywords: extractKeywordsFromLines(lines) || arxivCategory,
    doi: findDoi(rawText),
    arxivId,
  }
}

async function fetchCrossrefMetadata(doi) {
  try {
    const response = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      { headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return null
    const data = await response.json()
    const msg = data?.message
    if (!msg) return null

    return {
      title: msg.title?.[0] || '',
      author:
        msg.author
          ?.map((a) => [a.given, a.family].filter(Boolean).join(' '))
          .filter(Boolean)
          .join('; ') || '',
      subject: msg['container-title']?.[0] || '',
      keywords: Array.isArray(msg.subject) ? msg.subject.join('; ') : '',
    }
  } catch {
    return null
  }
}

const RECENT_STORAGE_KEY = 'xk_read_recent'

function getStoredRecentReadings() {
  try {
    const stored = localStorage.getItem(RECENT_STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function addRecentReadingToStorage(paper) {
  const readings = getStoredRecentReadings()
  const existing = readings.findIndex((r) => r.paperId === paper.id)
  if (existing !== -1) readings.splice(existing, 1)
  readings.unshift({
    paperId: paper.id,
    title: paper.metadata?.title || paper.fileName?.replace(/\.pdf$/i, '') || '',
    fileName: paper.fileName || '',
    folderName: paper.folderName || '',
    author: paper.metadata?.author || '',
    openedAt: Date.now(),
  })
  if (readings.length > 50) readings.length = 50
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(readings))
  return readings
}

function createFileFingerprint(file) {
  return [file.name, file.size, file.lastModified].join(':')
}

function createPaperId() {
  return `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createReadingSession(now = Date.now()) {
  return {
    recordId: null,
    lastResumedAt: now,
    accumulatedMs: 0,
    running: true,
  }
}

function createEmptyPaperState(file, paperId, folderId, extra = {}) {
  const now = Date.now()

  return {
    id: paperId,
    fingerprint: createFileFingerprint(file),
    fileName: file.name,
    folderId,
    openedAt: now,
    lastViewedAt: now,
    pdfDocument: null,
    pageNumber: 1,
    totalPages: 0,
    scale: DEFAULT_SCALE,
    isLoading: true,
    error: '',
    pageMetrics: [],
    metadata: {
      ...EMPTY_METADATA,
      title: file.name.replace(/\.pdf$/i, ''),
      fileSize: formatFileSize(file.size),
    },
    ...extra,
  }
}

function createEmptyPaperFromServer(serverPaper) {
  const now = Date.now()
  const serverFileUrl = getPaperFileUrl(serverPaper.id)
  const restoredSession = readReadingSessionSnapshot(String(serverPaper.id), undefined, {
    totalPages: serverPaper.page_count || 0,
  })

  return {
    id: String(serverPaper.id),
    fingerprint: '',
    fileName: serverPaper.file_name,
    folderId: String(serverPaper.folder_id),
    openedAt: now,
    lastViewedAt: serverPaper.last_viewed_at
      ? Date.parse(serverPaper.last_viewed_at)
      : now,
    pdfDocument: null,
    pageNumber: restoredSession?.pageNumber || 1,
    totalPages: serverPaper.page_count || 0,
    scale: restoredSession?.scale || DEFAULT_SCALE,
    isLoading: false,
    error: '',
    pageMetrics: [],
    metadata: {
      title: serverPaper.title || serverPaper.file_name.replace(/\.pdf$/i, ''),
      translatedTitle: serverPaper.translated_title || '',
      author: serverPaper.author || '',
      subject: serverPaper.subject || '',
      keywords: serverPaper.keywords || '',
      creator: serverPaper.creator || '',
      producer: serverPaper.producer || '',
      creationDate: serverPaper.creation_date || '',
      modificationDate: serverPaper.modification_date || '',
      doi: serverPaper.doi || '',
      arxivId: serverPaper.arxiv_id || '',
      fileSize: serverPaper.file_size,
      pageCount: serverPaper.page_count,
    },
    _serverFileUrl: serverFileUrl,
  }
}

function buildMetadataFromServerPaper(serverPaper, fallback = {}) {
  return {
    ...EMPTY_METADATA,
    ...fallback,
    title: serverPaper.title || fallback.title || serverPaper.file_name?.replace(/\.pdf$/i, '') || '',
    translatedTitle: serverPaper.translated_title || fallback.translatedTitle || '',
    author: serverPaper.author || '',
    subject: serverPaper.subject || '',
    keywords: serverPaper.keywords || '',
    creator: serverPaper.creator || fallback.creator || '',
    producer: serverPaper.producer || fallback.producer || '',
    creationDate: serverPaper.creation_date || fallback.creationDate || '',
    modificationDate: serverPaper.modification_date || fallback.modificationDate || '',
    doi: serverPaper.doi || '',
    arxivId: serverPaper.arxiv_id || fallback.arxivId || '',
    fileSize: serverPaper.file_size || fallback.fileSize || '',
    pageCount: serverPaper.page_count || fallback.pageCount || 0,
  }
}

function normalizeTrashPaper(serverPaper) {
  return {
    id: String(serverPaper.id),
    fileName: serverPaper.file_name,
    folderId: String(serverPaper.folder_id),
    folderName: serverPaper.folder_name || '未分类',
    title: serverPaper.title || serverPaper.file_name?.replace(/\.pdf$/i, '') || '',
    author: serverPaper.author || '',
    fileSize: serverPaper.file_size || '',
    pageCount: serverPaper.page_count || 0,
    deletedAt: serverPaper.deleted_at ? Date.parse(serverPaper.deleted_at) : Date.now(),
    expiresAt: serverPaper.expires_at ? Date.parse(serverPaper.expires_at) : Date.now() + 7 * 24 * 60 * 60 * 1000,
  }
}

function buildTextLines(textContent) {
  const positionedItems = (textContent?.items || [])
    .map((item) => ({
      text: cleanMetadataText(item?.str),
      x: Number(item?.transform?.[4] || 0),
      y: Number(item?.transform?.[5] || 0),
    }))
    .filter((item) => item.text)
    .sort((left, right) => {
      if (Math.abs(right.y - left.y) > 3) return right.y - left.y
      return left.x - right.x
    })

  const lines = []
  for (const item of positionedItems) {
    const current = lines[lines.length - 1]
    if (!current || Math.abs(current.y - item.y) > 3) {
      lines.push({ y: item.y, items: [item] })
    } else {
      current.items.push(item)
    }
  }

  return lines
    .map((line) => line.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' '))
    .map(cleanMetadataText)
    .filter(Boolean)
}

async function extractFirstPagesText(documentProxy, maxPages = 5) {
  const pageCount = Math.min(documentProxy.numPages, maxPages)
  const chunks = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber)
    const textContent = await page.getTextContent()
    chunks.push(buildTextLines(textContent).join('\n'))
  }

  return chunks.join('\n')
}

async function extractFullText(documentProxy, maxPages = 80, maxChars = 50000) {
  const pageCount = Math.min(documentProxy.numPages, maxPages)
  const chunks = []
  let totalChars = 0
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const text = textContent.items.map((item) => item.str || '').join(' ')
    const cleanText = text.trim()
    if (cleanText) {
      chunks.push(`[第 ${pageNumber} 页]\n${cleanText}`)
      totalChars += text.length
      if (totalChars >= maxChars) {
        break
      }
    }
  }
  return chunks.join('\n')
}

async function extractPaperMetadata(documentProxy, file) {
  const metadataResult = await documentProxy.getMetadata().catch(() => null)
  const info = metadataResult?.info ?? {}
  const firstPagesText = await extractFirstPagesText(documentProxy).catch(() => '')
  const hints = extractFrontMatterHints(firstPagesText, info, file)
  const titleFromMetadata = cleanMetadataText(info.Title)
  const fileTitle = file.name.replace(/\.pdf$/i, '')
  const title = isWeakMetadataTitle(titleFromMetadata, file.name)
    ? hints.title || titleFromMetadata || fileTitle
    : titleFromMetadata

  return {
    title,
    author: cleanMetadataText(info.Author) || hints.author,
    subject: cleanMetadataText(info.Subject) || hints.subject,
    keywords: cleanMetadataText(info.Keywords) || hints.keywords,
    creator: cleanMetadataText(info.Creator),
    producer: cleanMetadataText(info.Producer),
    creationDate: normalizePdfDate(info.CreationDate),
    modificationDate: normalizePdfDate(info.ModDate),
    doi: hints.doi,
    arxivId: hints.arxivId,
    fileSize: formatFileSize(file.size),
    pageCount: documentProxy.numPages,
  }
}

async function extractPageMetrics(documentProxy) {
  const metrics = []

  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    metrics.push({
      width: viewport.width,
      height: viewport.height,
    })
  }

  return metrics
}

function destroyPaperResources(resource) {
  resource?.loadingTask?.destroy?.()
  resource?.documentProxy?.destroy?.()

  if (resource?.objectUrl) {
    URL.revokeObjectURL(resource.objectUrl)
  }
}

function getNow() {
  return Date.now()
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error) {
    return error
  }
  return '未知错误'
}

export function usePdfReader({ currentUser } = {}) {
  const fileInputRef = useRef(null)
  const importFolderIdRef = useRef('')
  const shouldActivateImportedPaperRef = useRef(true)
  const paperResourcesRef = useRef(new Map())
  const summaryMapRef = useRef(new Map())
  const summaryIdleHandlesRef = useRef(new Map())
  const fullTextMapRef = useRef(new Map())
  const uncategorizedFolderIdRef = useRef('')
  const lastSyncUserRef = useRef(null)
  const readingSessionsRef = useRef(new Map())
  const openTabIdsRef = useRef([])
  const [activeView, setActiveView] = useState('home')
  const [papers, setPapers] = useState([])
  const [folders, setFolders] = useState([])
  const [trashPapers, setTrashPapers] = useState([])
  const [openTabIds, setOpenTabIdsState] = useState([])
  const [uncategorizedFolderId, setUncategorizedFolderId] = useState('')
  const [recentReadings, setRecentReadings] = useState(getStoredRecentReadings())
  const [importConflict, setImportConflict] = useState(null)
  const [readingStats, setReadingStats] = useState(null)
  const [readingDurationVersion, setReadingDurationVersion] = useState(0)
  const [paperSummaries, setPaperSummaries] = useState({})
  const [paperFullTexts, setPaperFullTexts] = useState({})

  function setOpenTabIds(nextOpenTabIds) {
    const nextIds = typeof nextOpenTabIds === 'function'
      ? nextOpenTabIds(openTabIdsRef.current)
      : nextOpenTabIds
    openTabIdsRef.current = nextIds
    setOpenTabIdsState(nextIds)
  }

  useEffect(() => {
    openTabIdsRef.current = openTabIds
  }, [openTabIds])

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(
    () => () => {
      paperResourcesRef.current.forEach((resource) => {
        destroyPaperResources(resource)
      })
      paperResourcesRef.current.clear()
      summaryIdleHandlesRef.current.forEach((handle) => {
        if (handle.type === 'idle') {
          window.cancelIdleCallback?.(handle.id)
        } else {
          window.clearTimeout(handle.id)
        }
      })
      summaryIdleHandlesRef.current.clear()
    },
    [],
  )

  // ── Sync with backend ──────────────────────────────────

  const syncFromBackend = useCallback(async () => {
    const token = getStoredAuthToken()
    if (!token) return

    try {
      const [serverFolders, serverPapers, serverTrash] = await Promise.all([
        fetchFolders(),
        fetchPapers(),
        fetchTrashPapers(),
      ])

      const allFolders = serverFolders.map((f) => ({
        id: String(f.id),
        name: f.name,
        createdAt: f.created_at ? Date.parse(f.created_at) : Date.now(),
      }))

      const localPapers = serverPapers.map((p) =>
        createEmptyPaperFromServer(p),
      )

      // "未分类" is rendered as a hardcoded button in HomePage, so keep its
      // server ID in the ref but exclude it from the folders list to avoid duplication.
      const uncategorized = allFolders.find((f) => f.name === '未分类')
      if (uncategorized) {
        uncategorizedFolderIdRef.current = uncategorized.id
        setUncategorizedFolderId(uncategorized.id)
      }
      const userFolders = allFolders.filter((f) => f.name !== '未分类')

      setFolders(userFolders)
      setPapers(localPapers)
      setTrashPapers(serverTrash.map(normalizeTrashPaper))
      summaryMapRef.current.clear()
      fullTextMapRef.current.clear()
      setPaperSummaries({})
      setPaperFullTexts({})
      // Close tabs that came from previous session
      setOpenTabIds([])
      setActiveView('home')

      // ── Sync reading records ──
      const localReadings = getStoredRecentReadings()
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

      // Upload local records to server (only within 30 days)
      const uploadableByKey = new Map()
      localReadings
        .filter((r) => r.openedAt > thirtyDaysAgo)
        .forEach((r) => {
          const paperId = Number(r.paperId)
          const openedAt = Number(r.openedAt)
          if (Number.isNaN(paperId) || Number.isNaN(openedAt)) return
          const key = `${paperId}_${Math.round(openedAt / 2000)}`
          if (!uploadableByKey.has(key)) {
            uploadableByKey.set(key, {
              paper_id: paperId,
              opened_at: new Date(openedAt).toISOString(),
            })
          }
        })
      const uploadable = [...uploadableByKey.values()]

      if (uploadable.length > 0) {
        await syncReadingRecords(uploadable).catch(() => null)
      }

      // Pull server stats + records
      try {
        const statsData = await fetchReadingStats()
        setReadingStats(statsData)

        // Merge server records into localStorage
        const mergedMap = new Map()
        const allLocalFolders = [...userFolders, uncategorized]
        const folderById = new Map(allLocalFolders.map((f) => [String(f.id), f]))

        // Add server records
        ;(statsData.recent_records || []).forEach((r) => {
          const key = `${r.paper_id}_${r.opened_at}`
          const paper = localPapers.find((p) => String(p.id) === String(r.paper_id))
          mergedMap.set(key, {
            paperId: String(r.paper_id),
            title: r.title || (paper ? paper.fileName.replace(/\.pdf$/i, '') : ''),
            fileName: r.file_name || (paper ? paper.fileName : ''),
            folderName: r.folder_name || (paper ? folderById.get(String(paper.folderId))?.name : '') || '未分类',
            author: r.author || (paper?.metadata?.author || ''),
            openedAt: Date.parse(r.opened_at),
          })
        })

        // Add localStorage entries (deduped by key)
        localReadings.forEach((r) => {
          const key = `${r.paperId}_${r.openedAt}`
          if (!mergedMap.has(key)) {
            mergedMap.set(key, r)
          }
        })

        const mergedList = [...mergedMap.values()]
          .filter((r) => r.openedAt > thirtyDaysAgo)
          .sort((a, b) => b.openedAt - a.openedAt)
          .slice(0, 50)

        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(mergedList))
        setRecentReadings(mergedList)
      } catch {
        // stats fetch failed — keep localStorage state
      }
    } catch (error) {
      console.error('syncFromBackend failed:', error)
    }
  }, [])

  // Sync when user logs in or changes
  useEffect(() => {
    if (!currentUser) {
      // Logged out — reset to empty in-memory state
      if (lastSyncUserRef.current) {
        setFolders([])
        setPapers([])
        setTrashPapers([])
        setOpenTabIds([])
        setActiveView('home')
        setUncategorizedFolderId('')
        summaryMapRef.current.clear()
        fullTextMapRef.current.clear()
        setPaperSummaries({})
        setPaperFullTexts({})
        uncategorizedFolderIdRef.current = ''
        paperResourcesRef.current.forEach((resource) => {
          destroyPaperResources(resource)
        })
        paperResourcesRef.current.clear()
      }
      lastSyncUserRef.current = null
      return
    }

    if (lastSyncUserRef.current === currentUser.uid) return
    lastSyncUserRef.current = currentUser.uid
    syncFromBackend()
  }, [currentUser, syncFromBackend])

  // ── Derived state ──────────────────────────────────────

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  )

  const paperMap = useMemo(
    () => new Map(papers.map((paper) => [paper.id, paper])),
    [papers],
  )

  const openTabs = useMemo(
    () => openTabIds.map((id) => paperMap.get(id)).filter(Boolean),
    [openTabIds, paperMap],
  )

  const importStatus = useMemo(
    () => buildImportProgress(papers.filter((paper) => paper.isLoading)),
    [papers],
  )
  const isImporting = importStatus.isImporting

  const activePaper = activeView === 'home' ? null : paperMap.get(activeView) ?? null

  const recentPapers = useMemo(
    () =>
      [...papers]
        .sort((left, right) => right.lastViewedAt - left.lastViewedAt)
        .map((paper) => ({
          id: paper.id,
          fileName: paper.fileName,
          folderId: paper.folderId,
          folderName: folderMap.get(paper.folderId)?.name ?? '未分类',
          title: paper.metadata.title || paper.fileName.replace(/\.pdf$/i, ''),
          metadata: paper.metadata,
          openedAt: paper.openedAt,
          lastViewedAt: paper.lastViewedAt,
          isOpen: openTabIds.includes(paper.id),
        })),
    [folderMap, openTabIds, papers],
  )

  const pageNumbers = useMemo(
    () => Array.from(
      { length: activePaper?.totalPages ?? 0 },
      (_, index) => index + 1,
    ),
    [activePaper?.totalPages],
  )

  // ── Helpers ────────────────────────────────────────────

  function updatePaper(paperId, updater) {
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.id === paperId ? { ...paper, ...updater(paper) } : paper,
      ),
    )
  }

  function persistReadingSessionView(paperId, patch = {}) {
    if (!paperId) return
    saveReadingSessionSnapshot(String(paperId), patch)
  }

  function setPaperSummary(paperId, summary) {
    summaryMapRef.current.set(paperId, summary)
    setPaperSummaries((current) => (
      current[paperId] === summary
        ? current
        : {
            ...current,
            [paperId]: summary,
          }
    ))
  }

  function setPaperFullText(paperId, fullText) {
    fullTextMapRef.current.set(paperId, fullText)
    setPaperFullTexts((current) => (
      current[paperId] === fullText
        ? current
        : {
            ...current,
            [paperId]: fullText,
          }
    ))
  }

  function clearPaperDerivedContent(paperId) {
    clearScheduledSummarization(paperId)
    summaryMapRef.current.delete(paperId)
    fullTextMapRef.current.delete(paperId)
    setPaperSummaries((current) => {
      if (!(paperId in current)) return current
      const next = { ...current }
      delete next[paperId]
      return next
    })
    setPaperFullTexts((current) => {
      if (!(paperId in current)) return current
      const next = { ...current }
      delete next[paperId]
      return next
    })
  }

  function clearScheduledSummarization(paperId) {
    const handle = summaryIdleHandlesRef.current.get(paperId)
    if (!handle) return
    summaryIdleHandlesRef.current.delete(paperId)
    if (handle.type === 'idle') {
      window.cancelIdleCallback?.(handle.id)
    } else {
      window.clearTimeout(handle.id)
    }
  }

  function flushReadingDuration(paperId, options = {}) {
    const { finalize = true } = options
    if (!getStoredAuthToken()) return
    const session = readingSessionsRef.current.get(paperId)
    if (!session) return
    const totalMs = session.accumulatedMs + (session.running ? Math.max(0, getNow() - session.lastResumedAt) : 0)
    const durationSeconds = Math.floor(totalMs / 1000)
    if (durationSeconds < 15) {
      if (finalize) {
        readingSessionsRef.current.delete(paperId)
      }
      return
    }
    if (!session.recordId) {
      if (finalize) {
        readingSessionsRef.current.delete(paperId)
      }
      return
    }
    updateReadingDuration(session.recordId, durationSeconds)
      .then(() => {
        setReadingDurationVersion((current) => current + 1)
      })
      .catch(() => {})
    if (finalize) {
      readingSessionsRef.current.delete(paperId)
    } else {
      session.accumulatedMs = totalMs
      session.running = false
    }
  }

  function pauseReadingSession(paperId) {
    const session = readingSessionsRef.current.get(paperId)
    if (!session || !session.running) return
    session.accumulatedMs += Math.max(0, getNow() - session.lastResumedAt)
    session.running = false
    flushReadingDuration(paperId, { finalize: false })
  }

  function resumeReadingSession(paperId) {
    const existing = readingSessionsRef.current.get(paperId)
    if (existing) {
      if (!existing.running) {
        existing.lastResumedAt = getNow()
        existing.running = true
      }
      return
    }
    readingSessionsRef.current.set(paperId, createReadingSession())
  }

  useEffect(() => {
    function handleBeforeUnload() {
      if (activeView !== 'home') {
        flushReadingDuration(activeView, { finalize: true })
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeView])

  function replacePaperId(oldId, newId) {
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.id === oldId ? { ...paper, id: newId } : paper,
      ),
    )
    setOpenTabIds((currentIds) =>
      currentIds.map((id) => (id === oldId ? newId : id)),
    )
    setActiveView((currentView) =>
      currentView === oldId ? newId : currentView,
    )
    // Update localStorage recent readings
    setRecentReadings((current) => {
      const updated = current.map((r) =>
        r.paperId === oldId ? { ...r, paperId: newId } : r,
      )
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
    // Migrate resources map
    const resource = paperResourcesRef.current.get(oldId)
    if (resource) {
      paperResourcesRef.current.delete(oldId)
      paperResourcesRef.current.set(newId, resource)
    }
    const summaryHandle = summaryIdleHandlesRef.current.get(oldId)
    if (summaryHandle) {
      summaryIdleHandlesRef.current.delete(oldId)
      summaryIdleHandlesRef.current.set(newId, summaryHandle)
    }
    if (summaryMapRef.current.has(oldId)) {
      const summary = summaryMapRef.current.get(oldId) ?? ''
      summaryMapRef.current.delete(oldId)
      setPaperSummaries((current) => {
        if (!(oldId in current)) return current
        const next = { ...current }
        delete next[oldId]
        return next
      })
      setPaperSummary(newId, summary)
    }
    if (fullTextMapRef.current.has(oldId)) {
      const fullText = fullTextMapRef.current.get(oldId) ?? ''
      fullTextMapRef.current.delete(oldId)
      setPaperFullTexts((current) => {
        if (!(oldId in current)) return current
        const next = { ...current }
        delete next[oldId]
        return next
      })
      setPaperFullText(newId, fullText)
    }
  }

  async function refreshTrashPapers() {
    if (!getStoredAuthToken()) return []
    try {
      const serverTrash = await fetchTrashPapers()
      const normalized = serverTrash.map(normalizeTrashPaper)
      setTrashPapers(normalized)
      return normalized
    } catch {
      return []
    }
  }

  // ── Paper actions ──────────────────────────────────────

  function activatePaper(paperId) {
    const paper = paperMap.get(paperId)
    if (!paper) return
    if (activeView !== 'home' && activeView !== paperId) {
      pauseReadingSession(activeView)
    }

    const isAlreadyOpen = openTabIdsRef.current.includes(paperId)
    if (!isAlreadyOpen) {
      openTabIdsRef.current = [...openTabIdsRef.current, paperId]
    }

    setOpenTabIds((currentIds) =>
      currentIds.includes(paperId) ? currentIds : [...currentIds, paperId],
    )
    setPapers((currentPapers) =>
      currentPapers.map((p) =>
        p.id === paperId
          ? { ...p, lastViewedAt: Date.now() }
          : p,
      ),
    )
    setActiveView(paperId)

    // Write to localStorage recent readings
    const folderName = folderMap.get(paper.folderId)?.name || '未分类'
    const readings = addRecentReadingToStorage({ ...paper, folderName })
    setRecentReadings(readings)

    // Sync to backend
    if (getStoredAuthToken()) {
      const serverId = Number(paperId)
      if (!Number.isNaN(serverId)) {
        apiUpdatePaper(serverId, { last_viewed_at: true }).catch(() => {})
        // Only record a new reading event if not already open in tabs
        if (!isAlreadyOpen) {
          const openedAt = getNow()
          recordReadingEvent(serverId, openedAt)
            .then((record) => {
              const session = readingSessionsRef.current.get(paperId) || createReadingSession()
              session.recordId = record?.id ?? null
              session.lastResumedAt = openedAt
              session.running = true
              readingSessionsRef.current.set(paperId, session)
              return fetchReadingStats()
            })
            .then((stats) => { if (stats) setReadingStats(stats) })
            .catch(() => {})
        }
      }
    }

    resumeReadingSession(paperId)

    // Lazy-load PDF from server if not yet loaded
    if (!paper.pdfDocument && !paper.isLoading && paper._serverFileUrl) {
      const resource = paperResourcesRef.current.get(paperId)
      if (resource?.loadingTask) return // already loading

      loadPdfFromUrl(paperId, paper._serverFileUrl)
    }
  }


  async function triggerSummarization(paperId, documentProxy) {
    if (summaryMapRef.current.has(paperId)) return
    try {
      const fullText = await extractFullText(documentProxy)
      if (!fullText || fullText.length < 100) return
      setPaperFullText(paperId, fullText)
      const truncated = fullText.slice(0, 40000)
      const { providers } = await fetchAiProviders()
      const provider = providers?.find(p => p.is_active)
      if (!provider) return
      const data = await fetchPaperSummary(truncated, provider.id)
      if (data?.summary) {
        setPaperSummary(paperId, data.summary)
      }
    } catch { /* silent */ }
  }

  function scheduleSummarization(paperId, documentProxy) {
    if (!documentProxy || summaryMapRef.current.has(paperId) || summaryIdleHandlesRef.current.has(paperId)) {
      return
    }

    const run = () => {
      summaryIdleHandlesRef.current.delete(paperId)
      triggerSummarization(paperId, documentProxy)
    }

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 4000 })
      summaryIdleHandlesRef.current.set(paperId, { type: 'idle', id })
      return
    }

    const id = window.setTimeout(run, 1200)
    summaryIdleHandlesRef.current.set(paperId, { type: 'timeout', id })
  }

  function buildPaperMetadataUpdate(metadata, options = {}) {
    const includeEmpty = Boolean(options.includeEmpty)
    const payload = {}
    const assignText = (key, value) => {
      const text = cleanMetadataText(value)
      if (includeEmpty || text) payload[key] = text
    }
    assignText('title', metadata.title)
    assignText('author', metadata.author)
    assignText('subject', metadata.subject)
    assignText('keywords', metadata.keywords)
    assignText('doi', metadata.doi)
    assignText('arxiv_id', metadata.arxivId)
    if (metadata.pageCount) payload.page_count = metadata.pageCount
    return payload
  }

  async function savePaperMetadata(paperId, nextMetadata = {}) {
    const localPaperId = String(paperId || activePaper?.id || '')
    if (!localPaperId) {
      throw new Error('当前没有可保存的文献。')
    }

    const currentPaper = papers.find((paper) => paper.id === localPaperId) || activePaper
    const mergedMetadata = {
      ...(currentPaper?.metadata || EMPTY_METADATA),
      ...nextMetadata,
      title: cleanMetadataText(nextMetadata.title ?? currentPaper?.metadata?.title),
      author: cleanMetadataText(nextMetadata.author ?? currentPaper?.metadata?.author),
      subject: cleanMetadataText(nextMetadata.subject ?? currentPaper?.metadata?.subject),
      keywords: cleanMetadataText(nextMetadata.keywords ?? currentPaper?.metadata?.keywords),
      doi: cleanMetadataText(nextMetadata.doi ?? currentPaper?.metadata?.doi),
      arxivId: cleanMetadataText(nextMetadata.arxivId ?? currentPaper?.metadata?.arxivId),
    }

    const serverPaperId = Number(localPaperId)
    if (!getStoredAuthToken() || Number.isNaN(serverPaperId)) {
      updatePaper(localPaperId, (paper) => ({
        metadata: { ...paper.metadata, ...mergedMetadata },
      }))
      return { ok: true, metadata: mergedMetadata }
    }

    const serverPaper = await apiUpdatePaper(
      serverPaperId,
      buildPaperMetadataUpdate(mergedMetadata, { includeEmpty: true }),
    )
    const serverMetadata = buildMetadataFromServerPaper(serverPaper, mergedMetadata)
    updatePaper(localPaperId, (paper) => ({
      fileName: serverPaper.file_name || paper.fileName,
      folderId: serverPaper.folder_id ? String(serverPaper.folder_id) : paper.folderId,
      totalPages: serverPaper.page_count || paper.totalPages,
      metadata: { ...paper.metadata, ...serverMetadata },
    }))
    return { ok: true, metadata: serverMetadata }
  }

  async function refreshPaperMetadata(paperId) {
    const localPaperId = String(paperId || activePaper?.id || '')
    if (!localPaperId) {
      throw new Error('当前没有可重新识别的文献。')
    }
    const serverPaperId = Number(localPaperId)
    if (!getStoredAuthToken() || Number.isNaN(serverPaperId)) {
      throw new Error('请登录后再重新识别元数据。')
    }

    const serverPaper = await apiRefreshPaperMetadata(serverPaperId)
    const currentPaper = papers.find((paper) => paper.id === localPaperId) || activePaper
    const serverMetadata = buildMetadataFromServerPaper(serverPaper, currentPaper?.metadata || EMPTY_METADATA)
    updatePaper(localPaperId, (paper) => ({
      fileName: serverPaper.file_name || paper.fileName,
      folderId: serverPaper.folder_id ? String(serverPaper.folder_id) : paper.folderId,
      totalPages: serverPaper.page_count || paper.totalPages,
      metadata: { ...paper.metadata, ...serverMetadata },
    }))
    return { ok: true, metadata: serverMetadata }
  }

  async function loadPdfFromUrl(paperId, url) {
    updatePaper(paperId, () => ({ isLoading: true, error: '' }))

    try {
      const token = getStoredAuthToken()
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await fetch(url, { headers: authHeaders })
      if (!response.ok) {
        throw new Error(`PDF request failed with ${response.status}`)
      }
      const pdfData = await response.arrayBuffer()
      let loadingTask = await createPdfLoadingTask({ data: pdfData.slice(0) })

      const resource = paperResourcesRef.current.get(paperId)
      if (!resource) {
        paperResourcesRef.current.set(paperId, {
          objectUrl: null,
          loadingTask,
          documentProxy: null,
        })
      } else {
        resource.loadingTask = loadingTask
      }

      let documentProxy
      try {
        documentProxy = await loadingTask.promise
      } catch (dataError) {
        console.error('Failed to parse server PDF bytes, retrying with URL', {
          paperId,
          url,
          error: dataError,
        })
        loadingTask.destroy?.()
        loadingTask = await createPdfLoadingTask({
          url,
          httpHeaders: authHeaders,
          withCredentials: false,
        })
        const retryResource = paperResourcesRef.current.get(paperId)
        if (retryResource) {
          retryResource.loadingTask = loadingTask
        }
        documentProxy = await loadingTask.promise
      }
      const currentResource = paperResourcesRef.current.get(paperId)
      if (currentResource) {
        currentResource.documentProxy = documentProxy
      }

      const [pdfMeta, pageMetrics] = await Promise.all([
        extractPaperMetadata(documentProxy, { name: '' }),
        extractPageMetrics(documentProxy),
      ]).catch(() => [null, []])

      let metadata = pdfMeta
      if (pdfMeta && pdfMeta.doi) {
        const cr = await fetchCrossrefMetadata(pdfMeta.doi)
        if (cr) {
          metadata = {
            ...pdfMeta,
            title: cr.title || pdfMeta.title,
            author: cr.author || pdfMeta.author,
            subject: pdfMeta.subject || cr.subject,
            keywords: pdfMeta.keywords || cr.keywords || '',
          }
          const sid = Number(paperId)
          if (!Number.isNaN(sid)) {
            apiUpdatePaper(sid, { author: metadata.author, subject: metadata.subject || undefined }).catch(function(){})
          }
        }
      }

      updatePaper(paperId, (paper) => {
        const restoredSession = readReadingSessionSnapshot(String(paperId), undefined, {
          totalPages: documentProxy.numPages,
        })
        return {
          isLoading: false,
          error: '',
          pdfDocument: documentProxy,
          pageNumber: restoredSession?.pageNumber || Math.min(paper.pageNumber || 1, documentProxy.numPages),
          scale: restoredSession?.scale || paper.scale || DEFAULT_SCALE,
          totalPages: documentProxy.numPages,
          ...(metadata ? { metadata } : {}),
          ...(pageMetrics.length ? { pageMetrics } : {}),
        }
      })

      const serverPaperId = Number(paperId)
      if (!Number.isNaN(serverPaperId) && documentProxy.numPages > 0) {
        const updatePayload = buildPaperMetadataUpdate(metadata || {})
        apiUpdatePaper(serverPaperId, updatePayload).catch(() => {})
      }

      scheduleSummarization(paperId, documentProxy)
    } catch (error) {
      console.error('Failed to load server PDF', { paperId, url, error })
      updatePaper(paperId, () => ({
        isLoading: false,
        error: `论文加载失败：${getErrorMessage(error)}`,
      }))
    }
  }

  async function persistPaperToServer(paperId, file, targetFolderId, metadata = {}) {
    if (!getStoredAuthToken()) {
      return { paperId, fileUrl: null, serverPaper: null }
    }

    const serverFolderId = Number(targetFolderId) || undefined
    let serverPaper = await uploadPaper(
      file,
      {
        title: metadata.title,
        author: metadata.author || null,
        subject: metadata.subject || null,
        keywords: metadata.keywords || null,
        doi: metadata.doi || null,
        arxiv_id: metadata.arxivId || null,
        page_count: metadata.pageCount,
      },
      serverFolderId,
    )
    if (shouldRefreshImportedMetadata(serverPaper, metadata, file)) {
      const refreshedPaper = await apiRefreshPaperMetadata(serverPaper.id).catch(() => null)
      serverPaper = mergeImportedServerPaper(serverPaper, refreshedPaper)
    }

    const newId = String(serverPaper.id)
    const fileUrl = getPaperFileUrl(serverPaper.id)
    replacePaperId(paperId, newId)
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.id === newId
          ? {
              ...paper,
              fingerprint: createFileFingerprint(file),
              _serverFileUrl: fileUrl,
              metadata: {
                ...paper.metadata,
                ...buildMetadataFromServerPaper(serverPaper, paper.metadata),
              },
            }
          : paper,
      ),
    )

    return { paperId: newId, fileUrl, serverPaper }
  }

  function goHome() {
    if (activeView !== 'home') {
      pauseReadingSession(activeView)
    }
    setActiveView('home')
  }

  function closePaper(paperId) {
    flushReadingDuration(paperId, { finalize: true })
    clearPaperDerivedContent(paperId)
    setOpenTabIds((currentIds) => {
      const closingIndex = currentIds.indexOf(paperId)
      const nextIds = currentIds.filter((id) => id !== paperId)

      setActiveView((currentView) => {
        if (currentView !== paperId) {
          return currentView
        }

        if (nextIds.length === 0) {
          return 'home'
        }

        const fallbackIndex = Math.max(0, closingIndex - 1)
        return nextIds[fallbackIndex] ?? nextIds[0] ?? 'home'
      })

      return nextIds
    })
  }

  function deletePaper(paperId) {
    flushReadingDuration(paperId, { finalize: true })
    clearPaperDerivedContent(paperId)
    removeReadingSessionSnapshot(String(paperId))
    const paper = paperMap.get(paperId)
    if (paper) {
      const deletedAt = getNow()
      setTrashPapers((current) => [
        {
          id: paper.id,
          fileName: paper.fileName,
          folderId: paper.folderId,
          folderName: folderMap.get(paper.folderId)?.name || '未分类',
          title: paper.metadata.title || paper.fileName.replace(/\.pdf$/i, ''),
          author: paper.metadata.author || '',
          fileSize: paper.metadata.fileSize || '',
          pageCount: paper.metadata.pageCount || paper.totalPages || 0,
          deletedAt,
          expiresAt: deletedAt + 7 * 24 * 60 * 60 * 1000,
        },
        ...current.filter((item) => item.id !== paper.id),
      ])
    }
    // Call API first
    if (getStoredAuthToken()) {
      const serverId = Number(paperId)
      if (!Number.isNaN(serverId)) {
        apiDeletePaper(serverId)
          .then(() => refreshTrashPapers())
          .catch(() => refreshTrashPapers())
      }
    }

    const resource = paperResourcesRef.current.get(paperId)
    if (resource) {
      destroyPaperResources(resource)
      paperResourcesRef.current.delete(paperId)
    }

    setOpenTabIds((currentIds) => {
      const closingIndex = currentIds.indexOf(paperId)
      const nextIds = currentIds.filter((id) => id !== paperId)

      setActiveView((currentView) => {
        if (currentView !== paperId) {
          return currentView
        }

        if (nextIds.length === 0) {
          return 'home'
        }

        const fallbackIndex = Math.max(0, closingIndex - 1)
        return nextIds[fallbackIndex] ?? nextIds[0] ?? 'home'
      })

      return nextIds
    })

    setPapers((currentPapers) =>
      currentPapers.filter((paper) => paper.id !== paperId),
    )

    // Also remove from recent readings localStorage
    setRecentReadings((current) => {
      const updated = current.filter((r) => r.paperId !== paperId)
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  async function restorePaperFromTrash(paperId) {
    if (!getStoredAuthToken()) return { ok: false, message: '请先登录' }
    try {
      const serverPaper = await apiRestorePaperFromTrash(Number(paperId))
      const restored = createEmptyPaperFromServer(serverPaper)
      setPapers((current) => {
        const withoutDuplicate = current.filter((paper) => paper.id !== restored.id)
        return [restored, ...withoutDuplicate]
      })
      setTrashPapers((current) => current.filter((paper) => paper.id !== String(paperId)))
      return { ok: true, paper: restored }
    } catch (error) {
      refreshTrashPapers()
      return { ok: false, message: error instanceof Error ? error.message : '恢复失败' }
    }
  }

  async function permanentlyDeletePaper(paperId) {
    if (!getStoredAuthToken()) return { ok: false, message: '请先登录' }
    try {
      await apiPermanentlyDeletePaper(Number(paperId))
      removeReadingSessionSnapshot(String(paperId))
      setTrashPapers((current) => current.filter((paper) => paper.id !== String(paperId)))
      return { ok: true }
    } catch (error) {
      refreshTrashPapers()
      return { ok: false, message: error instanceof Error ? error.message : '彻底删除失败' }
    }
  }

  async function emptyTrash() {
    if (!getStoredAuthToken()) return { ok: false, message: '请先登录' }
    try {
      await apiEmptyTrash()
      trashPapers.forEach((paper) => removeReadingSessionSnapshot(String(paper.id)))
      setTrashPapers([])
      return { ok: true }
    } catch (error) {
      refreshTrashPapers()
      return { ok: false, message: error instanceof Error ? error.message : '清空失败' }
    }
  }

  // ── Folder actions ─────────────────────────────────────

  async function createFolder(folderName) {
    const normalizedName = folderName.trim()
    if (!normalizedName) {
      return { ok: false, message: '文件夹名称不能为空' }
    }

    const duplicateFolder = folders.find(
      (folder) => folder.name.toLowerCase() === normalizedName.toLowerCase(),
    )

    if (duplicateFolder) {
      return { ok: false, message: '已经有同名文件夹了' }
    }

    // Sync to backend if logged in
    if (getStoredAuthToken()) {
      try {
        const serverFolder = await apiCreateFolder(normalizedName)
        const localFolder = {
          id: String(serverFolder.id),
          name: serverFolder.name,
          createdAt: serverFolder.created_at
            ? Date.parse(serverFolder.created_at)
            : Date.now(),
        }
        setFolders((currentFolders) => [...currentFolders, localFolder])
        return { ok: true, folder: localFolder }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : '创建失败' }
      }
    }

    // Offline: in-memory only
    const nextFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      createdAt: Date.now(),
    }

    setFolders((currentFolders) => [...currentFolders, nextFolder])
    return { ok: true, folder: nextFolder }
  }

  async function renameFolder(folderId, newName) {
    const normalizedName = newName.trim()
    if (!normalizedName) {
      return { ok: false, message: '文件夹名称不能为空' }
    }

    const folder = folderMap.get(folderId)
    if (!folder) {
      return { ok: false, message: '文件夹不存在' }
    }

    if (folder.name === '未分类') {
      return { ok: false, message: '未分类文件夹不可重命名' }
    }

    if (getStoredAuthToken()) {
      try {
        const serverId = Number(folderId)
        await apiRenameFolder(serverId, normalizedName)
        setFolders((currentFolders) =>
          currentFolders.map((f) =>
            f.id === folderId ? { ...f, name: normalizedName } : f,
          ),
        )
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : '重命名失败' }
      }
    }

    // Offline
    setFolders((currentFolders) =>
      currentFolders.map((f) =>
        f.id === folderId ? { ...f, name: normalizedName } : f,
      ),
    )
    return { ok: true }
  }

  function deleteFolder(folderId) {
    const folder = folderMap.get(folderId)
    if (folder?.name === '未分类') return

    // Call API first
    if (getStoredAuthToken()) {
      const serverId = Number(folderId)
      if (!Number.isNaN(serverId)) {
        apiDeleteFolder(serverId).catch(() => {})
      }
    }

    setFolders((currentFolders) =>
      currentFolders.filter((f) => f.id !== folderId),
    )
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.folderId === folderId
          ? { ...paper, folderId: uncategorizedFolderIdRef.current || folderId }
          : paper,
      ),
    )
  }

  function assignPaperToFolder(paperId, folderId) {
    updatePaper(paperId, () => ({ folderId }))

    // Sync to backend
    if (getStoredAuthToken()) {
      const serverPaperId = Number(paperId)
      const serverFolderId = Number(folderId)
      if (!Number.isNaN(serverPaperId) && !Number.isNaN(serverFolderId)) {
        apiUpdatePaper(serverPaperId, { folder_id: serverFolderId }).catch(() => {})
      }
    }
  }

  function resolveImportConflict() {
    if (importConflict?.conflictType === 'other_folder') {
      assignPaperToFolder(importConflict.existingPaper.id, importConflict.targetFolderId)
    }
    if (importConflict?.conflictType === 'same_file') {
      const existingPaper = importConflict.existingPaper
      if (existingPaper?.id) {
        if (importConflict.targetFolderId && existingPaper.folderId !== importConflict.targetFolderId) {
          assignPaperToFolder(existingPaper.id, importConflict.targetFolderId)
        }
        activatePaper(existingPaper.id)
      }
    }
    setImportConflict(null)
  }

  function cancelImportConflict() {
    if (importConflict?.conflictType === 'failed_import') {
      discardImportDraft(importConflict.failedPaperId)
    }
    setImportConflict(null)
  }

  function discardImportDraft(paperId) {
    if (!paperId) return

    const resource = paperResourcesRef.current.get(paperId)
    if (resource) {
      destroyPaperResources(resource)
      paperResourcesRef.current.delete(paperId)
    }

    setOpenTabIds((currentIds) => currentIds.filter((id) => id !== paperId))
    setActiveView((currentView) => (currentView === paperId ? 'home' : currentView))
    setPapers((currentPapers) => currentPapers.filter((paper) => paper.id !== paperId))
  }

  function retryImportConflict() {
    if (importConflict?.conflictType !== 'failed_import' || !importConflict.file) {
      return
    }

    const {
      file,
      targetFolderId,
      shouldActivate,
      failedPaperId,
    } = importConflict

    setImportConflict(null)
    discardImportDraft(failedPaperId)
    void loadPdfFile(file, targetFolderId, shouldActivate, { ignorePaperId: failedPaperId })
  }

  // ── File loading ───────────────────────────────────────

  async function loadPdfFile(file, folderId = '', shouldActivate = true, options = {}) {
    const { ignorePaperId = '' } = options
    const targetFolderId = resolveImportTargetFolderId(folderId, uncategorizedFolderIdRef.current)
    const fingerprint = createFileFingerprint(file)
    const existingPaper = papers.find(
      (paper) => paper.id !== ignorePaperId && paper.fingerprint === fingerprint,
    )

    if (existingPaper) {
      setImportConflict(createDuplicateImportConflict({
        fileName: file.name,
        existingPaper,
        sourceFolderName: folderMap.get(existingPaper.folderId)?.name || '未分类',
        targetFolderId,
        shouldActivate,
      }))
      return
    }

    // Check for same-name conflict (different file, same name)
    const sameNamePaper = papers.find(
      (paper) => paper.id !== ignorePaperId && paper.fileName === file.name,
    )
    if (sameNamePaper) {
      if (sameNamePaper.folderId === targetFolderId) {
        setImportConflict({
          conflictType: 'same_folder',
          message: `当前文件夹已有同名文献「${file.name}」，不重复导入。`,
        })
      } else {
        const sourceFolderName = folderMap.get(sameNamePaper.folderId)?.name || '未分类'
        setImportConflict({
          conflictType: 'other_folder',
          file,
          existingPaper: sameNamePaper,
          targetFolderId,
          message: `「${file.name}」已在「${sourceFolderName}」中，是否移入当前文件夹？`,
        })
      }
      return
    }

    const paperId = createPaperId()
    const nextPaper = createEmptyPaperState(file, paperId, targetFolderId)
    setPapers((currentPapers) => [...currentPapers, nextPaper])

    if (shouldActivate) {
      setOpenTabIds((currentIds) => [...currentIds, paperId])
      setActiveView(paperId)
    }

    const objectUrl = URL.createObjectURL(file)
    paperResourcesRef.current.set(paperId, {
      objectUrl,
      loadingTask: null,
      documentProxy: null,
    })

    // ── Step 1: Load PDF locally ──
    try {
      const loadingTask = await createPdfLoadingTask(objectUrl)
      const resource = paperResourcesRef.current.get(paperId)

      if (!resource) {
        loadingTask.destroy()
        return
      }

      resource.loadingTask = loadingTask
      const documentProxy = await loadingTask.promise
      resource.documentProxy = documentProxy

      const [pdfMetadata, pageMetrics] = await Promise.all([
        extractPaperMetadata(documentProxy, file),
        extractPageMetrics(documentProxy),
      ])

      // ── Step 2: If DOI found → Crossref for richer metadata ──
      let metadata = pdfMetadata
      if (pdfMetadata.doi) {
        const crossrefData = await fetchCrossrefMetadata(pdfMetadata.doi)
        if (crossrefData) {
          metadata = {
            ...metadata,
            title: crossrefData.title || metadata.title,
            author: crossrefData.author || metadata.author,
            subject: metadata.subject || crossrefData.subject,
            keywords: metadata.keywords || crossrefData.keywords || '',
          }
        }
      }

      // ── Step 3: Update local state ──
      updatePaper(paperId, () => ({
        isLoading: false,
        error: '',
        pdfDocument: documentProxy,
        totalPages: documentProxy.numPages,
        metadata,
        pageMetrics,
      }))

      persistPaperToServer(paperId, file, targetFolderId, metadata)
        .then(({ paperId: persistedPaperId }) => {
          scheduleSummarization(persistedPaperId, documentProxy)
        })
        .catch(() => {
          scheduleSummarization(paperId, documentProxy)
        })
    } catch (loadError) {
      console.error('Failed to load PDF', loadError)
      let finalImportError = loadError
      try {
        const { paperId: serverPaperId, fileUrl } = await persistPaperToServer(
          paperId,
          file,
          targetFolderId,
          {
            title: file.name.replace(/\.pdf$/i, ''),
            pageCount: 0,
          },
        )

        if (fileUrl) {
          await loadPdfFromUrl(serverPaperId, fileUrl)
          return
        }
      } catch (uploadError) {
        console.error('Failed to upload PDF after local parse error', uploadError)
        finalImportError = uploadError
      }
      const failureConflict = createImportFailureConflict({
        file,
        targetFolderId,
        shouldActivate,
        failedPaperId: paperId,
        error: finalImportError,
      })
      updatePaper(paperId, () => ({
        isLoading: false,
        error: failureConflict.message,
      }))
      setImportConflict(failureConflict)
    }
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files ?? [])
    const targetFolderId = importFolderIdRef.current
    const shouldActivate = shouldActivateImportedPaperRef.current

    files.forEach((file) => {
      loadPdfFile(file, targetFolderId, shouldActivate)
    })

    importFolderIdRef.current = ''
    shouldActivateImportedPaperRef.current = true
    event.target.value = ''
  }

  function openFilePicker(folderId = '', options = {}) {
    const { activate = true } = options
    importFolderIdRef.current = folderId
    shouldActivateImportedPaperRef.current = activate
    fileInputRef.current?.click()
  }

  // ── Zoom / Navigation ─────────────────────────────────

  function zoomOut() {
    if (!activePaper) {
      return
    }

    const nextScale = clampScale(activePaper.scale - SCALE_STEP)
    persistReadingSessionView(activePaper.id, {
      pageNumber: activePaper.pageNumber,
      scale: nextScale,
      totalPages: activePaper.totalPages,
    })
    updatePaper(activePaper.id, () => ({ scale: nextScale }))
  }

  function zoomIn() {
    if (!activePaper) {
      return
    }

    const nextScale = clampScale(activePaper.scale + SCALE_STEP)
    persistReadingSessionView(activePaper.id, {
      pageNumber: activePaper.pageNumber,
      scale: nextScale,
      totalPages: activePaper.totalPages,
    })
    updatePaper(activePaper.id, () => ({ scale: nextScale }))
  }

  function zoomBy(direction) {
    if (!activePaper) return
    const nextScale = clampScale(activePaper.scale + direction * SCALE_STEP)
    persistReadingSessionView(activePaper.id, {
      pageNumber: activePaper.pageNumber,
      scale: nextScale,
      totalPages: activePaper.totalPages,
    })
    updatePaper(activePaper.id, () => ({ scale: nextScale }))
  }

  function fitToWidth(availableWidth, pageWidth) {
    if (!activePaper || !availableWidth || !pageWidth) {
      return
    }

    const nextScale = clampScale((availableWidth - 40) / pageWidth)
    persistReadingSessionView(activePaper.id, {
      pageNumber: activePaper.pageNumber,
      scale: nextScale,
      totalPages: activePaper.totalPages,
    })
    updatePaper(activePaper.id, () => ({ scale: nextScale }))
  }

  function setCurrentPage(pageNumber) {
    if (!activePaper) {
      return
    }

    persistReadingSessionView(activePaper.id, {
      pageNumber,
      scale: activePaper.scale,
      totalPages: activePaper.totalPages,
    })
    updatePaper(activePaper.id, (paper) => {
      if (paper.pageNumber === pageNumber) {
        return {}
      }

      return { pageNumber }
    })
  }

  return {
    activeView,
    assignPaperToFolder,
    cancelImportConflict,
    closePaper,
    createFolder,
    deletePaper,
    deleteFolder,
    error: activePaper?.error ?? '',
    emptyTrash,
    fileInputRef,
    fileName: activePaper?.fileName ?? '',
    fitToWidth,
    folders,
    goHome,
    handleFileChange,
    importConflict,
    importStatus,
    isImporting,
    isLoading: activePaper?.isLoading ?? false,
    metadata: activePaper?.metadata ?? EMPTY_METADATA,
    openFilePicker,
    openTabs,
    pageMetrics: activePaper?.pageMetrics ?? [],
    pageNumber: activePaper?.pageNumber ?? 1,
    pageNumbers,
    pdfDocument: activePaper?.pdfDocument ?? null,
    activePaperSummary: activePaper ? paperSummaries[activePaper.id] ?? '' : '',
    activePaperFullText: activePaper ? paperFullTexts[activePaper.id] ?? '' : '',
    recentPapers,
    readingStats,
    recentReadings,
    readingDurationVersion,
    refreshTrashPapers,
    refreshPaperMetadata,
    renameFolder,
    resolveImportConflict,
    retryImportConflict,
    restorePaperFromTrash,
    scale: activePaper?.scale ?? DEFAULT_SCALE,
    savePaperMetadata,
    setCurrentPage,
    switchToPaper: activatePaper,
    permanentlyDeletePaper,
    totalPages: activePaper?.totalPages ?? 0,
    trashPapers,
    uncategorizedFolderId,
    zoomIn,
    zoomOut,
    zoomBy,
  }
}
