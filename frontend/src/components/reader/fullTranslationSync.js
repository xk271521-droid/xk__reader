export function getScrollProgress(state) {
  const maxScrollTop = Number(state?.maxScrollTop)
  const scrollTop = Number(state?.scrollTop)
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0 || !Number.isFinite(scrollTop)) return null
  return Math.max(0, Math.min(1, scrollTop / maxScrollTop))
}

export function getSyncedScrollTop(sourceState, targetState) {
  const progress = getScrollProgress(sourceState)
  const targetMaxScrollTop = Number(targetState?.maxScrollTop)
  if (progress === null || !Number.isFinite(targetMaxScrollTop) || targetMaxScrollTop <= 0) return null
  return progress * targetMaxScrollTop
}
