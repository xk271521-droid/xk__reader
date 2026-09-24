function rectsIntersect(leftRect, rightRect) {
  if (!leftRect || !rightRect) return false
  return (
    leftRect.origin.x < rightRect.origin.x + rightRect.size.width
    && leftRect.origin.x + leftRect.size.width > rightRect.origin.x
    && leftRect.origin.y < rightRect.origin.y + rightRect.size.height
    && leftRect.origin.y + leftRect.size.height > rightRect.origin.y
  )
}

export function getAnnotationRects(annotation) {
  return [annotation?.rect, ...(annotation?.segmentRects || [])].filter(Boolean)
}

export function annotationIntersectsRect(annotation, rect) {
  return getAnnotationRects(annotation).some((annotationRect) => rectsIntersect(rect, annotationRect))
}

export function rectContainsPoint(rect, point, tolerance = 0) {
  return Boolean(rect) && (
    point.x >= rect.origin.x - tolerance
    && point.x <= rect.origin.x + rect.size.width + tolerance
    && point.y >= rect.origin.y - tolerance
    && point.y <= rect.origin.y + rect.size.height + tolerance
  )
}

function rectIntersectsGlyph(rect, glyph) {
  if (glyph.flags === 2 || glyph.width <= 0 || glyph.height <= 0) return false
  const glyphRect = {
    origin: { x: glyph.x, y: glyph.y },
    size: { width: glyph.width, height: glyph.height },
  }
  return rectsIntersect(rect, glyphRect)
}

export function findTextRangeInRect(geometry, pageIndex, rect) {
  if (!geometry?.runs?.length) return null
  let startIndex = Number.POSITIVE_INFINITY
  let endIndex = Number.NEGATIVE_INFINITY
  for (const run of geometry.runs) {
    run.glyphs.forEach((glyph, localIndex) => {
      if (!rectIntersectsGlyph(rect, glyph)) return
      const index = run.charStart + localIndex
      startIndex = Math.min(startIndex, index)
      endIndex = Math.max(endIndex, index)
    })
  }
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return null
  return {
    start: { page: pageIndex, index: startIndex },
    end: { page: pageIndex, index: endIndex },
  }
}

export function normalizeCaptureRect(rect, pageSize) {
  if (!pageSize?.width || !pageSize?.height) return null
  return {
    left: rect.origin.x / pageSize.width,
    top: rect.origin.y / pageSize.height,
    width: rect.size.width / pageSize.width,
    height: rect.size.height / pageSize.height,
  }
}
