import { memo, useEffect, useRef } from 'react'
import { loadPdfJs } from '../../services/pdfjsClient'
import { InkOverlay } from './InkOverlay'
import { ShapeAnnotationLayer } from './ShapeAnnotationLayer'
import { PDF_TEXT_GEOMETRY_VERSION, buildRenderedPageIndex } from './pdfSelectionModel'

function getRenderScale() {
  return Math.min(window.devicePixelRatio || 1, 1.2)
}

function toRgba(color, alpha) {
  if (!color) return `rgba(244, 180, 0, ${alpha})`
  const hex = color.replace('#', '')
  const normalized = hex.length === 3
    ? hex.split('').map((char) => char + char).join('')
    : hex
  const int = Number.parseInt(normalized, 16)
  if (Number.isNaN(int)) return color
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function drawHighlightCanvas(canvas, annotations, width, height) {
  if (!canvas) return
  const outputScale = getRenderScale()
  const canvasWidth = Math.floor(width * outputScale)
  const canvasHeight = Math.floor(height * outputScale)

  canvas.width = canvasWidth
  canvas.height = canvasHeight
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvasWidth, canvasHeight)

  for (const annotation of annotations) {
    if (annotation.type !== 'highlight') continue
    for (const rect of annotation.rects || []) {
      context.fillStyle = toRgba(annotation.color || '#F3B300', 0.78)
      context.fillRect(
        rect.left * canvasWidth,
        rect.top * canvasHeight,
        rect.width * canvasWidth,
        rect.height * canvasHeight,
      )
    }
  }
}

// Cache textContent per page — text parsing is expensive and text doesn't change with scale
const MAX_CACHE_SIZE = 200
const textContentCache = new Map()

function collectLineRects(textLayerElement) {
  const spans = Array.from(textLayerElement.querySelectorAll('span'))
    .map((span) => ({
      left: span.offsetLeft,
      top: span.offsetTop,
      right: span.offsetLeft + span.offsetWidth,
      bottom: span.offsetTop + span.offsetHeight,
      height: span.offsetHeight,
      width: span.offsetWidth,
    }))
    .filter((rect) => rect.width > 2 && rect.height > 2)
    .sort((left, right) => {
      if (Math.abs(left.top - right.top) > 2) {
        return left.top - right.top
      }
      return left.left - right.left
    })

  const lines = []

  for (const rect of spans) {
    const currentLine = lines[lines.length - 1]
    const threshold = Math.max(6, rect.height * 0.7)

    if (!currentLine || Math.abs(rect.top - currentLine.top) > threshold) {
      lines.push({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        height: rect.height,
      })
      continue
    }

    currentLine.top = Math.min(currentLine.top, rect.top)
    currentLine.bottom = Math.max(currentLine.bottom, rect.bottom)
    currentLine.left = Math.min(currentLine.left, rect.left)
    currentLine.right = Math.max(currentLine.right, rect.right)
    currentLine.height = Math.max(currentLine.height, rect.height)
  }

  const maxWidth = textLayerElement.clientWidth
  const maxHeight = textLayerElement.clientHeight

  let blockIndex = 0

  return lines.map((line, index) => {
    if (index > 0) {
      const previousLine = lines[index - 1]
      const verticalGap = line.top - previousLine.bottom
      const blockGapThreshold = Math.max(
        24,
        Math.max(previousLine.height, line.height) * 1.4,
      )

      if (verticalGap > blockGapThreshold) {
        blockIndex += 1
      }
    }

    return {
      left: Math.max(0, line.left - 10),
      right: Math.min(maxWidth, line.right + 10),
      top: Math.max(0, line.top - 8),
      bottom: Math.min(maxHeight, line.bottom + 8),
      blockIndex,
    }
  })
}

function cacheKey(pdfDocument, pageNumber) {
  const fp =
    pdfDocument?.fingerprints?.[0] ||
    pdfDocument?._pdfInfo?.fingerprints?.[0] ||
    'doc'

  return `${fp}:${pageNumber}:${PDF_TEXT_GEOMETRY_VERSION}`
}

function areNumberFieldsEqual(left, right, fields) {
  for (const field of fields) {
    if ((left?.[field] ?? null) !== (right?.[field] ?? null)) {
      return false
    }
  }
  return true
}

function areRectListsEqual(left = [], right = []) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftRect = left[index]
    const rightRect = right[index]
    if (
      leftRect?.left !== rightRect?.left ||
      leftRect?.top !== rightRect?.top ||
      leftRect?.width !== rightRect?.width ||
      leftRect?.height !== rightRect?.height
    ) {
      return false
    }
  }

  return true
}

