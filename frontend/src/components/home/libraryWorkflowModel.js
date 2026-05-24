function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalize(value) {
  return compact(value).toLowerCase()
}

export function getPaperYear(paper = {}) {
  const candidates = [
    paper.metadata?.year,
    paper.metadata?.publicationYear,
    paper.metadata?.creationDate,
    paper.metadata?.modificationDate,
    paper.createdAt,
    paper.created_at,
    paper.lastViewedAt ? new Date(paper.lastViewedAt).getFullYear() : '',
  ]
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/\b(19|20)\d{2}\b/)
    if (match) return match[0]
  }
  return ''
}

export function getLibraryAdvancedFilterOptions(papers = [], selectedFolderId = '') {
  const scoped = papers.filter((paper) => !selectedFolderId || String(paper.folderId) === String(selectedFolderId))
  const years = [...new Set(scoped.map(getPaperYear).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a))
  const authors = [...new Set(scoped.map((paper) => compact(paper.metadata?.author)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .slice(0, 80)
  return { authors, years }
}

export function matchesLibraryAdvancedFilters(paper = {}, filters = {}) {
  const authorFilter = normalize(filters.author)
  const yearFilter = compact(filters.year)
  const keyword = normalize(filters.keyword)

  if (authorFilter && !normalize(paper.metadata?.author).includes(authorFilter)) {
    return false
  }

  if (yearFilter && getPaperYear(paper) !== yearFilter) {
    return false
  }

  if (keyword) {
    const haystack = normalize([
      paper.title,
      paper.fileName,
      paper.metadata?.title,
      paper.metadata?.translatedTitle,
      paper.metadata?.author,
      paper.metadata?.subject,
      paper.metadata?.keywords,
      getPaperYear(paper),
    ].filter(Boolean).join(' '))
    if (!haystack.includes(keyword)) return false
  }

  return true
}

export function buildLibraryBulkSummary(selectedIds = [], papers = []) {
  const selectedSet = new Set([...selectedIds].map(String))
  const selectedPapers = papers.filter((paper) => selectedSet.has(String(paper.id)))
  const folderIds = new Set(selectedPapers.map((paper) => String(paper.folderId || '')))
  return {
    count: selectedPapers.length,
    paperIds: selectedPapers.map((paper) => paper.id),
    folderCount: folderIds.size,
    hasSelection: selectedPapers.length > 0,
  }
}

export function createBulkOperationPlan(action, selectedIds = [], value = '') {
  const paperIds = [...selectedIds].map(String).filter(Boolean)
  return {
    action,
    paperIds,
    value: String(value || ''),
    canRun: Boolean(action && paperIds.length && (action !== 'move' || value)),
  }
}
