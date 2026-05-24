import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFlowSelectionFromBoundaries } from './pdfSelectionModel.js'

function rect(left, top, width = 0.01, height = 0.02) {
  return {
    left,
    top,
    width,
    height,
  }
}

function appendLine(page, text, { lineIndex, blockIndex, columnId, left, top }) {
  const startChar = page.chars.length
  const charIndices = []
  for (let offset = 0; offset < text.length; offset += 1) {
    const charRect = rect(left + offset * 0.012, top)
    const index = page.chars.length
    page.chars.push({
      index,
      char: text[offset],
      lineIndex,
      blockIndex,
      columnId,
      rect: charRect,
      rangeRect: charRect,
      advanceRect: charRect,
      visualRect: charRect,
      geometryConfidence: 1,
    })
    charIndices.push(index)
    page.fullText += text[offset]
  }
  const endChar = page.chars.length
  page.lines.push({
    index: lineIndex,
    blockIndex,
    blockId: blockIndex,
    columnId,
    startChar,
    endChar,
    charIndices,
    rect: rect(left, top, Math.max(0.01, text.length * 0.012), 0.02),
    metrics: {
      visualBand: {
        top,
        bottom: top + 0.02,
        height: 0.02,
      },
      medianHeight: 0.02,
      baseline: top + 0.018,
      textTop: top,
      textBottom: top + 0.02,
      visualTop: top,
      visualBottom: top + 0.02,
    },
  })
  return { startChar, endChar }
}

function buildInterleavedTwoColumnPage() {
  const page = {
    pageNumber: 1,
    fullText: '',
    chars: [],
    lines: [],
    words: [],
    blocks: [],
    columns: [
      { id: 0, left: 0, right: 0.5 },
      { id: 1, left: 0.5, right: 1 },
    ],
    length: 0,
  }

  const leftTop = appendLine(page, 'left top', {
    lineIndex: 0,
    blockIndex: 0,
    columnId: 0,
    left: 0.1,
    top: 0.1,
  })
  appendLine(page, 'right top', {
    lineIndex: 1,
    blockIndex: 1,
    columnId: 1,
    left: 0.58,
    top: 0.1,
  })
  const leftBottom = appendLine(page, 'left bottom', {
    lineIndex: 2,
    blockIndex: 2,
    columnId: 0,
    left: 0.1,
    top: 0.15,
  })
  appendLine(page, 'right bottom', {
    lineIndex: 3,
    blockIndex: 3,
    columnId: 1,
    left: 0.58,
    top: 0.15,
  })
  page.length = page.chars.length

  return { page, leftTop, leftBottom }
}

test('builds a same-column visual flow selection without mixing the right column', () => {
  const { page, leftTop, leftBottom } = buildInterleavedTwoColumnPage()

  const selection = buildFlowSelectionFromBoundaries(
    page,
    {
      charIndex: leftTop.startChar,
      lineIndex: 0,
      blockIndex: 0,
      columnId: 0,
    },
    {
      charIndex: leftBottom.endChar,
      lineIndex: 2,
      blockIndex: 2,
      columnId: 0,
    },
  )

  assert.equal(selection.copyText, 'left top\nleft bottom')
  assert.equal(selection.copyText.includes('right'), false)
  assert.equal(selection.rects.length, 2)
})

test('keeps same-column visual flow stable when dragging upward', () => {
  const { page, leftTop, leftBottom } = buildInterleavedTwoColumnPage()

  const selection = buildFlowSelectionFromBoundaries(
    page,
    {
      charIndex: leftBottom.endChar,
      lineIndex: 2,
      blockIndex: 2,
      columnId: 0,
    },
    {
      charIndex: leftTop.startChar,
      lineIndex: 0,
      blockIndex: 0,
      columnId: 0,
    },
  )

  assert.equal(selection.copyText, 'left top\nleft bottom')
  assert.equal(selection.copyText.includes('right'), false)
})
