import { useEffect, useMemo, useRef } from 'react'
import { PdfPage } from './PdfPage'

const PAGE_OVERSCAN = 2

export function PdfViewport({
  error,
  isLoading,
  pageMetrics,
  pageNumbers,
  pageNumber,
  pdfDocument,
  readerRef,
  scale,
  onFitToWidth,
  onSelect,
  onVisiblePageChange,
}) {
  const pageListRef = useRef(null)
  const fittedDocumentRef = useRef(null)

  const visiblePages = useMemo(() => {
    const start = Math.max(1, pageNumber - PAGE_OVERSCAN)
    const end = Math.min(pageNumbers.length, pageNumber + PAGE_OVERSCAN)
    return new Set(
      pageNumbers.filter((currentPage) => currentPage >= start && currentPage <= end),
    )
  }, [pageNumber, pageNumbers])

  useEffect(() => {
    fittedDocumentRef.current = null
  }, [pdfDocument])

  useEffect(() => {
    const container = readerRef.current
    if (!container || !pdfDocument || fittedDocumentRef.current === pdfDocument) {
      return undefined
    }

    let cancelled = false

    async function fitFirstPage() {
      const firstPage = await pdfDocument.getPage(1)
      if (cancelled) {
        return
      }

      const viewport = firstPage.getViewport({ scale: 1 })
      fittedDocumentRef.current = pdfDocument
      onFitToWidth(container.clientWidth, viewport.width)
    }

    fitFirstPage()

    return () => {
      cancelled = true
    }
  }, [onFitToWidth, pdfDocument, readerRef])

  useEffect(() => {
    const container = readerRef.current
    if (!container || !pdfDocument) {
      return undefined
    }

    function syncCurrentPage() {
      const pageElements = Array.from(
        container.querySelectorAll('[data-page-number]'),
      )
      if (pageElements.length === 0) {
        return
      }

      const viewportAnchor = container.scrollTop + container.clientHeight * 0.18
      let visiblePage = 1

      for (const element of pageElements) {
        if (element.offsetTop <= viewportAnchor) {
          visiblePage = Number(element.dataset.pageNumber)
        } else {
          break
        }
      }

      if (visiblePage !== pageNumber) {
        onVisiblePageChange(visiblePage)
      }
    }

    syncCurrentPage()
    container.addEventListener('scroll', syncCurrentPage, { passive: true })

    return () => {
      container.removeEventListener('scroll', syncCurrentPage)
    }
  }, [onVisiblePageChange, pageNumber, pdfDocument, readerRef, scale])

  if (error) {
    return <div className="reader-empty--error">{error}</div>
  }

  if (isLoading && !pdfDocument) {
    return <div className="reader-empty">正在加载 PDF...</div>
  }

  if (!pdfDocument) {
    return (
      <div className="reader-empty">
        <h3>先上传一篇 PDF 文献</h3>
        <p>
          阅读区会在当前工作台内连续滚动，你可以在同一个界面里完成浏览、
          划词、翻译和笔记整理。
        </p>
      </div>
    )
  }

  return (
    <div className="pdf-stage" ref={readerRef} onMouseUp={onSelect}>
      {isLoading ? <div className="pdf-loading">正在重新渲染页面...</div> : null}
      <div className="pdf-page-list" ref={pageListRef}>
        {pageNumbers.map((item, index) => (
          <PdfPage
            key={item}
            pageMetric={pageMetrics[index] ?? pageMetrics[0]}
            pageNumber={item}
            pdfDocument={pdfDocument}
            scale={scale}
            shouldRender={visiblePages.has(item)}
          />
        ))}
      </div>
    </div>
  )
}
