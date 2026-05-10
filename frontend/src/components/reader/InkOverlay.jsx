function clampStrokeWidth(value) {
  return Math.max(1, Math.min(48, Number(value) || 6))
}

function buildPath(points = []) {
  const normalized = points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
  if (normalized.length === 0) return ''
  if (normalized.length === 1) {
    const point = normalized[0]
    return `M ${point.x} ${point.y} L ${point.x + 0.0001} ${point.y + 0.0001}`
  }
  if (normalized.length === 2) {
    return `M ${normalized[0].x} ${normalized[0].y} L ${normalized[1].x} ${normalized[1].y}`
  }

  let path = `M ${normalized[0].x} ${normalized[0].y}`
  for (let index = 1; index < normalized.length - 1; index += 1) {
    const current = normalized[index]
    const next = normalized[index + 1]
    const midX = (current.x + next.x) / 2
    const midY = (current.y + next.y) / 2
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`
  }
  const last = normalized[normalized.length - 1]
  path += ` L ${last.x} ${last.y}`
  return path
}

export function InkOverlay({
  drawingStroke = null,
  inkAnnotations = [],
  isInkMode = false,
  isEraserMode = false,
  onInkPointerDown,
  onInkPointerMove,
  onInkPointerUp,
  onInkErase,
}) {
  return (
    <svg
      className={`pdf-ink-overlay${isInkMode || isEraserMode ? ' is-interactive' : ''}`}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onPointerDown={onInkPointerDown}
      onPointerMove={(event) => {
        if (!isInkMode) return
        event.stopPropagation()
        onInkPointerMove?.(event)
      }}
      onPointerUp={(event) => {
        if (!isInkMode) return
        event.stopPropagation()
        onInkPointerUp?.(event)
      }}
      onPointerCancel={(event) => {
        if (!isInkMode) return
        event.stopPropagation()
        onInkPointerUp?.(event)
      }}
    >
      <rect
        className="pdf-ink-hitarea"
        x="0"
        y="0"
        width="1"
        height="1"
      />
      {inkAnnotations.map((stroke) => (
        <path
          key={stroke.id}
          className={`pdf-ink-stroke${stroke.pending ? ' is-pending' : ''}${stroke.unsynced ? ' is-unsynced' : ''}`}
          d={buildPath(stroke.points || [])}
          stroke={stroke.color || '#15803D'}
          strokeOpacity={Math.max(0.05, Math.min(1, Number(stroke.opacity) || 0.85))}
          strokeWidth={clampStrokeWidth(stroke.stroke_width ?? stroke.strokeWidth)}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => {
            if (!isEraserMode) return
            event.preventDefault()
            event.stopPropagation()
            onInkErase?.(stroke)
          }}
        />
      ))}
      {drawingStroke?.points?.length ? (
        <path
          className="pdf-ink-stroke pdf-ink-stroke--drawing"
          d={buildPath(drawingStroke.points)}
          stroke={drawingStroke.color || '#15803D'}
          strokeOpacity={Math.max(0.05, Math.min(1, Number(drawingStroke.opacity) || 0.85))}
          strokeWidth={clampStrokeWidth(drawingStroke.strokeWidth)}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}
