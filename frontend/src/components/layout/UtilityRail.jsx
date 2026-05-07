import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
  NotebookPen,
  Sparkles,
} from 'lucide-react'

const railItems = [
  { id: 'info', label: '文献信息', icon: BookOpenText },
  { id: 'notes', label: '阅读笔记', icon: NotebookPen },
  { id: 'ask', label: '边读边问', icon: MessageCircleQuestion },
  { id: 'summary', label: '文献总结', icon: Sparkles },
]

export function UtilityRail({ activeItem, collapsed = false, onSelect, onToggleCollapsed }) {
  return (
    <aside className={`utility-rail${collapsed ? ' is-collapsed' : ''}`}>
      <div className="utility-rail__items">
        {railItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              className={`utility-rail__item${activeItem === item.id ? ' is-active' : ''}`}
              key={item.id}
              title={item.label}
              aria-label={item.label}
              onClick={() => onSelect((current) => (current === item.id ? '' : item.id))}
            >
              <Icon />
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
