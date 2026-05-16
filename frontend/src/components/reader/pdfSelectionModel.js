const LINE_MERGE_EPSILON = 0.0045
const WORD_JOIN_GAP = 0.012
const BLOCK_VERTICAL_GAP = 0.028
const BLOCK_LEFT_SHIFT = 0.08
const LINE_SAFETY_GAP = 0.0006
const VISUAL_BAND_MIN_HEIGHT = 0.0022
const COLUMN_SPLIT_CENTER = 0.5
export const PDF_TEXT_GEOMETRY_VERSION = 'text-geometry-engine-v10'
const SUPERSCRIPT_CHAR_MAP = new Map(Object.entries({
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
}))
const SUBSCRIPT_CHAR_MAP = new Map(Object.entries({
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
}))

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRect(rect, width, height) {
  if (!width || !height) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }

  return {
    left: clamp(rect.left / width, 0, 1),
    top: clamp(rect.top / height, 0, 1),
    width: clamp(rect.width / width, 0, 1),
    height: clamp(rect.height / height, 0, 1),
  }
}

let textMeasureContext = null
const measuredOffsetCache = new WeakMap()

function getTextMeasureContext() {
  if (textMeasureContext || typeof document === 'undefined') return textMeasureContext
  textMeasureContext = document.createElement('canvas').getContext('2d')
  return textMeasureContext
}

function getCanvasFont(style) {
  if (style.font) return style.font
  return [
    style.fontStyle || 'normal',
    style.fontVariant || 'normal',
    style.fontWeight || 'normal',
    style.fontSize || '10px',
    style.fontFamily || 'sans-serif',
  ].join(' ')
}

function isMostlyHorizontalText(style) {
  const transform = style.transform || ''
  if (!transform || transform === 'none' || transform.startsWith('scale')) return true

  const match = transform.match(/^matrix\(([^)]+)\)$/)
  if (!match) return false

  const values = match[1]
    .split(',')
    .map((value) => Number.parseFloat(value.trim()))
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return false

  const [, skewY, skewX] = values
  return Math.abs(skewY) < 0.02 && Math.abs(skewX) < 0.02
}

function getMeasuredTextLayout(textDiv, text) {
  if (!textDiv || !text || text.length <= 1) return null

  const cached = measuredOffsetCache.get(textDiv)
  if (cached?.text === text) return cached.layout

  const context = getTextMeasureContext()
  if (!context) return null

  const style = window.getComputedStyle(textDiv)
  if (!isMostlyHorizontalText(style)) return null

  context.font = getCanvasFont(style)
  const letterSpacing = Number.parseFloat(style.letterSpacing)
  const spacing = Number.isFinite(letterSpacing) ? letterSpacing : 0
  const offsets = [0]

  for (let offset = 1; offset <= text.length; offset += 1) {
    const prefixWidth = context.measureText(text.slice(0, offset)).width
    const spacingWidth = offset >= text.length
      ? Math.max(0, text.length - 1) * spacing
      : offset * spacing
    offsets.push(prefixWidth + spacingWidth)
  }

  const total = offsets[offsets.length - 1]
  if (!Number.isFinite(total) || total <= 0) return null

  const normalizedOffsets = offsets.map((value) => clamp(value / total, 0, 1))
  const inkBounds = []

  for (let offset = 0; offset < text.length; offset += 1) {
    const advanceStart = offsets[offset]
    const advanceEnd = offsets[offset + 1]
    const advanceWidth = Math.max(0, advanceEnd - advanceStart)
    const metrics = context.measureText(text[offset])
    const actualLeft = Number.isFinite(metrics.actualBoundingBoxLeft)
      ? metrics.actualBoundingBoxLeft
      : 0
    const actualRight = Number.isFinite(metrics.actualBoundingBoxRight)
      ? metrics.actualBoundingBoxRight
      : advanceWidth
    const inkLeft = clamp(advanceStart - actualLeft, advanceStart, advanceEnd)
    const inkRight = clamp(
      advanceStart + Math.max(advanceWidth * 0.35, actualRight),
      inkLeft,
      advanceEnd,
    )
    inkBounds[offset] = {
      left: clamp(inkLeft / total, 0, 1),
      right: clamp(inkRight / total, 0, 1),
    }
  }

  const layout = { offsets: normalizedOffsets, inkBounds }
  measuredOffsetCache.set(textDiv, { text, layout })
  return layout
}

function getMeasuredCharGeometry({
  textDiv,
  text,
  offset,
  layerRect,
  viewportWidth,
  viewportHeight,
  fallbackRect,
}) {
  const spanRect = textDiv?.getBoundingClientRect?.()
  if (!spanRect || spanRect.width <= 0 || spanRect.height <= 0) return null
  if (spanRect.height > spanRect.width * 1.8 && text.length > 1) return null

  const layout = getMeasuredTextLayout(textDiv, text)
  if (!layout?.offsets || layout.offsets.length <= offset + 1) return null

  const style = window.getComputedStyle(textDiv)
  const isRtl = style.direction === 'rtl'
  const startRatio = layout.offsets[offset]
  const endRatio = layout.offsets[offset + 1]
  const spanLeft = spanRect.left - layerRect.left
  const spanTop = spanRect.top - layerRect.top
  const measuredLeft = isRtl
    ? spanLeft + spanRect.width * (1 - endRatio)
    : spanLeft + spanRect.width * startRatio
  const measuredRight = isRtl
    ? spanLeft + spanRect.width * (1 - startRatio)
    : spanLeft + spanRect.width * endRatio

  const fallbackTop = fallbackRect ? fallbackRect.top - layerRect.top : spanTop
  const fallbackHeight = fallbackRect?.height > 0 ? fallbackRect.height : spanRect.height
  const advanceRect = normalizeRect(
    {
      left: measuredLeft,
      top: fallbackTop,
      width: Math.max(0, measuredRight - measuredLeft),
      height: fallbackHeight,
    },
    viewportWidth,
    viewportHeight,
  )

  const inkBounds = !isRtl ? layout.inkBounds?.[offset] : null
  const inkLeft = inkBounds
    ? spanLeft + spanRect.width * inkBounds.left
    : measuredLeft
  const inkRight = inkBounds
    ? spanLeft + spanRect.width * inkBounds.right
    : measuredRight
  const inkRect = inkRight > inkLeft
    ? normalizeRect(
      {
        left: inkLeft,
        top: fallbackTop,
        width: Math.max(0, inkRight - inkLeft),
        height: fallbackHeight,
      },
      viewportWidth,
      viewportHeight,
    )
    : null

  return { advanceRect, inkRect }
}

function clampRectToNeighbors(rect, previousRect, nextRect) {
  if (!rect) return null
  const leftLimit = previousRect ? getRectRight(previousRect) : 0
  const rightLimit = nextRect ? nextRect.left : 1
  const left = clamp(rect.left, leftLimit, rightLimit)
  const right = clamp(getRectRight(rect), left, rightLimit)
  return {
    ...rect,
    left,
    width: Math.max(0, right - left),
  }
}

function getRectAgreementScore(primary, fallback) {
  if (!primary || !fallback || primary.width <= 0 || fallback.width <= 0) return 0
  const leftDelta = Math.abs(primary.left - fallback.left)
  const rightDelta = Math.abs(getRectRight(primary) - getRectRight(fallback))
  const widthBase = Math.max(primary.width, fallback.width, 0.0001)
  const edgeAgreement = 1 - clamp((leftDelta + rightDelta) / (widthBase * 1.8), 0, 1)
  const widthRatio = Math.min(primary.width, fallback.width) / Math.max(primary.width, fallback.width)
  return clamp(edgeAgreement * 0.72 + widthRatio * 0.28, 0, 1)
}

function buildCharGeometry({ rangeRect, measuredRect, inkRect, previousMeasuredRect, nextMeasuredRect }) {
  const advanceRect = measuredRect || rangeRect
  const constrainedAdvanceRect = measuredRect
    ? clampRectToNeighbors(measuredRect, previousMeasuredRect, nextMeasuredRect)
    : rangeRect
  const visualRect = inkRect && measuredRect
    ? clampRectToNeighbors(inkRect, previousMeasuredRect, nextMeasuredRect)
    : constrainedAdvanceRect
  const source = measuredRect ? 'measured' : 'range'
  const agreement = getRectAgreementScore(visualRect, rangeRect)
  const hasUsableVisualRect =
    visualRect?.width > 0 &&
    visualRect?.height > 0 &&
    (!rangeRect || visualRect.width <= Math.max(rangeRect.width * 1.8, rangeRect.width + 0.012))
  const hasStableAdvanceRect = advanceRect?.width > 0 && advanceRect?.height > 0
  const geometryConfidence = hasUsableVisualRect
    ? source === 'measured'
      ? Math.max(inkRect ? 0.72 : 0.62, agreement)
      : 0.48
    : 0

  return {
    rect: hasStableAdvanceRect ? advanceRect : rangeRect,
    rangeRect,
    advanceRect,
    visualRect: hasUsableVisualRect ? visualRect : rangeRect,
    geometrySource: source,
    geometryConfidence,
  }
}

