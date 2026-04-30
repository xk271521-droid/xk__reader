import {
  BookOpenText,
  Languages,
  MessageCircleQuestion,
  NotebookPen,
} from 'lucide-react'

const railItems = [
  { id: 'info', label: '文献信息', icon: BookOpenText },
  { id: 'notes', label: '阅读笔记', icon: NotebookPen },
  { id: 'ask', label: '边读边问', icon: MessageCircleQuestion },
  { id: 'words', label: '全文翻译', icon: Languages },
]

export function UtilityRail({ activeItem, onSelect }) {
  return (
    <aside className="utility-rail">
      {railItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            type="button"
            className={`utility-rail__item${activeItem === item.id ? ' is-active' : ''}`}
            key={item.id}
            onClick={() => onSelect((current) => (current === item.id ? '' : item.id))}
          >
            <Icon />
            <span>{item.label}</span>
          </button>
        )
      })}
    </aside>
  )
}
