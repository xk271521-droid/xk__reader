import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExportReport,
  createEmptyResults,
  normalizeResults,
  summarizeResults,
} from './pdfSelectionEngineTestModel.js'

test('creates independent pending results for every engine and case', () => {
  const results = createEmptyResults()
  assert.equal(results.word['pdfjs-native'], 'pending')
  assert.equal(results.word['pdfium-wasm'], 'pending')

  results.word['pdfjs-native'] = 'exact'
  assert.equal(results.word['pdfium-wasm'], 'pending')
})

test('normalization rejects unknown persisted values', () => {
  const results = normalizeResults({
    word: { 'pdfjs-native': 'exact', 'pdfium-wasm': 'unknown' },
    invented: { 'pdfjs-native': 'failed' },
  })

  assert.equal(results.word['pdfjs-native'], 'exact')
  assert.equal(results.word['pdfium-wasm'], 'pending')
  assert.equal(results.sentence['pdfjs-native'], 'pending')
  assert.equal(results.invented, undefined)
})

test('summary and export report preserve objective result counts', () => {
  const results = createEmptyResults()
  results.word['pdfjs-native'] = 'over'
  results.word['pdfium-wasm'] = 'exact'
  results.sentence['pdfium-wasm'] = 'exact'

  const summary = summarizeResults(results)
  assert.equal(summary['pdfjs-native'].over, 1)
  assert.equal(summary['pdfium-wasm'].exact, 2)

  const report = buildExportReport({
    sourceLabel: 'paper.pdf',
    zoomLabel: '150%',
    notes: '双栏重点测试',
    results,
  })
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.sourceLabel, 'paper.pdf')
  assert.deepEqual(report.summary, summary)
})

