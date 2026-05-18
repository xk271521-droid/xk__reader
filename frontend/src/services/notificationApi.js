import { getStoredAuthToken } from './authApi'

async function parseJsonResponse(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : '请求失败，请稍后再试。'
    const error = new Error(detail)
    error.status = response.status
    throw error
  }

  return payload
}

function authHeaders() {
  const token = getStoredAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchNotificationSummary() {
  const response = await fetch('/api/notifications/summary', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchNotifications(limit = 20) {
  const response = await fetch(`/api/notifications?limit=${encodeURIComponent(limit)}`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function markNotificationRead(notificationId) {
  const response = await fetch(`/api/notifications/${notificationId}/read`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function markAllNotificationsRead() {
  const response = await fetch('/api/notifications/read-all', {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}
