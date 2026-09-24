import assert from 'node:assert/strict'
import test from 'node:test'
import {
  annotationIntersectsRect,
  findTextRangeInRect,
  normalizeCaptureRect,
} from './embedPdfCaptureModel.js'

test('extracts only glyph indexes intersecting the screenshot rectangle', () => {
  const geometry = {
    runs: [
      {
        charStart: 0,
        glyphs: [
          { x: 10, y: 10, width: 8, height: 10, flags: 0 },
          { x: 20, y: 10, width: 8, height: 10, flags: 0 },
          { x: 310, y: 10, width: 8, height: 10, flags: 0 },
        ],
      },
    ],
  }

  assert.deepEqual(
    findTextRangeInRect(geometry, 2, { origin: { x: 5, y: 5 }, size: { width: 40, height: 25 } }),
    { start: { page: 2, index: 0 }, end: { page: 2, index: 1 } },
  )
})

test('box eraser detects both main and segmented annotation rectangles', () => {
  const annotation = {
    rect: { origin: { x: 10, y: 10 }, size: { width: 10, height: 10 } },
    segmentRects: [{ origin: { x: 100, y: 100 }, size: { width: 40, height: 12 } }],
  }
  assert.equal(
    annotationIntersectsRect(annotation, { origin: { x: 115, y: 105 }, size: { width: 10, height: 10 } }),
    true,
  )
})

test('normalizes PDFium page coordinates for note anchors', () => {
  assert.deepEqual(
    normalizeCaptureRect(
      { origin: { x: 60, y: 80 }, size: { width: 120, height: 160 } },
      { width: 600, height: 800 },
    ),
    { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
  )
})
