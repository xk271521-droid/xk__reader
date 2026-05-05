let pdfJsModulePromise = null
const PDF_DOCUMENT_OPTIONS = Object.freeze({
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/',
  useSystemFonts: true,
})

export async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist').then((pdfJsModule) => {
      return import('pdfjs-dist/build/pdf.worker.mjs?url').then((workerUrl) => {
        pdfJsModule.GlobalWorkerOptions.workerSrc = workerUrl.default
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
