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
  Moon,
  MoreHorizontal,
  Package2,
  Search,
  Sun,
  Sunrise,
  TimerReset,
  Trash2,
} from 'lucide-react'

const homeSections = [
  { id: 'recent', label: '最近阅读', icon: Clock3 },
  { id: 'library', label: '我的文献', icon: LibraryBig },
  { id: 'trash', label: '回收站', icon: Trash2 },
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
              onOpenResource?.(paper, item.resource)
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
  }, [selectedFolderId, searchTerm])

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
                <span title={getTranslatedTitle(paper)}>{getTranslatedTitle(paper)}</span>
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

function TrashSection() {
  return (
    <div className="home-panel-grid">
      <div className="home-feature-card">
        <p className="panel-label">回收区域</p>
        <h3>回收站</h3>
        <p>后续这里会接入删除恢复、批量清理和保留期策略。</p>
      </div>
      <div className="home-list-card">
        <p>当前回收站为空。</p>
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
  onMovePaper,
  onOpenFilePicker,
  onOpenPaper,
  onOpenResource,
  onRefreshResources,
  onSaveResourceLayout,
  onRenameFolder,
  onResolveImportConflict,
  recentPapers,
  recentReadings = [],
  readingStats = null,
  resourceOverview = null,
  uncategorizedFolderId,
}) {
  const [activeSection, setActiveSection] = useState('recent')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState(uncategorizedFolderId)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [showImportMenu, setShowImportMenu] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState('')
  const [editFolderName, setEditFolderName] = useState('')
  const [highlightPaperId, setHighlightPaperId] = useState('')
  const [jumpPaperId, setJumpPaperId] = useState('')

  useEffect(() => {
    if (uncategorizedFolderId && selectedFolderId === '') {
      setSelectedFolderId(uncategorizedFolderId)
    }
  }, [uncategorizedFolderId, selectedFolderId])

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

  const paperResourcesById = useMemo(() => {
    const next = {}
    ;(resourceOverview?.papers || []).forEach((item) => {
      next[String(item.paper_id)] = item
    })
    return next
  }, [resourceOverview])

  function handleOpenResource(paper, resource) {
    const paperId = paper?.id ?? paper?.paper_id
    if (!paperId) return
    onOpenResource?.(paperId, resource)
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
                          onClick={() => setSelectedFolderId(uncategorizedFolderId)}
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
                              onClick={() => setSelectedFolderId(folder.id)}
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

      <div className="home-content">
        {activeSection !== 'trash' ? (
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
                    ? '搜索全部文献标题、作者、关键词…'
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
            <div className="home-heading">
              <div>
                <p className="panel-label">个人阅读工作台</p>
                <h2>这一周的阅读节奏</h2>
              </div>
              <div className="home-heading__meta">
                <LibraryBig />
                <span>{recentPapers.length} 篇会话文献</span>
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

        <div className={`home-section-head${activeSection === 'library' ? ' is-library' : ''}`}>
          <h3>
            {activeSection === 'recent' && '最近阅读'}
            {activeSection === 'library' && '我的文献'}
            {activeSection === 'trash' && '回收站'}
          </h3>
          {activeSection !== 'library' ? (
            <span>
              {activeSection === 'recent' && '按最近访问时间排序'}
              {activeSection === 'trash' && '后续可接恢复与彻底删除'}
            </span>
          ) : null}
        </div>

        {activeSection === 'recent' ? (
          <RecentSection groupedPapers={groupedReadings} onOpenPaper={onOpenPaper} />
        ) : null}

        {activeSection === 'library' ? (
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
            uncategorizedFolderId={uncategorizedFolderId}
          />
        ) : null}

        {activeSection === 'trash' ? <TrashSection /> : null}
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
