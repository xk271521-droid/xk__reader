import { memo, useEffect, useRef } from 'react'
import { loadPdfJs } from '../../services/pdfjsClient'

function getRenderScale() {
  return Math.min(window.devicePixelRatio || 1, 1.5)
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

  return `${fp}:${pageNumber}`
}

function PdfPageComponent({
  pageMetric,
  pageNumber,
  pdfDocument,
  scale,
  shouldRender,
}) {
  const canvasRef = useRef(null)
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

      const canvasContext = canvas.getContext('2d', { alpha: false })

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      textLayerElement.innerHTML = ''
      textLayerElement.style.width = `${viewport.width}px`
      textLayerElement.style.height = `${viewport.height}px`
      textLayerElement.style.setProperty('--total-scale-factor', scale)

      renderTask = page.render({
        canvasContext,
        transform:
          outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        viewport,
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
  }, [pageMetric, pageNumber, pdfDocument, scale, shouldRender])

  return (
    <div className="pdf-page-frame" data-page-number={pageNumber} ref={pageFrameRef}>
      {shouldRender ? (
        <>
          <canvas ref={canvasRef} />
          <div className="textLayer" ref={textLayerRef} />
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
