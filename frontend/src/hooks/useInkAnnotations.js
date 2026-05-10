import { useCallback, useEffect, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'

const INK_BASE = '/api/papers'

async function apiFetch(url, options = {}) {
  const token = getStoredAuthToken()
  const headers = { ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`

  const resp = await fetch(url, { ...options, headers })
  if (!resp.ok) {
    let detail = '请求失败'
    try {
      const data = await resp.json()
      if (typeof data?.detail === 'string') detail = data.detail
    } catch {
      // Keep the default message.
    }
    throw new Error(detail)
  }

  return resp.status === 204 ? null : resp.json()
}

export function useInkAnnotations(paperId) {
  const [inkAnnotations, setInkAnnotations] = useState([])
  const [loading, setLoading] = useState(false)

  const loadInkAnnotations = useCallback(async () => {
    if (!paperId) {
      setInkAnnotations([])
      return
    }

    setLoading(true)
    try {
      const data = await apiFetch(`${INK_BASE}/${paperId}/ink-annotations`)
      setInkAnnotations(data?.ink_annotations || [])
    } catch {
      setInkAnnotations([])
    } finally {
      setLoading(false)
    }
  }, [paperId])

  const createInkAnnotation = useCallback(async ({
    pageNumber,
    color,
    opacity,
    strokeWidth,
    points,
  }) => {
    if (!paperId || !points?.length) return null

    const temporaryId = `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const optimistic = {
      id: temporaryId,
      page_number: pageNumber,
      color,
      opacity,
      stroke_width: strokeWidth,
      points,
      pending: true,
    }
    setInkAnnotations((prev) => [...prev, optimistic])

    try {
      const data = await apiFetch(`${INK_BASE}/${paperId}/ink-annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_number: pageNumber,
          color,
          opacity,
          stroke_width: strokeWidth,
          points,
        }),
      })
      if (data) {
        setInkAnnotations((prev) => prev.map((item) => item.id === temporaryId ? data : item))
      }
      return data
    } catch {
      setInkAnnotations((prev) => prev.map((item) =>
        item.id === temporaryId ? { ...item, pending: false, unsynced: true } : item,
      ))
      return null
    }
  }, [paperId])

  const deleteInkAnnotation = useCallback(async (inkId) => {
    if (!paperId || inkId == null) return null

    const snapshot = inkAnnotations
    setInkAnnotations((prev) => prev.filter((item) => item.id !== inkId))

    if (String(inkId).startsWith('pending:')) {
      return true
    }

    try {
      await apiFetch(`${INK_BASE}/${paperId}/ink-annotations/${inkId}`, { method: 'DELETE' })
      return true
    } catch {
      setInkAnnotations(snapshot)
      return null
    }
  }, [inkAnnotations, paperId])

  useEffect(() => {
    loadInkAnnotations()
  }, [loadInkAnnotations])

  return {
    inkAnnotations,
    loading,
    loadInkAnnotations,
    createInkAnnotation,
    deleteInkAnnotation,
  }
}
