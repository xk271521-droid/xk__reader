import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getScrollProgress,
  getSyncedScrollTop,
} from './fullTranslationSync.js'

test('normalizes scroll progress from the current viewport', () => {
  assert.equal(getScrollProgress({ scrollTop: 250, maxScrollTop: 1000 }), 0.25)
  assert.equal(getScrollProgress({ scrollTop: 1400, maxScrollTop: 1000 }), 1)
  assert.equal(getScrollProgress({ scrollTop: 20, maxScrollTop: 0 }), null)
})

test('maps source progress to the target document height', () => {
  assert.equal(
    getSyncedScrollTop(
      { scrollTop: 500, maxScrollTop: 2000 },
      { maxScrollTop: 1000 },
    ),
    250,
  )
  assert.equal(
    getSyncedScrollTop(
      { scrollTop: 500, maxScrollTop: 0 },
      { maxScrollTop: 1000 },
    ),
    null,
  )
})
