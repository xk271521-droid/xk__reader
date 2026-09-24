import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  Circle,
  Columns,
  Download,
  Eraser,
  Hash,
  Highlighter,
  Languages,
  MessageSquareText,
  MousePointer2,
  Pencil,
  Redo2,
  ScanLine,
  Search,
  SlidersHorizontal,
  Square,
  Strikethrough,
  Type,
  Undo2,
  Underline,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { DEFAULT_SHAPE_OPTIONS, SHAPE_COLOR_PALETTE, SHAPE_TOOL_IDS } from './shapeAnnotationModel'
import {
  DEFAULT_MARKUP_OPTIONS,
  MARKUP_COLOR_PALETTE,
  MARKUP_TOOL_IDS,
} from './pdfMarkupStyleModel'
import './readerToolbarLayout.css'

const toolItems = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'highlight', label: '高亮', icon: Highlighter },
  { id: 'strikeout', label: '删除线', icon: Strikethrough },
  { id: 'underline', label: '下划线', icon: Underline },
  { id: 'squiggly', label: '波浪线', icon: Waves },
  { id: 'ink', label: '手写', icon: Pencil },
  { id: 'ink_highlighter', label: '荧光笔', icon: Highlighter },
  { id: 'comment', label: '评论', icon: MessageSquareText },
  { id: 'text', label: '文本', icon: Type },
  { id: 'line', label: '直线', icon: ArrowRight },
  { id: 'arrow', label: '箭头', icon: ArrowRight },
  { id: 'rect', label: '矩形', icon: Square },
  { id: 'circle', label: '圆形', icon: Circle },
  { id: 'pin', label: '编号', icon: Hash },
  { id: 'screenshot', label: '截图', icon: Camera },
]

// Keep the reader working surface flat: every concrete tool is always visible
// in the single toolbar row. Category switching previously hid most tools and
// made the toolbar look like an oversized tool collection.

const eraserModeItems = [
  { id: 'brush', label: '笔刷擦除', tool: 'eraser', icon: Eraser },
  { id: 'box', label: '框选擦除', tool: 'erase_box', icon: ScanLine },
]

const downloadItems = [
  { id: 'pdf', label: 'PDF' },
  { id: 'word', label: 'Word' },
  { id: 'citation-md', label: '引用 Markdown' },
  { id: 'bibtex', label: 'BibTeX' },
]

