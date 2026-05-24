function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function buildNoteAnchorFocus(source = {}, nonce = '') {
  const pageNumber = toNumber(source.page_number ?? source.pageNumber ?? source.page)
  if (!pageNumber) return null
  return {
    pageNumber,
    startChar: source.start_char ?? source.startChar ?? null,
    endChar: source.end_char ?? source.endChar ?? null,
    quote: source.quote || source.quote_text || source.content || '',
    nonce,
  }
}
