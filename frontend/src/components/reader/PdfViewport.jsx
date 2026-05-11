import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ZoomIn, ZoomOut, X } from 'lucide-react'
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
  formatRangeTextForCopy,
  getDecorationRectsForRange,
  getHighlightRectsForRange,
  getPageTextSlice,
  getLineRectsForRange,
  getSearchRectsForRange,
  isPointInsideRect,
} from './pdfSelectionModel'

const PAGE_OVERSCAN = 2
const DRAG_START_DISTANCE = 2
const DEFAULT_ANNOTATION_COLOR = '#F3B300'
const DEFAULT_INK_OPTIONS = { color: '#15803D', opacity: 0.85, strokeWidth: 6 }

function getPageFrameFromElement(element) {
  return element && typeof element.closest === 'function'
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
    copyText: '',
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
  const copyText = formatRangeTextForCopy(pageIndex, orderedStart, orderedEnd)
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
    copyText,
    rects,
    anchorRect: rects[0] || null,
    contextBefore: pageIndex.fullText.slice(Math.max(0, orderedStart - 120), orderedStart),
    contextAfter: pageIndex.fullText.slice(orderedEnd, Math.min(pageIndex.length, orderedEnd + 120)),
  }
}

function compactFocusText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function buildCompactPageTextMap(pageIndex) {
  const chars = []
  const indexes = []
  for (const item of pageIndex?.chars || []) {
    const normalized = compactFocusText(item.char)
    if (!normalized) continue
    for (const char of normalized) {
      chars.push(char)
      indexes.push(item.index)
    }
  }
  return {
    text: chars.join(''),
    indexes,
  }
}

function findRangeForQuote(pageIndex, quote) {
  const target = compactFocusText(quote)
  if (!pageIndex || target.length < 8) return null
  const compactPage = buildCompactPageTextMap(pageIndex)
  if (!compactPage.text) return null

  const candidates = [target]
  for (const length of [180, 140, 100, 70, 45, 28]) {
    if (target.length > length) candidates.push(target.slice(0, length))
  }

  for (const candidate of candidates) {
    if (candidate.length < 8) continue
    const compactStart = compactPage.text.indexOf(candidate)
    if (compactStart < 0) continue
    const compactEnd = compactStart + candidate.length - 1
    const startChar = compactPage.indexes[compactStart]
    const endChar = compactPage.indexes[compactEnd] + 1
    if (startChar == null || endChar == null || endChar <= startChar) continue
    return { startChar, endChar }
  }
  return null
}

function resolveFocusRange(pageIndex, focus) {
  if (!pageIndex || !focus) return null
  const startChar = focus.startChar ?? focus.start_char
  const endChar = focus.endChar ?? focus.end_char
  if (startChar != null && endChar != null && endChar > startChar) {
    return { startChar, endChar }
  }
  return findRangeForQuote(pageIndex, focus.quote || focus.quote_text || '')
}

function getRangeFromBoxSelection(pageIndex, pageNumber, rect, pageAnnotations = []) {
  if (!pageIndex || !rect) return null
  const touchedChars = pageIndex.chars.filter((char) => {
    if (!char?.rect || /\s/.test(char.char)) return false
    const center = {
      x: char.rect.left + char.rect.width / 2,
      y: char.rect.top + char.rect.height / 2,
    }
    if (
      center.x < rect.left ||
      center.x > rect.left + rect.width ||
      center.y < rect.top ||
      center.y > rect.top + rect.height
    ) {
      return false
    }
    if (pageAnnotations.length === 0) return true
    return pageAnnotations.some((annotation) =>
      annotation.start_char <= char.index && annotation.end_char > char.index,
    )
  })

  if (touchedChars.length === 0) return null
  return splitCharsIntoLineRanges(touchedChars, pageNumber)
}

function splitCharsIntoLineRanges(chars, pageNumber) {
  const groups = new Map()
  for (const char of chars) {
    const lineIndex = char.lineIndex ?? -1
    if (!groups.has(lineIndex)) groups.set(lineIndex, [])
    groups.get(lineIndex).push(char)
  }

  return Array.from(groups.entries())
    .sort(([leftLine], [rightLine]) => leftLine - rightLine)
    .flatMap(([, lineChars]) => {
      const ordered = [...lineChars].sort((left, right) => left.index - right.index)
      const ranges = []
      let current = null
      for (const char of ordered) {
        if (!current || char.index > current.endChar) {
          current = {
            pageNumber,
            startChar: char.index,
            endChar: char.index + 1,
          }
          ranges.push(current)
          continue
        }
        current.endChar = Math.max(current.endChar, char.index + 1)
      }
      return ranges
    })
}