function ToolbarIconButton({ children, label, onClick, active = false, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      className={`toolbar-icon-button${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function ColorPalette({ colors, activeColor, onChange }) {
  return (
    <div className="toolbar-ink-colors">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`toolbar-ink-color${activeColor === color ? ' is-active' : ''}`}
          style={{ backgroundColor: color }}
          title={color}
          aria-label={`批注颜色 ${color}`}
          onClick={() => onChange?.(color)}
        >
          {activeColor === color ? <Check /> : null}
        </button>
      ))}
    </div>
  )
}

function DownloadControl({ onDownload }) {
  const wrapRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return undefined
    function handlePointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  return (
    <div className="toolbar-download" ref={wrapRef}>
      <button
        type="button"
        className="toolbar-tool toolbar-tool--download"
        title="下载"
        aria-label="下载"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <Download />
        <span>下载</span>
      </button>

      {isOpen ? (
        <div className="toolbar-download-menu">
          {downloadItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="toolbar-download-menu__item"
              onClick={() => {
                setIsOpen(false)
                onDownload?.(item.id)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  canRedo = false,
  onUndo,
  onRedo,
  onDownload,
  fullTranslateVisible = false,
  fullTranslateActive = false,
  fullTranslateStatus = 'idle',
  fullTranslateProgress = 0,
  onFullTranslate,
  inkOptions = { color: '#15803D', opacity: 0.85, strokeWidth: 6 },
  onInkOptionsChange,
  markupOptions = DEFAULT_MARKUP_OPTIONS,
  onMarkupOptionsChange,
  shapeOptions = DEFAULT_SHAPE_OPTIONS,
  onShapeOptionsChange,
  activeEraserMode = 'brush',
  onEraserModeChange,
}) {
  const eraserWrapRef = useRef(null)
  const inkWrapRef = useRef(null)
  const markupWrapRef = useRef(null)
  const shapeWrapRef = useRef(null)
  const [isEraserOpen, setIsEraserOpen] = useState(false)
  const [isInkOpen, setIsInkOpen] = useState(false)
  const [isMarkupOpen, setIsMarkupOpen] = useState(false)
  const [isShapeOpen, setIsShapeOpen] = useState(false)
  const isShapeToolActive = SHAPE_TOOL_IDS.includes(activeTool)
  const fullTranslateLabel = fullTranslateStatus === 'running'
    ? fullTranslateProgress > 0
      ? `翻译中 ${Math.round(fullTranslateProgress)}%`
      : '正在保版翻译…'
    : fullTranslateStatus === 'completed' || fullTranslateActive
      ? '看译文'
      : fullTranslateStatus === 'partial_failed'
        ? '看译文'
      : fullTranslateStatus === 'error'
        ? '重试翻译'
        : fullTranslateStatus === 'cancelled'
          ? '重新翻译'
          : '全文翻译'
  const fullTranslateTitle = fullTranslateActive
    ? '打开全文翻译 Beta'
    : '启动全文翻译 Beta'

  useEffect(() => {
    if (!isEraserOpen && !isInkOpen && !isMarkupOpen && !isShapeOpen) return undefined

    function handlePointerDown(event) {
      if (isEraserOpen && !eraserWrapRef.current?.contains(event.target)) setIsEraserOpen(false)
      if (isInkOpen && !inkWrapRef.current?.contains(event.target)) setIsInkOpen(false)
      if (isMarkupOpen && !markupWrapRef.current?.contains(event.target)) setIsMarkupOpen(false)
      if (isShapeOpen && !shapeWrapRef.current?.contains(event.target)) setIsShapeOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isEraserOpen, isInkOpen, isMarkupOpen, isShapeOpen])

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

  function updateShapeOptions(partial) {
    onShapeOptionsChange?.({
      ...shapeOptions,
      ...partial,
    })
  }

  function updateMarkupOptions(partial) {
    onMarkupOptionsChange?.({
      ...markupOptions,
      ...partial,
    })
  }

  function selectEraserMode(item) {
    onEraserModeChange?.(item.id)
    onToolChange(item.tool)
    setIsEraserOpen(false)
  }

  const activeEraserLabel = activeEraserMode === 'box' ? '框选' : '笔刷'

  return (
    <div className="reader-toolbar">
      <div className="toolbar-group toolbar-group--file">
        <ToolbarIconButton
          label={isThumbnailsOpen ? '隐藏阅读导航' : '显示阅读导航'}
          onClick={onToggleThumbnails}
          active={isThumbnailsOpen}
          className="toolbar-icon-button--navigation"
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
                    setIsMarkupOpen(false)
                    setIsShapeOpen(false)
                    setIsEraserOpen(false)
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                  <ChevronDown className="toolbar-tool__chevron" />
                </button>

                {isInkOpen ? (
                  <div className="toolbar-popover toolbar-ink-panel">
                    <div className="toolbar-popover__title">手写样式</div>
                    <ColorPalette
                      colors={SHAPE_COLOR_PALETTE}
                      activeColor={inkOptions.color}
                      onChange={(color) => updateInkOptions({ color })}
                    />
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
              onClick={() => {
                onToolChange(item.id)
                setIsShapeOpen(false)
                setIsInkOpen(false)
                setIsMarkupOpen(false)
                setIsEraserOpen(false)
              }}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="toolbar-quick-actions">
        <div className="toolbar-popover-wrap" ref={eraserWrapRef}>
          <button
            type="button"
            className={`toolbar-tool toolbar-tool--eraser${
              activeTool === 'eraser' || activeTool === 'erase_box' ? ' is-active' : ''
            }`}
            title={`擦除：${activeEraserLabel}`}
            aria-label={`擦除：${activeEraserLabel}`}
            aria-expanded={isEraserOpen}
            onClick={() => {
              onToolChange(activeEraserMode === 'box' ? 'erase_box' : 'eraser')
              setIsEraserOpen((value) => !value)
              setIsInkOpen(false)
              setIsMarkupOpen(false)
              setIsShapeOpen(false)
            }}
          >
            <Eraser />
            <span>擦除</span>
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

        {fullTranslateVisible ? (
          <button
            type="button"
            className={`toolbar-tool toolbar-tool--full-translate toolbar-tool--full-translate-${fullTranslateStatus}${
              fullTranslateActive ? ' is-active' : ''
            }`}
            title={fullTranslateTitle}
            aria-label={fullTranslateTitle}
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
            <span>{fullTranslateLabel}</span>
            <small>PDF</small>
          </button>
        ) : null}
      </div>

      <div className="toolbar-group toolbar-group--tool-options">
        {MARKUP_TOOL_IDS.includes(activeTool) ? (
          <div className="toolbar-popover-wrap" ref={markupWrapRef}>
            <button
              type="button"
              className={`toolbar-tool toolbar-tool--markup-style${isMarkupOpen ? ' is-active' : ''}`}
              title="批注样式"
              aria-label="批注样式"
              aria-expanded={isMarkupOpen}
              onClick={() => {
                setIsMarkupOpen((value) => !value)
                setIsInkOpen(false)
                setIsShapeOpen(false)
                setIsEraserOpen(false)
              }}
            >
              <SlidersHorizontal />
              <span>样式</span>
              <ChevronDown className="toolbar-tool__chevron" />
            </button>

            {isMarkupOpen ? (
              <div className="toolbar-popover toolbar-ink-panel">
                <div className="toolbar-popover__title">批注样式</div>
                <ColorPalette
                  colors={MARKUP_COLOR_PALETTE}
                  activeColor={markupOptions.color}
                  onChange={(color) => updateMarkupOptions({ color })}
                />
                <label className="toolbar-ink-slider">
                  <span>不透明度</span>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={Math.round((markupOptions.opacity ?? DEFAULT_MARKUP_OPTIONS.opacity) * 100)}
                    onChange={(event) => updateMarkupOptions({ opacity: Number(event.target.value) / 100 })}
                  />
                  <strong>{Math.round((markupOptions.opacity ?? DEFAULT_MARKUP_OPTIONS.opacity) * 100)}%</strong>
                </label>
                {activeTool === 'ink_highlighter' ? (
                  <label className="toolbar-ink-slider">
                    <span>粗细</span>
                    <input
                      type="range"
                      min="6"
                      max="36"
                      value={markupOptions.strokeWidth ?? DEFAULT_MARKUP_OPTIONS.strokeWidth}
                      onChange={(event) => updateMarkupOptions({ strokeWidth: Number(event.target.value) })}
                    />
                    <strong>{markupOptions.strokeWidth ?? DEFAULT_MARKUP_OPTIONS.strokeWidth}px</strong>
                  </label>
                ) : null}
                <div className="toolbar-ink-preview">
                  <span
                    style={{
                      backgroundColor: markupOptions.color || DEFAULT_MARKUP_OPTIONS.color,
                      height: activeTool === 'ink_highlighter'
                        ? Math.max(6, Math.min(24, markupOptions.strokeWidth ?? DEFAULT_MARKUP_OPTIONS.strokeWidth))
                        : 4,
                      opacity: markupOptions.opacity ?? DEFAULT_MARKUP_OPTIONS.opacity,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isShapeToolActive ? (
          <div className="toolbar-popover-wrap" ref={shapeWrapRef}>
            <button
              type="button"
              className={`toolbar-tool toolbar-tool--shape-style${isShapeOpen ? ' is-active' : ''}`}
              title="样式"
              aria-label="样式"
              aria-expanded={isShapeOpen}
              onClick={() => {
                setIsShapeOpen((value) => !value)
                setIsInkOpen(false)
                setIsMarkupOpen(false)
                setIsEraserOpen(false)
              }}
            >
              <SlidersHorizontal />
              <span>样式</span>
              <ChevronDown className="toolbar-tool__chevron" />
            </button>

            {isShapeOpen ? (
              <div className="toolbar-popover toolbar-ink-panel">
                <div className="toolbar-popover__title">标注样式</div>
                <ColorPalette
                  colors={SHAPE_COLOR_PALETTE}
                  activeColor={shapeOptions.color}
                  onChange={(color) => updateShapeOptions({ color })}
                />
                {activeTool === 'text' || activeTool === 'pin' ? (
                  <label className="toolbar-ink-slider">
                    <span>字号</span>
                    <input
                      type="range"
                      min="12"
                      max="28"
                      value={shapeOptions.fontSize ?? DEFAULT_SHAPE_OPTIONS.fontSize}
                      onChange={(event) => updateShapeOptions({ fontSize: Number(event.target.value) })}
                    />
                    <strong>{shapeOptions.fontSize ?? DEFAULT_SHAPE_OPTIONS.fontSize}px</strong>
                  </label>
                ) : (
                  <label className="toolbar-ink-slider">
                    <span>线宽</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      value={shapeOptions.strokeWidth ?? DEFAULT_SHAPE_OPTIONS.strokeWidth}
                      onChange={(event) => updateShapeOptions({ strokeWidth: Number(event.target.value) })}
                    />
                    <strong>{shapeOptions.strokeWidth ?? DEFAULT_SHAPE_OPTIONS.strokeWidth}px</strong>
                  </label>
                )}
                <div className="toolbar-ink-preview">
                  <span
                    style={{
                      backgroundColor: shapeOptions.color || DEFAULT_SHAPE_OPTIONS.color,
                      height: Math.max(2, Math.min(18, shapeOptions.strokeWidth ?? 2)),
                      opacity: 0.9,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

      </div>

      <div className="toolbar-group toolbar-group--compact">
        <ToolbarIconButton
          label="撤销标注"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 />
        </ToolbarIconButton>
        <ToolbarIconButton
          label="重做标注"
          onClick={onRedo}
          disabled={!canRedo}
        >
          <Redo2 />
        </ToolbarIconButton>

        <div className="toolbar-search">
          <Search className="toolbar-search__icon" />
          <input
            className="toolbar-search__input"
            type="text"
            placeholder="搜索"
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
              <button type="button" className="toolbar-search__btn" title="清空" onClick={() => onSearchChange?.('')}>
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
        <DownloadControl onDownload={onDownload} />
      </div>
    </div>
  )
}
