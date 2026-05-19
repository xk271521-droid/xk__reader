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
        : '后台请求失败，请稍后再试。'
    throw new Error(detail)
  }

  return payload
}

export async function fetchAdminOverview() {
  const response = await fetch('/api/admin/overview', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchAdminUsers(filters = {}) {
  const query = new URLSearchParams()
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      query.set(key, String(value))
    }
  })
  const response = await fetch(`/api/admin/users${query.toString() ? `?${query.toString()}` : ''}`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchAdminUserDetail(userId) {
  const response = await fetch(`/api/admin/users/${userId}`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function updateAdminUser(userId, payload) {
  const response = await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}

export async function uploadAdminUserAvatar(userId, file) {
  const formData = new FormData()
  formData.append('avatar', file)

  const response = await fetch(`/api/admin/users/${userId}/avatar`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
    },
    body: formData,
  })
  return parseJsonResponse(response)
}

export async function fetchAdminPapers() {
  const response = await fetch('/api/admin/papers', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function broadcastAdminNotification(payload) {
  const response = await fetch('/api/notifications/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse(response)
}
