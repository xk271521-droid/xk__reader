import { useCallback, useEffect, useRef, useState } from 'react'
import { createNotebookFromTemplate } from '../components/reader/noteTree'
import { getStoredAuthToken } from '../services/authApi'

const NOTES_BACKUP_PREFIX = 'paper-notes-draft:v1'

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

function getBackupKey(paperId) {
  return `${NOTES_BACKUP_PREFIX}:${paperId}`
}

function readDraftBackup(paperId) {
  if (!paperId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getBackupKey(paperId))
    if (!raw) return null
    const backup = JSON.parse(raw)
    return Array.isArray(backup?.notebooks) ? backup : null
  } catch {
    return null
  }
}

function writeDraftBackup(paperId, notebooks) {
  if (!paperId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      getBackupKey(paperId),
      JSON.stringify({
        paperId,
        notebooks: Array.isArray(notebooks) ? notebooks : [],
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // localStorage may be unavailable or full; server save still remains the primary path.
  }
}

function clearDraftBackup(paperId) {
  if (!paperId || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getBackupKey(paperId))
  } catch {
    // ignore
  }
}

async function saveNotebookSnapshot(paperId, draftNotebooks) {
  return apiFetch(`/api/papers/${paperId}/notebooks/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebooks: draftNotebooks || [] }),
  })
}

export function usePaperNotes(paperId) {
  const [notebooks, setNotebookState] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const paperIdRef = useRef(paperId)
  const notebooksRef = useRef([])
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const saveStatusRef = useRef('idle')
  const autoSaveTimerRef = useRef(null)
  const saveRequestRef = useRef(0)
  const saveInFlightCountRef = useRef(0)

  const updateSaveStatus = useCallback((status) => {
    saveStatusRef.current = status
    setSaveStatus(status)
  }, [])

  const setLoadedNotebooks = useCallback((nextNotebooks) => {
    const normalized = Array.isArray(nextNotebooks) ? nextNotebooks : []
    notebooksRef.current = normalized
    setNotebookState(normalized)
  }, [])

  const markDirty = useCallback((nextNotebooks, targetPaperId = paperIdRef.current) => {
    if (!targetPaperId) return
    const normalized = Array.isArray(nextNotebooks) ? nextNotebooks : []
    notebooksRef.current = normalized
    dirtyRef.current = true
    setHasUnsavedChanges(true)
    setSaveError('')
    if (!savingRef.current) updateSaveStatus('dirty')
    writeDraftBackup(targetPaperId, normalized)
  }, [updateSaveStatus])

  const setNotebooks = useCallback((updater) => {
    setNotebookState((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      const normalized = Array.isArray(next) ? next : []
      markDirty(normalized)
      return normalized
    })
  }, [markDirty])

  const loadNotebooks = useCallback(async () => {
    if (!paperId) {
      setLoadedNotebooks([])
      dirtyRef.current = false
      setHasUnsavedChanges(false)
      setSaveError('')
      updateSaveStatus('idle')
      return
    }

    setLoading(true)
    try {
      const data = await apiFetch(`/api/papers/${paperId}/notebooks`)
      const backup = readDraftBackup(paperId)
      if (backup?.notebooks) {
        setLoadedNotebooks(backup.notebooks)
        dirtyRef.current = true
        setHasUnsavedChanges(true)
        setSaveError('')
        updateSaveStatus('dirty')
      } else {
        setLoadedNotebooks(data?.notebooks || [])
        dirtyRef.current = false
        setHasUnsavedChanges(false)
        setSaveError('')
        updateSaveStatus('saved')
      }
    } catch (error) {
      const backup = readDraftBackup(paperId)
      if (backup?.notebooks) {
        setLoadedNotebooks(backup.notebooks)
        dirtyRef.current = true
        setHasUnsavedChanges(true)
        setSaveError(error?.message || '笔记加载失败，已恢复本地备份')
        updateSaveStatus('error')
      } else {
        setLoadedNotebooks([])
        dirtyRef.current = false
        setHasUnsavedChanges(false)
        setSaveError(error?.message || '笔记加载失败')
        updateSaveStatus('error')
      }
    } finally {
      setLoading(false)
    }
  }, [paperId, setLoadedNotebooks, updateSaveStatus])

  const saveNotebooks = useCallback(async (draftNotebooks) => {
    const targetPaperId = paperIdRef.current
    if (!targetPaperId) return null
    const snapshot = Array.isArray(draftNotebooks) ? draftNotebooks : notebooksRef.current
    const requestId = saveRequestRef.current + 1
    saveRequestRef.current = requestId

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    saveInFlightCountRef.current += 1
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    updateSaveStatus('saving')
    try {
      const data = await saveNotebookSnapshot(targetPaperId, snapshot)
      const savedNotebooks = data?.notebooks || []

      if (requestId !== saveRequestRef.current) return null

      if (notebooksRef.current !== snapshot) {
        dirtyRef.current = true
        setHasUnsavedChanges(true)
        writeDraftBackup(targetPaperId, notebooksRef.current)
        updateSaveStatus('dirty')
        return null
      }

      setLoadedNotebooks(savedNotebooks)
      dirtyRef.current = false
      setHasUnsavedChanges(false)
      clearDraftBackup(targetPaperId)
      updateSaveStatus('saved')
      return savedNotebooks
    } catch (error) {
      if (requestId !== saveRequestRef.current) return null
      dirtyRef.current = true
      setHasUnsavedChanges(true)
      setSaveError(error?.message || '保存失败，请重试')
      updateSaveStatus('error')
      writeDraftBackup(targetPaperId, snapshot)
      return null
    } finally {
      saveInFlightCountRef.current = Math.max(0, saveInFlightCountRef.current - 1)
      if (saveInFlightCountRef.current === 0) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }, [setLoadedNotebooks, updateSaveStatus])

  const retrySaveNotebooks = useCallback(() => (
    saveNotebooks(notebooksRef.current)
  ), [saveNotebooks])

  const flushUnsavedNotes = useCallback(async () => {
    const targetPaperId = paperIdRef.current
    if (!targetPaperId || (!dirtyRef.current && saveStatusRef.current !== 'error')) return true
    const saved = await saveNotebooks(notebooksRef.current)
    return Boolean(saved)
  }, [saveNotebooks])

  const createNotebookDraft = useCallback((kind = 'blank') => {
    setNotebooks((previous) => {
      const sortOrder = previous.length
      const notebook = createNotebookFromTemplate(kind, sortOrder)
      return [...previous, notebook]
    })
  }, [setNotebooks])

  useEffect(() => {
    paperIdRef.current = paperId
  }, [paperId])

  useEffect(() => {
    const targetPaperId = paperId
    return () => {
      if (!targetPaperId || !dirtyRef.current) return
      const snapshot = notebooksRef.current
      writeDraftBackup(targetPaperId, snapshot)
      saveNotebookSnapshot(targetPaperId, snapshot)
        .then(() => {
          clearDraftBackup(targetPaperId)
        })
        .catch(() => {
          writeDraftBackup(targetPaperId, snapshot)
        })
    }
  }, [paperId])

  useEffect(() => {
    if (!paperId || !hasUnsavedChanges || saving) return undefined
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      saveNotebooks(notebooksRef.current)
    }, 3000)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [paperId, hasUnsavedChanges, saving, notebooks, saveNotebooks])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!paperIdRef.current || (!dirtyRef.current && saveStatusRef.current !== 'error')) return
      writeDraftBackup(paperIdRef.current, notebooksRef.current)
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    loadNotebooks()
  }, [loadNotebooks])

  return {
    notebooks,
    loading,
    saving,
    saveStatus,
    saveError,
    hasUnsavedChanges,
    setNotebooks,
    loadNotebooks,
    saveNotebooks,
    retrySaveNotebooks,
    flushUnsavedNotes,
    createNotebookDraft,
  }
}
