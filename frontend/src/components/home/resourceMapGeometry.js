export const DEFAULT_RESOURCE_BRANCH_ORIGIN = {
  x_pct: 50,
  y_pct: 0,
}

function toFiniteNumber(value) {
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

function cleanCoordinate(value) {
  const rounded = Number(value.toFixed(3))
  return Object.is(rounded, -0) ? 0 : rounded
}

function formatCoordinate(value) {
  return String(cleanCoordinate(value))
}

export function getResourceBranchOrigin(measurements, fallback = DEFAULT_RESOURCE_BRANCH_ORIGIN) {
  const rowLeft = toFiniteNumber(measurements?.rowLeft)
  const rowWidth = toFiniteNumber(measurements?.rowWidth)
  const contentBottom = toFiniteNumber(measurements?.contentBottom)
  const mapLeft = toFiniteNumber(measurements?.mapLeft)
  const mapTop = toFiniteNumber(measurements?.mapTop)
  const mapWidth = toFiniteNumber(measurements?.mapWidth)
  const mapHeight = toFiniteNumber(measurements?.mapHeight)

  if (
    rowLeft === null ||
    rowWidth === null ||
    contentBottom === null ||
    mapLeft === null ||
    mapTop === null ||
    mapWidth === null ||
    mapHeight === null ||
    mapWidth <= 0 ||
    mapHeight <= 0
  ) {
    return fallback
  }

  return {
    x_pct: cleanCoordinate(((rowLeft + rowWidth / 2 - mapLeft) / mapWidth) * 100),
    y_pct: cleanCoordinate(((contentBottom - mapTop) / mapHeight) * 100),
  }
}

export function buildResourceBranchPath(
  layout,
  index,
  count,
  origin = DEFAULT_RESOURCE_BRANCH_ORIGIN,
) {
  const startX = toFiniteNumber(origin?.x_pct) ?? DEFAULT_RESOURCE_BRANCH_ORIGIN.x_pct
  const startY = toFiniteNumber(origin?.y_pct) ?? DEFAULT_RESOURCE_BRANCH_ORIGIN.y_pct
  const endX = toFiniteNumber(layout?.x_pct) ?? startX
  const endY = toFiniteNumber(layout?.y_pct) ?? startY
  const curl = ((index % 5) - 2) * 3.2
  const travelX = endX - startX
  const travelY = endY - startY
  const c1x = startX + travelX * 0.26 + ((index % 4) - 1.5) * 1.6
  const c1y = startY + travelY * 0.2 + curl
  const c2x = startX + travelX * 0.76 - ((index % 3) - 1) * 2.4
  const c2y = endY + (index % 2 === 0 ? 7 : -8) - curl * 0.18 + (count % 2 === 0 ? -1.4 : 0)

  return [
    'M',
    formatCoordinate(startX),
    formatCoordinate(startY),
    'C',
    `${formatCoordinate(c1x)} ${formatCoordinate(c1y)},`,
    `${formatCoordinate(c2x)} ${formatCoordinate(c2y)},`,
    formatCoordinate(endX),
    formatCoordinate(endY),
  ].join(' ')
}
