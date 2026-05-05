import { useEffect, useMemo, useRef, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'
import { createPdfLoadingTask, loadPdfJs } from '../services/pdfjsClient'
import {
  createFolder as apiCreateFolder,
  deleteFolder as apiDeleteFolder,
  deletePaper as apiDeletePaper,
  fetchFolders,
  fetchPapers,
  fetchAiProviders,
  fetchPaperSummary,
  fetchReadingStats,
  getPaperFileUrl,
  recordReadingEvent,
  renameFolder as apiRenameFolder,
  syncReadingRecords,
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

function findDoi(text) {
  return text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0] ?? ''
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
    pageNumber: 1,
    totalPages: serverPaper.page_count || 0,
    scale: DEFAULT_SCALE,
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
      fileSize: serverPaper.file_size,
      pageCount: serverPaper.page_count,
    },
    _serverFileUrl: getPaperFileUrl(serverPaper.id),
  }
}

async function extractFirstPagesText(documentProxy, maxPages = 5) {
  const pageCount = Math.min(documentProxy.numPages, maxPages)
  const chunks = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber)
    const textContent = await page.getTextContent()
    chunks.push(textContent.items.map((item) => item.str).join(' '))
  }

  return chunks.join('\n')
}

async function extractFullText(documentProxy, maxPages = 200) {
  const pageCount = Math.min(documentProxy.numPages, maxPages)
  const chunks = []
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber)
    const textContent = await page.getTextContent()
    chunks.push(textContent.items.map((item) => item.str).join(' '))
  }
  return chunks.join('\n')
}

