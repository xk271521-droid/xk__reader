import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ensurePaperReadingBrief,
  fetchPaperReadingBrief,
  refreshPaperReadingBrief,
  retryPaperReadingBrief,
} from '../services/paperReaderApi'
import { isPaperReadingBriefInProgress } from './paperReadingBriefState'

const POLL_INTERVAL_MS = 2500
const IDLE_BRIEF = Object.freeze({
  status: 'idle',
  stage: 'idle',
  progress: 0,
  brief: null,
  error_message: null,
  updated_at: null,
  model: '',
})

function getStateKey(userId, paperId) {
  if (!userId || !paperId) return ''
  return `${userId}:${paperId}`
}

export function usePaperReadingBrief(paperId, userId) {
  const [briefs, setBriefs] = useState({})
  const [requestEpoch, setRequestEpoch] = useState(0)
  const requestVersionRef = useRef(0)
  const automaticStartKeyRef = useRef('')
  const stateKey = getStateKey(userId, paperId)
  const brief = stateKey ? (briefs[stateKey] || IDLE_BRIEF) : IDLE_BRIEF

  const storeBrief = useCallback((key, nextBrief) => {
    if (!key) return
    setBriefs((current) => ({ ...current, [key]: nextBrief || IDLE_BRIEF }))
  }, [])

  useEffect(() => {
    if (!stateKey || !paperId) return undefined

    let disposed = false
    let pollTimer = null
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion

    async function loadBrief() {
      try {
        let payload = await fetchPaperReadingBrief(paperId)
        if (disposed || requestVersionRef.current !== requestVersion) return
        // First open creates exactly one durable brief.  All terminal states
        // (including failed) are thereafter read from cache until the user
        // explicitly chooses Retry.
        if (payload?.status === 'idle' && automaticStartKeyRef.current !== stateKey) {
          automaticStartKeyRef.current = stateKey
          payload = await ensurePaperReadingBrief(paperId)
          if (disposed || requestVersionRef.current !== requestVersion) return
        }
        storeBrief(stateKey, payload)
        if (isPaperReadingBriefInProgress(payload?.status)) {
          pollTimer = window.setTimeout(() => {
            void loadBrief()
          }, POLL_INTERVAL_MS)
        }
      } catch (error) {
        if (disposed || requestVersionRef.current !== requestVersion) return
        storeBrief(stateKey, {
          ...IDLE_BRIEF,
          status: 'failed',
          stage: 'failed',
          error_message: error?.message || '文献速读加载失败，请重试。',
        })
      }
    }

    // The first open starts one cached full-paper brief. Later opens are GETs
    // only because the API returns the durable completed/failed task record.
    void loadBrief()
    return () => {
      disposed = true
      if (pollTimer) window.clearTimeout(pollTimer)
    }
  }, [paperId, requestEpoch, stateKey, storeBrief])

  const retry = useCallback(async () => {
    if (!stateKey || !paperId) return IDLE_BRIEF
    const payload = await retryPaperReadingBrief(paperId)
    storeBrief(stateKey, payload)
    // Re-enter the effect so a retry that returns queued/running resumes polling.
    setRequestEpoch((current) => current + 1)
    return payload
  }, [paperId, stateKey, storeBrief])

  const refresh = useCallback(async () => {
    if (!stateKey || !paperId) return IDLE_BRIEF
    const payload = await refreshPaperReadingBrief(paperId)
    storeBrief(stateKey, payload)
    // A refresh transitions the cached task back to queued/running. Bump the
    // effect epoch so polling starts even when the panel was already complete.
    setRequestEpoch((current) => current + 1)
    return payload
  }, [paperId, stateKey, storeBrief])

  return { brief, retry, refresh }
}
