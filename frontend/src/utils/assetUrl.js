export function resolveAssetUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      if (parsed.pathname.startsWith('/uploads/')) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      }
      return raw
    } catch {
      return raw
    }
  }

  if (raw.startsWith('/uploads/')) {
    return raw
  }

  if (raw.startsWith('uploads/')) {
    return `/${raw}`
  }

  return raw
}
