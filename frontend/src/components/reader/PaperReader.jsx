import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { PageThumbnails } from './PageThumbnails'
import { PdfToolbar } from './PdfToolbar'
import { PdfViewport } from './PdfViewport'
import { PdfOutlinePanel, ReaderNavigationPanel } from './ReaderNavigationPanel'
import { isEmbedPdfPreviewEnabled } from './pdfEngineMode'
import { readReadingSessionSnapshot } from './readingSessionStorage'
import {
  ensurePaperAiOutline,
  fetchPaperAiOutline,
  retryPaperAiOutline,
} from '../../services/paperReaderApi'
import 'pdfjs-dist/web/pdf_viewer.css'

const EmbedPdfViewport = lazy(() => import('./embedpdf/EmbedPdfViewport').then((module) => ({
  default: module.EmbedPdfViewport,
})))

async function resolvePdfJsOutlinePage(pdfDocument, destination) {
  let target = destination
  if (typeof target === 'string') target = await pdfDocument.getDestination(target)
  if (!Array.isArray(target) || target.length === 0) return null
  const pageRef = target[0]
  if (typeof pageRef === 'number' && Number.isInteger(pageRef)) return pageRef + 1
  if (!pageRef) return null
  try {
    return (await pdfDocument.getPageIndex(pageRef)) + 1
  } catch {
    return null
  }
}

async function resolvePdfJsOutlineItems(pdfDocument, items, depth = 0) {
  if (!Array.isArray(items) || depth >= 3) return []
  const resolved = []
  for (const item of items.slice(0, 40)) {
    const title = String(item?.title || '').trim()
    const children = await resolvePdfJsOutlineItems(pdfDocument, item?.items, depth + 1)
    if (!title && !children.length) continue
    resolved.push({
      // Native bookmarks are source-language labels. Keep that source in title_en
      // so the cached AI enrichment can add a distinct Chinese understanding title.
      title_cn: '',
      title_en: title,
      page: await resolvePdfJsOutlinePage(pdfDocument, item?.dest),
      children,
    })
  }
  return resolved
}

