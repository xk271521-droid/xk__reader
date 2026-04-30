import { useEffect, useState } from 'react'
import { fetchBackendHealth } from '../services/paperReaderApi'

const READY_WITH_AI = '后端已连接 · AI 可用'
const READY_WITH_MOCK = '后端已连接 · 本地模式'
const UNREACHABLE = '后端未连接'
const CHECKING = '正在连接'

export function useBackendStatus() {
  const [status, setStatus] = useState(CHECKING)

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      try {
        const data = await fetchBackendHealth()
        if (!cancelled) {
          setStatus(data.ai_enabled ? READY_WITH_AI : READY_WITH_MOCK)
        }
      } catch {
        if (!cancelled) {
          setStatus(UNREACHABLE)
        }
      }
    }

    loadStatus()

    return () => {
      cancelled = true
    }
  }, [])

  return status
}
