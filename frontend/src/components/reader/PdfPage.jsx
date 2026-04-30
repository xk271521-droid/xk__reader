import { memo, useEffect, useRef } from 'react'
import { loadPdfJs } from '../../services/pdfjsClient'

function getRenderScale() {
  return Math.min(window.devicePixelRatio || 1, 1.5)
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
      const canvasContext = canvas.getContext('2d', { alpha: false })

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      textLayerRef.current.innerHTML = ''
      textLayerRef.current.style.width = `${viewport.width}px`
      textLayerRef.current.style.height = `${viewport.height}px`
      textLayerRef.current.style.setProperty('--total-scale-factor', scale)

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

      const textContent = await page.getTextContent()
      const { TextLayer } = await loadPdfJs()
      textLayer = new TextLayer({
        container: textLayerRef.current,
        textContentSource: textContent,
        viewport,
      })
      await textLayer.render()
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

export const PdfPage = memo(PdfPageComponent)
