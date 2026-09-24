import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookCopy,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  FileCheck2,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderPlus,
  LibraryBig,
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
import {
  DEFAULT_RESOURCE_BRANCH_ORIGIN,
  buildResourceBranchPath,
  getResourceBranchOrigin,
} from './resourceMapGeometry'
import { loadHomeSectionComponent, preloadHomeSection } from './homeSectionPreload'
import {
  buildLibraryBulkSummary,
  createBulkOperationPlan,
  getLibraryAdvancedFilterOptions,
  matchesLibraryAdvancedFilters,
} from './libraryWorkflowModel'
import '../../styles/home-library.css'
import '../../styles/home-redesign.css'

const LiteratureSearchPage = lazy(() =>
  loadHomeSectionComponent('literature-search').then((component) => ({ default: component })),
)
const PaperFormatPage = lazy(() =>
  loadHomeSectionComponent('paper-format').then((component) => ({ default: component })),
)
const ReadingInsightSection = lazy(() =>
  loadHomeSectionComponent('insights').then((component) => ({ default: component })),
)
const homeSections = [
  { id: 'recent', label: '阅读记录', icon: Clock3 },
  { id: 'library', label: '我的文献', icon: LibraryBig },
  { id: 'literature-search', label: '文献检索', icon: SearchCheck },
  { id: 'paper-format', label: '格式正规化', icon: FileCheck2 },
  { id: 'insights', label: '阅读信息站', icon: Radar },
  { id: 'trash', label: '回收站', icon: Trash2 },
]

const LIBRARY_STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '待阅读' },
  { id: 'reading', label: '阅读中' },
  { id: 'notes', label: '有笔记' },
  { id: 'translation', label: '已翻译' },
  { id: 'stale', label: '待更新' },
]

const PENDING_TASK_ORDER = [
  'stale',
  'unread',
  'trash-soon',
]
const HOME_PENDING_VISIBLE_COUNT = 5