async function extractPaperMetadata(documentProxy, file) {
  const metadataResult = await documentProxy.getMetadata().catch(() => null)
  const info = metadataResult?.info ?? {}
  const firstPagesText = await extractFirstPagesText(documentProxy).catch(() => '')

  return {
    title: info.Title || file.name.replace(/\.pdf$/i, ''),
    author: info.Author || '',
    subject: info.Subject || '',
    keywords: info.Keywords || '',
    creator: info.Creator || '',
    producer: info.Producer || '',
    creationDate: normalizePdfDate(info.CreationDate),
    modificationDate: normalizePdfDate(info.ModDate),
    doi: findDoi(firstPagesText),
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

export function usePdfReader({ currentUser } = {}) {
  const fileInputRef = useRef(null)
  const importFolderIdRef = useRef('')
  const shouldActivateImportedPaperRef = useRef(true)
  const paperResourcesRef = useRef(new Map())
  const summaryMapRef = useRef(new Map())
  const fullTextMapRef = useRef(new Map())
  const uncategorizedFolderIdRef = useRef('')
  const lastSyncUserRef = useRef(null)
  const [activeView, setActiveView] = useState('home')
  const [papers, setPapers] = useState([])
  const [folders, setFolders] = useState([])
  const [openTabIds, setOpenTabIds] = useState([])
  const openTabIdsRef = useRef(openTabIds)
  openTabIdsRef.current = openTabIds
  const [uncategorizedFolderId, setUncategorizedFolderId] = useState('')
  const [recentReadings, setRecentReadings] = useState(getStoredRecentReadings())
  const [importConflict, setImportConflict] = useState(null)
  const [readingStats, setReadingStats] = useState(null)

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(
    () => () => {
      paperResourcesRef.current.forEach((resource) => {
        destroyPaperResources(resource)
      })
      paperResourcesRef.current.clear()
    },
    [],
  )

  // ── Sync with backend ──────────────────────────────────

  async function syncFromBackend() {
    const token = getStoredAuthToken()
    if (!token) return

    try {
      const [serverFolders, serverPapers] = await Promise.all([
        fetchFolders(),
        fetchPapers(),
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
      // Close tabs that came from previous session
      setOpenTabIds([])
      setActiveView('home')

      // ── Sync reading records ──
      const localReadings = getStoredRecentReadings()
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

      // Upload local records to server (only within 30 days)
      const uploadable = localReadings
        .filter((r) => r.openedAt > thirtyDaysAgo)
        .map((r) => ({
          paper_id: Number(r.paperId),
          opened_at: new Date(r.openedAt).toISOString(),
        }))
        .filter((r) => !Number.isNaN(r.paper_id))

      if (uploadable.length > 0) {
        syncReadingRecords(uploadable).catch(() => {})
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
  }

  // Sync when user logs in or changes
  useEffect(() => {
    if (!currentUser) {
      // Logged out — reset to empty in-memory state
      if (lastSyncUserRef.current) {
        setFolders([])
        setPapers([])
        setOpenTabIds([])
        setActiveView('home')
        setUncategorizedFolderId('')
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
  }, [currentUser])

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

  const isImporting = useMemo(
    () => papers.some((p) => p.isLoading),
    [papers],
  )

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

  // ── Helpers ────────────────────────────────────────────

  function updatePaper(paperId, updater) {
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.id === paperId ? { ...paper, ...updater(paper) } : paper,
      ),
    )
  }

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
  }

  // ── Paper actions ──────────────────────────────────────

  function activatePaper(paperId) {
    const paper = paperMap.get(paperId)
    if (!paper) return

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

    // Only record reading event if this is a fresh open (not switching tabs)
    // Uses ref (not state) to avoid stale closure — ref is synced to latest openTabIds every render
    const isAlreadyOpen = openTabIdsRef.current.includes(paperId)

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
          recordReadingEvent(serverId, Date.now())
            .then(() => fetchReadingStats())
            .then((stats) => { if (stats) setReadingStats(stats) })
            .catch(() => {})
        }
      }
    }

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
      fullTextMapRef.current.set(paperId, fullText)
      const truncated = fullText.slice(0, 40000)
      const activeId = activeView
      const { providers } = await fetchAiProviders()
      const provider = providers?.find(p => p.is_active)
      if (!provider) return
      const data = await fetchPaperSummary(truncated, provider.id)
      if (data?.summary) {
        summaryMapRef.current.set(paperId, data.summary)
        if (activeView === activeId) {
          setPapers(p => p.map(pp => pp.id === paperId ? { ...pp } : pp))
        }
      }
    } catch { /* silent */ }
  }
  async function loadPdfFromUrl(paperId, url) {
    updatePaper(paperId, () => ({ isLoading: true, error: '' }))

    try {
      const token = getStoredAuthToken()
      const loadingTask = await createPdfLoadingTask({
        url,
        httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      })

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

      const documentProxy = await loadingTask.promise
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
          metadata = { ...pdfMeta, title: cr.title || pdfMeta.title, author: cr.author || pdfMeta.author, subject: cr.subject || pdfMeta.subject }
          const sid = Number(paperId)
          if (!Number.isNaN(sid)) {
            apiUpdatePaper(sid, { author: metadata.author, subject: metadata.subject || undefined }).catch(function(){})
          }
        }
      }

      updatePaper(paperId, () => ({
        isLoading: false,
        error: '',
        pdfDocument: documentProxy,
        totalPages: documentProxy.numPages,
        ...(metadata ? { metadata } : {}),
        ...(pageMetrics.length ? { pageMetrics } : {}),
      }))

      triggerSummarization(paperId, documentProxy)
    } catch {
      updatePaper(paperId, () => ({
        isLoading: false,
        error: '论文加载失败，请确认文件仍然可用。',
      }))
    }
  }

  function goHome() {
    setActiveView('home')
  }

  function closePaper(paperId) {
    summaryMapRef.current.delete(paperId)
    fullTextMapRef.current.delete(paperId)
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
    summaryMapRef.current.delete(paperId)
    fullTextMapRef.current.delete(paperId)
    // Call API first
    if (getStoredAuthToken()) {
      const serverId = Number(paperId)
      if (!Number.isNaN(serverId)) {
        apiDeletePaper(serverId).catch(() => {})
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
    setImportConflict(null)
  }

  function cancelImportConflict() {
    setImportConflict(null)
  }

  // ── File loading ───────────────────────────────────────

  async function loadPdfFile(file, folderId = '', shouldActivate = true) {
    const fingerprint = createFileFingerprint(file)
    const existingPaper = papers.find((paper) => paper.fingerprint === fingerprint)

    if (existingPaper) {
      assignPaperToFolder(existingPaper.id, folderId)
      if (shouldActivate) {
        activatePaper(existingPaper.id)
      }
      return
    }

    // Check for same-name conflict (different file, same name)
    const sameNamePaper = papers.find((p) => p.fileName === file.name)
    if (sameNamePaper) {
      if (sameNamePaper.folderId === folderId) {
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
          targetFolderId: folderId,
          message: `「${file.name}」已在「${sourceFolderName}」中，是否移入当前文件夹？`,
        })
      }
      return
    }

    // Resolve target folder: use uncategorized if none specified
    const targetFolderId = folderId || uncategorizedFolderIdRef.current || ''
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
            subject: crossrefData.subject || metadata.subject,
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

        triggerSummarization(paperId, documentProxy)

      // ── Step 4: Upload to backend with COMPLETE metadata ──
      if (getStoredAuthToken()) {
        const serverFolderId = Number(targetFolderId) || undefined

        uploadPaper(file, {
          title: metadata.title,
          author: metadata.author || null,
          subject: metadata.subject || null,
          keywords: metadata.keywords || null,
          doi: metadata.doi || null,
          page_count: metadata.pageCount,
        }, serverFolderId)
          .then((serverPaper) => {
            const newId = String(serverPaper.id)
            replacePaperId(paperId, newId)
            setPapers((currentPapers) =>
              currentPapers.map((p) =>
                p.id === newId
                  ? {
                      ...p,
                      fingerprint: createFileFingerprint(file),
                      _serverFileUrl: getPaperFileUrl(serverPaper.id),
                      metadata: {
                        ...p.metadata,
                        translatedTitle: serverPaper.translated_title || p.metadata.translatedTitle || '',
                      },
                    }
                  : p,
              ),
            )
          })
          .catch(() => {
            // Upload failed — paper stays in memory, serverId not set
          })
      }
    } catch (loadError) {
      console.error('Failed to load PDF', loadError)
      updatePaper(paperId, () => ({
        isLoading: false,
        error: 'PDF 加载失败，请确认文件没有损坏。',
      }))
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

    updatePaper(activePaper.id, (paper) => ({
      scale: clampScale(paper.scale - SCALE_STEP),
    }))
  }

  function zoomIn() {
    if (!activePaper) {
      return
    }

    updatePaper(activePaper.id, (paper) => ({
      scale: clampScale(paper.scale + SCALE_STEP),
    }))
  }

  function zoomBy(direction) {
    if (!activePaper) return
    updatePaper(activePaper.id, (paper) => ({
      scale: clampScale(paper.scale + direction * SCALE_STEP),
    }))
  }

  function fitToWidth(availableWidth, pageWidth) {
    if (!activePaper || !availableWidth || !pageWidth) {
      return
    }

    updatePaper(activePaper.id, () => ({
      scale: clampScale((availableWidth - 40) / pageWidth),
    }))
  }

  function setCurrentPage(pageNumber) {
    if (!activePaper) {
      return
    }

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
    fileInputRef,
    fileName: activePaper?.fileName ?? '',
    fitToWidth,
    folders,
    goHome,
    handleFileChange,
    importConflict,
    isImporting,
    isLoading: activePaper?.isLoading ?? false,
    metadata: activePaper?.metadata ?? EMPTY_METADATA,
    openFilePicker,
    openTabs,
    pageMetrics: activePaper?.pageMetrics ?? [],
    pageNumber: activePaper?.pageNumber ?? 1,
    pageNumbers: Array.from(
      { length: activePaper?.totalPages ?? 0 },
      (_, index) => index + 1,
    ),
    pdfDocument: activePaper?.pdfDocument ?? null,
    activePaperSummary: activePaper ? summaryMapRef.current.get(activePaper.id) ?? '' : '',
    recentPapers,
    readingStats,
    recentReadings,
    renameFolder,
    resolveImportConflict,
    scale: activePaper?.scale ?? DEFAULT_SCALE,
    setCurrentPage,
    switchToPaper: activatePaper,
    totalPages: activePaper?.totalPages ?? 0,
    uncategorizedFolderId,
    zoomIn,
    zoomOut,
    zoomBy,
  }
}
