import { useEffect, useMemo, useRef, useState } from 'react'
import { PdfPage } from './PdfPage'
import { SelectionFloatingMenu } from './SelectionFloatingMenu'

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
  onWheelZoom,
  annotations = [],
  currentPaperId,
  onCreateAnnotation,
  onDeleteAnnotation,
  onDownloadPaper,
  onAskAI,
}) {
  const pageListRef = useRef(null)
  const fittedDocumentRef = useRef(null)
  const [floatingMenu, setFloatingMenu] = useState({ visible: false, x: 0, y: 0 })
  const savedSelectionRef = useRef(null)

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
    if (rect.height > 220 || text.length > 1500) {
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
    // 橡皮擦模式：点击标注删除
    if (activeTool === 'eraser') {
      const annEl = event.target.closest('[data-annotation-id]')
      if (annEl) {
        const annId = Number(annEl.dataset.annotationId)
        if (annId && onDeleteAnnotation) onDeleteAnnotation(annId)
      }
      return
    }
    if (activeTool !== 'select' && activeTool !== 'highlight' && activeTool !== 'underline') {
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
    if ((activeTool !== 'select' && activeTool !== 'highlight') || !selectingRef.current.active) {
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
    const sel = window.getSelection()
    if (activeTool === 'eraser') {
      sel?.removeAllRanges()
      return
    }
    if (activeTool === 'underline') {
      if (sel && !sel.isCollapsed) {
        handleUnderline()
        // TODO: save to API — needs page number + text
      }
      return
    }
    if (activeTool !== 'select' && activeTool !== 'highlight' && activeTool !== 'underline') {
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
      if (rect.height > 220 || text.length > 1500) {
        currentSelection.removeAllRanges()
        resetSelectionGesture()
        return
      }

      // 通过检查后，再触发你原来的翻译/理解逻辑
      if (activeTool === 'select') {
        onSelect?.()
      }

      // Show floating annotation menu (for select and highlight modes)
      if (activeTool === 'select' || activeTool === 'highlight') {
        const menuX = rect.left + rect.width / 2
        const menuY = rect.top - 8
        const selectedPage = Number(startRef.current.pageFrame?.dataset?.pageNumber || 0)
        savedSelectionRef.current = { text, pageNumber: Number(startRef.current.pageFrame?.dataset?.pageNumber || 0) }
        setFloatingMenu({ visible: true, x: menuX, y: menuY })
      }

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

  // 渲染已有标注
  useEffect(() => {
    const container = readerRef.current
    if (!container || !annotations.length) return

    // 按页码分组
    const byPage = {}
    annotations.forEach((a) => {
      if (!byPage[a.page_number]) byPage[a.page_number] = []
      byPage[a.page_number].push(a)
    })

    Object.entries(byPage).forEach(([pageNum, anns]) => {
      const pageFrame = container.querySelector('[data-page-number="' + pageNum + '"]')
      if (!pageFrame) return
      const textLayer = pageFrame.querySelector('.textLayer')
      if (!textLayer) return
      const allSpans = Array.from(textLayer.querySelectorAll('span'))

      anns.forEach((ann) => {
        // 跳过已渲染的
        if (textLayer.querySelector('[data-annotation-id="' + ann.id + '"]')) return

        const searchText = ann.selected_text
        const color = ann.color || '#FEF08A'
        let isUnderline = ann.type === 'underline' || ann.type === 'wavy_underline'

        // 在 textLayer span 中找匹配文字
        for (let i = 0; i < allSpans.length; i++) {
          const span = allSpans[i]
          if (span.closest('[data-annotation-id]')) continue
          const idx = span.textContent.indexOf(searchText)
          if (idx === -1) continue
          try {
            const range = document.createRange()
            range.setStart(span.firstChild, idx)
            range.setEnd(span.firstChild, idx + searchText.length)
            const mark = document.createElement('span')
            mark.setAttribute('data-annotation-id', String(ann.id))
            if (isUnderline) {
              mark.style.textDecoration = ann.type === 'wavy_underline' ? 'underline wavy #EF4444' : 'underline'
              mark.style.textUnderlineOffset = '3px'
            } else {
              mark.style.backgroundColor = color
              mark.style.borderRadius = '2px'
              mark.style.padding = '0 1px'
            }
            range.surroundContents(mark)
            // 光标移到mark末尾后会跳过后续匹配，所以重新查找
            break
          } catch {
            continue
          }
        }
      })
    })
  }, [annotations, readerRef])

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

  // Ctrl+wheel zoom — must use native listener with passive:false
  useEffect(() => {
    const container = readerRef.current
    if (!container || !onWheelZoom) return

    function handleWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      onWheelZoom(e.deltaY < 0 ? 1 : -1)
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [onWheelZoom, readerRef])

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

  // Dismiss floating menu on outside click
  useEffect(() => {
    if (!floatingMenu.visible) return

    function handleClick(e) {
      if (!e.target.closest('.selection-floating-menu')) {
        setFloatingMenu({ visible: false, x: 0, y: 0 })
      }
    }

    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [floatingMenu.visible])

  function getSelectedPageNumber() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const node = sel.anchorNode
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
    const pageFrame = el?.closest('[data-page-number]')
    return pageFrame ? Number(pageFrame.dataset.pageNumber) : null
  }

  function getTextLayerFromRange(range) {
    const container = range.commonAncestorContainer
    return container.nodeType === 1
      ? container.closest('.textLayer')
      : container.parentElement?.closest('.textLayer') || null
  }

  function handleHighlight(color) {
    var saved = savedSelectionRef.current
    if (!saved) return
    var text = saved.text, pageNumber = saved.pageNumber
    savedSelectionRef.current = null
    var pageFrame = readerRef.current?.querySelector('[data-page-number="' + pageNumber + '"]')
    var textLayer = pageFrame?.querySelector('.textLayer')
    if (!textLayer) return
    var lower = text.replace(/\s+/g, ' ').trim().toLowerCase()
    textLayer.querySelectorAll('span').forEach(function (s) {
      var t = s.textContent.trim().toLowerCase()
      if (t === lower || lower.includes(t) || t.includes(lower)) {
        s.style.backgroundColor = color
        s.style.borderRadius = '2px'
        s.style.padding = '0 1px'
      }
    })
    if (pageNumber && text && onCreateAnnotation) {
      onCreateAnnotation({ pageNumber: pageNumber, startOffset: 0, endOffset: 0, selectedText: text, type: 'highlight', color: color })
    }
    window.getSelection()?.removeAllRanges()
    setFloatingMenu({ visible: false, x: 0, y: 0 })
  }
  function handleUnderline() {
    var saved = savedSelectionRef.current
    if (!saved) return
    var text = saved.text, pageNumber = saved.pageNumber
    savedSelectionRef.current = null
    var pageFrame = readerRef.current?.querySelector('[data-page-number="' + pageNumber + '"]')
    var textLayer = pageFrame?.querySelector('.textLayer')
    if (!textLayer) return
    var lower = text.replace(/\s+/g, ' ').trim().toLowerCase()
    textLayer.querySelectorAll('span').forEach(function (s) {
      var t = s.textContent.trim().toLowerCase()
      if (t === lower || lower.includes(t) || t.includes(lower)) {
        s.style.textDecoration = 'underline'
        s.style.textUnderlineOffset = '3px'
      }
    })
    if (pageNumber && text && onCreateAnnotation) {
      onCreateAnnotation({ pageNumber: pageNumber, startOffset: 0, endOffset: 0, selectedText: text, type: 'underline', color: null })
    }
    window.getSelection()?.removeAllRanges()
    setFloatingMenu({ visible: false, x: 0, y: 0 })
  }
  function handleWavyUnderline() {
    const saved = savedSelectionRef.current
    if (!saved) return
    const { text, pageNumber, spans } = saved
    savedSelectionRef.current = null
    spans.forEach(function(span) {
      span.style.textDecoration = 'underline wavy #EF4444'
      span.style.textUnderlineOffset = '3px'
    })
    if (pageNumber && text && onCreateAnnotation) {
      onCreateAnnotation({ pageNumber, startOffset: 0, endOffset: 0, selectedText: text, type: 'wavy_underline', color: null })
    }
    window.getSelection()?.removeAllRanges()
    setFloatingMenu({ visible: false, x: 0, y: 0 })
  }
  function handleNote() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    try {
      const span = document.createElement('span')
      span.style.backgroundColor = 'rgba(250, 204, 21, 0.3)'
      span.style.borderBottom = '2px dashed #EAB308'
      sel.getRangeAt(0).surroundContents(span)
    } catch { /* complex range */ }
    sel.removeAllRanges()
    setFloatingMenu({ visible: false, x: 0, y: 0 })
  }

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
      onContextMenu={(e) => {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().trim()) {
          e.preventDefault()
        }
      }}
    >
      <div
        className="reader-progress"
        style={{ width: '0%' }}
        ref={(el) => {
          if (!el || !readerRef.current) return
          const container = readerRef.current
          const update = () => {
            const max = container.scrollHeight - container.clientHeight
            if (max <= 0) { el.style.width = '0%'; return }
            el.style.width = `${(container.scrollTop / max) * 100}%`
          }
          container.addEventListener('scroll', update, { passive: true })
          update()
        }}
      />
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

      <SelectionFloatingMenu
        position={floatingMenu.visible ? { x: floatingMenu.x, y: floatingMenu.y } : null}
        visible={floatingMenu.visible}
        autoShowColors={activeTool === "highlight"}
        compact={activeTool === "highlight"}
        onHighlight={handleHighlight}
        onUnderline={handleUnderline}
        onWavyUnderline={handleWavyUnderline}
        onNote={handleNote}
        onAskAI={onAskAI}
      />
    </div>
  )
}
