import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  Columns,
  Download,
  Eraser,
  Languages,
  MousePointer2,
  Pencil,
  ScanLine,
  Search,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

const toolItems = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'ink', label: '手绘', icon: Pencil },
  { id: 'screenshot', label: '截图', icon: Camera },
]

const eraserModeItems = [
  { id: 'brush', label: '涂抹擦除', tool: 'eraser', icon: Eraser },
  { id: 'box', label: '框选擦除', tool: 'erase_box', icon: ScanLine },
]

const inkColors = ['#15803D', '#2563EB', '#DC2626', '#F59E0B', '#111827', '#7C3AED', '#DB2777', '#0F766E']

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
  inkOptions = { color: '#15803D', opacity: 0.85, strokeWidth: 6 },
  onInkOptionsChange,
  activeEraserMode = 'brush',
  onEraserModeChange,
}) {
  const downloadWrapRef = useRef(null)
  const eraserWrapRef = useRef(null)
  const inkWrapRef = useRef(null)
  const [isDownloadOpen, setIsDownloadOpen] = useState(false)
  const [isEraserOpen, setIsEraserOpen] = useState(false)
  const [isInkOpen, setIsInkOpen] = useState(false)

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

  useEffect(() => {
    if (!isEraserOpen && !isInkOpen) return undefined

    function handlePointerDown(event) {
      if (isEraserOpen && !eraserWrapRef.current?.contains(event.target)) {
        setIsEraserOpen(false)
      }
      if (isInkOpen && !inkWrapRef.current?.contains(event.target)) {
        setIsInkOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isEraserOpen, isInkOpen])

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

  function updateInkOptions(partial) {
    onInkOptionsChange?.({
      ...inkOptions,
      ...partial,
    })
  }

  function selectEraserMode(item) {
    onEraserModeChange?.(item.id)
    onToolChange(item.tool)
    setIsEraserOpen(false)
  }

  const activeEraserLabel = activeEraserMode === 'box' ? '框选' : '涂抹'

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
          if (item.id === 'ink') {
            return (
              <div className="toolbar-popover-wrap" key={item.id} ref={inkWrapRef}>
                <button
                  type="button"
                  className={`toolbar-tool toolbar-tool--${item.id}${activeTool === item.id ? ' is-active' : ''}`}
                  title={item.label}
                  aria-label={item.label}
                  aria-expanded={isInkOpen}
                  onClick={() => {
                    onToolChange(item.id)
                    setIsInkOpen((value) => !value)
                    setIsEraserOpen(false)
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                  <ChevronDown className="toolbar-tool__chevron" />
                </button>

                {isInkOpen ? (
                  <div className="toolbar-popover toolbar-ink-panel">
                    <div className="toolbar-popover__title">画笔设置</div>
                    <div className="toolbar-ink-colors">
                      {inkColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`toolbar-ink-color${inkOptions.color === color ? ' is-active' : ''}`}
                          style={{ backgroundColor: color }}
                          title={color}
                          onClick={() => updateInkOptions({ color })}
                        >
                          {inkOptions.color === color ? <Check /> : null}
                        </button>
                      ))}
                    </div>
                    <label className="toolbar-ink-slider">
                      <span>不透明度</span>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={Math.round((inkOptions.opacity ?? 0.85) * 100)}
                        onChange={(event) => updateInkOptions({ opacity: Number(event.target.value) / 100 })}
                      />
                      <strong>{Math.round((inkOptions.opacity ?? 0.85) * 100)}%</strong>
                    </label>
                    <label className="toolbar-ink-slider">
                      <span>粗细</span>
                      <input
                        type="range"
                        min="1"
                        max="28"
                        value={inkOptions.strokeWidth ?? 6}
                        onChange={(event) => updateInkOptions({ strokeWidth: Number(event.target.value) })}
                      />
                      <strong>{inkOptions.strokeWidth ?? 6}px</strong>
                    </label>
                    <div className="toolbar-ink-preview">
                      <span
                        style={{
                          backgroundColor: inkOptions.color,
                          height: Math.max(2, Math.min(18, inkOptions.strokeWidth ?? 6)),
                          opacity: inkOptions.opacity ?? 0.85,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          }

          return (
            <button
              type="button"
              className={`toolbar-tool toolbar-tool--${item.id}${activeTool === item.id ? ' is-active' : ''}`}
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

        <div className="toolbar-popover-wrap" ref={eraserWrapRef}>
          <button
            type="button"
            className={`toolbar-tool toolbar-tool--eraser${
              activeTool === 'eraser' || activeTool === 'erase_box' ? ' is-active' : ''
            }`}
            title={`橡皮擦：${activeEraserLabel}`}
            aria-label={`橡皮擦：${activeEraserLabel}`}
            aria-expanded={isEraserOpen}
            onClick={() => {
              onToolChange(activeEraserMode === 'box' ? 'erase_box' : 'eraser')
              setIsEraserOpen((value) => !value)
              setIsInkOpen(false)
            }}
          >
            <Eraser />
            <span>橡皮擦</span>
            <small>{activeEraserLabel}</small>
            <ChevronDown className="toolbar-tool__chevron" />
          </button>

          {isEraserOpen ? (
            <div className="toolbar-popover toolbar-eraser-menu">
              {eraserModeItems.map((item) => {
                const Icon = item.icon
                const isActive = activeEraserMode === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`toolbar-menu-item${isActive ? ' is-active' : ''}`}
                    onClick={() => selectEraserMode(item)}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {isActive ? <Check /> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

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
