import { useEffect, useRef, useState } from 'react'
import { Highlighter, MessageSquareText, Pencil, Sparkles, Underline } from 'lucide-react'

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
  onAskAI,
  autoShowColors = false,
  compact = false,
}) {
  const menuRef = useRef(null)
  const [showColors, setShowColors] = useState(autoShowColors)

  useEffect(() => {
    if (!visible) setShowColors(autoShowColors)
  }, [visible, autoShowColors])

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
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowColors((v) => !v)}
          >
            <Highlighter />
          </button>
          <div className="selection-floating-menu__colors" style={{ display: showColors || compact ? 'flex' : 'none' }}>
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  className="selection-floating-menu__color-dot"
                  style={{ background: c.color }}
                  title={c.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setShowColors(false)
                    console.log("onHighlight exists:", typeof onHighlight); onHighlight?.(c.color); console.log("onHighlight called")
                  }}
                />
              ))}
            </div>
        </div>

        {!compact ? (
          <>
          {onAskAI ? <button type="button" className="selection-floating-menu__btn" title="AI 解释" onMouseDown={(e) => e.preventDefault()} onClick={() => onAskAI?.()}><Sparkles /></button> : null}
          <button type="button" className="selection-floating-menu__btn" title="下划线" onMouseDown={(e) => e.preventDefault()} onClick={() => onUnderline?.()}><Underline /></button>
          <button type="button" className="selection-floating-menu__btn" title="波浪线" onMouseDown={(e) => e.preventDefault()} onClick={() => onWavyUnderline?.()}><Underline className="selection-floating-menu__wavy-icon" /></button>
          <button type="button" className="selection-floating-menu__btn" title="注释" onMouseDown={(e) => e.preventDefault()} onClick={() => onNote?.()}><MessageSquareText /></button>
          </>
        ) : null}
      </div>
    </div>
  )
}
