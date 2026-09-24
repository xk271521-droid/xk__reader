import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { EMBEDPDF_PDFIUM_WASM_URL } from './embedPdfAssets.js'

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

test('ships the exact pinned PDFium 2.15.0 binary as a local public asset', () => {
  const frontendRoot = new URL('../../../../', import.meta.url)
  const publicWasm = new URL(`public${EMBEDPDF_PDFIUM_WASM_URL}`, frontendRoot)
  const packageWasm = new URL('node_modules/@embedpdf/pdfium/dist/pdfium.wasm', frontendRoot)

  assert.equal(EMBEDPDF_PDFIUM_WASM_URL, '/vendor/embedpdf/pdfium-2.15.0.wasm')
  assert.equal(sha256(publicWasm), sha256(packageWasm))
})
