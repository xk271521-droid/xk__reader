import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { PdfPage } from './PdfPage'
import { ScreenshotFloatingMenu } from './ScreenshotFloatingMenu'
import { SelectionFloatingMenu } from './SelectionFloatingMenu'
import {
  buildSelectionFromWordRange,
  findCharAtPoint,
  findCharBoundaryAtPoint,
  findCharInRangeAtPoint,
  findErasePreviewRangeAtPoint,
  findLineAtPoint,
  findSelectionBoundaryAtPoint,
  findWordAtPoint,
  getDecorationRectsForRange,
  getHighlightRectsForRange,
  getPageTextSlice,
  getLineRectsForRange,
  isPointInsideRect,
} from './pdfSelectionModel'

const PAGE_OVERSCAN = 2
const DRAG_START_DISTANCE = 2
const DEFAULT_ANNOTATION_COLOR = '#F4B400'

function getPageFrameFromElement(element) {
  return element instanceof HTMLElement
    ? element.closest('.pdf-page-frame')
    : null
}

function createEmptySelection() {
  return {
    visible: false,
    pageNumber: 0,
    startChar: 0,
    endChar: 0,
    text: '',
    rects: [],
    anchorRect: null,
    contextBefore: '',
    contextAfter: '',
  }
}

function createEmptyEraserPreview() {
  return {
    visible: false,
    pageNumber: 0,
    startChar: 0,
    endChar: 0,
    rects: [],
  }
}

function buildSelectionFromChars(pageIndex, pageNumber, startChar, endChar) {
  let orderedStart = Math.min(startChar, endChar)
  let orderedEnd = Math.max(startChar, endChar)
  if (orderedStart === orderedEnd) {
    orderedEnd = Math.min(pageIndex.length, orderedStart + 1)
  }
  const text = getPageTextSlice(pageIndex, orderedStart, orderedEnd)
  const rects = getLineRectsForRange(pageIndex, orderedStart, orderedEnd)
  if (!text.trim() || rects.length === 0) {
    return createEmptySelection()
  }

  return {
    visible: true,
    pageNumber,
    startChar: orderedStart,
    endChar: orderedEnd,
    text,
    rects,
    anchorRect: rects[0] || null,
    contextBefore: pageIndex.fullText.slice(Math.max(0, orderedStart - 120), orderedStart),
    contextAfter: pageIndex.fullText.slice(orderedEnd, Math.min(pageIndex.length, orderedEnd + 120)),
  }
}

function buildEraserPreview(pageIndex, pageNumber, startChar, endChar) {
  const orderedStart = Math.min(startChar, endChar)
  const orderedEnd = Math.max(startChar, endChar)
  if (orderedEnd <= orderedStart) {
    return createEmptyEraserPreview()
  }

  const rects = getLineRectsForRange(pageIndex, orderedStart, orderedEnd)
  if (rects.length === 0) {
    return createEmptyEraserPreview()
  }

  return {
    visible: true,
    pageNumber,
    startChar: orderedStart,
    endChar: orderedEnd,
    rects,
  }
}

function buildSelectionFromWords(pageIndex, pageNumber, startWordIndex, endWordIndex) {
  const selection = buildSelectionFromWordRange(pageIndex, startWordIndex, endWordIndex)
  if (!selection) {
    return createEmptySelection()
  }

  return {
    visible: true,
    pageNumber,
    ...selection,
  }
}

function normalizePointer(event, pageFrame) {
  const frameRect = pageFrame.getBoundingClientRect()
  return {
    x: (event.clientX - frameRect.left) / frameRect.width,
    y: (event.clientY - frameRect.top) / frameRect.height,
  }
}

function rectsIntersect(a, b, tolerance = 0.002) {
  if (!a || !b) return false
  return !(
    a.left + a.width < b.left - tolerance ||
    b.left + b.width < a.left - tolerance ||
    a.top + a.height < b.top - tolerance ||
    b.top + b.height < a.top - tolerance
  )
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value))
}

function normalizeDragRect(start, end) {
  const startX = clampUnit(start.x)
  const startY = clampUnit(start.y)
  const endX = clampUnit(end.x)
  const endY = clampUnit(end.y)
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  return {
    left,
    top,
    width: Math.max(0, Math.max(startX, endX) - left),
    height: Math.max(0, Math.max(startY, endY) - top),
  }
}

