import { memo, useEffect, useRef } from 'react'
import { loadPdfJs } from '../../services/pdfjsClient'
import { InkOverlay } from './InkOverlay'
import { ShapeAnnotationLayer } from './ShapeAnnotationLayer'
import { PDF_TEXT_GEOMETRY_VERSION, buildRenderedPageIndex } from './pdfSelectionModel'

function getRenderScale() {
  return Math.min(window.devicePixelRatio || 1, 1.5)
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
function isTextInkPixel(data, index) {
  const red = data[index]
  const green = data[index + 1]
  const blue = data[index + 2]
  const alpha = data[index + 3]
  if (alpha < 36) return false

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const average = (red + green + blue) / 3
  return average < 210 && max - min < 56
}

function refineSelectionRectWithCanvas(canvas, rect) {
  if (!canvas || !rect || rect.width <= 0 || rect.height <= 0) return rect

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return rect

  const originalLeft = Math.max(0, Math.floor(rect.left * canvas.width))
  const originalRight = Math.min(canvas.width, Math.ceil((rect.left + rect.width) * canvas.width))
  const originalTop = Math.max(0, Math.floor(rect.top * canvas.height))
  const originalBottom = Math.min(canvas.height, Math.ceil((rect.top + rect.height) * canvas.height))
  const bounds = rect.refinementBounds || {}
  const hardLeft = Math.max(0, Math.floor((bounds.hardLeft ?? rect.left) * canvas.width))
  const hardRight = Math.min(
    canvas.width,
    Math.ceil((bounds.hardRight ?? (rect.left + rect.width)) * canvas.width),
  )
  const softLeft = Math.max(0, Math.floor((bounds.softLeft ?? rect.left) * canvas.width))
  const softRight = Math.min(
    canvas.width,
    Math.ceil((bounds.softRight ?? (rect.left + rect.width)) * canvas.width),
  )
  const leftScanMargin = Math.max(5, Math.round(rect.height * canvas.height * 0.22))
  const marginY = Math.max(3, Math.round(rect.height * canvas.height * 0.18))
  const x = Math.max(0, Math.min(softLeft, originalLeft - leftScanMargin))
  const y = Math.max(0, originalTop - marginY)
  const right = Math.max(originalRight, softRight)
  const bottom = Math.min(canvas.height, originalBottom + marginY)
  const width = Math.max(1, right - x)
  const height = Math.max(1, bottom - y)

  let imageData
  try {
    imageData = context.getImageData(x, y, width, height)
  } catch {
    return rect
  }

  let minX = width
  let maxX = -1
  const columnInkCounts = new Array(width).fill(0)
  const coreTop = Math.max(0, originalTop - y)
  const coreBottom = Math.min(height, Math.max(coreTop + 1, originalBottom - y))

  for (let row = coreTop; row < coreBottom; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = (row * width + col) * 4
      if (!isTextInkPixel(imageData.data, index)) continue
      columnInkCounts[col] += 1
    }
  }

  const minInkPixelsInColumn = Math.max(1, Math.round((coreBottom - coreTop) * 0.08))
  const hasInkAtColumn = (column) => columnInkCounts[column] >= minInkPixelsInColumn
  const originalStartColumn = Math.max(0, originalLeft - x)
  const originalEndColumn = Math.min(width - 1, Math.max(originalStartColumn, originalRight - x - 1))

  for (let col = originalStartColumn; col <= originalEndColumn; col += 1) {
    if (!hasInkAtColumn(col)) continue
    minX = Math.min(minX, col)
    maxX = Math.max(maxX, col)
  }

  if (maxX < minX) return rect

  const hasPreviousChar = bounds.hasPreviousChar === true
  const maxBridgeGap = Math.max(1, Math.round((coreBottom - coreTop) * 0.06))
  const leftBridgeGap = hasPreviousChar ? 0 : maxBridgeGap
  let blankRun = 0
  for (let col = minX - 1; col >= 0; col -= 1) {
    if (hasInkAtColumn(col)) {
      minX = col
      blankRun = 0
      continue
    }
    blankRun += 1
    if (blankRun > leftBridgeGap) break
  }

  blankRun = 0
  for (let col = maxX + 1; col < width; col += 1) {
    if (hasInkAtColumn(col)) {
      maxX = col
      blankRun = 0
      continue
    }
    blankRun += 1
    if (blankRun > maxBridgeGap) break
  }

  const inkWidth = maxX - minX + 1
  const inkHeight = coreBottom - coreTop
  const leftSafetyPad = hasPreviousChar
    ? 0
    : Math.max(5, Math.round(inkHeight * 0.22), Math.round(inkWidth * 0.08))
  const maxLeftExpansion = hasPreviousChar
    ? 0
    : Math.max(7, Math.round(inkHeight * 0.34))
  const leftLimit = Math.max(hardLeft, originalLeft - maxLeftExpansion)
  const refinedLeft = Math.max(leftLimit, x + minX - leftSafetyPad)
  const refinedRight = Math.min(
    hardRight,
    Math.max(originalRight, x + maxX + 1 + Math.max(2, Math.round(inkWidth * 0.035))),
  )

  const refined = {
    left: refinedLeft / canvas.width,
    top: originalTop / canvas.height,
    width: Math.max(1, refinedRight - refinedLeft) / canvas.width,
    height: Math.max(1, originalBottom - originalTop) / canvas.height,
  }

  const areaRatio = (refined.width * refined.height) / Math.max(0.000001, rect.width * rect.height)
  return areaRatio >= 0.18 && areaRatio <= 1.35 ? refined : rect
}

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

      if (isCancelled || !pageFrameRef.current || !textLayerRef.current) {
        return
      }

      pageFrameRef.current.__lineRects = collectLineRects(textLayerRef.current)
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
      if (pageFrameRef.current) {
        pageFrameRef.current.__lineRects = []
      }
    }
  }, [pageMetric, pageNumber, pdfDocument, scale, shouldRender, PDF_TEXT_GEOMETRY_VERSION])

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

export function clearTextContentCache() {
  textContentCache.clear()
}

export const PdfPage = memo(PdfPageComponent)
