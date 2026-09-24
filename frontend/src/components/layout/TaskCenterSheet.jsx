import { useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  LoaderCircle,
  RefreshCcw,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import {
  TASK_FILTERS,
  buildTaskFailureCopyText,
  canClearFinishedTasks,
  filterTaskItems,
  getTaskFilterCounts,
  isTaskArchivable,
  normalizeTaskSummary,
} from './taskCenterModel'

const TASK_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTaskTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return TASK_TIME_FORMATTER.format(parsed)
}

function getStatusIcon(statusGroup) {
  if (statusGroup === 'active') return LoaderCircle
  if (statusGroup === 'failed') return AlertCircle
  if (statusGroup === 'completed') return CheckCircle2
  return Clock3
}

function getTaskKindLabel(sourceKind = '') {
  if (sourceKind === 'full_translation') return '全文翻译'
  if (sourceKind === 'reading_brief') return '文献速读'
  if (sourceKind === 'ai_outline') return 'AI 目录'
  return '任务'
}

function getTaskStatusLine(item, queuePosition, busy) {
  if (busy) return '正在同步操作'
  if (item.status === 'queued') {
    return queuePosition ? `排队中 · 当前第 ${queuePosition} 位` : '排队中'
  }
  if (item.status_group === 'completed') {
    return item.stage_label || '已完成'
  }
  if (item.status_group === 'failed') {
    return item.stage_label || '需要处理'
  }
  return item.stage_label || item.subtitle || '后台处理中'
}

