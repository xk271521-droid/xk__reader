import { getStoredAuthToken } from './authApi'

const PAPERS_BASE = '/api/papers'

async function parseJsonResponse(response) {
  if (!response.ok) {
    let detail = '请求失败，请稍后再试。'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') {
        detail = payload.detail
      }
    } catch {
      // ignore parse error
    }
    const error = new Error(detail)
    error.status = response.status
    throw error
  }

  return response.json()
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
    } catch {}
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
    } catch {}
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
    } catch {}
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

export async function fetchResearchDashboard() {
  const response = await fetch('/api/research-matrix/dashboard', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchResearchMatrixRuns() {
  const response = await fetch('/api/research-matrix/runs', {
    headers: authHeaders(),
    cache: 'no-store',
  })
  return parseJsonResponse(response)
}

export async function createResearchMatrixRun(payload) {
  const response = await fetch('/api/research-matrix/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function fetchResearchMatrixRun(runId) {
  const response = await fetch(`/api/research-matrix/runs/${runId}`, {
    headers: authHeaders(),
    cache: 'no-store',
  })
  return parseJsonResponse(response)
}

export async function updateResearchMatrixRun(runId, payload = {}) {
  const response = await fetch(`/api/research-matrix/runs/${runId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function updateResearchMatrixRunGroupingMode(runId, groupingMode) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/grouping-mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ grouping_mode: groupingMode }),
  })
  return parseJsonResponse(response)
}

export async function refreshResearchMatrixRun(runId, payload = {}) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function updateResearchMatrixRunPaper(runId, paperId, payload = {}) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/papers/${paperId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function updateResearchMatrixRunOutline(runId, payload = {}) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/outline`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function rewriteResearchMatrixDraftSection(runId, payload = {}) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/drafts:rewrite-section`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function prepareResearchMatrixDraftSources(runId, payload = {}) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/drafts:prepare-sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function refreshResearchMatrixInsights(runId) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/insights:refresh`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function retryPendingResearchMatrixRun(runId) {
  const response = await fetch(`/api/research-matrix/runs/${runId}/retry-pending`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function deleteResearchMatrixRun(runId) {
  const response = await fetch(`/api/research-matrix/runs/${runId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = '删除矩阵记录失败'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {}
    throw new Error(detail)
  }
  return null
}

export async function generateMissingReviewSummaries(payload) {
  const response = await fetch('/api/research-matrix/generate-missing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
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
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function fetchSelectionInsightExplain(payload) {
  const response = await fetch('/api/selection-insight/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    try { const p = await response.json(); if (typeof p?.detail === 'string') detail = p.detail } catch {}
    throw new Error(detail)
  }
  return null
}

export async function fetchPaperSummary(text, providerId) {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text, provider_id: providerId }),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperSummaries(paperId) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/summaries`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function generatePaperSummary(paperId, summaryType, payload = {}) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/summaries/${summaryType}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function fetchPaperSummaryStatus(paperId, summaryType) {
  const response = await fetch(`${PAPERS_BASE}/${paperId}/summaries/${summaryType}/status`, {
    headers: authHeaders(),
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
