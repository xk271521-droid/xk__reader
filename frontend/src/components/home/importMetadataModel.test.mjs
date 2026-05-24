import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMetadataRefreshGaps,
  isWeakImportedTitle,
  mergeImportedServerPaper,
  shouldRefreshImportedMetadata,
} from './importMetadataModel.js'

test('detects weak imported titles from file names and placeholders', () => {
  assert.equal(isWeakImportedTitle('cnn-paper', 'cnn-paper.pdf'), true)
  assert.equal(isWeakImportedTitle('Untitled', 'paper.pdf'), true)
  assert.equal(isWeakImportedTitle('A Multichannel 2D Convolutional Neural Network Model', 'cnn.pdf'), false)
})

test('asks for refresh when imported metadata misses core fields', () => {
  const gaps = getMetadataRefreshGaps(
    { id: 7, title: 'paper.pdf', file_name: 'paper.pdf', page_count: 0 },
    {},
  )
  assert.deepEqual(gaps, ['title', 'author', 'topic', 'identifier', 'pageCount'])
  assert.equal(shouldRefreshImportedMetadata({ id: 7, title: 'paper.pdf', file_name: 'paper.pdf' }, {}, 'paper.pdf'), true)
})

test('merges refreshed metadata only for the same server paper', () => {
  assert.deepEqual(
    mergeImportedServerPaper(
      { id: 3, title: 'old', folder_id: 9, page_count: 4 },
      { id: 3, title: 'new', page_count: 12 },
    ),
    { id: 3, title: 'new', folder_id: 9, page_count: 12 },
  )
  assert.deepEqual(
    mergeImportedServerPaper({ id: 3, title: 'old' }, { id: 4, title: 'new' }),
    { id: 3, title: 'old' },
  )
})