function fallbackCopyText(text) {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

export function TaskCenterSheet({
  actionBusyId = '',
  error = '',
  loading = false,
  onCancelTask,
  onClearCompletedTasks,
  onClearFinishedTasks,
  onDeleteTask,
  onOpenChange,
  onOpenTask,
  onRefresh,
  onRetryTask,
  open,
  payload,
}) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [copiedErrorId, setCopiedErrorId] = useState('')
  const [expandedErrorIds, setExpandedErrorIds] = useState(() => new Set())
  const summary = normalizeTaskSummary(payload?.summary)
  const items = Array.isArray(payload?.items) ? payload.items : []
  const hasItems = items.length > 0
  const hasActionBusy = Boolean(actionBusyId)
  const clearFinishedHandler = onClearFinishedTasks || onClearCompletedTasks
  const canClearFinished = canClearFinishedTasks(summary, { loading, hasActionBusy })
  const filteredItems = useMemo(() => filterTaskItems(items, activeFilter), [activeFilter, items])
  const filterCounts = getTaskFilterCounts(items, summary)
  const queuePositions = useMemo(() => {
    const queued = items
      .filter((item) => item.status === 'queued')
      .slice()
      .sort((left, right) => {
        const leftTime = new Date(left.created_at || left.updated_at || 0).getTime()
        const rightTime = new Date(right.created_at || right.updated_at || 0).getTime()
        return leftTime - rightTime
      })
    return queued.reduce((map, item, index) => {
      map.set(item.id, index + 1)
      return map
    }, new Map())
  }, [items])

  function toggleErrorDetail(itemId) {
    setExpandedErrorIds((previous) => {
      const next = new Set(previous)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  async function copyErrorMessage(item) {
    const text = buildTaskFailureCopyText(item).trim()
    if (!text) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        fallbackCopyText(text)
      }
      setCopiedErrorId(item.id)
      window.setTimeout(() => {
        setCopiedErrorId((current) => (current === item.id ? '' : current))
      }, 1400)
    } catch {
      fallbackCopyText(text)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="task-center-sheet" side="right">
        <SheetHeader className="task-center-sheet__header">
          <div className="task-center-sheet__hero">
            <div className="task-center-sheet__hero-copy">
              <span className="task-center-sheet__eyebrow">后台任务</span>
              <SheetTitle>任务中心</SheetTitle>
              <SheetDescription>后台任务会在这里显示实时状态。</SheetDescription>
            </div>
          </div>

          <div className="task-center-sheet__summary">
            <div className="task-center-sheet__summary-item is-active">
              <span>进行中</span>
              <strong>{summary.active_count}</strong>
            </div>
            <div className="task-center-sheet__summary-item is-failed">
              <span>异常</span>
              <strong>{summary.failed_count}</strong>
            </div>
            <div className="task-center-sheet__summary-item">
              <span>已完成</span>
              <strong>{summary.completed_count}</strong>
            </div>
            <button
              type="button"
              className="task-center-sheet__refresh"
              onClick={onRefresh}
              disabled={loading}
              aria-label="刷新任务"
              title="刷新任务"
            >
              <RefreshCcw size={14} className={loading ? 'is-spinning' : ''} />
            </button>
            <button
              type="button"
              className="task-center-sheet__refresh is-danger"
              onClick={clearFinishedHandler}
              disabled={!canClearFinished}
              aria-label="清理已结束任务"
              title="清理已结束任务"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="task-center-sheet__filters" role="tablist" aria-label="任务筛选">
            {TASK_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={activeFilter === filter.id ? 'is-active' : ''}
                onClick={() => setActiveFilter(filter.id)}
                role="tab"
                aria-selected={activeFilter === filter.id}
              >
                <span>{filter.label}</span>
                <strong>{filterCounts[filter.id] || 0}</strong>
              </button>
            ))}
          </div>
        </SheetHeader>

        <div className="task-center-sheet__body" aria-busy={loading}>
          {error && hasItems ? (
            <div className="task-center-sheet__notice is-error">
              <span>{error}</span>
              <button type="button" onClick={onRefresh}>
                重试
              </button>
            </div>
          ) : null}
          {loading && hasItems ? (
            <div className="task-center-sheet__notice">
              <span>正在同步最新任务...</span>
            </div>
          ) : null}
          {error && !hasItems ? (
            <div className="task-center-sheet__empty is-error">
              <AlertCircle size={18} />
              <strong>任务列表加载失败</strong>
              <span>{error}</span>
            </div>
          ) : loading && !hasItems ? (
            <div className="task-center-sheet__empty">
              <LoaderCircle size={18} className="is-spinning" />
              <strong>正在读取任务状态</strong>
              <span>后台队列会自动同步到这里。</span>
            </div>
          ) : hasItems ? (
            <div className="task-center-list">
              {filteredItems.length ? filteredItems.map((item) => {
                const StatusIcon = getStatusIcon(item.status_group)
                const progress = Math.max(0, Math.min(100, Number(item.progress_percent || 0)))
                const isActionable = item.action_kind && item.action_kind !== 'none'
                const isActionBusy = actionBusyId === item.id
                const hasFailureDetail = item.status_group === 'failed' && Boolean(item.error_message)
                const errorExpanded = expandedErrorIds.has(item.id)
                const queuePosition = queuePositions.get(item.id) || 0
                const statusLine = getTaskStatusLine(item, queuePosition, isActionBusy)
                const timeLabel = formatTaskTime(item.updated_at || item.created_at)
                return (
                  <article key={item.id} className={`task-center-item is-${item.status_group || 'idle'} is-status-${item.status || 'idle'}`}>
                    <div className="task-center-item__status" aria-hidden="true">
                      <StatusIcon size={16} className={item.status_group === 'active' ? 'is-spinning' : ''} />
                    </div>
                    <div className="task-center-item__main">
                      <div className="task-center-item__kindline">
                        <span className="task-center-item__kind">{getTaskKindLabel(item.source_kind)}</span>
                        <span className="task-center-item__state">{item.status_label || item.status || '任务'}</span>
                        {timeLabel ? <time>{timeLabel}</time> : null}
                      </div>
                      <strong className="task-center-item__title">{item.title || '未命名任务'}</strong>
                      <div className={hasFailureDetail ? 'task-center-item__status-line is-error' : 'task-center-item__status-line'}>
                        {statusLine}
                      </div>
                      <p className={hasFailureDetail ? 'task-center-item__message is-error' : 'task-center-item__message'}>
                        {hasFailureDetail ? item.error_message : item.subtitle || item.stage_label || '等待后台处理'}
                      </p>
                      {hasFailureDetail ? (
                        <div className="task-center-item__error-actions">
                          <button type="button" onClick={() => toggleErrorDetail(item.id)}>
                            {errorExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            <span>{errorExpanded ? '收起原因' : '展开原因'}</span>
                          </button>
                          <button type="button" onClick={() => void copyErrorMessage(item)}>
                            <Copy size={13} />
                            <span>{copiedErrorId === item.id ? '已复制' : '复制错误'}</span>
                          </button>
                        </div>
                      ) : null}
                      {hasFailureDetail && errorExpanded ? (
                        <pre className="task-center-item__error-detail">{item.error_message}</pre>
                      ) : null}
                      <div className="task-center-item__progress" aria-hidden="true">
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                    <div className="task-center-item__actions">
                      {item.can_retry ? (
                        <button
                          type="button"
                          className="task-center-item__command"
                          onClick={() => onRetryTask?.(item)}
                          disabled={hasActionBusy || loading}
                          aria-label="重试任务"
                          title="重试任务"
                        >
                          {isActionBusy ? <LoaderCircle size={14} className="is-spinning" /> : <RefreshCcw size={14} />}
                        </button>
                      ) : null}
                      {item.can_cancel ? (
                        <button
                          type="button"
                          className="task-center-item__command is-danger"
                          onClick={() => onCancelTask?.(item)}
                          disabled={hasActionBusy || loading}
                          aria-label="取消任务"
                          title="取消任务"
                        >
                          {isActionBusy ? <LoaderCircle size={14} className="is-spinning" /> : <XCircle size={14} />}
                        </button>
                      ) : null}
                      {isTaskArchivable(item) ? (
                        <button
                          type="button"
                          className="task-center-item__command is-danger"
                          onClick={() => onDeleteTask?.(item)}
                          disabled={hasActionBusy || loading}
                          aria-label="从任务中心移除"
                          title="从任务中心移除"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="task-center-item__open"
                        onClick={() => onOpenTask?.(item)}
                        disabled={!isActionable}
                        aria-label="打开任务"
                        title="打开任务"
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </article>
                )
              }) : (
                <div className="task-center-sheet__empty">
                  <Clock3 size={18} />
                  <strong>这个分类暂无任务</strong>
                  <span>切回全部可以查看当前保留的任务记录。</span>
                </div>
              )}
            </div>
          ) : (
            <div className="task-center-sheet__empty">
              <Activity size={18} />
              <strong>当前没有后台任务</strong>
              <span>新的全文翻译、文献速读和 AI 目录任务会出现在这里。</span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
