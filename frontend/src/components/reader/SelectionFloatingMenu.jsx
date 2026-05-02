import { useEffect, useRef, useState } from 'react'
import { Highlighter, MessageSquareText, Pencil, Underline } from 'lucide-react'

const HIGHLIGHT_COLORS = [
  { color: '#FEF08A', label: '黄' },
  { color: '#BBF7D0', label: '绿' },
  { color: '#BFDBFE', label: '蓝' },
  { color: '#FBCFE8', label: '粉' },
]

export function SelectionFloatingMenu({
  position,
  visible,
  onHighlight,
  onUnderline,
  onWavyUnderline,
  onNote,
}) {
  const menuRef = useRef(null)
  const [showColors, setShowColors] = useState(false)

  useEffect(() => {
    if (!visible) setShowColors(false)
  }, [visible])

  if (!visible || !position) return null

  const style = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 1000,
  }

  return (
    <div className="selection-floating-menu" style={style} ref={menuRef}>
      <div className="selection-floating-menu__items">
        <div className="selection-floating-menu__highlight-wrap">
          <button
            type="button"
            className="selection-floating-menu__btn"
            title="高亮"
            onClick={() => setShowColors((v) => !v)}
          >
            <Highlighter />
          </button>
          {showColors ? (
            <div className="selection-floating-menu__colors">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  className="selection-floating-menu__color-dot"
                  style={{ background: c.color }}
                  title={c.label}
                  onClick={() => {
                    setShowColors(false)
                    onHighlight?.(c.color)
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="selection-floating-menu__btn"
          title="下划线"
          onClick={() => onUnderline?.()}
        >
          <Underline />
        </button>

        <button
          type="button"
          className="selection-floating-menu__btn"
          title="波浪线"
          onClick={() => onWavyUnderline?.()}
        >
          <Underline className="selection-floating-menu__wavy-icon" />
        </button>

        <button
          type="button"
          className="selection-floating-menu__btn"
          title="注释"
          onClick={() => onNote?.()}
        >
          <MessageSquareText />
        </button>
      </div>
    </div>
  )
}
