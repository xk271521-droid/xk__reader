const AUTH_TOKEN_KEY = 'xk_reader_auth_token'

async function parseJsonResponse(response) {
  let payload

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail =
      typeof payload?.detail === 'string'
        ? payload.detail
        : '请求失败，请稍后再试。'
    throw new Error(detail)
  }

  return payload
}

function buildAuthHeaders(token) {
  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

export function getStoredAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY)
}

export function storeAuthToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearStoredAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
}

export async function fetchCaptchaChallenge(scene) {
  const response = await fetch(`/api/auth/captcha?scene=${encodeURIComponent(scene)}`)
  return parseJsonResponse(response)
}

export async function sendRegisterVerificationCode(payload) {
  const response = await fetch('/api/auth/register/send-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseJsonResponse(response)
}

export async function sendResetVerificationCode(payload) {
  const response = await fetch('/api/auth/password/send-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseJsonResponse(response)
}

export async function resetPassword(payload) {
  const response = await fetch('/api/auth/password/reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseJsonResponse(response)
}

export async function registerUser(payload) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseJsonResponse(response)
}

export async function loginUser(payload) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseJsonResponse(response)
}

export async function fetchCurrentUser(token = getStoredAuthToken()) {
  const response = await fetch('/api/auth/me', {
    headers: {
      ...buildAuthHeaders(token),
    },
  })

  return parseJsonResponse(response)
}

export async function updateCurrentUser(payload, token = getStoredAuthToken()) {
  const response = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(token),
    },
    body: JSON.stringify(payload),
  })

  return parseJsonResponse(response)
}

export async function uploadAvatar(file, token = getStoredAuthToken()) {
  const formData = new FormData()
  formData.append('avatar', file)

  const response = await fetch('/api/auth/me/avatar', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(token),
    },
    body: formData,
  })

  return parseJsonResponse(response)
}
