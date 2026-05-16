import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookCopy,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderPlus,
  LibraryBig,
  Network,
  Moon,
  MoreHorizontal,
  Package2,
  Radar,
  RotateCcw,
  Search,
  SearchCheck,
  Sun,
  Sunrise,
  TimerReset,
  Trash2,
} from 'lucide-react'
import { LiteratureSearchPage } from './LiteratureSearchPage'
import { ReadingInsightSection } from './ReadingInsightSection'
import { ResearchMatrixPage } from './ResearchMatrixPage'
import { fetchResearchMatrixRuns } from '../../services/paperReaderApi'

const homeSections = [
  { id: 'recent', label: '阅读记录', icon: Clock3 },
  { id: 'library', label: '我的文献', icon: LibraryBig },
  { id: 'literature-search', label: '文献检索', icon: SearchCheck },
  { id: 'insights', label: '阅读信息站', icon: Radar },
  { id: 'matrix', label: '文献矩阵', icon: Network },
  { id: 'trash', label: '回收站', icon: Trash2 },
]

const LIBRARY_STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '待阅读' },
  { id: 'reading', label: '阅读中' },
  { id: 'summary-pending', label: '待总结' },
  { id: 'notes', label: '有笔记' },
  { id: 'summary', label: '已总结' },
  { id: 'translation', label: '已翻译' },
  { id: 'stale', label: '待更新' },
]

const PENDING_TASK_ORDER = [
  'summary-pending',
  'stale',
  'unread',
  'matrix-pending',
  'trash-soon',
]

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

function formatDaysLeft(timestamp) {
  const ms = Number(timestamp) - Date.now()
  const days = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
  if (days <= 0) return '今天到期'
  return `还剩 ${days} 天`
}

function classifyRecentGroup(timestamp) {
  const now = new Date()
  const currentDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDate = new Date(timestamp)
  const targetDayStart = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
  )

  const dayDiff = Math.floor(
    (currentDayStart.getTime() - targetDayStart.getTime()) / (24 * 60 * 60 * 1000),
  )

  if (dayDiff <= 0) {
    return '今天'
  }

  if (dayDiff === 1) {
    return '昨天'
  }

  if (dayDiff <= 7) {
    return '七日内'
  }

  if (
    now.getFullYear() === targetDate.getFullYear() &&
    now.getMonth() === targetDate.getMonth()
  ) {
    return '本月更早'
  }

  return '更早'
}

function buildGroupedPapers(recentPapers, searchTerm) {
  const keyword = searchTerm.trim().toLowerCase()
  const filtered = keyword
    ? recentPapers.filter((paper) =>
        [paper.title, paper.fileName, paper.metadata.author, paper.folderName]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(keyword)),
      )
    : recentPapers

  const labels = ['今天', '昨天', '七日内', '本月更早', '更早']
  return labels
    .map((label) => ({
      label,
      items: filtered.filter((paper) => classifyRecentGroup(paper.lastViewedAt) === label),
    }))
    .filter((group) => group.items.length > 0)
}

function periodLabel(period) {
  if (period === 'morning') return '上午 (6-12时)'
  if (period === 'afternoon') return '下午 (12-18时)'
  if (period === 'evening') return '晚上 (18-次日6时)'
  return '--'
}

function periodIcon(period) {
  if (period === 'morning') return Sunrise
  if (period === 'afternoon') return Sun
  if (period === 'evening') return Moon
  return Clock3
}

function getTranslatedTitle(paper) {
  return paper.metadata?.translatedTitle || paper.metadata?.subject || '—'
}

function getPaperResourceMap(resourceOverview) {
  const next = {}
  ;(resourceOverview?.papers || []).forEach((item) => {
    next[String(item.paper_id)] = item
  })
  return next
}

function getPaperResourceEntries(paperId, paperResourcesById) {
  return paperResourcesById[String(paperId)]?.resources || []
}

function getPaperResourceEntry(resources, type) {
  return resources.find((resource) => resource.type === type) || null
}

function hasAnyResourceType(resources, types) {
  return types.some((type) => resources.some((resource) => resource.type === type))
}

function getResourceLabel(resourceType) {
  if (resourceType === 'summary_annotations') return '标注总结'
  if (resourceType === 'summary_overview') return '整篇总结'
  if (resourceType === 'summary_review') return '综述卡片'
  if (resourceType === 'summary_reproduction') return '复现总结'
  if (resourceType === 'summary_meeting') return '组会稿'
  if (resourceType === 'translation') return '全文翻译'
  if (resourceType === 'annotations') return '原文标注'
  if (resourceType === 'notes') return '笔记'
  return '资源'
}

function getPaperStatusFlags(paper, resources = []) {
  const annotationEntry = getPaperResourceEntry(resources, 'annotations')
  const notesEntry = getPaperResourceEntry(resources, 'notes')
  const summaryEntry = resources.find((resource) => String(resource.type || '').startsWith('summary_')) || null
  const translationEntry = getPaperResourceEntry(resources, 'translation')
  const staleResource = resources.find((resource) => resource.status === 'stale') || null
  const hasAnnotations = Boolean(annotationEntry)
  const hasNotes = Boolean(notesEntry)
  const hasSummary = Boolean(summaryEntry)
  const hasTranslation = Boolean(translationEntry)
  const isStale = Boolean(staleResource)
  const lastViewedAt = Number(paper?.lastViewedAt || 0)
  const ageHours = lastViewedAt ? (Date.now() - lastViewedAt) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY
  const isUnread = !Number.isFinite(lastViewedAt) || ageHours > 24 * 14
  const isReading = !isUnread && (!hasSummary || !hasNotes)
  const summaryPending = (hasAnnotations || hasNotes) && !hasSummary
  return {
    isUnread,
    isReading,
    hasAnnotations,
    hasNotes,
    hasSummary,
    hasTranslation,
    isStale,
    summaryPending,
    annotationCount: Number(annotationEntry?.count || 0),
    noteCount: Number(notesEntry?.count || 0),
    summaryStatus: summaryEntry?.status || '',
    translationStatus: translationEntry?.status || '',
    staleResourceType: staleResource?.type || '',
    staleResourceLabel: staleResource?.label || getResourceLabel(staleResource?.type || ''),
    staleResourcePreview: staleResource?.preview || '',
  }
}

function getPaperStatusLabel(flags) {
  if (flags.summaryPending) return '待补总结'
  if (flags.isStale) return `${flags.staleResourceLabel || '资源'}待更新`
  if (flags.isUnread) return '待阅读'
  if (flags.hasTranslation && flags.hasSummary) return '资料齐全'
  if (flags.isReading) return '阅读中'
  if (flags.hasNotes) return '有笔记'
  return '继续阅读'
}

