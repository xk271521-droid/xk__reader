export const NOTE_RICH_TEXT_MARKER = '__xk_note_rich_text_v1'

export const NOTE_TEXT_COLORS = [
  { id: 'ink', label: '黑', value: '#2D2A25' },
  { id: 'red', label: '红', value: '#D94A45' },
  { id: 'orange', label: '橙', value: '#D97706' },
  { id: 'amber', label: '黄褐', value: '#A16207' },
  { id: 'green', label: '绿', value: '#15803D' },
  { id: 'cyan', label: '青', value: '#0E7490' },
  { id: 'blue', label: '蓝', value: '#2563EB' },
  { id: 'purple', label: '紫', value: '#7C3AED' },
]

export const DEFAULT_NOTE_TEXT_COLOR = NOTE_TEXT_COLORS[0].value

const ALLOWED_NOTE_COLORS = new Set(NOTE_TEXT_COLORS.map((item) => item.value.toLowerCase()))

export function normalizeNoteColor(color) {
  const normalized = String(color || '').trim().toLowerCase()
  const match = NOTE_TEXT_COLORS.find((item) => item.value.toLowerCase() === normalized)
  return match?.value || DEFAULT_NOTE_TEXT_COLOR
}

export function normalizeRichRanges(text, ranges) {
  const textLength = String(text || '').length
  const normalized = (Array.isArray(ranges) ? ranges : [])
    .map((range) => {
      const color = normalizeNoteColor(range?.color)
      const start = Math.max(0, Math.min(textLength, Number(range?.start) || 0))
      const end = Math.max(0, Math.min(textLength, Number(range?.end) || 0))
      return {
        start: Math.min(start, end),
        end: Math.max(start, end),
        color,
      }
    })
    .filter((range) => (
      range.end > range.start &&
      range.color !== DEFAULT_NOTE_TEXT_COLOR &&
      ALLOWED_NOTE_COLORS.has(range.color.toLowerCase())
    ))
    .sort((left, right) => left.start - right.start || left.end - right.end)

  const merged = []
  for (const range of normalized) {
    const last = merged[merged.length - 1]
    if (last && last.color === range.color && last.end >= range.start) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function parseRichNoteContent(value) {
  const raw = String(value || '')
  if (!raw.trim().startsWith('{')) {
    return { text: raw, ranges: [] }
  }

  try {
    const parsed = JSON.parse(raw)
    if (parsed?.[NOTE_RICH_TEXT_MARKER] !== true || typeof parsed.text !== 'string') {
      return { text: raw, ranges: [] }
    }
    return {
      text: parsed.text,
      ranges: normalizeRichRanges(parsed.text, parsed.ranges),
    }
  } catch (_) {
    return { text: raw, ranges: [] }
  }
}

export function serializeRichNoteContent(doc) {
  const text = String(doc?.text || '')
  const ranges = normalizeRichRanges(text, doc?.ranges)
  if (!ranges.length) {
    return text
  }
  return JSON.stringify({
    [NOTE_RICH_TEXT_MARKER]: true,
    text,
    ranges,
  })
}

export function applyColorToRichText(doc, start, end, color) {
  const text = String(doc?.text || '')
  const rangeStart = Math.max(0, Math.min(text.length, Number(start) || 0))
  const rangeEnd = Math.max(0, Math.min(text.length, Number(end) || 0))
  const orderedStart = Math.min(rangeStart, rangeEnd)
  const orderedEnd = Math.max(rangeStart, rangeEnd)
  if (orderedEnd <= orderedStart) {
    return {
      text,
      ranges: normalizeRichRanges(text, doc?.ranges),
    }
  }

  const nextColor = normalizeNoteColor(color)
  const nextRanges = []

  for (const range of normalizeRichRanges(text, doc?.ranges)) {
    if (range.end <= orderedStart || range.start >= orderedEnd) {
      nextRanges.push(range)
      continue
    }
    if (range.start < orderedStart) {
      nextRanges.push({ ...range, end: orderedStart })
    }
    if (range.end > orderedEnd) {
      nextRanges.push({ ...range, start: orderedEnd })
    }
  }

  if (nextColor !== DEFAULT_NOTE_TEXT_COLOR) {
    nextRanges.push({
      start: orderedStart,
      end: orderedEnd,
      color: nextColor,
    })
  }

  return {
    text,
    ranges: normalizeRichRanges(text, nextRanges),
  }
}

export function replaceRichTextRange(doc, start, end, insertedText, color) {
  const text = String(doc?.text || '')
  const rangeStart = Math.max(0, Math.min(text.length, Number(start) || 0))
  const rangeEnd = Math.max(0, Math.min(text.length, Number(end) || 0))
  const orderedStart = Math.min(rangeStart, rangeEnd)
  const orderedEnd = Math.max(rangeStart, rangeEnd)
  const insert = String(insertedText || '')
  const delta = insert.length - (orderedEnd - orderedStart)
  const nextText = `${text.slice(0, orderedStart)}${insert}${text.slice(orderedEnd)}`
  const nextRanges = []

  for (const range of normalizeRichRanges(text, doc?.ranges)) {
    if (range.end <= orderedStart) {
      nextRanges.push(range)
      continue
    }
    if (range.start >= orderedEnd) {
      nextRanges.push({
        ...range,
        start: range.start + delta,
        end: range.end + delta,
      })
      continue
    }
    if (range.start < orderedStart) {
      nextRanges.push({ ...range, end: orderedStart })
    }
    if (range.end > orderedEnd) {
      nextRanges.push({
        ...range,
        start: orderedStart + insert.length,
        end: range.end + delta,
      })
    }
  }

  const insertColor = normalizeNoteColor(color)
  if (insert && insertColor !== DEFAULT_NOTE_TEXT_COLOR) {
    nextRanges.push({
      start: orderedStart,
      end: orderedStart + insert.length,
      color: insertColor,
    })
  }

  return {
    text: nextText,
    ranges: normalizeRichRanges(nextText, nextRanges),
  }
}

export function inferRichTextEdit(previousDoc, nextText, color) {
  const previousText = String(previousDoc?.text || '')
  const currentText = String(nextText || '')
  let prefix = 0
  while (
    prefix < previousText.length &&
    prefix < currentText.length &&
    previousText[prefix] === currentText[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previousText.length - prefix &&
    suffix < currentText.length - prefix &&
    previousText[previousText.length - 1 - suffix] === currentText[currentText.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const removedEnd = previousText.length - suffix
  const inserted = currentText.slice(prefix, currentText.length - suffix)
  return replaceRichTextRange(previousDoc, prefix, removedEnd, inserted, color)
}

export function buildRichTextSegments(doc) {
  const text = String(doc?.text || '')
  const ranges = normalizeRichRanges(text, doc?.ranges)
  const segments = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), color: DEFAULT_NOTE_TEXT_COLOR })
    }
    segments.push({ text: text.slice(range.start, range.end), color: range.color })
    cursor = range.end
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), color: DEFAULT_NOTE_TEXT_COLOR })
  }

  return segments.length ? segments : [{ text: '', color: DEFAULT_NOTE_TEXT_COLOR }]
}
