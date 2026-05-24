import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNoteAnchorFocus } from './noteAnchorModel.js'

test('builds page-only focus for screenshot notes', () => {
  assert.deepEqual(buildNoteAnchorFocus({ page_number: 4, content: 'shot' }, 'n1'), {
    pageNumber: 4,
    startChar: null,
    endChar: null,
    quote: 'shot',
    nonce: 'n1',
  })
})

test('builds exact character focus for quote notes', () => {
  assert.deepEqual(
    buildNoteAnchorFocus({ pageNumber: '2', startChar: 11, endChar: 18, quote: 'text' }, 'n2'),
    {
      pageNumber: 2,
      startChar: 11,
      endChar: 18,
      quote: 'text',
      nonce: 'n2',
    },
  )
})

test('returns null without a page number', () => {
  assert.equal(buildNoteAnchorFocus({ content: 'orphan' }, 'n3'), null)
})
