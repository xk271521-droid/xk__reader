import { useEffect, useMemo, useRef } from 'react'
import { PdfPage } from './PdfPage'

const PAGE_OVERSCAN = 2

function isTextSpan(target) {
  return target instanceof HTMLElement && Boolean(target.closest('.textLayer span'))
}

function isTextLayerNode(node) {
  if (!node) return false

  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node

  return element instanceof HTMLElement && Boolean(element.closest('.textLayer'))
}

function getPageFrameFromElement(element) {
  return element instanceof HTMLElement
    ? element.closest('.pdf-page-frame')
    : null
}

function getPageFrameFromNode(node) {
  if (!node) {
    return null
  }

  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node

  return getPageFrameFromElement(element)
}

function getStoredLineRects(pageFrame) {
  return Array.isArray(pageFrame?.__lineRects)
    ? pageFrame.__lineRects
    : []
}

function findLineRectAtRelativePoint(lineRects, x, y) {
  return lineRects.find(
    (lineRect) =>
      x >= lineRect.left &&
      x <= lineRect.right &&
      y >= lineRect.top &&
      y <= lineRect.bottom,
  ) ?? null
}

function getLineRectAtPoint(pageFrame, clientX, clientY) {
  if (!pageFrame) {
    return null
  }

  const lineRects = getStoredLineRects(pageFrame)

  if (lineRects.length === 0) {
    return null
  }

  const pageRect = pageFrame.getBoundingClientRect()
  const x = clientX - pageRect.left
  const y = clientY - pageRect.top

  return findLineRectAtRelativePoint(lineRects, x, y)
}

function getLineRectFromNode(pageFrame, node) {
  if (!pageFrame || !node) {
    return null
  }

  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node

  const span = element instanceof HTMLElement
    ? element.closest('.textLayer span')
    : null

  if (!(span instanceof HTMLElement)) {
    return null
  }

  const lineRects = getStoredLineRects(pageFrame)
  if (lineRects.length === 0) {
    return null
  }

  const x = span.offsetLeft + span.offsetWidth / 2
  const y = span.offsetTop + span.offsetHeight / 2

  return findLineRectAtRelativePoint(lineRects, x, y)
}

