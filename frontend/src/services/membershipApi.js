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
    const detail = payload?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : typeof detail?.message === 'string'
          ? detail.message
          : '请求失败，请稍后再试。'
    const error = new Error(message)
    error.status = response.status
    error.detail = detail
    error.code = detail?.code || null
    throw error
  }

  return payload
}

export async function fetchMembershipMe() {
  const response = await fetch('/api/membership/me', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchMembershipPlans() {
  const response = await fetch('/api/membership/plans')
  return parseJsonResponse(response)
}

export async function redeemMembershipCode(code) {
  const response = await fetch('/api/membership/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ code }),
  })
  return parseJsonResponse(response)
}
