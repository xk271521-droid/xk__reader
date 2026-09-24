import { getStoredAuthToken } from './authApi'
import { resolveApiErrorMessage } from '../utils/errorMessage'

const PAPERS_BASE = '/api/papers'

async function parseJsonResponse(response) {
  let payload = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail = payload?.detail
    const message = resolveApiErrorMessage(payload)
    const error = new Error(message)
    error.status = response.status
    error.detail = detail
    error.code = detail?.code || null
    throw error
  }

  return payload
}

function authHeaders() {
  const token = getStoredAuthToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

// ── Folders ──────────────────────────────────────────────

export async function fetchFolders() {
  const response = await fetch(`${PAPERS_BASE}/folders`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function createFolder(name) {
  const response = await fetch(`${PAPERS_BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  })
  return parseJsonResponse(response)
}

export async function renameFolder(id, name) {
  const response = await fetch(`${PAPERS_BASE}/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  })
  return parseJsonResponse(response)
}

export async function deleteFolder(id) {
  const response = await fetch(`${PAPERS_BASE}/folders/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = '删除失败'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {
      void 0
    }
    throw new Error(detail)
  }
  return null
}

// ── Papers ───────────────────────────────────────────────

export async function fetchPapers(folderId) {
  let url = PAPERS_BASE
  if (folderId != null && folderId !== '') {
    url += `?folder_id=${folderId}`
  }
  const response = await fetch(url, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function uploadPaper(file, metadata, folderId) {
  const formData = new FormData()
  formData.append('file', file)
  if (metadata) {
    formData.append('metadata_json', JSON.stringify(metadata))
  }
  if (folderId != null && folderId !== '') {
    formData.append('folder_id', String(folderId))
  }

  const response = await fetch(PAPERS_BASE, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return parseJsonResponse(response)
}

export async function updatePaper(id, data) {
  const response = await fetch(`${PAPERS_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return parseJsonResponse(response)
}

export async function refreshPaperMetadata(id) {
  const response = await fetch(`${PAPERS_BASE}/${id}/metadata/refresh`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function deletePaper(id) {
  const response = await fetch(`${PAPERS_BASE}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = '删除失败'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {
      void 0
    }
    throw new Error(detail)
  }
  return null
}

export async function fetchTrashPapers() {
  const response = await fetch(`${PAPERS_BASE}/trash`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function restorePaperFromTrash(id) {
  const response = await fetch(`${PAPERS_BASE}/trash/${id}/restore`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function permanentlyDeletePaper(id) {
  const response = await fetch(`${PAPERS_BASE}/trash/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = '彻底删除失败'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {
      void 0
    }
    throw new Error(detail)
  }
  return null
}

export async function emptyTrash() {
  const response = await fetch(`${PAPERS_BASE}/trash`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export function getPaperFileUrl(paperId) {
  return `${PAPERS_BASE}/${paperId}/file`
}

function parseDownloadFileName(contentDisposition, fallbackName) {
  const value = String(contentDisposition || '')
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }
  const quotedMatch = value.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1]
  const plainMatch = value.match(/filename=([^;]+)/i)
  if (plainMatch?.[1]) return plainMatch[1].trim()
  return fallbackName
}

export async function downloadPaperExport(paperId, format, fallbackName) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/download/${format}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = '下载失败，请稍后再试。'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {
      // ignore parse error
    }
    throw new Error(detail)
  }
  return {
    blob: await response.blob(),
    fileName: parseDownloadFileName(response.headers.get('Content-Disposition'), fallbackName),
  }
}

export async function fetchFullTranslation(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/full-translation`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function startFullTranslation(paperId, payload) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/full-translation/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function retryFullTranslation(paperId, payload) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/full-translation/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function cancelFullTranslation(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/full-translation/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function streamFullTranslation(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/full-translation/stream`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export function getFullTranslationDownloadUrl(paperId) {
  return `${PAPERS_BASE}/${paperId}/full-translation/download`
}

export async function retranslateFullTranslation(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/full-translation/retranslate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  })
  return parseJsonResponse(response)
}

export function getFullTranslationFileUrl(paperId) {
  return `${PAPERS_BASE}/${paperId}/full-translation/file`
}

export async function downloadFullTranslation(paperId, fallbackName = 'translation-zh.pdf') {
  const response = await fetch(getFullTranslationDownloadUrl(paperId), {
    headers: authHeaders(),
  })
  if (!response.ok) {
    return parseJsonResponse(response)
  }
  return {
    blob: await response.blob(),
    fileName: parseDownloadFileName(response.headers.get('Content-Disposition'), fallbackName),
  }
}

export async function fetchPaperReadingBrief(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/reading-brief`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function ensurePaperReadingBrief(paperId, providerId = null) {
  const body = providerId ? { provider_id: Number(providerId) } : {}
  const response = await fetch(`${PAPERS_BASE}/${paperId}/reading-brief/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function retryPaperReadingBrief(paperId, providerId = null) {
  const body = providerId ? { provider_id: Number(providerId) } : {}
  const response = await fetch(`${PAPERS_BASE}/${paperId}/reading-brief/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function refreshPaperReadingBrief(paperId, providerId = null) {
  const body = providerId ? { provider_id: Number(providerId) } : {}
  const response = await fetch(`${PAPERS_BASE}/${paperId}/reading-brief/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperAiOutline(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/ai-outline`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

function buildPaperAiOutlineRequest({ providerId = null, nativeOutline = null } = {}) {
  const body = providerId ? { provider_id: Number(providerId) } : {}
  if (Array.isArray(nativeOutline) && nativeOutline.length > 0) {
    body.native_outline = { items: nativeOutline }
  }
  return body
}

export async function ensurePaperAiOutline(paperId, options = {}) {
  const body = buildPaperAiOutlineRequest(options)
  const response = await fetch(`${PAPERS_BASE}/${paperId}/ai-outline/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function retryPaperAiOutline(paperId, options = {}) {
  const body = buildPaperAiOutlineRequest(options)
  const response = await fetch(`${PAPERS_BASE}/${paperId}/ai-outline/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperFormatProfiles() {
  const response = await fetch('/api/paper-format/profiles', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function parsePaperFormatRequirements(text, providerId = null) {
  const response = await fetch('/api/paper-format/parse-requirements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      text,
      provider_id: providerId,
    }),
  })
  return parseJsonResponse(response)
}

export async function extractPaperFormatTemplate(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/paper-format/extract-template', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return parseJsonResponse(response)
}

export async function normalizePaperFormat(file, profile = 'undergraduate_cn', requirements = {}) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('profile', profile)
  formData.append('requirements_json', JSON.stringify(requirements || {}))

  const response = await fetch('/api/paper-format/normalize', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  if (!response.ok) {
    let detail = '论文格式正规化失败，请稍后再试。'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {
      void 0
    }
    throw new Error(detail)
  }

  let stats = null
  try {
    stats = JSON.parse(response.headers.get('X-Format-Stats') || 'null')
  } catch {
    stats = null
  }
  return {
    blob: await response.blob(),
    fileName: parseDownloadFileName(response.headers.get('Content-Disposition'), 'normalized-paper.docx'),
    stats,
  }
}

// ── Reading Records ──────────────────────────────────────

export async function recordReadingEvent(paperId, openedAt, durationSeconds = 0) {
  const body = { paper_id: Number(paperId) }
  if (openedAt != null) body.opened_at = new Date(openedAt).toISOString()
  if (durationSeconds > 0) body.duration_seconds = Math.round(durationSeconds)
  const response = await fetch('/api/reading-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function updateReadingDuration(recordId, durationSeconds) {
  const response = await fetch(`/api/reading-records/${recordId}/duration`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ duration_seconds: Math.max(0, Math.round(durationSeconds || 0)) }),
  })
  return parseJsonResponse(response)
}

export async function fetchReadingStats() {
  const response = await fetch('/api/reading-records/stats', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchReadingDashboard(timeframe = 'month') {
  const query = new URLSearchParams({ timeframe })
  const response = await fetch(`/api/reading-records/dashboard?${query.toString()}`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchResourceOverview() {
  const response = await fetch('/api/resources/overview', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function saveResourceLayout(paperId, layout) {
  const response = await fetch(`/api/resources/${paperId}/layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(layout),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperPageLayout(paperId, pageNumber) {
  const response = await fetch(
    `${PAPERS_BASE}/${encodeURIComponent(paperId)}/layout/${encodeURIComponent(pageNumber)}`,
    {
      headers: authHeaders(),
    },
  )
  return parseJsonResponse(response)
}

export async function syncReadingRecords(records) {
  const response = await fetch('/api/reading-records/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ records }),
  })
  return parseJsonResponse(response)
}

export async function fetchSelectionInsight(payload) {
  const response = await fetch('/api/selection-insight', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

// ── AI 厂商 & 摘要 ─────────────────────────────────────

export async function fetchAiProviders() {
  const response = await fetch('/api/providers', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function createAiProvider(data) {
  const response = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return parseJsonResponse(response)
}

export async function updateAiProvider(id, data) {
  const response = await fetch(`/api/providers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return parseJsonResponse(response)
}

export async function deleteAiProvider(id) {
  const response = await fetch(`/api/providers/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = '删除失败'
    try {
      const p = await response.json()
      if (typeof p?.detail === 'string') detail = p.detail
    } catch {
      void 0
    }
    throw new Error(detail)
  }
  return null
}

export async function testAiProvider(data) {
  const response = await fetch('/api/providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return parseJsonResponse(response)
}

export async function fetchTranslationConfig() {
  const response = await fetch('/api/translation/config', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function updateTranslationConfig(data) {
  const response = await fetch('/api/translation/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return parseJsonResponse(response)
}

export async function deleteTranslationConfig() {
  const response = await fetch('/api/translation/config', {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function testBaiduTranslation(data) {
  const response = await fetch('/api/translation/baidu/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperAnnotations(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/annotations`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperNotebooks(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/notebooks`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function checkNotesExportAllowed(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/notebooks/export/check`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}