function inkStrokeIntersectsRect(stroke, rect) {
  if (!stroke?.points?.length || !rect) return false
  const points = stroke.points.filter((point) =>
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y),
  )
  if (!points.length) return false
  if (points.some((point) => isPointInsideRect(point.x, point.y, rect, 0.004))) {
    return true
  }

  const left = rect.left
  const right = rect.left + rect.width
  const top = rect.top
  const bottom = rect.top + rect.height
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const segmentLeft = Math.min(previous.x, current.x)
    const segmentRight = Math.max(previous.x, current.x)
    const segmentTop = Math.min(previous.y, current.y)
    const segmentBottom = Math.max(previous.y, current.y)
    if (
      segmentRight >= left - 0.004 &&
      segmentLeft <= right + 0.004 &&
      segmentBottom >= top - 0.004 &&
      segmentTop <= bottom + 0.004
    ) {
      return true
    }
  }
  return false
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

function simplifyInkPoints(points = []) {
  const simplified = []
  let previous = null
  for (const point of points) {
    const next = {
      x: clampUnit(point.x),
      y: clampUnit(point.y),
    }
    if (!previous || Math.hypot(next.x - previous.x, next.y - previous.y) >= 0.0018) {
      simplified.push(next)
      previous = next
    }
  }
  return simplified
}

function normalizeInkPoint(event, pageFrame) {
  const point = normalizePointer(event, pageFrame)
  return {
    x: clampUnit(point.x),
    y: clampUnit(point.y),
  }
}

