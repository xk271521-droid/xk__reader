import {
  Highlighter,
  MessageSquareText,
  Sparkles,
  Underline,
  Waves,
} from 'lucide-react'

const ANNOTATION_COLORS = [
  { color: '#F2B800', label: '黄色' },
  { color: '#22B66F', label: '绿色' },
  { color: '#2F7DE1', label: '蓝色' },
  { color: '#D84C92', label: '粉色' },
]

function stopMenuPointer(event) {
  event.preventDefault()
  event.stopPropagation()
}

function MenuButton({ children, label, onClick, accent = false }) {
  return (
    <button
      type="button"
      className={`selection-floating-menu__btn${accent ? ' is-accent' : ''}`}
      title={label}
      aria-label={label}
      onMouseDown={stopMenuPointer}
      onPointerDown={stopMenuPointer}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
    >
      {children}
    </button>
  )
}

export function SelectionFloatingMenu({
  position,
  visible,
  selectedColor = ANNOTATION_COLORS[0].color,
  onColorChange,
  onHighlight,
  onUnderline,
  onWavyUnderline,
  onNote,
  onAskAI,
  autoShowColors = false,
  compact = false,
}) {
  if (!visible || !position) return null

  const style = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 1000,
  }

  return (
    <div
      className={`selection-floating-menu${compact ? ' is-compact' : ''}`}
      style={style}
      onMouseDown={stopMenuPointer}
      onPointerDown={stopMenuPointer}
    >
      <div className="selection-floating-menu__items">
        <div className="selection-floating-menu__color-row" style={{ display: autoShowColors || compact ? 'flex' : undefined }}>
          {ANNOTATION_COLORS.map((item) => (
            <button
              key={item.color}
              type="button"
              className={`selection-floating-menu__color-dot${selectedColor === item.color ? ' is-active' : ''}`}
              style={{ backgroundColor: item.color }}
              title={item.label}
              aria-label={`选择${item.label}`}
              onMouseDown={stopMenuPointer}
              onPointerDown={stopMenuPointer}
              onClick={(event) => {
                event.stopPropagation()
                onColorChange?.(item.color)
                if (compact) {
                  onHighlight?.(item.color)
                }
              }}
            />
          ))}
        </div>

        {!compact ? (
          <>
            <MenuButton label="高亮" onClick={() => onHighlight?.(selectedColor)} accent>
              <Highlighter />
            </MenuButton>
            <MenuButton label="下划线" onClick={() => onUnderline?.(selectedColor)}>
              <Underline style={{ color: selectedColor }} />
            </MenuButton>
            <MenuButton label="波浪线" onClick={() => onWavyUnderline?.(selectedColor)}>
              <Waves style={{ color: selectedColor }} />
            </MenuButton>
            {onAskAI ? (
              <MenuButton label="AI解读" onClick={onAskAI}>
                <Sparkles />
              </MenuButton>
            ) : null}
            <MenuButton label="笔记" onClick={onNote}>
              <MessageSquareText />
            </MenuButton>
          </>
        ) : null}
      </div>
    </div>
  )
}
