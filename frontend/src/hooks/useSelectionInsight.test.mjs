import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSelectionRequestKey,
  normalizeTranslationProvider,
  TRANSLATION_PROVIDERS,
} from './selectionInsightModel.js'

test('buildSelectionRequestKey deduplicates the same PDFium selection geometry', () => {
  const first = {
    text: '  spatial   transcriptomics ',
    pageNumber: 3,
    startChar: 0,
    endChar: 0,
    anchorRect: {
      origin: { x: 12.5, y: 42 },
      size: { width: 130, height: 16 },
    },
  }
  const repeated = {
    ...first,
    text: 'spatial transcriptomics',
    anchorRect: {
      origin: { x: 12.5, y: 42 },
      size: { width: 130, height: 16 },
    },
  }

  assert.equal(buildSelectionRequestKey(first), buildSelectionRequestKey(repeated))
  assert.notEqual(
    buildSelectionRequestKey(first),
    buildSelectionRequestKey({ ...first, pageNumber: 4 }),
  )
})

test('normalizeTranslationProvider only accepts supported translation providers', () => {
  assert.equal(normalizeTranslationProvider(TRANSLATION_PROVIDERS.BAIDU), TRANSLATION_PROVIDERS.BAIDU)
  assert.equal(normalizeTranslationProvider(TRANSLATION_PROVIDERS.TENCENT), TRANSLATION_PROVIDERS.TENCENT)
  assert.equal(normalizeTranslationProvider('unsupported'), TRANSLATION_PROVIDERS.BAIDU)
})
