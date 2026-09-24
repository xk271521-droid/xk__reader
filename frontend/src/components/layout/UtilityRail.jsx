import {
  BookOpenText,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
  NotebookPen,
} from 'lucide-react'

const railItems = [
  { id: 'info', label: '文献信息', icon: BookOpenText },
  { id: 'summary', label: '文献速读', icon: BookOpenCheck },
  { id: 'notes', label: '阅读笔记', icon: NotebookPen },
  { id: 'ask', label: '边读边问', icon: MessageCircleQuestion },
]

export function UtilityRail({
  activeItem,
  collapsed = false,
  briefStatus = 'idle',
  onSelect,
  onItemIntent,
  onToggleCollapsed,
}) {
  return (
    <aside className={`utility-rail${collapsed ? ' is-collapsed' : ''}`}>
      <div className="utility-rail__items">
        {railItems.map((item) => {
          const Icon = item.icon
          const isBriefGenerating = item.id === 'summary' && ['queued', 'running'].includes(briefStatus)
          return (
            <button
              type="button"
              className={`utility-rail__item${activeItem === item.id ? ' is-active' : ''}`}
              key={item.id}
              title={isBriefGenerating ? `${item.label}正在生成` : item.label}
              aria-label={isBriefGenerating ? `${item.label}正在生成` : item.label}
              onPointerEnter={() => onItemIntent?.(item.id)}
              onFocus={() => onItemIntent?.(item.id)}
              onClick={() => {
                onItemIntent?.(item.id)
                onSelect((current) => (current === item.id ? '' : item.id))
              }}
            >
              <Icon />
              {isBriefGenerating ? <span className="utility-rail__status" aria-hidden="true" /> : null}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="utility-rail__toggle"
        title={collapsed ? '展开工具栏' : '收起工具栏'}
        aria-label={collapsed ? '展开工具栏' : '收起工具栏'}
        onClick={onToggleCollapsed}
      >
        {collapsed ? <ChevronLeft /> : <ChevronRight />}
      </button>
    </aside>
  )
}
