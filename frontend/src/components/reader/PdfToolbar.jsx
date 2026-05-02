import {
  Columns,
  Crop,
  Download,
  Highlighter,
  MessageSquareText,
  MousePointer2,
  Paintbrush,
  Pencil,
  Search,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

const toolItems = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'highlight', label: '高亮', icon: Highlighter },
  { id: 'underline', label: '下划线', icon: Pencil },
  { id: 'note', label: '批注', icon: MessageSquareText },
  { id: 'search', label: '查找', icon: Search },
  { id: 'screenshot', label: '截图', icon: Crop },
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
}) {
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