function matchesLibraryStatusFilter(filterId, paper, paperResourcesById) {
  if (!filterId || filterId === 'all') return true
  const flags = getPaperStatusFlags(paper, getPaperResourceEntries(paper.id, paperResourcesById))
  if (filterId === 'unread') return flags.isUnread
  if (filterId === 'reading') return flags.isReading
  if (filterId === 'summary-pending') return flags.summaryPending
  if (filterId === 'notes') return flags.hasNotes
  if (filterId === 'summary') return flags.hasSummary
  if (filterId === 'translation') return flags.hasTranslation
  if (filterId === 'stale') return flags.isStale
  return true
}

function buildContinueWorkItem(recentPapers, paperResourcesById) {
  const currentPaper = recentPapers[0]
  if (!currentPaper) return null
  const resources = getPaperResourceEntries(currentPaper.id, paperResourcesById)
  const flags = getPaperStatusFlags(currentPaper, resources)
  const hintParts = []
  if (flags.summaryPending) hintParts.push('还没整理总结')
  if (flags.hasNotes) hintParts.push(`${flags.noteCount || 0} 条笔记可回看`)
  if (flags.hasTranslation) hintParts.push('已有全文翻译')
  if (flags.isStale) hintParts.push(flags.staleResourcePreview || `${flags.staleResourceLabel || '资源'}已经过期，建议重新生成`)
  return {
    paper: currentPaper,
    statusLabel: getPaperStatusLabel(flags),
    statusHint: hintParts[0] || '回到刚才的阅读现场，继续往下推进',
    statusTags: hintParts.filter((item) => item !== hintParts[0]).slice(0, 3),
  }
}

function buildPendingTasks({
  recentPapers,
  paperResourcesById,
  readingDashboard,
  trashPapers,
  matrixRuns,
}) {
  const tasks = []
  const overview = readingDashboard?.overview || {}
  const summaryPendingCount = recentPapers.filter((paper) =>
    matchesLibraryStatusFilter('summary-pending', paper, paperResourcesById),
  ).length
  const unreadCount = recentPapers.filter((paper) =>
    matchesLibraryStatusFilter('unread', paper, paperResourcesById),
  ).length
  const staleCount = recentPapers.filter((paper) =>
    matchesLibraryStatusFilter('stale', paper, paperResourcesById),
  ).length
  const notesReadyCount = Number(overview.papers_with_notes || 0)
  const trashSoonCount = trashPapers.filter((paper) => {
    const ms = Number(paper.expiresAt) - Date.now()
    return ms > 0 && ms <= 3 * 24 * 60 * 60 * 1000
  }).length
  const pendingMatrixRun = (matrixRuns || []).find((run) => ['queued', 'running', 'failed'].includes(run?.status))

  if (summaryPendingCount > 0) {
    tasks.push({
      id: 'summary-pending',
      count: summaryPendingCount,
      title: '篇还没做总结',
      helper: '适合补成可回看的结论卡片',
      tone: 'violet',
    })
  }
  if (staleCount > 0) {
    tasks.push({
      id: 'stale',
      count: staleCount,
      title: '篇内容待更新',
      helper: '摘要或衍生内容已经和当前标注不一致',
      tone: 'slate',
    })
  }
  if (unreadCount > 0) {
    tasks.push({
      id: 'unread',
      count: unreadCount,
      title: '篇新文献待阅读',
      helper: '先挑一篇开读，首页就会开始记轨迹',
      tone: 'blue',
    })
  }
  if (pendingMatrixRun) {
    tasks.push({
      id: 'matrix-pending',
      count: Number(pendingMatrixRun.paper_count || pendingMatrixRun.total_count || 0),
      title: '篇矩阵批次待继续',
      helper: pendingMatrixRun.status === 'failed' ? '批次生成中断了，回去补齐最划算' : '矩阵还在后台处理，适合回去查看进度',
      tone: pendingMatrixRun.status === 'failed' ? 'rose' : 'emerald',
      label: pendingMatrixRun.title || '未命名批次',
    })
  }
  if (trashSoonCount > 0) {
    tasks.push({
      id: 'trash-soon',
      count: trashSoonCount,
      title: '篇回收站即将到期',
      helper: '3 天内会被永久清理',
      tone: 'rose',
    })
  }
  if (!tasks.length && notesReadyCount > 0) {
    tasks.push({
      id: 'notes',
      count: notesReadyCount,
      title: '篇已有笔记可回看',
      helper: '如果今天不想开新文献，可以先回顾已有整理',
      tone: 'emerald',
    })
  }

  return tasks.sort((left, right) => {
    const leftOrder = PENDING_TASK_ORDER.indexOf(left.id)
    const rightOrder = PENDING_TASK_ORDER.indexOf(right.id)
    return (leftOrder >= 0 ? leftOrder : 99) - (rightOrder >= 0 ? rightOrder : 99)
  }).slice(0, 6)
}

const RESOURCE_MAP_VIEWBOX_SIZE = 100
const RESOURCE_DRAG_THRESHOLD = 5
const RESOURCE_LEAF_MIN_X = 15
const RESOURCE_LEAF_MAX_X = 88
const RESOURCE_LEAF_MIN_Y = 14
const RESOURCE_LEAF_MAX_Y = 86
const RESOURCE_LEAF_DEFAULTS = [
  { x_pct: 34, y_pct: 28, rotation_deg: -7 },
  { x_pct: 51, y_pct: 39, rotation_deg: 4 },
  { x_pct: 42, y_pct: 62, rotation_deg: -4 },
  { x_pct: 61, y_pct: 23, rotation_deg: 8 },
  { x_pct: 70, y_pct: 48, rotation_deg: -6 },
  { x_pct: 55, y_pct: 74, rotation_deg: 5 },
  { x_pct: 80, y_pct: 31, rotation_deg: -2 },
  { x_pct: 76, y_pct: 68, rotation_deg: 7 },
  { x_pct: 87, y_pct: 52, rotation_deg: -5 },
  { x_pct: 65, y_pct: 84, rotation_deg: 3 },
]

