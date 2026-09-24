import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF, useDocumentState } from '@embedpdf/core/react'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import { ConsoleLogger } from '@embedpdf/models'
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  useAnnotationCapability,
} from '@embedpdf/plugin-annotation/react'
import { CapturePluginPackage } from '@embedpdf/plugin-capture/react'
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react'
import { ExportPluginPackage, useExportCapability } from '@embedpdf/plugin-export/react'
import { HistoryPluginPackage, useHistoryCapability } from '@embedpdf/plugin-history/react'
import {
  GlobalPointerProvider,
  InteractionManagerPluginPackage,
  PagePointerProvider,
  useInteractionManagerCapability,
} from '@embedpdf/plugin-interaction-manager/react'
import { PanPluginPackage } from '@embedpdf/plugin-pan/react'
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/react'
import { ScrollPluginPackage, ScrollStrategy, Scroller, useScroll } from '@embedpdf/plugin-scroll/react'
import { SearchLayer, SearchPluginPackage, useSearch } from '@embedpdf/plugin-search/react'
import {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
} from '@embedpdf/plugin-selection/react'
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react'
import { BookmarkPluginPackage, useBookmarkCapability } from '@embedpdf/plugin-bookmark/react'
import { ThumbImg, ThumbnailsPane, ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail/react'
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react'
import {
  Viewport,
  ViewportPluginPackage,
  useViewportCapability,
} from '@embedpdf/plugin-viewport/react'
import { ZoomMode, ZoomPluginPackage, useZoom } from '@embedpdf/plugin-zoom/react'
import { Bot, Copy, Highlighter, MessageSquareText, Trash2, Underline, Waves } from 'lucide-react'
import { getStoredAuthToken } from '../../../services/authApi'
import { fetchPdfAnnotations, syncPdfAnnotations } from '../../../services/pdfAnnotationApi'
import { getPaperFileUrl } from '../../../services/paperReaderApi'
import { createPdfAnnotationQueue } from '../pdfAnnotationQueue'
import {
  DEFAULT_MARKUP_OPTIONS,
  QUICK_MARKUP_COLOR_PALETTE,
} from '../pdfMarkupStyleModel'
import {
  buildSyncBatch,
  createDeleteOperation,
  createUpsertOperation,
  deriveSyncStatus,
  normalizeServerDocument,
  replayPendingOperations,
} from '../pdfAnnotationSyncModel'
import './embedPdfViewport.css'
import { EMBEDPDF_PDFIUM_WASM_URL } from './embedPdfAssets'
import { EmbedPdfCaptureTools, EmbedPdfMarqueeCapture } from './EmbedPdfCaptureTools'
import { filterSafeSelectionRects } from './embedPdfSelectionGeometry'

const logger = new ConsoleLogger()
const annotationQueue = createPdfAnnotationQueue()
const TOOL_MAP = Object.freeze({
  select: null,
  highlight: 'highlight',
  strikeout: 'strikeout',
  underline: 'underline',
  squiggly: 'squiggly',
  text: 'freeText',
  line: 'line',
  arrow: 'lineArrow',
  rect: 'square',
  circle: 'circle',
  pin: 'textComment',
  comment: 'textComment',
  ink: 'ink',
  ink_highlighter: 'inkHighlighter',
})
const DEFAULT_INK_OPTIONS = { color: '#15803D', opacity: 0.85, strokeWidth: 6 }
const DEFAULT_SHAPE_OPTIONS = { color: '#2563EB', strokeWidth: 2, fontSize: 16 }
const EXCLUSIVE_CREATION_MODES = Object.freeze([
  ['highlight', 'text'],
  ['underline', 'text'],
  ['strikeout', 'text'],
  ['squiggly', 'text'],
  ['freeText', 'text'],
  ['line', 'crosshair'],
  ['lineArrow', 'crosshair'],
  ['square', 'crosshair'],
  ['circle', 'crosshair'],
  ['textComment', 'crosshair'],
])

function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation))
}

