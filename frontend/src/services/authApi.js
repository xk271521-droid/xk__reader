const AUTH_TOKEN_KEY = 'xk_reader_auth_token'
const REMEMBERED_LOGIN_KEY = 'xk_reader_remembered_login'

function getLocalStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null
}

function getSessionStorage() {
  return typeof window !== 'undefined' ? window.sessionStorage : null
}

function safeGet(storage, key) {
  try {
    return storage?.getItem(key) || ''
  } catch {
    return ''
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem(key, value)
  } catch {
    // Storage can be disabled; login still works for the current request.
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem(key)
  } catch {
    // Ignore unavailable storage.
  }
}

async function parseJsonResponse(response) {
  let payload

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
          : 'Request failed. Please try again later.'
    const error = new Error(message)
    error.detail = detail
    error.code = detail?.code || null
    error.status = response.status
    throw error
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
  return safeGet(getLocalStorage(), AUTH_TOKEN_KEY) || safeGet(getSessionStorage(), AUTH_TOKEN_KEY)
}

export function storeAuthToken(token, options = {}) {
  const remember = options.remember !== false
  if (remember) {
    safeSet(getLocalStorage(), AUTH_TOKEN_KEY, token)
    safeRemove(getSessionStorage(), AUTH_TOKEN_KEY)
    return
  }

  safeSet(getSessionStorage(), AUTH_TOKEN_KEY, token)
  safeRemove(getLocalStorage(), AUTH_TOKEN_KEY)
}

export function clearStoredAuthToken() {
  safeRemove(getLocalStorage(), AUTH_TOKEN_KEY)
  safeRemove(getSessionStorage(), AUTH_TOKEN_KEY)
}

export function getRememberedLogin() {
  const raw = safeGet(getLocalStorage(), REMEMBERED_LOGIN_KEY)
  if (!raw) {
    return { account: '', remember: false }
  }

  try {
    const payload = JSON.parse(raw)
    return {
      account: typeof payload?.account === 'string' ? payload.account : '',
      remember: Boolean(payload?.remember),
    }
  } catch {
    return { account: '', remember: false }
  }
}

export function storeRememberedLogin({ account, remember }) {
  if (!remember) {
    clearRememberedLogin()
    return
  }

  safeSet(
    getLocalStorage(),
    REMEMBERED_LOGIN_KEY,
    JSON.stringify({
      account: String(account || '').trim(),
      remember: true,
      updatedAt: Date.now(),
    }),
  )
}

export function clearRememberedLogin() {
  safeRemove(getLocalStorage(), REMEMBERED_LOGIN_KEY)
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

export async function deleteCurrentUser(token = getStoredAuthToken()) {
  const response = await fetch('/api/auth/me', {
    method: 'DELETE',
    headers: {
      ...buildAuthHeaders(token),
    },
  })

  return parseJsonResponse(response)
}
