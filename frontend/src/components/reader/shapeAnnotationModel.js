export const SHAPE_TOOL_IDS = ['text', 'arrow', 'rect', 'circle', 'pin']
export const SHAPE_COLOR_PALETTE = ['#2563EB', '#DC2626', '#F59E0B', '#15803D', '#7C3AED', '#DB2777', '#0F766E', '#111827']
export const DEFAULT_SHAPE_OPTIONS = { color: '#2563EB', strokeWidth: 2, fontSize: 16 }
const COLLAPSED_TEXT_MAX_CHARS = 14

export function clampUnit(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export function normalizeBox(x, y, width, height, minWidth = 0, minHeight = 0) {
  const nextX = clampUnit(x)
  const nextY = clampUnit(y)
  const nextWidth = Math.max(minWidth, Math.min(1 - nextX, Number(width) || 0))
  const nextHeight = Math.max(minHeight, Math.min(1 - nextY, Number(height) || 0))
  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  }
}

export function getShapeColor(annotation, fallback = DEFAULT_SHAPE_OPTIONS.color) {
  return annotation?.style?.color || fallback
}

export function getShapeStrokeWidth(annotation, fallback = DEFAULT_SHAPE_OPTIONS.strokeWidth) {
  const value = Number(annotation?.style?.strokeWidth)
  return Number.isFinite(value) ? Math.max(1, Math.min(12, value)) : fallback
}

export function getShapeFontSize(annotation, fallback = DEFAULT_SHAPE_OPTIONS.fontSize) {
  const value = Number(annotation?.style?.fontSize)
  return Number.isFinite(value) ? Math.max(12, Math.min(36, value)) : fallback
}

export function getShapeExtra(annotation) {
  return annotation?.extra || {}
}

export function isTextAnnotationCollapsed(annotation) {
  return annotation?.type === 'text' && Boolean(getShapeExtra(annotation).collapsed)
}

export function getTextAnnotationLabel(annotation, maxChars = COLLAPSED_TEXT_MAX_CHARS) {
  const content = String(annotation?.content || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!content) return '文本标注'

  const chars = Array.from(content)
  if (chars.length <= maxChars) return content
  return `${chars.slice(0, maxChars).join('').trim()}…`
}

export function getCollapsedTextSize(annotation) {
  const fontSize = getShapeFontSize(annotation, DEFAULT_SHAPE_OPTIONS.fontSize)
  return {
    width: Math.max(0.012, Math.min(0.018, fontSize / 1100)),
    height: Math.max(0.012, Math.min(0.018, fontSize / 1100)),
  }
}

export function getShapeDisplayBox(annotation) {
  const x = Number(annotation?.x) || 0
  const y = Number(annotation?.y) || 0
  const width = Math.max(0, Number(annotation?.width) || 0)
  const height = Math.max(0, Number(annotation?.height) || 0)

  if (!isTextAnnotationCollapsed(annotation)) {
    return { x, y, width, height }
  }

  const collapsed = getCollapsedTextSize(annotation)
  return {
    x,
    y,
    width: collapsed.width,
    height: collapsed.height,
  }
}

export function getPinDiameter(annotation) {
  const fontSize = getShapeFontSize(annotation, DEFAULT_SHAPE_OPTIONS.fontSize)
  return Math.max(0.02, Math.min(0.04, fontSize / 520))
}

export function getArrowPadding(strokeWidth = DEFAULT_SHAPE_OPTIONS.strokeWidth) {
  return Math.max(0.008, Math.min(0.02, Number(strokeWidth || 2) / 260))
}

export function buildArrowGeometry(startPoint, endPoint, options = DEFAULT_SHAPE_OPTIONS) {
  const startX = clampUnit(startPoint?.x)
  const startY = clampUnit(startPoint?.y)
  const endX = clampUnit(endPoint?.x)
  const endY = clampUnit(endPoint?.y)
  const padding = getArrowPadding(options.strokeWidth)
  const left = Math.max(0, Math.min(startX, endX) - padding)
  const top = Math.max(0, Math.min(startY, endY) - padding)
  const right = Math.min(1, Math.max(startX, endX) + padding)
  const bottom = Math.min(1, Math.max(startY, endY) + padding)
  return {
    x: left,
    y: top,
    width: Math.max(0.02, right - left),
    height: Math.max(0.02, bottom - top),
    extra: {
      startX,
      startY,
      endX,
      endY,
    },
  }
}

export function getLocalArrowEndpoints(annotation) {
  const extra = annotation?.extra || {}
  const width = Math.max(0.0001, Number(annotation?.width) || 0.0001)
  const height = Math.max(0.0001, Number(annotation?.height) || 0.0001)
  const x = Number(annotation?.x) || 0
  const y = Number(annotation?.y) || 0
  return {
    startX: (clampUnit(extra.startX) - x) / width,
    startY: (clampUnit(extra.startY) - y) / height,
    endX: (clampUnit(extra.endX) - x) / width,
    endY: (clampUnit(extra.endY) - y) / height,
  }
}