function getResourceStatusText(resource) {
  if (resource.type === 'notes' && resource.count > 1) return String(resource.count)
  if (resource.count > 1 && !String(resource.type || '').startsWith('summary_')) return String(resource.count)
  return resource.status === 'stale' ? '需更新' : '已生成'
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeResourceLayout(layout, fallback) {
  return {
    x_pct: clamp(Number(layout?.x_pct ?? fallback.x_pct), RESOURCE_LEAF_MIN_X, RESOURCE_LEAF_MAX_X),
    y_pct: clamp(Number(layout?.y_pct ?? fallback.y_pct), RESOURCE_LEAF_MIN_Y, RESOURCE_LEAF_MAX_Y),
    rotation_deg: clamp(Number(layout?.rotation_deg ?? fallback.rotation_deg ?? 0), -18, 18),
  }
}

function getDefaultResourceLayout(resource, index, count) {
  const base = RESOURCE_LEAF_DEFAULTS[index % RESOURCE_LEAF_DEFAULTS.length]
  const cycle = Math.floor(index / RESOURCE_LEAF_DEFAULTS.length)
  const typeOffset = String(resource?.type || '')
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return normalizeResourceLayout(
    {
      x_pct: base.x_pct + cycle * 2 + ((typeOffset % 5) - 2) * 0.8,
      y_pct: base.y_pct + ((count % 3) - 1) * 1.4 + cycle * 2,
      rotation_deg: base.rotation_deg + ((typeOffset % 7) - 3) * 0.4,
    },
    base,
  )
}

function getResourceMapHeight(count) {
  return Math.max(292, Math.min(420, 260 + Math.ceil(Math.max(1, count) / 3) * 38))
}

function buildResourceBranchPath(layout, index, count) {
  const startX = 4
  const startY = 51 + (count % 2 === 0 ? -2 : 1)
  const endX = layout.x_pct
  const endY = layout.y_pct
  const curl = ((index % 5) - 2) * 3.2
  const c1x = 13 + (index % 4) * 2.4
  const c1y = startY + (endY - startY) * 0.22 + curl
  const c2x = endX - 18 - (index % 3) * 4
  const c2y = endY + (index % 2 === 0 ? 7 : -8) - curl * 0.18
  return `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`
}

function PaperResourceMap({ paper, resources = [], onOpenResource, onSaveResourceLayout }) {
  const mapRef = useRef(null)
  const dragStateRef = useRef(null)
  const suppressClickRef = useRef('')
  const [hoveredType, setHoveredType] = useState('')
  const [draggingType, setDraggingType] = useState('')
  const [saveError, setSaveError] = useState('')
  const [leafLayouts, setLeafLayouts] = useState({})
  const height = getResourceMapHeight(resources.length)
  const paperId = paper?.id ?? paper?.paper_id

  useEffect(() => {
    setLeafLayouts((current) => {
      const next = {}
      resources.forEach((resource, index) => {
        const fallback = getDefaultResourceLayout(resource, index, resources.length)
        next[resource.type] = resource.layout
          ? normalizeResourceLayout(resource.layout, fallback)
          : normalizeResourceLayout(current[resource.type], fallback)
      })
      return next
    })
  }, [resources])

  if (!resources.length) return null

  const layout = resources.map((resource, index) => {
    const fallback = getDefaultResourceLayout(resource, index, resources.length)
    const itemLayout = normalizeResourceLayout(leafLayouts[resource.type], fallback)
    return {
      resource,
      layout: itemLayout,
      d: buildResourceBranchPath(itemLayout, index, resources.length),
      delay: `${(index % 6) * 0.34}s`,
      float: `${4 + (index % 3)}px`,
    }
  })

  function handlePointerDown(event, item) {
    if (event.button !== 0 || !mapRef.current) return
    const rect = mapRef.current.getBoundingClientRect()
    dragStateRef.current = {
      type: item.resource.type,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      moved: false,
      latest: item.layout,
    }
    setSaveError('')
    setDraggingType(item.resource.type)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event) {
    const state = dragStateRef.current
    if (!state || !mapRef.current) return
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (distance < RESOURCE_DRAG_THRESHOLD && !state.moved) return
    state.moved = true
    const nextLayout = normalizeResourceLayout(
      {
        x_pct: state.latest.x_pct + ((event.clientX - state.startX) / state.rect.width) * 100,
        y_pct: state.latest.y_pct + ((event.clientY - state.startY) / state.rect.height) * 100,
        rotation_deg: state.latest.rotation_deg,
      },
      state.latest,
    )
    state.startX = event.clientX
    state.startY = event.clientY
    state.latest = nextLayout
    setLeafLayouts((current) => ({
      ...current,
      [state.type]: nextLayout,
    }))
    event.preventDefault()
  }

  async function finishDrag(event, item) {
    const state = dragStateRef.current
    if (!state || state.type !== item.resource.type) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragStateRef.current = null
    setDraggingType('')
    if (!state.moved) return

    suppressClickRef.current = state.type
    window.setTimeout(() => {
      if (suppressClickRef.current === state.type) suppressClickRef.current = ''
    }, 360)
    try {
      await onSaveResourceLayout?.(paperId, {
        resource_type: state.type,
        x_pct: state.latest.x_pct,
        y_pct: state.latest.y_pct,
        rotation_deg: state.latest.rotation_deg,
      })
    } catch {
      setSaveError('\u5e03\u5c40\u4fdd\u5b58\u5931\u8d25\uff0c\u5237\u65b0\u524d\u4ecd\u4fdd\u7559\u672c\u6b21\u4f4d\u7f6e')
    }
  }

  return (
    <div
      className="paper-resource-map paper-resource-map--organic"
      ref={mapRef}
      style={{ '--resource-map-height': `${height}px` }}
    >
      <svg
        className="paper-resource-map__lines"
        viewBox={`0 0 ${RESOURCE_MAP_VIEWBOX_SIZE} ${RESOURCE_MAP_VIEWBOX_SIZE}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {layout.map((item) => (
          <path
            key={item.resource.type}
            d={item.d}
            stroke={item.resource.color}
            className={hoveredType === item.resource.type || draggingType === item.resource.type ? 'is-active' : ''}
          />
        ))}
      </svg>

      <div className="paper-resource-map__canopy" aria-hidden="true" />

      <div className="paper-resource-map__cards">
        {layout.map((item) => (
          <button
            key={item.resource.type}
            type="button"
            className={`paper-resource-card${hoveredType === item.resource.type ? ' is-active' : ''}${draggingType === item.resource.type ? ' is-dragging' : ''}`}
            style={{
              '--resource-color': item.resource.color,
              '--float-delay': item.delay,
              '--float-distance': item.float,
              '--leaf-rotation': `${item.layout.rotation_deg}deg`,
              left: `${item.layout.x_pct}%`,
              top: `${item.layout.y_pct}%`,
            }}
            onClick={(event) => {
              if (suppressClickRef.current === item.resource.type) {
                event.preventDefault()
                suppressClickRef.current = ''
                return
              }
              onOpenResource?.(paper, item.resource, event.currentTarget)
            }}
            onPointerDown={(event) => handlePointerDown(event, item)}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => finishDrag(event, item)}
            onPointerCancel={(event) => finishDrag(event, item)}
            onMouseEnter={() => setHoveredType(item.resource.type)}
            onMouseLeave={() => setHoveredType('')}
          >
            <span>{item.resource.label}</span>
            <small>{getResourceStatusText(item.resource)}</small>
          </button>
        ))}
      </div>
      {saveError ? <div className="paper-resource-map__save-error">{saveError}</div> : null}
    </div>
  )
}

function RecentSection({ groupedPapers, onOpenPaper }) {
  if (groupedPapers.length === 0) {
    return (
      <div className="home-empty-state">
        <div className="home-empty-state__icon">
          <LibraryBig />
        </div>
        <h3>还没有最近阅读记录</h3>
        <p>先导入一篇 PDF，后续这里会按时间记录你的阅读进度。</p>
      </div>
    )
  }

  return (
    <div className="home-recent-list">
      {groupedPapers.map((group) => (
        <section key={group.label} className="home-recent-group">
          <div className="home-recent-group__title">
            <span>{group.label}</span>
          </div>

          <div className="home-recent-group__items">
            {group.items.map((paper) => (
              <button
                key={paper.id}
                type="button"
                className="home-paper-row"
                onClick={() => onOpenPaper(paper.id)}
              >
                <div className="home-paper-row__main">
                  <div className="home-paper-icon">
                    <FileText />
                  </div>
                  <div className="home-paper-copy">
                    <h3>{paper.title}</h3>
                    <p>
                      分类：{paper.folderName}
                      {paper.metadata.author ? ` / 作者：${paper.metadata.author}` : ''}
                    </p>
                  </div>
                </div>

                <div className="home-paper-row__meta">
                  <span className={`home-paper-pill${paper.isOpen ? ' is-open' : ''}`}>
                    {paper.isOpen ? '已打开' : '点击继续阅读'}
                  </span>
                  <time>{formatDateTime(paper.lastViewedAt)}</time>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ContinueWorkSection({ item, onBrowseLibrary, onOpenPaper, onOpenResource, paperResourcesById }) {
  if (!item?.paper) {
    return (
      <section className="home-continue-card home-continue-card--empty">
        <div>
          <p className="panel-label">继续上次工作</p>
          <h3>先导入一篇论文，首页就会开始帮你接住工作现场</h3>
          <p>导入后会自动记录最近阅读、资源生成和笔记/总结进度，后面回来就能从这里继续。</p>
        </div>
        <div className="home-continue-card__actions">
          <button type="button" className="home-primary-button" onClick={onBrowseLibrary}>
            <LibraryBig />
            <span>去我的文献</span>
          </button>
        </div>
      </section>
    )
  }

  const paper = item.paper
  const resources = getPaperResourceEntries(paper.id, paperResourcesById)
  const previewResource = resources[0] || null

  return (
    <section className="home-continue-card">
      <div className="home-continue-card__body">
        <div className="home-continue-card__copy">
          <p className="panel-label">继续上次工作</p>
          <h3>{paper.title}</h3>
          <p className="home-continue-card__meta">
            {paper.folderName || '未分类'}
            {paper.metadata?.author ? ` / ${paper.metadata.author}` : ''}
          </p>
          <div className="home-continue-card__status">
            <span className="home-paper-pill is-open">{item.statusLabel}</span>
            <time>{formatDateTime(paper.lastViewedAt)}</time>
          </div>
          <p className="home-continue-card__hint">{item.statusHint}</p>
          {item.statusTags.length ? (
            <div className="home-continue-card__tags">
              {item.statusTags.map((tag) => (
                <span key={tag} className="home-continue-card__tag">{tag}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="home-continue-card__actions">
          <button type="button" className="home-primary-button" onClick={() => onOpenPaper(paper.id)}>
            <BookCopy />
            <span>继续阅读</span>
          </button>
          <button
            type="button"
            className="home-secondary-button"
            onClick={() => {
              if (previewResource) {
                onOpenResource?.(paper, previewResource)
                return
              }
              onBrowseLibrary()
            }}
          >
            <Package2 />
            <span>{previewResource ? '查看资源' : '去文献列表'}</span>
          </button>
        </div>
      </div>
    </section>
  )
}

function PendingTaskSection({ tasks, onTaskClick }) {
  return (
    <section className="home-pending-panel">
      <div className="home-section-head home-section-head--compact">
        <h3>现在最值得处理的事</h3>
        <span>点一下直接跳到对应文献或工作区</span>
      </div>

      {tasks.length ? (
        <div className="home-pending-grid">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`home-pending-card home-pending-card--${task.tone || 'slate'}`}
              onClick={() => onTaskClick(task)}
            >
              <strong>{task.count}</strong>
              <span>{task.title}</span>
              <small>{task.helper}</small>
              {task.label ? <em>{task.label}</em> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="home-inline-message">当前没有堆着不处理就会耽误的事，可以直接回到你的阅读列表继续推进。</div>
      )}
    </section>
  )
}

function CategorySection({
  folders,
  highlightPaperId,
  jumpPaperId,
  onClearHighlight,
  onDeletePaper,
  onMovePaper,
  onOpenPaper,
  onOpenResource,
  onSaveResourceLayout,
  paperResourcesById = {},
  statusFilter = 'all',
  recentPapers,
  searchTerm,
  selectedFolderId,
  uncategorizedFolderId,
}) {
  const [menuPaperId, setMenuPaperId] = useState('')
  const [expandedResourcePaperId, setExpandedResourcePaperId] = useState('')
  const keyword = searchTerm.trim().toLowerCase()
  const currentCategoryName =
    selectedFolderId === uncategorizedFolderId
      ? '未分类'
      : folders.find((folder) => folder.id === selectedFolderId)?.name || '未分类'

  const papersInCategory = recentPapers.filter((paper) => {
    if (paper.folderId !== selectedFolderId) {
      return false
    }

    if (!matchesLibraryStatusFilter(statusFilter, paper, paperResourcesById)) {
      return false
    }

    if (!keyword) {
      return true
    }

    return [paper.title, paper.fileName, paper.metadata.author]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(keyword))
  })

  const PAGE_SIZE = 15
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(papersInCategory.length / PAGE_SIZE))

  useEffect(() => {
    setCurrentPage(1)
    setMenuPaperId('')
    setExpandedResourcePaperId('')
  }, [selectedFolderId, searchTerm, statusFilter])

  // Jump to paper and auto-scroll page
  const jumpTargetIndex = useMemo(() => {
    if (!jumpPaperId) return -1
    return papersInCategory.findIndex((p) => p.id === jumpPaperId)
  }, [jumpPaperId, papersInCategory])

  useEffect(() => {
    if (jumpTargetIndex < 0) return
    const page = Math.floor(jumpTargetIndex / PAGE_SIZE) + 1
    setCurrentPage(page)
  }, [jumpTargetIndex, PAGE_SIZE])

  // Auto-clear highlight after 2.5s
  useEffect(() => {
    if (!highlightPaperId) return
    const timer = setTimeout(() => {
      onClearHighlight?.()
    }, 2500)
    return () => clearTimeout(timer)
  }, [highlightPaperId, onClearHighlight])

  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pagePapers = papersInCategory.slice(pageStart, pageStart + PAGE_SIZE)
  // Pad to PAGE_SIZE rows to maintain fixed height
  const paddedRows = [
    ...pagePapers,
    ...Array.from({ length: Math.max(0, PAGE_SIZE - pagePapers.length) }, (_, i) => ({
      _empty: true,
      _key: `empty-${i}`,
    })),
  ]

  function handlePrevPage() {
    setCurrentPage((p) => Math.max(1, p - 1))
    setMenuPaperId('')
    setExpandedResourcePaperId('')
  }

  function handleNextPage() {
    setCurrentPage((p) => Math.min(totalPages, p + 1))
    setMenuPaperId('')
    setExpandedResourcePaperId('')
  }

  return (
    <div className="home-category-panel">
      <div className="home-category-panel__header">
        <div className="home-category-panel__title">
          <p className="panel-label">当前分类</p>
          <div className="home-category-panel__title-row">
            <h3>{currentCategoryName}</h3>
          </div>
        </div>
        <span className="home-category-panel__count">{papersInCategory.length} 篇</span>
      </div>

      <div className="home-category-table">
        <div className="home-category-table__head">
          <span>原文标题</span>
          <span>译文标题</span>
          <span>作者</span>
          <span>页数</span>
          <span aria-hidden="true" />
        </div>

        {papersInCategory.length > 0 ? (
          paddedRows.map((paper) => {
            if (paper._empty) {
              return <div key={paper._key} className="home-category-table__row home-category-table__row--empty" />
            }

            const resourceRecord = paperResourcesById[String(paper.id)]
            const resources = resourceRecord?.resources || []
            const flags = getPaperStatusFlags(paper, resources)
            const isResourceExpanded = expandedResourcePaperId === paper.id && resources.length > 0

            return (
              <div
                key={paper.id}
                className={`home-category-table__row${highlightPaperId === paper.id ? ' is-highlight' : ''}${isResourceExpanded ? ' is-resource-expanded' : ''}`}
              >
                <button
                  type="button"
                  className="home-category-paper"
                  onClick={() => onOpenPaper(paper.id)}
                  title={paper.title}
                >
                  <FileText />
                  <span>{paper.title}</span>
                </button>
                <span title={getTranslatedTitle(paper)}>
                  {getTranslatedTitle(paper)}
                  <small className="home-category-paper__status">{getPaperStatusLabel(flags)}</small>
                </span>
                <span title={paper.metadata.author || '-'}>{paper.metadata.author || '-'}</span>
                <span>{paper.metadata.pageCount || 0} 页</span>
                <div className="home-row-menu-wrap">
                  {resources.length > 0 ? (
                    <button
                      type="button"
                      className={`home-resource-trigger${isResourceExpanded ? ' is-active' : ''}`}
                      title="展开资源图"
                      onClick={() => {
                        setMenuPaperId('')
                        setExpandedResourcePaperId((currentId) => (currentId === paper.id ? '' : paper.id))
                      }}
                    >
                      <Package2 />
                      <span>资源 {resources.length}</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="home-row-menu-trigger"
                    aria-label={`打开 ${paper.title} 更多操作`}
                    title="更多"
                    onClick={() =>
                      setMenuPaperId((currentId) => (currentId === paper.id ? '' : paper.id))
                    }
                  >
                    <MoreHorizontal />
                  </button>

                  {menuPaperId === paper.id ? (
                    <div className="home-row-menu">
                      <div className="home-row-menu__item-wrap">
                        <button
                          type="button"
                          className="home-row-menu__item"
                          onClick={() => setMenuPaperId('')}
                        >
                          移入...
                        </button>
                        <div className="home-row-submenu">
                          {folders
                            .filter((f) => String(f.id) !== String(paper.folderId))
                            .map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                className="home-row-menu__item"
                                onClick={() => {
                                  setMenuPaperId('')
                                  onMovePaper(paper.id, String(f.id))
                                }}
                              >
                                {f.name}
                              </button>
                            ))}
                          {String(paper.folderId) !== String(uncategorizedFolderId) ? (
                            <button
                              type="button"
                              className="home-row-menu__item"
                              onClick={() => {
                                setMenuPaperId('')
                                onMovePaper(paper.id, String(uncategorizedFolderId))
                              }}
                            >
                              未分类
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="home-row-menu__item home-row-menu__item--danger"
                        onClick={() => {
                          setMenuPaperId('')
                          setExpandedResourcePaperId('')
                          onDeletePaper(paper.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>

                {isResourceExpanded ? (
                  <PaperResourceMap
                    paper={paper}
                    resources={resources}
                    onOpenResource={onOpenResource}
                    onSaveResourceLayout={onSaveResourceLayout}
                  />
                ) : null}
              </div>
            )
          })
        ) : (
          <div className="home-empty-state home-empty-state--compact">
            <div className="home-empty-state__icon">
              <FolderClosed />
            </div>
            <h3>当前分类下还没有文献</h3>
            <p>用顶部"导入文献"把论文放进对应分类里，导入后不会自动跳进阅读页。</p>
          </div>
        )}
      </div>

      {papersInCategory.length > 0 ? (
        <div className="home-pagination">
          <button
            type="button"
            className="home-pagination__btn"
            disabled={currentPage <= 1}
            onClick={handlePrevPage}
            aria-label="上一页"
          >
            <ChevronLeft />
          </button>
          <span className="home-pagination__info">第 {currentPage}/{totalPages} 页</span>
          <button
            type="button"
            className="home-pagination__btn"
            disabled={currentPage >= totalPages}
            onClick={handleNextPage}
            aria-label="下一页"
          >
            <ChevronRight />
          </button>
        </div>
      ) : null}

    </div>
  )
}

function TrashSection({
  onEmptyTrash,
  onPermanentlyDeletePaper,
  onRestorePaper,
  trashPapers = [],
}) {
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [isClearing, setIsClearing] = useState(false)

  async function handleRestore(paperId) {
    setBusyId(`restore:${paperId}`)
    const result = await onRestorePaper?.(paperId)
    setBusyId('')
    setMessage(result?.ok ? '已恢复到原来的分类。' : (result?.message || '恢复失败。'))
  }

  async function handleDelete(paperId) {
    if (!window.confirm('确定要彻底删除这篇文献吗？PDF、标注和笔记都会一起删除。')) return
    setBusyId(`delete:${paperId}`)
    const result = await onPermanentlyDeletePaper?.(paperId)
    setBusyId('')
    setMessage(result?.ok ? '已彻底删除。' : (result?.message || '彻底删除失败。'))
  }

  async function handleEmpty() {
    if (!trashPapers.length) return
    if (!window.confirm('确定清空回收站吗？这些文献会被永久删除，不能恢复。')) return
    setIsClearing(true)
    const result = await onEmptyTrash?.()
    setIsClearing(false)
    setMessage(result?.ok ? '回收站已清空。' : (result?.message || '清空失败。'))
  }

  if (trashPapers.length === 0) {
    return (
      <div className="home-panel-grid">
        <div className="home-feature-card">
          <p className="panel-label">7 天保留</p>
          <h3>回收站为空</h3>
          <p>删除后的文献会在这里保留 7 天，恢复时回到原来的分类；总结和全文翻译不会保留。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="home-trash-panel">
      <div className="home-trash-panel__header">
        <div>
          <p className="panel-label">7 天内可恢复</p>
          <h3>{trashPapers.length} 篇已删除文献</h3>
          <p>恢复会回到原分类；只保留 PDF、标注、笔迹和笔记，总结与全文翻译已清理。</p>
        </div>
        <button
          type="button"
          className="home-ghost-button home-ghost-button--danger"
          disabled={isClearing}
          onClick={handleEmpty}
        >
          <Trash2 />
          <span>{isClearing ? '清空中' : '清空回收站'}</span>
        </button>
      </div>

      {message ? <div className="home-inline-message">{message}</div> : null}

      <div className="home-trash-list">
        {trashPapers.map((paper) => (
          <article key={paper.id} className="home-trash-row">
            <div className="home-trash-row__main">
              <div className="home-paper-icon">
                <FileText />
              </div>
              <div className="home-paper-copy">
                <h3>{paper.title}</h3>
                <p>
                  原分类：{paper.folderName}
                  {paper.author ? ` / 作者：${paper.author}` : ''}
                </p>
              </div>
            </div>

            <div className="home-trash-row__meta">
              <span>{formatDateTime(paper.deletedAt)}</span>
              <strong>{formatDaysLeft(paper.expiresAt)}</strong>
            </div>

            <div className="home-trash-row__actions">
              <button
                type="button"
                className="home-secondary-button"
                disabled={busyId === `restore:${paper.id}`}
                onClick={() => handleRestore(paper.id)}
              >
                <RotateCcw />
                <span>{busyId === `restore:${paper.id}` ? '恢复中' : '恢复'}</span>
              </button>
              <button
                type="button"
                className="home-ghost-button home-ghost-button--danger"
                disabled={busyId === `delete:${paper.id}`}
                onClick={() => handleDelete(paper.id)}
              >
                <Trash2 />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function HomePage({
  folders,
  importConflict,
  isImporting,
  onCancelImportConflict,
  onCreateFolder,
  onDeleteFolder,
  onDeletePaper,
  onEmptyTrash,
  onMovePaper,
  onOpenFilePicker,
  onOpenPaper,
  onJumpToPaperEvidence,
  onOpenResource,
  onPermanentlyDeletePaper,
  onRefreshResources,
  onRefreshTrash,
  onRestorePaper,
  onSaveResourceLayout,
  onRenameFolder,
  onResolveImportConflict,
  recentPapers,
  readingDashboard = null,
  insightTimeframe = 'month',
  onInsightTimeframeChange,
  recentReadings = [],
  readingStats = null,
  resourceOverview = null,
  trashPapers = [],
  uiFontScale = 1,
  uncategorizedFolderId,
}) {
  const [activeSection, setActiveSection] = useState('recent')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState(uncategorizedFolderId)
  const [libraryStatusFilter, setLibraryStatusFilter] = useState('all')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [showImportMenu, setShowImportMenu] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState('')
  const [editFolderName, setEditFolderName] = useState('')
  const [highlightPaperId, setHighlightPaperId] = useState('')
  const [jumpPaperId, setJumpPaperId] = useState('')
  const [matrixRuns, setMatrixRuns] = useState([])

  useEffect(() => {
    if (uncategorizedFolderId && selectedFolderId === '') {
      setSelectedFolderId(uncategorizedFolderId)
    }
  }, [uncategorizedFolderId, selectedFolderId])

  useEffect(() => {
    let cancelled = false

    async function loadMatrixRuns() {
      try {
        const payload = await fetchResearchMatrixRuns()
        if (!cancelled) {
          setMatrixRuns(payload?.runs || [])
        }
      } catch {
        if (!cancelled) {
          setMatrixRuns([])
        }
      }
    }

    loadMatrixRuns()
    return () => {
      cancelled = true
    }
  }, [])

  const groupedPapers = useMemo(
    () => buildGroupedPapers(recentPapers, searchTerm),
    [recentPapers, searchTerm],
  )

  const groupedReadings = useMemo(() => {
    const deduped = [...recentReadings]
      .sort((a, b) => b.openedAt - a.openedAt)
      .reduce((acc, r) => {
        if (!acc.has(r.fileName)) acc.set(r.fileName, r)
        return acc
      }, new Map())

    return buildGroupedPapers(
      [...deduped.values()].map((r) => ({
        id: r.paperId,
        title: r.title,
        fileName: r.fileName,
        folderName: r.folderName,
        lastViewedAt: r.openedAt,
        metadata: { author: r.author },
        isOpen: false,
      })),
      searchTerm,
    )
  }, [recentReadings, searchTerm])

  const paperResourcesById = useMemo(
    () => getPaperResourceMap(resourceOverview),
    [resourceOverview],
  )

  const continueWorkItem = useMemo(
    () => buildContinueWorkItem(recentPapers, paperResourcesById),
    [paperResourcesById, recentPapers],
  )

  const pendingTasks = useMemo(
    () => buildPendingTasks({
      recentPapers,
      paperResourcesById,
      readingDashboard,
      trashPapers,
      matrixRuns,
    }),
    [matrixRuns, paperResourcesById, readingDashboard, recentPapers, trashPapers],
  )

  const activeLibraryFilterLabel = useMemo(
    () => LIBRARY_STATUS_FILTERS.find((item) => item.id === libraryStatusFilter)?.label || '全部',
    [libraryStatusFilter],
  )

  function handleOpenResource(paper, resource, trigger) {
    const paperId = paper?.id ?? paper?.paper_id
    if (!paperId) return
    onOpenResource?.({
      paperId,
      paperTitle: paper?.title || paper?.fileName || paper?.file_name || '未命名论文',
      resourceType: resource?.type || '',
      resourceLabel: resource?.label || '资源预览',
      resourceColor: resource?.color || '#2563EB',
      resourceStatus: resource?.status || 'ready',
      updatedAt: resource?.updated_at || '',
      trigger: trigger || null,
    })
  }

  const weeklyStats = useMemo(() => {
    if (!readingStats) {
      return [
        { id: 'sessions', label: '本周阅读次数', value: '-- 次', icon: TimerReset, period: null },
        { id: 'papers', label: '本周阅读篇数', value: '-- 篇', icon: BookCopy, period: null },
        { id: 'rhythm', label: '阅读活跃时段', value: '--', icon: Clock3, period: null },
      ]
    }
    const dominant = readingStats.dominant_period
    return [
      {
        id: 'sessions',
        label: '本周阅读次数',
        value: `${readingStats.weekly_opens} 次`,
        icon: TimerReset,
        period: null,
      },
      {
        id: 'papers',
        label: '本周阅读篇数',
        value: `${readingStats.weekly_distinct_papers} 篇`,
        icon: BookCopy,
        period: null,
      },
      {
        id: 'rhythm',
        label: '阅读活跃时段',
        value: periodLabel(dominant),
        icon: periodIcon(dominant),
        period: dominant,
      },
    ]
  }, [readingStats])

  const globalSearchResults = useMemo(() => {
    if ((activeSection !== 'library' && activeSection !== 'recent') || !searchTerm.trim()) return []
    const kw = searchTerm.trim().toLowerCase()
    return recentPapers
      .filter((p) =>
        [p.title, p.fileName, p.metadata?.author, p.metadata?.subject, p.metadata?.keywords]
          .filter(Boolean)
          .some((field) => (field || '').toLowerCase().includes(kw)),
      )
      .map((paper) => ({
        ...paper,
        _folderName:
          paper.folderId === uncategorizedFolderId
            ? '未分类'
            : folders.find((f) => f.id === paper.folderId)?.name || '未分类',
      }))
  }, [activeSection, searchTerm, recentPapers, folders, uncategorizedFolderId])

  function handleGlobalSearchClick(paper) {
    setSearchTerm('')
    setSelectedFolderId(paper.folderId)
    setLibraryStatusFilter('all')
    setActiveSection('library')
    setHighlightPaperId(paper.id)
    setJumpPaperId(paper.id)
  }

  function handleClearHighlight() {
    setHighlightPaperId('')
    setJumpPaperId('')
  }

  async function handleCreateFolder() {
    const result = await onCreateFolder(folderName)
    if (result.ok) {
      setFolderName('')
      setSelectedFolderId(result.folder.id)
      setIsCreatingFolder(false)
      setActiveSection('library')
    }
  }

  function handleImportToFolder(folderId) {
    setShowImportMenu(false)
    onOpenFilePicker(folderId, { activate: false })
  }

  function handleDeleteFolder(folderId) {
    onDeleteFolder(folderId)
    if (selectedFolderId === folderId) {
      setSelectedFolderId(uncategorizedFolderId)
    }
  }

  function handleSelectSection(sectionId) {
    setActiveSection(sectionId)
    if (sectionId === 'trash') {
      onRefreshTrash?.()
    }
  }

  function handleOpenResourcePreview(paper, resource) {
    handleOpenResource(paper, resource, null)
  }

  function handleBrowseLibrary() {
    setActiveSection('library')
    setLibraryStatusFilter('all')
    setSearchTerm('')
  }

  function handlePendingTaskClick(task) {
    if (task.id === 'matrix-pending') {
      setActiveSection('matrix')
      return
    }

    if (task.id === 'trash-soon') {
      setActiveSection('trash')
      onRefreshTrash?.()
      return
    }

    setActiveSection('library')
    setLibraryStatusFilter(task.id === 'notes' ? 'notes' : task.id)
    setSearchTerm('')
  }

  return (
    <section className="home-shell">
      <aside className="home-sidebar">
        <div className="home-sidebar__group">
          {homeSections.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            const isLibrary = item.id === 'library'

            return (
              <div key={item.id}>
                <div className="home-sidebar__item-row">
                  <button
                    type="button"
                    className={`home-sidebar__item${isActive ? ' is-active' : ''}`}
                    onClick={() => handleSelectSection(item.id)}
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </button>

                  {isLibrary ? (
                    <button
                      type="button"
                      className="home-sidebar-action"
                      aria-label="添加分类"
                      title="添加分类"
                      onClick={(event) => {
                        event.stopPropagation()
                        setActiveSection('library')
                        setIsCreatingFolder((current) => !current)
                      }}
                    >
                      <FolderPlus />
                    </button>
                  ) : null}
                </div>

                {isLibrary && isActive ? (
                  <>
                    {isCreatingFolder ? (
                      <div className="home-sidebar-create">
                        <input
                          type="text"
                          value={folderName}
                          placeholder="新建分类"
                          onChange={(event) => setFolderName(event.target.value)}
                        />
                        <button type="button" onClick={handleCreateFolder}>
                          添加
                        </button>
                      </div>
                    ) : null}

                    <div className="home-sidebar-folder-tree">
                      <div className="home-sidebar-folder-tree__row">
                        <button
                          type="button"
                          className={`home-sidebar-folder-tree__item${
                            selectedFolderId === uncategorizedFolderId ? ' is-active' : ''
                          }`}
                          onClick={() => {
                            setSelectedFolderId(uncategorizedFolderId)
                            setLibraryStatusFilter('all')
                          }}
                        >
                          <span>未分类</span>
                        </button>
                        <span className="home-sidebar-folder-tree__placeholder" />
                      </div>

                      {folders.map((folder) => (
                        <div key={folder.id} className="home-sidebar-folder-tree__row">
                          {editingFolderId === folder.id ? (
                            <div className="home-sidebar-folder-tree__edit">
                              <input
                                type="text"
                                className="home-sidebar-folder-tree__edit-input"
                                value={editFolderName}
                                onChange={(event) => setEditFolderName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    if (editFolderName.trim()) {
                                      onRenameFolder(folder.id, editFolderName.trim())
                                    }
                                    setEditingFolderId('')
                                  } else if (event.key === 'Escape') {
                                    setEditingFolderId('')
                                  }
                                }}
                                onBlur={() => setEditingFolderId('')}
                                autoFocus
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={`home-sidebar-folder-tree__item${
                                selectedFolderId === folder.id ? ' is-active' : ''
                              }`}
                              onClick={() => {
                                setSelectedFolderId(folder.id)
                                setLibraryStatusFilter('all')
                              }}
                              onDoubleClick={() => {
                                if (folder.name !== '未分类') {
                                  setEditingFolderId(folder.id)
                                  setEditFolderName(folder.name)
                                }
                              }}
                              title="双击重命名"
                            >
                              <span>{folder.name}</span>
                            </button>
                          )}
                          {folder.name !== '未分类' ? (
                            <button
                              type="button"
                              className="home-sidebar-folder-tree__delete"
                              aria-label={`删除分类 ${folder.name}`}
                              title={`删除分类 ${folder.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleDeleteFolder(folder.id)
                              }}
                            >
                              <Trash2 />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </aside>

      <div className={`home-content${activeSection === 'matrix' ? ' is-matrix' : ''}${activeSection === 'literature-search' ? ' is-literature-search' : ''}`}>
        {activeSection !== 'trash' && activeSection !== 'matrix' && activeSection !== 'insights' && activeSection !== 'literature-search' ? (
        <div className={`home-toolbar${activeSection === 'library' ? ' is-library' : ''}`}>
          <div className="home-toolbar__actions">
            <button
              type="button"
              className="home-primary-button"
              onClick={() => setShowImportMenu((current) => !current)}
            >
              <FilePlus2 />
              <span>导入文献</span>
            </button>

            {showImportMenu ? (
              <div className="home-import-menu">
                <button
                  type="button"
                  className="home-import-menu__item"
                  onClick={() => handleImportToFolder(uncategorizedFolderId)}
                >
                  导入到未分类
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="home-import-menu__item"
                    onClick={() => handleImportToFolder(folder.id)}
                  >
                    导入到 {folder.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="home-search-wrap">
            <label className="home-search">
              <Search />
              <input
                type="search"
                placeholder={
                  activeSection === 'library'
                    ? '搜索当前文件夹标题、作者、关键词…'
                    : '搜索当前工作区文献'
                }
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            {globalSearchResults.length > 0 ? (
              <div className="home-search-results">
                {globalSearchResults.map((paper) => (
                  <button
                    key={paper.id}
                    type="button"
                    className="home-search-results__item"
                    onClick={() => handleGlobalSearchClick(paper)}
                  >
                    <span className="home-search-results__title">{paper.title}</span>
                    <span className="home-search-results__folder">{paper._folderName}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}

        {activeSection === 'recent' ? (
          <>
            <ContinueWorkSection
              item={continueWorkItem}
              onBrowseLibrary={handleBrowseLibrary}
              onOpenPaper={onOpenPaper}
              onOpenResource={handleOpenResourcePreview}
              paperResourcesById={paperResourcesById}
            />

            <PendingTaskSection tasks={pendingTasks} onTaskClick={handlePendingTaskClick} />

            <div className="home-heading">
              <div>
                <p className="panel-label">阅读轨迹</p>
                <h2>最近打开过的文献</h2>
              </div>
              <div className="home-heading__meta">
                <LibraryBig />
                <span>{recentPapers.length} 篇阅读中的文献</span>
              </div>
            </div>

            <div className="home-stats-grid">
              {weeklyStats.map((item) => {
                const Icon = item.icon
                const cardClass = [
                  'home-stat-card',
                  item.period ? `home-stat-card--${item.period}` : '',
                ].filter(Boolean).join(' ')
                const iconClass = item.period ? 'icon-animate-pulse' : ''
                return (
                  <article key={item.id} className={cardClass}>
                    <div className="home-stat-card__icon">
                      <Icon className={iconClass} />
                    </div>
                    <div>
                      <p>{item.label}</p>
                      <strong>{item.value}</strong>
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        ) : null}

        {activeSection === 'insights' ? (
          <ReadingInsightSection
            dashboard={readingDashboard}
            timeframe={insightTimeframe}
            uiFontScale={uiFontScale}
            onTimeframeChange={onInsightTimeframeChange}
          />
        ) : null}

        {activeSection === 'literature-search' ? (
          <LiteratureSearchPage />
        ) : null}

        {activeSection !== 'matrix' && activeSection !== 'insights' && activeSection !== 'literature-search' ? (
        <div className={`home-section-head${activeSection === 'library' ? ' is-library' : ''}`}>
          <h3>
            {activeSection === 'recent' && '阅读记录'}
            {activeSection === 'library' && '我的文献'}
            {activeSection === 'trash' && '回收站'}
          </h3>
          {activeSection === 'library' ? (
            <span>当前按 “{activeLibraryFilterLabel}” 查看</span>
          ) : (
            <span>
              {activeSection === 'recent' && '按最近打开时间排序'}
              {activeSection === 'trash' && '仅保留最近 7 天删除内容'}
            </span>
          )}
        </div>
        ) : null}

        {activeSection === 'recent' ? (
          <RecentSection groupedPapers={groupedReadings} onOpenPaper={onOpenPaper} />
        ) : null}

        {activeSection === 'library' ? (
          <>
            <div className="home-status-filter">
              {LIBRARY_STATUS_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`home-status-filter__chip${libraryStatusFilter === item.id ? ' is-active' : ''}`}
                  onClick={() => setLibraryStatusFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <CategorySection
              folders={folders}
              highlightPaperId={highlightPaperId}
              jumpPaperId={jumpPaperId}
              onClearHighlight={handleClearHighlight}
              onDeletePaper={onDeletePaper}
              onMovePaper={onMovePaper}
              onOpenPaper={onOpenPaper}
              onOpenResource={handleOpenResource}
              onSaveResourceLayout={onSaveResourceLayout}
              paperResourcesById={paperResourcesById}
              recentPapers={recentPapers}
              searchTerm={searchTerm}
              selectedFolderId={selectedFolderId}
              statusFilter={libraryStatusFilter}
              uncategorizedFolderId={uncategorizedFolderId}
            />
          </>
        ) : null}

        {activeSection === 'matrix' ? (
          <ResearchMatrixPage
            folders={folders}
            onJumpToPaperEvidence={onJumpToPaperEvidence}
            recentPapers={recentPapers}
            uncategorizedFolderId={uncategorizedFolderId}
          />
        ) : null}

        {activeSection === 'trash' ? (
          <TrashSection
            onEmptyTrash={onEmptyTrash}
            onPermanentlyDeletePaper={onPermanentlyDeletePaper}
            onRestorePaper={onRestorePaper}
            trashPapers={trashPapers}
          />
        ) : null}
      </div>

      {isImporting || importConflict ? (
        <div className="home-import-overlay">
          {importConflict ? (
            <div className="home-conflict-dialog">
              <p>{importConflict.message}</p>
              <div className="home-conflict-dialog__actions">
                {importConflict.conflictType === 'other_folder' ? (
                  <>
                    <button
                      type="button"
                      className="home-primary-button"
                      onClick={onResolveImportConflict}
                    >
                      确认移入
                    </button>
                    <button
                      type="button"
                      className="home-secondary-button"
                      onClick={onCancelImportConflict}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="home-primary-button"
                    onClick={onCancelImportConflict}
                  >
                    知道了
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="home-import-spinner">
              <div className="home-import-spinner__ring" />
              <p>导入中...</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
