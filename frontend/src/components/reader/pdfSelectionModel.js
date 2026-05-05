const LINE_MERGE_EPSILON = 0.0045
const WORD_JOIN_GAP = 0.012
const BLOCK_VERTICAL_GAP = 0.028
const BLOCK_LEFT_SHIFT = 0.08
const LINE_SAFETY_GAP = 0.0006

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

    for (let offset = 0; offset < span.text.length; offset += 1) {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.setEnd(textNode, offset + 1)
      const rect = range.getBoundingClientRect()
      range.detach?.()

      const charIndex = span.start + offset
      const current = base.chars[charIndex]
      if (!current) continue

      current.rect = normalizeRect(
        {
          left: rect.left - layerRect.left,
          top: rect.top - layerRect.top,
          width: rect.width,
          height: rect.height,
        },
        viewportWidth,
        viewportHeight,
      )
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
    length: base.length,
    lines: geometry.lines,
    lineMap: geometry.lineMap,
    words: geometry.words,
    blocks: geometry.blocks,
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
      verticalGap > Math.max(BLOCK_VERTICAL_GAP, previousLine.rect.height * 1.45) ||
      leftShift > BLOCK_LEFT_SHIFT

    if (isNewBlock) {
      currentBlock = {
        index: blocks.length,
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
      previousChar = char
    }
  }

  return { lines, lineMap, words, blocks }
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

function buildLineMetrics(lineChars, lineRect) {
  if (!lineChars.length || !lineRect) {
    return {
      textTop: lineRect?.top ?? 0,
      textBottom: getRectBottom(lineRect ?? { top: 0, height: 0 }),
      visualTop: lineRect?.top ?? 0,
      visualBottom: getRectBottom(lineRect ?? { top: 0, height: 0 }),
      visualHeight: lineRect?.height ?? 0,
      baseline: getRectBottom(lineRect ?? { top: 0, height: 0 }),
      medianHeight: lineRect?.height ?? 0,
      superscriptThreshold: 0,
    }
  }

  const heights = lineChars
    .map((char) => char.rect?.height)
    .filter((height) => typeof height === 'number' && height > 0)
  const medianHeight = getMedian(heights) || lineRect.height
  const primaryChars = lineChars.filter((char) => (char.rect?.height || 0) >= medianHeight * 0.72)
  const sourceChars = primaryChars.length > 0 ? primaryChars : lineChars
  const top = Math.min(...sourceChars.map((char) => char.rect.top))
  const bottoms = sourceChars.map((char) => getRectBottom(char.rect))
  const baseline = getQuantile(bottoms, 0.68)
  const bottom = Math.max(...bottoms)
  const superscriptThreshold = top + Math.max(medianHeight * 0.26, lineRect.height * 0.18)

  return {
    textTop: top,
    textBottom: baseline,
    visualTop: top,
    visualBottom: bottom,
    visualHeight: bottom - top,
    baseline,
    medianHeight,
    superscriptThreshold,
  }
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

function getLineOrderedWordChars(line, pageIndex) {
  return line.charIndices
    .map((index) => pageIndex.chars[index])
    .filter((char) => char?.rect && isWordChar(char.char))
    .sort((left, right) => left.rect.left - right.rect.left)
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

  const outerPad = kind === 'decoration' ? 0.001 : 0.0012
  const innerPadMax = kind === 'decoration' ? 0 : 0.00025
  const leftGap = previousChar ? Math.max(0, firstChar.rect.left - getRectRight(previousChar.rect)) : 0
  const rightGap = nextChar ? Math.max(0, nextChar.rect.left - getRectRight(lastChar.rect)) : 0

  return {
    leftPad: previousChar ? Math.min(innerPadMax, leftGap * 0.25) : outerPad,
    rightPad: nextChar ? Math.min(innerPadMax, rightGap * 0.25) : outerPad,
  }
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

export function getLineRectsForRange(pageIndex, startChar, endChar) {
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
      const previousLine = pageIndex.lines[line.index - 1]
      const nextLine = pageIndex.lines[line.index + 1]
      const metrics = line.metrics || buildLineMetrics(chars, line.rect)
      const linePrimaryChars = chars.filter((char) => char.charRole !== 'superscript')
      const widthSource = chars
      const widthRect = unionRects(widthSource.map((char) => char.rect)) || rect
      const { leftPad, rightPad } = getSegmentHorizontalPadding(line, pageIndex, widthSource, 'selection')
      const cjkDominant = isCjkDominant(chars)
      const isLargeLine = metrics.medianHeight >= 0.027
      const topLimit = previousLine
        ? getRectBottom(previousLine.metrics || previousLine.rect) + LINE_SAFETY_GAP
        : 0
      const bottomLimit = nextLine
        ? (nextLine.metrics?.visualTop ?? nextLine.rect.top) - LINE_SAFETY_GAP
        : 1
      const topBoost = isLargeLine ? (cjkDominant ? 0.14 : 0.1) : (cjkDominant ? 0.09 : 0.045)
      const bottomBoost = isLargeLine ? (cjkDominant ? 0.08 : 0.065) : (cjkDominant ? 0.07 : 0.055)
      const idealTop = Math.min(rect.top, metrics.visualTop - metrics.medianHeight * topBoost)
      const idealBottom = Math.max(getRectBottom(rect), metrics.visualBottom + metrics.medianHeight * bottomBoost)
      const clampedTop = clamp(idealTop, topLimit, Math.max(topLimit, bottomLimit - 0.002))
      const clampedBottom = clamp(
        idealBottom,
        clampedTop + 0.002,
        Math.max(clampedTop + 0.002, bottomLimit),
      )
      return expandRect(
        {
          left: clamp(widthRect.left - leftPad, 0, 1),
          top: clampedTop,
          width: clamp(widthRect.width + leftPad + rightPad, 0, 1),
          height: Math.max(0.002, clampedBottom - clampedTop),
        },
        0,
        0,
      )
    })
    .filter(Boolean)
}

export function getHighlightRectsForRange(pageIndex, startChar, endChar) {
  return getLineRectsForRange(pageIndex, startChar, endChar)
    .map((rect) => {
      const topInset = rect.height * 0.18
      const bottomInset = rect.height * 0.08
      return {
        left: rect.left,
        top: rect.top + topInset,
        width: rect.width,
        height: Math.max(0.002, rect.height - topInset - bottomInset),
      }
    })
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

      const lineChars = line.charIndices
        .map((index) => pageIndex.chars[index])
        .filter((char) => char?.rect && isWordChar(char.char))
      const primaryLineChars = lineChars.filter((char) => char.charRole !== 'superscript')
      const metricChars = primaryLineChars.length > 0 ? primaryLineChars : lineChars
      const lineTextRect = unionRects(metricChars.map((char) => char.rect)) || rect
      const metrics = line.metrics || buildLineMetrics(metricChars, line.rect)
      const { leftPad, rightPad } = getSegmentHorizontalPadding(line, pageIndex, chars, 'decoration')
      const medianHeight = getMedian(
        metricChars
          .map((char) => char.rect?.height)
          .filter((height) => typeof height === 'number' && height > 0),
      )
      const charHeight = medianHeight || metrics.medianHeight || lineTextRect.height || line.rect.height
      const baseline = metrics.baseline || metrics.textBottom || getRectBottom(lineTextRect)
      const baselineOffset = charHeight * (hasCjkChar(metricChars) ? 0.018 : 0.021)
      const strokeHeight = Math.max(0.0018, Math.min(0.0042, charHeight * 0.085))
      const nextLine = pageIndex.lines[line.index + 1]
      const nextLineTop = nextLine?.rect?.top ?? 1
      const minTop = baseline + charHeight * 0.001
      const maxTop = Math.max(
        minTop,
        nextLineTop - strokeHeight - Math.max(0.003, charHeight * 0.05),
      )
      const preferredTop = baseline + baselineOffset
      const top = clamp(preferredTop, minTop, maxTop)

      return {
        left: clamp(rect.left - leftPad, 0, 1),
        top: clamp(top, 0, 1),
        width: clamp(rect.width + leftPad + rightPad, 0, 1),
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
  const text = getPageTextSlice(pageIndex, startChar, endChar)
  const rects = getLineRectsForRange(pageIndex, startChar, endChar)
  if (!text.trim() || rects.length === 0) return null

  const context = getContextAroundRange(pageIndex, startChar, endChar)

  return {
    startChar,
    endChar,
    text,
    rects,
    anchorRect: rects[0] || null,
    contextBefore: context.before,
    contextAfter: context.after,
  }
}

export function findWordAtPoint(pageIndex, normalizedX, normalizedY) {
  if (!pageIndex) return null

  for (const word of pageIndex.words || []) {
    const hitRect = expandRect(word.rect, 0.003, 0.005)
    if (isPointInsideRect(normalizedX, normalizedY, hitRect, 0)) {
      return word
    }
  }

  const sameLine = (pageIndex.lines || []).find((line) =>
    normalizedY >= line.rect.top - 0.006 &&
    normalizedY <= line.rect.top + line.rect.height + 0.006 &&
    normalizedX >= line.rect.left - 0.015 &&
    normalizedX <= line.rect.left + line.rect.width + 0.015,
  )

  if (!sameLine) return null

  const lineWords = sameLine.wordIndices.map((index) => pageIndex.words[index]).filter(Boolean)
  let best = null
  for (const word of lineWords) {
    const centerX = word.rect.left + word.rect.width / 2
    const distance = Math.abs(centerX - normalizedX)
    if (!best || distance < best.distance) {
      best = { word, distance }
    }
  }

  return best && best.distance < 0.035 ? best.word : null
}

export function findCharBoundaryAtPoint(pageIndex, normalizedX, normalizedY) {
  if (!pageIndex) return null

  const line = findLineAtPoint(pageIndex, normalizedX, normalizedY)
  if (!line) return null

  const chars = line.charIndices
    .map((index) => pageIndex.chars[index])
    .filter((char) => char?.rect && isWordChar(char.char))
    .sort((left, right) => left.rect.left - right.rect.left)

  if (chars.length === 0) return null

  const firstChar = chars[0]
  const lastChar = chars[chars.length - 1]
  const lineLeft = firstChar.rect.left
  const lineRight = lastChar.rect.left + lastChar.rect.width
  const medianWidth = getMedian(chars.map((char) => char.rect.width).filter(Boolean))
  const cjkDominant = isCjkDominant(chars)
  const xTolerance = cjkDominant
    ? Math.max(0.004, Math.min(0.012, medianWidth * 0.95))
    : Math.max(0.006, Math.min(0.018, medianWidth * 1.35))
  const yTolerance = cjkDominant
    ? Math.max(0.004, Math.min(0.016, line.rect.height * 0.34))
    : Math.max(0.004, Math.min(0.012, line.rect.height * 0.26))

  if (normalizedX < lineLeft - xTolerance || normalizedX > lineRight + xTolerance) {
    return null
  }

  for (const char of chars) {
    if (
      normalizedY < char.rect.top - yTolerance ||
      normalizedY > char.rect.top + char.rect.height + yTolerance
    ) {
      continue
    }

    const left = char.rect.left
    const right = char.rect.left + char.rect.width
    const charTolerance = Math.min(xTolerance, Math.max(0.002, char.rect.width * 0.32))
    if (normalizedX >= left - charTolerance && normalizedX <= right + charTolerance) {
      const midpoint = left + char.rect.width / 2
      return {
        pageNumber: pageIndex.pageNumber,
        charIndex: normalizedX <= midpoint ? char.index : char.index + 1,
        blockIndex: char.blockIndex,
        lineIndex: char.lineIndex,
      }
    }
  }

  let closest = null
  for (const char of chars) {
    if (
      normalizedY < char.rect.top - yTolerance ||
      normalizedY > char.rect.top + char.rect.height + yTolerance
    ) {
      continue
    }

    const leftDistance = Math.abs(normalizedX - char.rect.left)
    const rightDistance = Math.abs(normalizedX - (char.rect.left + char.rect.width))
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
    lineIndex: line.index,
  }
}

export function findSelectionBoundaryAtPoint(pageIndex, normalizedX, normalizedY, anchor = null) {
  if (!pageIndex) return null

  let line = findLineAtPoint(pageIndex, normalizedX, normalizedY)
  if (!line && anchor?.blockIndex != null) {
    line = findNearestLineInBlock(pageIndex, normalizedX, normalizedY, anchor.blockIndex)
  }
  if (!line) return anchor

  const lineChars = line.charIndices
    .map((index) => pageIndex.chars[index])
    .filter((char) => char?.rect && isWordChar(char.char))
    .sort((left, right) => left.rect.left - right.rect.left)

  if (lineChars.length === 0) return anchor

  const lineLeft = lineChars[0].rect.left
  const lineRight = getRectRight(lineChars[lineChars.length - 1].rect)
  const xSlack = Math.max(0.008, (lineRight - lineLeft) * 0.045)

  if (normalizedX <= lineLeft + xSlack) {
    return {
      pageNumber: pageIndex.pageNumber,
      charIndex: line.startChar,
      blockIndex: line.blockIndex,
      lineIndex: line.index,
    }
  }

  if (normalizedX >= lineRight - xSlack) {
    return {
      pageNumber: pageIndex.pageNumber,
      charIndex: line.endChar,
      blockIndex: line.blockIndex,
      lineIndex: line.index,
    }
  }

  const boundary = findCharBoundaryAtPoint(pageIndex, normalizedX, normalizedY)
  if (!anchor || !boundary) return boundary

  return boundary
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

export function findLineAtPoint(pageIndex, normalizedX, normalizedY) {
  if (!pageIndex) return null
  return (pageIndex.lines || []).find((line) =>
    normalizedY >= line.rect.top - 0.006 &&
    normalizedY <= line.rect.top + line.rect.height + 0.006 &&
    normalizedX >= line.rect.left - 0.02 &&
    normalizedX <= line.rect.left + line.rect.width + 0.02,
  ) || null
}

export function findCharAtPoint(pageIndex, normalizedX, normalizedY) {
  if (!pageIndex) return null

  const line = findLineAtPoint(pageIndex, normalizedX, normalizedY)
  if (!line) return null

  const chars = line.charIndices
    .map((index) => pageIndex.chars[index])
    .filter((char) => char?.rect && isWordChar(char.char))
    .sort((left, right) => left.rect.left - right.rect.left)

  if (chars.length === 0) return null

  const medianWidth = getMedian(
    chars
      .map((char) => char.rect?.width)
      .filter((width) => typeof width === 'number' && width > 0),
  )
  const cjkDominant = isCjkDominant(chars)
  const xTolerance = cjkDominant
    ? Math.max(0.003, Math.min(0.009, medianWidth * 0.42))
    : Math.max(0.003, Math.min(0.012, medianWidth * 0.55))
  const yTolerance = cjkDominant
    ? Math.max(0.004, Math.min(0.016, line.rect.height * 0.34))
    : Math.max(0.004, Math.min(0.014, line.rect.height * 0.28))

  for (const char of chars) {
    if (
      normalizedY < char.rect.top - yTolerance ||
      normalizedY > char.rect.top + char.rect.height + yTolerance
    ) {
      continue
    }

    if (
      normalizedX >= char.rect.left - xTolerance &&
      normalizedX <= char.rect.left + char.rect.width + xTolerance
    ) {
      return char
    }
  }

  let closest = null
  for (const char of chars) {
    const centerX = char.rect.left + char.rect.width / 2
    const centerY = char.rect.top + char.rect.height / 2
    const distance = Math.hypot(normalizedX - centerX, (normalizedY - centerY) * 1.35)
    if (!closest || distance < closest.distance) {
      closest = { char, distance }
    }
  }

  if (!closest || closest.distance > Math.max(0.014, medianWidth * 1.3)) {
    return null
  }

  return closest.char
}

export function findErasePreviewRangeAtPoint(pageIndex, normalizedX, normalizedY) {
  const char = findCharAtPoint(pageIndex, normalizedX, normalizedY) ||
    findNearestCharForEraser(pageIndex, normalizedX, normalizedY)
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

    const chars = line.charIndices
      .map((index) => pageIndex.chars[index])
      .filter(
        (char) =>
          char?.rect &&
          isWordChar(char.char) &&
          char.index >= ordered.startChar &&
          char.index < ordered.endChar,
      )
      .sort((left, right) => left.rect.left - right.rect.left)
    if (chars.length === 0) continue

    const lineRect = unionRects(chars.map((char) => char.rect))
    if (!lineRect) continue

    const lineHeight = line.metrics?.medianHeight || lineRect.height
    const ySlack = Math.max(0.006, lineHeight * 0.26)
    const xSlack = Math.max(0.008, lineHeight * 0.42)
    const lineLeft = chars[0].rect.left
    const lineRight = getRectRight(chars[chars.length - 1].rect)

    if (
      normalizedY < lineRect.top - ySlack ||
      normalizedY > getRectBottom(lineRect) + ySlack ||
      normalizedX < lineLeft - xSlack ||
      normalizedX > lineRight + xSlack
    ) {
      continue
    }

    candidateLines.push({
      line,
      chars,
      lineRect,
      lineLeft,
      lineRight,
      lineHeight,
    })
  }

  if (candidateLines.length === 0) return null

  const directLines = candidateLines.filter(({ lineRect, lineHeight }) =>
    normalizedY >= lineRect.top - Math.max(0.003, lineHeight * 0.08) &&
    normalizedY <= getRectBottom(lineRect) + Math.max(0.004, lineHeight * 0.14),
  )
  const activeLines = directLines.length > 0 ? directLines : candidateLines

  let best = null
  for (const candidate of activeLines) {
    const { chars, lineRect, lineLeft, lineRight } = candidate

    let nearestChar = null
    for (const char of chars) {
      const charLeft = char.rect.left
      const charRight = getRectRight(char.rect)
      const centerX = charLeft + char.rect.width / 2
      const centerY = char.rect.top + char.rect.height / 2
      const xPenalty = normalizedX >= charLeft && normalizedX <= charRight
        ? 0
        : Math.abs(normalizedX - centerX)
      const yPenalty = normalizedY >= char.rect.top && normalizedY <= getRectBottom(char.rect)
        ? 0
        : Math.abs(normalizedY - centerY)
      const distance = xPenalty * xPenalty + yPenalty * yPenalty * 1.4
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
  if (!pageIndex) return null

  let best = null
  for (const line of pageIndex.lines || []) {
    const chars = line.charIndices
      .map((index) => pageIndex.chars[index])
      .filter((char) => char?.rect && isWordChar(char.char))
    if (chars.length === 0) continue

    const lineRect = unionRects(chars.map((char) => char.rect))
    if (!lineRect) continue

    const lineHeight = line.metrics?.medianHeight || lineRect.height
    const xLeft = lineRect.left - Math.max(0.006, lineHeight * 0.35)
    const xRight = getRectRight(lineRect) + Math.max(0.006, lineHeight * 0.35)
    const yTop = lineRect.top - Math.max(0.006, lineHeight * 0.3)
    const yBottom = getRectBottom(lineRect) + Math.max(0.012, lineHeight * 0.55)
    if (normalizedX < xLeft || normalizedX > xRight || normalizedY < yTop || normalizedY > yBottom) {
      continue
    }

    for (const char of chars) {
      const centerX = char.rect.left + char.rect.width / 2
      const centerY = char.rect.top + char.rect.height / 2
      const distance = Math.hypot(normalizedX - centerX, (normalizedY - centerY) * 1.2)
      if (!best || distance < best.distance) {
        best = { char, distance }
      }
    }
  }

  return best?.char || null
}

export function findEraseRangeAtPoint(pageIndex, normalizedX, normalizedY) {
  const boundary = findCharBoundaryAtPoint(pageIndex, normalizedX, normalizedY)
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

  const text = getPageTextSlice(pageIndex, ordered.startChar, ordered.endChar)
  if (!text.trim()) {
    return null
  }

  const rects = getLineRectsForRange(pageIndex, ordered.startChar, ordered.endChar)
  const context = getContextAroundRange(pageIndex, ordered.startChar, ordered.endChar)

  return {
    startChar: ordered.startChar,
    endChar: ordered.endChar,
    text,
    rects,
    anchorRect: rects[0] || null,
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
