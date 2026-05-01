import { useEffect, useMemo, useState } from 'react'
import {
  BookCopy,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderPlus,
  LibraryBig,
  MoreHorizontal,
  Package2,
  Search,
  TimerReset,
  Trash2,
} from 'lucide-react'

const homeSections = [
  { id: 'recent', label: '最近阅读', icon: Clock3 },
  { id: 'library', label: '我的文献', icon: LibraryBig },
  { id: 'resources', label: '我的资源', icon: Package2 },
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

function buildWeeklyStats(recentPapers) {
  const now = Date.now()
  const weekThreshold = now - 7 * 24 * 60 * 60 * 1000
  const weeklyPapers = recentPapers.filter((paper) => paper.lastViewedAt >= weekThreshold)
  const totalPages = weeklyPapers.reduce((sum, paper) => sum + (paper.metadata.pageCount || 0), 0)

  return [
    {
      id: 'sessions',
      label: '本周阅读次数',
      value: `${Math.max(weeklyPapers.length * 2, recentPapers.length)} 次`,
      icon: TimerReset,
    },
    {
      id: 'papers',
      label: '本周阅读篇数',
      value: `${weeklyPapers.length} 篇`,
      icon: BookCopy,
    },
    {
      id: 'duration',
      label: '预估阅读时长',
      value: `${Math.max(30, Math.round(totalPages * 1.8 || 30))} 分钟`,
      icon: BookMarked,
    },
  ]
}

function getTranslatedTitle(paper) {
  return paper.metadata?.translatedTitle || paper.metadata?.subject || '—'
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
  recentPapers,
  searchTerm,
  selectedFolderId,
  uncategorizedFolderId,
}) {
  const [menuPaperId, setMenuPaperId] = useState('')
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
  }

  function handleNextPage() {
    setCurrentPage((p) => Math.min(totalPages, p + 1))
    setMenuPaperId('')
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
          paddedRows.map((paper) =>
            paper._empty ? (
              <div key={paper._key} className="home-category-table__row home-category-table__row--empty" />
            ) : (
              <div
                key={paper.id}
                className={`home-category-table__row${highlightPaperId === paper.id ? ' is-highlight' : ''}`}
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
                          onDeletePaper(paper.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ),
          )
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

function ResourcesSection() {
  return (
    <div className="home-panel-grid">
      <div className="home-feature-card">
        <p className="panel-label">个人资源库</p>
        <h3>我的资源</h3>
        <p>这里预留给你管理模板、术语表、实验脚本和常用链接，后续可以接入真实资源文件。</p>
      </div>
      <div className="home-list-card home-resource-grid">
        <article className="home-mini-row">
          <span>阅读模板</span>
          <small>2 个</small>
        </article>
        <article className="home-mini-row">
          <span>术语词表</span>
          <small>0 个</small>
        </article>
        <article className="home-mini-row">
          <span>外部链接</span>
          <small>1 条</small>
        </article>
      </div>
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
  onRenameFolder,
  onResolveImportConflict,
  recentPapers,
  recentReadings = [],
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

  const weeklyStats = useMemo(() => buildWeeklyStats(recentPapers), [recentPapers])

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
                    onClick={() => setActiveSection(item.id)}
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
        {activeSection !== 'resources' && activeSection !== 'trash' ? (
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
                return (
                  <article key={item.id} className="home-stat-card">
                    <div className="home-stat-card__icon">
                      <Icon />
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
            {activeSection === 'resources' && '我的资源'}
            {activeSection === 'trash' && '回收站'}
          </h3>
          {activeSection !== 'library' ? (
            <span>
              {activeSection === 'recent' && '按最近访问时间排序'}
              {activeSection === 'resources' && '沉淀你的模板、词表与常用外部资料'}
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
            recentPapers={recentPapers}
            searchTerm={searchTerm}
            selectedFolderId={selectedFolderId}
            uncategorizedFolderId={uncategorizedFolderId}
          />
        ) : null}

        {activeSection === 'resources' ? <ResourcesSection /> : null}
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
