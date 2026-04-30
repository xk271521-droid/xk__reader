let pdfJsModulePromise = null

export async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.mjs?url'),
    ]).then(([pdfJsModule, workerModule]) => {
      pdfJsModule.GlobalWorkerOptions.workerSrc = workerModule.default
      return pdfJsModule
    })
  }

  return pdfJsModulePromise
}