function createAnnotationId() {
  return globalThis.crypto?.randomUUID?.()
    || `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function restoreAnnotationDates(annotation) {
  const restored = { ...annotation }
  if (typeof restored.created === 'string') restored.created = new Date(restored.created)
  if (typeof restored.modified === 'string') restored.modified = new Date(restored.modified)
  return restored
}

function buildSelectionPayload(text, selections) {
  const first = selections[0]
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    pageNumber: (first?.pageIndex ?? 0) + 1,
    startChar: 0,
    endChar: 0,
    rects: first?.segmentRects || [],
    anchorRect: first?.rect || null,
    contextBefore: '',
    contextAfter: '',
  }
}

function getClientRectSnapshot(element) {
  const rect = element?.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function SafeSelectionVisuals({ documentId, pageIndex }) {
  const { provides: selectionCapability } = useSelectionCapability()
  const documentState = useDocumentState(documentId)
  const [rects, setRects] = useState([])
  const selectionScope = useMemo(
    () => selectionCapability?.forDocument(documentId) || null,
    [documentId, selectionCapability],
  )
  const page = documentState?.document?.pages?.[pageIndex]
  const scale = documentState?.scale ?? 1

  useEffect(() => {
    if (!selectionScope) return undefined
    const refreshRects = () => {
      setRects(selectionScope.getHighlightRectsForPage(pageIndex) || [])
    }
    refreshRects()
    return selectionScope.onSelectionChange(refreshRects)
  }, [pageIndex, selectionScope])

  const safeRects = useMemo(
    () => filterSafeSelectionRects(rects, page?.size),
    [page?.size, rects],
  )

  return safeRects.map((selectionRect, index) => (
    <div
      // Selection rectangles have no stable IDs; geometry makes the key stable
      // enough across the short lifetime of a browser selection.
      key={`${selectionRect.origin.x}:${selectionRect.origin.y}:${index}`}
      aria-hidden="true"
      className="embedpdf-safe-selection-rect"
      style={{
        left: selectionRect.origin.x * scale,
        top: selectionRect.origin.y * scale,
        width: selectionRect.size.width * scale,
        height: selectionRect.size.height * scale,
      }}
    />
  ))
}

function SelectionQuickMenu({
  documentId,
  menuWrapperProps,
  placement,
  rect,
  onSelect,
  onAskAI,
  onInsertSelectionNote,
  markupOptions,
}) {
  const { provides: selectionCapability } = useSelectionCapability()
  const { provides: annotationCapability } = useAnnotationCapability()
  const [activeColor, setActiveColor] = useState(markupOptions.color)
  const menuWrapperRef = useRef(null)

  const selectionScope = useMemo(
    () => selectionCapability?.forDocument(documentId) || null,
    [documentId, selectionCapability],
  )
  const annotationScope = useMemo(
    () => annotationCapability?.forDocument(documentId) || null,
    [annotationCapability, documentId],
  )

  const readPayload = useCallback(async () => {
    if (!selectionScope) return null
    // EmbedPDF can publish the menu before its text cache is populated. A short
    // retry keeps follow translation from missing a valid user selection.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const selections = selectionScope.getFormattedSelection()
      const parts = await selectionScope.getSelectedText().toPromise()
      const payload = buildSelectionPayload(parts.join(' '), selections)
      if (payload.text) return { payload, selections }
      if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 20))
    }
    return null
  }, [selectionScope])

  useEffect(() => {
    let cancelled = false
    readPayload()
      .then((result) => {
        if (!cancelled && result) {
          onSelect?.({
            ...result.payload,
            anchorElement: menuWrapperRef.current,
            anchorClientRect: getClientRectSnapshot(menuWrapperRef.current),
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [placement, readPayload, onSelect])

  async function createMarkup(toolId) {
    if (!annotationCapability || !annotationScope || !selectionScope) return
    const result = await readPayload()
    if (!result) return
    const tool = annotationCapability.getTool(toolId)
    if (!tool) return

    for (const selection of result.selections) {
      annotationScope.createAnnotation(selection.pageIndex, {
        ...tool.defaults,
        id: createAnnotationId(),
        pageIndex: selection.pageIndex,
        rect: selection.rect,
        segmentRects: selection.segmentRects,
        strokeColor: activeColor,
        color: activeColor,
        opacity: markupOptions.opacity,
        created: new Date(),
        custom: { text: result.payload.text },
      })
    }
    selectionScope.clear()
  }

  async function copySelection() {
    selectionScope?.copyToClipboard()
    selectionScope?.clear()
  }

  async function runBusinessAction(action) {
    const result = await readPayload()
    if (!result) return
    if (action === 'note') onInsertSelectionNote?.(result.payload)
    if (action === 'ai') {
      onSelect?.({
        ...result.payload,
        anchorElement: menuWrapperRef.current,
        anchorClientRect: getClientRectSnapshot(menuWrapperRef.current),
      })
      onAskAI?.(result.payload.text)
    }
  }

  const menuStyle = placement.suggestTop
    ? { position: 'absolute', pointerEvents: 'auto', top: -52 }
    : { position: 'absolute', pointerEvents: 'auto', top: rect.size.height + 8 }

  return (
    <div
      {...menuWrapperProps}
      ref={(element) => {
        menuWrapperRef.current = element
        menuWrapperProps.ref?.(element)
      }}
    >
      <div className="embedpdf-selection-menu" style={menuStyle}>
        <div className="embedpdf-selection-menu__colors">
          {QUICK_MARKUP_COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={activeColor === color ? 'is-active' : ''}
              style={{ '--selection-color': color }}
              aria-label={`批注颜色 ${color}`}
              onClick={() => setActiveColor(color)}
            />
          ))}
        </div>
        <button type="button" title="高亮" onClick={() => createMarkup('highlight')}><Highlighter /></button>
        <button type="button" title="下划线" onClick={() => createMarkup('underline')}><Underline /></button>
        <button type="button" title="波浪线" onClick={() => createMarkup('squiggly')}><Waves /></button>
        <button type="button" title="复制" onClick={copySelection}><Copy /></button>
        <button type="button" title="插入笔记" onClick={() => runBusinessAction('note')}><MessageSquareText /></button>
        <button type="button" title="AI 解读" onClick={() => runBusinessAction('ai')}><Bot /></button>
      </div>
    </div>
  )
}

function AnnotationQuickMenu({ documentId, selected, context, menuWrapperProps, rect }) {
  const { provides: annotationCapability } = useAnnotationCapability()
  const annotationScope = annotationCapability?.forDocument(documentId)
  const annotation = context.annotation.object
  const toolId = annotationScope?.findToolForAnnotation(annotation)?.id
  const [commentText, setCommentText] = useState(() => String(annotation.contents || ''))
  if (!selected) return null

  function stopMenuPointer(event) {
    // Annotation selection is handled on pointerdown. Keep menu presses from
    // reaching the page and deselecting the annotation before click fires.
    event.stopPropagation()
  }

  function saveComment() {
    annotationScope?.updateAnnotation(context.pageIndex, annotation.id, {
      contents: commentText.trim(),
      modified: new Date(),
    })
  }

  return (
    <div
      {...menuWrapperProps}
      style={{
        ...menuWrapperProps.style,
        pointerEvents: 'auto',
        zIndex: 100,
      }}
      onPointerDown={stopMenuPointer}
    >
      <div
        className={`embedpdf-annotation-menu${toolId === 'textComment' ? ' is-comment' : ''}`}
        // AnnotationLayer's wrapper is intentionally pointer-transparent so it
        // does not block page selection. The menu itself must opt back in or
        // inputs and delete actions can render while receiving no mouse event.
        style={{ top: rect.size.height + 8, pointerEvents: 'auto' }}
      >
        {toolId === 'textComment' ? (
          <div className="embedpdf-comment-editor">
            <label htmlFor={`pdf-comment-${annotation.id}`}>评论</label>
            <textarea
              id={`pdf-comment-${annotation.id}`}
              autoFocus
              rows="3"
              placeholder="输入评论内容"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveComment()
              }}
            />
            <div className="embedpdf-comment-editor__actions">
              <span>Ctrl+Enter 保存</span>
              <button
                type="button"
                className="embedpdf-comment-editor__save"
                aria-label="保存评论"
                onClick={saveComment}
              >
                保存
              </button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          title="删除批注"
          aria-label="删除批注"
          onPointerDown={stopMenuPointer}
          onClick={() => annotationScope?.deleteAnnotation(context.pageIndex, annotation.id)}
        >
          <Trash2 />
        </button>
      </div>
    </div>
  )
}

function ToolBridge({ activeTool, documentId, inkOptions, markupOptions, shapeOptions }) {
  const { provides: annotationCapability } = useAnnotationCapability()
  const { provides: selectionCapability } = useSelectionCapability()
  const { provides: interactionCapability } = useInteractionManagerCapability()

  useEffect(() => {
    if (!selectionCapability) return
    // EmbedPDF does not enable text hit-testing for its default pointer mode
    // automatically. Without this explicit binding drag selection can appear
    // intermittent because only programmatic/search selections still work.
    selectionCapability.enableForMode('pointerMode', {
      enableSelection: true,
      showSelectionRects: true,
    }, documentId)
    // AnnotationPlugin registers these modes during document loading, which
    // can occur before the selection document state exists in our direct
    // PDFium setup. Bind them again against the concrete document so toolbar
    // markup tools always receive text drag events.
    for (const modeId of ['highlight', 'underline', 'strikeout', 'squiggly']) {
      selectionCapability.enableForMode(modeId, {
        enableSelection: true,
        showSelectionRects: false,
        enableMarquee: false,
      }, documentId)
    }
  }, [documentId, selectionCapability])

  useEffect(() => {
    if (!interactionCapability) return
    // EmbedPDF's stock UI supplies its own event surface for non-exclusive
    // shape tools. Our headless layer stack does not, so pointer events can
    // land on a render/selection child before reaching the creation handler.
    // An explicit page overlay is only active while one of these tools is
    // selected; pointer mode remains available for selecting and editing.
    for (const [id, cursor] of EXCLUSIVE_CREATION_MODES) {
      interactionCapability.registerMode({
        id,
        scope: 'page',
        exclusive: true,
        cursor,
      })
    }
  }, [interactionCapability])

  useEffect(() => {
    if (!annotationCapability) return
    annotationCapability.setToolDefaults('highlight', {
      strokeColor: markupOptions.color,
      color: markupOptions.color,
      opacity: markupOptions.opacity,
    })
    for (const toolId of ['underline', 'strikeout', 'squiggly']) {
      annotationCapability.setToolDefaults(toolId, {
        strokeColor: markupOptions.color,
        color: markupOptions.color,
        opacity: markupOptions.opacity,
      })
    }
    annotationCapability.setToolDefaults('ink', {
      strokeColor: inkOptions.color,
      color: inkOptions.color,
      opacity: inkOptions.opacity,
      strokeWidth: inkOptions.strokeWidth,
    })
    // Use EmbedPDF's native freehand highlighter. It includes Multiply
    // blending and smart straight-line recognition from the tested snippet.
    annotationCapability.setToolDefaults('inkHighlighter', {
      strokeColor: markupOptions.color,
      color: markupOptions.color,
      opacity: markupOptions.opacity,
      strokeWidth: markupOptions.strokeWidth,
    })
  }, [
    annotationCapability,
    inkOptions.color,
    inkOptions.opacity,
    inkOptions.strokeWidth,
    markupOptions.color,
    markupOptions.opacity,
    markupOptions.strokeWidth,
  ])

  useEffect(() => {
    if (!annotationCapability) return
    annotationCapability.setToolDefaults('freeText', {
      fontColor: shapeOptions.color,
      fontSize: shapeOptions.fontSize,
    })
    annotationCapability.setToolDefaults('textComment', { strokeColor: shapeOptions.color })
    for (const toolId of ['line', 'lineArrow', 'square', 'circle']) {
      annotationCapability.setToolDefaults(toolId, {
        strokeColor: shapeOptions.color,
        strokeWidth: shapeOptions.strokeWidth,
      })
    }
  }, [annotationCapability, shapeOptions.color, shapeOptions.fontSize, shapeOptions.strokeWidth])

  useEffect(() => {
    const annotationScope = annotationCapability?.forDocument(documentId)
    if (!annotationScope) return
    if (activeTool !== 'select') {
      // A previous text range or selected annotation keeps its own pointer
      // surface. Clear both before authoring so switching tools never leaves
      // an invisible layer that makes drawing work only intermittently.
      selectionCapability?.forDocument(documentId)?.clear()
      annotationScope.deselectAnnotation()
    }
    annotationScope.setActiveTool(Object.hasOwn(TOOL_MAP, activeTool) ? TOOL_MAP[activeTool] : null)
  }, [activeTool, annotationCapability, documentId, selectionCapability])

  useEffect(() => {
    const interactionScope = interactionCapability?.forDocument(documentId)
    const root = document.querySelector(`[data-embedpdf-document-id="${CSS.escape(documentId)}"]`)
    if (!interactionScope || !root) return undefined
    function publishMode() {
      root.dataset.embedpdfActiveMode = interactionScope.getActiveMode()
      root.dataset.embedpdfActiveExclusive = String(interactionScope.activeModeIsExclusive())
      root.dataset.embedpdfRequestedTool = activeTool
    }
    publishMode()
    return interactionScope.onModeChange(publishMode)
  }, [activeTool, documentId, interactionCapability])

  return null
}

function ReaderControllerBridge({
  documentId,
  searchTerm,
  onControllerReady,
  onViewerStateChange,
}) {
  const { state: zoomState, provides: zoomScope } = useZoom(documentId)
  const { state: scrollState, provides: scrollScope } = useScroll(documentId)
  const { provides: viewportCapability } = useViewportCapability()
  const { state: searchState, provides: searchScope } = useSearch(documentId)
  const { provides: historyCapability } = useHistoryCapability()
  const { provides: annotationCapability } = useAnnotationCapability()
  const { provides: exportCapability } = useExportCapability()
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [annotationCount, setAnnotationCount] = useState(0)
  const historyScope = useMemo(
    () => historyCapability?.forDocument(documentId) || null,
    [documentId, historyCapability],
  )
  const annotationScope = useMemo(
    () => annotationCapability?.forDocument(documentId) || null,
    [annotationCapability, documentId],
  )
  const exportScope = useMemo(
    () => exportCapability?.forDocument(documentId) || null,
    [documentId, exportCapability],
  )
  const viewportScope = useMemo(
    () => viewportCapability?.forDocument(documentId) || null,
    [documentId, viewportCapability],
  )

  useEffect(() => {
    if (!historyScope) return undefined
    function updateHistoryState() {
      const historyState = historyScope.getHistoryState().global
      setCanUndo(Boolean(historyState.canUndo))
      setCanRedo(Boolean(historyState.canRedo))
    }
    updateHistoryState()
    return historyScope.onHistoryChange(updateHistoryState)
  }, [historyScope])

  useEffect(() => {
    if (!annotationScope) return undefined
    function updateAnnotationCount() {
      setAnnotationCount(annotationScope.getAnnotations().length)
    }
    updateAnnotationCount()
    return annotationScope.onAnnotationEvent(updateAnnotationCount)
  }, [annotationScope])

  useEffect(() => {
    if (!searchScope) return
    if (searchTerm?.trim()) searchScope.searchAllPages(searchTerm.trim())
    else searchScope.stopSearch()
  }, [searchScope, searchTerm])

  useEffect(() => {
    if (!zoomScope || !scrollScope || !viewportScope || !searchScope || !historyScope || !exportScope) return undefined
    onControllerReady?.({
      zoomIn: () => zoomScope.zoomIn(),
      zoomOut: () => zoomScope.zoomOut(),
      setZoom: (zoomLevel) => zoomScope.requestZoom(zoomLevel),
      searchNext: () => searchScope.nextResult(),
      searchPrevious: () => searchScope.previousResult(),
      undo: () => historyScope.undo(),
      redo: () => historyScope.redo(),
      scrollToPage: (pageNumber) => scrollScope.scrollToPage({ pageNumber }),
      scrollToOffset: ({ x = 0, y = 0, behavior = 'instant' } = {}) => {
        viewportScope.scrollTo({ x, y, behavior })
      },
      exportPdf: () => exportScope.saveAsCopy().toPromise(),
    })
    return () => onControllerReady?.(null)
  }, [exportScope, historyScope, onControllerReady, scrollScope, searchScope, viewportScope, zoomScope])

  useEffect(() => {
    function publishViewerState() {
      let metrics = null
      try {
        metrics = viewportScope?.getMetrics?.() || null
      } catch {
        // The viewport can briefly exist before its first layout is committed.
        // Keep page/zoom state available while waiting for usable metrics.
      }
      const scrollHeight = Number(metrics?.scrollHeight) || 0
      const clientHeight = Number(metrics?.clientHeight) || 0
      const scrollTop = Math.max(0, Number(metrics?.scrollTop) || 0)
      onViewerStateChange?.({
        pageNumber: scrollState.currentPage || 1,
        totalPages: scrollState.totalPages || 0,
        scrollTop,
        scrollHeight,
        clientHeight,
        maxScrollTop: Math.max(0, scrollHeight - clientHeight),
        scale: zoomState.currentZoomLevel || 1,
        matchIndex: Math.max(0, searchState.activeResultIndex || 0),
        totalMatches: searchState.total || 0,
        canUndo,
        canRedo,
        annotationCount,
      })
    }

    publishViewerState()
    if (!viewportScope) return undefined
    return viewportScope.onScrollChange(publishViewerState)
  }, [
    annotationCount,
    canUndo,
    canRedo,
    onViewerStateChange,
    scrollState.currentPage,
    scrollState.totalPages,
    searchState.activeResultIndex,
    searchState.total,
    viewportScope,
    zoomState.currentZoomLevel,
  ])

  return null
}

function PdfWheelZoomBridge({ documentId }) {
  const { provides: zoomScope } = useZoom(documentId)

  useEffect(() => {
    if (!zoomScope) return undefined
    const root = document.querySelector(`[data-embedpdf-document-id="${CSS.escape(documentId)}"]`)
    if (!root) return undefined
    let lastZoomAt = 0

    function handleWheel(event) {
      if (!event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()

      // Trackpads emit a burst of Ctrl+wheel events. Throttling keeps the
      // PDF zoom smooth while still preventing Chromium's whole-page zoom.
      const now = performance.now()
      if (now - lastZoomAt < 55) return
      lastZoomAt = now
      if (event.deltaY < 0) zoomScope.zoomIn()
      else if (event.deltaY > 0) zoomScope.zoomOut()
    }

    root.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => root.removeEventListener('wheel', handleWheel, { capture: true })
  }, [documentId, zoomScope])

  return null
}

function AnnotationSyncBridge({ documentId, ownerKey, paperId, onStatusChange }) {
  const { provides: annotationCapability } = useAnnotationCapability()
  const revisionRef = useRef(0)
  const versionsRef = useRef(new Map())
  const initializedRef = useRef(false)
  const syncingRef = useRef(false)
  const retryTimerRef = useRef(null)
  const [syncSnapshot, setSyncSnapshot] = useState({
    pendingCount: 0,
    isSyncing: false,
    isOnline: navigator.onLine,
    error: null,
    conflicts: [],
  })

  const annotationScope = useMemo(
    () => annotationCapability?.forDocument(documentId) || null,
    [annotationCapability, documentId],
  )

  const publishSnapshot = useCallback((partial) => {
    setSyncSnapshot((current) => ({ ...current, ...partial }))
  }, [])

  const flushQueue = useCallback(async function flushPendingAnnotations() {
    if (!annotationScope || !initializedRef.current || syncingRef.current) return
    if (!navigator.onLine) {
      publishSnapshot({ isOnline: false })
      return
    }

    const operations = await annotationQueue.list(ownerKey, paperId)
    if (!operations.length) {
      publishSnapshot({ pendingCount: 0, isSyncing: false, error: null })
      return
    }

    const batch = buildSyncBatch(revisionRef.current, operations)
    const sentOperations = operations.slice(0, batch.operationIds.length)
    syncingRef.current = true
    publishSnapshot({ pendingCount: operations.length, isSyncing: true, isOnline: true, error: null })

    try {
      const response = normalizeServerDocument(await syncPdfAnnotations(paperId, batch.payload))
      revisionRef.current = response.revision
      versionsRef.current = response.versions
      const appliedSet = new Set(response.appliedUids)
      const appliedOperations = sentOperations.filter((item) => appliedSet.has(item.uid))
      await Promise.all([
        annotationQueue.acknowledge(ownerKey, paperId, appliedOperations, response.versions),
        annotationQueue.setDocument(ownerKey, paperId, response),
      ])
      const remaining = await annotationQueue.list(ownerKey, paperId)
      publishSnapshot({
        pendingCount: remaining.length,
        isSyncing: false,
        error: null,
        conflicts: response.conflicts,
      })
      if (remaining.length && !response.conflicts.length) {
        retryTimerRef.current = setTimeout(flushPendingAnnotations, 0)
      }
    } catch (error) {
      publishSnapshot({ isSyncing: false, error })
      // 在线状态也可能遇到短暂的网关或数据库故障。不能只等用户
      // 再画一笔才重试，否则界面会长期停在“保存失败”。
      if (navigator.onLine) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(flushPendingAnnotations, 5000)
      }
    } finally {
      syncingRef.current = false
    }
  }, [annotationScope, ownerKey, paperId, publishSnapshot])

  const scheduleFlush = useCallback(() => {
    clearTimeout(retryTimerRef.current)
    retryTimerRef.current = setTimeout(flushQueue, 500)
  }, [flushQueue])

  useEffect(() => {
    if (!annotationScope) return undefined
    const abortController = new AbortController()

    Promise.allSettled([
      fetchPdfAnnotations(paperId, { signal: abortController.signal }),
      annotationQueue.getDocument(ownerKey, paperId),
      annotationQueue.list(ownerKey, paperId),
    ])
      .then(async ([serverResult, cacheResult, pendingResult]) => {
        if (abortController.signal.aborted) return
        const pending = pendingResult.status === 'fulfilled' ? pendingResult.value : []
        const cached = cacheResult.status === 'fulfilled' ? cacheResult.value : { revision: 0, annotations: [] }
        const server = serverResult.status === 'fulfilled'
          ? normalizeServerDocument(serverResult.value)
          : normalizeServerDocument({
              schema_version: cached.schemaVersion,
              revision: cached.revision,
              annotations: cached.annotations,
            })
        const visibleAnnotations = replayPendingOperations(server.annotations, pending)
        revisionRef.current = server.revision
        versionsRef.current = server.versions
        if (visibleAnnotations.length) {
          annotationScope.importAnnotations(
            visibleAnnotations.map((item) => ({ annotation: restoreAnnotationDates(item.payload) })),
          )
        }
        if (serverResult.status === 'fulfilled') {
          await annotationQueue.setDocument(ownerKey, paperId, server)
        }
        initializedRef.current = true
        publishSnapshot({
          pendingCount: pending.length,
          error: serverResult.status === 'rejected' ? serverResult.reason : null,
          conflicts: [],
        })
        if (pending.length && navigator.onLine) scheduleFlush()
      })
      .catch((error) => {
        if (!abortController.signal.aborted) publishSnapshot({ error })
      })

    return () => {
      abortController.abort()
      initializedRef.current = false
    }
  }, [annotationScope, ownerKey, paperId, publishSnapshot, scheduleFlush])

  useEffect(() => {
    if (!annotationScope) return undefined
    return annotationScope.onAnnotationEvent((event) => {
      if (!initializedRef.current || event.type === 'loaded') return
      const baseVersion = versionsRef.current.get(event.annotation.id) || 0
      const operation = event.type === 'delete'
        ? createDeleteOperation({ ownerKey, paperId, uid: event.annotation.id, baseVersion })
        : createUpsertOperation({
            ownerKey,
            paperId,
            annotation: {
              uid: event.annotation.id,
              pageIndex: event.pageIndex,
              annotationType: annotationScope.findToolForAnnotation(event.annotation)?.id || 'textComment',
              payload: cloneAnnotation(event.annotation),
            },
            baseVersion,
          })

      annotationQueue.put(operation)
        .then(() => annotationQueue.list(ownerKey, paperId))
        .then((items) => {
          publishSnapshot({ pendingCount: items.length, error: null })
          scheduleFlush()
        })
        .catch((error) => publishSnapshot({ error }))
    })
  }, [annotationScope, ownerKey, paperId, publishSnapshot, scheduleFlush])

  useEffect(() => {
    function handleOnline() {
      publishSnapshot({ isOnline: true })
      scheduleFlush()
    }
    function handleOffline() {
      publishSnapshot({ isOnline: false })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearTimeout(retryTimerRef.current)
    }
  }, [publishSnapshot, scheduleFlush])

  const status = deriveSyncStatus(syncSnapshot)
  useEffect(() => {
    onStatusChange?.({ status, ...syncSnapshot })
  }, [onStatusChange, status, syncSnapshot])

  return null
}

function EmbedPdfThumbnailPortal({ documentId, host }) {
  const { provides: scrollScope, state: scrollState } = useScroll(documentId)

  if (!host) return null

  return createPortal(
    <ThumbnailsPane
      className="embedpdf-thumbnail-panel__scroll"
      documentId={documentId}
    >
      {(meta) => {
        const pageNumber = meta.pageIndex + 1
        const isActive = scrollState.currentPage === pageNumber
        return (
          <button
            aria-current={isActive ? 'page' : undefined}
            aria-label={`跳转到第 ${pageNumber} 页`}
            className={`embedpdf-thumbnail-panel__item${isActive ? ' is-active' : ''}`}
            key={meta.pageIndex}
            onClick={() => scrollScope?.scrollToPage({ pageNumber, behavior: 'smooth' })}
            style={{ height: meta.wrapperHeight, top: meta.top }}
            type="button"
          >
            <span
              className="embedpdf-thumbnail-panel__image"
              style={{ height: meta.height, width: meta.width }}
            >
              <ThumbImg
                alt=""
                documentId={documentId}
                draggable={false}
                meta={meta}
                style={{ height: meta.height, width: meta.width }}
              />
            </span>
            <span className="embedpdf-thumbnail-panel__label">{pageNumber}</span>
          </button>
        )
      }}
    </ThumbnailsPane>,
    host,
  )
}

function bookmarkPageNumber(bookmark) {
  const target = bookmark?.target || {}
  const destination = target.destination || target.action?.destination || {}
  const candidates = [destination.pageNumber, destination.pageIndex, destination.page, destination.page?.index]
  for (const value of candidates) {
    const page = Number(value)
    if (!Number.isInteger(page)) continue
    // EmbedPDF destinations are normally zero-indexed. A pageNumber is already
    // one-indexed, while a pageIndex/page field is an internal zero-based index.
    if (value === destination.pageNumber) return page > 0 ? page : null
    return page >= 0 ? page + 1 : null
  }
  return null
}

function normalizeBookmarks(bookmarks) {
  if (!Array.isArray(bookmarks)) return []
  return bookmarks
    .map((bookmark) => ({
      // Bookmark titles are the PDF's original wording. The reader later adds a
      // cached Chinese interpretation while preserving this exact English label.
      title_cn: '',
      title_en: String(bookmark?.title || '').trim(),
      page: bookmarkPageNumber(bookmark),
      children: normalizeBookmarks(bookmark?.children),
    }))
    .filter((bookmark) => bookmark.title_en || bookmark.children.length)
}

function EmbedPdfOutlineBridge({ documentId, onOutlineChange }) {
  const { provides: bookmarkCapability } = useBookmarkCapability()

  useEffect(() => {
    const scope = bookmarkCapability?.forDocument(documentId)
    if (!scope) return undefined
    let cancelled = false
    onOutlineChange?.({ status: 'loading', items: [] })
    Promise.resolve()
      .then(() => scope.getBookmarks().toPromise())
      .then((result) => {
        if (!cancelled) onOutlineChange?.({ status: 'ready', items: normalizeBookmarks(result?.bookmarks) })
      })
      .catch(() => {
        // A malformed native outline is treated the same as an absent outline,
        // so the reader can offer the safe AI-generated fallback.
        if (!cancelled) onOutlineChange?.({ status: 'ready', items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [bookmarkCapability, documentId, onOutlineChange])

  return null
}

function PdfiumDocument({
  activeDocumentId,
  activeTool,
  inkOptions,
  markupOptions,
  shapeOptions,
  ownerKey,
  paperId,
  onSelect,
  onAskAI,
  onInsertSelectionNote,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
  onSyncStatusChange,
  searchTerm,
  onControllerReady,
  onViewerStateChange,
  onViewerNavigationIntent,
  thumbnailHost,
  onNativeOutlineChange,
  readOnly = false,
}) {
  return (
    <DocumentContent documentId={activeDocumentId}>
      {({ isLoading, isError, isLoaded }) => (
        <>
          {isLoading ? <div className="embedpdf-state">正在加载 PDFium 文档…</div> : null}
          {isError ? <div className="embedpdf-state is-error">PDF 文档加载失败，请返回旧引擎重试。</div> : null}
          {isLoaded ? (
            <GlobalPointerProvider documentId={activeDocumentId}>
              <div
                className="embedpdf-document-shell"
                data-embedpdf-document-id={activeDocumentId}
                onKeyDownCapture={onViewerNavigationIntent}
                onPointerDownCapture={onViewerNavigationIntent}
                onWheelCapture={onViewerNavigationIntent}
              >
              <Viewport className="embedpdf-viewport" documentId={activeDocumentId}>
                <Scroller
                  documentId={activeDocumentId}
                  renderPage={({ pageIndex }) => (
                    <Rotate
                      documentId={activeDocumentId}
                      pageIndex={pageIndex}
                      className="embedpdf-page"
                      data-embedpdf-page-index={pageIndex}
                    >
                      <PagePointerProvider documentId={activeDocumentId} pageIndex={pageIndex}>
                        <RenderLayer documentId={activeDocumentId} pageIndex={pageIndex} scale={1} style={{ pointerEvents: 'none' }} />
                        <TilingLayer documentId={activeDocumentId} pageIndex={pageIndex} style={{ pointerEvents: 'none' }} />
                        <SearchLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                        {!readOnly ? (
                          <>
                            <SelectionLayer
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                              textStyle={{ background: 'transparent' }}
                              selectionMenu={(props) => (
                                <SelectionQuickMenu
                                  {...props}
                                  documentId={activeDocumentId}
                                  onSelect={onSelect}
                                  onAskAI={onAskAI}
                                  onInsertSelectionNote={onInsertSelectionNote}
                                  markupOptions={markupOptions}
                                />
                              )}
                            />
                            <SafeSelectionVisuals
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                            />
                            <AnnotationLayer
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                              selectionMenu={(props) => (
                                <AnnotationQuickMenu {...props} documentId={activeDocumentId} />
                              )}
                            />
                            <EmbedPdfMarqueeCapture documentId={activeDocumentId} pageIndex={pageIndex} />
                          </>
                        ) : null}
                      </PagePointerProvider>
                    </Rotate>
                  )}
                />
              </Viewport>
              </div>
              {!readOnly ? (
                <>
                  <ToolBridge
                    activeTool={activeTool}
                    documentId={activeDocumentId}
                    inkOptions={inkOptions}
                    markupOptions={markupOptions}
                    shapeOptions={shapeOptions}
                  />
                  <EmbedPdfCaptureTools
                    activeTool={activeTool}
                    documentId={activeDocumentId}
                    onScreenshotTranslate={onScreenshotTranslate}
                    onScreenshotAskAI={onScreenshotAskAI}
                    onScreenshotInsertNote={onScreenshotInsertNote}
                  />
                </>
              ) : null}
              <ReaderControllerBridge
                documentId={activeDocumentId}
                searchTerm={searchTerm}
                onControllerReady={onControllerReady}
                onViewerStateChange={onViewerStateChange}
              />
              <PdfWheelZoomBridge documentId={activeDocumentId} />
              <EmbedPdfOutlineBridge documentId={activeDocumentId} onOutlineChange={onNativeOutlineChange} />
              {!readOnly ? (
                <AnnotationSyncBridge
                  documentId={activeDocumentId}
                  ownerKey={ownerKey}
                  paperId={paperId}
                  onStatusChange={onSyncStatusChange}
                />
              ) : null}
              {thumbnailHost ? <EmbedPdfThumbnailPortal documentId={activeDocumentId} host={thumbnailHost} /> : null}
            </GlobalPointerProvider>
          ) : null}
        </>
      )}
    </DocumentContent>
  )
}

export function EmbedPdfViewport({
  activeTool,
  inkOptions = DEFAULT_INK_OPTIONS,
  markupOptions = DEFAULT_MARKUP_OPTIONS,
  shapeOptions = DEFAULT_SHAPE_OPTIONS,
  currentPaperId,
  annotationOwnerKey,
  onSelect,
  onAskAI,
  onInsertSelectionNote,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
  searchTerm,
  onControllerReady,
  onViewerStateChange,
  onViewerNavigationIntent,
  thumbnailHost,
  onNativeOutlineChange,
  documentUrl,
  documentName,
  externalDocumentId,
  readOnly = false,
}) {
  const [syncStatus, setSyncStatus] = useState({ status: 'saved', pendingCount: 0 })
  const [annotationCount, setAnnotationCount] = useState(0)
  const handleViewerStateChange = useCallback((state) => {
    setAnnotationCount(state.annotationCount)
    onViewerStateChange?.(state)
  }, [onViewerStateChange])
  const token = getStoredAuthToken()
  const documentId = externalDocumentId || `xk-paper-${currentPaperId}`
  const ownerKey = `user-${annotationOwnerKey}`
  const { engine, isLoading, error } = usePdfiumEngine({
    wasmUrl: EMBEDPDF_PDFIUM_WASM_URL,
    // EmbedPDF 2.15.0 worker stalls under the current Vite 8 build. The direct
    // engine is fully local and passed the real render/selection smoke test.
    worker: false,
    fontFallback: null,
  })

  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, {
      initialDocuments: [{
        url: documentUrl || getPaperFileUrl(currentPaperId),
        documentId,
        name: documentName || `paper-${currentPaperId}.pdf`,
        requestOptions: {
          credentials: 'same-origin',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      }],
    }),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
    createPluginRegistration(ScrollPluginPackage, { defaultStrategy: ScrollStrategy.Vertical }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
    // The package runtime currently defaults pan to `mobile` even though its
    // public type docs say `never`. Force pointer mode so touch-capable laptops
    // do not silently turn the selection cursor into a grab hand.
    createPluginRegistration(PanPluginPackage, { defaultMode: 'never' }),
    createPluginRegistration(SpreadPluginPackage, { defaultSpreadMode: SpreadMode.None }),
    createPluginRegistration(RotatePluginPackage),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 0 }),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      tools: [{
        id: 'inkHighlighter',
        behavior: {
          // PDFium 2.15 can return an empty appearance stream immediately
          // after an ink highlight commit. Keep the tested vector renderer
          // active so the stroke remains visible after pointerup and reload.
          useAppearanceStream: false,
        },
      }],
    }),
    createPluginRegistration(CapturePluginPackage, { scale: 2, withAnnotations: true }),
    createPluginRegistration(ThumbnailPluginPackage, { width: 120, paddingY: 10 }),
    createPluginRegistration(BookmarkPluginPackage),
    createPluginRegistration(ExportPluginPackage, { defaultFileName: `paper-${currentPaperId}-annotated.pdf` }),
  ], [currentPaperId, documentId, documentName, documentUrl, token])

  if ((!currentPaperId && !documentUrl) || (!readOnly && !annotationOwnerKey)) {
    return <div className="embedpdf-state is-error">缺少文献或账号信息，暂时不能启动新阅读器。</div>
  }
  if (error) return <div className="embedpdf-state is-error">PDFium 初始化失败：{error.message}</div>
  if (isLoading || !engine) return <div className="embedpdf-state">正在启动本地 PDFium 引擎…</div>

  return (
    <div className="embedpdf-reader-shell">
      {!readOnly ? (
        <div
          className={`embedpdf-sync-state is-${syncStatus.status}`}
          data-annotation-count={annotationCount}
        >
          {syncStatus.status === 'saved' ? '已保存' : null}
          {syncStatus.status === 'saving' ? `保存中${syncStatus.pendingCount ? ` · ${syncStatus.pendingCount}` : ''}` : null}
          {syncStatus.status === 'offline' ? `离线待同步 · ${syncStatus.pendingCount}` : null}
          {syncStatus.status === 'error' ? '保存失败，联网后自动重试' : null}
          {syncStatus.status === 'conflict' ? '发现多端冲突，请刷新确认' : null}
        </div>
      ) : null}
      <EmbedPDF engine={engine} logger={logger} plugins={plugins}>
        {({ pluginsReady, activeDocumentId }) => (
          pluginsReady && activeDocumentId ? (
            <PdfiumDocument
              activeDocumentId={activeDocumentId}
              activeTool={activeTool}
              inkOptions={inkOptions}
              markupOptions={markupOptions}
              shapeOptions={shapeOptions}
              ownerKey={ownerKey}
              paperId={currentPaperId}
              onSelect={onSelect}
              onAskAI={onAskAI}
              onInsertSelectionNote={onInsertSelectionNote}
              onScreenshotTranslate={onScreenshotTranslate}
              onScreenshotAskAI={onScreenshotAskAI}
              onScreenshotInsertNote={onScreenshotInsertNote}
              onSyncStatusChange={setSyncStatus}
              searchTerm={searchTerm}
              onControllerReady={onControllerReady}
              onViewerStateChange={handleViewerStateChange}
              onViewerNavigationIntent={onViewerNavigationIntent}
              thumbnailHost={thumbnailHost}
              onNativeOutlineChange={onNativeOutlineChange}
              readOnly={readOnly}
            />
          ) : <div className="embedpdf-state">正在初始化阅读器插件…</div>
        )}
      </EmbedPDF>
    </div>
  )
}
