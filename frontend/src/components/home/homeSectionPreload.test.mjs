import assert from 'node:assert/strict'
import test from 'node:test'

import { preloadHomeSection } from './homeSectionPreload.js'

test('preloads a known section only once', async () => {
  let calls = 0
  const cache = new Set()
  const loaders = {
    matrix: () => {
      calls += 1
      return Promise.resolve('matrix-page')
    },
  }

  assert.equal(await preloadHomeSection('matrix', { loaders, cache }), 'matrix-page')
  assert.equal(preloadHomeSection('matrix', { loaders, cache }), null)
  assert.equal(calls, 1)
})

test('ignores sections without a component loader', () => {
  const cache = new Set()
  const result = preloadHomeSection('library', {
    loaders: {
      matrix: () => Promise.resolve('matrix-page'),
    },
    cache,
  })

  assert.equal(result, null)
  assert.deepEqual([...cache], [])
})

test('allows retry after a preload failure', async () => {
  const cache = new Set()
  const loaders = {
    matrix: () => Promise.reject(new Error('network failed')),
  }

  await assert.rejects(preloadHomeSection('matrix', { loaders, cache }), /network failed/)
  assert.equal(cache.has('matrix'), false)
})
