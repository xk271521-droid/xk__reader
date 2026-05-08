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
    throw new Error(detail)
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

export function getPaperFileUrl(paperId) {
  return `${PAPERS_BASE}/${paperId}/file`
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

export async function recordReadingEvent(paperId, openedAt) {
  const body = { paper_id: Number(paperId) }
  if (openedAt != null) body.opened_at = new Date(openedAt).toISOString()
  const response = await fetch('/api/reading-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return parseJsonResponse(response)
}

export async function fetchReadingStats() {
  const response = await fetch('/api/reading-records/stats', {
    headers: authHeaders(),
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

// ── Legacy (unchanged) ───────────────────────────────────

export async function fetchBackendHealth() {
  const response = await fetch('/api/health')
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
