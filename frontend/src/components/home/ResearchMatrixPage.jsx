import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  PenSquare,
  Plus,
  RefreshCcw,
  RotateCcw,
  ScrollText,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  createResearchMatrixRun,
  deleteResearchMatrixRun,
  fetchPaperSummaryStatus,
  fetchResearchMatrixRun,
  fetchResearchMatrixRuns,
  refreshResearchMatrixRun,
  retryPendingResearchMatrixRun,
  updateResearchMatrixRunPaper,
} from '../../services/paperReaderApi'

const FIELD_CONFIG = [
  { key: 'research_question', label: '研究问题', scope: 'paper', multiline: true },
  { key: 'core_metrics', label: '核心变量/指标', scope: 'paper', multiline: true, multiValue: true },
  { key: 'method_route', label: '方法路线', scope: 'paper', multiline: true },
  { key: 'data_sample', label: '数据与样本', scope: 'paper', multiline: true },
  { key: 'main_findings', label: '核心发现', scope: 'paper', multiline: true },
  { key: 'innovations', label: '创新点', scope: 'paper', multiline: true, multiValue: true },
  { key: 'limitations', label: '局限与风险', scope: 'paper', multiline: true, multiValue: true },
  { key: 'review_role', label: '综述定位', scope: 'run', multiline: true },
  { key: 'comparison_tags', label: '可对比标签', scope: 'paper', multiline: true, multiValue: true },
]

const FIELD_MAP = Object.fromEntries(FIELD_CONFIG.map((field) => [field.key, field]))
const RUNNING_STATUSES = new Set(['queued', 'running'])

const REVIEW_STATUS_LABELS = {
  idle: '待生成',
  running: '生成中',
  generated: '已综述',
  failed: '生成失败',
}

const RUN_STATUS_LABELS = {
  queued: '后台排队中',
  running: '生成中',
  completed: '已完成',
  failed: '生成失败',
}

function formatDate(value) {
  if (!value) return '--'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  } catch {
    return '--'
  }
}

function getPaperTitle(paper) {
  return paper?.title || paper?.fileName || paper?.file_name || '未命名文献'
}

function getPaperAuthor(paper) {
  return paper?.metadata?.author || paper?.author || ''
}

function getFolderName(paper, folders, uncategorizedFolderId) {
  if (paper?.folderName) return paper.folderName
  if (String(paper?.folderId) === String(uncategorizedFolderId)) return '未分类'
  return folders.find((folder) => String(folder.id) === String(paper?.folderId))?.name || '未分类'
}

