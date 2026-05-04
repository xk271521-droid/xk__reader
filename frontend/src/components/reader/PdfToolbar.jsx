import {
  ArrowDown,
  ArrowUp,
  Columns,
  Crop,
  Download,
  Eraser,
  Highlighter,
  MessageSquareText,
  MousePointer2,
  Paintbrush,
  Pencil,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

const toolItems = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'highlight', label: '高亮', icon: Highlighter },
  { id: 'underline', label: '下划线', icon: Pencil },
  { id: 'eraser', label: '橡皮擦', icon: Eraser },
  { id: 'search', label: '查找', icon: Search },
  { id: 'download', label: '下载', icon: Download },
]

function ToolbarIconButton({ children, label, onClick, active = false }) {
  return (
    <button
      type="button"
      className={`toolbar-icon-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

export function PdfToolbar({
  activeTool,
  isThumbnailsOpen,
  onToggleThumbnails,
  onToolChange,
  onZoomIn,
  onZoomOut,
  pageNumber,
  scale,
  totalPages,
  searchTerm,
  onSearchChange,
  matchIndex,
  totalMatches,
  onSearchPrev,
  onSearchNext,
}) {
  function handleSearchInput(e) {
    onSearchChange?.(e.target.value)
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onSearchPrev?.()
      else onSearchNext?.()
    }
  }
  return (
    <div className="reader-toolbar">
      <div className="toolbar-group toolbar-group--file">
        <ToolbarIconButton
          label={isThumbnailsOpen ? '关闭缩略图' : '打开缩略图'}
          onClick={onToggleThumbnails}
          active={isThumbnailsOpen}
        >
          <Columns />
        </ToolbarIconButton>
      </div>

      <div className="toolbar-group toolbar-group--tools">
        {toolItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              className={`toolbar-tool toolbar-tool--${item.id}${
                activeTool === item.id ? ' is-active' : ''
              }`}
              key={item.id}
              onClick={() => onToolChange(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="toolbar-group toolbar-group--compact">
        <div className="toolbar-search">
          <Search className="toolbar-search__icon" />
          <input
            className="toolbar-search__input"
            type="text"
            placeholder="查找"
            value={searchTerm || ''}
            onChange={handleSearchInput}
            onKeyDown={handleSearchKeyDown}
          />
          {searchTerm ? (
            <>
              <span className="toolbar-search__count">
                {totalMatches > 0 ? `${(matchIndex || 0) + 1}/${totalMatches}` : '0/0'}
              </span>
              <button type="button" className="toolbar-search__btn" title="上一个 (Shift+Enter)" onClick={onSearchPrev}>
                <ArrowUp />
              </button>
              <button type="button" className="toolbar-search__btn" title="下一个 (Enter)" onClick={onSearchNext}>
                <ArrowDown />
              </button>
              <button type="button" className="toolbar-search__btn" title="清除" onClick={() => onSearchChange?.('')}>
                <X />
              </button>
            </>
          ) : null}
        </div>

        <span className="toolbar-indicator">
          {totalPages > 0 ? `${pageNumber} / ${totalPages}` : '未加载'}
        </span>
        <ToolbarIconButton label="缩小" onClick={onZoomOut}>
          <ZoomOut />
        </ToolbarIconButton>
        <span className="toolbar-indicator toolbar-indicator--strong">
          {Math.round(scale * 100)}%
        </span>
        <ToolbarIconButton label="放大" onClick={onZoomIn}>
          <ZoomIn />
        </ToolbarIconButton>
      </div>
    </div>
  )
}
