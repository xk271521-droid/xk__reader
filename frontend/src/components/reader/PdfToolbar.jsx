import {
  FileText,
  Highlighter,
  MessageSquareText,
  MousePointer2,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

const toolItems = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'highlight', label: '高亮', icon: Highlighter },
  { id: 'note', label: '批注', icon: MessageSquareText },
  { id: 'summary', label: '总结', icon: Sparkles },
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
        <FileText className="toolbar-file-icon" aria-hidden="true" />
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
