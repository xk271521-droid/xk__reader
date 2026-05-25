export function isDesktopShell() {
  if (typeof window === 'undefined') {
    return false
  }

  return Boolean(window.paperDesktop || window.__PAPER_READER_DESKTOP__)
}