function arePointListsEqual(left = [], right = []) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftPoint = left[index]
    const rightPoint = right[index]
    if (leftPoint?.x !== rightPoint?.x || leftPoint?.y !== rightPoint?.y) {
      return false
    }
  }

  return true
}

function areArraysShallowEqual(left = [], right = []) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function areSelectionOverlaysEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return left === right

  return (
    left.visible === right.visible &&
    left.pageNumber === right.pageNumber &&
    left.startChar === right.startChar &&
    left.endChar === right.endChar &&
    left.text === right.text &&
    left.copyText === right.copyText &&
    areRectListsEqual(left.rects, right.rects)
  )
}

function areDrawingStrokesEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return left === right

  return (
    left.pageNumber === right.pageNumber &&
    left.color === right.color &&
    left.opacity === right.opacity &&
    left.strokeWidth === right.strokeWidth &&
    arePointListsEqual(left.points, right.points)
  )
}

function areShapePreviewsEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return left === right

  return (
    left.id === right.id &&
    left.type === right.type &&
    left.page_number === right.page_number &&
    left.content === right.content &&
    left.isPreview === right.isPreview &&
    areNumberFieldsEqual(left, right, ['x', 'y', 'width', 'height']) &&
    areNumberFieldsEqual(left?.extra, right?.extra, ['startX', 'startY', 'endX', 'endY']) &&
    left?.style?.color === right?.style?.color &&
    left?.style?.fontSize === right?.style?.fontSize &&
    left?.style?.strokeWidth === right?.style?.strokeWidth
  )
}

function areScreenshotSelectionsEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return left === right

  return (
    left.pageNumber === right.pageNumber &&
    areNumberFieldsEqual(left.rect, right.rect, ['left', 'top', 'width', 'height'])
  )
}

function areDebugGeometriesEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return left === right

  return (
    areRectListsEqual(left.advanceRects, right.advanceRects) &&
    areRectListsEqual(left.visualRects, right.visualRects) &&
    areRectListsEqual(left.finalRects, right.finalRects)
  )
}

function isSelectedShapeOnPage(shapeAnnotations, selectedShapeId) {
  if (!selectedShapeId) return false
  return shapeAnnotations.some((annotation) => annotation.id === selectedShapeId)
}

function arePageMetricsEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return left === right

  return left.width === right.width && left.height === right.height
}

function arePdfPagePropsEqual(previousProps, nextProps) {
  if (previousProps.pageNumber !== nextProps.pageNumber) return false
  if (previousProps.pdfDocument !== nextProps.pdfDocument) return false
  if (previousProps.scale !== nextProps.scale) return false
  if (previousProps.shouldRender !== nextProps.shouldRender) return false
  if (previousProps.selectionTool !== nextProps.selectionTool) return false
  if (!arePageMetricsEqual(previousProps.pageMetric, nextProps.pageMetric)) return false
  if (!areArraysShallowEqual(previousProps.annotations, nextProps.annotations)) return false
  if (!areArraysShallowEqual(previousProps.inkAnnotations, nextProps.inkAnnotations)) return false
  if (!areArraysShallowEqual(previousProps.shapeAnnotations, nextProps.shapeAnnotations)) return false
  if (!areShapePreviewsEqual(previousProps.shapePreview, nextProps.shapePreview)) return false
  if (!areDrawingStrokesEqual(previousProps.drawingStroke, nextProps.drawingStroke)) return false
  if (!areSelectionOverlaysEqual(previousProps.currentSelection, nextProps.currentSelection)) return false
  if (!areDebugGeometriesEqual(previousProps.selectionDebugGeometry, nextProps.selectionDebugGeometry)) return false
  if (!areSelectionOverlaysEqual(previousProps.eraserPreview, nextProps.eraserPreview)) return false
  if (!areScreenshotSelectionsEqual(previousProps.screenshotSelection, nextProps.screenshotSelection)) return false
  if (previousProps.textEditor !== nextProps.textEditor) return false

  const previousSelectedOnPage = isSelectedShapeOnPage(
    previousProps.shapeAnnotations,
    previousProps.selectedShapeId,
  )
  const nextSelectedOnPage = isSelectedShapeOnPage(
    nextProps.shapeAnnotations,
    nextProps.selectedShapeId,
  )
  if (previousSelectedOnPage !== nextSelectedOnPage) return false
  if (previousSelectedOnPage && previousProps.selectedShapeId !== nextProps.selectedShapeId) {
    return false
  }

  return true
}

