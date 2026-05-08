import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Columns,
  Download,
  Eraser,
  Languages,
  MousePointer2,
  ScanLine,
  Search,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

const toolItems = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'screenshot', label: '截图', icon: Camera },
  { id: 'eraser', label: '涂抹擦除', icon: Eraser },
  { id: 'erase_box', label: '框选擦除', icon: ScanLine },
]

const downloadItems = [
  { id: 'pdf', label: 'PDF 文件' },
  { id: 'gbt7714', label: 'GB/T 7714-2015 引文' },
  { id: 'cajcd', label: 'CAJ-CD 引文' },
  { id: 'mla', label: 'MLA 引文' },
]

const parseModeItems = [
  { id: 'auto', label: '自动解析' },
  { id: 'local', label: '仅本地' },
  { id: 'aliyun', label: '阿里云增强' },
]

function ToolbarIconButton({ children, label, onClick, active = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`toolbar-icon-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
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
  canUndo = false,
  onUndo,
  onDownload,
  fullTranslateActive = false,
  fullTranslateStatus = 'idle',
  fullTranslateProgress = 0,
  fullTranslateParseMode = 'auto',
  onFullTranslateParseModeChange,
  onFullTranslate,
}) {
  const downloadWrapRef = useRef(null)
  const [isDownloadOpen, setIsDownloadOpen] = useState(false)

  useEffect(() => {
    if (!isDownloadOpen) return undefined

    function handlePointerDown(event) {
      if (!downloadWrapRef.current?.contains(event.target)) {
        setIsDownloadOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isDownloadOpen])

  function handleSearchInput(event) {
    onSearchChange?.(event.target.value)
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) onSearchPrev?.()
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
              title={item.label}
              aria-label={item.label}
              onClick={() => onToolChange(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          )
        })}

        <button
          type="button"
          className={`toolbar-tool toolbar-tool--full-translate toolbar-tool--full-translate-${fullTranslateStatus}${
            fullTranslateActive ? ' is-active' : ''
          }`}
          title="全文翻译"
          aria-label="全文翻译"
          onClick={onFullTranslate}
        >
          {fullTranslateStatus === 'running' ? (
            <span
              className="toolbar-progress-ring"
              style={{ '--progress': `${Math.max(0, Math.min(100, fullTranslateProgress || 0))}%` }}
            />
          ) : (
            <Languages />
          )}
          <span>
            {fullTranslateStatus === 'running'
              ? `翻译中 ${Math.round(fullTranslateProgress || 0)}%`
              : fullTranslateStatus === 'cancelled'
                ? '已取消'
                : '全文·翻译'}
          </span>
        </button>

        <select
          className="toolbar-parse-mode"
          title="全文翻译解析方式"
          aria-label="全文翻译解析方式"
          value={fullTranslateParseMode || 'auto'}
          onChange={(event) => onFullTranslateParseModeChange?.(event.target.value)}
        >
          {parseModeItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>

        <div className="toolbar-download" ref={downloadWrapRef}>
          <button
            type="button"
            className="toolbar-tool toolbar-tool--download"
            title="下载"
            aria-label="下载"
            aria-expanded={isDownloadOpen}
            onClick={() => setIsDownloadOpen((value) => !value)}
          >
            <Download />
            <span>下载</span>
          </button>

          {isDownloadOpen ? (
            <div className="toolbar-download-menu">
              {downloadItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="toolbar-download-menu__item"
                  onClick={() => {
                    setIsDownloadOpen(false)
                    onDownload?.(item.id)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="toolbar-group toolbar-group--compact">
        <ToolbarIconButton
          label="撤销本次标注操作"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 />
        </ToolbarIconButton>

        <div className="toolbar-search">
          <Search className="toolbar-search__icon" />
          <input
            className="toolbar-search__input"
            type="text"
            placeholder="查找（不区分大小写）"
            value={searchTerm || ''}
            onChange={handleSearchInput}
            onKeyDown={handleSearchKeyDown}
          />
          {searchTerm ? (
            <>
              <span className="toolbar-search__count">
                {totalMatches > 0 ? `${(matchIndex || 0) + 1}/${totalMatches}` : '0/0'}
              </span>
              <button type="button" className="toolbar-search__btn" title="上一个（Shift+Enter）" onClick={onSearchPrev}>
                <ArrowUp />
              </button>
              <button type="button" className="toolbar-search__btn" title="下一个（Enter）" onClick={onSearchNext}>
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