function triggerDownload(content, fileName, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildMatrixTableHtml(run) {
  const rows = run?.matrix?.rows || []
  const fields = (run?.matrix?.fields || FIELD_CONFIG).map((field) => {
    if (Array.isArray(field)) {
      return { key: field[0], label: field[1] }
    }
    return field
  })
  const head = ['论文标题', ...fields.map((field) => field.label)]
  const body = rows.map((row) => [
    row.title,
    ...fields.map((field) => row[field.key] || ''),
  ])
  return `
    <table>
      <thead><tr>${head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>
      <tbody>
        ${body.map((line) => `<tr>${line.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `
}

function exportRunExcel(run) {
  if (!run) return
  const html = `
    <html><head><meta charset="utf-8" /></head><body>
      <h1>${escapeHtml(run.title || '当前批次')}</h1>
      ${buildMatrixTableHtml(run)}
    </body></html>
  `
  triggerDownload(html, `${run.title || '文献矩阵'}.xls`, 'application/vnd.ms-excel;charset=utf-8')
}

function exportRunWord(run) {
  if (!run) return
  const drafts = run.drafts || {}
  const draftHtml = Object.entries(drafts).map(([, draft]) => `
    <h2>${escapeHtml(draft.title || '')}</h2>
    <p>${escapeHtml(draft.content || '')}</p>
    <p><strong>来源：</strong>${escapeHtml((draft.source_titles || []).join('；'))}</p>
  `).join('')
  const html = `
    <html><head><meta charset="utf-8" />
    <style>
      body { font-family: "Microsoft YaHei", sans-serif; color: #172033; }
      h1 { color: #0f3b82; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #dbe5f5; padding: 8px; vertical-align: top; }
      th { background: #eaf2ff; }
    </style></head><body>
      <h1>${escapeHtml(run.title || '当前批次')}</h1>
      ${draftHtml}
      <h2>文献矩阵</h2>
      ${buildMatrixTableHtml(run)}
    </body></html>
  `
  triggerDownload(html, `${run.title || '文献矩阵'}.doc`, 'application/msword;charset=utf-8')
}

function sortMissingFirst(a, b) {
  if (a.reviewStatus === b.reviewStatus) return 0
  if (a.reviewStatus !== 'generated' && b.reviewStatus === 'generated') return -1
  if (a.reviewStatus === 'generated' && b.reviewStatus !== 'generated') return 1
  if (a.reviewStatus === 'running' && b.reviewStatus !== 'running') return -1
  if (a.reviewStatus !== 'running' && b.reviewStatus === 'running') return 1
  return 0
}

function buildSelectablePapers(papers, folders, uncategorizedFolderId, statuses) {
  return papers.map((paper) => {
    const paperId = paper.id
    const status = statuses.get(paperId) || { status: 'idle', summary: null, error_message: '' }
    const reviewStatus = status.status || 'idle'
    return {
      id: paperId,
      title: getPaperTitle(paper),
      author: getPaperAuthor(paper),
      folderName: getFolderName(paper, folders, uncategorizedFolderId),
      reviewStatus,
      reviewReady: reviewStatus === 'generated',
      reviewLabel: REVIEW_STATUS_LABELS[reviewStatus] || REVIEW_STATUS_LABELS.idle,
    }
  }).sort(sortMissingFirst)
}

function buildPreviewPosition(event) {
  const previewWidth = 420
  const previewHeight = 240
  const gutter = 20
  const offset = 18
  const viewportWidth = window.innerWidth || 1440
  const viewportHeight = window.innerHeight || 900

  let left = event.clientX + offset
  let top = event.clientY + offset

  if (left + previewWidth > viewportWidth - gutter) {
    left = Math.max(gutter, event.clientX - previewWidth - offset)
  }

  if (top + previewHeight > viewportHeight - gutter) {
    top = Math.max(gutter, event.clientY - previewHeight - offset)
  }

  return { left, top }
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || !fields.length) {
    return FIELD_CONFIG
  }
  return fields.map((field) => {
    if (Array.isArray(field)) {
      return { ...(FIELD_MAP[field[0]] || {}), key: field[0], label: field[1] }
    }
    const existing = FIELD_MAP[field.key] || {}
    return { ...existing, ...field, key: field.key, label: field.label || existing.label || field.key }
  })
}

function CircleProgress({ value = 0, label = '', status = 'completed' }) {
  const radius = 12
  const circumference = 2 * Math.PI * radius
  const bounded = Math.max(0, Math.min(100, Number(value) || 0))
  const dashOffset = circumference - ((bounded / 100) * circumference)
  const statusClass = status === 'failed' ? ' is-failed' : status === 'completed' ? ' is-completed' : ' is-running'
  return (
    <span className={`matrix-progress-ring${statusClass}`} aria-label={label || `${bounded}%`}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle className="matrix-progress-ring__track" cx="16" cy="16" r={radius} />
        <circle
          className="matrix-progress-ring__value"
          cx="16"
          cy="16"
          r={radius}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: dashOffset,
          }}
        />
      </svg>
      <span>{status === 'failed' ? '!' : Math.round(bounded)}</span>
    </span>
  )
}

function MatrixRunRail({
  activeRunId,
  collapsed,
  menuOpenId,
  runs,
  onCreateNew,
  onDeleteRun,
  onOpenRunPapers,
  onRefreshRun,
  onRetryRun,
  onSelectRun,
  onToggleCollapsed,
  onToggleMenu,
}) {
  return (
    <aside className={`matrix-run-rail${collapsed ? ' is-collapsed' : ''}`}>
      <div className="matrix-run-rail__top">
        <button type="button" className="matrix-run-rail__icon" onClick={onToggleCollapsed} title={collapsed ? '展开历史' : '收起历史'}>
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
        {!collapsed ? <strong>历史批次</strong> : null}
        <button type="button" className="matrix-run-rail__icon" onClick={onCreateNew} title="新建矩阵">
          <Plus />
        </button>
      </div>

      <div className="matrix-run-rail__list">
        {runs.length ? runs.map((run) => {
          const isActive = activeRunId === run.id
          const menuOpen = menuOpenId === run.id
          const isRunning = RUNNING_STATUSES.has(run.status)
          const isFailed = run.status === 'failed'
          return (
            <div key={run.id} className={`matrix-run-card${isActive ? ' is-active' : ''}`}>
              <button
                type="button"
                className="matrix-run-card__main"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelectRun(run.id)}
                title={run.title}
              >
                <span className={`matrix-run-card__dot${run.has_updates ? ' has-update' : ''}${isRunning ? ' is-running' : ''}${isFailed ? ' is-failed' : ''}`} />
                {!collapsed ? (
                  <span className="matrix-run-card__content">
                    <span className="matrix-run-card__title-row">
                      <span className="matrix-run-card__title">{run.title}</span>
                      {isRunning || isFailed ? (
                        <CircleProgress
                          value={run.progress_percent}
                          status={run.status}
                          label={`${run.ready_count || 0}/${run.total_count || run.paper_count || 0}`}
                        />
                      ) : null}
                    </span>
                    <span className="matrix-run-card__meta">
                      {run.paper_count} 篇 · {formatDate(run.created_at)}
                    </span>
                    {isRunning || isFailed ? (
                      <span className={`matrix-run-card__status is-${run.status}`}>
                        {run.stage_label || RUN_STATUS_LABELS[run.status] || run.status}
                        {run.total_count ? ` · ${run.ready_count || 0}/${run.total_count}` : ''}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
              {!collapsed ? (
                <div className="matrix-run-card__tools">
                  <button
                    type="button"
                    className="matrix-run-rail__icon matrix-run-rail__icon--mini"
                    title="更多操作"
                    aria-expanded={menuOpen}
                    onClick={(event) => onToggleMenu(run.id, event)}
                  >
                    <MoreHorizontal />
                  </button>
                  {menuOpen ? (
                    <div className="matrix-run-card__menu">
                      <button type="button" onClick={() => onOpenRunPapers(run.id)}>
                        <Eye size={14} />
                        <span>查看论文</span>
                      </button>
                      {run.status === 'failed' ? (
                        <button type="button" onClick={() => onRetryRun(run.id)}>
                          <RotateCcw size={14} />
                          <span>继续补齐</span>
                        </button>
                      ) : null}
                      {run.has_updates ? (
                        <button type="button" onClick={() => onRefreshRun(run.id)}>
                          <RefreshCcw size={14} />
                          <span>刷新新版</span>
                        </button>
                      ) : null}
                      <button type="button" className="is-danger" onClick={() => onDeleteRun(run.id)}>
                        <Trash2 size={14} />
                        <span>删除</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        }) : (
          <div className="matrix-run-rail__empty">
            {!collapsed ? <span>还没有矩阵记录</span> : null}
          </div>
        )}
      </div>
    </aside>
  )
}

function MatrixContentHeader({
  activeTab,
  currentRun,
  exportMenuOpen,
  onChangeTab,
  onExport,
  onToggleExportMenu,
}) {
  const exportDisabled = !currentRun || currentRun.status !== 'completed'
  return (
    <header className="matrix-content-header">
      <div className="matrix-content-tabs" role="tablist" aria-label="当前批次内容切换">
        <button
          type="button"
          className={`matrix-content-tab${activeTab === 'matrix' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'matrix'}
          onClick={() => onChangeTab('matrix')}
        >
          <Columns3 size={15} />
          <span>文献矩阵</span>
        </button>
        <button
          type="button"
          className={`matrix-content-tab${activeTab === 'drafts' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'drafts'}
          onClick={() => onChangeTab('drafts')}
        >
          <ScrollText size={15} />
          <span>综述草稿</span>
        </button>
      </div>
      <div className="matrix-content-header__actions">
        <span className="matrix-content-header__meta">
          {currentRun
            ? `${currentRun.paper_count || 0} 篇 · ${currentRun.status === 'completed' ? formatDate(currentRun.updated_at || currentRun.created_at) : (currentRun.stage_label || RUN_STATUS_LABELS[currentRun.status] || currentRun.status)}`
            : '未选择批次'}
        </span>
        <div className="matrix-action-popover">
          <button
            type="button"
            className="matrix-run-rail__icon"
            title="导出"
            aria-expanded={exportMenuOpen}
            disabled={exportDisabled}
            onClick={onToggleExportMenu}
          >
            <Download />
          </button>
          {exportMenuOpen && !exportDisabled ? (
            <div className="matrix-run-card__menu matrix-run-card__menu--right">
              <button type="button" onClick={() => onExport('excel')}>
                <FileSpreadsheet size={14} />
                <span>Excel</span>
              </button>
              <button type="button" onClick={() => onExport('word')}>
                <FileText size={14} />
                <span>Word</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function RunPapersPanel({ open, run, onClose }) {
  if (!open || !run) return null
  return (
    <div className="matrix-dialog" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="matrix-dialog__panel matrix-dialog__panel--compact" role="dialog" aria-modal="true" aria-label="查看本批次论文">
        <header className="matrix-dialog__header">
          <div>
            <strong>本批次论文</strong>
            <p>{run.paper_count || 0} 篇论文</p>
          </div>
          <button type="button" className="matrix-run-rail__icon" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </header>
        <div className="matrix-run-paper-list">
          {(run.papers || []).map((item) => (
            <article key={item.paper_id} className="matrix-run-paper-item">
              <div>
                <strong title={item.title}>{item.title}</strong>
                <small>{item.folder_name || '未分类'}</small>
                {item.review_role ? <small className="matrix-run-paper-item__note">综述定位：{item.review_role}</small> : null}
              </div>
              <span className={`matrix-run-paper-item__status is-${item.summary_status || 'idle'}`}>
                {REVIEW_STATUS_LABELS[item.summary_status] || '待补齐'}
              </span>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function MatrixCreateDialog({
  busy,
  folders,
  open,
  papers,
  searchTerm,
  selectedFolderId,
  selectedIds,
  uncategorizedFolderId,
  onClose,
  onConfirm,
  onFolderChange,
  onSearchChange,
  onTogglePaper,
  onToggleVisible,
}) {
  const visiblePapers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()
    return papers.filter((paper) => {
      if (selectedFolderId !== 'all' && String(paper.folderId) !== String(selectedFolderId)) return false
      if (!keyword) return true
      return [paper.title, paper.author, paper.folderName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [papers, searchTerm, selectedFolderId])

  const allVisibleSelected = visiblePapers.length > 0 && visiblePapers.every((paper) => selectedIds.has(paper.id))
  const missingCount = visiblePapers.filter((paper) => selectedIds.has(paper.id) && !paper.reviewReady).length

  if (!open) return null

  return (
    <div className="matrix-dialog" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="matrix-dialog__panel" role="dialog" aria-modal="true" aria-label="选择论文生成矩阵">
        <header className="matrix-dialog__header">
          <div>
            <strong>选择论文生成矩阵</strong>
            <p>确认后会立即创建批次，缺少单篇综述卡片的论文会在后台继续生成，你可以先去处理其他事。</p>
          </div>
          <button type="button" className="matrix-run-rail__icon" onClick={onClose} disabled={busy} aria-label="关闭">
            <X />
          </button>
        </header>

        <div className="matrix-dialog__filters">
          <label className="matrix-search">
            <Search />
            <input value={searchTerm} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索标题、作者、分类" />
          </label>
          <select value={selectedFolderId} onChange={(event) => onFolderChange(event.target.value)}>
            <option value="all">全部分类</option>
            <option value={uncategorizedFolderId}>未分类</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <button type="button" className="matrix-secondary-button" onClick={() => onToggleVisible(visiblePapers)} disabled={busy}>
            {allVisibleSelected ? '取消当前筛选' : '全选当前筛选'}
          </button>
        </div>

        <div className="matrix-dialog__meta">
          <span>已选 {selectedIds.size}/50 篇</span>
          {missingCount ? <span>{missingCount} 篇还缺综述，创建后会在后台继续补齐</span> : <span>所选论文都已有可复用的综述卡片</span>}
        </div>

        <div className="matrix-paper-pick-list matrix-paper-pick-list--dialog">
          {visiblePapers.slice(0, 120).map((paper) => {
            const disabled = !selectedIds.has(paper.id) && selectedIds.size >= 50
            return (
              <label key={paper.id} className={`matrix-paper-pick${selectedIds.has(paper.id) ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(paper.id)}
                  disabled={disabled || busy}
                  onChange={() => onTogglePaper(paper.id)}
                />
                <span>
                  <strong>{paper.title}</strong>
                  <small>{paper.folderName}{paper.author ? ` · ${paper.author}` : ''}</small>
                  <em className={`matrix-paper-pick__status is-${paper.reviewStatus}`}>
                    {paper.reviewReady ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
                    <span>{paper.reviewLabel}</span>
                  </em>
                </span>
              </label>
            )
          })}
        </div>

        <footer className="matrix-dialog__footer">
          <button type="button" className="matrix-secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="matrix-primary-button" onClick={onConfirm} disabled={busy || selectedIds.size < 1}>
            <span>{busy ? '提交中' : '加入后台生成'}</span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function MatrixCellEditorDialog({ busy, editingCell, onClose, onSave }) {
  const [draftValue, setDraftValue] = useState('')

  useEffect(() => {
    setDraftValue(editingCell?.value || '')
  }, [editingCell])

  if (!editingCell) return null

  return (
    <div className="matrix-dialog" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="matrix-dialog__panel matrix-dialog__panel--editor" role="dialog" aria-modal="true" aria-label={`编辑 ${editingCell.label}`}>
        <header className="matrix-dialog__header">
          <div>
            <strong>编辑 {editingCell.label}</strong>
            <p>
              {editingCell.scope === 'paper'
                ? '这里修改的是单篇综述卡片里的可复用底稿，保存后当前批次和后续新批次都会复用。'
                : '这里修改的是当前批次专属的综述定位，不会回写单篇综述卡片。'}
            </p>
          </div>
          <button type="button" className="matrix-run-rail__icon" onClick={onClose} disabled={busy} aria-label="关闭">
            <X />
          </button>
        </header>
        <div className="matrix-editor">
          <div className="matrix-editor__meta">
            <strong>{editingCell.paperTitle}</strong>
            {editingCell.multiValue ? <span>多值字段可以按换行、中文分号或逗号分隔。</span> : <span>建议直接改成你希望后续复用的最终表述。</span>}
          </div>
          <textarea
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder={`填写 ${editingCell.label}`}
          />
        </div>
        <footer className="matrix-dialog__footer">
          <button type="button" className="matrix-secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="matrix-primary-button" onClick={() => onSave(draftValue)} disabled={busy}>
            <span>{busy ? '保存中' : '保存修改'}</span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function ResearchMatrixTable({ run, query, onQueryChange, onEditCell }) {
  const rows = run?.matrix?.rows || []
  const fields = useMemo(() => normalizeFields(run?.matrix?.fields), [run])
  const [previewCell, setPreviewCell] = useState(null)
  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter((row) =>
      [row.title, row.author, row.folder_name, ...fields.map((field) => row[field.key])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    )
  }, [fields, rows, query])

  if (!run) {
    return (
      <section className="research-matrix-table is-empty">
        <h3>选择论文生成第一张矩阵</h3>
        <p>矩阵会保存成历史批次，下次打开仍然可以回看当时那几篇论文和生成结果。</p>
      </section>
    )
  }

  function showPreview(event, previewKey, label, value) {
    event.currentTarget?.removeAttribute('title')
    if (!value) return
    setPreviewCell({
      key: previewKey,
      label,
      value,
      ...buildPreviewPosition(event),
    })
  }

  function hidePreview(previewKey) {
    setPreviewCell((current) => (current?.key === previewKey ? null : current))
  }

  return (
    <section className="research-matrix-table">
      <div className="research-matrix-table__toolbar">
        <div>
          <strong>矩阵表格</strong>
          <span>{filteredRows.length} 行 · {fields.length} 个字段</span>
        </div>
        <label className="matrix-search">
          <Search />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="筛选矩阵内容" />
        </label>
      </div>
      <div className="research-matrix-table__scroll">
        <table>
          <thead>
            <tr>
              <th className="is-sticky">论文标题</th>
              {fields.map((field) => <th key={field.key}>{field.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.paper_id || row.title}>
                <td className="is-sticky">
                  <strong title={row.title}>{row.title}</strong>
                  <span>{row.is_stale ? '需刷新' : '已就绪'}</span>
                </td>
                {fields.map((field) => {
                  const cellValue = row[field.key] || ''
                  const previewKey = `${row.paper_id}-${field.key}`
                  return (
                    <td
                      key={field.key}
                      title={cellValue || '暂无内容'}
                      onMouseEnter={(event) => showPreview(event, previewKey, field.label, cellValue)}
                      onMouseMove={(event) => showPreview(event, previewKey, field.label, cellValue)}
                      onMouseLeave={() => hidePreview(previewKey)}
                    >
                      <button
                        type="button"
                        className="matrix-cell-button"
                        onClick={() => onEditCell({
                          paperId: row.paper_id,
                          paperTitle: row.title,
                          fieldKey: field.key,
                          label: field.label,
                          scope: field.scope || 'paper',
                          multiValue: field.multiValue,
                          value: cellValue,
                        })}
                      >
                        {cellValue ? (
                          <span className="matrix-cell-compact">
                            <span>{cellValue}</span>
                            <PenSquare className="matrix-cell-button__icon" />
                          </span>
                        ) : (
                          <span className="matrix-cell-empty">
                            <em>点击补充</em>
                            <PenSquare className="matrix-cell-button__icon" />
                          </span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {previewCell ? (
        <aside
          className="matrix-cell-preview"
          style={{ left: `${previewCell.left}px`, top: `${previewCell.top}px` }}
          role="status"
          aria-live="polite"
        >
          <span>{previewCell.label}</span>
          <p>{previewCell.value}</p>
        </aside>
      ) : null}
    </section>
  )
}

function MatrixDraftsView({ run }) {
  const drafts = Object.entries(run?.drafts || {})
  if (!run) {
    return (
      <section className="matrix-drafts-empty">
        <h3>综述草稿</h3>
        <p>先选择一条历史批次，这里会展示这批文献整理出的综述段落草稿。</p>
      </section>
    )
  }

  return (
    <section className="matrix-drafts-view">
      <div className="matrix-drafts-view__header">
        <strong>综述段落草稿</strong>
        <span>{drafts.length} 段</span>
      </div>
      <div className="matrix-drafts-view__grid">
        {drafts.map(([key, draft]) => (
          <article key={key} className="matrix-drafts-view__card">
            <h3>{draft.title}</h3>
            <p>{draft.content}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function PendingRunView({ busy, run, onOpenRunPapers, onRetryRun }) {
  const statusLabel = run?.stage_label || RUN_STATUS_LABELS[run?.status] || run?.status || '处理中'
  const total = run?.total_count || run?.paper_count || 0
  const ready = run?.ready_count || 0
  const failed = run?.failed_count || 0

  return (
    <section className="matrix-pending-view">
      <div className="matrix-pending-view__hero">
        <CircleProgress value={run?.progress_percent || 0} status={run?.status} label={`${ready}/${total}`} />
        <div>
          <h3>{run?.title || '当前批次'}</h3>
          <p>{statusLabel}</p>
          <small>
            {total ? `${ready}/${total} 篇单篇综述已就绪` : '正在整理批次信息'}
            {failed ? ` · ${failed} 篇需要继续补齐` : ''}
          </small>
        </div>
      </div>

      {run?.error_message ? (
        <div className="matrix-inline-message">{run.error_message}</div>
      ) : null}

      <div className="matrix-pending-view__actions">
        <button type="button" className="matrix-secondary-button" onClick={() => onOpenRunPapers(run.id)} disabled={busy}>
          <Eye size={14} />
          查看论文状态
        </button>
        {run?.status === 'failed' ? (
          <button type="button" className="matrix-primary-button" onClick={() => onRetryRun(run.id)} disabled={busy}>
            <RotateCcw size={14} />
            继续补齐
          </button>
        ) : null}
      </div>

      <div className="matrix-pending-list">
        {(run?.papers || []).map((item) => (
          <article key={item.paper_id} className="matrix-pending-item">
            <div>
              <strong title={item.title}>{item.title}</strong>
              <small>{item.folder_name || '未分类'}</small>
            </div>
            <span className={`matrix-run-paper-item__status is-${item.summary_status || 'idle'}`}>
              {REVIEW_STATUS_LABELS[item.summary_status] || '待补齐'}
            </span>
          </article>
        ))}
      </div>
    </section>
  )
}

export function ResearchMatrixPage({
  folders = [],
  recentPapers = [],
  uncategorizedFolderId,
}) {
  const [runs, setRuns] = useState([])
  const [currentRun, setCurrentRun] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [matrixQuery, setMatrixQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [runMenuOpenId, setRunMenuOpenId] = useState(null)
  const [reviewStatuses, setReviewStatuses] = useState(new Map())
  const [showRunPapers, setShowRunPapers] = useState(false)
  const [activeTab, setActiveTab] = useState('matrix')
  const [editingCell, setEditingCell] = useState(null)

  const selectablePapers = useMemo(
    () => buildSelectablePapers(recentPapers, folders, uncategorizedFolderId, reviewStatuses),
    [folders, recentPapers, reviewStatuses, uncategorizedFolderId],
  )

  const hasPendingRuns = useMemo(
    () => runs.some((run) => RUNNING_STATUSES.has(run.status)) || RUNNING_STATUSES.has(currentRun?.status),
    [currentRun?.status, runs],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const runPayload = await fetchResearchMatrixRuns()
        if (cancelled) return
        const nextRuns = runPayload?.runs || []
        setRuns(nextRuns)
        if (nextRuns[0]) {
          const detail = await fetchResearchMatrixRun(nextRuns[0].id)
          if (!cancelled) setCurrentRun(detail)
        }
      } catch (err) {
        if (!cancelled) setNotice({ type: 'error', text: err.message || '加载文献矩阵失败' })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showCreateDialog) return undefined
    let cancelled = false
    async function loadStatuses() {
      const next = new Map()
      await Promise.all(recentPapers.slice(0, 120).map(async (paper) => {
        try {
          const status = await fetchPaperSummaryStatus(paper.id, 'review')
          if (!cancelled) next.set(paper.id, status)
        } catch {
          if (!cancelled) next.set(paper.id, { status: 'idle', summary: null, error_message: '' })
        }
      }))
      if (!cancelled) {
        setReviewStatuses((previous) => {
          const merged = new Map(previous)
          next.forEach((value, key) => merged.set(key, value))
          return merged
        })
      }
    }
    loadStatuses()
    return () => {
      cancelled = true
    }
  }, [recentPapers, showCreateDialog])

  useEffect(() => {
    const handler = () => {
      setExportMenuOpen(false)
      setRunMenuOpenId(null)
    }
    document.addEventListener('click', handler)
    return () => {
      document.removeEventListener('click', handler)
    }
  }, [])

  useEffect(() => {
    if (!hasPendingRuns) return undefined
    let cancelled = false
    const intervalId = window.setInterval(async () => {
      try {
        const runPayload = await fetchResearchMatrixRuns()
        if (cancelled) return
        const nextRuns = runPayload?.runs || []
        setRuns(nextRuns)
        if (currentRun?.id && RUNNING_STATUSES.has(currentRun.status)) {
          const detail = await fetchResearchMatrixRun(currentRun.id)
          if (!cancelled) {
            setCurrentRun(detail)
            if (detail.status === 'completed') {
              setNotice({ type: 'success', text: `批次“${detail.title}”已完成，可以直接查看矩阵了。` })
            }
          }
        }
      } catch {
        // keep silent during polling
      }
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [currentRun?.id, currentRun?.status, hasPendingRuns])

  function stopMenuBubble(event) {
    event.stopPropagation()
  }

  function resetCreateSelection() {
    setSelectedIds(new Set())
    setSearchTerm('')
    setSelectedFolderId('all')
  }

  function openCreateDialog() {
    setShowCreateDialog(true)
    setExportMenuOpen(false)
    setRunMenuOpenId(null)
  }

  async function loadRuns(selectFirst = false) {
    const payload = await fetchResearchMatrixRuns()
    const nextRuns = payload?.runs || []
    setRuns(nextRuns)
    if (selectFirst && nextRuns[0]) {
      const detail = await fetchResearchMatrixRun(nextRuns[0].id)
      setCurrentRun(detail)
    }
    if (selectFirst && !nextRuns.length) {
      setCurrentRun(null)
    }
  }

  async function openRunPapers(runId) {
    setBusy(true)
    setNotice(null)
    try {
      const detail = currentRun?.id === runId ? currentRun : await fetchResearchMatrixRun(runId)
      setCurrentRun(detail)
      setShowRunPapers(true)
      setRunMenuOpenId(null)
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '打开本批次论文列表失败' })
    } finally {
      setBusy(false)
    }
  }

  function closeCreateDialog() {
    if (busy) return
    setShowCreateDialog(false)
  }

  function togglePaper(paperId) {
    startTransition(() => {
      setSelectedIds((previous) => {
        const next = new Set(previous)
        if (next.has(paperId)) {
          next.delete(paperId)
        } else if (next.size < 50) {
          next.add(paperId)
        }
        return next
      })
    })
  }

  function toggleVisible(papers) {
    setSelectedIds((previous) => {
      const visibleIds = papers.map((paper) => paper.id)
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => previous.has(id))
      const next = new Set(previous)
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id))
      } else {
        visibleIds.forEach((id) => {
          if (next.size < 50) next.add(id)
        })
      }
      return next
    })
  }

  async function handleCreateRun() {
    if (selectedIds.size < 1) return
    setBusy(true)
    setNotice(null)
    try {
      const selectedPapers = recentPapers.filter((paper) => selectedIds.has(paper.id))
      const title = selectedPapers.length > 1
        ? `${getPaperTitle(selectedPapers[0]).slice(0, 32)} 等 ${selectedPapers.length} 篇`
        : getPaperTitle(selectedPapers[0])
      const detail = await createResearchMatrixRun({
        title,
        paper_ids: Array.from(selectedIds),
        include_reproduction: true,
      })
      setShowCreateDialog(false)
      resetCreateSelection()
      await loadRuns(false)
      setNotice({
        type: 'success',
        text: detail.status === 'completed'
          ? '当前批次已直接生成完成。'
          : '批次已加入后台生成，你可以继续查看别的文献或批次。',
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '生成矩阵失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleSelectRun(runId) {
    setBusy(true)
    setNotice(null)
    setExportMenuOpen(false)
    setRunMenuOpenId(null)
    try {
      const detail = await fetchResearchMatrixRun(runId)
      setCurrentRun(detail)
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '打开矩阵记录失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRefreshRun(runId) {
    const targetRunId = runId || currentRun?.id
    if (!targetRunId) return
    setBusy(true)
    setNotice(null)
    setRunMenuOpenId(null)
    try {
      const currentTitle = currentRun?.id === targetRunId
        ? currentRun.title
        : runs.find((run) => run.id === targetRunId)?.title
      const detail = await refreshResearchMatrixRun(targetRunId, {
        title: `${currentTitle || '矩阵批次'} - 新版本`,
      })
      setCurrentRun(detail)
      await loadRuns(false)
      setNotice({
        type: 'success',
        text: detail.status === 'completed'
          ? '已根据最新单篇综述生成新版本矩阵。'
          : '新版批次已加入后台生成，左侧会持续显示进度。',
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '刷新矩阵失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRetryRun(runId) {
    if (!runId) return
    setBusy(true)
    setNotice(null)
    setRunMenuOpenId(null)
    try {
      const detail = await retryPendingResearchMatrixRun(runId)
      if (currentRun?.id === runId) {
        setCurrentRun(detail)
      }
      await loadRuns(false)
      setNotice({ type: 'success', text: '已继续补齐当前批次缺失的单篇综述卡片。' })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '继续补齐失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteRun(runId) {
    if (!runId) return
    if (!window.confirm('确定删除这条文献矩阵记录吗？不会删除原论文和单篇综述卡片。')) return
    setBusy(true)
    setNotice(null)
    setRunMenuOpenId(null)
    try {
      await deleteResearchMatrixRun(runId)
      if (currentRun?.id === runId) {
        setCurrentRun(null)
      }
      await loadRuns(true)
      setNotice({ type: 'success', text: '当前批次已删除。' })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '删除矩阵记录失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveCellEdit(nextValue) {
    if (!editingCell || !currentRun?.id) return
    setBusy(true)
    setNotice(null)
    try {
      const payload = editingCell.scope === 'run'
        ? { run_field_updates: { [editingCell.fieldKey]: nextValue } }
        : { paper_field_updates: { [editingCell.fieldKey]: nextValue } }
      const detail = await updateResearchMatrixRunPaper(currentRun.id, editingCell.paperId, payload)
      setCurrentRun(detail)
      setEditingCell(null)
      await loadRuns(false)
      setNotice({
        type: 'success',
        text: editingCell.scope === 'run'
          ? '当前批次的综述定位已更新。'
          : '单篇综述卡片已更新，当前批次已同步刷新。',
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '保存字段失败' })
    } finally {
      setBusy(false)
    }
  }

  function handleExport(format) {
    setExportMenuOpen(false)
    if (!currentRun || currentRun.status !== 'completed') return
    if (format === 'excel') {
      exportRunExcel(currentRun)
      return
    }
    exportRunWord(currentRun)
  }

  function beginEditCell(cell) {
    if (!currentRun || currentRun.status !== 'completed') return
    setEditingCell(cell)
  }

  return (
    <section className={`research-matrix-shell${railCollapsed ? ' is-rail-collapsed' : ''}`}>
      <MatrixRunRail
        activeRunId={currentRun?.id}
        collapsed={railCollapsed}
        menuOpenId={runMenuOpenId}
        runs={runs}
        onCreateNew={openCreateDialog}
        onDeleteRun={handleDeleteRun}
        onOpenRunPapers={openRunPapers}
        onRefreshRun={handleRefreshRun}
        onRetryRun={handleRetryRun}
        onSelectRun={handleSelectRun}
        onToggleCollapsed={(event) => {
          stopMenuBubble(event)
          setRailCollapsed((value) => !value)
        }}
        onToggleMenu={(runId, event) => {
          stopMenuBubble(event)
          setRunMenuOpenId((current) => (current === runId ? null : runId))
        }}
      />

      <main className="research-matrix-main">
        <MatrixContentHeader
          activeTab={activeTab}
          currentRun={currentRun}
          exportMenuOpen={exportMenuOpen}
          onChangeTab={setActiveTab}
          onExport={handleExport}
          onToggleExportMenu={(event) => {
            stopMenuBubble(event)
            setExportMenuOpen((value) => !value)
          }}
        />

        {notice ? <div className={`matrix-inline-message${notice.type === 'success' ? ' is-success' : ''}`}>{notice.text}</div> : null}

        <div className="research-matrix-main__content">
          {currentRun && currentRun.status !== 'completed' ? (
            <PendingRunView
              busy={busy}
              run={currentRun}
              onOpenRunPapers={openRunPapers}
              onRetryRun={handleRetryRun}
            />
          ) : activeTab === 'matrix' ? (
            <ResearchMatrixTable
              run={currentRun}
              query={matrixQuery}
              onQueryChange={setMatrixQuery}
              onEditCell={beginEditCell}
            />
          ) : (
            <MatrixDraftsView run={currentRun} />
          )}
        </div>
      </main>

      <MatrixCreateDialog
        busy={busy}
        folders={folders}
        open={showCreateDialog}
        papers={selectablePapers}
        searchTerm={searchTerm}
        selectedFolderId={selectedFolderId}
        selectedIds={selectedIds}
        uncategorizedFolderId={uncategorizedFolderId}
        onClose={closeCreateDialog}
        onConfirm={handleCreateRun}
        onFolderChange={setSelectedFolderId}
        onSearchChange={setSearchTerm}
        onTogglePaper={togglePaper}
        onToggleVisible={toggleVisible}
      />

      <MatrixCellEditorDialog
        busy={busy}
        editingCell={editingCell}
        onClose={() => setEditingCell(null)}
        onSave={handleSaveCellEdit}
      />

      <RunPapersPanel
        open={showRunPapers}
        run={currentRun}
        onClose={() => setShowRunPapers(false)}
      />
    </section>
  )
}
