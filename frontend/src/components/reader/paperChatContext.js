const PAGE_MARK_RE = /\[第\s*(\d+)\s*页\]/g

function compact(value) {
  return String(value || '').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function collectNoteBlocks(notebooks = []) {
  const blocks = []
  function visit(node, path = []) {
    const nextPath = [...path, node?.title].filter(Boolean)
    ;(node?.blocks || []).forEach((block) => {
      if (block?.type === 'quote' || block?.type === 'image') {
        blocks.push({ ...block, path: nextPath })
      }
    })
    ;(node?.children || []).forEach((child) => visit(child, nextPath))
  }

  notebooks.forEach((notebook) => {
    ;(notebook?.nodes || []).forEach((node) => visit(node, [notebook.title].filter(Boolean)))
  })
  return blocks
}

export function buildPageMarkedExcerpt(fullText = '', maxChars = 3600) {
  const text = compact(fullText)
  if (!text) return ''
  PAGE_MARK_RE.lastIndex = 0
  if (!PAGE_MARK_RE.test(text)) {
    PAGE_MARK_RE.lastIndex = 0
    return `[全文摘录]\n${text.slice(0, maxChars)}`
  }
  PAGE_MARK_RE.lastIndex = 0

  const pages = []
  const matches = [...text.matchAll(PAGE_MARK_RE)]
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const next = matches[index + 1]
    const start = match.index || 0
    const end = next?.index ?? text.length
    const chunk = text.slice(start, end).trim()
    if (chunk) pages.push(chunk)
  }

  const excerpt = []
  let total = 0
  for (const page of pages) {
    if (total >= maxChars) break
    const room = maxChars - total
    const next = page.length > room ? `${page.slice(0, Math.max(0, room - 1))}…` : page
    excerpt.push(next)
    total += next.length
  }
  return excerpt.join('\n\n')
}

export function buildNotebookCitationDigest(notebooks = [], maxItems = 8) {
  return collectNoteBlocks(notebooks)
    .filter((block) => block.page_number || block.pageNumber)
    .slice(0, maxItems)
    .map((block) => {
      const pageNumber = block.page_number || block.pageNumber
      const label = block.type === 'image' ? '截图笔记' : '摘录笔记'
      const content = compact(block.content || block.quote || '').slice(0, 220)
      const path = block.path?.length ? `；位置：${block.path.join(' / ')}` : ''
      return `[第 ${pageNumber} 页] ${label}${path}${content ? `：${content}` : ''}`
    })
    .join('\n')
}

export function buildPaperChatContextPayload({
  fileName = '',
  fullText = '',
  metadata = {},
  notebooks = [],
  providerId = null,
  selectedText = '',
  summary = '',
} = {}) {
  const title = metadata.title || fileName || ''
  const excerpt = buildPageMarkedExcerpt(fullText)
  const noteDigest = buildNotebookCitationDigest(notebooks)
  const fallbackSummary = compact(summary)
  const contextBlocks = [
    '请基于当前论文回答。回答涉及论文内容时必须尽量附页码，格式如 [第 3 页]；如果材料没有页码或证据不足，请明确说明。',
    title ? `论文标题：${title}` : '',
    excerpt ? `论文全文摘录：\n${excerpt}` : '',
    fallbackSummary && !excerpt ? `论文摘要：${fallbackSummary}` : '',
    noteDigest ? `用户笔记线索：\n${noteDigest}` : '',
  ].filter(Boolean)

  return {
    paper_title: title,
    provider_id: providerId,
    selected_text: compact(selectedText),
    summary: contextBlocks.join('\n\n'),
  }
}
