import { memo, useEffect, useRef, useLayoutEffect, useState } from 'react'

const MIN_THUMB_SCALE = 0.08
const MAX_THUMB_SCALE = 0.45
const DEFAULT_THUMB_SCALE = 0.2

function PageThumbnailRow({ pageNumber, pageMetric, scale, pdfDocument }) {
  const canvasRef = useRef(null)
  const renderRef = useRef(null)

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !pageMetric) return

    let cancelled = false
    const canvas = canvasRef.current

    async function render() {
      const page = await pdfDocument.getPage(pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)

      const ctx = canvas.getContext('2d', { alpha: false })
      renderRef.current = page.render({ canvasContext: ctx, viewport })
      await renderRef.current.promise
    }

    render()

    return () => {
      cancelled = true
      renderRef.current?.cancel()
    }
  }, [pageNumber, pageMetric, scale, pdfDocument])

  return <canvas ref={canvasRef} className="page-thumb" />
}

const MemoThumbnail = memo(PageThumbnailRow)

export function PageThumbnails({ currentPage, pageMetrics, pageNumbers, pdfDocument, width, onPageClick }) {
  const containerRef = useRef(null)
  const [thumbScale, setThumbScale] = useState(DEFAULT_THUMB_SCALE)

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const thumb = containerRef.current.querySelector(`[data-thumb-page="${currentPage}"]`)
    thumb?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPage])

  if (!pdfDocument || pageMetrics.length === 0) {
    return (
      <aside className="thumbnail-panel" style={{ width }}>
        <p className="thumbnail-panel__empty">加载中...</p>
      </aside>
    )
  }

  return (
    <aside className="thumbnail-panel" style={{ width }}>
      <div className="thumbnail-panel__slider">
        <input
          type="range"
          min={MIN_THUMB_SCALE}
          max={MAX_THUMB_SCALE}
          step={0.01}
          value={thumbScale}
          onChange={(e) => setThumbScale(Number(e.target.value))}
          aria-label="调整缩略图大小"
        />
      </div>

      <div className="thumbnail-panel__scroll" ref={containerRef}>
        {pageNumbers.map((pageNum, index) => {
          const isActive = pageNum === currentPage
          return (
            <button
              key={pageNum}
              type="button"
              className={`thumbnail-panel__item${isActive ? ' is-active' : ''}`}
              data-thumb-page={pageNum}
              onClick={() => onPageClick(pageNum)}
              aria-label={`跳转到第 ${pageNum} 页`}
            >
              <div className="thumbnail-panel__canvas-wrap">
                <MemoThumbnail
                  pageNumber={pageNum}
                  pageMetric={pageMetrics[index] ?? pageMetrics[0]}
                  scale={thumbScale}
                  pdfDocument={pdfDocument}
                />
              </div>
              <span className="thumbnail-panel__label">{pageNum}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
