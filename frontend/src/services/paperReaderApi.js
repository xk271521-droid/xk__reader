async function parseJsonResponse(response) {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json()
}

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
