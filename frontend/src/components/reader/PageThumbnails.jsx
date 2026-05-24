import { memo, useEffect, useMemo, useRef, useLayoutEffect, useState } from 'react'

const MIN_THUMB_SCALE = 0.08
const MAX_THUMB_SCALE = 0.45
const DEFAULT_THUMB_SCALE = 0.2
const THUMBNAIL_GAP = 8
const THUMBNAIL_VERTICAL_CHROME = 32
const THUMBNAIL_OVERSCAN = 4

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

export function PageThumbnails({
  currentPage,
  currentPaperId,
  pageMetrics,
  pageNumbers,
  pdfDocument,
  width,
  onPageClick,
}) {
  const containerRef = useRef(null)
  const [thumbScale, setThumbScale] = useState(DEFAULT_THUMB_SCALE)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const firstPageMetric = pageMetrics[0]
  const estimatedItemHeight = useMemo(() => {
    const baseHeight = firstPageMetric?.height || 792
    return Math.max(72, Math.ceil(baseHeight * thumbScale + THUMBNAIL_VERTICAL_CHROME))
  }, [firstPageMetric?.height, thumbScale])
  const rowStride = estimatedItemHeight + THUMBNAIL_GAP
  const totalVirtualHeight = Math.max(0, pageNumbers.length * rowStride - THUMBNAIL_GAP)
  const visibleStartIndex = Math.max(0, Math.floor(scrollTop / rowStride) - THUMBNAIL_OVERSCAN)
  const visibleEndIndex = Math.min(
    pageNumbers.length,
    Math.ceil((scrollTop + viewportHeight) / rowStride) + THUMBNAIL_OVERSCAN,
  )
  const visiblePageNumbers = pageNumbers.slice(visibleStartIndex, visibleEndIndex)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    function syncViewport() {
      setViewportHeight(container.clientHeight || 0)
      setScrollTop(container.scrollTop || 0)
    }

    syncViewport()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncViewport) : null
    observer?.observe(container)
    return () => {
      observer?.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const pageIndex = pageNumbers.indexOf(currentPage)
    if (pageIndex < 0) return

    const container = containerRef.current
    const targetTop = pageIndex * rowStride
    const targetBottom = targetTop + estimatedItemHeight
    if (targetTop < container.scrollTop || targetBottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({
        top: Math.max(0, targetTop - container.clientHeight / 2 + estimatedItemHeight / 2),
        behavior: 'smooth',
      })
    }
  }, [currentPage, estimatedItemHeight, pageNumbers, rowStride])

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

      <div
        className="thumbnail-panel__scroll"
        ref={containerRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="thumbnail-panel__virtual" style={{ height: totalVirtualHeight }}>
        {visiblePageNumbers.map((pageNum, visibleIndex) => {
          const index = visibleStartIndex + visibleIndex
          const isActive = pageNum === currentPage
          return (
            <button
              key={`${currentPaperId || 'none'}:${pageNum}`}
              type="button"
              className={`thumbnail-panel__item${isActive ? ' is-active' : ''}`}
              data-thumb-page={pageNum}
              style={{
                height: estimatedItemHeight,
                top: index * rowStride,
              }}
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
      </div>
    </aside>
  )
}
