import { useEffect, useMemo, useRef, useState } from 'react'
import { loadPdfJs } from '../services/pdfjsClient'

const DEFAULT_SCALE = 1.35
const MIN_SCALE = 0.9
const MAX_SCALE = 2.4
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

function createFileFingerprint(file) {
  return [file.name, file.size, file.lastModified].join(':')
}

function createPaperId() {
  return `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createFolderId() {
  return `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyPaperState(file, paperId, folderId) {
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
  }
}

async function extractFirstPagesText(documentProxy, maxPages = 2) {
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

export function usePdfReader() {
  const fileInputRef = useRef(null)
  const importFolderIdRef = useRef('')
  const shouldActivateImportedPaperRef = useRef(true)
  const paperResourcesRef = useRef(new Map())
  const [activeView, setActiveView] = useState('home')
  const [papers, setPapers] = useState([])
  const [folders, setFolders] = useState([])
  const [openTabIds, setOpenTabIds] = useState([])

  useEffect(
    () => () => {
      paperResourcesRef.current.forEach((resource) => {
        destroyPaperResources(resource)
      })
      paperResourcesRef.current.clear()
    },
    [],
  )

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

  function updatePaper(paperId, updater) {
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.id === paperId ? { ...paper, ...updater(paper) } : paper,
      ),
    )
  }

  function activatePaper(paperId) {
    setOpenTabIds((currentIds) =>
      currentIds.includes(paperId) ? currentIds : [...currentIds, paperId],
    )
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.id === paperId
          ? {
              ...paper,
              lastViewedAt: Date.now(),
            }
          : paper,
      ),
    )
    setActiveView(paperId)
  }

  function goHome() {
    setActiveView('home')
  }

  function closePaper(paperId) {
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
  }

  function createFolder(folderName) {
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

    const nextFolder = {
      id: createFolderId(),
      name: normalizedName,
      createdAt: Date.now(),
    }

    setFolders((currentFolders) => [...currentFolders, nextFolder])
    return { ok: true, folder: nextFolder }
  }

  function deleteFolder(folderId) {
    setFolders((currentFolders) =>
      currentFolders.filter((folder) => folder.id !== folderId),
    )
    setPapers((currentPapers) =>
      currentPapers.map((paper) =>
        paper.folderId === folderId ? { ...paper, folderId: '' } : paper,
      ),
    )
  }

  function assignPaperToFolder(paperId, folderId) {
    updatePaper(paperId, () => ({
      folderId,
    }))
  }

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

    const paperId = createPaperId()
    const nextPaper = createEmptyPaperState(file, paperId, folderId)
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

    try {
      const { getDocument } = await loadPdfJs()
      const loadingTask = getDocument(objectUrl)
      const resource = paperResourcesRef.current.get(paperId)

      if (!resource) {
        loadingTask.destroy()
        return
      }

      resource.loadingTask = loadingTask
      const documentProxy = await loadingTask.promise
      resource.documentProxy = documentProxy

      const [metadata, pageMetrics] = await Promise.all([
        extractPaperMetadata(documentProxy, file),
        extractPageMetrics(documentProxy),
      ])

      updatePaper(paperId, () => ({
        isLoading: false,
        error: '',
        pdfDocument: documentProxy,
        totalPages: documentProxy.numPages,
        metadata,
        pageMetrics,
      }))
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
    recentPapers,
    scale: activePaper?.scale ?? DEFAULT_SCALE,
    setCurrentPage,
    switchToPaper: activatePaper,
    totalPages: activePaper?.totalPages ?? 0,
    zoomIn,
    zoomOut,
  }
}
