let pdfJsModulePromise = null
const PDF_WORKER_CACHE_BUSTER = '202605201030'
const PDF_DOCUMENT_OPTIONS = Object.freeze({
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/',
  wasmUrl: '/wasm/',
  useSystemFonts: true,
  isImageDecoderSupported: false,
  isOffscreenCanvasSupported: false,
})

export async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist').then((pdfJsModule) => {
      return import('pdfjs-dist/build/pdf.worker.mjs?url').then((workerUrl) => {
        const workerSrc = new URL(workerUrl.default, window.location.href)
        workerSrc.searchParams.set('v', PDF_WORKER_CACHE_BUSTER)
        pdfJsModule.GlobalWorkerOptions.workerSrc = workerSrc.toString()
        return pdfJsModule
      })
    })
  }

  return pdfJsModulePromise
}

export async function createPdfLoadingTask(source) {
  const pdfJsModule = await loadPdfJs()
  const params = typeof source === 'string' ? { url: source } : { ...source }

  return pdfJsModule.getDocument({
    ...PDF_DOCUMENT_OPTIONS,
    ...params,
  })
}
