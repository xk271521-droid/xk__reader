const ANNOTATION_TYPE_LABELS = {
  highlight: '高亮',
  underline: '下划线',
  wavy_underline: '波浪线',
}

function readNumber(annotation, ...keys) {
  for (const key of keys) {
    const value = annotation?.[key]
    if (value == null || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return 0
}

function readString(annotation, ...keys) {
  for (const key of keys) {
    const value = annotation?.[key]
    if (value == null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeRectValue(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return '0'
  return numeric.toFixed(6)
}

function uniqueRectList(rects = []) {
  const deduped = []
  const seen = new Set()
  for (const rect of rects) {
    const key = [
      normalizeRectValue(rect?.left),
      normalizeRectValue(rect?.top),
      normalizeRectValue(rect?.width),
      normalizeRectValue(rect?.height),
    ].join(':')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(rect)
  }
  return deduped
}

export function mergeLogicalAnnotations(annotations = []) {
  const groups = new Map()

  for (const annotation of annotations || []) {
    if (!annotation) continue
    const startChar = readNumber(annotation, 'start_char', 'startChar')
    const endChar = readNumber(annotation, 'end_char', 'endChar')
    if (endChar <= startChar) continue
    const groupKey = [
      readNumber(annotation, 'page_number', 'page'),
      readString(annotation, 'type') || 'highlight',
      readString(annotation, 'color'),
      readString(annotation, 'source') || 'native',
      readString(annotation, 'geometry_version', 'geometryVersion') || 'v1',
    ].join('::')
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push({
      ...annotation,
      page_number: readNumber(annotation, 'page_number', 'page'),
      start_char: startChar,
      end_char: endChar,
      quote_text: readString(annotation, 'quote_text', 'quote'),
      rects: [...(annotation?.rects || [])],
    })
  }

  return [...groups.values()]
    .flatMap((items) => {
      const ordered = [...items].sort((left, right) =>
        left.start_char - right.start_char || left.end_char - right.end_char || readNumber(left, 'id') - readNumber(right, 'id'),
      )
      const merged = []
      let current = null
      for (const item of ordered) {
        if (!current || item.start_char > current.end_char) {
          current = { ...item, fragment_count: 1 }
          merged.push(current)
          continue
        }
        current.end_char = Math.max(current.end_char, item.end_char)
        const quote = readString(item, 'quote_text', 'quote')
        if (quote && quote !== current.quote_text) {
          current.quote_text = [current.quote_text, quote].filter(Boolean).join(' ')
        }
        current.rects = uniqueRectList([...(current.rects || []), ...(item.rects || [])])
        current.fragment_count += 1
      }
      return merged
    })
    .sort((left, right) =>
      left.page_number - right.page_number || left.start_char - right.start_char || left.end_char - right.end_char || readNumber(left, 'id') - readNumber(right, 'id'),
    )
}

export function countLogicalAnnotations(annotations = []) {
  return mergeLogicalAnnotations(annotations).length
}

export function buildAnnotationSummaryGroupsFromAnnotations(annotations = []) {
  const groupedByType = {
    highlight: [],
    underline: [],
    wavy_underline: [],
  }

  for (const annotation of mergeLogicalAnnotations(annotations)) {
    const annotationType = readString(annotation, 'type') || 'highlight'
    if (!groupedByType[annotationType]) continue
    groupedByType[annotationType].push(annotation)
  }

  return Object.entries(ANNOTATION_TYPE_LABELS).map(([type, label]) => ({
    type,
    label,
    count: groupedByType[type].length,
    items: groupedByType[type].map((annotation, index) => ({
      id: annotation.id ?? null,
      index: index + 1,
      page: annotation.page_number || null,
      quote: annotation.quote_text || '',
      color: readString(annotation, 'color'),
      start_char: annotation.start_char,
      end_char: annotation.end_char,
      fragment_count: annotation.fragment_count || 1,
    })),
  }))
}
