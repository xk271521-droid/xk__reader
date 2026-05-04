import { useCallback, useEffect, useRef, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'

const ANNOTATIONS_BASE = '/api/papers'

async function apiFetch(url, options = {}) {
  const token = getStoredAuthToken()
  const headers = { ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  const resp = await fetch(url, { ...options, headers })
  if (!resp.ok) {
    let detail = '请求失败'
    try { const d = await resp.json(); if (typeof d?.detail === 'string') detail = d.detail } catch {}
    throw new Error(detail)
  }
  return resp.status === 204 ? null : resp.json()
}

export function useAnnotations(paperId) {
  const [annotations, setAnnotations] = useState([])
  const [loading, setLoading] = useState(false)
  const cacheKey = useRef(0)

  const loadAnnotations = useCallback(async () => {
    if (!paperId) return
    setLoading(true)
    try {
      const data = await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations`)
      if (data?.annotations) setAnnotations(data.annotations)
    } catch { /* ignore */ }
    setLoading(false)
  }, [paperId])

  const createAnnotation = useCallback(async ({ pageNumber, startOffset, endOffset, selectedText, type, color }) => {
    if (!paperId) return null
    try {
      const data = await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_number: pageNumber, start_offset: startOffset, end_offset: endOffset, selected_text: selectedText, type, color }),
      })
      if (data) setAnnotations((prev) => [...prev, data])
      return data
    } catch { return null }
  }, [paperId])

  const deleteAnnotation = useCallback(async (annotationId) => {
    if (!paperId) return
    try {
      await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations/${annotationId}`, { method: 'DELETE' })
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
    } catch { /* ignore */ }
  }, [paperId])

  useEffect(() => {
    loadAnnotations()
  }, [loadAnnotations])

  return { annotations, loading, loadAnnotations, createAnnotation, deleteAnnotation }
}
