import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMemoryStorage,
  readReadingSessionSnapshot,
  saveReadingSessionSnapshot,
} from './readingSessionStorage.js'

test('saves normalized per-paper reading session snapshots', () => {
  const storage = createMemoryStorage()

  saveReadingSessionSnapshot('42', {
    pageNumber: 999,
    scale: 9,
    activeWorkspacePanel: 'summary',
    workspaceWidth: 999,
    totalPages: 12,
  }, storage)

  const snapshot = readReadingSessionSnapshot('42', storage)
  assert.equal(typeof snapshot.updatedAt, 'number')
  assert.deepEqual({ ...snapshot, updatedAt: 1 }, {
    version: 1,
    pageNumber: 12,
    scale: 4,
    activeWorkspacePanel: 'summary',
    workspaceWidth: 620,
    updatedAt: 1,
  })
})

test('merges partial reading session updates without dropping existing fields', () => {
  const storage = createMemoryStorage()

  saveReadingSessionSnapshot('42', {
    pageNumber: 3,
    scale: 1.5,
    activeWorkspacePanel: 'notes',
    workspaceWidth: 420,
  }, storage)
  saveReadingSessionSnapshot('42', { pageNumber: 4 }, storage)

  const snapshot = readReadingSessionSnapshot('42', storage)
  assert.equal(typeof snapshot.updatedAt, 'number')
  assert.deepEqual({ ...snapshot, updatedAt: 1 }, {
    version: 1,
    pageNumber: 4,
    scale: 1.5,
    activeWorkspacePanel: 'notes',
    workspaceWidth: 420,
    updatedAt: 1,
  })
})

test('ignores corrupt storage and invalid panel names', () => {
  const storage = createMemoryStorage()
  storage.setItem('xk_reader_sessions_v1', '{bad json')

  assert.equal(readReadingSessionSnapshot('42', storage), null)

  saveReadingSessionSnapshot('42', {
    pageNumber: 2,
    activeWorkspacePanel: 'unknown',
    workspaceWidth: 380,
  }, storage)

  assert.equal(readReadingSessionSnapshot('42', storage).activeWorkspacePanel, '')
})
