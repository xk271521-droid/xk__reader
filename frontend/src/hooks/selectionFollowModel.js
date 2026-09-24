const FOLLOW_PANEL_GAP = 10
const FOLLOW_PANEL_MARGIN = 12
const DEFAULT_FOLLOW_PANEL_SIZE = Object.freeze({ width: 304, height: 164 })

function isFiniteNumber(value) {
  return Number.isFinite(value)
}

function normalizeViewport(viewport = {}) {
  const width = Number(viewport.width) || 0
  const height = Number(viewport.height) || 0
  return { width, height }
}

function getAnchorElementRect(anchorElement) {
  const rect = anchorElement?.getBoundingClientRect?.()
  if (!rect || !isFiniteNumber(rect.left) || !isFiniteNumber(rect.top)) return null
  return {
    left: rect.left,
    top: rect.top,
    width: Math.max(0, Number(rect.width) || 0),
    height: Math.max(0, Number(rect.height) || 0),
  }
}

function getClientAnchorRect(anchorRect) {
  if (!anchorRect) return null
  if (![anchorRect.left, anchorRect.top, anchorRect.width, anchorRect.height].every(isFiniteNumber)) {
    return null
  }
  return {
    left: anchorRect.left,
    top: anchorRect.top,
    width: Math.max(0, anchorRect.width),
    height: Math.max(0, anchorRect.height),
  }
}

function getRelativeSelectionRect(selectionCard) {
  const rect = selectionCard?.rects?.[0] || selectionCard?.anchorRect
  if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(isFiniteNumber)) {
    return null
  }
  return rect
}

export function resolveSelectionFollowAnchor(selectionCard) {
  const elementRect = getAnchorElementRect(selectionCard?.anchorElement)
  const relativeRect = getRelativeSelectionRect(selectionCard)

  // Legacy reader geometry is page-relative. Recompute from the live page element
  // so the portal stays attached while the PDF scrolls.
  if (elementRect && relativeRect) {
    return {
      left: elementRect.left + relativeRect.left * elementRect.width,
      top: elementRect.top + relativeRect.top * elementRect.height,
      width: relativeRect.width * elementRect.width,
      height: relativeRect.height * elementRect.height,
    }
  }

  // PDFium's selection wrapper already has the selected text's viewport bounds.
  if (elementRect && (elementRect.width > 0 || elementRect.height > 0)) {
    return elementRect
  }

  return getClientAnchorRect(selectionCard?.anchorClientRect)
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

export function getSelectionFollowPanelPosition(anchorRect, panelSize, viewport) {
  if (!anchorRect) return null

  const viewportSize = normalizeViewport(viewport)
  if (!viewportSize.width || !viewportSize.height) return null

  const width = Math.min(
    Math.max(1, Number(panelSize?.width) || DEFAULT_FOLLOW_PANEL_SIZE.width),
    Math.max(1, viewportSize.width - FOLLOW_PANEL_MARGIN * 2),
  )
  const height = Math.max(1, Number(panelSize?.height) || DEFAULT_FOLLOW_PANEL_SIZE.height)
  const anchorBottom = anchorRect.top + anchorRect.height
  const center = anchorRect.left + anchorRect.width / 2
  const left = clamp(
    center,
    FOLLOW_PANEL_MARGIN + width / 2,
    viewportSize.width - FOLLOW_PANEL_MARGIN - width / 2,
  )
  const belowTop = anchorBottom + FOLLOW_PANEL_GAP
  const aboveTop = anchorRect.top - FOLLOW_PANEL_GAP
  const canPlaceBelow = belowTop + height <= viewportSize.height - FOLLOW_PANEL_MARGIN
  const canPlaceAbove = aboveTop - height >= FOLLOW_PANEL_MARGIN

  if (canPlaceBelow || !canPlaceAbove) {
    return {
      left,
      top: clamp(belowTop, FOLLOW_PANEL_MARGIN, viewportSize.height - FOLLOW_PANEL_MARGIN - height),
      placement: 'below',
    }
  }

  return { left, top: aboveTop, placement: 'above' }
}

export function clampSelectionFollowPanelPosition(panelPosition, panelSize, bounds) {
  if (!panelPosition || !panelSize || !bounds) return null
  const width = Math.max(1, Number(panelSize.width) || 0)
  const height = Math.max(1, Number(panelSize.height) || 0)
  const left = Number(panelPosition.left)
  const top = Number(panelPosition.top)
  if (![left, top, width, height].every(Number.isFinite)) return null

  const minLeft = Number(bounds.left)
  const minTop = Number(bounds.top)
  const maxLeft = Number(bounds.right) - width
  const maxTop = Number(bounds.bottom) - height
  if (![minLeft, minTop, maxLeft, maxTop].every(Number.isFinite)) return null

  return {
    left: clamp(left, minLeft, Math.max(minLeft, maxLeft)),
    top: clamp(top, minTop, Math.max(minTop, maxTop)),
  }
}
