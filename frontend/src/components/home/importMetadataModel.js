const FILE_EXTENSION_RE = /\.[a-z0-9]{2,8}$/i
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i
const ARXIV_RE = /\b(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?\b/i

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeTitle(value) {
  return compact(value)
    .toLowerCase()
    .replace(FILE_EXTENSION_RE, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function isWeakImportedTitle(title, fileName = '') {
  const normalizedTitle = normalizeTitle(title)
  if (!normalizedTitle) return true
  if (normalizedTitle.length < 8) return true
  if (/^(untitled|document|paper|pdf|scan|new document|microsoft word)$/i.test(normalizedTitle)) {
    return true
  }

  const normalizedFile = normalizeTitle(fileName)
  return Boolean(normalizedFile && normalizedTitle === normalizedFile)
}

export function getMetadataRefreshGaps(serverPaper = {}, localMetadata = {}, fileName = '') {
  const metadata = {
    title: serverPaper.title || localMetadata.title || '',
    author: serverPaper.author || localMetadata.author || '',
    subject: serverPaper.subject || localMetadata.subject || '',
    keywords: serverPaper.keywords || localMetadata.keywords || '',
    doi: serverPaper.doi || localMetadata.doi || '',
    arxivId: serverPaper.arxiv_id || serverPaper.arxivId || localMetadata.arxivId || '',
    pageCount: serverPaper.page_count || localMetadata.pageCount || 0,
  }

  const gaps = []
  if (isWeakImportedTitle(metadata.title, fileName || serverPaper.file_name)) gaps.push('title')
  if (!compact(metadata.author)) gaps.push('author')
  if (!compact(metadata.subject) && !compact(metadata.keywords)) gaps.push('topic')
  if (!compact(metadata.doi) && !compact(metadata.arxivId)) gaps.push('identifier')
  if (!Number(metadata.pageCount || 0)) gaps.push('pageCount')
  return gaps
}

export function shouldRefreshImportedMetadata(serverPaper = {}, localMetadata = {}, file = null) {
  if (!serverPaper?.id) return false
  const fileName = typeof file === 'string' ? file : file?.name
  const gaps = getMetadataRefreshGaps(serverPaper, localMetadata, fileName)
  if (gaps.includes('title') || gaps.includes('author')) return true
  if (gaps.length >= 2) return true
  const searchable = compact([
    serverPaper.title,
    localMetadata.title,
    serverPaper.subject,
    localMetadata.subject,
    serverPaper.keywords,
    localMetadata.keywords,
  ].filter(Boolean).join(' '))
  return Boolean(searchable && (DOI_RE.test(searchable) || ARXIV_RE.test(searchable)))
}

export function mergeImportedServerPaper(uploadedPaper = {}, refreshedPaper = null) {
  if (!refreshedPaper?.id) return uploadedPaper
  if (String(uploadedPaper?.id || '') !== String(refreshedPaper.id)) return uploadedPaper
  const merged = {
    ...uploadedPaper,
    ...refreshedPaper,
  }
  if (refreshedPaper.file_name || uploadedPaper.file_name) {
    merged.file_name = refreshedPaper.file_name || uploadedPaper.file_name
  }
  if (refreshedPaper.folder_id || uploadedPaper.folder_id) {
    merged.folder_id = refreshedPaper.folder_id || uploadedPaper.folder_id
  }
  if (refreshedPaper.page_count || uploadedPaper.page_count) {
    merged.page_count = refreshedPaper.page_count || uploadedPaper.page_count
  }
  return merged
}
