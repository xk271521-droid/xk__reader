import { getStoredAuthToken } from './authApi'
import { resolveApiErrorMessage } from '../utils/errorMessage'

const PAPERS_BASE = '/api/papers'

function authHeaders() {
  const token = getStoredAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseJsonResponse(response) {
  let payload

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const error = new Error(resolveApiErrorMessage(payload))
    error.status = response.status
    error.detail = payload?.detail
    error.code = payload?.detail?.code || null
    throw error
  }

  return payload
}

function annotationUrl(paperId, suffix = '') {
  return `${PAPERS_BASE}/${encodeURIComponent(paperId)}/pdf-annotations${suffix}`
}

export async function fetchPdfAnnotations(paperId, { signal } = {}) {
  const response = await fetch(annotationUrl(paperId), {
    headers: authHeaders(),
    signal,
  })
  return parseJsonResponse(response)
}

export async function syncPdfAnnotations(paperId, batch, { signal } = {}) {
  const response = await fetch(annotationUrl(paperId, '/sync'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(batch),
    signal,
  })
  return parseJsonResponse(response)
}

export async function clearPdfAnnotations(paperId, { signal } = {}) {
  const response = await fetch(annotationUrl(paperId), {
    method: 'DELETE',
    headers: authHeaders(),
    signal,
  })
  return parseJsonResponse(response)
}
