export const DEFAULT_API_ERROR_MESSAGE = '请求失败，请稍后重试。'

export function resolveApiErrorMessage(payload, fallback = DEFAULT_API_ERROR_MESSAGE) {
  const detail = payload?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (typeof detail?.message === 'string' && detail.message.trim()) return detail.message.trim()
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim()
  return fallback
}

export function toUserMessage(error, fallback = DEFAULT_API_ERROR_MESSAGE) {
  const status = Number(error?.status || 0)
  if (status === 401) return '登录状态已过期，请重新登录。'
  if (status === 403) return '当前账号没有执行这个操作的权限。'
  if (status === 404) return '要处理的内容不存在或已被删除。'
  if (status === 409) return error?.message || '当前状态暂时不能执行这个操作，请刷新后再试。'
  if (status >= 500) return '服务器刚才处理失败，请稍后重试或查看任务中心状态。'

  const message = String(error?.message || '').trim()
  if (!message) return fallback
  if (/request failed|failed to fetch|networkerror|load failed/i.test(message)) {
    return '网络请求失败，请检查后端服务是否在线后再试。'
  }
  return message
}