function PdfPageComponent({
  annotations = [],
  inkAnnotations = [],
  shapeAnnotations = [],
  selectedShapeId = null,
  shapePreview = null,
  textEditor = null,
  drawingStroke = null,
  currentSelection = null,
  selectionDebugGeometry = null,
  eraserPreview = null,
  screenshotSelection = null,
  selectionTool = 'select',
  onInkPointerDown,
  onInkPointerMove,
  onInkPointerUp,
  onInkErase,
  onShapePointerDown,
  onShapeDoubleClick,
  onShapeHandlePointerDown,
  onShapeDelete,
  onShapeEdit,
  onShapeToggleCollapse,
  onTextEditorChange,
  onTextEditorCommit,
  onTextEditorCancel,
  onPageIndexReady,
  pageMetric,
  pageNumber,
  pdfDocument,
  scale,
  shouldRender,
}) {
  const canvasRef = useRef(null)
  const highlightCanvasRef = useRef(null)
  const pageFrameRef = useRef(null)
  const textLayerRef = useRef(null)

  useEffect(() => {
    if (!pageFrameRef.current || !pageMetric) {
      return
    }

    pageFrameRef.current.style.width = `${pageMetric.width * scale}px`
    pageFrameRef.current.style.height = `${pageMetric.height * scale}px`
  }, [pageMetric, scale])

  useEffect(() => {
    if (!shouldRender || !pageMetric) return
    drawHighlightCanvas(
      highlightCanvasRef.current,
      annotations,
      pageMetric.width * scale,
      pageMetric.height * scale,
    )
  }, [annotations, pageMetric, scale, shouldRender])

  useEffect(() => {
    if (
      !shouldRender ||
      !pdfDocument ||
      !canvasRef.current ||
      !textLayerRef.current ||
      !pageFrameRef.current ||
      !pageMetric
    ) {
      return undefined
    }

    let isCancelled = false
    let renderTask = null
    let textLayer = null
    const currentPageFrame = pageFrameRef.current

    async function renderPage() {
      const page = await pdfDocument.getPage(pageNumber)

      if (isCancelled) {
        return
      }

      const viewport = page.getViewport({ scale })
      const outputScale = getRenderScale()
      const canvas = canvasRef.current
      const textLayerElement = textLayerRef.current

      if (!canvas || !textLayerElement) {
        return
      }

      const canvasContext = canvas.getContext('2d', { alpha: true })

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      canvasContext.clearRect(0, 0, canvas.width, canvas.height)

      textLayerElement.innerHTML = ''
      textLayerElement.style.width = `${viewport.width}px`
      textLayerElement.style.height = `${viewport.height}px`
      textLayerElement.style.setProperty('--total-scale-factor', scale)

      renderTask = page.render({
        canvasContext,
        transform:
          outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        viewport,
        background: 'rgba(255, 255, 255, 0)',
      })

      await renderTask.promise

      if (isCancelled) {
        return
      }

      // Use cached textContent if available
      const key = cacheKey(pdfDocument, pageNumber)
      let textContent = textContentCache.get(key)

      if (!textContent) {
        textContent = await page.getTextContent()

        if (textContentCache.size >= MAX_CACHE_SIZE) {
          const firstKey = textContentCache.keys().next().value
          textContentCache.delete(firstKey)
        }

        textContentCache.set(key, textContent)
      }

      if (isCancelled || !textLayerRef.current) {
        return
      }

      const { TextLayer } = await loadPdfJs()

      textLayer = new TextLayer({
        container: textLayerRef.current,
        textContentSource: textContent,
        viewport,
        enhanceTextSelection: false,
      })

      await textLayer.render()

      if (isCancelled || !currentPageFrame || !textLayerRef.current) {
        return
      }

      currentPageFrame.__lineRects = collectLineRects(textLayerRef.current)
      onPageIndexReady?.(
        pageNumber,
        buildRenderedPageIndex({
          pageNumber,
          textDivs: textLayer.textDivs,
          textStrings: textLayer.textContentItemsStr,
          textLayerElement: textLayerRef.current,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        }),
      )
    }

    renderPage().catch((renderError) => {
      if (!isCancelled) {
        console.error(`PDF page ${pageNumber} render failed`, renderError)
      }
    })

    return () => {
      isCancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      if (currentPageFrame) {
        currentPageFrame.__lineRects = []
      }
    }
  }, [onPageIndexReady, pageMetric, pageNumber, pdfDocument, scale, shouldRender])

  const selectionRects = currentSelection?.rects

  return (
    <div className="pdf-page-frame" data-page-number={pageNumber} ref={pageFrameRef}>
      {shouldRender ? (
        <>
          <canvas className="pdf-highlight-canvas" ref={highlightCanvasRef} aria-hidden="true" />
          <canvas className="pdf-page-canvas" ref={canvasRef} />
          <div className="textLayer" ref={textLayerRef} />
          <InkOverlay
            drawingStroke={drawingStroke}
            inkAnnotations={inkAnnotations}
            isInkMode={selectionTool === 'ink'}
            isEraserMode={selectionTool === 'eraser'}
            onInkPointerDown={onInkPointerDown}
            onInkPointerMove={onInkPointerMove}
            onInkPointerUp={onInkPointerUp}
            onInkErase={onInkErase}
          />
          <ShapeAnnotationLayer
            annotations={shapeAnnotations}
            selectedShapeId={selectedShapeId}
            previewShape={shapePreview}
            textEditor={textEditor}
            onShapePointerDown={onShapePointerDown}
            onShapeDoubleClick={onShapeDoubleClick}
            onShapeHandlePointerDown={onShapeHandlePointerDown}
            onShapeDelete={onShapeDelete}
            onShapeEdit={onShapeEdit}
            onShapeToggleCollapse={onShapeToggleCollapse}
            onTextEditorChange={onTextEditorChange}
            onTextEditorCommit={onTextEditorCommit}
            onTextEditorCancel={onTextEditorCancel}
          />
          <div className="pdf-annotation-overlay">
            {annotations.filter((annotation) => annotation.type !== 'highlight').map((annotation) => {
              const renderRects =
                annotation.type === 'underline' || annotation.type === 'wavy_underline'
                  ? (annotation.decorationRects?.length ? annotation.decorationRects : annotation.rects || [])
                  : (annotation.rects || [])

              return renderRects.map((rect, rectIndex) => (
                <div
                  key={`${annotation.id}:${rectIndex}`}
                  className={`pdf-annotation pdf-annotation--${annotation.type}`}
                  data-annotation-id={annotation.id}
                  style={{
                    left: `${rect.left * 100}%`,
                    top: `${rect.top * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                    backgroundColor: annotation.type === 'highlight'
                      ? toRgba(annotation.color || '#F3B300', 0.32)
                      : 'transparent',
                    borderBottomColor: annotation.color || '#2563EB',
                    color: annotation.color || '#2563EB',
                  }}
                />
              ))
            })}

            {selectionRects?.map((rect, rectIndex) => (
              <div
                key={`selection:${rectIndex}`}
                className={`pdf-selection-overlay pdf-selection-overlay--${selectionTool}`}
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            ))}

            {selectionDebugGeometry ? (
              <div className="pdf-selection-debug" aria-hidden="true">
                {selectionDebugGeometry.advanceRects?.map((rect, rectIndex) => (
                  <div
                    key={`debug-advance:${rectIndex}`}
                    className="pdf-selection-debug__rect pdf-selection-debug__rect--advance"
                    style={{
                      left: `${rect.left * 100}%`,
                      top: `${rect.top * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                ))}
                {selectionDebugGeometry.visualRects?.map((rect, rectIndex) => (
                  <div
                    key={`debug-visual:${rectIndex}`}
                    className="pdf-selection-debug__rect pdf-selection-debug__rect--visual"
                    style={{
                      left: `${rect.left * 100}%`,
                      top: `${rect.top * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                ))}
                {selectionDebugGeometry.finalRects?.map((rect, rectIndex) => (
                  <div
                    key={`debug-final:${rectIndex}`}
                    className="pdf-selection-debug__rect pdf-selection-debug__rect--final"
                    style={{
                      left: `${rect.left * 100}%`,
                      top: `${rect.top * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                ))}
              </div>
            ) : null}

            {eraserPreview?.rects?.map((rect, rectIndex) => (
              <div
                key={`eraser-preview:${rectIndex}`}
                className="pdf-eraser-preview"
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            ))}

            {screenshotSelection?.rect ? (
              <div
                className="pdf-screenshot-selection"
                style={{
                  left: `${screenshotSelection.rect.left * 100}%`,
                  top: `${screenshotSelection.rect.top * 100}%`,
                  width: `${screenshotSelection.rect.width * 100}%`,
                  height: `${screenshotSelection.rect.height * 100}%`,
                }}
              >
                {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((position) => (
                  <span
                    key={position}
                    className={`pdf-screenshot-selection__handle pdf-screenshot-selection__handle--${position}`}
                  />
                ))}
                <span className="pdf-screenshot-selection__spin" />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="pdf-page-placeholder" />
      )}

      <span className="pdf-page-badge">{pageNumber}</span>
    </div>
  )
}

export const PdfPage = memo(PdfPageComponent, arePdfPagePropsEqual)
