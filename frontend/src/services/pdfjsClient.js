let pdfJsModulePromise = null

export async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist').then((pdfJsModule) => {
      pdfJsModule.GlobalWorkerOptions.cMapUrl = '/cmaps/'
      pdfJsModule.GlobalWorkerOptions.cMapPacked = true
      return import('pdfjs-dist/build/pdf.worker.mjs?url').then((workerUrl) => {
        pdfJsModule.GlobalWorkerOptions.workerSrc = workerUrl.default
        return pdfJsModule
      })
    })
  }

  return pdfJsModulePromise
}
