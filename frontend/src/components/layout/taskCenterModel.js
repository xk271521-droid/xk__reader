export const TASK_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '进行中' },
  { id: 'failed', label: '异常' },
  { id: 'completed', label: '已完成' },
]

export function normalizeTaskSummary(summary) {
  return {
    active_count: Number(summary?.active_count || 0),
    failed_count: Number(summary?.failed_count || 0),
    completed_count: Number(summary?.completed_count || 0),
    total_count: Number(summary?.total_count || 0),
    attention_count: Number(summary?.attention_count || 0),
  }
}

export function filterTaskItems(items = [], activeFilter = 'all') {
  const list = Array.isArray(items) ? items : []
  if (!activeFilter || activeFilter === 'all') return list
  return list.filter((item) => item.status_group === activeFilter)
}

export function getTaskFilterCounts(items = [], summary = {}) {
  const normalized = normalizeTaskSummary(summary)
  return {
    all: Array.isArray(items) ? items.length : 0,
    active: normalized.active_count,
    failed: normalized.failed_count,
    completed: normalized.completed_count,
  }
}

export function isTaskArchivable(item = {}) {
  return item?.status_group === 'failed' || item?.status_group === 'completed'
}

export function getFinishedTaskCount(summary = {}) {
  const normalized = normalizeTaskSummary(summary)
  return normalized.failed_count + normalized.completed_count
}

export function canClearFinishedTasks(summary = {}, options = {}) {
  return !options.loading && !options.hasActionBusy && getFinishedTaskCount(summary) > 0
}

export function buildTaskFailureCopyText(item = {}) {
  const parts = [
    item.title ? `任务：${item.title}` : '',
    item.status_label || item.status ? `状态：${item.status_label || item.status}` : '',
    item.stage_label ? `阶段：${item.stage_label}` : '',
    item.error_message ? `错误：${item.error_message}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}
