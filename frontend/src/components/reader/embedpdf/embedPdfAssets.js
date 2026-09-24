// Keep this path versioned. Importing the package's `.wasm?url` export works in
// production builds but Vite dev serves a JS wrapper to Worker fetches. A public
// binary gives web, dev and Electron the same deterministic local URL.
export const EMBEDPDF_PDFIUM_WASM_URL = '/vendor/embedpdf/pdfium-2.15.0.wasm'
