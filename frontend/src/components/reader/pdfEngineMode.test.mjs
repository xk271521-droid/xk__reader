import assert from 'node:assert/strict'
import test from 'node:test'
import { isEmbedPdfPreviewEnabled } from './pdfEngineMode.js'

test('uses PDFium as the default after the verified cutover', () => {
  assert.equal(isEmbedPdfPreviewEnabled({ search: '' }), true)
  assert.equal(isEmbedPdfPreviewEnabled({ search: '?paper=12' }), true)
})

test('keeps an explicit PDF.js emergency rollback switch', () => {
  assert.equal(isEmbedPdfPreviewEnabled({ search: '?paper=12&pdfEngine=embedpdf' }), true)
  assert.equal(isEmbedPdfPreviewEnabled({ search: '?pdfEngine=pdfjs' }), false)
})