function SectionFallback({ message }) {
  return <div className="reader-empty">{message}</div>
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

function compactHomeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stripPdfExtension(value) {
  return compactHomeText(value).replace(/\.pdf$/i, '')
}

function cleanPaperTitleForDisplay(title, fileName = '') {
  let value = compactHomeText(title) || stripPdfExtension(fileName)
  const fallback = stripPdfExtension(fileName) || '未命名文献'
  if (!value) return fallback

  value = value.replace(/^[\u3400-\u9fff]{2,14}\s*[（(]\s*中英文\s*[）)]\s+[A-Za-z][A-Za-z\s-]{4,48}\s+/, '')
  value = value.split(/\s+(?:摘要|摘\s*要|关键词|关键字|Abstract\b|Keywords?\b)/i)[0]
  value = value.replace(/\s*[（(]\s*\d+\s*[.．、].*$/, '')
  value = value.replace(/\s+\d+(?:\s*[，,]\s*\d+)+\s*\*?.*$/, '')
  value = value.replace(/\s+[\u3400-\u9fff]{2,4}(?:[，、,]\s*[\u3400-\u9fff]{2,4}){1,}.*$/, '')
  value = compactHomeText(value).replace(/[，,;；:.：、\s]+$/, '')

  if (!value) return fallback
  if (value.length > 96) return `${value.slice(0, 96).trim()}...`
  return value
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

function getResourceLabel(resourceType) {
  if (resourceType === 'translation') return '全文翻译'
  if (resourceType === 'annotations') return '原文标注'
  if (resourceType === 'notes') return '笔记'
  return '资源'
}

function getPaperStatusFlags(paper, resources = []) {
  const annotationEntry = getPaperResourceEntry(resources, 'annotations')
  const notesEntry = getPaperResourceEntry(resources, 'notes')
  const translationEntry = getPaperResourceEntry(resources, 'translation')
  const staleResource = resources.find((resource) => resource.status === 'stale') || null
  const hasAnnotations = Boolean(annotationEntry)
  const hasNotes = Boolean(notesEntry)
  const hasTranslation = Boolean(translationEntry)
  const isStale = Boolean(staleResource)
  const lastViewedAt = Number(paper?.lastViewedAt || 0)
  const ageHours = lastViewedAt ? (Date.now() - lastViewedAt) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY
  const isUnread = !Number.isFinite(lastViewedAt) || ageHours > 24 * 14
  const isReading = !isUnread && !hasNotes
  return {
    isUnread,
    isReading,
    hasAnnotations,
    hasNotes,
    hasTranslation,
    isStale,
    annotationCount: Number(annotationEntry?.count || 0),
    noteCount: Number(notesEntry?.count || 0),
    translationStatus: translationEntry?.status || '',
    staleResourceType: staleResource?.type || '',
    staleResourceLabel: staleResource?.label || getResourceLabel(staleResource?.type || ''),
    staleResourcePreview: staleResource?.preview || '',
  }
}

function getPaperStatusLabel(flags) {
  if (flags.isStale) return `${flags.staleResourceLabel || '资源'}待更新`
  if (flags.isUnread) return '待阅读'
  if (flags.hasTranslation && flags.hasNotes) return '资料齐全'
  if (flags.isReading) return '阅读中'
  if (flags.hasNotes) return '有笔记'
  return '继续阅读'
}

function matchesLibraryStatusFilter(filterId, paper, paperResourcesById) {
  if (!filterId || filterId === 'all') return true
  const flags = getPaperStatusFlags(paper, getPaperResourceEntries(paper.id, paperResourcesById))
  if (filterId === 'unread') return flags.isUnread
  if (filterId === 'reading') return flags.isReading
  if (filterId === 'notes') return flags.hasNotes
  if (filterId === 'translation') return flags.hasTranslation
  if (filterId === 'stale') return flags.isStale
  return true
}

function buildContinueWorkItem(recentPapers) {
  const currentPaper = recentPapers[0]
  if (!currentPaper) return null
  return {
    paper: currentPaper,
  }
}

function buildPendingTasks({
  recentPapers,
  paperResourcesById,
  readingDashboard,
  trashPapers,
}) {
  const tasks = []
  const overview = readingDashboard?.overview || {}
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
  })
}

const RESOURCE_MAP_VIEWBOX_SIZE = 100
const RESOURCE_DRAG_THRESHOLD = 5
const RESOURCE_BRANCH_ORIGIN_EPSILON = 0.1
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

function PaperResourceMap({ paper, resources = [], onOpenResource, onSaveResourceLayout }) {
  const mapRef = useRef(null)
  const dragStateRef = useRef(null)
  const suppressClickRef = useRef('')
  const [hoveredType, setHoveredType] = useState('')
  const [draggingType, setDraggingType] = useState('')
  const [saveError, setSaveError] = useState('')
  const [leafLayouts, setLeafLayouts] = useState({})
  const [branchOrigin, setBranchOrigin] = useState(DEFAULT_RESOURCE_BRANCH_ORIGIN)
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

  useEffect(() => {
    const mapNode = mapRef.current
    const rowNode = mapNode?.closest('.home-category-table__row')
    if (!mapNode || !rowNode) return undefined

    let frameId = 0
    let resizeObserver = null

    function updateBranchOrigin() {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const mapRect = mapNode.getBoundingClientRect()
        const rowRect = rowNode.getBoundingClientRect()
        const contentBottom = Array.from(rowNode.children)
          .filter((child) => child !== mapNode && !child.classList.contains('paper-resource-map'))
          .reduce((bottom, child) => Math.max(bottom, child.getBoundingClientRect().bottom), rowRect.top)
        const nextOrigin = getResourceBranchOrigin({
          rowLeft: rowRect.left,
          rowWidth: rowRect.width,
          contentBottom,
          mapLeft: mapRect.left,
          mapTop: mapRect.top,
          mapWidth: mapRect.width,
          mapHeight: mapRect.height,
        })

        setBranchOrigin((current) => {
          const sameX = Math.abs(current.x_pct - nextOrigin.x_pct) < RESOURCE_BRANCH_ORIGIN_EPSILON
          const sameY = Math.abs(current.y_pct - nextOrigin.y_pct) < RESOURCE_BRANCH_ORIGIN_EPSILON
          return sameX && sameY ? current : nextOrigin
        })
      })
    }

    updateBranchOrigin()
    window.addEventListener('resize', updateBranchOrigin)
    if (window.ResizeObserver) {
      resizeObserver = new window.ResizeObserver(updateBranchOrigin)
      resizeObserver.observe(mapNode)
      resizeObserver.observe(rowNode)
    }

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateBranchOrigin)
      resizeObserver?.disconnect()
    }
  }, [resources.length])

  if (!resources.length) return null

  const layout = resources.map((resource, index) => {
    const fallback = getDefaultResourceLayout(resource, index, resources.length)
    const itemLayout = normalizeResourceLayout(leafLayouts[resource.type], fallback)
    return {
      resource,
      layout: itemLayout,
      d: buildResourceBranchPath(itemLayout, index, resources.length, branchOrigin),
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

function RecentWorkspaceEmptyState({
  isGuest,
  hasHistory,
  recoverableCount = 0,
  onImportPaper,
  onGoSearch,
  onOpenTrash,
}) {
  const heading = hasHistory
    ? '你的阅读工作台暂时空了，但这不一定意味着要从头开始'
    : '先导入一篇文献，这里才会开始像工作台一样运转'
  const description = hasHistory
    ? '如果你之前读过文献，这里之所以空着，通常是因为当前库里已经没有可读文献了。你可以重新导入，也可以先去回收站看看有没有需要恢复的内容。'
    : '你打开、标注、生成摘要之后，最近阅读、待处理事项和阅读节奏才会自动整理出来。没有文献时，这一页只保留最直接的下一步。'
  const primaryLabel = isGuest ? '登录后导入文献' : '导入文献'
  const secondaryLabel = recoverableCount > 0 ? `回收站里还有 ${recoverableCount} 篇` : '先去文献检索'
  const tips = hasHistory
    ? [
        '恢复文献后，阅读轨迹会重新接上',
        '导入新文献后，这里会继续记录进度',
        '空页面不再误导成首次使用',
      ]
    : [
        '最近打开过的文献',
        '待整理的标注和笔记',
        '本周阅读节奏',
      ]

  return (
    <section className="home-empty-state home-empty-state--workspace">
      <div className="home-empty-state__eyebrow">阅读记录</div>

      <div className="home-empty-state__hero">
        <div className="home-empty-state__icon home-empty-state__icon--workspace">
          <FilePlus2 />
        </div>

        <div className="home-empty-state__copy">
          <h3>{heading}</h3>
          <p>{description}</p>
        </div>
      </div>

      <div className="home-empty-state__actions">
        <button type="button" className="home-primary-button" onClick={onImportPaper}>
          <FilePlus2 />
          <span>{primaryLabel}</span>
        </button>
        <button
          type="button"
          className="home-secondary-button"
          onClick={recoverableCount > 0 ? onOpenTrash : onGoSearch}
        >
          {recoverableCount > 0 ? <RotateCcw /> : <SearchCheck />}
          <span>{secondaryLabel}</span>
        </button>
      </div>

      <div className="home-empty-state__tips" aria-label="导入后会出现的内容">
        {tips.map((tip) => (
          <span key={tip}>{tip}</span>
        ))}
      </div>
    </section>
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
  const displayTitle = cleanPaperTitleForDisplay(paper.title, paper.fileName)

  return (
    <section className="home-continue-card">
      <div className="home-continue-card__body">
        <div className="home-continue-card__copy">
          <p className="panel-label">继续上次工作</p>
          <h3 title={compactHomeText(paper.title) || displayTitle}>{displayTitle}</h3>
          <div className="home-continue-card__meta-row" aria-label="最近阅读时间">
            <time className="home-continue-card__time">
              {formatDateTime(paper.lastViewedAt)}
            </time>
          </div>
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
  const [isExpanded, setIsExpanded] = useState(false)
  const visibleTasks = isExpanded ? tasks : tasks.slice(0, HOME_PENDING_VISIBLE_COUNT)
  const hiddenTaskCount = Math.max(tasks.length - HOME_PENDING_VISIBLE_COUNT, 0)

  return (
    <section className="home-pending-panel">
      <div className="home-section-head home-section-head--compact home-section-head--with-search">
        <div className="home-section-head__copy">
          <h3>现在最值得处理的事</h3>
          <span>点一下直接跳到对应文献或工作区</span>
        </div>
      </div>

      {tasks.length ? (
        <div className="home-pending-list" id="home-pending-task-list">
          {visibleTasks.map((task, index) => (
            <button
              key={task.id}
              type="button"
              className={`home-pending-item home-pending-item--${task.tone || 'slate'}`}
              onClick={() => onTaskClick(task)}
            >
              <span className="home-pending-item__rank">{String(index + 1).padStart(2, '0')}</span>
              <strong className="home-pending-item__count">{task.count}</strong>
              <span className="home-pending-item__body">
                <span className="home-pending-item__title">{task.title}</span>
                <small>{task.helper}</small>
                {task.label ? <em>{task.label}</em> : null}
              </span>
              <ChevronRight className="home-pending-item__arrow" aria-hidden="true" />
            </button>
          ))}
          {hiddenTaskCount > 0 ? (
            <button
              type="button"
              className="home-pending-more"
              aria-controls="home-pending-task-list"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((value) => !value)}
            >
              <span>{isExpanded ? '收起列表' : `还有 ${hiddenTaskCount} 项`}</span>
              {isExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="home-inline-message">当前没有堆着不处理就会耽误的事，可以直接回到你的阅读列表继续推进。</div>
      )}
    </section>
  )
}

function WeeklyReadingSummary({ stats }) {
  return (
    <section className="home-weekly-summary" aria-label="本周阅读">
      <div className="home-weekly-summary__label">本周阅读</div>
      <div className="home-weekly-summary__items">
        {stats.map((item) => {
          const Icon = item.icon
          const iconClass = item.period ? 'icon-animate-pulse' : ''
          return (
            <article key={item.id} className="home-weekly-summary__item">
              <div className="home-weekly-summary__icon">
                <Icon className={iconClass} />
              </div>
              <div className="home-weekly-summary__copy">
                <p>{item.label}</p>
                <strong>{item.value}</strong>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function HomeSearchControl({
  activeSection,
  searchTerm,
  onSearchChange,
  searchResults,
  onResultClick,
  className = '',
}) {
  const placeholder =
    activeSection === 'library'
      ? '搜索当前文件夹标题、作者、关键词'
      : '搜索当前工作区文献'

  return (
    <div className={`home-search-wrap${className ? ` ${className}` : ''}`}>
      <label className="home-search">
        <Search />
        <input
          type="search"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      {searchResults.length > 0 ? (
        <div className="home-search-results">
          {searchResults.map((paper) => (
            <button
              key={paper.id}
              type="button"
              className="home-search-results__item"
              onClick={() => onResultClick(paper)}
            >
              <span className="home-search-results__title">{paper.title}</span>
              <span className="home-search-results__folder">{paper._folderName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  onRefreshPaperMetadata,
  onSaveResourceLayout,
  paperResourcesById = {},
  advancedFilters = {},
  statusFilter = 'all',
  recentPapers,
  searchTerm,
  selectedFolderId,
  uncategorizedFolderId,
}) {
  const [menuPaperId, setMenuPaperId] = useState('')
  const [expandedResourcePaperId, setExpandedResourcePaperId] = useState('')
  const [selectedPaperIds, setSelectedPaperIds] = useState(() => new Set())
  const [bulkTargetFolderId, setBulkTargetFolderId] = useState('')
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

    return matchesLibraryAdvancedFilters(paper, {
      ...advancedFilters,
      keyword,
    })
  })

  const PAGE_SIZE = 10
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(papersInCategory.length / PAGE_SIZE))

  useEffect(() => {
    setCurrentPage(1)
    setMenuPaperId('')
    setExpandedResourcePaperId('')
    setSelectedPaperIds(new Set())
    setBulkTargetFolderId('')
  }, [selectedFolderId, searchTerm, statusFilter, advancedFilters.author, advancedFilters.year])

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
  const bulkSummary = buildLibraryBulkSummary(selectedPaperIds, papersInCategory)
  const allPageSelected = pagePapers.length > 0 && pagePapers.every((paper) => selectedPaperIds.has(String(paper.id)))

  function togglePaperSelection(paperId) {
    setSelectedPaperIds((previous) => {
      const next = new Set(previous)
      const id = String(paperId)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePageSelection() {
    setSelectedPaperIds((previous) => {
      const next = new Set(previous)
      if (allPageSelected) {
        pagePapers.forEach((paper) => next.delete(String(paper.id)))
      } else {
        pagePapers.forEach((paper) => next.add(String(paper.id)))
      }
      return next
    })
  }

  function refreshPaperMetadataQuietly(paperId) {
    if (!onRefreshPaperMetadata) return
    Promise.resolve(onRefreshPaperMetadata(paperId)).catch(() => {})
  }

  function runBulkAction(action, value = '') {
    const plan = createBulkOperationPlan(action, selectedPaperIds, value)
    if (!plan.canRun) return
    plan.paperIds.forEach((paperId) => {
      if (action === 'move') onMovePaper(paperId, value)
      if (action === 'delete') onDeletePaper(paperId)
      if (action === 'refresh-metadata') refreshPaperMetadataQuietly(paperId)
    })
    setSelectedPaperIds(new Set())
    setBulkTargetFolderId('')
    setMenuPaperId('')
  }

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

      {bulkSummary.hasSelection ? (
        <div className="home-library-bulkbar">
          <strong>已选 {bulkSummary.count} 篇</strong>
          <select
            value={bulkTargetFolderId}
            onChange={(event) => setBulkTargetFolderId(event.target.value)}
            aria-label="批量移动目标分类"
          >
            <option value="">选择目标分类</option>
            <option value={uncategorizedFolderId}>未分类</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => runBulkAction('move', bulkTargetFolderId)} disabled={!bulkTargetFolderId}>
            移动
          </button>
          <button type="button" onClick={() => runBulkAction('refresh-metadata')} disabled={!onRefreshPaperMetadata}>
            重新识别
          </button>
          <button type="button" className="is-danger" onClick={() => runBulkAction('delete')}>
            删除
          </button>
          <button type="button" onClick={() => setSelectedPaperIds(new Set())}>
            取消选择
          </button>
        </div>
      ) : null}

      <div className="home-category-table">
        <div className="home-category-table__head">
          <span>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={togglePageSelection}
              aria-label="选择当前页文献"
            />
          </span>
          <span>原文标题</span>
          <span>译文标题</span>
          <span>作者</span>
          <span>页数</span>
          <span aria-hidden="true" />
        </div>

        {papersInCategory.length > 0 ? (
          pagePapers.map((paper) => {
            const resourceRecord = paperResourcesById[String(paper.id)]
            const resources = resourceRecord?.resources || []
            const flags = getPaperStatusFlags(paper, resources)
            const isResourceExpanded = expandedResourcePaperId === paper.id && resources.length > 0
            const isSelected = selectedPaperIds.has(String(paper.id))

            return (
              <div
                key={paper.id}
                className={`home-category-table__row${highlightPaperId === paper.id ? ' is-highlight' : ''}${isResourceExpanded ? ' is-resource-expanded' : ''}${isSelected ? ' is-selected' : ''}`}
              >
                <label className="home-category-select">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => togglePaperSelection(paper.id)}
                    aria-label={`选择 ${paper.title}`}
                  />
                </label>
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
                        className="home-row-menu__item"
                        onClick={() => {
                          setMenuPaperId('')
                          refreshPaperMetadataQuietly(paper.id)
                        }}
                        disabled={!onRefreshPaperMetadata}
                      >
                        重新识别元数据
                      </button>
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
  currentUser,
  folders,
  importConflict,
  importStatus = null,
  isImporting,
  onCancelImportConflict,
  onCreateFolder,
  onDeleteFolder,
  onDeletePaper,
  onEmptyTrash,
  onMovePaper,
  onOpenFilePicker,
  onOpenPaper,
  onOpenResource,
  onPermanentlyDeletePaper,
  onRefreshPaperMetadata,
  onRefreshResources,
  onRefreshTrash,
  onRestorePaper,
  onSaveResourceLayout,
  onRenameFolder,
  onResolveImportConflict,
  onRetryImportConflict,
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
  initialSection = 'recent',
  onRequestLogin,
}) {
  const isGuest = !currentUser
  const [activeSection, setActiveSection] = useState(initialSection || 'recent')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState(uncategorizedFolderId)
  const [libraryStatusFilter, setLibraryStatusFilter] = useState('all')
  const [libraryAuthorFilter, setLibraryAuthorFilter] = useState('')
  const [libraryYearFilter, setLibraryYearFilter] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderError, setFolderError] = useState('')
  const [showImportMenu, setShowImportMenu] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState('')
  const [editFolderName, setEditFolderName] = useState('')
  const [highlightPaperId, setHighlightPaperId] = useState('')
  const [jumpPaperId, setJumpPaperId] = useState('')
  const visibleHomeSections = homeSections
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const effectiveSearchTerm = searchTerm.trim() ? deferredSearchTerm : ''
  const importProgressMessage = importStatus?.message || '导入中...'

  useEffect(() => {
    if (uncategorizedFolderId && selectedFolderId === '') {
      setSelectedFolderId(uncategorizedFolderId)
    }
  }, [uncategorizedFolderId, selectedFolderId])

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection)
    }
  }, [initialSection])

  useEffect(() => {
    if (activeSection !== 'library') {
      setShowImportMenu(false)
    }
  }, [activeSection])

  const groupedPapers = useMemo(
    () => buildGroupedPapers(recentPapers, effectiveSearchTerm),
    [effectiveSearchTerm, recentPapers],
  )
  const hasImportedPapers = recentPapers.length > 0
  const showRecentWorkspaceEmpty = activeSection === 'recent' && !hasImportedPapers
  const hasRecentReadingHistory = recentReadings.length > 0
  const hasReadingStatsHistory = Number(readingStats?.weekly_opens || 0) > 0
  const hasRecoverableTrash = trashPapers.length > 0
  const showRecentWorkspaceHistoryState =
    hasRecentReadingHistory || hasReadingStatsHistory || hasRecoverableTrash

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
      effectiveSearchTerm,
    )
  }, [effectiveSearchTerm, recentReadings])

  const paperResourcesById = useMemo(
    () => getPaperResourceMap(resourceOverview),
    [resourceOverview],
  )

  const continueWorkItem = useMemo(() => buildContinueWorkItem(recentPapers), [recentPapers])

  const pendingTasks = useMemo(
    () => buildPendingTasks({
      recentPapers,
      paperResourcesById,
      readingDashboard,
      trashPapers,
    }),
    [paperResourcesById, readingDashboard, recentPapers, trashPapers],
  )

  const activeLibraryFilterLabel = useMemo(
    () => LIBRARY_STATUS_FILTERS.find((item) => item.id === libraryStatusFilter)?.label || '全部',
    [libraryStatusFilter],
  )
  const libraryAdvancedOptions = useMemo(
    () => getLibraryAdvancedFilterOptions(recentPapers, selectedFolderId),
    [recentPapers, selectedFolderId],
  )
  const activeAdvancedFilterCount = Number(Boolean(libraryAuthorFilter)) + Number(Boolean(libraryYearFilter))

  function requireLogin(featureLabel = '该功能') {
    if (!isGuest) return false
    const shouldLogin = window.confirm(`${featureLabel}需要登录后才能使用。现在去登录吗？`)
    if (shouldLogin) {
      onRequestLogin?.()
    }
    return true
  }

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
    if ((activeSection !== 'library' && activeSection !== 'recent') || !effectiveSearchTerm.trim()) return []
    const kw = effectiveSearchTerm.trim().toLowerCase()
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
  }, [activeSection, effectiveSearchTerm, recentPapers, folders, uncategorizedFolderId])

  function handleGlobalSearchClick(paper) {
    if (requireLogin('打开文献')) return
    setSearchTerm('')
    setSelectedFolderId(paper.folderId)
    setLibraryStatusFilter('all')
    setLibraryAuthorFilter('')
    setLibraryYearFilter('')
    setActiveSection('library')
    setHighlightPaperId(paper.id)
    setJumpPaperId(paper.id)
  }

  function handleClearHighlight() {
    setHighlightPaperId('')
    setJumpPaperId('')
  }

  async function handleCreateFolder() {
    if (isSubmittingFolder) return
    if (requireLogin('新建分类')) return

    const normalizedName = folderName.trim()
    if (!normalizedName) {
      setFolderError('请输入文件夹名称')
      return
    }

    setIsSubmittingFolder(true)
    setFolderError('')

    try {
      const result = await onCreateFolder(normalizedName)
      if (!result?.ok) {
        setFolderError(result?.message || '创建失败，请稍后重试')
        return
      }

      setFolderName('')
      setSelectedFolderId(result.folder.id)
      setIsCreatingFolder(false)
      setActiveSection('library')
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : '创建失败，请稍后重试')
    } finally {
      setIsSubmittingFolder(false)
    }
  }

  function handleImportToFolder(folderId) {
    if (requireLogin('导入文献')) return
    setShowImportMenu(false)
    onOpenFilePicker(folderId, { activate: false })
  }

  function handleDeleteFolder(folderId) {
    if (requireLogin('删除分类')) return
    onDeleteFolder(folderId)
    if (selectedFolderId === folderId) {
      setSelectedFolderId(uncategorizedFolderId)
    }
  }

  function handleSelectSection(sectionId) {
    if (isGuest && ['library', 'paper-format', 'insights', 'trash'].includes(sectionId)) {
      requireLogin(homeSections.find((item) => item.id === sectionId)?.label || '该功能')
      return
    }
    setActiveSection(sectionId)
    if (sectionId === 'trash') {
      onRefreshTrash?.()
    }
  }

  function handleOpenResourcePreview(paper, resource) {
    if (requireLogin('查看资源')) return
    handleOpenResource(paper, resource, null)
  }

  function handleBrowseLibrary() {
    if (requireLogin('我的文献')) return
    setActiveSection('library')
    setLibraryStatusFilter('all')
    setLibraryAuthorFilter('')
    setLibraryYearFilter('')
    setSearchTerm('')
  }

  function handlePendingTaskClick(task) {
    if (requireLogin(task.title || '该功能')) return
    if (task.id === 'trash-soon') {
      setActiveSection('trash')
      onRefreshTrash?.()
      return
    }

    setActiveSection('library')
    setLibraryStatusFilter(task.id === 'notes' ? 'notes' : task.id)
    setLibraryAuthorFilter('')
    setLibraryYearFilter('')
    setSearchTerm('')
  }

  return (
    <section className="home-shell home-shell--redesign">
      <aside className="home-sidebar">
        <div className="home-sidebar__group">
          {visibleHomeSections.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            const isLibrary = item.id === 'library'

            return (
              <div key={item.id}>
                <div className="home-sidebar__item-row">
                  <button
                    type="button"
                    className={`home-sidebar__item${isActive ? ' is-active' : ''}`}
                    onFocus={() => preloadHomeSection(item.id)}
                    onMouseEnter={() => preloadHomeSection(item.id)}
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
                        setIsCreatingFolder((current) => {
                          if (!current) {
                            setFolderError('')
                          }
                          return !current
                        })
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
                          onChange={(event) => {
                            setFolderName(event.target.value)
                            if (folderError) setFolderError('')
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              handleCreateFolder()
                            } else if (event.key === 'Escape') {
                              setIsCreatingFolder(false)
                              setFolderError('')
                            }
                          }}
                          disabled={isSubmittingFolder}
                        />
                        <button
                          type="button"
                          onClick={handleCreateFolder}
                          disabled={isSubmittingFolder || !folderName.trim()}
                        >
                          {isSubmittingFolder ? '添加中' : '添加'}
                        </button>
                        {folderError ? (
                          <p className="home-sidebar-create__error" role="alert">
                            {folderError}
                          </p>
                        ) : null}
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

      <div className={`home-content${activeSection === 'recent' ? ' is-recent' : ''}${activeSection === 'library' ? ' is-library' : ''}${activeSection === 'literature-search' ? ' is-literature-search' : ''}${activeSection === 'paper-format' ? ' is-paper-format' : ''}`}>
        {activeSection === 'library' ? (
        <div className={`home-toolbar${activeSection === 'library' ? ' is-library' : ''}`}>
          {activeSection === 'library' ? (
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
          ) : null}

          {activeSection === 'library' ? (
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
          ) : null}
        </div>
        ) : null}

        {activeSection === 'recent' ? (
          <>
            {!isGuest && !showRecentWorkspaceEmpty ? (
              <>
                <ContinueWorkSection
                  item={continueWorkItem}
                  onBrowseLibrary={handleBrowseLibrary}
                  onOpenPaper={(paperId) => {
                    if (requireLogin('继续阅读')) return
                    onOpenPaper(paperId)
                  }}
                  onOpenResource={handleOpenResourcePreview}
                  paperResourcesById={paperResourcesById}
                />

                <div className="home-overview-band">
                  <PendingTaskSection
                    tasks={pendingTasks}
                    onTaskClick={handlePendingTaskClick}
                  />
                  <WeeklyReadingSummary stats={weeklyStats} />
                </div>
              </>
            ) : null}

            {showRecentWorkspaceEmpty ? (
              <RecentWorkspaceEmptyState
                isGuest={isGuest}
                hasHistory={showRecentWorkspaceHistoryState}
                recoverableCount={trashPapers.length}
                onImportPaper={() => {
                  if (requireLogin('导入文献')) return
                  onOpenFilePicker(uncategorizedFolderId, { activate: false })
                }}
                onGoSearch={() => setActiveSection('literature-search')}
                onOpenTrash={() => {
                  setActiveSection('trash')
                  onRefreshTrash?.()
                }}
              />
            ) : null}
          </>
        ) : null}

        {activeSection === 'insights' ? (
          <Suspense fallback={<SectionFallback message="正在加载阅读洞察..." />}>
            <ReadingInsightSection
              dashboard={readingDashboard}
              timeframe={insightTimeframe}
              uiFontScale={uiFontScale}
              onTimeframeChange={onInsightTimeframeChange}
            />
          </Suspense>
        ) : null}

        {activeSection === 'literature-search' ? (
          <Suspense fallback={<SectionFallback message="正在加载文献检索..." />}>
            <LiteratureSearchPage />
          </Suspense>
        ) : null}

        {activeSection === 'paper-format' ? (
          <Suspense fallback={<SectionFallback message="正在加载格式正规化工具..." />}>
            <PaperFormatPage />
          </Suspense>
        ) : null}

        {activeSection !== 'insights' && activeSection !== 'literature-search' && activeSection !== 'paper-format' && !showRecentWorkspaceEmpty ? (
        <div className={`home-section-head${activeSection === 'library' ? ' is-library' : ''}`}>
          <h3>
            {activeSection === 'recent' && '最近打开的文献'}
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
          {activeSection === 'recent' ? (
            <HomeSearchControl
              activeSection={activeSection}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              searchResults={globalSearchResults}
              onResultClick={handleGlobalSearchClick}
              className="home-search-wrap--recent"
            />
          ) : null}
        </div>
        ) : null}

        {activeSection === 'recent' && !showRecentWorkspaceEmpty ? (
          <RecentSection
            groupedPapers={groupedReadings}
            onOpenPaper={(paperId) => {
              if (requireLogin('打开阅读记录')) return
              onOpenPaper(paperId)
            }}
          />
        ) : null}

        {activeSection === 'library' ? (
          <>
            <div className="home-status-filter">
              <div className="home-status-filter__options">
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

              <div className="home-library-advanced-filter">
              <label>
                <span>作者</span>
                <input
                  type="search"
                  list="library-author-options"
                  value={libraryAuthorFilter}
                  onChange={(event) => setLibraryAuthorFilter(event.target.value)}
                  placeholder="输入作者"
                />
              </label>
              <datalist id="library-author-options">
                {libraryAdvancedOptions.authors.map((author) => (
                  <option key={author} value={author} />
                ))}
              </datalist>
              <label>
                <span>年份</span>
                <select
                  value={libraryYearFilter}
                  onChange={(event) => setLibraryYearFilter(event.target.value)}
                >
                  <option value="">全部年份</option>
                  {libraryAdvancedOptions.years.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
              {activeAdvancedFilterCount ? (
                <button
                  type="button"
                  onClick={() => {
                    setLibraryAuthorFilter('')
                    setLibraryYearFilter('')
                  }}
                >
                  清除筛选
                </button>
              ) : null}
            </div>
            </div>

            <CategorySection
              folders={folders}
              advancedFilters={{
                author: libraryAuthorFilter,
                year: libraryYearFilter,
              }}
              highlightPaperId={highlightPaperId}
              jumpPaperId={jumpPaperId}
              onClearHighlight={handleClearHighlight}
              onDeletePaper={onDeletePaper}
              onMovePaper={onMovePaper}
              onOpenPaper={(paperId) => {
                if (requireLogin('打开文献')) return
                onOpenPaper(paperId)
              }}
              onOpenResource={(paper, resource, trigger) => {
                if (requireLogin('查看资源')) return
                handleOpenResource(paper, resource, trigger)
              }}
              onRefreshPaperMetadata={onRefreshPaperMetadata}
              onSaveResourceLayout={onSaveResourceLayout}
              paperResourcesById={paperResourcesById}
              recentPapers={recentPapers}
              searchTerm={effectiveSearchTerm}
              selectedFolderId={selectedFolderId}
              statusFilter={libraryStatusFilter}
              uncategorizedFolderId={uncategorizedFolderId}
            />
          </>
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
                {importConflict.conflictType === 'failed_import' ? (
                  <>
                    <button
                      type="button"
                      className="home-primary-button"
                      onClick={onRetryImportConflict}
                    >
                      重试导入
                    </button>
                    <button
                      type="button"
                      className="home-secondary-button"
                      onClick={onCancelImportConflict}
                    >
                      取消
                    </button>
                  </>
                ) : importConflict.conflictType === 'same_file' ? (
                  <>
                    <button
                      type="button"
                      className="home-primary-button"
                      onClick={onResolveImportConflict}
                    >
                      打开已有文献
                    </button>
                    <button
                      type="button"
                      className="home-secondary-button"
                      onClick={onCancelImportConflict}
                    >
                      取消
                    </button>
                  </>
                ) : importConflict.conflictType === 'other_folder' ? (
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
              <p>{importProgressMessage}</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
