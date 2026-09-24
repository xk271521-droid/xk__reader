import { getStoredAuthToken } from './authApi'
import { resolveApiErrorMessage } from '../utils/errorMessage'

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const detail = payload?.detail
    const message = resolveApiErrorMessage(payload)
    const error = new Error(message)
    error.status = response.status
    error.detail = detail
    throw error
  }

  return payload
}

function authHeaders() {
  const token = getStoredAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchTaskCenter(limit = 50) {
  const response = await fetch(`/api/tasks?limit=${encodeURIComponent(limit)}`, {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function fetchTaskCenterSummary() {
  const response = await fetch('/api/tasks/summary', {
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function cancelTask(taskId) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function retryTask(taskId) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function archiveTaskCenterItems(taskIds = []) {
  const response = await fetch('/api/tasks/archive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ task_ids: taskIds }),
  })
  return parseJsonResponse(response)
}

export async function archiveCompletedTaskCenterItems() {
  const response = await fetch('/api/tasks/archive-completed', {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}

export async function archiveFinishedTaskCenterItems() {
  const response = await fetch('/api/tasks/archive-finished', {
    method: 'POST',
    headers: authHeaders(),
  })
  return parseJsonResponse(response)
}
