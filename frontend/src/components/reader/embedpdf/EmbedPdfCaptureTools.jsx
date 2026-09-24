import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDocumentState } from '@embedpdf/core/react'
import { MarqueeCapture, useCaptureCapability } from '@embedpdf/plugin-capture/react'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react'
import { useSelectionCapability } from '@embedpdf/plugin-selection/react'
import { Download, X } from 'lucide-react'
import { ScreenshotFloatingMenu } from '../ScreenshotFloatingMenu'
import {
  annotationIntersectsRect,
  findTextRangeInRect,
  getAnnotationRects,
  normalizeCaptureRect,
  rectContainsPoint,
} from './embedPdfCaptureModel'

function buildDownloadFilename(pageNumber) {
  return `paper-screenshot-p${pageNumber}-${Date.now()}.png`
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('截图读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function readImageSize(blob) {
  if (typeof createImageBitmap !== 'function') return { width: 480, height: 320 }
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

function getCaptureMenuPosition(documentId, pageIndex, rect, pageSize) {
  const root = document.querySelector(`[data-embedpdf-document-id="${CSS.escape(documentId)}"]`)
  const pageElement = root?.querySelector(`[data-embedpdf-page-index="${pageIndex}"]`)
  const pageRect = pageElement?.getBoundingClientRect()
  if (!pageRect || !pageSize?.width || !pageSize?.height) {
    return { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 90, window.innerHeight / 2) }
  }
  const centerX = pageRect.left + ((rect.origin.x + rect.size.width / 2) / pageSize.width) * pageRect.width
  return {
    x: Math.max(292, Math.min(window.innerWidth - 292, centerX)),
    y: pageRect.top + ((rect.origin.y + rect.size.height) / pageSize.height) * pageRect.height + 8,
  }
}

/**
 * Reads the text covered by the screenshot rectangle through PDFium's glyph
 * geometry. Keeping this tied to the same geometry as text selection prevents
 * the old PDF.js and new PDFium coordinate systems from drifting apart.
 */
async function readCaptureText(selectionScope, pageIndex, rect) {
  const state = selectionScope?.getState()
  const range = findTextRangeInRect(state?.geometry?.[pageIndex], pageIndex, rect)
  if (!range) return { text: '', startChar: null, endChar: null }

  const previousSelection = state.selection
  try {
    await selectionScope.setSelection(range).toPromise()
    const parts = await selectionScope.getSelectedText().toPromise()
    return {
      text: parts.join(' ').replace(/\s+/g, ' ').trim(),
      startChar: range.start.index,
      endChar: range.end.index,
    }
  } finally {
    await selectionScope.setSelection(previousSelection || null).toPromise().catch(() => {})
  }
}

function PinnedCaptureLayer({ items, onChange }) {
  const dragRef = useRef(null)

  useEffect(() => {
    function handlePointerMove(event) {
      const drag = dragRef.current
      if (!drag) return
      const nextLeft = Math.max(8, Math.min(window.innerWidth - drag.width - 8, event.clientX - drag.offsetX))
      const nextTop = Math.max(8, Math.min(window.innerHeight - drag.height - 8, event.clientY - drag.offsetY))
      onChange((current) => current.map((item) => (
        item.id === drag.id ? { ...item, left: nextLeft, top: nextTop } : item
      )))
    }
    function handlePointerUp() {
      dragRef.current = null
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [onChange])

  if (!items.length) return null
  return createPortal(
    <div className="pdf-pinned-layer">
      {items.map((item) => (
        <div
          key={item.id}
          className="pdf-pinned-shot"
          data-pinned-id={item.id}
          style={{ left: item.left, top: item.top, width: item.width, height: item.height }}
          onPointerDown={(event) => {
            if (event.target.closest('button')) return
            const bounds = event.currentTarget.getBoundingClientRect()
            dragRef.current = {
              id: item.id,
              offsetX: event.clientX - bounds.left,
              offsetY: event.clientY - bounds.top,
              width: bounds.width,
              height: bounds.height,
            }
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }}
          onWheel={(event) => {
            event.preventDefault()
            const multiplier = event.deltaY < 0 ? 1.08 : 0.92
            onChange((current) => current.map((currentItem) => {
              if (currentItem.id !== item.id) return currentItem
              const width = Math.max(120, Math.min(window.innerWidth * 0.88, currentItem.width * multiplier))
              const height = width / currentItem.aspectRatio
              return { ...currentItem, width, height }
            }))
          }}
        >
          <img
            src={item.imageUrl}
            alt={`第 ${item.pageNumber} 页截图`}
            className="pdf-pinned-shot__image"
            draggable="false"
          />
          <div className="pdf-pinned-shot__overlay">
            <button
              type="button"
              className="pinned-btn"
              title="下载截图"
              onClick={() => {
                const link = document.createElement('a')
                link.href = item.imageUrl
                link.download = buildDownloadFilename(item.pageNumber)
                link.click()
              }}
            ><Download size={14} /></button>
            <button
              type="button"
              className="pinned-btn"
              title="关闭截图"
              onClick={() => onChange((current) => current.filter((currentItem) => currentItem.id !== item.id))}
            ><X size={14} /></button>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  )
}

function CaptureSelectionLayer({ capture, documentId }) {
  if (!capture?.rect || !capture?.pageSize) return null
  const root = document.querySelector(`[data-embedpdf-document-id="${CSS.escape(documentId)}"]`)
  const pageElement = root?.querySelector(`[data-embedpdf-page-index="${capture.pageIndex}"]`)
  if (!pageElement) return null

  const { rect, pageSize } = capture
  return createPortal(
    <div
      aria-hidden="true"
      className="embedpdf-capture-selection"
      style={{
        left: `${(rect.origin.x / pageSize.width) * 100}%`,
        top: `${(rect.origin.y / pageSize.height) * 100}%`,
        width: `${(rect.size.width / pageSize.width) * 100}%`,
        height: `${(rect.size.height / pageSize.height) * 100}%`,
      }}
    >
      <i className="embedpdf-capture-selection__handle is-nw" />
      <i className="embedpdf-capture-selection__handle is-ne" />
      <i className="embedpdf-capture-selection__handle is-se" />
      <i className="embedpdf-capture-selection__handle is-sw" />
    </div>,
    pageElement,
  )
}

export function EmbedPdfMarqueeCapture({ documentId, pageIndex }) {
  return <MarqueeCapture documentId={documentId} pageIndex={pageIndex} className="embedpdf-capture-marquee" />
}

export function EmbedPdfCaptureTools({
  activeTool,
  documentId,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
}) {
  const documentState = useDocumentState(documentId)
  const { provides: captureCapability } = useCaptureCapability()
  const { provides: selectionCapability } = useSelectionCapability()
  const { provides: annotationCapability } = useAnnotationCapability()
  const captureScope = useMemo(
    () => captureCapability?.forDocument(documentId) || null,
    [captureCapability, documentId],
  )
  const selectionScope = useMemo(
    () => selectionCapability?.forDocument(documentId) || null,
    [documentId, selectionCapability],
  )
  const annotationScope = useMemo(
    () => annotationCapability?.forDocument(documentId) || null,
    [annotationCapability, documentId],
  )
  const eventSequenceRef = useRef(0)
  const [capture, setCapture] = useState(null)
  const [pinnedCaptures, setPinnedCaptures] = useState([])
  const [previousActiveTool, setPreviousActiveTool] = useState(activeTool)

  // React's supported "adjust state while rendering" pattern prevents a
  // finished screenshot from reappearing when the user leaves and later
  // returns to the screenshot tool.
  if (previousActiveTool !== activeTool) {
    setPreviousActiveTool(activeTool)
    setCapture(null)
  }

  const closeCapture = useCallback((rearm = true) => {
    setCapture(null)
    if (rearm && activeTool === 'screenshot') captureScope?.enableMarqueeCapture()
  }, [activeTool, captureScope])

  useEffect(() => {
    if (!captureScope) return
    if (activeTool === 'screenshot' || activeTool === 'erase_box') captureScope.enableMarqueeCapture()
    // ToolBridge activates the annotation interaction mode for ink/shapes.
    // Calling disableMarqueeCapture() here would activate the default pointer
    // mode again and silently cancel every drawing tool.
  }, [activeTool, captureScope])

  useEffect(() => {
    if (activeTool !== 'eraser' || !annotationScope) return undefined
    const root = document.querySelector(`[data-embedpdf-document-id="${CSS.escape(documentId)}"]`)
    if (!root) return undefined
    let activePointerId = null

    function eraseAtPointer(event) {
      const pageElement = event.target.closest?.('[data-embedpdf-page-index]')
      if (!pageElement || !root.contains(pageElement)) return
      const pageIndex = Number(pageElement.dataset.embedpdfPageIndex)
      const pageSize = documentState?.document?.pages?.[pageIndex]?.size
      const bounds = pageElement.getBoundingClientRect()
      if (!pageSize?.width || !pageSize?.height || !bounds.width || !bounds.height) return
      const point = {
        x: ((event.clientX - bounds.left) / bounds.width) * pageSize.width,
        y: ((event.clientY - bounds.top) / bounds.height) * pageSize.height,
      }
      const tolerance = Math.max(pageSize.width / bounds.width, pageSize.height / bounds.height) * 7
      const hit = (annotationScope.getAnnotations({ pageIndex }) || []).find(({ object }) => (
        getAnnotationRects(object).some((rect) => rectContainsPoint(rect, point, tolerance))
      ))
      if (hit) annotationScope.deleteAnnotation(pageIndex, hit.object.id)
    }

    function handlePointerDown(event) {
      if (event.button !== 0) return
      activePointerId = event.pointerId
      eraseAtPointer(event)
      event.preventDefault()
      event.stopPropagation()
    }
    function handlePointerMove(event) {
      if (activePointerId !== event.pointerId || !(event.buttons & 1)) return
      eraseAtPointer(event)
      event.preventDefault()
      event.stopPropagation()
    }
    function handlePointerEnd(event) {
      if (activePointerId === event.pointerId) activePointerId = null
    }

    root.addEventListener('pointerdown', handlePointerDown, true)
    root.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    return () => {
      root.removeEventListener('pointerdown', handlePointerDown, true)
      root.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
    }
  }, [activeTool, annotationScope, documentId, documentState?.document?.pages])

  useEffect(() => {
    if (!captureScope) return undefined
    let cancelled = false
    const unsubscribe = captureScope.onCaptureArea(async ({ pageIndex, rect, blob }) => {
      if (activeTool === 'erase_box') {
        const deletions = (annotationScope?.getAnnotations({ pageIndex }) || [])
          .filter(({ object }) => annotationIntersectsRect(object, rect))
          .map(({ object }) => ({ pageIndex, id: object.id }))
        if (deletions.length) annotationScope.deleteAnnotations(deletions)
        captureScope.enableMarqueeCapture()
        return
      }
      if (activeTool !== 'screenshot') return
      const sequence = ++eventSequenceRef.current
      const pageSize = documentState?.document?.pages?.[pageIndex]?.size
      const [imageUrl, imageSize, textResult] = await Promise.all([
        blobToDataUrl(blob),
        readImageSize(blob).catch(() => ({ width: 480, height: 320 })),
        readCaptureText(selectionScope, pageIndex, rect),
      ])
      if (cancelled || sequence !== eventSequenceRef.current) return
      const normalizedRect = normalizeCaptureRect(rect, pageSize)
      setCapture({
        blob,
        imageUrl,
        imageSize,
        pageIndex,
        pageSize,
        rect,
        pageNumber: pageIndex + 1,
        position: getCaptureMenuPosition(documentId, pageIndex, rect, pageSize),
        payload: {
          text: textResult.text,
          imageUrl,
          pageNumber: pageIndex + 1,
          startChar: textResult.startChar,
          endChar: textResult.endChar,
          rects: normalizedRect ? [normalizedRect] : [],
          anchorRect: normalizedRect,
          contextBefore: '',
          contextAfter: '',
        },
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeTool, annotationScope, captureScope, documentId, documentState?.document?.pages, selectionScope])

  useEffect(() => {
    if (!capture) return undefined
    let frame = 0
    function updatePosition() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setCapture((current) => current ? {
          ...current,
          position: getCaptureMenuPosition(
            documentId,
            current.pageIndex,
            current.rect,
            current.pageSize,
          ),
        } : current)
      })
    }
    document.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [capture, documentId])

  function downloadCapture() {
    if (!capture) return
    const url = URL.createObjectURL(capture.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = buildDownloadFilename(capture.pageNumber)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function pinCapture() {
    if (!capture) return
    const maxWidth = Math.min(480, capture.imageSize.width)
    const aspectRatio = capture.imageSize.width / Math.max(1, capture.imageSize.height)
    const width = Math.max(120, maxWidth)
    const height = width / aspectRatio
    setPinnedCaptures((current) => [...current, {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      imageUrl: capture.imageUrl,
      pageNumber: capture.pageNumber,
      left: Math.max(12, capture.position.x - width / 2),
      top: Math.max(12, capture.position.y + 18),
      width,
      height,
      aspectRatio,
    }])
    closeCapture()
  }

  const menu = capture && activeTool === 'screenshot' ? createPortal(
    <ScreenshotFloatingMenu
      position={capture.position}
      visible
      onTranslate={() => {
        if (capture.payload.text) onScreenshotTranslate?.(capture.payload)
        closeCapture()
      }}
      onPin={pinCapture}
      onDownload={downloadCapture}
      onInsertNote={() => {
        onScreenshotInsertNote?.(capture.payload)
        closeCapture()
      }}
      onAskAI={() => {
        if (capture.payload.text) {
          onScreenshotTranslate?.(capture.payload)
          onScreenshotAskAI?.(capture.payload.text)
        }
        closeCapture()
      }}
      onClose={() => closeCapture()}
    />,
    document.body,
  ) : null

  return (
    <>
      <CaptureSelectionLayer capture={capture} documentId={documentId} />
      {menu}
      <PinnedCaptureLayer items={pinnedCaptures} onChange={setPinnedCaptures} />
    </>
  )
}
