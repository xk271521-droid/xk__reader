import { getStoredAuthToken } from './authApi'

function authHeaders() {
  const token = getStoredAuthToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

async function parseJsonResponse(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail =
      typeof payload?.detail === 'string'
        ? payload.detail
        : '请求失败，请稍后重试。'
    throw new Error(detail)
  }

  return payload
}

export async function createFeedbackTicket(payload) {
  const formData = new FormData()
  formData.append('category', String(payload?.category || 'bug'))
  formData.append('title', String(payload?.title || ''))
  formData.append('content', String(payload?.content || ''))
  formData.append('contact', String(payload?.contact || ''))
  if (payload?.screenshot instanceof File) {
    formData.append('screenshot', payload.screenshot)
  }

  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: {
      ...authHeaders(),
    },
    body: formData,
  })
  return parseJsonResponse(response)
}

export async function fetchMyFeedbackTickets() {
  const response = await fetch('/api/feedback', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}
