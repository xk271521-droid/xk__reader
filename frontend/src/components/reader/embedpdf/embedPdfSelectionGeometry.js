const FALLBACK_MAX_RECT_HEIGHT = 96

function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

/**
 * PDFium can expose one malformed, page-sized glyph rectangle in some scanned
 * PDFs. Keep normal line/word rectangles while dropping only geometries that
 * are too tall or lie far outside the page.
 */
export function isSafeSelectionRect(rect, pageSize) {
  const x = Number(rect?.origin?.x)
  const y = Number(rect?.origin?.y)
  const width = Number(rect?.size?.width)
  const height = Number(rect?.size?.height)
  if (![x, y, width, height].every(isFiniteNumber)) return false
  if (width <= 0 || height <= 0) return false

  const pageWidth = Number(pageSize?.width)
  const pageHeight = Number(pageSize?.height)
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
    return height <= FALLBACK_MAX_RECT_HEIGHT
  }

  const edgeAllowance = Math.max(pageWidth, pageHeight) * 0.02
  const maxRectHeight = Math.max(72, pageHeight * 0.12)
  return height <= maxRectHeight
    && width <= pageWidth + edgeAllowance * 2
    && x >= -edgeAllowance
    && y >= -edgeAllowance
    && x + width <= pageWidth + edgeAllowance
    && y + height <= pageHeight + edgeAllowance
}

export function filterSafeSelectionRects(rects, pageSize) {
  return Array.isArray(rects)
    ? rects.filter((rect) => isSafeSelectionRect(rect, pageSize))
    : []
}
