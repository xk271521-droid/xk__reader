export function buildPaperAnswerRequest({
  paperId,
  question,
  requestKind = 'question',
  selectedText = '',
  providerId = null,
} = {}) {
  const normalizedKind = requestKind === 'deep_read' ? 'deep_read' : 'question'
  const normalizedQuestion = String(question || '').trim()
  const normalizedSelection = normalizedKind === 'deep_read'
    ? String(selectedText || normalizedQuestion).trim()
    : ''

  return {
    paper_id: Number(paperId),
    question: normalizedQuestion,
    selected_text: normalizedSelection,
    request_kind: normalizedKind,
    provider_id: providerId || null,
  }
}