export function PdfViewport({
  activeTool,
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

  const startRef = useRef({
    startedInText: false,
    pageFrame: null,
    blockIndex: null,
  })
  const selectingRef = useRef({
    active: false,
    locked: false,
    ignoreNextWindowMouseUp: false,
    frameRequested: false,
    lastValidRange: null,
  })

  function setSelectionLock(locked) {
    const container = readerRef.current
    if (!container) {
      return
    }

    selectingRef.current.locked = locked
    container.classList.toggle('is-selection-locked', locked)
  }

  function resetSelectionGesture() {
    selectingRef.current.active = false
    selectingRef.current.ignoreNextWindowMouseUp = false
    selectingRef.current.frameRequested = false
    selectingRef.current.lastValidRange = null
    setSelectionLock(false)
    startRef.current = {
      startedInText: false,
      pageFrame: null,
      blockIndex: null,
    }
  }

  function restoreLastValidSelection() {
    const lastValidRange = selectingRef.current.lastValidRange
    if (!lastValidRange) {
      return
    }

    const selection = window.getSelection()
    if (!selection) {
      return
    }

    selection.removeAllRanges()
    selection.addRange(lastValidRange.cloneRange())
  }

  function captureCurrentSelection() {
    selectingRef.current.frameRequested = false

    if (!selectingRef.current.active || selectingRef.current.locked) {
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return
    }

    if (
      !isTextLayerNode(selection.anchorNode) ||
      !isTextLayerNode(selection.focusNode)
    ) {
      return
    }

    const anchorPageFrame = getPageFrameFromNode(selection.anchorNode)
    const focusPageFrame = getPageFrameFromNode(selection.focusNode)

    if (
      !anchorPageFrame ||
      !focusPageFrame ||
      anchorPageFrame !== focusPageFrame ||
      anchorPageFrame !== startRef.current.pageFrame
    ) {
      return
    }

    const anchorLineRect = getLineRectFromNode(anchorPageFrame, selection.anchorNode)
    const focusLineRect = getLineRectFromNode(focusPageFrame, selection.focusNode)
    const startBlockIndex = startRef.current.blockIndex

    if (
      startBlockIndex != null &&
      (
        !anchorLineRect ||
        !focusLineRect ||
        anchorLineRect.blockIndex !== startBlockIndex ||
        focusLineRect.blockIndex !== startBlockIndex
      )
    ) {
      return
    }

    const range = selection.getRangeAt(0)
    const text = range.toString().trim()

    if (!text) {
      return
    }

    const rect = range.getBoundingClientRect()
    if (rect.height > 220 || text.length > 800) {
      return
    }

    selectingRef.current.lastValidRange = range.cloneRange()
  }

  function requestSelectionCapture() {
    if (selectingRef.current.frameRequested) {
      return
    }

    selectingRef.current.frameRequested = true
    window.requestAnimationFrame(captureCurrentSelection)
  }

  const visiblePages = useMemo(() => {
    const start = Math.max(1, pageNumber - PAGE_OVERSCAN)
    const end = Math.min(pageNumbers.length, pageNumber + PAGE_OVERSCAN)

    return new Set(
      pageNumbers.filter((currentPage) => currentPage >= start && currentPage <= end),
    )
  }, [pageNumber, pageNumbers])

  function handleMouseDown(event) {
    if (activeTool !== 'select') {
      return
    }

    const pageFrame = getPageFrameFromElement(event.target)
    const startLineRect = getLineRectAtPoint(pageFrame, event.clientX, event.clientY)

    startRef.current = {
      startedInText: isTextSpan(event.target),
      pageFrame,
      blockIndex: startLineRect?.blockIndex ?? null,
    }
    selectingRef.current.active = startRef.current.startedInText
    selectingRef.current.ignoreNextWindowMouseUp = false
    selectingRef.current.lastValidRange = null
    selectingRef.current.frameRequested = false
    setSelectionLock(false)

    // 鼠标从空白区域开始拖动时，清除旧选区
    if (!startRef.current.startedInText) {
      window.getSelection()?.removeAllRanges()
    }
  }

  function handleMouseMove(event) {
    if (activeTool !== 'select' || !selectingRef.current.active) {
      return
    }

    const startPageFrame = startRef.current.pageFrame
    const startBlockIndex = startRef.current.blockIndex
    if (!startPageFrame) {
      setSelectionLock(false)
      return
    }

    const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY)
    const currentPageFrame = getPageFrameFromElement(elementAtPoint)
    const isSamePage = currentPageFrame === startPageFrame
    const currentLineRect = isSamePage
      ? getLineRectAtPoint(startPageFrame, event.clientX, event.clientY)
      : null
    const isInsideAllowedBlock = Boolean(
      currentLineRect &&
      (
        startBlockIndex == null ||
        currentLineRect.blockIndex === startBlockIndex
      ),
    )

    if (isInsideAllowedBlock) {
      requestSelectionCapture()
    } else if (selectingRef.current.lastValidRange) {
      restoreLastValidSelection()
    }

    setSelectionLock(!isInsideAllowedBlock)
  }

  function handleMouseUp() {
    if (activeTool !== 'select') {
      return
    }

    selectingRef.current.active = false
    selectingRef.current.ignoreNextWindowMouseUp = true
    setSelectionLock(false)

    if (selectingRef.current.lastValidRange) {
      restoreLastValidSelection()
    }

    const selection = window.getSelection()

    // 不是从文字开始选择，直接忽略
    if (!startRef.current.startedInText) {
      selection?.removeAllRanges()
      resetSelectionGesture()
      return
    }

    window.setTimeout(() => {
      const currentSelection = window.getSelection()

      if (!currentSelection || currentSelection.rangeCount === 0) {
        resetSelectionGesture()
        return
      }

      const text = currentSelection.toString().trim()

      if (!text) {
        resetSelectionGesture()
        return
      }

      // 选区起点和终点必须都在 PDF 文字层里面
      if (
        !isTextLayerNode(currentSelection.anchorNode) ||
        !isTextLayerNode(currentSelection.focusNode)
      ) {
        currentSelection.removeAllRanges()
        resetSelectionGesture()
        return
      }

      const anchorPageFrame = getPageFrameFromNode(currentSelection.anchorNode)
      const focusPageFrame = getPageFrameFromNode(currentSelection.focusNode)

      if (
        !anchorPageFrame ||
        !focusPageFrame ||
        anchorPageFrame !== focusPageFrame ||
        anchorPageFrame !== startRef.current.pageFrame
      ) {
        currentSelection.removeAllRanges()
        resetSelectionGesture()
        return
      }

      const anchorLineRect = getLineRectFromNode(anchorPageFrame, currentSelection.anchorNode)
      const focusLineRect = getLineRectFromNode(focusPageFrame, currentSelection.focusNode)

      if (
        startRef.current.blockIndex != null &&
        (
          !anchorLineRect ||
          !focusLineRect ||
          anchorLineRect.blockIndex !== startRef.current.blockIndex ||
          focusLineRect.blockIndex !== startRef.current.blockIndex
        )
      ) {
        currentSelection.removeAllRanges()
        resetSelectionGesture()
        return
      }

      const range = currentSelection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      // 防止误选整页、大段摘要、作者信息等
      // 想更严格就把 220 改小，例如 160
      // 想允许多选几行就把 220 改大，例如 300
      if (rect.height > 220 || text.length > 800) {
        currentSelection.removeAllRanges()
        resetSelectionGesture()
        return
      }

      // 通过检查后，再触发你原来的翻译/理解逻辑
      onSelect?.()
      resetSelectionGesture()
    }, 0)
  }

  useEffect(() => {
    function handleSelectionChange() {
      if (!selectingRef.current.active || selectingRef.current.locked) {
        return
      }

      requestSelectionCapture()
    }

    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [])

  useEffect(() => {
    function handleWindowMouseUp() {
      if (selectingRef.current.ignoreNextWindowMouseUp) {
        selectingRef.current.ignoreNextWindowMouseUp = false
        return
      }

      if (selectingRef.current.active || selectingRef.current.locked) {
        resetSelectionGesture()
      }
    }

    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [])

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
    <div
      className="pdf-stage"
      ref={readerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
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
