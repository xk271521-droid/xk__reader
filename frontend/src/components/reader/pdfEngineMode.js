const EMBEDPDF_QUERY_VALUE = 'embedpdf'
const PDFJS_QUERY_VALUE = 'pdfjs'

export function isEmbedPdfPreviewEnabled(locationLike = globalThis.location) {
  if (import.meta.env?.VITE_PDF_ENGINE === EMBEDPDF_QUERY_VALUE) return true
  if (import.meta.env?.VITE_PDF_ENGINE === PDFJS_QUERY_VALUE) return false
  if (!locationLike?.search) return true

  try {
    return new URLSearchParams(locationLike.search).get('pdfEngine') !== PDFJS_QUERY_VALUE
  } catch {
    return true
  }
}