function unionRects(rects) {
  const visible = rects.filter((rect) => rect && rect.width >= 0 && rect.height > 0)
  if (visible.length === 0) {
    return null
  }

  const left = Math.min(...visible.map((rect) => rect.left))
  const top = Math.min(...visible.map((rect) => rect.top))
  const right = Math.max(...visible.map((rect) => rect.left + rect.width))
  const bottom = Math.max(...visible.map((rect) => rect.top + rect.height))

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

function expandRect(rect, dx, dy) {
  return {
    left: clamp(rect.left - dx, 0, 1),
    top: clamp(rect.top - dy, 0, 1),
    width: clamp(rect.width + dx * 2, 0, 1),
    height: clamp(rect.height + dy * 2, 0, 1),
  }
}

function isWordChar(char) {
  return !/\s/.test(char)
}

function hasCjkChar(chars) {
  return chars.some((char) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(char.char))
}

function isJoinableChar(char) {
  return /[\w\u00C0-\uFFFF'’-]/.test(char)
}

function getRectBottom(rect) {
  if (!rect) return 0
  if (typeof rect.visualBottom === 'number') return rect.visualBottom
  return rect.top + rect.height
}

function getRectRight(rect) {
  return rect.left + rect.width
}

export function buildPageTextIndex(strings) {
  const chars = []
  const spans = []
  let fullText = ''
  let cursor = 0

  strings.forEach((value, divIndex) => {
    const text = typeof value === 'string' ? value : ''
    const start = cursor
    for (const char of text) {
      chars.push({
        index: cursor,
        char,
        divIndex,
        lineIndex: -1,
        blockIndex: -1,
        wordIndex: -1,
        rect: null,
        rangeRect: null,
        advanceRect: null,
        visualRect: null,
        textNode: null,
        textOffset: 0,
        geometrySource: 'none',
        geometryConfidence: 0,
      })
      fullText += char
      cursor += 1
    }
    spans.push({
      divIndex,
      start,
      end: cursor,
      text,
    })
  })

  return {
    fullText,
    chars,
    spans,
    length: cursor,
  }
}

export function buildRenderedPageIndex({
  pageNumber,
  textDivs,
  textStrings,
  textLayerElement,
  viewportWidth,
  viewportHeight,
}) {
  const base = buildPageTextIndex(textStrings)
  const layerRect = textLayerElement.getBoundingClientRect()

  base.spans.forEach((span) => {
    const textDiv = textDivs[span.divIndex]
    const textNode = textDiv?.firstChild
    if (!textDiv || !textNode || !span.text) {
      return
    }

    textDiv.dataset.charStart = String(span.start)
    textDiv.dataset.charEnd = String(span.end)

    const rangeRects = []
    const measuredRects = []
    const inkRects = []
    for (let offset = 0; offset < span.text.length; offset += 1) {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.setEnd(textNode, offset + 1)
      const rect = range.getBoundingClientRect()
      range.detach?.()

      const rangeRect = normalizeRect(
        {
          left: rect.left - layerRect.left,
          top: rect.top - layerRect.top,
          width: rect.width,
          height: rect.height,
        },
        viewportWidth,
        viewportHeight,
      )
      const measuredGeometry = getMeasuredCharGeometry({
        textDiv,
        text: span.text,
        offset,
        layerRect,
        viewportWidth,
        viewportHeight,
        fallbackRect: rect,
      })
      rangeRects[offset] = rangeRect
      measuredRects[offset] = measuredGeometry?.advanceRect?.width > 0 && measuredGeometry?.advanceRect?.height > 0
        ? measuredGeometry.advanceRect
        : null
      inkRects[offset] = measuredGeometry?.inkRect?.width > 0 && measuredGeometry?.inkRect?.height > 0
        ? measuredGeometry.inkRect
        : null
    }

    for (let offset = 0; offset < span.text.length; offset += 1) {
      const rangeRect = rangeRects[offset]
      const measuredRect = measuredRects[offset]
      const inkRect = inkRects[offset]

      const charIndex = span.start + offset
      const current = base.chars[charIndex]
      if (!current) continue

      current.textNode = textNode
      current.textOffset = offset
      Object.assign(current, buildCharGeometry({
        rangeRect,
        measuredRect,
        inkRect,
        previousMeasuredRect: measuredRects[offset - 1],
        nextMeasuredRect: measuredRects[offset + 1],
      }))
    }
  })

  const geometry = buildGeometry(base.chars)

  return {
    pageNumber,
    viewportWidth,
    viewportHeight,
    fullText: base.fullText,
    chars: base.chars,
    spans: base.spans,
    textLayerElement,
    length: base.length,
    lines: geometry.lines,
    lineMap: geometry.lineMap,
    words: geometry.words,
    blocks: geometry.blocks,
    columns: geometry.columns,
  }
}

function buildGeometry(chars) {
  const visibleChars = chars
    .filter((char) => char.rect && char.rect.height > 0)
    .sort((left, right) => {
      if (Math.abs(left.rect.top - right.rect.top) > LINE_MERGE_EPSILON) {
        return left.rect.top - right.rect.top
      }
      return left.rect.left - right.rect.left
    })

  const lineBuckets = []
  for (const char of visibleChars) {
    const centerY = char.rect.top + char.rect.height / 2
    const existing = lineBuckets.find((line) => {
      const tolerance = Math.max(LINE_MERGE_EPSILON, Math.min(line.height, char.rect.height) * 0.52)
      return Math.abs(line.centerY - centerY) <= tolerance
    })

    if (existing) {
      existing.charIndices.push(char.index)
      const rect = unionRects([existing.rect, char.rect])
      existing.rect = rect
      existing.centerY = rect.top + rect.height / 2
      existing.height = Math.max(existing.height, char.rect.height)
    } else {
      lineBuckets.push({
        charIndices: [char.index],
        centerY,
        height: char.rect.height,
        rect: { ...char.rect },
      })
    }
  }

  const mergedLineBuckets = mergeLineBuckets(lineBuckets)

  const lines = mergedLineBuckets
    .map((line) => {
      const charIndices = line.charIndices.sort((left, right) => left - right)
      const rects = charIndices.map((index) => chars[index]?.rect).filter(Boolean)
      return {
        index: -1,
        blockIndex: -1,
        blockId: -1,
        columnId: 0,
        metrics: null,
        wordIndices: [],
        startChar: Math.min(...charIndices),
        endChar: Math.max(...charIndices) + 1,
        charIndices,
        rect: unionRects(rects),
      }
    })
    .filter((line) => line.rect)
    .sort((left, right) => {
      if (Math.abs(left.rect.top - right.rect.top) > LINE_MERGE_EPSILON) {
        return left.rect.top - right.rect.top
      }
      return left.rect.left - right.rect.left
    })

  const lineMap = new Map()

  lines.forEach((line, index) => {
    line.index = index
    const lineChars = line.charIndices
      .map((charIndex) => chars[charIndex])
      .filter((char) => char?.rect)
      .sort((left, right) => left.rect.left - right.rect.left)
    line.metrics = buildLineMetrics(lineChars, line.rect)
    lineMap.set(index, line)
    for (const charIndex of line.charIndices) {
      if (chars[charIndex]) {
        chars[charIndex].lineIndex = index
        chars[charIndex].charRole = getCharRole(chars[charIndex], line.metrics)
      }
    }
  })

  const columns = assignColumnIds(lines)

  const blocks = []
  let currentBlock = null
  for (const line of lines) {
    const previousLine = currentBlock
      ? lines[currentBlock.lineIndices[currentBlock.lineIndices.length - 1]]
      : null
    const verticalGap = previousLine
      ? line.rect.top - (previousLine.rect.top + previousLine.rect.height)
      : 0
    const leftShift = previousLine ? Math.abs(line.rect.left - previousLine.rect.left) : 0
    const isNewBlock =
      !currentBlock ||
      line.columnId !== previousLine?.columnId ||
      verticalGap > Math.max(BLOCK_VERTICAL_GAP, previousLine.rect.height * 1.45) ||
      leftShift > BLOCK_LEFT_SHIFT

    if (isNewBlock) {
      currentBlock = {
        index: blocks.length,
        columnId: line.columnId,
        lineIndices: [],
        startChar: line.startChar,
        endChar: line.endChar,
        rect: { ...line.rect },
        type: 'text',
      }
      blocks.push(currentBlock)
    } else {
      currentBlock.endChar = line.endChar
      currentBlock.rect = unionRects([currentBlock.rect, line.rect])
    }

    line.blockIndex = currentBlock.index
    line.blockId = currentBlock.index
    for (const charIndex of line.charIndices) {
      if (chars[charIndex]) {
        chars[charIndex].blockIndex = currentBlock.index
        chars[charIndex].blockId = currentBlock.index
        chars[charIndex].columnId = line.columnId
      }
    }
    currentBlock.lineIndices.push(line.index)
  }

  const words = []
  for (const line of lines) {
    const orderedLineChars = line.charIndices
      .map((index) => chars[index])
      .filter((char) => char && char.rect)
      .sort((left, right) => left.rect.left - right.rect.left)

    let currentWord = null
    let previousChar = null
    for (const char of orderedLineChars) {
      const gap = previousChar
        ? char.rect.left - (previousChar.rect.left + previousChar.rect.width)
        : 0
      const shouldStartWord =
        !currentWord ||
        !isWordChar(char.char) ||
        (previousChar && (!isJoinableChar(previousChar.char) || !isJoinableChar(char.char))) ||
        gap > WORD_JOIN_GAP

      if (!isWordChar(char.char)) {
        currentWord = null
        previousChar = char
        continue
      }

      if (shouldStartWord) {
        currentWord = {
          index: words.length,
          lineIndex: line.index,
          blockIndex: line.blockIndex,
          startChar: char.index,
          endChar: char.index + 1,
          charIndices: [char.index],
          rect: { ...char.rect },
          text: char.char,
        }
        words.push(currentWord)
        line.wordIndices.push(currentWord.index)
      } else {
        currentWord.endChar = char.index + 1
        currentWord.charIndices.push(char.index)
        currentWord.rect = unionRects([currentWord.rect, char.rect])
        currentWord.text += char.char
      }

      char.wordIndex = currentWord.index
      char.blockIndex = line.blockIndex
      char.blockId = line.blockIndex
      char.columnId = line.columnId
      previousChar = char
    }
  }

  return { lines, lineMap, words, blocks, columns }
}

function mergeLineBuckets(lineBuckets) {
  const ordered = [...lineBuckets].sort((left, right) => {
    if (Math.abs(left.rect.top - right.rect.top) > LINE_MERGE_EPSILON) {
      return left.rect.top - right.rect.top
    }
    return left.rect.left - right.rect.left
  })

  const merged = []
  for (const bucket of ordered) {
    const previous = merged[merged.length - 1]
    if (previous && shouldMergeLineBuckets(previous, bucket)) {
      previous.charIndices.push(...bucket.charIndices)
      previous.rect = unionRects([previous.rect, bucket.rect])
      previous.centerY = previous.rect.top + previous.rect.height / 2
      previous.height = Math.max(previous.height, bucket.height)
      continue
    }
    merged.push({
      charIndices: [...bucket.charIndices],
      centerY: bucket.centerY,
      height: bucket.height,
      rect: { ...bucket.rect },
    })
  }

  return merged
}

function shouldMergeLineBuckets(leftBucket, rightBucket) {
  if (!leftBucket?.rect || !rightBucket?.rect) return false

  const minHeight = Math.min(leftBucket.rect.height, rightBucket.rect.height)
  const centerGap = Math.abs(
    (leftBucket.rect.top + leftBucket.rect.height / 2) -
    (rightBucket.rect.top + rightBucket.rect.height / 2),
  )
  const topGap = Math.abs(leftBucket.rect.top - rightBucket.rect.top)
  const verticalOverlap = Math.min(
    getRectBottom(leftBucket.rect),
    getRectBottom(rightBucket.rect),
  ) - Math.max(leftBucket.rect.top, rightBucket.rect.top)
  const overlapRatio = verticalOverlap / Math.max(0.0001, minHeight)
  const horizontalGap = Math.max(0, rightBucket.rect.left - getRectRight(leftBucket.rect))
  const maxHeight = Math.max(leftBucket.rect.height, rightBucket.rect.height)

  return (
    overlapRatio >= 0.62 &&
    centerGap <= minHeight * 0.36 &&
    topGap <= minHeight * 0.42 &&
    horizontalGap <= Math.max(0.09, maxHeight * 7.5)
  )
}

function assignColumnIds(lines) {
  const textLines = lines.filter((line) => line?.rect && line.rect.width > 0.03)
  const columnCandidates = textLines.filter((line) => {
    const center = line.rect.left + line.rect.width / 2
    return (
      line.rect.width < 0.66 &&
      (center < COLUMN_SPLIT_CENTER - 0.08 || center > COLUMN_SPLIT_CENTER + 0.08)
    )
  })
  const leftCount = columnCandidates.filter((line) => line.rect.left + line.rect.width / 2 < COLUMN_SPLIT_CENTER).length
  const rightCount = columnCandidates.filter((line) => line.rect.left + line.rect.width / 2 >= COLUMN_SPLIT_CENTER).length
  const hasTwoColumns = leftCount >= 3 && rightCount >= 3

  const columns = hasTwoColumns
    ? [
      { id: 0, left: 0, right: COLUMN_SPLIT_CENTER },
      { id: 1, left: COLUMN_SPLIT_CENTER, right: 1 },
    ]
    : [{ id: 0, left: 0, right: 1 }]

  for (const line of lines) {
    if (!hasTwoColumns) {
      line.columnId = 0
      continue
    }

    const center = line.rect.left + line.rect.width / 2
    const isFullWidth =
      line.rect.width >= 0.7 ||
      (line.rect.left < 0.24 && getRectRight(line.rect) > 0.76)

    line.columnId = isFullWidth ? -1 : (center < COLUMN_SPLIT_CENTER ? 0 : 1)
  }

  return columns
}

function buildLineMetrics(lineChars, lineRect) {
  if (!lineChars.length || !lineRect) {
    const fallbackTop = lineRect?.top ?? 0
    const fallbackBottom = getRectBottom(lineRect ?? { top: 0, height: 0 })
    return {
      textTop: fallbackTop,
      textBottom: fallbackBottom,
      visualTop: fallbackTop,
      visualBottom: fallbackBottom,
      visualHeight: lineRect?.height ?? 0,
      visualBand: {
        top: fallbackTop,
        bottom: fallbackBottom,
        height: lineRect?.height ?? 0,
      },
      baseline: fallbackBottom,
      medianHeight: lineRect?.height ?? 0,
      superscriptThreshold: 0,
    }
  }

  const heights = lineChars
    .map((char) => char.rect?.height)
    .filter((height) => typeof height === 'number' && height > 0)
  const medianHeight = getMedian(heights) || lineRect.height
  const primaryChars = getPrimaryTextChars(lineChars, medianHeight)
  const sourceChars = primaryChars.length > 0 ? primaryChars : lineChars
  const tops = sourceChars.map((char) => char.rect.top)
  const bottoms = sourceChars.map((char) => getRectBottom(char.rect))
  const textTop = getQuantile(tops, 0.16)
  const textBottom = getQuantile(bottoms, 0.86)
  const baseline = getQuantile(bottoms, 0.72)
  const cjkDominant = hasCjkChar(sourceChars)
  const isLargeLine = medianHeight >= 0.027
  const topInset = medianHeight * (isLargeLine ? (cjkDominant ? 0.035 : 0.105) : (cjkDominant ? 0.03 : 0.07))
  const bottomPad = medianHeight * (isLargeLine ? (cjkDominant ? 0.045 : 0.035) : (cjkDominant ? 0.045 : 0.04))
  const visualTop = clamp(textTop + topInset, 0, 1)
  const visualBottom = clamp(Math.max(textBottom, baseline) + bottomPad, visualTop + VISUAL_BAND_MIN_HEIGHT, 1)
  const superscriptThreshold = textTop + Math.max(medianHeight * 0.26, lineRect.height * 0.18)

  return {
    textTop,
    textBottom,
    visualTop,
    visualBottom,
    visualHeight: visualBottom - visualTop,
    visualBand: {
      top: visualTop,
      bottom: visualBottom,
      height: visualBottom - visualTop,
    },
    baseline,
    medianHeight,
    superscriptThreshold,
  }
}

function getPrimaryTextChars(lineChars, medianHeight) {
  const visible = lineChars.filter((char) => char?.rect && isWordChar(char.char))
  if (visible.length === 0) return []

  const baseChars = visible.filter((char) => {
    const height = char.rect.height || 0
    return height >= medianHeight * 0.64 && height <= medianHeight * 1.75
  })
  const minUsefulCount = Math.min(3, Math.ceil(visible.length * 0.45))
  return baseChars.length >= minUsefulCount ? baseChars : visible
}

function getCharRole(char, lineMetrics) {
  const value = char?.char || ''
  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(value)) return 'cjk'
  if (/[A-Za-z]/.test(value)) return 'latin'
  if (/\d/.test(value)) {
    if (char.rect && lineMetrics && char.rect.top < lineMetrics.superscriptThreshold) {
      return 'superscript'
    }
    return 'digit'
  }
  if (/[()[\]{}.,;:!?'"“”‘’*]/.test(value)) {
    if (char.rect && lineMetrics && char.rect.top < lineMetrics.superscriptThreshold) {
      return 'superscript'
    }
    return 'punctuation'
  }
  return 'base'
}

function isCjkDominant(chars) {
  const visible = chars.filter((char) => char?.rect)
  if (visible.length === 0) return false
  const cjkCount = visible.filter((char) => char.charRole === 'cjk').length
  return cjkCount / visible.length >= 0.45
}

function getCharRectForMode(char, mode = 'default') {
  if (!char) return null
  if (mode === 'selection-overlay') {
    if (char.geometryConfidence >= 0.55 && char.visualRect) return char.visualRect
    if (char.geometryConfidence >= 0.38 && char.advanceRect) return char.advanceRect
    return char.rangeRect || char.rect || char.visualRect || char.advanceRect || null
  }
  return char.rect || char.rangeRect || char.visualRect || char.advanceRect || null
}

function hasUsableTextRect(rect) {
  return rect && rect.width > 0 && rect.height > 0
}

function getCharEdgeUnionRect(char) {
  if (!char) return null
  return unionRects([
    char.rangeRect,
    char.advanceRect,
    char.visualRect,
    char.rect,
  ].filter(hasUsableTextRect))
}

function getOrderedCharsForLine(line, pageIndex) {
  return (line?.charIndices || [])
    .map((index) => pageIndex?.chars?.[index])
    .filter((char) => hasUsableTextRect(getCharRectForMode(char, 'selection-overlay')) && isWordChar(char.char))
    .sort((left, right) => {
      const leftRect = getCharRectForMode(left, 'selection-overlay')
      const rightRect = getCharRectForMode(right, 'selection-overlay')
      if (!leftRect || !rightRect) return left.index - right.index
      if (Math.abs(leftRect.left - rightRect.left) > 0.0001) {
        return leftRect.left - rightRect.left
      }
      return left.index - right.index
    })
}

function isShortTokenCalibrationCandidate(chars = []) {
  if (chars.length < 2 || chars.length > 9) return false
  const text = chars.map((char) => char.char).join('')
  if (!text || /\s/.test(text)) return false
  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(text)) return false
  if (!/^[A-Za-z0-9-]+$/.test(text)) return false
  return /[A-Za-z]/.test(text)
}

function getShortTokenCalibratedWidthRect(line, pageIndex, chars, widthRect) {
  if (!widthRect || !isShortTokenCalibrationCandidate(chars)) return widthRect

  const orderedLineChars = getOrderedCharsForLine(line, pageIndex)
  const firstChar = chars[0]
  const lastChar = chars[chars.length - 1]
  const firstIndex = orderedLineChars.findIndex((char) => char.index === firstChar.index)
  const lastIndex = orderedLineChars.findIndex((char) => char.index === lastChar.index)
  const previousChar = firstIndex > 0 ? orderedLineChars[firstIndex - 1] : null
  const nextChar = lastIndex >= 0 && lastIndex < orderedLineChars.length - 1
    ? orderedLineChars[lastIndex + 1]
    : null
  const firstRect = getCharEdgeUnionRect(firstChar) || getCharRectForMode(firstChar, 'selection-overlay')
  const lastRect = getCharEdgeUnionRect(lastChar) || getCharRectForMode(lastChar, 'selection-overlay')
  if (!hasUsableTextRect(firstRect) || !hasUsableTextRect(lastRect)) return widthRect

  const medianWidth = getMedian(
    chars
      .map((char) => getCharRectForMode(char, 'selection-overlay')?.width)
      .filter((width) => typeof width === 'number' && width > 0),
  )
  const edgePad = Math.max(0.0005, Math.min(0.0024, (medianWidth || firstRect.width || 0.004) * 0.18))
  const baseLeft = Math.min(widthRect.left, firstRect.left)
  const baseRight = Math.max(widthRect.left + widthRect.width, getRectRight(lastRect))
  const previousRect = previousChar
    ? getCharEdgeUnionRect(previousChar) || getCharRectForMode(previousChar, 'selection-overlay')
    : null
  const nextRect = nextChar
    ? getCharEdgeUnionRect(nextChar) || getCharRectForMode(nextChar, 'selection-overlay')
    : null
  const previousRight = previousRect ? getRectRight(previousRect) : 0
  const nextLeft = nextRect ? nextRect.left : 1
  const leftGap = Math.max(0, baseLeft - previousRight)
  const rightGap = Math.max(0, nextLeft - baseRight)
  const leftPad = previousRect ? Math.min(edgePad, leftGap * 0.36) : edgePad
  const rightPad = nextRect ? Math.min(edgePad, rightGap * 0.3) : edgePad
  const leftLimit = previousRect
    ? previousRight + Math.max(0.00012, Math.min(0.0007, leftGap * 0.18))
    : 0
  const rightLimit = nextRect
    ? nextLeft - Math.max(0.00012, Math.min(0.0007, rightGap * 0.18))
    : 1
  const left = clamp(baseLeft - leftPad, leftLimit, baseRight)
  const right = clamp(baseRight + rightPad, left, Math.max(left, rightLimit))

  if (right <= left) return widthRect
  return {
    ...widthRect,
    left,
    width: right - left,
    shortTokenCalibrated: true,
  }
}

function getCharsGeometryConfidence(chars = []) {
  const usable = chars.filter((char) => getCharRectForMode(char, 'selection-overlay'))
  if (usable.length === 0) return 0
  return getMedian(usable.map((char) => char.geometryConfidence || 0))
}

function shouldUsePreciseSelectionGeometry(chars = []) {
  if (chars.length === 0) return false
  const confidentCount = chars.filter((char) => (char.geometryConfidence || 0) >= 0.55).length
  return confidentCount / chars.length >= 0.55
}

function getSelectionRefinementBounds(line, pageIndex, segmentChars, widthRect = null) {
  if (!line || !pageIndex || !segmentChars.length) return null

  const orderedChars = getLineOrderedWordChars(line, pageIndex)
  const firstChar = segmentChars[0]
  const lastChar = segmentChars[segmentChars.length - 1]
  const firstIndex = orderedChars.findIndex((char) => char.index === firstChar.index)
  const lastIndex = orderedChars.findIndex((char) => char.index === lastChar.index)
  const previousChar = firstIndex > 0 ? orderedChars[firstIndex - 1] : null
  const nextChar = lastIndex >= 0 && lastIndex < orderedChars.length - 1 ? orderedChars[lastIndex + 1] : null
  const firstRects = [firstChar.rangeRect, firstChar.advanceRect, firstChar.visualRect, firstChar.rect]
    .filter(hasUsableTextRect)
  const lastRects = [lastChar.rangeRect, lastChar.advanceRect, lastChar.visualRect, lastChar.rect]
    .filter(hasUsableTextRect)
  const firstUnion = unionRects(firstRects)
  const lastUnion = unionRects(lastRects)
  if (!firstUnion || !lastUnion) return null

  const selectedLeft = widthRect?.left ?? Math.min(firstUnion.left, firstChar.rect?.left ?? firstUnion.left)
  const selectedRight = widthRect
    ? widthRect.left + widthRect.width
    : Math.max(getRectRight(lastUnion), getRectRight(lastChar.rect ?? lastUnion))
  const previousRect = previousChar
    ? unionRects([previousChar.rangeRect, previousChar.advanceRect, previousChar.visualRect, previousChar.rect])
    : null
  const nextRect = nextChar
    ? unionRects([nextChar.rangeRect, nextChar.advanceRect, nextChar.visualRect, nextChar.rect])
    : null
  const medianWidth = getMedian(
    segmentChars
      .map((char) => getCharRectForMode(char, 'selection-overlay')?.width)
      .filter((width) => typeof width === 'number' && width > 0),
  )
  const edgePad = Math.max(0.0012, Math.min(0.0045, (medianWidth || firstUnion.width || 0.005) * 0.32))
  const previousRight = previousRect ? getRectRight(previousRect) : 0
  const nextLeft = nextRect ? nextRect.left : 1
  const leftGap = previousRect ? Math.max(0, selectedLeft - previousRight) : Infinity
  const rightGap = nextRect ? Math.max(0, nextLeft - selectedRight) : Infinity
  const hasPreviousChar = Boolean(previousRect)
  const hasNextChar = Boolean(nextRect)
  const leftPad = hasPreviousChar
    ? Math.min(edgePad * 0.35, leftGap * 0.28, 0.0012)
    : edgePad
  const rightPad = hasNextChar
    ? Math.min(edgePad * 0.25, rightGap * 0.22, 0.001)
    : edgePad * 0.7
  const hardLeft = previousRect
    ? Math.max(previousRight + Math.max(0.00012, Math.min(0.0008, leftGap * 0.2)), selectedLeft - leftPad)
    : Math.max(0, selectedLeft - leftPad)
  const hardRight = nextRect
    ? Math.min(nextLeft - Math.max(0.00012, Math.min(0.0008, rightGap * 0.2)), selectedRight + rightPad)
    : Math.min(1, selectedRight + rightPad)

  return {
    hardLeft: clamp(hardLeft, 0, selectedLeft),
    hardRight: clamp(hardRight, selectedRight, 1),
    softLeft: clamp(selectedLeft - leftPad, 0, 1),
    softRight: clamp(selectedRight + rightPad, 0, 1),
    hasPreviousChar,
    hasNextChar,
    leftGap,
    rightGap,
  }
}

function getLineOrderedWordChars(line, pageIndex) {
  return line.charIndices
    .map((index) => pageIndex.chars[index])
    .filter((char) => hasUsableTextRect(getCharRectForMode(char)) && isWordChar(char.char))
    .sort((left, right) => {
      const leftRect = getCharRectForMode(left)
      const rightRect = getCharRectForMode(right)
      if (!leftRect || !rightRect) return left.index - right.index
      return leftRect.left - rightRect.left
    })
}

function getSegmentHorizontalPadding(line, pageIndex, segmentChars, kind = 'selection') {
  if (!line || !pageIndex || !segmentChars.length) {
    return { leftPad: 0.0012, rightPad: 0.0012 }
  }

  const orderedChars = getLineOrderedWordChars(line, pageIndex)
  const firstChar = segmentChars[0]
  const lastChar = segmentChars[segmentChars.length - 1]
  const firstIndex = orderedChars.findIndex((char) => char.index === firstChar.index)
  const lastIndex = orderedChars.findIndex((char) => char.index === lastChar.index)
  const previousChar = firstIndex > 0 ? orderedChars[firstIndex - 1] : null
  const nextChar = lastIndex >= 0 && lastIndex < orderedChars.length - 1 ? orderedChars[lastIndex + 1] : null

  const outerPad = kind === 'decoration' ? 0.001 : kind === 'search' ? 0.0018 : 0.0012
  const innerPadMax = kind === 'decoration' ? 0 : kind === 'search' ? 0.001 : 0.00025
  const firstRect = getCharRectForMode(firstChar, kind)
  const lastRect = getCharRectForMode(lastChar, kind)
  if (!hasUsableTextRect(firstRect) || !hasUsableTextRect(lastRect)) {
    return { leftPad: outerPad, rightPad: outerPad }
  }
  const previousRect = getCharRectForMode(previousChar, kind)
  const nextRect = getCharRectForMode(nextChar, kind)
  const leftGap = previousRect ? Math.max(0, firstRect.left - getRectRight(previousRect)) : 0
  const rightGap = nextRect ? Math.max(0, nextRect.left - getRectRight(lastRect)) : 0
  if (kind === 'selection-overlay') {
    if (!shouldUsePreciseSelectionGeometry(segmentChars)) {
      return {
        leftPad: previousChar ? Math.min(0.00025, leftGap * 0.25) : outerPad,
        rightPad: nextChar ? Math.min(0.00025, rightGap * 0.25) : outerPad,
      }
    }
    const medianWidth = getMedian(
      segmentChars
        .map((char) => getCharRectForMode(char, 'selection-overlay')?.width)
        .filter((width) => typeof width === 'number' && width > 0),
    )
    const confidence = getCharsGeometryConfidence(segmentChars)
    const padFactor = confidence >= 0.55 ? 0.18 : 0.3
    const edgePad = Math.max(0.0008, Math.min(0.0048, (medianWidth || firstRect.width || 0.004) * padFactor))
    return {
      leftPad: previousChar ? Math.min(edgePad, leftGap * 0.45) : edgePad,
      rightPad: nextChar ? Math.min(edgePad, rightGap * 0.28) : edgePad,
    }
  }

  return {
    leftPad: previousChar ? Math.min(innerPadMax, leftGap * 0.25) : outerPad,
    rightPad: nextChar ? Math.min(innerPadMax, rightGap * 0.25) : outerPad,
  }
}

function getSegmentWidthRect(line, pageIndex, segmentChars, kind = 'selection') {
  if (!segmentChars.length) return null
  const orderedChars = segmentChars
    .filter((char) => hasUsableTextRect(getCharRectForMode(char, kind)))
    .sort((left, right) => {
      const leftRect = getCharRectForMode(left, kind)
      const rightRect = getCharRectForMode(right, kind)
      if (!leftRect || !rightRect) return left.index - right.index
      if (Math.abs(leftRect.left - rightRect.left) > 0.0001) {
        return leftRect.left - rightRect.left
      }
      return left.index - right.index
    })
  if (!orderedChars.length) return null
  const firstChar = orderedChars[0]
  const lastChar = orderedChars[orderedChars.length - 1]
  const firstRect = getCharRectForMode(firstChar, kind)
  const lastRect = getCharRectForMode(lastChar, kind)
  if (!firstRect || !lastRect) return null
  if (kind === 'selection-overlay') {
    return {
      left: clamp(firstRect.left, 0, 1),
      width: Math.max(0, clamp(getRectRight(lastRect), firstRect.left, 1) - clamp(firstRect.left, 0, 1)),
    }
  }
  const { leftPad, rightPad } = getSegmentHorizontalPadding(line, pageIndex, orderedChars, kind)
  const left = clamp(firstRect.left - leftPad, 0, 1)
  const right = clamp(getRectRight(lastRect) + rightPad, left, 1)
  return {
    left,
    width: Math.max(0, right - left),
  }
}

function getLineVisualBand(line) {
  const metrics = line?.metrics
  if (metrics?.visualBand) return metrics.visualBand
  if (metrics && typeof metrics.visualTop === 'number' && typeof metrics.visualBottom === 'number') {
    return {
      top: metrics.visualTop,
      bottom: metrics.visualBottom,
      height: metrics.visualBottom - metrics.visualTop,
    }
  }
  const top = line?.rect?.top ?? 0
  const bottom = getRectBottom(line?.rect ?? { top: 0, height: 0 })
  return { top, bottom, height: bottom - top }
}

function getSelectionTightBand(line, chars) {
  const rects = chars
    .map((char) => getCharRectForMode(char, 'selection-overlay'))
    .filter((rect) => rect && rect.height > 0)
  const selectedRect = unionRects(rects)
  if (!selectedRect) return getLineVisualBand(line)

  const text = chars.map((char) => char.char).join('')
  const hasDescender = /[gjpqyQ]/.test(text)
  const medianHeight = getMedian(rects.map((rect) => rect.height).filter((height) => height > 0))
  const height = medianHeight || selectedRect.height
  const topPad = Math.max(0.00015, height * 0.035)
  const bottomPad = hasDescender
    ? Math.max(0.00025, height * 0.035)
    : -Math.max(0.0002, height * 0.075)
  const top = clamp(selectedRect.top + topPad, 0, 1)
  const bottom = clamp(
    getRectBottom(selectedRect) + bottomPad,
    top + VISUAL_BAND_MIN_HEIGHT,
    1,
  )
  return {
    top,
    bottom,
    height: Math.max(VISUAL_BAND_MIN_HEIGHT, bottom - top),
  }
}

function getLineVisualTop(line) {
  return getLineVisualBand(line).top
}

function getLineVisualBottom(line) {
  return getLineVisualBand(line).bottom
}

function getNeighborLineInColumn(pageIndex, line, direction) {
  if (!pageIndex || !line) return null
  const step = direction === 'previous' ? -1 : 1
  for (let index = line.index + step; index >= 0 && index < pageIndex.lines.length; index += step) {
    const candidate = pageIndex.lines[index]
    if (
      candidate &&
      (candidate.columnId === line.columnId || candidate.columnId === -1 || line.columnId === -1)
    ) {
      return candidate
    }
  }
  return null
}

export function getOrderedRange(startChar, endChar) {
  return startChar <= endChar
    ? { startChar, endChar }
    : { startChar: endChar, endChar: startChar }
}

export function getPageTextSlice(pageIndex, startChar, endChar) {
  if (!pageIndex) return ''
  const ordered = getOrderedRange(startChar, endChar)
  return pageIndex.fullText.slice(ordered.startChar, ordered.endChar)
}

function formatScriptText(text, script) {
  const map = script === 'super' ? SUPERSCRIPT_CHAR_MAP : SUBSCRIPT_CHAR_MAP
  const chars = Array.from(text)
  const mapped = chars.map((char) => map.get(char))
  if (mapped.every(Boolean)) return mapped.join('')
  const marker = script === 'super' ? '^' : '_'
  return chars.length === 1 ? `${marker}${text}` : `${marker}(${text})`
}

function flushCopyScript(accumulator) {
  if (!accumulator.scriptText) return
  accumulator.output += formatScriptText(accumulator.scriptText, accumulator.script)
  accumulator.script = ''
  accumulator.scriptText = ''
}

function appendCopyText(accumulator, text) {
  flushCopyScript(accumulator)
  accumulator.output += text
}

function appendCopyChar(accumulator, char, script) {
  if (!script) {
    appendCopyText(accumulator, char)
    return
  }
  if (accumulator.script && accumulator.script !== script) {
    flushCopyScript(accumulator)
  }
  accumulator.script = script
  accumulator.scriptText += char
}

function inferCopyScript(char, line) {
  if (!char?.rect || !line?.metrics) return ''
  const medianHeight = line.metrics.medianHeight || line.rect?.height || char.rect.height
  if (!medianHeight || char.rect.height > medianHeight * 0.92) return ''

  const textTop = line.metrics.textTop ?? line.rect?.top ?? char.rect.top
  const baseline = line.metrics.baseline ?? getRectBottom(line.rect || char.rect)
  const topOffset = char.rect.top - textTop
  const bottomOffset = getRectBottom(char.rect) - baseline

  if (topOffset < medianHeight * 0.26) return 'super'
  if (bottomOffset > medianHeight * 0.06 || topOffset > medianHeight * 0.34) return 'sub'
  return ''
}

function shouldInsertCopySpace(previousChar, char, medianWidth) {
  if (!previousChar?.rect || !char?.rect) return false
  const gap = char.rect.left - getRectRight(previousChar.rect)
  if (gap <= 0) return false
  const threshold = Math.max(0.006, Math.min(0.025, (medianWidth || previousChar.rect.width || 0.006) * 1.65))
  return gap > threshold
}

export function formatRangeTextForCopy(pageIndex, startChar, endChar) {
  if (!pageIndex) return ''
  const ordered = getOrderedRange(startChar, endChar)
  const fallback = getPageTextSlice(pageIndex, ordered.startChar, ordered.endChar)
  const selectedLines = (pageIndex.lines || [])
    .filter((line) => line.endChar > ordered.startChar && line.startChar < ordered.endChar)
    .sort((left, right) => left.index - right.index)

  if (selectedLines.length === 0) return fallback

  let sawScript = false
  const renderedLines = []
  for (const line of selectedLines) {
    const chars = line.charIndices
      .map((index) => pageIndex.chars[index])
      .filter((char) => (
        char?.rect &&
        char.index >= ordered.startChar &&
        char.index < ordered.endChar &&
        char.char !== '\r' &&
        char.char !== '\n'
      ))
      .sort((left, right) => left.rect.left - right.rect.left)

    if (chars.length === 0) continue

    const medianWidth = getMedian(chars.map((char) => char.rect?.width).filter((width) => width > 0))
    const accumulator = { output: '', script: '', scriptText: '' }
    let previousChar = null
    for (const char of chars) {
      if (/\s/.test(char.char)) {
        appendCopyText(accumulator, ' ')
        previousChar = null
        continue
      }
      if (previousChar && shouldInsertCopySpace(previousChar, char, medianWidth)) {
        appendCopyText(accumulator, ' ')
      }
      const script = inferCopyScript(char, line)
      if (script) sawScript = true
      appendCopyChar(accumulator, char.char, script)
      previousChar = char
    }
    flushCopyScript(accumulator)
    const lineText = accumulator.output.replace(/[ \t]+/g, ' ').trim()
    if (lineText) renderedLines.push(lineText)
  }

  return sawScript ? renderedLines.join('\n').trim() || fallback : fallback
}

export function getContextAroundRange(pageIndex, startChar, endChar, radius = 120) {
  if (!pageIndex) return { before: '', after: '' }
  return {
    before: pageIndex.fullText.slice(Math.max(0, startChar - radius), startChar),
    after: pageIndex.fullText.slice(endChar, Math.min(pageIndex.length, endChar + radius)),
  }
}

export function getRangeRects(pageIndex, startChar, endChar) {
  if (!pageIndex) return []
  const ordered = getOrderedRange(startChar, endChar)
  const chars = pageIndex.chars
    .slice(ordered.startChar, ordered.endChar)
    .filter((char) => char?.rect && char.rect.width >= 0 && char.rect.height > 0)

  if (chars.length === 0) {
    return []
  }

  const lines = new Map()
  for (const char of chars) {
    const key = char.lineIndex
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push(char)
  }

  return Array.from(lines.entries())
    .sort(([leftLine], [rightLine]) => leftLine - rightLine)
    .map(([lineIndex, lineChars]) => {
      const line = pageIndex.lines?.[lineIndex]
      const rect = unionRects(lineChars.map((char) => char.rect))
      if (!rect) return null
      const height = line?.rect?.height || rect.height
      return expandRect(
        {
          left: rect.left,
          top: (line?.rect?.top ?? rect.top) + height * 0.08,
          width: rect.width,
          height: height * 0.78,
        },
        0.002,
        0.0015,
      )
    })
    .filter(Boolean)
}

function collectRangeLineChars(pageIndex, startChar, endChar) {
  if (!pageIndex) return []
  const ordered = getOrderedRange(startChar, endChar)
  return (pageIndex.lines || [])
    .filter((line) => line.endChar > ordered.startChar && line.startChar < ordered.endChar)
    .map((line) => {
      const chars = line.charIndices
        .map((index) => pageIndex.chars[index])
        .filter(
          (char) =>
            char &&
            char.index >= ordered.startChar &&
            char.index < ordered.endChar &&
            getCharRectForMode(char, 'selection-overlay') &&
            isWordChar(char.char),
        )
        .sort((left, right) => {
          const leftRect = getCharRectForMode(left, 'selection-overlay')
          const rightRect = getCharRectForMode(right, 'selection-overlay')
          if (!leftRect || !rightRect) return left.index - right.index
          if (Math.abs(leftRect.left - rightRect.left) > 0.0001) {
            return leftRect.left - rightRect.left
          }
          return left.index - right.index
        })
      return { line, chars }
    })
    .filter((entry) => entry.chars.length > 0)
}

function getDomRangeWidthRectsForChars(pageIndex, startChar, endChar) {
  if (!pageIndex || typeof document === 'undefined') return []
  const rows = collectRangeLineChars(pageIndex, startChar, endChar)
  const layerRect = pageIndex.textLayerElement?.getBoundingClientRect?.()
  if (!layerRect || layerRect.width <= 0 || layerRect.height <= 0) return []

  return rows
    .map(({ line, chars }) => {
      const firstChar = chars[0]
      const lastChar = chars[chars.length - 1]
      if (!firstChar?.textNode || !lastChar?.textNode) return null

      const range = document.createRange()
      try {
        range.setStart(firstChar.textNode, firstChar.textOffset)
        range.setEnd(lastChar.textNode, lastChar.textOffset + 1)
      } catch {
        range.detach?.()
        return null
      }

      const domRects = Array.from(range.getClientRects?.() || [])
      range.detach?.()
      const normalizedRects = domRects
        .map((rect) => normalizeRect(
          {
            left: rect.left - layerRect.left,
            top: rect.top - layerRect.top,
            width: rect.width,
            height: rect.height,
          },
          layerRect.width,
          layerRect.height,
        ))
        .filter((rect) => rect.width > 0 && rect.height > 0)
      const rangeRect = unionRects(normalizedRects)
      if (!rangeRect) return null

      const widthRect = getSegmentWidthRect(line, pageIndex, chars, 'selection-overlay')
      if (!widthRect) return {
        lineIndex: line.index,
        left: rangeRect.left,
        width: rangeRect.width,
      }
      return {
        lineIndex: line.index,
        left: widthRect.left,
        width: widthRect.width,
      }
    })
    .filter(Boolean)
}

export function getVisualBandsForRange(pageIndex, startChar, endChar, mode = 'selection') {
  if (!pageIndex) return []
  const ordered = getOrderedRange(startChar, endChar)

  return collectRangeLineChars(pageIndex, ordered.startChar, ordered.endChar)
    .map(({ line, chars }) => {
      const previousLine = getNeighborLineInColumn(pageIndex, line, 'previous')
      const nextLine = getNeighborLineInColumn(pageIndex, line, 'next')
      const metrics = line.metrics || buildLineMetrics(chars, line.rect)
      const widthMode = mode === 'decoration'
        ? 'decoration'
        : mode === 'search'
          ? 'selection-overlay'
          : 'selection'
      const widthRect = getSegmentWidthRect(line, pageIndex, chars, widthMode)
      if (!widthRect) return null
      const band = getLineVisualBand({ ...line, metrics })
      const topLimit = previousLine
        ? getLineVisualBottom(previousLine) + LINE_SAFETY_GAP
        : 0
      const bottomLimit = nextLine
        ? getLineVisualTop(nextLine) - LINE_SAFETY_GAP
        : 1
      const isHighlight = mode === 'highlight'
      const isSearch = mode === 'search'
      const selectedRect = isHighlight ? unionRects(chars.map((char) => char.rect)) : null
      const raisedChars = isHighlight
        ? chars.filter((char) =>
          char.charRole === 'superscript' ||
          (metrics?.superscriptThreshold && char.rect.top < metrics.superscriptThreshold),
        )
        : []
      const hasRaisedChars = raisedChars.length > 0
      const charHeight = metrics?.medianHeight || selectedRect?.height || band.height || 0
      const topInset = isSearch ? 0.06 : isHighlight ? (hasRaisedChars ? 0.06 : 0.14) : 0
      const bottomInset = isSearch ? 0.02 : isHighlight ? 0.07 : 0
      let idealTop = band.top + band.height * topInset
      let idealBottom = band.bottom - band.height * bottomInset
      if (hasRaisedChars) {
        const raisedTop = Math.min(...raisedChars.map((char) => char.rect.top))
        idealTop = Math.min(idealTop, raisedTop - Math.max(0.0008, charHeight * 0.04))
      }
      if (selectedRect) {
        idealBottom = Math.max(idealBottom, selectedRect.top + selectedRect.height - Math.max(0.0004, charHeight * 0.02))
      }
      const clampedTop = clamp(idealTop, topLimit, Math.max(topLimit, bottomLimit - 0.002))
      const clampedBottom = clamp(
        idealBottom,
        clampedTop + VISUAL_BAND_MIN_HEIGHT,
        Math.max(clampedTop + VISUAL_BAND_MIN_HEIGHT, bottomLimit),
      )
      return expandRect(
        {
          left: widthRect.left,
          top: clampedTop,
          width: widthRect.width,
          height: Math.max(VISUAL_BAND_MIN_HEIGHT, clampedBottom - clampedTop),
        },
        0,
        0,
      )
    })
    .filter(Boolean)
}

export function getTextRangeGeometry(pageIndex, startChar, endChar, options = {}) {
  if (!pageIndex) {
    return {
      orderedRange: { startChar: 0, endChar: 0 },
      text: '',
      copyText: '',
      charsByLine: [],
      rects: [],
    }
  }

  const orderedRange = getOrderedRange(startChar, endChar)
  const charsByLine = collectRangeLineChars(pageIndex, orderedRange.startChar, orderedRange.endChar)
  const text = getPageTextSlice(pageIndex, orderedRange.startChar, orderedRange.endChar)
  const copyText = formatRangeTextForCopy(pageIndex, orderedRange.startChar, orderedRange.endChar)
  const visualMode = options.visualMode || 'selection-overlay'
  const rects = visualMode === 'selection-overlay'
    ? getCalibratedSelectionOverlayRects(pageIndex, orderedRange.startChar, orderedRange.endChar)
    : visualMode === 'search'
      ? getSearchRectsForRange(pageIndex, orderedRange.startChar, orderedRange.endChar)
    : visualMode === 'highlight'
      ? getHighlightRectsForRange(pageIndex, orderedRange.startChar, orderedRange.endChar)
      : visualMode === 'underline' || visualMode === 'wavy-underline'
        ? getDecorationRectsForRange(pageIndex, orderedRange.startChar, orderedRange.endChar)
        : getLineRectsForRange(pageIndex, orderedRange.startChar, orderedRange.endChar)
  const geometryConfidence = getCharsGeometryConfidence(charsByLine.flatMap((entry) => entry.chars))

  return {
    orderedRange,
    text,
    copyText,
    charsByLine,
    geometryConfidence,
    rects,
  }
}

export function getTextRangeDebugGeometry(pageIndex, startChar, endChar) {
  if (!pageIndex) return { finalRects: [], visualRects: [], advanceRects: [], rangeRects: [] }
  const orderedRange = getOrderedRange(startChar, endChar)
  const chars = pageIndex.chars
    .slice(orderedRange.startChar, orderedRange.endChar)
    .filter((char) => char && !/\s/.test(char.char))

  return {
    finalRects: getCalibratedSelectionOverlayRects(pageIndex, orderedRange.startChar, orderedRange.endChar),
    visualRects: chars.map((char) => char.visualRect).filter(Boolean),
    advanceRects: chars.map((char) => char.advanceRect || char.rect).filter(Boolean),
    rangeRects: chars.map((char) => char.rangeRect).filter(Boolean),
  }
}

export function getSelectionOverlayRects(pageIndex, startChar, endChar) {
  const rows = collectRangeLineChars(pageIndex, startChar, endChar)
    .map(({ line, chars }) => {
      const metrics = line.metrics || buildLineMetrics(chars, line.rect)
      const band = getSelectionTightBand({ ...line, metrics }, chars)
      return { line, chars, metrics, band }
    })

  return rows
    .map(({ line, chars }) => {
      const rawWidthRect = getSegmentWidthRect(line, pageIndex, chars, 'selection-overlay')
      const widthRect = getShortTokenCalibratedWidthRect(line, pageIndex, chars, rawWidthRect)
      if (!widthRect) return null
      const current = rows.find((row) => row.line.index === line.index)
      const band = current?.band || getLineVisualBand(line)
      const previousRow = rows
        .filter((row) =>
          row.line.index < line.index &&
          (row.line.columnId === line.columnId || row.line.columnId === -1 || line.columnId === -1),
        )
        .at(-1)
      const nextRow = rows.find((row) =>
        row.line.index > line.index &&
        (row.line.columnId === line.columnId || row.line.columnId === -1 || line.columnId === -1),
      )
      const lineCenter = band.top + band.height / 2
      const previousCenter = previousRow
        ? previousRow.band.top + previousRow.band.height / 2
        : null
      const nextCenter = nextRow
        ? nextRow.band.top + nextRow.band.height / 2
        : null
      const rowGap = Math.max(LINE_SAFETY_GAP, Math.min(0.0022, band.height * 0.08))
      const topLimit = previousCenter == null
        ? 0
        : (previousCenter + lineCenter) / 2 + rowGap
      const bottomLimit = nextCenter == null
        ? 1
        : (lineCenter + nextCenter) / 2 - rowGap
      const top = clamp(band.top, topLimit, Math.max(topLimit, bottomLimit - VISUAL_BAND_MIN_HEIGHT))
      const bottom = clamp(
        band.bottom,
        top + VISUAL_BAND_MIN_HEIGHT,
        Math.max(top + VISUAL_BAND_MIN_HEIGHT, bottomLimit),
      )
      return {
        lineIndex: line.index,
        refinementBounds: getSelectionRefinementBounds(line, pageIndex, chars, widthRect),
        left: widthRect.left,
        top,
        width: widthRect.width,
        height: Math.max(VISUAL_BAND_MIN_HEIGHT, bottom - top),
      }
    })
    .filter(Boolean)
}

export function getCalibratedSelectionOverlayRects(pageIndex, startChar, endChar) {
  const stableRects = getSelectionOverlayRects(pageIndex, startChar, endChar)
  const widthRects = getDomRangeWidthRectsForChars(pageIndex, startChar, endChar)
  if (stableRects.length === 0 || widthRects.length === 0) return stableRects

  const widthByLine = new Map(widthRects.map((rect) => [rect.lineIndex, rect]))
  return stableRects.map((rect, index) => {
    if (rect.shortTokenCalibrated) return rect
    const widthRect = widthByLine.get(rect.lineIndex ?? index)
    return widthRect
      ? {
        ...rect,
        left: widthRect.left,
        width: widthRect.width,
        refinementBounds: rect.refinementBounds
          ? {
            ...rect.refinementBounds,
            softLeft: Math.min(rect.refinementBounds.softLeft, widthRect.left),
            softRight: Math.max(rect.refinementBounds.softRight, widthRect.left + widthRect.width),
          }
          : null,
      }
      : rect
  })
}

export function getLineRectsForRange(pageIndex, startChar, endChar) {
  return getVisualBandsForRange(pageIndex, startChar, endChar, 'selection')
}

export function getHighlightRectsForRange(pageIndex, startChar, endChar) {
  return getLineRectsForRange(pageIndex, startChar, endChar)
}

export function getSearchRectsForRange(pageIndex, startChar, endChar) {
  return getCalibratedSelectionOverlayRects(pageIndex, startChar, endChar)
}

export function getDecorationRectsForRange(pageIndex, startChar, endChar) {
  if (!pageIndex) return []
  const ordered = getOrderedRange(startChar, endChar)
  const touchedLines = pageIndex.lines.filter(
    (line) => line.endChar > ordered.startChar && line.startChar < ordered.endChar,
  )

  return touchedLines
    .map((line) => {
      const chars = line.charIndices
        .map((index) => pageIndex.chars[index])
        .filter(
          (char) =>
            char &&
            char.index >= ordered.startChar &&
            char.index < ordered.endChar &&
            char.rect &&
            isWordChar(char.char),
        )
      const rect = unionRects(chars.map((char) => char.rect))
      if (!rect) return null
      const widthRect = getSegmentWidthRect(line, pageIndex, chars, 'decoration')
      if (!widthRect) return null

      const lineChars = line.charIndices
        .map((index) => pageIndex.chars[index])
        .filter((char) => char?.rect && isWordChar(char.char))
      const primaryLineChars = lineChars.filter((char) => char.charRole !== 'superscript')
      const metricChars = primaryLineChars.length > 0 ? primaryLineChars : lineChars
      const lineTextRect = unionRects(metricChars.map((char) => char.rect)) || rect
      const metrics = line.metrics || buildLineMetrics(metricChars, line.rect)
      const medianHeight = getMedian(
        metricChars
          .map((char) => char.rect?.height)
          .filter((height) => typeof height === 'number' && height > 0),
      )
      const charHeight = medianHeight || metrics.medianHeight || lineTextRect.height || line.rect.height
      const baseline = metrics.baseline || metrics.textBottom || getRectBottom(lineTextRect)
      const baselineOffset = charHeight * (hasCjkChar(metricChars) ? 0.004 : 0.006)
      const strokeHeight = Math.max(0.0018, Math.min(0.0042, charHeight * 0.085))
      const nextLine = getNeighborLineInColumn(pageIndex, line, 'next')
      const nextLineTop = nextLine ? getLineVisualTop(nextLine) : 1
      const minTop = baseline - strokeHeight * 0.45
      const maxTop = Math.max(
        minTop,
        nextLineTop - strokeHeight - Math.max(0.003, charHeight * 0.05),
      )
      const preferredTop = baseline + baselineOffset - strokeHeight * 0.35
      const top = clamp(preferredTop, minTop, maxTop)

      return {
        left: widthRect.left,
        top: clamp(top, 0, 1),
        width: widthRect.width,
        height: strokeHeight,
      }
    })
    .filter(Boolean)
}

function getMedian(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function getQuantile(values, quantile) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = clamp(Math.round((sorted.length - 1) * quantile), 0, sorted.length - 1)
  return sorted[index]
}

export function buildSelectionFromWordRange(pageIndex, startWordIndex, endWordIndex) {
  if (!pageIndex) return null
  const startWord = pageIndex.words?.[startWordIndex]
  const endWord = pageIndex.words?.[endWordIndex]
  if (!startWord || !endWord || startWord.blockIndex !== endWord.blockIndex) {
    return null
  }

  const firstWordIndex = Math.min(startWordIndex, endWordIndex)
  const lastWordIndex = Math.max(startWordIndex, endWordIndex)
  const selectedWords = pageIndex.words
    .slice(firstWordIndex, lastWordIndex + 1)
    .filter((word) => word.blockIndex === startWord.blockIndex)

  if (selectedWords.length === 0) return null

  const startChar = selectedWords[0].startChar
  const endChar = selectedWords[selectedWords.length - 1].endChar
  const geometry = getTextRangeGeometry(pageIndex, startChar, endChar, {
    visualMode: 'selection-overlay',
  })
  if (!geometry.text.trim() || geometry.rects.length === 0) return null

  const context = getContextAroundRange(pageIndex, startChar, endChar)

  return {
    startChar,
    endChar,
    text: geometry.text,
    copyText: geometry.copyText,
    rects: geometry.rects,
    anchorRect: geometry.rects[0] || null,
    contextBefore: context.before,
    contextAfter: context.after,
  }
}

export function findWordAtPoint(pageIndex, normalizedX, normalizedY) {
  if (!pageIndex) return null

  const preciseChar = findTextCharCore(pageIndex, normalizedX, normalizedY, null, {
    mode: 'selection',
    allowClosestFallback: false,
  })
  if (preciseChar?.wordIndex >= 0) {
    return pageIndex.words?.[preciseChar.wordIndex] || null
  }

  const sameLine = findLineAtPoint(pageIndex, normalizedX, normalizedY)

  if (!sameLine) return null

  const lineWords = sameLine.wordIndices.map((index) => pageIndex.words[index]).filter(Boolean)
  const hitCandidates = []

  for (const word of lineWords) {
    const hitRect = expandRect(word.rect, 0.0018, 0.005)
    if (!isPointInsideRect(normalizedX, normalizedY, hitRect, 0)) continue

    const dx = normalizedX < word.rect.left
      ? word.rect.left - normalizedX
      : normalizedX > getRectRight(word.rect)
        ? normalizedX - getRectRight(word.rect)
        : 0
    const dy = normalizedY < word.rect.top
      ? word.rect.top - normalizedY
      : normalizedY > getRectBottom(word.rect)
        ? normalizedY - getRectBottom(word.rect)
        : 0
    const centerX = word.rect.left + word.rect.width / 2
    hitCandidates.push({
      word,
      score: dx * dx + dy * dy * 1.8 + Math.abs(centerX - normalizedX) * 0.0002,
    })
  }

  if (hitCandidates.length > 0) {
    hitCandidates.sort((left, right) => left.score - right.score)
    return hitCandidates[0].word
  }

  let best = null
  for (const word of lineWords) {
    const dx = normalizedX < word.rect.left
      ? word.rect.left - normalizedX
      : normalizedX > getRectRight(word.rect)
        ? normalizedX - getRectRight(word.rect)
        : 0
    const dy = normalizedY < word.rect.top
      ? word.rect.top - normalizedY
      : normalizedY > getRectBottom(word.rect)
        ? normalizedY - getRectBottom(word.rect)
        : 0
    const distance = Math.hypot(dx, dy * 1.6)
    if (!best || distance < best.distance) {
      best = { word, distance }
    }
  }

  return best && best.distance < 0.018 ? best.word : null
}

function getTextHitTolerances(line, chars, mode = 'annotation') {
  const medianWidth = getMedian(
    chars
      .map((char) => char.rect?.width)
      .filter((width) => typeof width === 'number' && width > 0),
  )
  const medianHeight = getMedian(
    chars
      .map((char) => char.rect?.height)
      .filter((height) => typeof height === 'number' && height > 0),
  )
  const cjkDominant = isCjkDominant(chars)
  const lineHeight = line?.metrics?.medianHeight || medianHeight || line?.rect?.height || 0.01

  if (mode === 'selection') {
    return {
      medianWidth,
      xTolerance: cjkDominant
        ? Math.max(0.003, Math.min(0.01, medianWidth * 0.72))
        : Math.max(0.003, Math.min(0.012, medianWidth * 0.82)),
      yTolerance: cjkDominant
        ? Math.max(0.004, Math.min(0.015, lineHeight * 0.3))
        : Math.max(0.0035, Math.min(0.011, lineHeight * 0.24)),
      boundaryCharMin: 0.0006,
      boundaryCharFactor: cjkDominant ? 0.2 : 0.14,
      closestLimit: Math.max(0.01, medianWidth * 0.95),
      yWeight: 1.45,
    }
  }

  if (mode === 'eraser') {
    return {
      medianWidth,
      xTolerance: cjkDominant
        ? Math.max(0.005, Math.min(0.014, medianWidth * 1.05))
        : Math.max(0.007, Math.min(0.021, medianWidth * 1.55)),
      yTolerance: cjkDominant
        ? Math.max(0.006, Math.min(0.02, lineHeight * 0.42))
        : Math.max(0.006, Math.min(0.018, lineHeight * 0.38)),
      boundaryCharMin: 0.0025,
      boundaryCharFactor: 0.42,
      closestLimit: Math.max(0.018, medianWidth * 1.65),
      yWeight: 1.15,
    }
  }

  return {
    medianWidth,
    xTolerance: cjkDominant
      ? Math.max(0.004, Math.min(0.012, medianWidth * 0.95))
      : Math.max(0.006, Math.min(0.018, medianWidth * 1.35)),
    yTolerance: cjkDominant
      ? Math.max(0.004, Math.min(0.016, lineHeight * 0.34))
      : Math.max(0.004, Math.min(0.012, lineHeight * 0.26)),
    boundaryCharMin: 0.002,
    boundaryCharFactor: 0.32,
    closestLimit: Math.max(0.014, medianWidth * 1.3),
    yWeight: 1.35,
  }
}

function findTextBoundaryCore(pageIndex, normalizedX, normalizedY, scope = null, options = {}) {
  if (!pageIndex) return null

  const mode = options.mode || 'annotation'
  const rectMode = mode === 'selection' ? 'selection-overlay' : 'default'
  const line = findLineAtPoint(pageIndex, normalizedX, normalizedY, scope)
  if (!line) return null

  const chars = getLineOrderedWordChars(line, pageIndex)

  if (chars.length === 0) return null

  const firstChar = chars[0]
  const lastChar = chars[chars.length - 1]
  const firstRect = getCharRectForMode(firstChar, rectMode)
  const lastRect = getCharRectForMode(lastChar, rectMode)
  if (!hasUsableTextRect(firstRect) || !hasUsableTextRect(lastRect)) return null
  const lineLeft = firstRect.left
  const lineRight = getRectRight(lastRect)
  const {
    xTolerance,
    yTolerance,
    boundaryCharMin,
    boundaryCharFactor,
  } = getTextHitTolerances(line, chars, options.mode)

  if (normalizedX < lineLeft - xTolerance || normalizedX > lineRight + xTolerance) {
    return null
  }

  for (const char of chars) {
    const rect = getCharRectForMode(char, rectMode)
    if (!rect) continue
    if (
      normalizedY < rect.top - yTolerance ||
      normalizedY > rect.top + rect.height + yTolerance
    ) {
      continue
    }

    const left = rect.left
    const right = getRectRight(rect)
    const charTolerance = Math.min(xTolerance, Math.max(boundaryCharMin, rect.width * boundaryCharFactor))
    if (normalizedX >= left - charTolerance && normalizedX <= right + charTolerance) {
      const midpoint = left + rect.width / 2
      return {
        pageNumber: pageIndex.pageNumber,
        charIndex: normalizedX <= midpoint ? char.index : char.index + 1,
        blockIndex: char.blockIndex,
        columnId: char.columnId ?? line.columnId,
        lineIndex: char.lineIndex,
      }
    }
  }

  let closest = null
  for (const char of chars) {
    const rect = getCharRectForMode(char, rectMode)
    if (!rect) continue
    const leftDistance = Math.abs(normalizedX - rect.left)
    const rightDistance = Math.abs(normalizedX - getRectRight(rect))
    const candidate = leftDistance <= rightDistance
      ? { distance: leftDistance, charIndex: char.index }
      : { distance: rightDistance, charIndex: char.index + 1 }
    if (!closest || candidate.distance < closest.distance) {
      closest = candidate
    }
  }

  if (!closest || closest.distance > xTolerance) return null

  return {
    pageNumber: pageIndex.pageNumber,
    charIndex: closest.charIndex,
    blockIndex: chars[0].blockIndex,
    columnId: chars[0].columnId ?? line.columnId,
    lineIndex: line.index,
  }
}

export function findCharBoundaryAtPoint(pageIndex, normalizedX, normalizedY, scope = null) {
  return findTextBoundaryCore(pageIndex, normalizedX, normalizedY, scope, {
    mode: 'annotation',
  })
}

export function findTextBoundaryAtPoint(pageIndex, normalizedX, normalizedY, scope = null, options = {}) {
  if (!pageIndex) return null
  const mode = options.mode || 'selection'
  if (mode !== 'selection') {
    return findTextBoundaryCore(pageIndex, normalizedX, normalizedY, scope, options)
  }

  let line = findLineAtPoint(pageIndex, normalizedX, normalizedY, scope)
  if (!line && scope?.blockIndex != null) {
    line = findNearestLineInBlock(pageIndex, normalizedX, normalizedY, scope.blockIndex)
  }
  if (!line && scope?.columnId != null) {
    line = findNearestLineInColumn(pageIndex, normalizedX, normalizedY, scope.columnId)
  }
  if (!line) return scope

  const lineChars = getLineOrderedWordChars(line, pageIndex)

  if (lineChars.length === 0) return scope

  const firstLineRect = getCharRectForMode(lineChars[0], 'selection-overlay')
  const lastLineRect = getCharRectForMode(lineChars[lineChars.length - 1], 'selection-overlay')
  if (!hasUsableTextRect(firstLineRect) || !hasUsableTextRect(lastLineRect)) return scope
  const lineLeft = firstLineRect.left
  const lineRight = getRectRight(lastLineRect)
  const medianWidth = getMedian(
    lineChars
      .map((char) => getCharRectForMode(char, 'selection-overlay')?.width)
      .filter(Boolean),
  )
  const xSlack = Math.max(0.002, Math.min(0.006, medianWidth * 0.45))

  if (normalizedX <= lineLeft + xSlack) {
    return {
      pageNumber: pageIndex.pageNumber,
      charIndex: line.startChar,
      blockIndex: line.blockIndex,
      columnId: line.columnId,
      lineIndex: line.index,
    }
  }

  if (normalizedX >= lineRight - xSlack) {
    return {
      pageNumber: pageIndex.pageNumber,
      charIndex: line.endChar,
      blockIndex: line.blockIndex,
      columnId: line.columnId,
      lineIndex: line.index,
    }
  }

  const boundary = findTextBoundaryCore(pageIndex, normalizedX, normalizedY, scope, options)
  if (!scope || !boundary) return boundary

  return boundary
}

export function findSelectionBoundaryAtPoint(pageIndex, normalizedX, normalizedY, anchor = null) {
  return findTextBoundaryAtPoint(pageIndex, normalizedX, normalizedY, anchor, {
    mode: 'selection',
    horizontalPrecision: 'character',
  })
}

function findNearestLineInBlock(pageIndex, normalizedX, normalizedY, blockIndex) {
  if (!pageIndex) return null

  const candidateLines = (pageIndex.lines || []).filter((line) => line.blockIndex === blockIndex)
  if (candidateLines.length === 0) return null

  let best = null
  for (const line of candidateLines) {
    const dx = normalizedX < line.rect.left
      ? line.rect.left - normalizedX
      : normalizedX > getRectRight(line.rect)
        ? normalizedX - getRectRight(line.rect)
        : 0
    const dy = normalizedY < line.rect.top
      ? line.rect.top - normalizedY
      : normalizedY > getRectBottom(line.rect)
        ? normalizedY - getRectBottom(line.rect)
        : 0
    const score = dx * dx + dy * dy * 1.8
    if (!best || score < best.score) {
      best = { line, score }
    }
  }

  return best?.line || null
}

function findNearestLineInColumn(pageIndex, normalizedX, normalizedY, columnId) {
  if (!pageIndex) return null

  const candidateLines = (pageIndex.lines || []).filter((line) =>
    columnId < 0 ? true : line.columnId === columnId,
  )
  if (candidateLines.length === 0) return null

  let best = null
  for (const line of candidateLines) {
    const dx = normalizedX < line.rect.left
      ? line.rect.left - normalizedX
      : normalizedX > getRectRight(line.rect)
        ? normalizedX - getRectRight(line.rect)
        : 0
    const dy = normalizedY < line.rect.top
      ? line.rect.top - normalizedY
      : normalizedY > getRectBottom(line.rect)
        ? normalizedY - getRectBottom(line.rect)
        : 0
    const score = dx * dx + dy * dy * 2
    if (!best || score < best.score) {
      best = { line, score }
    }
  }

  return best?.line || null
}

function lineMatchesScope(line, scope) {
  if (!scope || scope.columnId == null || scope.columnId < 0) return true
  return line.columnId === scope.columnId || line.columnId === -1
}

export function findLineAtPoint(pageIndex, normalizedX, normalizedY, scope = null) {
  if (!pageIndex) return null
  return (pageIndex.lines || []).find((line) => {
    const band = getLineVisualBand(line)
    const top = Math.min(line.rect.top, band.top)
    const bottom = Math.max(getRectBottom(line.rect), band.bottom)
    return (
      lineMatchesScope(line, scope) &&
      normalizedY >= top - 0.006 &&
      normalizedY <= bottom + 0.006 &&
      normalizedX >= line.rect.left - 0.02 &&
      normalizedX <= line.rect.left + line.rect.width + 0.02
    )
  }) || null
}

function findTextCharCore(pageIndex, normalizedX, normalizedY, scope = null, options = {}) {
  if (!pageIndex) return null

  const mode = options.mode || 'annotation'
  const rectMode = mode === 'selection' ? 'selection-overlay' : 'default'
  const line = findLineAtPoint(pageIndex, normalizedX, normalizedY, scope)
  if (!line) return null

  const chars = getLineOrderedWordChars(line, pageIndex)

  if (chars.length === 0) return null

  const {
    medianWidth,
    xTolerance,
    yTolerance,
    closestLimit,
    yWeight,
  } = getTextHitTolerances(line, chars, mode)

  for (const char of chars) {
    const rect = getCharRectForMode(char, rectMode)
    if (!rect) continue
    if (
      normalizedY < rect.top - yTolerance ||
      normalizedY > rect.top + rect.height + yTolerance
    ) {
      continue
    }

    if (
      normalizedX >= rect.left - xTolerance &&
      normalizedX <= getRectRight(rect) + xTolerance
    ) {
      return char
    }
  }

  let closest = null
  for (const char of chars) {
    const rect = getCharRectForMode(char, rectMode)
    if (!rect) continue
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const distance = Math.hypot(normalizedX - centerX, (normalizedY - centerY) * yWeight)
    if (!closest || distance < closest.distance) {
      closest = { char, distance }
    }
  }

  if (
    options.allowClosestFallback === false ||
    !closest ||
    closest.distance > (closestLimit || Math.max(0.014, medianWidth * 1.3))
  ) {
    return null
  }

  return closest.char
}

export function findCharAtPoint(pageIndex, normalizedX, normalizedY) {
  return findTextCharCore(pageIndex, normalizedX, normalizedY, null, {
    mode: 'annotation',
  })
}

export function findErasePreviewRangeAtPoint(pageIndex, normalizedX, normalizedY) {
  const char = findTextCharCore(pageIndex, normalizedX, normalizedY, null, {
    mode: 'eraser',
  })
  if (!char) return null

  return {
    pageNumber: pageIndex.pageNumber,
    startChar: char.index,
    endChar: char.index + 1,
  }
}

export function findCharInRangeAtPoint(pageIndex, startChar, endChar, normalizedX, normalizedY) {
  if (!pageIndex) return null
  const ordered = getOrderedRange(startChar, endChar)
  const candidateLines = []

  for (const line of pageIndex.lines || []) {
    if (line.endChar <= ordered.startChar || line.startChar >= ordered.endChar) continue

    const chars = getLineOrderedWordChars(line, pageIndex)
      .filter((char) => char.index >= ordered.startChar && char.index < ordered.endChar)
    if (chars.length === 0) continue

    const lineRect = unionRects(chars.map((char) => getCharRectForMode(char)))
    if (!lineRect) continue

    const {
      xTolerance,
      yTolerance,
      yWeight,
    } = getTextHitTolerances(line, chars, 'eraser')
    const firstRect = getCharRectForMode(chars[0])
    const lastRect = getCharRectForMode(chars[chars.length - 1])
    if (!hasUsableTextRect(firstRect) || !hasUsableTextRect(lastRect)) continue
    const lineLeft = firstRect.left
    const lineRight = getRectRight(lastRect)

    if (
      normalizedY < lineRect.top - yTolerance ||
      normalizedY > getRectBottom(lineRect) + yTolerance ||
      normalizedX < lineLeft - xTolerance ||
      normalizedX > lineRight + xTolerance
    ) {
      continue
    }

    candidateLines.push({
      line,
      chars,
      lineRect,
      lineLeft,
      lineRight,
      yTolerance,
      yWeight,
    })
  }

  if (candidateLines.length === 0) return null

  const directLines = candidateLines.filter(({ lineRect, yTolerance }) =>
    normalizedY >= lineRect.top - yTolerance * 0.35 &&
    normalizedY <= getRectBottom(lineRect) + yTolerance * 0.45,
  )
  const activeLines = directLines.length > 0 ? directLines : candidateLines

  let best = null
  for (const candidate of activeLines) {
    const { chars, lineRect, lineLeft, lineRight, yWeight } = candidate

    let nearestChar = null
    for (const char of chars) {
      const rect = getCharRectForMode(char)
      if (!rect) continue
      const charLeft = rect.left
      const charRight = getRectRight(rect)
      const centerX = charLeft + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const xPenalty = normalizedX >= charLeft && normalizedX <= charRight
        ? 0
        : Math.abs(normalizedX - centerX)
      const yPenalty = normalizedY >= rect.top && normalizedY <= getRectBottom(rect)
        ? 0
        : Math.abs(normalizedY - centerY)
      const distance = xPenalty * xPenalty + yPenalty * yPenalty * yWeight
      if (!nearestChar || distance < nearestChar.distance) {
        nearestChar = { char, distance }
      }
    }

    if (!nearestChar) continue

    const verticalPenalty = normalizedY < lineRect.top
      ? lineRect.top - normalizedY
      : normalizedY > getRectBottom(lineRect)
        ? normalizedY - getRectBottom(lineRect)
        : 0
    const horizontalPenalty = normalizedX < lineLeft
      ? lineLeft - normalizedX
      : normalizedX > lineRight
        ? normalizedX - lineRight
        : 0
    const score = nearestChar.distance + horizontalPenalty * horizontalPenalty + verticalPenalty * verticalPenalty * 1.8

    if (!best || score < best.score) {
      best = { char: nearestChar.char, score }
    }
  }

  return best?.char || null
}

function findNearestCharForEraser(pageIndex, normalizedX, normalizedY) {
  return findTextCharCore(pageIndex, normalizedX, normalizedY, null, {
    mode: 'eraser',
  })
}

export function findEraseRangeAtPoint(pageIndex, normalizedX, normalizedY) {
  const boundary = findTextBoundaryAtPoint(pageIndex, normalizedX, normalizedY, null, {
    mode: 'eraser',
  })
  if (boundary) {
    const startChar = clamp(boundary.charIndex - 2, 0, pageIndex.length)
    const endChar = clamp(boundary.charIndex + 2, 0, pageIndex.length)
    return {
      pageNumber: pageIndex.pageNumber,
      startChar,
      endChar,
    }
  }

  return null
}

export function isPointInsideRect(x, y, rect, tolerance = 0.002) {
  if (!rect) return false
  return (
    x >= rect.left - tolerance &&
    x <= rect.left + rect.width + tolerance &&
    y >= rect.top - tolerance &&
    y <= rect.top + rect.height + tolerance
  )
}

export function getSelectionFromNativeSelection(selection, pageIndex) {
  if (!selection || selection.rangeCount === 0 || !pageIndex) {
    return null
  }

  const range = selection.getRangeAt(0)
  const start = resolveCharPosition(range.startContainer, range.startOffset)
  const end = resolveCharPosition(range.endContainer, range.endOffset)

  if (!start || !end) {
    return null
  }

  const ordered = getOrderedRange(start.charIndex, end.charIndex)
  if (ordered.startChar === ordered.endChar) {
    return null
  }

  const geometry = getTextRangeGeometry(pageIndex, ordered.startChar, ordered.endChar, {
    visualMode: 'selection-overlay',
  })
  if (!geometry.text.trim()) {
    return null
  }

  const context = getContextAroundRange(pageIndex, ordered.startChar, ordered.endChar)

  return {
    startChar: ordered.startChar,
    endChar: ordered.endChar,
    text: geometry.text,
    copyText: geometry.copyText,
    rects: geometry.rects,
    anchorRect: geometry.rects[0] || null,
    contextBefore: context.before,
    contextAfter: context.after,
  }
}

function resolveCharPosition(node, offset) {
  const element =
    node?.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node

  const span = element instanceof HTMLElement
    ? element.closest('.textLayer span')
    : null

  if (!(span instanceof HTMLElement)) {
    return null
  }

  const start = Number(span.dataset.charStart || '0')
  const end = Number(span.dataset.charEnd || '0')
  const charIndex = clamp(start + offset, start, end)
  return { charIndex }
}

export function normalizeSearchText(text) {
  const normalizedChars = []
  const charMap = []
  let previousWasSpace = true

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (/\s/.test(char)) {
      if (!previousWasSpace) {
        normalizedChars.push(' ')
        charMap.push(index)
      }
      previousWasSpace = true
      continue
    }

    normalizedChars.push(char.toLowerCase())
    charMap.push(index)
    previousWasSpace = false
  }

  while (normalizedChars[normalizedChars.length - 1] === ' ') {
    normalizedChars.pop()
    charMap.pop()
  }

  return {
    text: normalizedChars.join(''),
    charMap,
  }
}

export function findCharIndexAtPoint(pageIndex, normalizedX, normalizedY) {
  const word = findWordAtPoint(pageIndex, normalizedX, normalizedY)
  if (word) return word.startChar
  return null
}
