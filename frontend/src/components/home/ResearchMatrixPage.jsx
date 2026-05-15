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
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  Network,
  ListTree,
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
  updateResearchMatrixRun,
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

const DRAFT_REQUIRED_TYPES = ['overview', 'review', 'reproduction']

const SUMMARY_TYPE_LABELS = {
  overview: '整篇总结',
  review: '综述卡片',
  reproduction: '复现总结',
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

function getRunDisplayTitle(run) {
  return (run?.title || '未命名批次').trim() || '未命名批次'
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
  const draftHtml = Object.entries(drafts).map(([, draft]) => {
    const paragraphs = normalizeDraftParagraphs(draft)
    const items = normalizeDraftItems(draft)
    const paragraphHtml = paragraphs.length
      ? paragraphs.map((paragraph) => `
          <p>${escapeHtml(paragraph.text || '')}</p>
          <p><strong>来源脚注：</strong>${escapeHtml(formatCitationFootnotes(paragraph.citations || []))}</p>
          ${paragraph.confidence === 'weak' ? '<p><em>依据较弱，建议回查原文。</em></p>' : ''}
        `).join('')
      : `<p>${escapeHtml(draft.content || '')}</p>`
    const itemsHtml = items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(`${item.paper_title || ''} p.${item.page || '?'}：${item.quote || ''}（${item.usage_note || ''}）`)}</li>`).join('')}</ul>`
      : ''
    return `
      <h2>${escapeHtml(draft.title || '')}</h2>
      ${paragraphHtml}
      ${itemsHtml}
      <p><strong>来源：</strong>${escapeHtml((draft.source_titles || []).join('；'))}</p>
    `
  }).join('')
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

const DRAFT_SECTION_ORDER = [
  'research_background',
  'research_status',
  'core_innovations',
  'method_compare',
  'result_analysis',
  'limitations_future',
  'quotable_sentences',
  'final_integrated_review',
]

function getOrderedDraftSections(run) {
  const drafts = run?.drafts || {}
  const seen = new Set()
  const sections = []
  DRAFT_SECTION_ORDER.forEach((key) => {
    if (drafts[key]) {
      sections.push([key, drafts[key]])
      seen.add(key)
    }
  })
  Object.entries(drafts).forEach(([key, value]) => {
    if (!seen.has(key)) sections.push([key, value])
  })
  return sections
}

function getOutlinePayload(run) {
  return run?.drafts?.review_outline || null
}

function getTopicGroups(run) {
  const outline = getOutlinePayload(run)
  return Array.isArray(outline?.grouped_outlines) && outline.grouped_outlines.length
    ? outline.grouped_outlines
    : Array.isArray(outline?.topic_groups)
      ? outline.topic_groups.map((group, index) => ({
          group_id: `group_${index + 1}`,
          label: group?.label || `主题 ${index + 1}`,
          paper_titles: group?.paper_titles || [],
          sections: Array.isArray(outline?.outline_sections) ? outline.outline_sections : [],
        }))
      : []
}

function toTitleKey(value) {
  return String(value || '').trim()
}

function titleInAllowedSet(allowedTitles, value) {
  const key = toTitleKey(value)
  return key ? allowedTitles.has(key) : false
}

function filterDraftByTitles(draft, allowedTitles) {
  if (!draft || !allowedTitles?.size) return draft
  const paragraphs = Array.isArray(draft?.paragraphs)
    ? draft.paragraphs.filter((paragraph) => {
        const citations = Array.isArray(paragraph?.citations) ? paragraph.citations : []
        if (citations.length) {
          return citations.some((citation) => titleInAllowedSet(allowedTitles, citation?.paper_title))
        }
        return (draft?.source_titles || []).some((title) => titleInAllowedSet(allowedTitles, title))
      })
    : []
  const items = Array.isArray(draft?.items)
    ? draft.items.filter((item) => titleInAllowedSet(allowedTitles, item?.paper_title))
    : []
  const sourceTitles = Array.isArray(draft?.source_titles)
    ? draft.source_titles.filter((title) => titleInAllowedSet(allowedTitles, title))
    : []
  let content = draft?.content || ''
  if (paragraphs.length) {
    content = paragraphs.map((paragraph) => paragraph?.text || '').filter(Boolean).join('\n\n')
  } else if (items.length) {
    content = items.map((item) => `${item.paper_title || ''} p.${item.page || '?'}：${item.quote || ''}`).join('\n')
  } else if (!sourceTitles.length) {
    content = ''
  }
  return {
    ...draft,
    paragraphs,
    items,
    source_titles: sourceTitles,
    content,
    copy_ready: Boolean(paragraphs.length || items.length || content),
  }
}

function filterRunByTopicGroup(run, groupId) {
  if (!run || !groupId || groupId === 'all') return run
  const topicGroups = getTopicGroups(run)
  const group = topicGroups.find((item) => item.group_id === groupId)
  const allowedTitles = new Set((group?.paper_titles || []).map((title) => toTitleKey(title)).filter(Boolean))
  if (!allowedTitles.size) return run

  const matrixRows = (run?.matrix?.rows || []).filter((row) => titleInAllowedSet(allowedTitles, row?.title))
  const papers = (run?.papers || []).filter((paper) => titleInAllowedSet(allowedTitles, paper?.title))
  const missing = (run?.matrix?.missing || []).filter((item) => titleInAllowedSet(allowedTitles, item?.title))
  const stale = (run?.matrix?.stale || []).filter((item) => titleInAllowedSet(allowedTitles, item?.title))
  const nextDrafts = { ...(run?.drafts || {}) }
  if (group?.drafts && typeof group.drafts === 'object') {
    Object.entries(group.drafts).forEach(([key, value]) => {
      nextDrafts[key] = value
    })
  } else {
    Object.keys(nextDrafts).forEach((key) => {
      if (key === 'review_outline' || key === 'topic_diagnostic') return
      nextDrafts[key] = filterDraftByTitles(nextDrafts[key], allowedTitles)
    })
  }
  if (nextDrafts.review_outline && group?.review_outline) {
    nextDrafts.review_outline = {
      ...nextDrafts.review_outline,
      ...group.review_outline,
      active_group_id: group.group_id,
      active_group_label: group.label,
      active_group_titles: group.paper_titles || [],
    }
  } else if (nextDrafts.review_outline && Array.isArray(group?.sections)) {
    nextDrafts.review_outline = {
      ...nextDrafts.review_outline,
      outline_sections: group.sections,
      active_group_id: group.group_id,
      active_group_label: group.label,
      active_group_titles: group.paper_titles || [],
    }
  }
  return {
    ...run,
    matrix: {
      ...(run?.matrix || {}),
      rows: matrixRows,
      missing,
      stale,
      paper_count: matrixRows.length,
      ready_count: matrixRows.length,
    },
    papers,
    paper_count: papers.length || matrixRows.length,
    drafts: nextDrafts,
  }
}

function normalizeDraftParagraphs(draft) {
  if (Array.isArray(draft?.paragraphs) && draft.paragraphs.length) {
    return draft.paragraphs.filter((paragraph) => paragraph?.text)
  }
  if (draft?.content) {
    return [
      {
        text: draft.content,
        citations: (draft?.source_titles || []).map((title) => ({
          paper_title: title,
          source_card_type: 'review',
          page: null,
        })),
        confidence: 'weak',
      },
    ]
  }
  return []
}

function normalizeDraftItems(draft) {
  return Array.isArray(draft?.items) ? draft.items.filter((item) => item?.quote || item?.paper_title) : []
}

function formatCitationFootnotes(citations = []) {
  if (!Array.isArray(citations) || !citations.length) return '当前段落缺少明确脚注，请回查本批次来源卡片。'
  return citations.map((citation, index) => {
    const title = citation?.paper_title || '未命名论文'
    const cardType = citation?.source_card_type || 'review'
    const page = citation?.page ? ` p.${citation.page}` : ''
    return `[${index + 1}] ${title} · ${cardType}${page}`
  }).join('；')
}

function buildDraftCopyText(draft) {
  const title = draft?.title || '未命名章节'
  const paragraphs = normalizeDraftParagraphs(draft)
  const items = normalizeDraftItems(draft)
  const lines = [title]
  if (paragraphs.length) {
    paragraphs.forEach((paragraph) => {
      lines.push('')
      lines.push(paragraph.text || '')
      lines.push(`来源脚注：${formatCitationFootnotes(paragraph.citations || [])}`)
      if (paragraph.confidence === 'weak') {
        lines.push('提示：依据较弱，建议回查原文。')
      }
    })
  } else if (draft?.content) {
    lines.push('')
    lines.push(draft.content)
  }
  if (items.length) {
    lines.push('')
    lines.push('可引用素材：')
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.paper_title || '未命名论文'} p.${item.page || '?'}：${item.quote || ''}`)
      if (item.usage_note) lines.push(`   用途：${item.usage_note}`)
    })
  }
  return lines.join('\n')
}

function buildIntegratedCopyText(run) {
  const drafts = run?.drafts || {}
  const finalDraft = drafts.final_integrated_review
  if (finalDraft?.copy_ready) {
    const text = buildDraftCopyText(finalDraft)
    const quoteItems = normalizeDraftItems(drafts.quotable_sentences)
    if (!quoteItems.length) return text
    return `${text}\n\n可引用素材：\n${quoteItems.map((item, index) => `${index + 1}. ${item.paper_title || '未命名论文'} p.${item.page || '?'}：${item.quote || ''}`).join('\n')}`
  }
  const sections = getOrderedDraftSections(run)
    .filter(([key]) => DRAFT_SECTION_ORDER.slice(0, 6).includes(key))
    .map(([, draft]) => buildDraftCopyText(draft))
    .filter(Boolean)
  if (!sections.length) return ''
  const quoteItems = normalizeDraftItems(drafts.quotable_sentences)
  const appendix = quoteItems.length
    ? `\n\n可引用素材：\n${quoteItems.map((item, index) => `${index + 1}. ${item.paper_title || '未命名论文'} p.${item.page || '?'}：${item.quote || ''}`).join('\n')}`
    : ''
  return `${sections.join('\n\n')}${appendix}`
}

function buildOutlineCopyText(run) {
  const outline = getOutlinePayload(run)
  const sections = Array.isArray(outline?.outline_sections) ? outline.outline_sections : []
  const groups = Array.isArray(outline?.topic_groups) ? outline.topic_groups : []
  const lines = ['综述大纲']
  if (outline?.content) {
    lines.push('')
    lines.push(outline.content)
  }
  if (outline?.diagnostic && groups.length > 1) {
    lines.push('')
    lines.push('主题分组建议：')
    groups.forEach((group, index) => {
      lines.push(`${index + 1}. ${group.label || `主题 ${index + 1}`}：${(group.paper_titles || []).join('、')}`)
    })
  }
  sections.forEach((section, index) => {
    lines.push('')
    lines.push(`${index + 1}. ${section.title || `章节 ${index + 1}`}`)
    if (section.goal) lines.push(`章节目标：${section.goal}`)
    if (Array.isArray(section.points) && section.points.length) {
      lines.push('本节要点：')
      section.points.forEach((point, pointIndex) => {
        lines.push(`${pointIndex + 1}. ${point}`)
      })
    }
    if (Array.isArray(section.source_titles) && section.source_titles.length) {
      lines.push(`建议支撑论文：${section.source_titles.join('、')}`)
    }
  })
  return lines.join('\n')
}

async function copyTextToClipboard(text) {
  if (!text) return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
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

function sortMissingFirst(a, b) {
  if (a.sourceReadyCount === b.sourceReadyCount) {
    if (a.hasRunningSource === b.hasRunningSource) return 0
    if (a.hasRunningSource) return -1
    if (b.hasRunningSource) return 1
    return 0
  }
  if (a.sourceReadyCount < b.sourceReadyCount) return -1
  if (a.sourceReadyCount > b.sourceReadyCount) return 1
  return 0
}

function buildSelectablePapers(papers, folders, uncategorizedFolderId, statuses) {
  return papers.map((paper) => {
    const paperId = paper.id
    const summaryStatuses = statuses.get(paperId) || {}
    const entries = DRAFT_REQUIRED_TYPES.map((type) => ({
      type,
      status: summaryStatuses[type]?.status || 'idle',
    }))
    const sourceReadyCount = entries.filter((entry) => entry.status === 'generated').length
    const hasRunningSource = entries.some((entry) => entry.status === 'running')
    const hasFailedSource = entries.some((entry) => entry.status === 'failed')
    const missingSourceTypes = entries
      .filter((entry) => entry.status !== 'generated')
      .map((entry) => entry.type)
    let sourceLabel = '来源卡片待准备'
    let sourceTone = 'idle'
    if (sourceReadyCount === DRAFT_REQUIRED_TYPES.length) {
      sourceLabel = '草稿来源已齐'
      sourceTone = 'generated'
    } else if (hasRunningSource) {
      sourceLabel = `来源补齐中 ${sourceReadyCount}/${DRAFT_REQUIRED_TYPES.length}`
      sourceTone = 'running'
    } else if (hasFailedSource) {
      sourceLabel = `来源缺失 ${sourceReadyCount}/${DRAFT_REQUIRED_TYPES.length}`
      sourceTone = 'failed'
    } else if (sourceReadyCount > 0) {
      sourceLabel = `来源待补齐 ${sourceReadyCount}/${DRAFT_REQUIRED_TYPES.length}`
      sourceTone = 'idle'
    }
    return {
      id: paperId,
      title: getPaperTitle(paper),
      author: getPaperAuthor(paper),
      folderName: getFolderName(paper, folders, uncategorizedFolderId),
      sourceReadyCount,
      sourceTotalCount: DRAFT_REQUIRED_TYPES.length,
      sourceReady: sourceReadyCount === DRAFT_REQUIRED_TYPES.length,
      hasRunningSource,
      hasFailedSource,
      sourceLabel,
      sourceTone,
      missingSourceTypes,
    }
  }).sort(sortMissingFirst)
}

function formatSourceMissingTypes(types = []) {
  if (!types.length) return ''
  return types.map((type) => SUMMARY_TYPE_LABELS[type] || type).join('、')
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
      <span className="matrix-progress-ring__label">{status === 'failed' ? '!' : Math.round(bounded)}</span>
    </span>
  )
}

function getRunProgressMeta(run) {
  const draftStatus = run?.draft_status || 'idle'
  const draftTotal = Number(run?.draft_total_count || 0)
  const draftReady = Number(run?.draft_ready_count || 0)
  const runTotal = Number(run?.total_count || run?.paper_count || 0)
  const runReady = Number(run?.ready_count || 0)
  const showDraftProgress = draftStatus !== 'completed' && draftTotal > 0
  if (showDraftProgress) {
    const derivedDraftProgress = draftTotal > 0 ? Math.round((draftReady / draftTotal) * 100) : 0
    return {
      value: Math.min(Number(run?.draft_progress_percent || 0), derivedDraftProgress),
      status: draftStatus,
      label: `${draftReady}/${draftTotal || 0}`,
      detail: `${run?.draft_stage_label || '综述草稿处理中'}${draftTotal ? ` · ${draftReady}/${draftTotal}` : ''}`,
      helper: draftTotal ? `综述草稿来源 ${draftReady}/${draftTotal}` : '综述草稿来源准备中',
    }
  }
  return {
    value: Number(run?.progress_percent || 0),
    status: run?.status || 'completed',
    label: `${runReady}/${runTotal || 0}`,
    detail: `${run?.stage_label || RUN_STATUS_LABELS[run?.status] || run?.status || '已完成'}${runTotal ? ` · ${runReady}/${runTotal}` : ''}`,
    helper: runTotal ? `矩阵基础进度 ${runReady}/${runTotal}` : '矩阵基础进度已完成',
  }
}

const METHOD_GROUP_LABELS = {
  cnn: 'CNN 相关研究',
  multimodal: '多模态相关研究',
  transformer: 'Transformer 相关研究',
  rnn: 'RNN 相关研究',
  lstm: 'LSTM 相关研究',
  gcn: '图神经网络相关研究',
  gan: 'GAN 相关研究',
  m2d: 'M2D CNN 相关研究',
}

function tokenizeForGrouping(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function normalizeMethodToken(token) {
  const text = String(token || '').toLowerCase()
  if (!text) return ''
  if (text.includes('cnn')) return text.includes('m2d') ? 'm2d' : 'cnn'
  if (text.includes('multimodal') || text.includes('多模态')) return 'multimodal'
  if (text.includes('transformer')) return 'transformer'
  if (text.includes('lstm')) return 'lstm'
  if (text.includes('rnn')) return 'rnn'
  if (text.includes('gcn')) return 'gcn'
  if (text.includes('gan')) return 'gan'
  return ''
}

function buildPaperGroupingProfile(row) {
  const title = row?.title || ''
  const question = row?.research_question || ''
  const method = row?.method_route || ''
  const metrics = row?.core_metrics || ''
  const tags = row?.comparison_tags || ''
  const data = row?.data_sample || ''
  const topicTokens = new Set([
    ...tokenizeForGrouping(question),
    ...tokenizeForGrouping(tags),
    ...tokenizeForGrouping(data),
  ])
  const methodTokens = new Set([
    ...tokenizeForGrouping(method).map(normalizeMethodToken),
    ...tokenizeForGrouping(metrics).map(normalizeMethodToken),
    ...tokenizeForGrouping(title).map(normalizeMethodToken),
  ].filter(Boolean))
  return { title, topicTokens, methodTokens }
}

function overlapScore(left, right) {
  if (!left.size || !right.size) return 0
  let shared = 0
  left.forEach((token) => {
    if (right.has(token)) shared += 1
  })
  return shared / Math.max(left.size, right.size)
}

function buildLocalTopicGroups(run, nextMode) {
  const rows = run?.matrix?.rows || []
  const profiles = rows.map(buildPaperGroupingProfile)
  if (profiles.length <= 1) return []
  if (nextMode === 'method_first') {
    const groups = new Map()
    profiles.forEach((profile, index) => {
      const anchor = Array.from(profile.methodTokens)[0] || `method_${index + 1}`
      const label = METHOD_GROUP_LABELS[anchor] || `${anchor.toUpperCase()} 相关研究`
      if (!groups.has(anchor)) {
        groups.set(anchor, { group_id: `group_${groups.size + 1}`, label, paper_titles: [] })
      }
      groups.get(anchor).paper_titles.push(profile.title)
    })
    return Array.from(groups.values())
  }
  const groups = []
  profiles.forEach((profile) => {
    let matched = null
    let bestScore = 0
    groups.forEach((group) => {
      const score = overlapScore(profile.topicTokens, group.tokens)
      if (score > bestScore) {
        bestScore = score
        matched = group
      }
    })
    if (!matched || bestScore < 0.24) {
      groups.push({
        group_id: `group_${groups.length + 1}`,
        label: Array.from(profile.topicTokens).slice(0, 3).join(' / ') || `主题 ${groups.length + 1}`,
        paper_titles: [profile.title],
        tokens: new Set(profile.topicTokens),
      })
      return
    }
    matched.paper_titles.push(profile.title)
    profile.topicTokens.forEach((token) => matched.tokens.add(token))
  })
  return groups.map((group) => ({
    group_id: group.group_id,
    label: group.label,
    paper_titles: group.paper_titles,
  }))
}

function buildGroupedRunView(run, nextMode) {
  if (!run) return null
  const drafts = run?.drafts || {}
  const reviewOutline = drafts?.review_outline || {}
  const groupedOutlines = buildLocalTopicGroups(run, nextMode).map((group) => ({
    ...group,
    section_count: Array.isArray(reviewOutline?.outline_sections) ? reviewOutline.outline_sections.length : 0,
    sections: Array.isArray(reviewOutline?.outline_sections) ? reviewOutline.outline_sections : [],
  }))
  if (!groupedOutlines.length) return {
    ...run,
    grouping_mode: nextMode,
    drafts: {
      ...drafts,
      review_outline: {
        ...reviewOutline,
        grouping_mode: nextMode,
      },
    },
  }
  const topicGroups = groupedOutlines.map((group, index) => ({
    group_id: group.group_id || `group_${index + 1}`,
    label: group.label || `主题 ${index + 1}`,
    paper_titles: Array.isArray(group.paper_titles) ? group.paper_titles : [],
    section_count: Number(group.section_count || 0),
    sections: Array.isArray(group.sections) ? group.sections : [],
    drafts: group.drafts || {},
    review_outline: group.review_outline || {},
    diagnostic: Boolean(group.diagnostic),
  }))
  return {
    ...run,
    grouping_mode: nextMode,
    drafts: {
      ...drafts,
      review_outline: {
        ...reviewOutline,
        grouping_mode: nextMode,
        topic_groups: topicGroups,
        grouped_outlines: groupedOutlines,
      },
    },
  }
}

function getRunProgressSummary(run) {
  const matrixReady = Number(run?.ready_count || 0)
  const matrixTotal = Number(run?.total_count || run?.paper_count || 0)
  const draftReady = Number(run?.draft_ready_count || 0)
  const draftTotal = Number(run?.draft_total_count || 0)
  const draftStatus = run?.draft_status || 'idle'
  const matrixStageLabel = run?.stage_label || RUN_STATUS_LABELS[run?.status] || '已完成'
  const draftStageLabel = run?.draft_stage_label || '综述草稿处理中'
  return {
    matrixLine: matrixTotal ? `矩阵综述卡片 ${matrixReady}/${matrixTotal}` : '矩阵综述卡片待准备',
    draftLine: draftTotal ? `草稿来源卡片 ${draftReady}/${draftTotal}` : '草稿来源卡片待准备',
    matrixStageLabel,
    draftStageLabel,
    draftStatus,
  }
}

function MatrixRunRail({
  activeRunId,
  collapsed,
  editingRunId,
  editingRunTitle,
  menuOpenId,
  runs,
  onCreateNew,
  onDeleteRun,
  onEditingRunTitleChange,
  onOpenRunPapers,
  onRefreshRun,
  onRenameRun,
  onSaveRunTitle,
  onRetryRun,
  onSelectRun,
  onStartRenameRun,
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
          const progressMeta = getRunProgressMeta(run)
          const isRunning = RUNNING_STATUSES.has(run.status) || run?.draft_status === 'running'
          const isFailed = run.status === 'failed' || run?.draft_status === 'failed'
          const hasDeletedPapers = Boolean(run.has_deleted_papers)
          const showProgress = isRunning || isFailed
          const runDisplayTitle = getRunDisplayTitle(run)
          const showBadgeRow = isActive || run.has_updates || hasDeletedPapers
          const isEditing = editingRunId === run.id
          return (
            <div
              key={run.id}
              className={`matrix-run-card${isActive ? ' is-active' : ''}${isRunning ? ' is-running' : ''}${isFailed ? ' is-failed' : ''}`}
            >
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
                    {showBadgeRow ? (
                      <span className="matrix-run-card__eyebrow-row">
                        {isActive ? <span className="matrix-run-card__badge is-active">当前批次</span> : null}
                        {run.has_updates ? <span className="matrix-run-card__badge is-warning">有更新</span> : null}
                      </span>
                    ) : null}
                    <span className="matrix-run-card__title-row">
                      {isEditing ? (
                        <input
                          className="matrix-run-card__title-input"
                          value={editingRunTitle}
                          maxLength={160}
                          onChange={(event) => onEditingRunTitleChange(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              onSaveRunTitle(run.id)
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              onRenameRun(null)
                            }
                          }}
                          onBlur={() => onSaveRunTitle(run.id)}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="matrix-run-card__title"
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            onStartRenameRun(run)
                          }}
                          title="双击重命名批次"
                        >
                          {runDisplayTitle}
                        </span>
                      )}
                      <span className="matrix-run-card__title-side">
                        {showProgress ? (
                          <CircleProgress
                            value={progressMeta.value}
                            status={progressMeta.status}
                            label={progressMeta.label}
                          />
                        ) : null}
                      </span>
                    </span>
                    <span className="matrix-run-card__meta">
                      {run.paper_count} 篇 · {formatDate(run.created_at)}
                    </span>
                    {showProgress ? (
                      <span className={`matrix-run-card__status is-${run.status}`}>
                        {progressMeta.detail}
                      </span>
                    ) : null}
                    {showProgress ? (
                      <span className={`matrix-run-card__progress is-${progressMeta.status}`}>
                        <span
                          className="matrix-run-card__progress-bar"
                          style={{ width: `${Math.max(0, Math.min(100, Number(progressMeta.value || 0)))}%` }}
                        />
                      </span>
                    ) : null}
                    {showProgress ? (
                      <span className="matrix-run-card__meta">{progressMeta.helper}</span>
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
                      <button type="button" onClick={() => onStartRenameRun(run)}>
                        <PenSquare size={14} />
                        <span>重命名</span>
                      </button>
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
  topicGroups = [],
  activeTopicGroupId = 'all',
  groupingMode = 'topic_first',
  busy = false,
  onChangeTab,
  onChangeTopicGroup,
  onChangeGroupingMode,
  onRefreshStatus,
  onExport,
  onToggleExportMenu,
}) {
  const exportDisabled = !currentRun || currentRun.status !== 'completed'
  const showTopicGroups = topicGroups.length > 1
  const groupingModeDisabled = busy || !currentRun?.id || currentRun?.status !== 'completed' || currentRun?.draft_status !== 'completed'
  return (
    <header className="matrix-content-header">
      <div className="matrix-content-header__main">
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
            className={`matrix-content-tab${activeTab === 'outline' ? ' is-active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'outline'}
            onClick={() => onChangeTab('outline')}
          >
            <ListTree size={15} />
            <span>综述大纲</span>
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
          <div className="matrix-topic-mode">
            <button
              type="button"
              className={`matrix-topic-mode__chip${groupingMode === 'topic_first' ? ' is-active' : ''}`}
              onClick={() => onChangeGroupingMode?.('topic_first')}
              disabled={groupingModeDisabled}
              title={groupingModeDisabled ? '请先等当前批次矩阵和草稿都完成，再切换分组逻辑。' : undefined}
            >
              主题优先
            </button>
            <button
              type="button"
              className={`matrix-topic-mode__chip${groupingMode === 'method_first' ? ' is-active' : ''}`}
              onClick={() => onChangeGroupingMode?.('method_first')}
              disabled={groupingModeDisabled}
              title={groupingModeDisabled ? '请先等当前批次矩阵和草稿都完成，再切换分组逻辑。' : undefined}
            >
              方法优先
            </button>
          </div>
          <button
            type="button"
            className="matrix-secondary-button"
            onClick={onRefreshStatus}
            disabled={busy || !currentRun?.id}
          >
            <RefreshCcw size={14} />
            刷新并补齐
          </button>
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
      </div>

      {showTopicGroups ? (
        <div className="matrix-topic-switcher">
          <span className="matrix-topic-switcher__label">主题范围</span>
          <div className="matrix-topic-switcher__chips">
            <button
              type="button"
              className={`matrix-topic-switcher__chip${activeTopicGroupId === 'all' ? ' is-active' : ''}`}
              onClick={() => onChangeTopicGroup?.('all')}
            >
              全部论文
            </button>
            {topicGroups.map((group, index) => (
              <button
                type="button"
                key={group.group_id || `${group.label || 'group'}-${index}`}
                className={`matrix-topic-switcher__chip${activeTopicGroupId === group.group_id ? ' is-active' : ''}`}
                onClick={() => onChangeTopicGroup?.(group.group_id)}
              >
                {group.label || `主题 ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
  const missingCount = visiblePapers.filter((paper) => selectedIds.has(paper.id) && !paper.sourceReady).length

  if (!open) return null

  return (
    <div className="matrix-dialog" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="matrix-dialog__panel" role="dialog" aria-modal="true" aria-label="选择论文生成矩阵">
        <header className="matrix-dialog__header">
          <div>
            <strong>选择论文生成矩阵</strong>
            <p>确认后会立即创建批次，缺少综述草稿来源卡片的论文会在后台继续补齐，你可以先去处理其他事。</p>
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
          {missingCount ? <span>{missingCount} 篇还缺草稿来源，创建后会在后台继续补齐</span> : <span>所选论文都已具备综述草稿来源</span>}
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
                  <em className={`matrix-paper-pick__status is-${paper.sourceTone}`}>
                    {paper.sourceReady ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
                    <span>{paper.sourceLabel}</span>
                  </em>
                  {!paper.sourceReady && paper.missingSourceTypes.length ? (
                    <small>待补：{formatSourceMissingTypes(paper.missingSourceTypes)}</small>
                  ) : null}
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

function ResearchMatrixTable({ run, onEditCell }) {
  const rows = run?.matrix?.rows || []
  const fields = useMemo(() => normalizeFields(run?.matrix?.fields), [run])
  const [previewCell, setPreviewCell] = useState(null)

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
        <div className="research-matrix-table__summary">
          <strong>矩阵表格</strong>
          <span>{rows.length} 行 · {fields.length} 个字段</span>
        </div>
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
            {rows.map((row) => (
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

function MatrixDraftsView({ run, onCopySection, onCopyAll }) {
  const drafts = getOrderedDraftSections(run)
  const draftStatus = run?.draft_status || 'idle'
  const total = run?.draft_total_count || 0
  const ready = run?.draft_ready_count || 0
  const failed = run?.draft_failed_count || 0
  const progress = run?.draft_progress_percent || 0
  const hasDraftContent = drafts.some(([, draft]) => (
    normalizeDraftParagraphs(draft).length
    || normalizeDraftItems(draft).length
    || Boolean(draft?.copy_ready)
  ))
  const stageLabel = run?.draft_stage_label || '整理综述草稿中'
  if (!run) {
    return (
      <section className="matrix-drafts-empty">
        <h3>综述草稿</h3>
        <p>先选择一条历史批次，这里会展示这批文献整理出的综述段落草稿。</p>
      </section>
    )
  }

  if ((draftStatus === 'running' && !hasDraftContent) || (draftStatus === 'idle' && !drafts.length)) {
    return (
      <section className="matrix-drafts-view">
        <div className="matrix-pending-view__hero matrix-drafts-view__hero">
          <CircleProgress value={progress} status={draftStatus} label={`${ready}/${total || '--'}`} />
          <div className="matrix-pending-view__summary">
            <span className="matrix-pending-view__eyebrow">综述草稿任务流</span>
            <h3>{run?.title || '当前批次'}</h3>
            <p>{stageLabel}</p>
            <small>
              {total ? `${ready}/${total} 个来源卡片已就绪` : '正在准备来源卡片'}
              {failed ? ` · ${failed} 个来源需要补齐` : ''}
            </small>
          </div>
        </div>
        {run?.draft_error_message ? (
          <div className="matrix-inline-message">{run.draft_error_message}</div>
        ) : null}
        <div className="matrix-drafts-view__pending-copy">
          <p>草稿只会使用当前批次论文的 `overview + review + reproduction`。如果来源还不够硬，完成后会明确标出“依据较弱，建议回查原文”。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="matrix-drafts-view">
      <div className="matrix-drafts-view__header">
        <div className="matrix-drafts-view__summary">
          <span className="matrix-drafts-view__eyebrow">草稿视图</span>
          <strong>证据链驱动的单列长文稿</strong>
        </div>
        <div className="matrix-drafts-view__header-actions">
          <span>{drafts.length} 节</span>
          <button type="button" className="matrix-secondary-button" onClick={onCopyAll}>
            复制整稿
          </button>
        </div>
      </div>
      <div className="matrix-drafts-view__toc">
        {drafts.map(([key, draft]) => (
          <a key={key} className="matrix-drafts-view__toc-link" href={`#draft-section-${key}`}>
            {draft?.title || key}
          </a>
        ))}
      </div>
      <div className="matrix-drafts-view__document">
        {drafts.map(([key, draft]) => (
          <article key={key} id={`draft-section-${key}`} className="matrix-drafts-view__section">
            <div className="matrix-drafts-view__section-head">
              <div>
                <h3>{draft.title}</h3>
                {draft?.ai_generated ? (
                  <small className="matrix-drafts-view__meta">AI 受约束整合</small>
                ) : draft?.diagnostic ? (
                  <small className="matrix-drafts-view__meta">主题诊断</small>
                ) : draft?.fallback_used ? (
                  <small className="matrix-drafts-view__meta">规则回退稿</small>
                ) : null}
              </div>
              <button type="button" className="matrix-soft-button" onClick={() => onCopySection(draft)}>
                复制本节
              </button>
            </div>

            {normalizeDraftItems(draft).length ? (
              <div className="matrix-drafts-view__quotes">
                {normalizeDraftItems(draft).map((item, index) => (
                  <div key={`${item.paper_title || 'quote'}-${index}`} className="matrix-drafts-view__quote-item">
                    <blockquote>{item.quote}</blockquote>
                    <div className="matrix-drafts-view__quote-meta">
                      <span>{item.paper_title || '未命名论文'} · {item.source_card_type || 'review'} · p.{item.page || '?'}</span>
                      {item.usage_note ? <em>{item.usage_note}</em> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="matrix-drafts-view__body">
                {normalizeDraftParagraphs(draft).map((paragraph, index) => (
                  <div key={`${key}-paragraph-${index}`} className={`matrix-drafts-view__paragraph${paragraph.confidence === 'weak' ? ' is-weak' : ''}`}>
                    <p>{paragraph.text}</p>
                    <div className="matrix-drafts-view__footnote">{formatCitationFootnotes(paragraph.citations || [])}</div>
                    {paragraph.confidence === 'weak' ? (
                      <div className="matrix-drafts-view__warning">依据较弱，建议回查原文。</div>
                    ) : null}
                  </div>
                ))}
                {!normalizeDraftParagraphs(draft).length && draft?.content ? (
                  <div className="matrix-drafts-view__paragraph is-weak">
                    <p>{draft.content}</p>
                    <div className="matrix-drafts-view__footnote">{(draft.source_titles || []).join('；') || '当前缺少明确脚注'}</div>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function ReviewOutlineView({ run, topicGroups = [], activeTopicGroupId = 'all', onCopyAll }) {
  const outline = run?.drafts?.review_outline || null
  const topicDiagnostic = run?.drafts?.topic_diagnostic || null
  const sections = Array.isArray(outline?.outline_sections) ? outline.outline_sections : []
  const groups = Array.isArray(outline?.topic_groups) ? outline.topic_groups : []
  const consensusPoints = Array.isArray(outline?.consensus_points) ? outline.consensus_points : []
  const divergencePoints = Array.isArray(outline?.divergence_points) ? outline.divergence_points : []
  const gapPoints = Array.isArray(outline?.gap_points) ? outline.gap_points : []
  const showGroupingControls = topicGroups.length > 1
  const isDiagnostic = Boolean(outline?.diagnostic && groups.length > 1)
  const activeGroupLabel = outline?.active_group_label || ''
  const outlineTitle = activeGroupLabel ? `${activeGroupLabel} · 综述大纲` : '当前批次综述大纲'
  const briefTitle = isDiagnostic ? '当前批次建议先按主题分开整理，再分别写小综述。' : '当前批次主题比较集中，可以直接沿着下面的大纲继续写。'
  const briefMeta = isDiagnostic
    ? `已识别 ${groups.length} 个主题组，建议先切换到单个主题组，再查看对应矩阵和草稿。`
    : '先看这一页的章节目标和要点，再进入综述草稿会更清楚。'

  if (!run) {
    return (
      <section className="matrix-drafts-empty">
        <h3>综述大纲</h3>
        <p>先选择一条历史批次，这里会展示当前批次的综述写作大纲与主题分组。</p>
      </section>
    )
  }

  if (!outline && !topicDiagnostic) {
    return (
      <section className="matrix-drafts-view">
        <div className="matrix-drafts-view__pending-copy">
          <p>大纲正在准备中，完成后这里会先展示主题分组和章节结构，再进入综述草稿。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="matrix-drafts-view matrix-outline-view">
      <div className="matrix-drafts-view__header">
        <div className="matrix-drafts-view__summary">
          <span className="matrix-drafts-view__eyebrow">提纲视图</span>
          <strong>{isDiagnostic ? '当前批次建议先分组，再分别写小综述' : outlineTitle}</strong>
        </div>
        <div className="matrix-drafts-view__header-actions">
          <span>{sections.length || 0} 节</span>
          <button type="button" className="matrix-secondary-button" onClick={onCopyAll}>
            复制大纲
          </button>
        </div>
      </div>

      <div className="matrix-outline-scroll">
        <section className={`matrix-outline-brief${isDiagnostic ? ' is-warning' : ''}`}>
          <div className="matrix-outline-brief__intro">
            <span className={`matrix-outline-brief__badge${isDiagnostic ? ' is-warning' : ''}`}>
              {isDiagnostic ? '建议先分组' : '可直接写作'}
            </span>
            <div className="matrix-outline-brief__copy">
              <strong>{briefTitle}</strong>
              <p>{briefMeta}</p>
              {activeGroupLabel ? <span className="matrix-outline-brief__focus">当前查看：{activeGroupLabel}</span> : null}
            </div>
          </div>

          {isDiagnostic && topicDiagnostic?.content ? (
            <details className="matrix-outline-brief__details">
              <summary>查看分组原因</summary>
              <p>{topicDiagnostic.content}</p>
            </details>
          ) : null}

          {isDiagnostic && showGroupingControls ? (
            <div className="matrix-outline-brief__hint">
              当前可以在页面顶部切换主题范围，文献矩阵、综述大纲和综述草稿会一起联动。
            </div>
          ) : null}
        </section>

        {isDiagnostic ? (
          <section className="matrix-outline-groups-shell">
            <div className="matrix-outline-groups-shell__head">
              <strong>主题分组建议</strong>
              <span>这块只在混合主题批次出现</span>
            </div>
            <div className="matrix-outline-groups">
              {groups.map((group, index) => (
                <section key={`${group.label || 'group'}-${index}`} className="matrix-outline-group">
                  <div className="matrix-outline-group__title">
                    <GitBranch size={15} />
                    <strong>{group.label || `主题 ${index + 1}`}</strong>
                  </div>
                  <p>{(group.paper_titles || []).join('、') || '暂无论文'}</p>
                </section>
              ))}
            </div>
          </section>
        ) : null}

        {(consensusPoints.length || divergencePoints.length || gapPoints.length) ? (
          <div className="matrix-outline-insights">
            {consensusPoints.length ? (
              <article className="matrix-outline-insight">
                <strong>当前共识</strong>
                <ul className="matrix-outline-card__list">
                  {consensusPoints.map((item, index) => <li key={`consensus-${index}`}>{item}</li>)}
                </ul>
              </article>
            ) : null}
            {divergencePoints.length ? (
              <article className="matrix-outline-insight">
                <strong>主要分歧</strong>
                <ul className="matrix-outline-card__list">
                  {divergencePoints.map((item, index) => <li key={`divergence-${index}`}>{item}</li>)}
                </ul>
              </article>
            ) : null}
            {gapPoints.length ? (
              <article className="matrix-outline-insight">
                <strong>研究空白</strong>
                <ul className="matrix-outline-card__list">
                  {gapPoints.map((item, index) => <li key={`gap-${index}`}>{item}</li>)}
                </ul>
              </article>
            ) : null}
          </div>
        ) : null}

        {sections.length ? (
          <div className="matrix-outline-document">
            {sections.map((section, index) => (
              <article key={section.key || index} className="matrix-outline-section">
                <div className="matrix-outline-section__head">
                  <div>
                    <span className="matrix-outline-section__index">{`${index + 1}`.padStart(2, '0')}</span>
                    <div className="matrix-outline-section__heading">
                      <h3>{section.title || `章节 ${index + 1}`}</h3>
                      <span>{section.goal || '章节目标'}</span>
                    </div>
                  </div>
                </div>

                <div className="matrix-outline-card">
                  {Array.isArray(section.points) && section.points.length ? (
                    <div className="matrix-outline-card__block">
                      <div className="matrix-outline-card__label">
                        <Network size={15} />
                        <span>本节要点</span>
                      </div>
                      <ul className="matrix-outline-card__list">
                        {section.points.map((point, pointIndex) => <li key={`${section.key}-point-${pointIndex}`}>{point}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  {section.summary ? (
                    <div className="matrix-outline-card__block matrix-outline-card__block--summary">
                      <div className="matrix-outline-card__label">
                        <ScrollText size={15} />
                        <span>写作目的</span>
                      </div>
                      <p className="matrix-outline-card__summary">{section.summary}</p>
                    </div>
                  ) : null}

                  {Array.isArray(section.source_titles) && section.source_titles.length ? (
                    <div className="matrix-outline-card__block">
                      <div className="matrix-outline-card__label">
                        <FileText size={15} />
                        <span>本节参考论文</span>
                      </div>
                      <div className="matrix-outline-card__tags">
                        {section.source_titles.map((title, sourceIndex) => <span key={`${section.key}-source-${sourceIndex}`}>{title}</span>)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function PendingRunView({ busy, run, onOpenRunPapers, onRetryRun, onRefreshStatus }) {
  const draftStatus = run?.draft_status || 'idle'
  const draftStageLabel = run?.draft_stage_label || '综述草稿处理中'
  const draftTotal = run?.draft_total_count || 0
  const draftReady = run?.draft_ready_count || 0
  const draftFailed = run?.draft_failed_count || 0
  const draftProgress = run?.draft_progress_percent || 0
  const matrixStageLabel = run?.stage_label || RUN_STATUS_LABELS[run?.status] || run?.status || '处理中'
  const matrixTotal = run?.total_count || run?.paper_count || 0
  const matrixReady = run?.ready_count || 0
  const matrixFailed = run?.failed_count || 0

  return (
    <section className="matrix-pending-view">
      <div className="matrix-pending-view__hero">
        <CircleProgress value={draftProgress} status={draftStatus} label={`${draftReady}/${draftTotal || '--'}`} />
        <div className="matrix-pending-view__summary">
          <span className="matrix-pending-view__eyebrow">处理中批次</span>
          <h3>{run?.title || '当前批次'}</h3>
          <p>{draftStageLabel}</p>
          <small>
            {draftTotal ? `草稿来源 ${draftReady}/${draftTotal}` : '正在准备草稿来源'}
            {draftFailed ? ` · ${draftFailed} 个来源需要继续补齐` : ''}
          </small>
        </div>
      </div>

      {run?.has_deleted_papers && run?.deleted_paper_message ? (
        <div className="matrix-inline-message">{run.deleted_paper_message}</div>
      ) : (run?.draft_error_message || run?.error_message) ? (
        <div className="matrix-inline-message">{run?.draft_error_message || run?.error_message}</div>
      ) : null}

      <div className="matrix-pending-view__summary">
        <strong>矩阵基础进度</strong>
        <small>
          {matrixStageLabel}
          {matrixTotal ? ` · ${matrixReady}/${matrixTotal}` : ''}
          {matrixFailed ? ` · ${matrixFailed} 篇需要继续补齐` : ''}
        </small>
      </div>

      <div className="matrix-pending-view__actions">
        <button type="button" className="matrix-secondary-button" onClick={onRefreshStatus} disabled={busy}>
          <RefreshCcw size={14} />
          刷新并补齐
        </button>
        <button type="button" className="matrix-secondary-button" onClick={() => onOpenRunPapers(run.id)} disabled={busy}>
          <Eye size={14} />
          查看论文状态
        </button>
        {(run?.status === 'failed' || run?.draft_status === 'failed') && !run?.has_deleted_papers ? (
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
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [creatingRun, setCreatingRun] = useState(false)
  const [, startTransition] = useTransition()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [runMenuOpenId, setRunMenuOpenId] = useState(null)
  const [reviewStatuses, setReviewStatuses] = useState(new Map())
  const [showRunPapers, setShowRunPapers] = useState(false)
  const [activeTab, setActiveTab] = useState('matrix')
  const [activeTopicGroupId, setActiveTopicGroupId] = useState('all')
  const [groupingMode, setGroupingMode] = useState('topic_first')
  const [editingCell, setEditingCell] = useState(null)
  const [editingRunId, setEditingRunId] = useState(null)
  const [editingRunTitle, setEditingRunTitle] = useState('')

  const selectablePapers = useMemo(
    () => buildSelectablePapers(recentPapers, folders, uncategorizedFolderId, reviewStatuses),
    [folders, recentPapers, reviewStatuses, uncategorizedFolderId],
  )

  const hasPendingRuns = useMemo(
    () => runs.some((run) => RUNNING_STATUSES.has(run.status) || run?.draft_status === 'running') || RUNNING_STATUSES.has(currentRun?.status) || currentRun?.draft_status === 'running',
    [currentRun?.draft_status, currentRun?.status, runs],
  )

  const topicGroups = useMemo(() => getTopicGroups(currentRun), [currentRun])
  const displayRun = useMemo(
    () => filterRunByTopicGroup(currentRun, activeTopicGroupId),
    [activeTopicGroupId, currentRun],
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
          if (!cancelled) {
            setCurrentRun(detail)
            setActiveTopicGroupId('all')
            setGroupingMode(detail?.drafts?.review_outline?.grouping_mode || detail?.grouping_mode || 'topic_first')
            if (detail?.has_deleted_papers && detail?.deleted_paper_message) {
              setNotice({ type: 'error', text: detail.deleted_paper_message })
            }
          }
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
        const paperStatuses = {}
        await Promise.all(DRAFT_REQUIRED_TYPES.map(async (summaryType) => {
          try {
            const status = await fetchPaperSummaryStatus(paper.id, summaryType)
            paperStatuses[summaryType] = status
          } catch {
            paperStatuses[summaryType] = { status: 'idle', summary: null, error_message: '' }
          }
        }))
        if (!cancelled) next.set(paper.id, paperStatuses)
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
        if (currentRun?.id && (RUNNING_STATUSES.has(currentRun.status) || currentRun?.draft_status === 'running')) {
          const detail = await fetchResearchMatrixRun(currentRun.id)
          if (!cancelled) {
            setCurrentRun(detail)
            if (detail.status === 'completed' && detail.draft_status === 'completed') {
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

  function startRenameRun(run) {
    setRunMenuOpenId(null)
    if (!run) {
      setEditingRunId(null)
      setEditingRunTitle('')
      return
    }
    setEditingRunId(run.id)
    setEditingRunTitle(getRunDisplayTitle(run))
  }

  async function loadRuns(selectFirst = false) {
    const payload = await fetchResearchMatrixRuns()
    const nextRuns = payload?.runs || []
    setRuns(nextRuns)
    if (selectFirst && nextRuns[0]) {
      const detail = await fetchResearchMatrixRun(nextRuns[0].id)
      setCurrentRun(detail)
      setActiveTopicGroupId('all')
    }
    if (selectFirst && !nextRuns.length) {
      setCurrentRun(null)
      setActiveTopicGroupId('all')
    }
  }

  async function openRunPapers(runId) {
    setBusy(true)
    setNotice(null)
    try {
      const detail = currentRun?.id === runId ? currentRun : await fetchResearchMatrixRun(runId)
      setCurrentRun(detail)
      setActiveTopicGroupId('all')
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
    if (selectedIds.size < 1 || creatingRun) return
    const paperIds = Array.from(selectedIds)
    const nextGroupingMode = groupingMode
    setCreatingRun(true)
    setNotice(null)
    setShowCreateDialog(false)
    resetCreateSelection()
    setNotice({ type: 'success', text: '已加入后台生成，你可以继续处理别的事。' })
    try {
      const detail = await createResearchMatrixRun({
        title: '',
        paper_ids: paperIds,
        include_reproduction: true,
        grouping_mode: nextGroupingMode,
      })
      setCurrentRun(detail)
      setActiveTopicGroupId('all')
      setGroupingMode(detail?.drafts?.review_outline?.grouping_mode || detail?.grouping_mode || nextGroupingMode)
      setRuns((previous) => [detail, ...previous.filter((run) => run.id !== detail.id)])
      loadRuns(false).catch(() => {})
      setNotice({
        type: 'success',
        text: detail.status === 'completed'
          ? '当前批次已直接生成完成。'
          : '批次已加入后台生成，你可以继续查看别的文献或批次。',
      })
    } catch (err) {
      setShowCreateDialog(true)
      setNotice({ type: 'error', text: err.message || '生成矩阵失败' })
    } finally {
      setCreatingRun(false)
    }
  }

  async function handleSelectRun(runId) {
    setBusy(true)
    setNotice(null)
    setExportMenuOpen(false)
    setRunMenuOpenId(null)
    setEditingRunId(null)
    try {
      const detail = await fetchResearchMatrixRun(runId)
      setCurrentRun(detail)
      setActiveTopicGroupId('all')
      setGroupingMode(detail?.drafts?.review_outline?.grouping_mode || detail?.grouping_mode || 'topic_first')
      if (detail?.has_deleted_papers && detail?.deleted_paper_message) {
        setNotice({ type: 'error', text: detail.deleted_paper_message })
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '打开矩阵记录失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRefreshCurrentRunStatus() {
    if (!currentRun?.id) return
    setBusy(true)
    setNotice(null)
    try {
      const latestRun = await fetchResearchMatrixRun(currentRun.id)
      if (latestRun?.has_deleted_papers) {
        setCurrentRun(latestRun)
        setNotice({ type: 'error', text: latestRun.deleted_paper_message || '当前批次引用的原论文已删除，请重新建批次。' })
        return
      }
      const shouldRecheck = (
        latestRun?.status !== 'completed'
        || latestRun?.draft_status !== 'completed'
        || latestRun?.missing_count
        || latestRun?.draft_failed_count
        || ((latestRun?.draft_ready_count || 0) < (latestRun?.draft_total_count || 0))
      )
      const detail = shouldRecheck
        ? await retryPendingResearchMatrixRun(currentRun.id)
        : latestRun
      setCurrentRun(detail)
      setGroupingMode(detail?.drafts?.review_outline?.grouping_mode || detail?.grouping_mode || groupingMode)
      await loadRuns(false)
      setNotice({
        type: 'success',
        text: shouldRecheck ? '已刷新当前批次，并重新检查缺失卡片。' : '当前批次状态已刷新。',
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '刷新当前批次失败' })
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
      const latestRun = await fetchResearchMatrixRun(targetRunId)
      if (latestRun?.has_deleted_papers) {
        setCurrentRun(latestRun)
        setNotice({ type: 'error', text: latestRun.deleted_paper_message || '当前批次引用的原论文已删除，请重新建批次。' })
        return
      }
      const currentTitle = currentRun?.id === targetRunId
        ? currentRun.title
        : latestRun?.title || runs.find((run) => run.id === targetRunId)?.title
      const detail = await refreshResearchMatrixRun(targetRunId, {
        title: `${getRunDisplayTitle({ title: currentTitle })} - 新版本`,
        grouping_mode: groupingMode,
      })
      setCurrentRun(detail)
      await loadRuns(false)
      setNotice({
        type: 'success',
        text: detail.status === 'completed'
          ? '已基于当前来源生成一个新版本批次。'
          : '已创建新版本批次，后台会继续补齐矩阵和草稿。',
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '刷新批次失败' })
    } finally {
      setBusy(false)
    }
  }

  async function handleChangeGroupingMode(nextMode) {
    if (!currentRun || busy || groupingMode === nextMode) return
    setGroupingMode(nextMode)
    setActiveTopicGroupId('all')
    setNotice(null)
    const detail = buildGroupedRunView(currentRun, nextMode)
    setCurrentRun(detail)
    setRuns((previous) => previous.map((run) => (run.id === currentRun.id ? { ...run, grouping_mode: nextMode } : run)))
    setNotice({
      type: 'success',
      text: nextMode === 'method_first' ? '已切换到方法优先视图。' : '已切换到主题优先视图。',
    })
  }

  async function handleRetryRun(runId) {
    if (!runId) return
    setBusy(true)
    setNotice(null)
    setRunMenuOpenId(null)
    try {
      const latestRun = await fetchResearchMatrixRun(runId)
      if (latestRun?.has_deleted_papers) {
        setCurrentRun(latestRun)
        setNotice({ type: 'error', text: latestRun.deleted_paper_message || '当前批次引用的原论文已删除，请重新建批次。' })
        return
      }
      const detail = await retryPendingResearchMatrixRun(runId)
      if (currentRun?.id === runId) {
        setCurrentRun(detail)
      }
      await loadRuns(false)
      setNotice({ type: 'success', text: '已重新加入后台任务，继续补齐当前批次。' })
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
      if (editingRunId === runId) {
        setEditingRunId(null)
        setEditingRunTitle('')
      }
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

  async function handleSaveRunTitle(runId) {
    const nextTitle = editingRunTitle.trim()
    if (!editingRunId || editingRunId !== runId) return
    setBusy(true)
    setNotice(null)
    try {
      const detail = await updateResearchMatrixRun(runId, { title: nextTitle })
      if (currentRun?.id === runId) {
        setCurrentRun(detail)
      }
      await loadRuns(false)
      setEditingRunId(null)
      setEditingRunTitle('')
      setNotice({ type: 'success', text: '批次名称已更新。' })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || '批次名称更新失败' })
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

  async function handleCopyDraftSection(draft) {
    const ok = await copyTextToClipboard(buildDraftCopyText(draft))
    setNotice({
      type: ok ? 'success' : 'error',
      text: ok ? `“${draft?.title || '当前章节'}”已复制。` : '复制失败，请稍后再试。',
    })
  }

  async function handleCopyAllDrafts() {
    const ok = await copyTextToClipboard(buildIntegratedCopyText(displayRun))
    setNotice({
      type: ok ? 'success' : 'error',
      text: ok ? '整份综述草稿已复制。' : '复制失败，请稍后再试。',
    })
  }

  async function handleCopyOutline() {
    const ok = await copyTextToClipboard(buildOutlineCopyText(displayRun))
    setNotice({
      type: ok ? 'success' : 'error',
      text: ok ? '综述大纲已复制。' : '复制失败，请稍后再试。',
    })
  }

  function handleExport(format) {
    setExportMenuOpen(false)
    if (!displayRun || displayRun.status !== 'completed') return
    if (format === 'excel') {
      exportRunExcel(displayRun)
      return
    }
    exportRunWord(displayRun)
  }

  function beginEditCell(cell) {
    if (!displayRun || displayRun.status !== 'completed') return
    setEditingCell(cell)
  }

  return (
    <section className={`research-matrix-shell${railCollapsed ? ' is-rail-collapsed' : ''}`}>
      <MatrixRunRail
        activeRunId={currentRun?.id}
        collapsed={railCollapsed}
        editingRunId={editingRunId}
        editingRunTitle={editingRunTitle}
        menuOpenId={runMenuOpenId}
        runs={runs}
        onCreateNew={openCreateDialog}
        onDeleteRun={handleDeleteRun}
        onEditingRunTitleChange={setEditingRunTitle}
        onOpenRunPapers={openRunPapers}
        onRefreshRun={handleRefreshRun}
        onRenameRun={startRenameRun}
        onSaveRunTitle={handleSaveRunTitle}
        onRetryRun={handleRetryRun}
        onSelectRun={handleSelectRun}
        onStartRenameRun={startRenameRun}
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
          currentRun={displayRun}
          exportMenuOpen={exportMenuOpen}
          topicGroups={topicGroups}
          activeTopicGroupId={activeTopicGroupId}
          groupingMode={groupingMode}
          busy={busy}
          onChangeTab={setActiveTab}
          onChangeTopicGroup={setActiveTopicGroupId}
          onChangeGroupingMode={handleChangeGroupingMode}
          onRefreshStatus={handleRefreshCurrentRunStatus}
          onExport={handleExport}
          onToggleExportMenu={(event) => {
            stopMenuBubble(event)
            setExportMenuOpen((value) => !value)
          }}
        />

        {notice ? <div className={`matrix-inline-message${notice.type === 'success' ? ' is-success' : ''}`}>{notice.text}</div> : null}

        <div className="research-matrix-main__content">
          {currentRun && currentRun.status !== 'completed' && !['drafts', 'outline'].includes(activeTab) ? (
            <PendingRunView
              busy={busy}
              run={displayRun}
              onOpenRunPapers={openRunPapers}
              onRetryRun={handleRetryRun}
              onRefreshStatus={handleRefreshCurrentRunStatus}
            />
          ) : activeTab === 'matrix' ? (
            <ResearchMatrixTable
              run={displayRun}
              onEditCell={beginEditCell}
            />
          ) : activeTab === 'outline' ? (
            <ReviewOutlineView
              run={displayRun}
              topicGroups={topicGroups}
              activeTopicGroupId={activeTopicGroupId}
              onCopyAll={handleCopyOutline}
            />
          ) : (
            <MatrixDraftsView
              run={displayRun}
              onCopySection={handleCopyDraftSection}
              onCopyAll={handleCopyAllDrafts}
            />
          )}
        </div>
      </main>

      <MatrixCreateDialog
        busy={creatingRun}
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
