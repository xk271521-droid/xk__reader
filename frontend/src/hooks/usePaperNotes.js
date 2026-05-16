import { useCallback, useEffect, useState } from 'react'
import { createNotebookFromTemplate } from '../components/reader/noteTree'
import { getStoredAuthToken } from '../services/authApi'

async function apiFetch(url, options = {}) {
  const token = getStoredAuthToken()
  const headers = { ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, { ...options, headers })
  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') detail = payload.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }

  return response.status === 204 ? null : response.json()
}

export function usePaperNotes(paperId) {
  const [notebooks, setNotebooks] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadNotebooks = useCallback(async () => {
    if (!paperId) {
      setNotebooks([])
      return
    }

    setLoading(true)
    try {
      const data = await apiFetch(`/api/papers/${paperId}/notebooks`)
      setNotebooks(data?.notebooks || [])
    } catch {
      setNotebooks([])
    } finally {
      setLoading(false)
    }
  }, [paperId])

  const saveNotebooks = useCallback(async (draftNotebooks) => {
    if (!paperId) return null
    setSaving(true)
    try {
      const data = await apiFetch(`/api/papers/${paperId}/notebooks/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebooks: draftNotebooks || [] }),
      })
      setNotebooks(data?.notebooks || [])
      return data?.notebooks || []
    } catch {
      return null
    } finally {
      setSaving(false)
    }
  }, [paperId])

  const createNotebookDraft = useCallback((kind = 'blank') => {
    setNotebooks((previous) => {
      const sortOrder = previous.length
      const notebook = createNotebookFromTemplate(kind, sortOrder)
      return [...previous, notebook]
    })
  }, [])

  useEffect(() => {
    loadNotebooks()
  }, [loadNotebooks])

  return {
    notebooks,
    loading,
    saving,
    setNotebooks,
    loadNotebooks,
    saveNotebooks,
    createNotebookDraft,
  }
}
