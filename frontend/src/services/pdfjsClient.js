let pdfJsModulePromise = null
const PDF_WORKER_CACHE_BUSTER = '202605212145'
const PDF_DOCUMENT_OPTIONS = Object.freeze({
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/',
  wasmUrl: '/wasm/',
  useSystemFonts: true,
  isImageDecoderSupported: false,
  isOffscreenCanvasSupported: false,
})

function installTypedArrayToHexPolyfill(target = Uint8Array.prototype) {
  if (typeof target.toHex === 'function') return

  target.toHex = function toHex() {
    let result = ''
    for (let index = 0; index < this.length; index += 1) {
      result += this[index].toString(16).padStart(2, '0')
    }
    return result
  }
}

export async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfJsModule) => {
      installTypedArrayToHexPolyfill()

      return import('pdfjs-dist/legacy/build/pdf.worker.mjs?url').then((workerUrl) => {
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