export function PaperReader({
  pdfReader,
  readerRef,
  readerFrameRef,
  activeTool,
  isThumbnailsOpen,
  thumbnailWidth,
  onThumbnailResizeStart,
  onToggleThumbnails,
  onToolChange,
  activeEraserMode,
  onEraserModeChange,
  inkOptions,
  onInkOptionsChange,
  markupOptions,
  onMarkupOptionsChange,
  shapeOptions,
  onShapeOptionsChange,
  onSelect,
  onThumbnailPageClick,
  onWheelZoom,
  matches,
  noteFocus,
  onSearchExecute,
  searchTerm,
  onSearchChange,
  matchIndex,
  totalMatches,
  onSearchPrev,
  onSearchNext,
  canUndoAnnotation,
  onUndoAnnotation,
  currentPaperId,
  annotationOwnerKey,
  annotations,
  inkAnnotations,
  shapeAnnotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onEraseAnnotationRange,
  onCreateInkAnnotation,
  onDeleteInkAnnotation,
  onCreateShapeAnnotation,
  onUpdateShapeAnnotation,
  onDeleteShapeAnnotation,
  onInsertSelectionNote,
  onAskAI,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
  onDownload,
  fullTranslateVisible,
  fullTranslateActive,
  fullTranslateStatus,
  fullTranslateProgress,
  onFullTranslate,
  navigationTabRequest,
  onPdfiumViewerState,
  isActive = true,
}) {
  const useEmbedPdfPreview = isEmbedPdfPreviewEnabled()
  const embedControllerRef = useRef(null)
  const embeddedRestoreKeyRef = useRef('')
  const pendingPdfiumRestoreRef = useRef(null)
  const preparedPdfiumRestoreKeyRef = useRef('')
  const lastEmbedViewerStateRef = useRef(null)
  const [embedControllerEpoch, setEmbedControllerEpoch] = useState(0)
  const [embedThumbnailHost, setEmbedThumbnailHost] = useState(null)
  const [navigationTab, setNavigationTab] = useState('thumbnails')
  const [aiOutlineRequestEpoch, setAiOutlineRequestEpoch] = useState(0)
  const [nativeOutlineSnapshot, setNativeOutlineSnapshot] = useState({ paperId: null, status: 'loading', items: [] })
  const [aiOutlineSnapshot, setAiOutlineSnapshot] = useState({ paperId: null, status: 'idle', progress: 0, outline: null, error_message: null })
  const automaticOutlineStartKeyRef = useRef('')
  const [embedViewerState, setEmbedViewerState] = useState({
    pageNumber: pdfReader.pageNumber || 1,
    totalPages: pdfReader.totalPages || 0,
    scale: pdfReader.scale || 1,
    matchIndex: 0,
    totalMatches: 0,
    canUndo: false,
    canRedo: false,
    annotationCount: 0,
  })

  const restoreKey = String(currentPaperId || '')
  // A kept-alive reader can still receive a fresh PDFium layout when its tab
  // becomes visible again. Reset the preparation marker while hidden so every
  // activation reuses the persisted page/zoom instead of trusting page one.
  if (!isActive && preparedPdfiumRestoreKeyRef.current === restoreKey) {
    preparedPdfiumRestoreKeyRef.current = ''
  }
  if (
    useEmbedPdfPreview
    && restoreKey
    && isActive
    && preparedPdfiumRestoreKeyRef.current !== restoreKey
  ) {
    // Child effects in PDFium publish page one before this component's effects
    // get a controller. Prepare the saved target during render so that startup
    // event cannot overwrite the session before restoration begins.
    const savedSession = readReadingSessionSnapshot(currentPaperId, undefined, {
      totalPages: pdfReader.totalPages || 0,
    })
    pendingPdfiumRestoreRef.current = {
      paperId: restoreKey,
      targetPage: Math.max(1, Number(savedSession?.pageNumber || pdfReader.pageNumber) || 1),
      targetScale: Number(savedSession?.scale || pdfReader.scale) || 1,
      targetSeen: false,
      userNavigated: false,
      // PDFium can apply a second layout after reporting the requested page.
      // Keep that brief startup window guarded so its page-one reset is not
      // mistaken for the user's reading position.
      expiresAt: Date.now() + 2800,
    }
    preparedPdfiumRestoreKeyRef.current = restoreKey
  }

  useEffect(() => {
    if (
      navigationTabRequest?.tab === 'outline'
      && Number(navigationTabRequest.paperId) === Number(currentPaperId)
    ) {
      setNavigationTab('outline')
    }
  }, [currentPaperId, navigationTabRequest])

  const handleEmbedControllerReady = useCallback((controller) => {
    embedControllerRef.current = controller
    if (controller) {
      setEmbedControllerEpoch((current) => current + 1)
    }
  }, [])

  const handleEmbedViewerStateChange = useCallback((state) => {
    lastEmbedViewerStateRef.current = state
    setEmbedViewerState(state)
    const pendingRestore = pendingPdfiumRestoreRef.current
    const reportedPage = Math.max(1, Math.round(Number(state?.pageNumber) || 1))
    const isSamePaperRestore = pendingRestore?.paperId === String(currentPaperId)
    // During PDFium startup, page one is a placeholder while the requested
    // session page is being applied. It can recur once after the requested
    // page first appears, when PDFium commits a delayed layout. Do not let
    // either automatic page-one event overwrite a saved reading position.
    if (
      isSamePaperRestore
      && pendingRestore.targetPage > 1
      && reportedPage === 1
      && !pendingRestore.userNavigated
      && Date.now() < pendingRestore.expiresAt
    ) {
      window.requestAnimationFrame(() => {
        const restore = pendingPdfiumRestoreRef.current
        if (
          restore?.paperId === String(currentPaperId)
          && !restore.userNavigated
          && Date.now() < restore.expiresAt
        ) {
          embedControllerRef.current?.setZoom?.(restore.targetScale)
          embedControllerRef.current?.scrollToPage?.(restore.targetPage)
        }
      })
      return
    }
    if (isSamePaperRestore && reportedPage === pendingRestore.targetPage) {
      pendingRestore.targetSeen = true
    }
    onPdfiumViewerState?.(currentPaperId, state)
  }, [currentPaperId, onPdfiumViewerState])

  const handleEmbedUserNavigation = useCallback(() => {
    const pendingRestore = pendingPdfiumRestoreRef.current
    if (pendingRestore?.paperId === String(currentPaperId)) {
      // Pointer, wheel, and keyboard navigation are explicit user intent. From
      // here onward, never pull the document back to the previously saved page.
      pendingRestore.userNavigated = true
      pendingPdfiumRestoreRef.current = null
    }
  }, [currentPaperId])

  useEffect(() => {
    if (!useEmbedPdfPreview || !currentPaperId || !embedControllerRef.current || !isActive) {
      if (!isActive) embeddedRestoreKeyRef.current = ''
      return undefined
    }
    const restoreKey = String(currentPaperId)
    if (embeddedRestoreKeyRef.current === restoreKey) return undefined

    embeddedRestoreKeyRef.current = restoreKey
    // A closed tab mounts a brand-new PDFium document. Its parent state can be
    // one render behind the latest scroll event, while the prepared target comes
    // from synchronous session storage and is already protecting page-one events.
    const preparedRestore = pendingPdfiumRestoreRef.current
    const targetPage = preparedRestore?.paperId === restoreKey
      ? preparedRestore.targetPage
      : Math.max(1, Number(pdfReader.pageNumber) || 1)
    const targetScale = preparedRestore?.paperId === restoreKey
      ? preparedRestore.targetScale
      : Number(pdfReader.scale) || 1
    const controller = embedControllerRef.current

    const applyRestore = () => {
      const pendingRestore = pendingPdfiumRestoreRef.current
      if (
        pendingRestore?.paperId !== restoreKey
        || pendingRestore.userNavigated
        || Date.now() >= pendingRestore.expiresAt
      ) {
        return
      }
      controller.setZoom?.(targetScale)
      controller.scrollToPage?.(targetPage)
    }

    // A kept-alive tab can return from `display: none`, and a newly created tab
    // can finish a delayed PDFium layout, after the first scroll request. Retry
    // through the short startup window while page one is only a placeholder.
    applyRestore()
    const retryAfterActivation = () => {
      const pendingRestore = pendingPdfiumRestoreRef.current
      const reportedPage = Math.max(1, Math.round(Number(lastEmbedViewerStateRef.current?.pageNumber) || 1))
      if (
        pendingRestore?.paperId === restoreKey
        && !pendingRestore.userNavigated
        && Date.now() < pendingRestore.expiresAt
        && reportedPage === 1
      ) {
        applyRestore()
      }
    }
    const animationFrame = window.requestAnimationFrame(retryAfterActivation)
    const retryTimers = [120, 360, 900, 1800].map((delay) =>
      window.setTimeout(retryAfterActivation, delay),
    )
    const expiryTimer = window.setTimeout(() => {
      const pendingRestore = pendingPdfiumRestoreRef.current
      if (pendingRestore?.paperId === restoreKey && Date.now() >= pendingRestore.expiresAt) {
        pendingPdfiumRestoreRef.current = null
      }
    }, 2850)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      retryTimers.forEach((timer) => window.clearTimeout(timer))
      window.clearTimeout(expiryTimer)
      if (pendingPdfiumRestoreRef.current?.paperId === restoreKey) {
        pendingPdfiumRestoreRef.current = null
      }
    }
  }, [
    currentPaperId,
    embedControllerEpoch,
    isActive,
    onPdfiumViewerState,
    pdfReader.pageNumber,
    pdfReader.scale,
    useEmbedPdfPreview,
  ])

  const nativeOutline = nativeOutlineSnapshot.paperId === currentPaperId
    ? nativeOutlineSnapshot
    : { status: 'loading', items: [] }
  const aiOutline = aiOutlineSnapshot.paperId === currentPaperId
    ? aiOutlineSnapshot
    : { status: 'idle', progress: 0, outline: null, error_message: null }
  const aiOutlineProgress = Math.max(0, Math.min(100, Number(aiOutline.progress || 0)))
  const isAiOutlineGenerating = aiOutline.status === 'queued' || aiOutline.status === 'running'
  const outlineProgress = isAiOutlineGenerating
    ? {
        value: aiOutlineProgress,
        indeterminate: aiOutline.status === 'queued' || aiOutlineProgress === 0,
        label: nativeOutline.items.length > 0 ? '中文释义生成中' : 'AI 目录生成中',
      }
    : null

  const handleEmbedOutlineChange = useCallback((nextOutline) => {
    setNativeOutlineSnapshot({
      paperId: currentPaperId,
      status: nextOutline?.status || 'ready',
      items: Array.isArray(nextOutline?.items) ? nextOutline.items : [],
    })
  }, [currentPaperId])

  useEffect(() => {
    if (useEmbedPdfPreview) return undefined
    const pdfDocument = pdfReader.pdfDocument
    if (!pdfDocument) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => pdfDocument.getOutline())
      .then((items) => resolvePdfJsOutlineItems(pdfDocument, items))
      .then((items) => {
        if (!cancelled) setNativeOutlineSnapshot({ paperId: currentPaperId, status: 'ready', items })
      })
      .catch(() => {
        if (!cancelled) setNativeOutlineSnapshot({ paperId: currentPaperId, status: 'ready', items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [currentPaperId, pdfReader.pdfDocument, useEmbedPdfPreview])

  useEffect(() => {
    if (navigationTab !== 'outline' || nativeOutline.status !== 'ready' || !currentPaperId) {
      return undefined
    }
    let cancelled = false
    let timer = null
    const nativeItems = nativeOutline.items
    const generationKey = `${currentPaperId}:${nativeItems.length > 0 ? 'native_titles' : 'generated'}`

    async function refreshAiOutline() {
      try {
        let payload = await fetchPaperAiOutline(currentPaperId)
        if (cancelled) return
        // Opening the directory starts one durable generation only when no
        // cached record exists. A completed or failed record is never started
        // again by navigation; Retry is the only explicit re-run path.
        if (payload?.status === 'idle' && automaticOutlineStartKeyRef.current !== generationKey) {
          automaticOutlineStartKeyRef.current = generationKey
          payload = await ensurePaperAiOutline(currentPaperId, { nativeOutline: nativeItems })
          if (cancelled) return
        }
        setAiOutlineSnapshot({ paperId: currentPaperId, ...(payload || { status: 'failed', error_message: '目录状态读取失败。' }) })
        if (payload?.status === 'queued' || payload?.status === 'running') {
          timer = window.setTimeout(refreshAiOutline, 1600)
        }
      } catch (error) {
        if (!cancelled) {
          setAiOutlineSnapshot({ paperId: currentPaperId, status: 'failed', progress: 0, outline: null, error_message: error?.message || '目录状态读取失败。' })
        }
      }
    }

    void refreshAiOutline()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [aiOutlineRequestEpoch, currentPaperId, nativeOutline.items, nativeOutline.status, navigationTab])

  async function handleRetryAiOutline() {
    if (!currentPaperId) return
    try {
      const payload = await retryPaperAiOutline(currentPaperId, { nativeOutline: nativeOutline.items })
      setAiOutlineSnapshot({ paperId: currentPaperId, ...payload })
      setAiOutlineRequestEpoch((current) => current + 1)
    } catch (error) {
      setAiOutlineSnapshot({ paperId: currentPaperId, status: 'failed', progress: 0, outline: null, error_message: error?.message || '目录重试失败。' })
    }
  }

  function navigateOutlinePage(pageNumber) {
    if (useEmbedPdfPreview) {
      embedControllerRef.current?.scrollToPage(pageNumber)
      return
    }
    onThumbnailPageClick?.(pageNumber)
  }

  const thumbnailContent = useEmbedPdfPreview ? (
    <div
      ref={setEmbedThumbnailHost}
      className="thumbnail-panel embedpdf-thumbnail-panel"
      style={{ width: thumbnailWidth }}
    />
  ) : (
    <PageThumbnails
      key={`thumbs:${currentPaperId || 'none'}`}
      currentPage={pdfReader.pageNumber}
      currentPaperId={currentPaperId}
      pageMetrics={pdfReader.pageMetrics}
      pageNumbers={pdfReader.pageNumbers}
      pdfDocument={pdfReader.pdfDocument}
      width={thumbnailWidth}
      onPageClick={onThumbnailPageClick}
    />
  )

  return (
    <section className="reader-frame">
      <PdfToolbar
        fileName={pdfReader.fileName}
        activeTool={activeTool}
        isThumbnailsOpen={isThumbnailsOpen}
        onToolChange={onToolChange}
        activeEraserMode={activeEraserMode}
        onEraserModeChange={onEraserModeChange}
        inkOptions={inkOptions}
        onInkOptionsChange={onInkOptionsChange}
        markupOptions={markupOptions}
        onMarkupOptionsChange={onMarkupOptionsChange}
        shapeOptions={shapeOptions}
        onShapeOptionsChange={onShapeOptionsChange}
        onToggleThumbnails={onToggleThumbnails}
        onZoomIn={useEmbedPdfPreview ? () => embedControllerRef.current?.zoomIn() : pdfReader.zoomIn}
        onZoomOut={useEmbedPdfPreview ? () => embedControllerRef.current?.zoomOut() : pdfReader.zoomOut}
        pageNumber={useEmbedPdfPreview ? embedViewerState.pageNumber : pdfReader.pageNumber}
        scale={useEmbedPdfPreview ? embedViewerState.scale : pdfReader.scale}
        totalPages={useEmbedPdfPreview ? embedViewerState.totalPages : pdfReader.totalPages}
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        matchIndex={useEmbedPdfPreview ? embedViewerState.matchIndex : matchIndex}
        totalMatches={useEmbedPdfPreview ? embedViewerState.totalMatches : totalMatches}
        onSearchPrev={useEmbedPdfPreview ? () => embedControllerRef.current?.searchPrevious() : onSearchPrev}
        onSearchNext={useEmbedPdfPreview ? () => embedControllerRef.current?.searchNext() : onSearchNext}
        canUndo={useEmbedPdfPreview ? embedViewerState.canUndo : canUndoAnnotation}
        canRedo={useEmbedPdfPreview ? embedViewerState.canRedo : false}
        onUndo={useEmbedPdfPreview ? () => embedControllerRef.current?.undo() : onUndoAnnotation}
        onRedo={useEmbedPdfPreview ? () => embedControllerRef.current?.redo() : undefined}
        onDownload={useEmbedPdfPreview
          ? (format) => onDownload(format, {
              hasAnnotations: embedViewerState.annotationCount > 0,
              localPdfExporter: format === 'pdf'
                ? () => embedControllerRef.current?.exportPdf()
                : null,
            })
          : onDownload}
        fullTranslateVisible={fullTranslateVisible}
        fullTranslateActive={fullTranslateActive}
        fullTranslateStatus={fullTranslateStatus}
        fullTranslateProgress={fullTranslateProgress}
        onFullTranslate={onFullTranslate}
      />

      <div
        className={`reader-body${isThumbnailsOpen ? ' has-thumbnails' : ''}`}
        ref={readerFrameRef}
      >
        <div className="thumbnails-slide" style={{ width: isThumbnailsOpen ? thumbnailWidth : 0 }}>
          <ReaderNavigationPanel
            activeTab={navigationTab}
            onTabChange={setNavigationTab}
            width={thumbnailWidth}
            outlineProgress={outlineProgress}
            thumbnailContent={thumbnailContent}
            outlineContent={(
              <PdfOutlinePanel
                nativeOutline={nativeOutline}
                aiOutline={aiOutline}
                onNavigate={navigateOutlinePage}
                onRetryAiOutline={handleRetryAiOutline}
              />
            )}
          />

          <div
            aria-label="调整缩略图面板宽度"
            aria-orientation="vertical"
            className="reader-resizer reader-resizer--left"
            onPointerDown={onThumbnailResizeStart}
            role="separator"
          />
        </div>

        {useEmbedPdfPreview ? (
          <Suspense fallback={<div className="embedpdf-state">正在加载 PDFium 阅读器模块…</div>}>
            <EmbedPdfViewport
              activeTool={activeTool}
              inkOptions={inkOptions}
              markupOptions={markupOptions}
              shapeOptions={shapeOptions}
              currentPaperId={currentPaperId}
              annotationOwnerKey={annotationOwnerKey}
              thumbnailHost={embedThumbnailHost}
              searchTerm={searchTerm}
              onControllerReady={handleEmbedControllerReady}
              onViewerStateChange={handleEmbedViewerStateChange}
              onViewerNavigationIntent={handleEmbedUserNavigation}
              onNativeOutlineChange={handleEmbedOutlineChange}
              onSelect={onSelect}
              onInsertSelectionNote={onInsertSelectionNote}
              onAskAI={onAskAI}
              onScreenshotTranslate={onScreenshotTranslate}
              onScreenshotAskAI={onScreenshotAskAI}
              onScreenshotInsertNote={onScreenshotInsertNote}
            />
          </Suspense>
        ) : <PdfViewport
          key={`viewport:${currentPaperId || 'none'}`}
          activeTool={activeTool}
          error={pdfReader.error}
          isLoading={pdfReader.isLoading}
          matches={matches}
          matchIndex={matchIndex}
          noteFocus={noteFocus}
          pageMetrics={pdfReader.pageMetrics}
          pageNumbers={pdfReader.pageNumbers}
          pageNumber={pdfReader.pageNumber}
          pdfDocument={pdfReader.pdfDocument}
          readerRef={readerRef}
          scale={pdfReader.scale}
          onFitToWidth={pdfReader.fitToWidth}
          onSelect={onSelect}
          onSearchExecute={onSearchExecute}
          onVisiblePageChange={pdfReader.setCurrentPage}
          onWheelZoom={onWheelZoom}
          currentPaperId={currentPaperId}
          annotations={annotations}
          inkAnnotations={inkAnnotations}
          shapeAnnotations={shapeAnnotations}
          inkOptions={inkOptions}
          shapeOptions={shapeOptions}
          onCreateAnnotation={onCreateAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
          onEraseAnnotationRange={onEraseAnnotationRange}
          onCreateInkAnnotation={onCreateInkAnnotation}
          onDeleteInkAnnotation={onDeleteInkAnnotation}
          onCreateShapeAnnotation={onCreateShapeAnnotation}
          onUpdateShapeAnnotation={onUpdateShapeAnnotation}
          onDeleteShapeAnnotation={onDeleteShapeAnnotation}
          onInsertSelectionNote={onInsertSelectionNote}
          onAskAI={onAskAI}
          onScreenshotTranslate={onScreenshotTranslate}
          onScreenshotAskAI={onScreenshotAskAI}
          onScreenshotInsertNote={onScreenshotInsertNote}
        />}
      </div>
    </section>
  )
}
