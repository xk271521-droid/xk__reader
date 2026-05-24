import { useCallback, useEffect, useState } from 'react'
import { getStoredAuthToken } from '../services/authApi'

const SHAPE_BASE = '/api/papers'

function createTempShapeId() {
  return `temp-shape-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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

export function useShapeAnnotations(paperId) {
  const [shapeAnnotations, setShapeAnnotations] = useState([])
  const [loading, setLoading] = useState(false)

  const loadShapeAnnotations = useCallback(async () => {
    if (!paperId) {
      setShapeAnnotations([])
      return
    }

    setLoading(true)
    try {
      const data = await apiFetch(`${SHAPE_BASE}/${paperId}/shape-annotations`)
      setShapeAnnotations(data?.shape_annotations || [])
    } catch {
      setShapeAnnotations([])
    } finally {
      setLoading(false)
    }
  }, [paperId])

  const createShapeAnnotation = useCallback(async ({
    pageNumber,
    type,
    x,
    y,
    width,
    height,
    content = null,
    style = {},
    extra = {},
    sortOrder = 0,
  }) => {
    if (!paperId) return null
    const tempId = createTempShapeId()
    const optimisticAnnotation = {
      id: tempId,
      page_number: pageNumber,
      type,
      x,
      y,
      width,
      height,
      content,
      style,
      extra,
      sort_order: sortOrder,
      is_pending: true,
    }
    setShapeAnnotations((prev) => [...prev, optimisticAnnotation])

    try {
      const data = await apiFetch(`${SHAPE_BASE}/${paperId}/shape-annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_number: pageNumber,
          type,
          x,
          y,
          width,
          height,
          content,
          style,
          extra,
          sort_order: sortOrder,
        }),
      })
      if (data) {
        setShapeAnnotations((prev) => prev.map((item) => item.id === tempId ? data : item))
      } else {
        setShapeAnnotations((prev) => prev.filter((item) => item.id !== tempId))
      }
      return data
    } catch {
      setShapeAnnotations((prev) => prev.filter((item) => item.id !== tempId))
      return null
    }
  }, [paperId])

  const updateShapeAnnotation = useCallback(async (annotationId, payload = {}) => {
    if (!paperId || annotationId == null) return null

    let previousAnnotation = null
    setShapeAnnotations((prev) => prev.map((item) => {
      if (item.id !== annotationId) return item
      previousAnnotation = item
      return {
        ...item,
        ...payload,
        extra: payload.extra != null
          ? payload.extra
          : item.extra,
        style: payload.style != null
          ? payload.style
          : item.style,
      }
    }))

    try {
      const data = await apiFetch(`${SHAPE_BASE}/${paperId}/shape-annotations/${annotationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (data) {
        setShapeAnnotations((prev) => prev.map((item) => item.id === annotationId ? data : item))
      }
      return data
    } catch {
      if (previousAnnotation) {
        setShapeAnnotations((prev) => prev.map((item) =>
          item.id === annotationId ? previousAnnotation : item,
        ))
      }
      return null
    }
  }, [paperId])

  const deleteShapeAnnotation = useCallback(async (annotationId) => {
    if (!paperId || annotationId == null) return null

    try {
      await apiFetch(`${SHAPE_BASE}/${paperId}/shape-annotations/${annotationId}`, { method: 'DELETE' })
      setShapeAnnotations((prev) => prev.filter((item) => item.id !== annotationId))
      return true
    } catch {
      return null
    }
  }, [paperId])

  useEffect(() => {
    loadShapeAnnotations()
  }, [loadShapeAnnotations])

  return {
    shapeAnnotations,
    loading,
    loadShapeAnnotations,
    createShapeAnnotation,
    updateShapeAnnotation,
    deleteShapeAnnotation,
  }
}
