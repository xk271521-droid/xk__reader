import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine'
import { EMBEDPDF_PDFIUM_WASM_URL } from '../components/reader/embedpdf/embedPdfAssets'

const status = document.querySelector('[data-runtime-status]')
const detail = document.querySelector('[data-runtime-detail]')

async function run() {
  const startedAt = performance.now()
  const engine = await createPdfiumEngine(EMBEDPDF_PDFIUM_WASM_URL, { fontFallback: null })
  const content = await fetch('/poc/sthelar-selection-test.pdf').then((response) => response.arrayBuffer())
  const document = await engine.openDocumentBuffer({ id: 'local-runtime-smoke', content }).toPromise()
  const glyphs = await engine.getPageGlyphs(document, document.pages[0]).toPromise()

  status.textContent = '已就绪'
  status.dataset.ready = 'true'
  detail.textContent = JSON.stringify({
    engine: 'EmbedPDF / PDFium 2.15.0',
    wasmUrl: EMBEDPDF_PDFIUM_WASM_URL,
    pages: document.pageCount,
    firstPageGlyphs: glyphs.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  }, null, 2)
}

run().catch((error) => {
  status.textContent = '运行失败'
  status.dataset.ready = 'false'
  detail.textContent = error?.stack || error?.message || String(error)
})