export function PdfViewport({
  activeTool,
  error,
  isLoading,
  matches = [],
  matchIndex = -1,
  noteFocus = null,
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
  inkAnnotations = [],
  inkOptions = DEFAULT_INK_OPTIONS,
  currentPaperId,
  onCreateAnnotation,
  onDeleteAnnotation,
  onEraseAnnotationRange,
  onCreateInkAnnotation,
  onDeleteInkAnnotation,
  onInsertSelectionNote,
  onAskAI,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
}) {
  const pageListRef = useRef(null)
  const fittedDocumentRef = useRef(null)
  const pageIndexesRef = useRef(new Map())
  const lastScrolledNoteFocusRef = useRef(null)
  const lastScrolledSearchRef = useRef(null)
  const onVisiblePageChangeRef = useRef(onVisiblePageChange)
  const pointerSelectionRef = useRef(null)
  const eraserStrokeRef = useRef(null)
  const inkStrokeRef = useRef(null)
  const screenshotDragRef = useRef(null)
  const pinnedDragRef = useRef(null)
  const currentSelectionRef = useRef(createEmptySelection())
  const [selectedAnnotationColor, setSelectedAnnotationColor] = useState(DEFAULT_ANNOTATION_COLOR)
  const [floatingMenu, setFloatingMenu] = useState({ visible: false, x: 0, y: 0 })
  const [screenshotMenu, setScreenshotMenu] = useState({ visible: false, x: 0, y: 0 })
  const [screenshotSelection, setScreenshotSelection] = useState(null)
  const [pinnedScreenshots, setPinnedScreenshots] = useState([])
  const [eraserPreview, setEraserPreview] = useState(createEmptyEraserPreview())
  const [drawingInkStroke, setDrawingInkStroke] = useState(null)
  const [selectionState, setSelectionState] = useState(createEmptySelection())
  const [searchFlashNonce, setSearchFlashNonce] = useState(0)
  const activeSearchMatch = matchIndex >= 0 ? matches[matchIndex] : null
  const activeSearchKey = activeSearchMatch
    ? `${matchIndex}:${activeSearchMatch.pageNumber}:${activeSearchMatch.startChar}:${activeSearchMatch.endChar}`
    : ''

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

  const inkAnnotationsByPage = useMemo(() => {
    const map = new Map()
    for (const annotation of inkAnnotations || []) {
      const pageNum = annotation.page_number ?? annotation.pageNumber
      if (!map.has(pageNum)) map.set(pageNum, [])
      map.get(pageNum).push(annotation)
    }
    return map
  }, [inkAnnotations])

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

  useEffect(() => {
    onVisiblePageChangeRef.current = onVisiblePageChange
  }, [onVisiblePageChange])

  function getRenderableAnnotations(pageNum) {
    const pageIndex = pageIndexesRef.current.get(pageNum)
    const pageAnnotations = annotationsByPage.get(pageNum) || []
    const renderSourceAnnotations = mergeRenderableAnnotationRanges(pageAnnotations)
    const renderedAnnotations = renderSourceAnnotations.map((annotation) => ({
      ...annotation,
      rects: pageIndex && ['v2', 'v3'].includes(annotation.geometry_version || 'v1')
        ? annotation.type === 'highlight'
          ? getHighlightRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
          : getLineRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
        : (annotation.rects || []),
      decorationRects:
        pageIndex &&
        ['v2', 'v3'].includes(annotation.geometry_version || 'v1') &&
        (annotation.type === 'underline' || annotation.type === 'wavy_underline')
        ? getDecorationRectsForRange(pageIndex, annotation.start_char, annotation.end_char)
        : [],
    }))

    const renderedSearchMatches = (searchMatchesByPage.get(pageNum) || []).map((match, index) => {
      const isCurrent =
        activeSearchMatch?.pageNumber === pageNum &&
        activeSearchMatch?.startChar === match.startChar &&
        activeSearchMatch?.endChar === match.endChar

      return {
        id: isCurrent
          ? `search-current:${searchFlashNonce}:${pageNum}:${match.startChar}:${match.endChar}`
          : `search:${pageNum}:${index}:${match.startChar}:${match.endChar}`,
        page_number: pageNum,
        start_char: match.startChar,
        end_char: match.endChar,
        quote_text: '',
        rects: getSearchRectsForRange(pageIndex, match.startChar, match.endChar),
        type: isCurrent ? 'search_current' : 'search',
        color: null,
      }
    })

    const noteFocusRange = pageIndex && noteFocus?.pageNumber === pageNum
      ? resolveFocusRange(pageIndex, noteFocus)
      : null
    const renderedNoteFocus = pageIndex && noteFocusRange
      ? [{
        id: `note-focus:${noteFocus.nonce}`,
        page_number: pageNum,
        start_char: noteFocusRange.startChar,
        end_char: noteFocusRange.endChar,
        quote_text: '',
        rects: getLineRectsForRange(pageIndex, noteFocusRange.startChar, noteFocusRange.endChar),
        type: 'note_focus',
        color: null,
      }]
      : []

    return [...renderedAnnotations, ...renderedSearchMatches, ...renderedNoteFocus]
  }

  function mergeRenderableAnnotationRanges(pageAnnotations = []) {
    const groups = new Map()
    const renderAnnotations = []

    for (const annotation of pageAnnotations) {
      if (!['highlight', 'underline', 'wavy_underline'].includes(annotation.type)) {
        renderAnnotations.push(annotation)
        continue
      }
      const key = [
        annotation.page_number,
        annotation.type,
        annotation.color || '',
        annotation.geometry_version || 'v1',
      ].join(':')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(annotation)
    }

    for (const group of groups.values()) {
      group.sort((left, right) => left.start_char - right.start_char || left.end_char - right.end_char)
      let current = null
      for (const annotation of group) {
        if (current && annotation.start_char <= current.end_char) {
          current.end_char = Math.max(current.end_char, annotation.end_char)
          current.quote_text = [current.quote_text, annotation.quote_text].filter(Boolean).join(' ')
          current.rects = [...(current.rects || []), ...(annotation.rects || [])]
          continue
        }
        current = { ...annotation, id: `merged:${annotation.id}` }
        renderAnnotations.push(current)
      }
    }

    return renderAnnotations
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
        text: selection.copyText || selection.text,
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
    const touchedChars = pageIndex.chars.filter((char) => {
      if (!char?.rect || /\s/.test(char.char)) return false
      const cx = char.rect.left + char.rect.width / 2
      const cy = char.rect.top + char.rect.height / 2
      return cx >= targetRect.left && cx <= targetRect.left + targetRect.width &&
             cy >= targetRect.top && cy <= targetRect.top + targetRect.height
    })

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

  function buildScreenshotPayload(selection, options = {}) {
    if (!selection) return null
    const extractedSelection = buildSelectionFromScreenshotRect(selection)
    const capture = captureScreenshotData(selection)
    if (!extractedSelection.visible && !options.allowImageOnly) return null
    if (!extractedSelection.visible && !capture?.dataUrl) return null
    return {
      text: extractedSelection.visible ? (extractedSelection.copyText || extractedSelection.text) : '',
      imageUrl: capture?.dataUrl || null,
      pageNumber: extractedSelection.visible ? extractedSelection.pageNumber : selection.pageNumber,
      startChar: extractedSelection.visible ? extractedSelection.startChar : null,
      endChar: extractedSelection.visible ? extractedSelection.endChar : null,
      rects: extractedSelection.visible ? extractedSelection.rects : [],
      anchorRect: extractedSelection.visible ? extractedSelection.anchorRect : selection.rect,
      contextBefore: extractedSelection.visible ? extractedSelection.contextBefore : '',
      contextAfter: extractedSelection.visible ? extractedSelection.contextAfter : '',
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
    const payload = buildScreenshotPayload(screenshotSelection, { allowImageOnly: true })
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

    const menuX = screenshotMenu.x
    const menuY = screenshotMenu.y
    const maxWidth = Math.min(480, capture.width)
    const scaleRatio = maxWidth / Math.max(1, capture.width)
    const previewWidth = maxWidth
    const previewHeight = Math.max(80, capture.height * scaleRatio)
    const left = Math.max(12, menuX - previewWidth / 2)
    const top = Math.max(12, menuY + 18)

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
    if (
      noteFocus?.pageNumber === pageNum &&
      noteFocus?.nonce &&
      lastScrolledNoteFocusRef.current !== noteFocus.nonce
    ) {
      window.setTimeout(() => {
        if (lastScrolledNoteFocusRef.current === noteFocus.nonce) return
        if (scrollToNoteFocus(noteFocus)) {
          lastScrolledNoteFocusRef.current = noteFocus.nonce
        }
      }, 0)
    }
    if (
      activeSearchMatch?.pageNumber === pageNum &&
      activeSearchKey &&
      lastScrolledSearchRef.current !== activeSearchKey
    ) {
      window.setTimeout(() => {
        if (lastScrolledSearchRef.current === activeSearchKey) return
        if (scrollToNoteFocus(activeSearchMatch, 'auto')) {
          lastScrolledSearchRef.current = activeSearchKey
        }
      }, 0)
    }
    if (onSearchExecute && !pdfDocument) {
      const indexes = Array.from(pageIndexesRef.current.values()).sort((left, right) => left.pageNumber - right.pageNumber)
      onSearchExecute(undefined, indexes)
    }
  }

  function scrollToNoteFocus(focus, behavior = 'smooth') {
    const container = readerRef.current
    if (!container || !focus?.pageNumber) return false

    const pageFrame = container.querySelector(`[data-page-number="${focus.pageNumber}"]`)
    const pageIndex = pageIndexesRef.current.get(focus.pageNumber)
    if (!pageFrame || !pageIndex) return false

    const focusRange = resolveFocusRange(pageIndex, focus)
    if (!focusRange) return false

    const rects = getLineRectsForRange(pageIndex, focusRange.startChar, focusRange.endChar)
    const firstRect = rects[0]
    if (!firstRect) return false

    const containerRect = container.getBoundingClientRect()
    const pageRect = pageFrame.getBoundingClientRect()
    const topInContainer = container.scrollTop + (pageRect.top - containerRect.top) + firstRect.top * pageRect.height
    const targetTop = Math.max(0, topInContainer - Math.min(180, container.clientHeight * 0.22))
    container.scrollTo({ top: targetTop, behavior })
    return true
  }

  function scrollToPageFrame(pageNum, behavior = 'auto') {
    const container = readerRef.current
    if (!container || !pageNum) return false

    const pageFrame = container.querySelector(`[data-page-number="${pageNum}"]`)
    if (!pageFrame) return false

    const containerRect = container.getBoundingClientRect()
    const pageRect = pageFrame.getBoundingClientRect()
    const targetTop = Math.max(
      0,
      container.scrollTop + (pageRect.top - containerRect.top) - Math.min(90, container.clientHeight * 0.14),
    )
    container.scrollTo({ top: targetTop, behavior })
    return true
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
    if (!pageIndex || !['v2', 'v3'].includes(annotation.geometry_version || 'v1')) {
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

    const byLine = new Map()
    const looseRanges = []
    for (const range of mergeRanges(ranges)) {
      const startChar = pageIndex.chars?.[range.startChar]
      const endChar = pageIndex.chars?.[Math.max(range.startChar, range.endChar - 1)]
      const lineIndex = startChar?.lineIndex === endChar?.lineIndex ? startChar?.lineIndex : null
      if (lineIndex == null || lineIndex < 0) {
        looseRanges.push(range)
        continue
      }
      if (!byLine.has(lineIndex)) byLine.set(lineIndex, [])
      byLine.get(lineIndex).push(range)
    }

    const previewRanges = [...looseRanges]
    for (const lineRanges of byLine.values()) {
      const ordered = [...lineRanges].sort((left, right) => left.startChar - right.startChar)
      let current = null
      for (const range of ordered) {
        if (!current) {
          current = { ...range }
          continue
        }

        const previousChar = pageIndex.chars?.[Math.max(current.startChar, current.endChar - 1)]
        const nextChar = pageIndex.chars?.[range.startChar]
        const charGap = Math.max(0, range.startChar - current.endChar)
        const visualGap = previousChar?.rect && nextChar?.rect
          ? Math.max(0, nextChar.rect.left - (previousChar.rect.left + previousChar.rect.width))
          : 0

        if (charGap <= 8 || visualGap <= 0.04) {
          current.endChar = Math.max(current.endChar, range.endChar)
          continue
        }

        previewRanges.push(current)
        current = { ...range }
      }
      if (current) previewRanges.push(current)
    }

    return mergeRanges(previewRanges)
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

  async function commitBoxEraserSelection(selection) {
    if (!selection?.rect) {
      clearScreenshotSelection()
      return
    }

    const pageIndex = pageIndexesRef.current.get(selection.pageNumber)
    const pageAnnotations = (annotationsByPage.get(selection.pageNumber) || [])
      .filter((annotation) => annotation.type === 'highlight' || annotation.type === 'underline' || annotation.type === 'wavy_underline')
    const ranges = getRangeFromBoxSelection(pageIndex, selection.pageNumber, selection.rect, pageAnnotations)
    const pageInkAnnotations = (inkAnnotationsByPage.get(selection.pageNumber) || [])
      .filter((stroke) => inkStrokeIntersectsRect(stroke, selection.rect))
    clearScreenshotSelection()
    await Promise.all(
      pageInkAnnotations.map((stroke) => onDeleteInkAnnotation?.(stroke.id)),
    )
    const activeRanges = (ranges || []).filter((range) =>
      pageAnnotations.some((annotation) => annotationIntersectsRange(annotation, range, pageIndex)),
    )
    if (!activeRanges.length) {
      return
    }

    const eraseSessionId = `box:${Date.now()}:${Math.random().toString(36).slice(2)}`
    for (const range of activeRanges) {
      await onEraseAnnotationRange?.({
        pageNumber: range.pageNumber,
        startChar: range.startChar,
        endChar: range.endChar,
        eraseSessionId,
      })
    }
  }

  async function commitInkStroke() {
    const stroke = inkStrokeRef.current
    inkStrokeRef.current = null
    setDrawingInkStroke(null)

    if (!stroke?.points?.length || stroke.points.length < 2) {
      return
    }

    const points = simplifyInkPoints(stroke.points)
    if (points.length < 2) return

    await onCreateInkAnnotation?.({
      pageNumber: stroke.pageNumber,
      color: stroke.color,
      opacity: stroke.opacity,
      strokeWidth: stroke.strokeWidth,
      points,
    })
  }

  function handleInkPointerDown(event, pageNumberFromOverlay = null) {
    if (activeTool !== 'ink') return
    const pageFrame = getPageFrameFromElement(event.currentTarget || event.target)
    if (!pageFrame) return
    const pageNum = pageNumberFromOverlay || Number(pageFrame.dataset.pageNumber || '0')
    if (!pageNum) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget?.setPointerCapture?.(event.pointerId)
    window.getSelection()?.removeAllRanges()
    clearSelection()
    clearScreenshotSelection()
    clearEraserPreview()

    const point = normalizeInkPoint(event, pageFrame)
    const nextStroke = {
      pageNumber: pageNum,
      color: inkOptions.color || DEFAULT_INK_OPTIONS.color,
      opacity: inkOptions.opacity ?? DEFAULT_INK_OPTIONS.opacity,
      strokeWidth: inkOptions.strokeWidth ?? DEFAULT_INK_OPTIONS.strokeWidth,
      points: [point],
    }
    inkStrokeRef.current = {
      ...nextStroke,
      pageFrame,
      pointerId: event.pointerId,
    }
    setDrawingInkStroke(nextStroke)
  }

  function handleInkErase(stroke) {
    if (activeTool !== 'eraser') return
    onDeleteInkAnnotation?.(stroke.id)
  }

  function handleMouseDown(event) {
    if (event.detail === 3) {
      handleTripleClick(event)
      return
    }

    if (activeTool === 'ink') {
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

    if (activeTool === 'screenshot' || activeTool === 'erase_box') {
      const resolved = resolvePointerPage(event)
      if (!resolved) {
        clearScreenshotSelection()
        return
      }

      event.preventDefault()
      clearSelection()
      clearEraserPreview()
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
      columnId: resolved.boundary.columnId,
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
    if (activeTool === 'ink' && inkStrokeRef.current?.pageFrame) {
      const stroke = inkStrokeRef.current
      if (stroke.pointerId != null && event.pointerId != null && stroke.pointerId !== event.pointerId) {
        return
      }
      event.preventDefault()
      const point = normalizeInkPoint(event, stroke.pageFrame)
      const previous = stroke.points[stroke.points.length - 1]
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0012) {
        return
      }
      stroke.points = [...stroke.points, point]
      inkStrokeRef.current = stroke
      setDrawingInkStroke({
        pageNumber: stroke.pageNumber,
        color: stroke.color,
        opacity: stroke.opacity,
        strokeWidth: stroke.strokeWidth,
        points: stroke.points,
      })
      return
    }

    if (activeTool === 'eraser' && eraserStrokeRef.current?.active) {
      event.preventDefault()
      updateEraserPreviewAtPointer(event)
      return
    }

    if ((activeTool === 'screenshot' || activeTool === 'erase_box') && screenshotDragRef.current?.active) {
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
      if (activeTool === 'erase_box') {
        const pageAnnotations = (annotationsByPage.get(current.pageNum) || [])
          .filter((annotation) => annotation.type === 'highlight' || annotation.type === 'underline' || annotation.type === 'wavy_underline')
        const pageIndex = pageIndexesRef.current.get(current.pageNum)
        const ranges = getRangeFromBoxSelection(pageIndex, current.pageNum, rect, pageAnnotations)
        const previewRects = ranges?.length
          ? ranges.flatMap((range) => getLineRectsForRange(pageIndex, range.startChar, range.endChar))
          : []
        setEraserPreview({
          visible: previewRects.length > 0,
          pageNumber: current.pageNum,
          startChar: ranges?.[0]?.startChar || 0,
          endChar: ranges?.[ranges.length - 1]?.endChar || 0,
          rects: previewRects,
        })
      }
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
    if (
      !boundary ||
      boundary.blockIndex !== current.blockIndex ||
      (current.columnId != null && boundary.columnId != null && boundary.columnId !== current.columnId)
    ) {
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
    if (activeTool === 'ink') {
      await commitInkStroke()
      return
    }

    if (activeTool === 'eraser') {
      await commitEraserStroke()
      return
    }

    if (activeTool === 'screenshot' || activeTool === 'erase_box') {
      const current = screenshotDragRef.current
      screenshotDragRef.current = null
      if (!current?.hasDragged || !current.lastSelection?.rect) {
        clearScreenshotSelection()
        clearEraserPreview()
        return
      }
      if (activeTool === 'erase_box') {
        await commitBoxEraserSelection(current.lastSelection)
        clearEraserPreview()
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
      quoteText: selection.copyText || selection.text,
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
    const selection = currentSelectionRef.current
    if (selection.visible && selection.text.trim()) {
      onInsertSelectionNote?.({
        text: selection.copyText || selection.text,
        pageNumber: selection.pageNumber,
        startChar: selection.startChar,
        endChar: selection.endChar,
        rects: selection.rects,
        anchorRect: selection.anchorRect,
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
      })
    }
    setFloatingMenu({ visible: false, x: 0, y: 0 })
    clearSelection()
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
    if (activeTool !== 'screenshot' && activeTool !== 'erase_box') {
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
    if (activeTool !== 'ink') {
      inkStrokeRef.current = null
      setDrawingInkStroke(null)
    }
  }, [activeTool])

  useEffect(() => {
    if (!noteFocus?.nonce || lastScrolledNoteFocusRef.current === noteFocus.nonce) return undefined

    const attempts = [0, 120, 360, 720]
    const timers = attempts.map((delay) => window.setTimeout(() => {
      if (lastScrolledNoteFocusRef.current === noteFocus.nonce) return
      if (scrollToNoteFocus(noteFocus)) {
        lastScrolledNoteFocusRef.current = noteFocus.nonce
      }
    }, delay))

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [noteFocus, pageNumber, readerRef, scale])

  useEffect(() => {
    if (!activeSearchMatch || !activeSearchKey) return undefined

    lastScrolledSearchRef.current = null
    setSearchFlashNonce((current) => current + 1)
    onVisiblePageChangeRef.current?.(activeSearchMatch.pageNumber)
    scrollToPageFrame(activeSearchMatch.pageNumber, 'auto')

    const attempts = [0, 120, 360, 720]
    const timers = attempts.map((delay) => window.setTimeout(() => {
      if (lastScrolledSearchRef.current === activeSearchKey) return
      if (scrollToNoteFocus(activeSearchMatch, 'auto')) {
        lastScrolledSearchRef.current = activeSearchKey
      }
    }, delay))

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [activeSearchKey, readerRef])

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
      event.clipboardData?.setData('text/plain', selection.copyText || selection.text)
    }

    document.addEventListener('copy', handleCopy)
    return () => document.removeEventListener('copy', handleCopy)
  }, [])

  useEffect(() => {
    function handlePointerMove(event) {
      const dragging = pinnedDragRef.current
      if (!dragging) return
      // Handle edge resize
      if (dragging.mode === 'edge') {
        const target = event.target.closest('.pdf-pinned-shot')
        if (target) {
          const rect = target.getBoundingClientRect()
          const x = event.clientX - rect.left, y = event.clientY - rect.top
          const near = 12
          const mode = []
          if (x > rect.width - near) mode.push('e')
          if (x < near) mode.push('w')
          if (y > rect.height - near) mode.push('s')
          if (y < near) mode.push('n')
          if (mode.length) {
            pinnedDragRef.current = { ...dragging, mode: 'resize-' + mode.join(''), startX: event.clientX, startY: event.clientY, startWidth: dragging.width, startHeight: dragging.height, aspectRatio: dragging.width / Math.max(1, dragging.height) }
            event.preventDefault()
            return
          }
        }
      }

      if (dragging.mode === "resize") {
        var ratio = dragging.startW / Math.max(1, dragging.startH); var nw = Math.max(80, Math.min(window.innerWidth * 0.85, dragging.startW + event.clientX - dragging.startX)); var nh = Math.round(nw / ratio)
        
        setPinnedScreenshots(function(c) { return c.map(function(s) { return s.id === dragging.id ? { ...s, width: nw, height: nh } : s }) })
        return
      }

      const nextLeft = Math.max(8, Math.min(window.innerWidth - dragging.width - 8, event.clientX - dragging.offsetX))
      const nextTop = Math.max(8, Math.min(window.innerHeight - dragging.height - 8, event.clientY - dragging.offsetY))

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
    function handlePinnedWheel(event) {
      const target = event.target.closest('.pdf-pinned-shot')
      if (!target) return
      const targetId = target.dataset.pinnedId
      if (!targetId) return

      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      setPinnedScreenshots((current) => current.map((item) => {
        if (item.id !== targetId) return item
        const scaleStep = direction > 0 ? 1.08 : 0.92
        const nextWidth = Math.max(120, Math.min(window.innerWidth * 0.88, item.width * scaleStep))
        const nextHeight = Math.max(80, nextWidth / (item.aspectRatio || (item.width / Math.max(1, item.height))))
        const centerX = item.left + item.width / 2
        const centerY = item.top + item.height / 2
        return {
          ...item,
          width: nextWidth,
          height: nextHeight,
          left: Math.max(8, Math.min(window.innerWidth - nextWidth - 8, centerX - nextWidth / 2)),
          top: Math.max(8, Math.min(window.innerHeight - nextHeight - 8, centerY - nextHeight / 2)),
        }
      }))
    }

    window.addEventListener('wheel', handlePinnedWheel, { passive: false })
    return () => window.removeEventListener('wheel', handlePinnedWheel)
  }, [])

  useEffect(() => {
    function handleWindowMouseUp() {
      if (activeTool === 'ink') {
        handleMouseUp()
        return
      }

      if (activeTool === 'eraser') {
        handleMouseUp()
        return
      }

        if ((activeTool === 'screenshot' || activeTool === 'erase_box') && screenshotDragRef.current) {
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
      inkStrokeRef.current = null
      screenshotDragRef.current = null
      setDrawingInkStroke(null)
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
      onMouseMove={activeTool === 'ink' ? undefined : handleMouseMove}
      onMouseUp={activeTool === 'ink' ? undefined : handleMouseUp}
      onPointerMove={activeTool === 'ink' ? handleMouseMove : undefined}
      onPointerUp={activeTool === 'ink' ? handleMouseUp : undefined}
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
            inkAnnotations={inkAnnotationsByPage.get(item) || []}
            drawingStroke={drawingInkStroke?.pageNumber === item ? drawingInkStroke : null}
            currentSelection={selectionState.visible && selectionState.pageNumber === item ? selectionState : null}
            eraserPreview={eraserPreview.visible && eraserPreview.pageNumber === item ? eraserPreview : null}
            screenshotSelection={screenshotSelection?.pageNumber === item ? screenshotSelection : null}
            selectionTool={activeTool}
            onInkPointerDown={(event) => handleInkPointerDown(event, item)}
            onInkPointerMove={handleMouseMove}
            onInkPointerUp={handleMouseUp}
            onInkErase={handleInkErase}
            onPageIndexReady={handlePageIndexReady}
            pageMetric={pageMetrics[index] ?? pageMetrics[0]}
            pageNumber={item}
            pdfDocument={pdfDocument}
            scale={scale}
            shouldRender={visiblePages.has(item)}
          />
        ))}
      </div>

      {typeof document !== 'undefined' && pinnedScreenshots.length > 0 ? createPortal(
        <div className="pdf-pinned-layer">
          {pinnedScreenshots.map((item) => (
            <div
              key={item.id}
              data-pinned-id={item.id}
              className="pdf-pinned-shot"
              style={{ left: item.left, top: item.top, width: item.width, height: item.height }}
              onPointerDown={(event) => {
                if (event.target.closest('button')) return
                const r = event.currentTarget.getBoundingClientRect()
                pinnedDragRef.current = { id: item.id, mode: 'drag', width: item.width, height: item.height, offsetX: event.clientX - r.left, offsetY: event.clientY - r.top }
              }}
            >
              <img src={item.imageUrl} alt="截图" className="pdf-pinned-shot__image" />
              <div
                className="pdf-pinned-shot__resizer"
                onPointerDown={(e) => { e.stopPropagation(); pinnedDragRef.current = { id: item.id, mode: 'resize', startX: e.clientX, startY: e.clientY, startW: item.width, startH: item.height } }}
              />
              <div className="pdf-pinned-shot__overlay">
                <button className="pinned-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => { var a = document.createElement('a'); a.href = item.imageUrl; a.download = 'shot-' + Date.now() + '.png'; a.click() }}><Download size={14} /></button>
                <button className="pinned-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => closePinnedScreenshot(item.id)}><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>,
        document.body,
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