export function PdfViewport({
  activeTool,
  error,
  isLoading,
  matches = [],
  pageMetrics,
  pageNumbers,
  pageNumber,
  pdfDocument,
  readerRef,
  scale,
  onFitToWidth,
  onSelect,
  onSearchExecute,
  onVisiblePageChange,
  onWheelZoom,
  annotations = [],
  currentPaperId,
  onCreateAnnotation,
  onDeleteAnnotation,
  onEraseAnnotationRange,
  onAskAI,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
}) {
  const pageListRef = useRef(null)
  const fittedDocumentRef = useRef(null)
  const pageIndexesRef = useRef(new Map())
  const pointerSelectionRef = useRef(null)
  const eraserStrokeRef = useRef(null)
  const screenshotDragRef = useRef(null)
  const pinnedDragRef = useRef(null)
  const currentSelectionRef = useRef(createEmptySelection())
  const [selectedAnnotationColor, setSelectedAnnotationColor] = useState(DEFAULT_ANNOTATION_COLOR)
  const [floatingMenu, setFloatingMenu] = useState({ visible: false, x: 0, y: 0 })
  const [screenshotMenu, setScreenshotMenu] = useState({ visible: false, x: 0, y: 0 })
  const [screenshotSelection, setScreenshotSelection] = useState(null)
  const [pinnedScreenshots, setPinnedScreenshots] = useState([])
  const [eraserPreview, setEraserPreview] = useState(createEmptyEraserPreview())
  const [selectionState, setSelectionState] = useState(createEmptySelection())

  const annotationsByPage = useMemo(() => {
    const map = new Map()
    for (const annotation of annotations) {
      if (!map.has(annotation.page_number)) {
        map.set(annotation.page_number, [])
      }
      map.get(annotation.page_number).push(annotation)
    }
    return map
  }, [annotations])

  const searchMatchesByPage = useMemo(() => {
    const map = new Map()
    for (const match of matches) {
      if (!map.has(match.pageNumber)) {
        map.set(match.pageNumber, [])
      }
      map.get(match.pageNumber).push(match)
    }
    return map
  }, [matches])

  function getRenderableAnnotations(pageNum) {
    const pageIndex = pageIndexesRef.current.get(pageNum)
    const pageAnnotations = annotationsByPage.get(pageNum) || []
    const renderedAnnotations = pageAnnotations.map((annotation) => ({
      ...annotation,
      rects: pageIndex && (annotation.geometry_version || 'v1') === 'v2'
        ? annotation.type === 'highlight'
          ? getHighlightRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
          : getLineRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
        : (annotation.rects || []),
      decorationRects:
        pageIndex &&
        (annotation.geometry_version || 'v1') === 'v2' &&
        (annotation.type === 'underline' || annotation.type === 'wavy_underline')
        ? getDecorationRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
        : [],
    }))

    const renderedSearchMatches = (searchMatchesByPage.get(pageNum) || []).map((match, index) => ({
      id: `search:${pageNum}:${index}:${match.startChar}:${match.endChar}`,
      page_number: pageNum,
      start_char: match.startChar,
      end_char: match.endChar,
      quote_text: '',
      rects: getLineRectsForRange(pageIndex, match.startChar, match.endChar),
      type: 'search',
      color: null,
    }))

    return [...renderedAnnotations, ...renderedSearchMatches]
  }

  const visiblePages = useMemo(() => {
    const start = Math.max(1, pageNumber - PAGE_OVERSCAN)
    const end = Math.min(pageNumbers.length, pageNumber + PAGE_OVERSCAN)

    return new Set(
      pageNumbers.filter((currentPage) => currentPage >= start && currentPage <= end),
    )
  }, [pageNumber, pageNumbers])

  function setSelection(selection, shouldNotify = false) {
    currentSelectionRef.current = selection
    setSelectionState(selection)
    if (shouldNotify && selection.visible) {
      onSelect?.({
        text: selection.text,
        pageNumber: selection.pageNumber,
        startChar: selection.startChar,
        endChar: selection.endChar,
        rects: selection.rects,
        anchorRect: selection.anchorRect,
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
      })
    }
  }

  function clearSelection() {
    window.getSelection()?.removeAllRanges()
    setSelection(createEmptySelection())
    setFloatingMenu({ visible: false, x: 0, y: 0 })
  }

  function clearScreenshotSelection() {
    screenshotDragRef.current = null
    setScreenshotSelection(null)
    setScreenshotMenu({ visible: false, x: 0, y: 0 })
  }

  function getPageCanvas(pageNumberToFind) {
    const pageFrame = readerRef.current?.querySelector(`[data-page-number="${pageNumberToFind}"]`)
    const canvas = pageFrame?.querySelector('canvas')
    return pageFrame && canvas ? { pageFrame, canvas } : null
  }

  function buildSelectionFromScreenshotRect(selection) {
    if (!selection?.rect) return createEmptySelection()
    const pageIndex = pageIndexesRef.current.get(selection.pageNumber)
    if (!pageIndex) return createEmptySelection()

    const targetRect = selection.rect
    const touchedChars = pageIndex.chars.filter((char) =>
      char?.rect &&
      !/\s/.test(char.char) &&
      rectsIntersect(char.rect, targetRect, 0.0008),
    )

    if (touchedChars.length === 0) {
      return createEmptySelection()
    }

    const startChar = Math.min(...touchedChars.map((char) => char.index))
    const endChar = Math.max(...touchedChars.map((char) => char.index)) + 1
    return buildSelectionFromChars(pageIndex, selection.pageNumber, startChar, endChar)
  }

  function captureScreenshotData(selection) {
    if (!selection?.rect) return null
    const pageAssets = getPageCanvas(selection.pageNumber)
    if (!pageAssets) return null

    const { canvas } = pageAssets
    const sourceX = Math.max(0, Math.floor(selection.rect.left * canvas.width))
    const sourceY = Math.max(0, Math.floor(selection.rect.top * canvas.height))
    const sourceWidth = Math.max(1, Math.floor(selection.rect.width * canvas.width))
    const sourceHeight = Math.max(1, Math.floor(selection.rect.height * canvas.height))
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = sourceWidth
    outputCanvas.height = sourceHeight
    const context = outputCanvas.getContext('2d')
    if (!context) return null

    context.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    )

    return {
      dataUrl: outputCanvas.toDataURL('image/png'),
      width: sourceWidth,
      height: sourceHeight,
    }
  }

  function downloadScreenshot(selection) {
    const capture = captureScreenshotData(selection)
    if (!capture) return
    const link = document.createElement('a')
    link.href = capture.dataUrl
    link.download = `paper-screenshot-p${selection.pageNumber}-${Date.now()}.png`
    link.click()
  }

  function buildScreenshotPayload(selection) {
    if (!selection) return null
    const extractedSelection = buildSelectionFromScreenshotRect(selection)
    if (!extractedSelection.visible) return null
    return {
      text: extractedSelection.text,
      pageNumber: extractedSelection.pageNumber,
      startChar: extractedSelection.startChar,
      endChar: extractedSelection.endChar,
      rects: extractedSelection.rects,
      anchorRect: extractedSelection.anchorRect,
      contextBefore: extractedSelection.contextBefore,
      contextAfter: extractedSelection.contextAfter,
    }
  }

  function handleScreenshotTranslateAction() {
    const payload = buildScreenshotPayload(screenshotSelection)
    if (!payload) return
    onScreenshotTranslate?.(payload)
    clearScreenshotSelection()
  }

  function handleScreenshotAskAIAction() {
    const payload = buildScreenshotPayload(screenshotSelection)
    if (!payload) return
    onScreenshotTranslate?.(payload)
    onScreenshotAskAI?.(payload.text)
    clearScreenshotSelection()
  }

  function handleScreenshotInsertNoteAction() {
    const payload = buildScreenshotPayload(screenshotSelection)
    if (!payload) return
    onScreenshotInsertNote?.(payload)
    clearScreenshotSelection()
  }

  function handleScreenshotDownloadAction() {
    if (!screenshotSelection) return
    downloadScreenshot(screenshotSelection)
  }

  function handleScreenshotPinAction() {
    if (!screenshotSelection) return
    const capture = captureScreenshotData(screenshotSelection)
    const payload = buildScreenshotPayload(screenshotSelection)
    if (!capture) return

    const readerRect = readerRef.current?.getBoundingClientRect()
    const menuX = screenshotMenu.x
    const menuY = screenshotMenu.y
    const maxWidth = Math.min(260, Math.max(140, capture.width * 0.38))
    const scaleRatio = maxWidth / Math.max(1, capture.width)
    const previewWidth = maxWidth
    const previewHeight = Math.max(80, capture.height * scaleRatio)
    const left = readerRect ? Math.max(12, menuX - readerRect.left - previewWidth / 2) : 18
    const top = readerRect ? Math.max(12, menuY - readerRect.top + 18) : 18

    setPinnedScreenshots((current) => [
      ...current,
      {
        id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
        imageUrl: capture.dataUrl,
        text: payload?.text || '',
        pageNumber: screenshotSelection.pageNumber,
        left,
        top,
        width: previewWidth,
        height: previewHeight,
        aspectRatio: previewWidth / previewHeight,
      },
    ])
    clearScreenshotSelection()
  }

  function closePinnedScreenshot(id) {
    setPinnedScreenshots((current) => current.filter((item) => item.id !== id))
  }

  function clearEraserPreview() {
    setEraserPreview(createEmptyEraserPreview())
  }

  function openScreenshotMenu(selection) {
    const pageFrame = readerRef.current?.querySelector(`[data-page-number="${selection.pageNumber}"]`)
    if (!pageFrame) return

    const pageRect = pageFrame.getBoundingClientRect()
    setScreenshotMenu({
      visible: true,
      x: pageRect.left + (selection.rect.left + selection.rect.width / 2) * pageRect.width,
      y: pageRect.top + (selection.rect.top + selection.rect.height) * pageRect.height + 14,
    })
  }

  function handlePageIndexReady(pageNum, pageIndex) {
    pageIndexesRef.current.set(pageNum, pageIndex)
    if (onSearchExecute) {
      const indexes = Array.from(pageIndexesRef.current.values()).sort((left, right) => left.pageNumber - right.pageNumber)
      onSearchExecute(undefined, indexes)
    }
  }

  function resolvePointerWord(event) {
    const pageFrame = getPageFrameFromElement(event.target)
    if (!pageFrame) return null
    const pageNum = Number(pageFrame.dataset.pageNumber || '0')
    const pageIndex = pageIndexesRef.current.get(pageNum)
    if (!pageIndex) return null

    const point = normalizePointer(event, pageFrame)
    const word = findWordAtPoint(pageIndex, point.x, point.y)
    if (!word) return null

    return {
      pageFrame,
      pageNum,
      pageIndex,
      point,
      word,
    }
  }

  function resolvePointerCharBoundary(event) {
    const pageFrame = getPageFrameFromElement(event.target)
    if (!pageFrame) return null
    const pageNum = Number(pageFrame.dataset.pageNumber || '0')
    const pageIndex = pageIndexesRef.current.get(pageNum)
    if (!pageIndex) return null

    const point = normalizePointer(event, pageFrame)
    const boundary = findCharBoundaryAtPoint(pageIndex, point.x, point.y)
    if (!boundary) return null

    return {
      pageFrame,
      pageNum,
      pageIndex,
      point,
      boundary,
    }
  }

  function resolvePointerPage(event) {
    const pageFrame = getPageFrameFromElement(event.target)
    if (!pageFrame) return null
    const pageNum = Number(pageFrame.dataset.pageNumber || '0')
    const pageIndex = pageIndexesRef.current.get(pageNum)
    if (!pageIndex) return null
    return {
      pageFrame,
      pageNum,
      pageIndex,
      point: normalizePointer(event, pageFrame),
    }
  }

  function getAnnotationHitRects(annotation, pageIndex) {
    if (!annotation) return []
    if (!pageIndex || (annotation.geometry_version || 'v1') !== 'v2') {
      return [...(annotation.rects || [])]
    }

    const rects = annotation.type === 'highlight'
      ? getHighlightRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
      : getLineRectsForRange(pageIndex, annotation.start_char, annotation.end_char)

    if (
      (annotation.type === 'underline' || annotation.type === 'wavy_underline')
    ) {
      rects.push(
        ...getDecorationRectsForRange(pageIndex, annotation.start_char, annotation.end_char),
      )
    }
    return rects
  }

  function annotationIntersectsPoint(annotation, point, pageIndex) {
    return getAnnotationHitRects(annotation, pageIndex)
      .some((rect) => isPointInsideRect(point.x, point.y, rect, 0.014))
  }

  function annotationIntersectsRange(annotation, range, pageIndex) {
    if (!range || annotation.page_number !== range.pageNumber) return false
    if (
      annotation.end_char > range.startChar &&
      annotation.start_char < range.endChar
    ) {
      return true
    }

    const rangeRects = getLineRectsForRange(pageIndex, range.startChar, range.endChar)
    return getAnnotationHitRects(annotation, pageIndex).some((annotationRect) =>
      rangeRects.some((rangeRect) => rectsIntersect(annotationRect, rangeRect, 0.002)),
    )
  }

  function mergeRanges(ranges = []) {
    const normalized = ranges
      .filter((range) => range && range.endChar > range.startChar)
      .sort((left, right) => {
        if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber
        return left.startChar - right.startChar
      })

    const merged = []
    for (const range of normalized) {
      const current = merged[merged.length - 1]
      if (
        current &&
        current.pageNumber === range.pageNumber &&
        range.startChar <= current.endChar
      ) {
        current.endChar = Math.max(current.endChar, range.endChar)
        continue
      }
      merged.push({ ...range })
    }
    return merged
  }

  function expandRangesForPreview(pageIndex, ranges = []) {
    if (!pageIndex) return ranges

    const expanded = []
    const ordered = mergeRanges(ranges)
    for (const range of ordered) {
      const startChar = pageIndex.chars?.[range.startChar]
      const endChar = pageIndex.chars?.[Math.max(range.startChar, range.endChar - 1)]
      if (!startChar || !endChar || startChar.lineIndex !== endChar.lineIndex) {
        expanded.push(range)
        continue
      }

      const line = pageIndex.lines?.[startChar.lineIndex]
      if (!line) {
        expanded.push(range)
        continue
      }

      const lineChars = line.charIndices
        .map((index) => pageIndex.chars[index])
        .filter((char) => char?.rect)
        .sort((left, right) => left.index - right.index)
      const visibleChars = lineChars.filter((char) => !/\s/.test(char.char))
      if (visibleChars.length === 0) {
        expanded.push(range)
        continue
      }

      const startIndex = visibleChars.findIndex((char) => char.index >= range.startChar)
      const endIndex = [...visibleChars].reverse().findIndex((char) => char.index < range.endChar)
      const normalizedStartIndex = startIndex >= 0 ? startIndex : 0
      const normalizedEndIndex = endIndex >= 0 ? visibleChars.length - 1 - endIndex : visibleChars.length - 1
      const first = visibleChars[Math.max(0, normalizedStartIndex - 1)] || visibleChars[0]
      const last = visibleChars[Math.min(visibleChars.length - 1, normalizedEndIndex + 1)] || visibleChars[visibleChars.length - 1]

      expanded.push({
        pageNumber: range.pageNumber,
        startChar: Math.min(first.index, range.startChar),
        endChar: Math.max(last.index + 1, range.endChar),
      })
    }

    return mergeRanges(expanded)
  }

  function getEraserSampleRanges(pageIndex, pageAnnotations, fromPoint, toPoint) {
    const dx = toPoint.x - (fromPoint?.x ?? toPoint.x)
    const dy = toPoint.y - (fromPoint?.y ?? toPoint.y)
    const distance = Math.hypot(dx, dy)
    const steps = fromPoint
      ? Math.max(1, Math.min(28, Math.ceil(distance / 0.004)))
      : 1
    const ranges = []

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps
      const samplePoint = fromPoint
        ? {
          x: fromPoint.x + dx * progress,
          y: fromPoint.y + dy * progress,
        }
        : toPoint
      const touchedAnnotations = pageAnnotations.filter((annotation) =>
        annotationIntersectsPoint(annotation, samplePoint, pageIndex),
      )

      if (touchedAnnotations.length > 0) {
        for (const annotation of touchedAnnotations) {
          const char = findCharInRangeAtPoint(
            pageIndex,
            annotation.start_char,
            annotation.end_char,
            samplePoint.x,
            samplePoint.y,
          )
          if (!char) continue
          ranges.push({
            pageNumber: pageIndex.pageNumber,
            startChar: char.index,
            endChar: char.index + 1,
          })
        }
        continue
      }

      const previewRange = findErasePreviewRangeAtPoint(pageIndex, samplePoint.x, samplePoint.y)
      if (
        previewRange &&
        pageAnnotations.some((annotation) =>
          annotationIntersectsRange(annotation, previewRange, pageIndex),
        )
      ) {
        ranges.push(previewRange)
      }
    }

    return mergeRanges(ranges)
  }

  function updateEraserPreviewAtPointer(event) {
    const resolved = resolvePointerPage(event)
    if (!resolved) {
      clearEraserPreview()
      return
    }

    const pageAnnotations = (annotationsByPage.get(resolved.pageNum) || [])
      .filter((annotation) => annotation.type === 'highlight' || annotation.type === 'underline' || annotation.type === 'wavy_underline')
    if (pageAnnotations.length === 0) {
      clearEraserPreview()
      return
    }

    const stroke = eraserStrokeRef.current
    if (!stroke) return

    const sampleRanges = getEraserSampleRanges(
      resolved.pageIndex,
      pageAnnotations,
      stroke.lastPoint?.pageNumber === resolved.pageNum ? stroke.lastPoint : null,
      { pageNumber: resolved.pageNum, x: resolved.point.x, y: resolved.point.y },
    )

    stroke.lastPoint = { pageNumber: resolved.pageNum, x: resolved.point.x, y: resolved.point.y }

    if (sampleRanges.length === 0) {
      eraserStrokeRef.current = stroke
      if (!(stroke.ranges || []).length) {
        clearEraserPreview()
      }
      return
    }

    stroke.ranges = mergeRanges([...(stroke.ranges || []), ...sampleRanges])
    eraserStrokeRef.current = stroke

    const currentPageRanges = stroke.ranges.filter((range) => range.pageNumber === resolved.pageNum)
    if (currentPageRanges.length === 0) {
      clearEraserPreview()
      return
    }

    const previewRanges = expandRangesForPreview(resolved.pageIndex, currentPageRanges)
    const previewRects = previewRanges.flatMap((range) =>
      getLineRectsForRange(resolved.pageIndex, range.startChar, range.endChar),
    )
    setEraserPreview({
      visible: previewRects.length > 0,
      pageNumber: resolved.pageNum,
      startChar: previewRanges[0]?.startChar ?? currentPageRanges[0].startChar,
      endChar: previewRanges[previewRanges.length - 1]?.endChar ?? currentPageRanges[currentPageRanges.length - 1].endChar,
      rects: previewRects,
    })
  }

  async function commitEraserStroke() {
    const stroke = eraserStrokeRef.current
    eraserStrokeRef.current = null

    if (!stroke?.ranges?.length) {
      clearEraserPreview()
      return
    }

    const mergedRanges = mergeRanges(stroke.ranges)
    clearEraserPreview()

    for (const range of mergedRanges) {
      await onEraseAnnotationRange?.({
        pageNumber: range.pageNumber,
        startChar: range.startChar,
        endChar: range.endChar,
        eraseSessionId: stroke.sessionId || null,
      })
    }
  }

  function handleMouseDown(event) {
    if (event.detail === 3) {
      handleTripleClick(event)
      return
    }

    if (activeTool === 'eraser') {
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      clearSelection()
      eraserStrokeRef.current = {
        active: true,
        sessionId: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
        ranges: [],
      }
      updateEraserPreviewAtPointer(event)
      return
    }

    if (activeTool === 'screenshot') {
      const resolved = resolvePointerPage(event)
      if (!resolved) {
        clearScreenshotSelection()
        return
      }

      event.preventDefault()
      clearSelection()
      const selection = {
        pageNumber: resolved.pageNum,
        rect: normalizeDragRect(resolved.point, resolved.point),
      }
      screenshotDragRef.current = {
        active: true,
        pageNum: resolved.pageNum,
        pageFrame: resolved.pageFrame,
        startPoint: resolved.point,
        hasDragged: false,
        lastSelection: selection,
      }
      setScreenshotSelection(selection)
      setScreenshotMenu({ visible: false, x: 0, y: 0 })
      return
    }

    if (activeTool !== 'select') {
      return
    }

    const resolved = resolvePointerCharBoundary(event)
    if (!resolved) {
      clearSelection()
      return
    }

    event.preventDefault()
    window.getSelection()?.removeAllRanges()

    pointerSelectionRef.current = {
      pageNum: resolved.pageNum,
      pageIndex: resolved.pageIndex,
      blockIndex: resolved.boundary.blockIndex,
      anchorBoundary: resolved.boundary,
      startChar: resolved.boundary.charIndex,
      endChar: resolved.boundary.charIndex,
      startClientX: event.clientX,
      startClientY: event.clientY,
      hasDragged: false,
      lastSelection: null,
      handledMouseUp: false,
    }
  }

  function handleMouseMove(event) {
    if (activeTool === 'eraser' && eraserStrokeRef.current?.active) {
      event.preventDefault()
      updateEraserPreviewAtPointer(event)
      return
    }

    if (activeTool === 'screenshot' && screenshotDragRef.current?.active) {
      event.preventDefault()
      const current = screenshotDragRef.current
      const point = normalizePointer(event, current.pageFrame)
      const rect = normalizeDragRect(current.startPoint, point)
      const nextSelection = {
        pageNumber: current.pageNum,
        rect,
      }
      current.hasDragged = rect.width > 0.006 && rect.height > 0.006
      current.lastSelection = nextSelection
      screenshotDragRef.current = current
      setScreenshotSelection(nextSelection)
      return
    }

    const current = pointerSelectionRef.current
    if (!current) return

    const pageResolved = resolvePointerPage(event)
    if (!pageResolved || pageResolved.pageNum !== current.pageNum) {
      return
    }

    const boundary = findSelectionBoundaryAtPoint(
      pageResolved.pageIndex,
      pageResolved.point.x,
      pageResolved.point.y,
      current.anchorBoundary,
    )
    if (!boundary || boundary.blockIndex !== current.blockIndex) {
      return
    }

    const dragDistance = Math.hypot(
      event.clientX - current.startClientX,
      event.clientY - current.startClientY,
    )
    if (!current.hasDragged && dragDistance < DRAG_START_DISTANCE) {
      return
    }

    current.hasDragged = true
    current.endChar = boundary.charIndex
    pointerSelectionRef.current = current
    const nextSelection = buildSelectionFromChars(
      pageResolved.pageIndex,
      pageResolved.pageNum,
      current.startChar,
      current.endChar,
    )
    if (nextSelection.visible) {
      current.lastSelection = nextSelection
      setSelection(nextSelection)
    }
  }

  function openMenuForSelection(selection) {
    const pageFrame = readerRef.current?.querySelector(`[data-page-number="${selection.pageNumber}"]`)
    if (!pageFrame) return
    const pageRect = pageFrame.getBoundingClientRect()
    const firstRect = selection.rects[0]
    if (!firstRect) return

    setFloatingMenu({
      visible: true,
      x: pageRect.left + (firstRect.left + firstRect.width / 2) * pageRect.width,
      y: pageRect.top + firstRect.top * pageRect.height - 8,
    })
  }

  async function handleMouseUp() {
    if (activeTool === 'eraser') {
      await commitEraserStroke()
      return
    }

    if (activeTool === 'screenshot') {
      const current = screenshotDragRef.current
      screenshotDragRef.current = null
      if (!current?.hasDragged || !current.lastSelection?.rect) {
        clearScreenshotSelection()
        return
      }
      setScreenshotSelection(current.lastSelection)
      openScreenshotMenu(current.lastSelection)
      return
    }

    const current = pointerSelectionRef.current
    if (!current) return
    if (current.handledMouseUp) return
    current.handledMouseUp = true
    pointerSelectionRef.current = null

    if (!current.hasDragged) {
      clearSelection()
      return
    }

    const finalSelection = current.lastSelection || currentSelectionRef.current
    if (!finalSelection.visible || !finalSelection.text.trim()) {
      clearSelection()
      return
    }

    setSelection(finalSelection, true)
    openMenuForSelection(finalSelection)
  }

  function handleDoubleClick(event) {
    if (activeTool !== 'select') return
    const resolved = resolvePointerWord(event)
    if (!resolved) return

    event.preventDefault()
    const selection = buildSelectionFromWords(
      resolved.pageIndex,
      resolved.pageNum,
      resolved.word.index,
      resolved.word.index,
    )
    if (!selection.visible) return

    setSelection(selection, true)
    openMenuForSelection(selection)
  }

  function handleClick(event) {
    if (event.detail >= 2 || activeTool !== 'select') return
    if (currentSelectionRef.current.visible) return
    const resolved = resolvePointerPage(event)
    if (!resolved) {
      clearSelection()
      return
    }

    const line = findLineAtPoint(resolved.pageIndex, resolved.point.x, resolved.point.y)
    if (!line) {
      clearSelection()
    }
  }

  function handleTripleClick(event) {
    if (activeTool !== 'select') return
    if (event.detail !== 3) return
    const resolved = resolvePointerPage(event)
    if (!resolved) return
    const line = findLineAtPoint(resolved.pageIndex, resolved.point.x, resolved.point.y)
    if (!line) return

    event.preventDefault()
    const selection = buildSelectionFromChars(
      resolved.pageIndex,
      resolved.pageNum,
      line.startChar,
      line.endChar,
    )
    if (!selection.visible) return

    setSelection(selection, true)
    openMenuForSelection(selection)
  }

  function createAnnotationFromSelection(type, color = null) {
    const selection = currentSelectionRef.current
    if (!selection.visible || !selection.text.trim()) {
      return
    }

    onCreateAnnotation?.({
      pageNumber: selection.pageNumber,
      startChar: selection.startChar,
      endChar: selection.endChar,
      quoteText: selection.text,
      rects: selection.rects,
      type,
      color,
      source: 'native',
      geometryVersion: 'v2',
    })
    clearSelection()
  }

  function handleHighlight(color) {
    setSelectedAnnotationColor(color)
    createAnnotationFromSelection('highlight', color)
  }

  function handleUnderline(color = selectedAnnotationColor) {
    setSelectedAnnotationColor(color)
    createAnnotationFromSelection('underline', color)
  }

  function handleWavyUnderline(color = selectedAnnotationColor) {
    setSelectedAnnotationColor(color)
    createAnnotationFromSelection('wavy_underline', color)
  }

  function handleNote() {
    setFloatingMenu({ visible: false, x: 0, y: 0 })
  }

  useEffect(() => {
    fittedDocumentRef.current = null
    pageIndexesRef.current.clear()
    clearSelection()
    clearScreenshotSelection()
    clearEraserPreview()
    setPinnedScreenshots([])
  }, [pdfDocument])

  useEffect(() => {
    if (activeTool !== 'screenshot') {
      clearScreenshotSelection()
    }
  }, [activeTool])

  useEffect(() => {
    if (activeTool !== 'eraser') {
      eraserStrokeRef.current = null
      clearEraserPreview()
    }
  }, [activeTool])

  useEffect(() => {
    const container = readerRef.current

    if (!container || !pdfDocument || fittedDocumentRef.current === pdfDocument) {
      return undefined
    }

    let cancelled = false

    async function fitFirstPage() {
      const firstPage = await pdfDocument.getPage(1)
      if (cancelled) return
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
      const pageElements = Array.from(container.querySelectorAll('[data-page-number]'))
      if (pageElements.length === 0) return

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

    return () => container.removeEventListener('scroll', syncCurrentPage)
  }, [onVisiblePageChange, pageNumber, pdfDocument, readerRef, scale])

  useEffect(() => {
    if (!floatingMenu.visible) return

    function handleClick(e) {
      if (!e.target.closest('.selection-floating-menu')) {
        setFloatingMenu((current) => ({ ...current, visible: false }))
      }
    }

    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [floatingMenu.visible])

  useEffect(() => {
    if (!screenshotMenu.visible) return

    function handleClick(e) {
      if (!e.target.closest('.screenshot-floating-menu')) {
        setScreenshotMenu((current) => ({ ...current, visible: false }))
      }
    }

    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [screenshotMenu.visible])

  useEffect(() => {
    function handleCopy(event) {
      const selection = currentSelectionRef.current
      if (!selection.visible || !selection.text) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', selection.text)
    }

    document.addEventListener('copy', handleCopy)
    return () => document.removeEventListener('copy', handleCopy)
  }, [])

  useEffect(() => {
    function handlePointerMove(event) {
      const dragging = pinnedDragRef.current
      const readerRect = readerRef.current?.getBoundingClientRect()
      if (!dragging || !readerRect) return

      if (dragging.mode === 'resize') {
        const deltaX = event.clientX - dragging.startX
        const deltaY = event.clientY - dragging.startY
        const widthDelta = Math.max(deltaX, deltaY * dragging.aspectRatio)
        const nextWidth = Math.max(120, Math.min(readerRect.width * 0.72, dragging.startWidth + widthDelta))
        const nextHeight = nextWidth / dragging.aspectRatio
        setPinnedScreenshots((current) => current.map((item) =>
          item.id === dragging.id
            ? { ...item, width: nextWidth, height: nextHeight }
            : item,
        ))
        return
      }

      const nextLeft = Math.max(8, Math.min(readerRect.width - dragging.width - 8, event.clientX - readerRect.left - dragging.offsetX))
      const nextTop = Math.max(8, Math.min(readerRect.height - dragging.height - 8, event.clientY - readerRect.top - dragging.offsetY))

      setPinnedScreenshots((current) => current.map((item) =>
        item.id === dragging.id
          ? { ...item, left: nextLeft, top: nextTop }
          : item,
      ))
    }

    function handlePointerUp() {
      pinnedDragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [readerRef])

  useEffect(() => {
    function handleWindowMouseUp() {
      if (activeTool === 'eraser') {
        handleMouseUp()
        return
      }

      if (activeTool === 'screenshot' && screenshotDragRef.current) {
        handleMouseUp()
        return
      }

      if (pointerSelectionRef.current) {
        handleMouseUp()
      }
    }

    function handleWindowBlur() {
      pointerSelectionRef.current = null
      eraserStrokeRef.current = null
      screenshotDragRef.current = null
      clearEraserPreview()
    }

    window.addEventListener('mouseup', handleWindowMouseUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [activeTool])

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
          阅读区会在当前工作台内连续滚动，你可以在同一个界面里完成浏览、划词、翻译和笔记整理。
        </p>
      </div>
    )
  }

  return (
    <div
      className={`pdf-stage pdf-stage--tool-${activeTool}`}
      ref={readerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => {
        if (currentSelectionRef.current.visible) {
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
            if (max <= 0) {
              el.style.width = '0%'
              return
            }
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
            annotations={getRenderableAnnotations(item)}
            currentSelection={selectionState.visible && selectionState.pageNumber === item ? selectionState : null}
            eraserPreview={eraserPreview.visible && eraserPreview.pageNumber === item ? eraserPreview : null}
            screenshotSelection={screenshotSelection?.pageNumber === item ? screenshotSelection : null}
            selectionTool={activeTool}
            onPageIndexReady={handlePageIndexReady}
            pageMetric={pageMetrics[index] ?? pageMetrics[0]}
            pageNumber={item}
            pdfDocument={pdfDocument}
            scale={scale}
            shouldRender={visiblePages.has(item)}
          />
        ))}
      </div>

      {pinnedScreenshots.length > 0 ? (
        <div className="pdf-pinned-layer">
          {pinnedScreenshots.map((item) => (
            <div
              key={item.id}
              className="pdf-pinned-shot"
              style={{
                left: item.left,
                top: item.top,
                width: item.width,
                height: item.height,
              }}
              onPointerDown={(event) => {
                const cardRect = event.currentTarget.getBoundingClientRect()
                pinnedDragRef.current = {
                  id: item.id,
                  mode: 'drag',
                  width: item.width,
                  height: item.height,
                  offsetX: event.clientX - cardRect.left,
                  offsetY: event.clientY - cardRect.top,
                }
              }}
            >
              <div
                className="pdf-pinned-shot__header"
                onPointerDown={(event) => {
                  const cardRect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!cardRect) return
                  pinnedDragRef.current = {
                    id: item.id,
                    mode: 'drag',
                    width: item.width,
                    height: item.height,
                    offsetX: event.clientX - cardRect.left,
                    offsetY: event.clientY - cardRect.top,
                  }
                }}
              >
                <span>截图</span>
                <div className="pdf-pinned-shot__actions">
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => {
                    const link = document.createElement('a')
                    link.href = item.imageUrl
                    link.download = `paper-screenshot-p${item.pageNumber}-${Date.now()}.png`
                    link.click()
                  }}>
                    <Download size={14} />
                  </button>
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => closePinnedScreenshot(item.id)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
              <img src={item.imageUrl} alt="截图预览" className="pdf-pinned-shot__image" />
              <button
                type="button"
                className="pdf-pinned-shot__resize"
                aria-label="调整截图大小"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  pinnedDragRef.current = {
                    id: item.id,
                    mode: 'resize',
                    startX: event.clientX,
                    startY: event.clientY,
                    startWidth: item.width,
                    startHeight: item.height,
                    aspectRatio: item.aspectRatio || (item.width / Math.max(1, item.height)),
                  }
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <SelectionFloatingMenu
        position={floatingMenu.visible ? { x: floatingMenu.x, y: floatingMenu.y } : null}
        visible={floatingMenu.visible}
        selectedColor={selectedAnnotationColor}
        onColorChange={setSelectedAnnotationColor}
        autoShowColors
        compact={false}
        onHighlight={handleHighlight}
        onUnderline={handleUnderline}
        onWavyUnderline={handleWavyUnderline}
        onNote={handleNote}
        onAskAI={onAskAI}
      />
      <ScreenshotFloatingMenu
        position={screenshotMenu.visible ? { x: screenshotMenu.x, y: screenshotMenu.y } : null}
        visible={screenshotMenu.visible}
        onTranslate={handleScreenshotTranslateAction}
        onPin={handleScreenshotPinAction}
        onDownload={handleScreenshotDownloadAction}
        onInsertNote={handleScreenshotInsertNoteAction}
        onAskAI={handleScreenshotAskAIAction}
        onClose={clearScreenshotSelection}
      />
    </div>
  )
}
