import { useCallback, useEffect, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'

const ANNOTATIONS_BASE = '/api/papers'

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

export function useAnnotations(paperId) {
  const [annotations, setAnnotations] = useState([])
  const [loading, setLoading] = useState(false)

  const loadAnnotations = useCallback(async () => {
    if (!paperId) {
      setAnnotations([])
      return
    }

    setLoading(true)
    try {
      const data = await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations`)
      setAnnotations(data?.annotations || [])
    } catch {
      // Annotation loading should not block opening the PDF.
    } finally {
      setLoading(false)
    }
  }, [paperId])

  const createAnnotation = useCallback(async ({
    pageNumber,
    startChar,
    endChar,
    quoteText,
    rects,
    type,
    color,
    source = 'native',
    geometryVersion = 'v2',
  }) => {
    if (!paperId) return null

    try {
      const data = await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_number: pageNumber,
          start_char: startChar,
          end_char: endChar,
          quote_text: quoteText,
          rects: rects || [],
          type,
          color,
          source,
          geometry_version: geometryVersion,
        }),
      })
      if (data) setAnnotations((prev) => [...prev, data])
      return data
    } catch {
      return null
    }
  }, [paperId])

  const eraseAnnotationRange = useCallback(async ({ pageNumber, startChar, endChar }) => {
    if (!paperId) return null

    try {
      const data = await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations/erase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_number: pageNumber,
          start_char: startChar,
          end_char: endChar,
        }),
      })
      if (data?.annotations) setAnnotations(data.annotations)
      return data
    } catch {
      return null
    }
  }, [paperId])

  const restoreAnnotations = useCallback(async (snapshot = []) => {
    if (!paperId) return null

    try {
      const data = await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: snapshot }),
      })
      if (data?.annotations) setAnnotations(data.annotations)
      return data
    } catch {
      return null
    }
  }, [paperId])

  const deleteAnnotation = useCallback(async (annotationId) => {
    if (!paperId) return null

    try {
      await apiFetch(`${ANNOTATIONS_BASE}/${paperId}/annotations/${annotationId}`, { method: 'DELETE' })
      setAnnotations((prev) => prev.filter((annotation) => annotation.id !== annotationId))
      return true
    } catch {
      return null
    }
  }, [paperId])

  useEffect(() => {
    loadAnnotations()
  }, [loadAnnotations])

  return {
    annotations,
    loading,
    loadAnnotations,
    createAnnotation,
    deleteAnnotation,
    eraseAnnotationRange,
    restoreAnnotations,
  }
}
