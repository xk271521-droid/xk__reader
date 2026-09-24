import assert from 'node:assert/strict'
import test from 'node:test'

import { filterSafeSelectionRects, isSafeSelectionRect } from './embedPdfSelectionGeometry.js'

const pageSize = { width: 612, height: 792 }

test('keeps ordinary PDF word and line selection rectangles', () => {
  assert.equal(isSafeSelectionRect({
    origin: { x: 72, y: 108 },
    size: { width: 28, height: 12 },
  }, pageSize), true)
  assert.equal(isSafeSelectionRect({
    origin: { x: 72, y: 132 },
    size: { width: 460, height: 16 },
  }, pageSize), true)
})

test('drops the malformed page-sized glyph rectangle without losing the selected word', () => {
  const wordRect = {
    origin: { x: 210, y: 530 },
    size: { width: 34, height: 13 },
  }
  const result = filterSafeSelectionRects([
    { origin: { x: 0, y: 0 }, size: { width: 420, height: 620 } },
    wordRect,
  ], pageSize)

  assert.deepEqual(result, [wordRect])
})

test('rejects invalid and far out-of-page selection geometry', () => {
  assert.equal(isSafeSelectionRect({
    origin: { x: -200, y: 10 },
    size: { width: 40, height: 12 },
  }, pageSize), false)
  assert.equal(isSafeSelectionRect({
    origin: { x: 10, y: 10 },
    size: { width: Number.NaN, height: 12 },
  }, pageSize), false)
})
