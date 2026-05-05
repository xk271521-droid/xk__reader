import {
  Download,
  Languages,
  NotebookPen,
  Pin,
  Sparkles,
  X,
} from 'lucide-react'

function stopMenuPointer(event) {
  event.preventDefault()
  event.stopPropagation()
}

function ScreenshotAction({ children, label, onClick, accent = false }) {
  return (
    <button
      type="button"
      className={`screenshot-floating-menu__btn${accent ? ' is-accent' : ''}`}
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
      <span>{label}</span>
    </button>
  )
}

export function ScreenshotFloatingMenu({
  position,
  visible,
  onTranslate,
  onPin,
  onDownload,
  onInsertNote,
  onAskAI,
  onClose,
}) {
  if (!visible || !position) return null

  return (
    <div
      className="screenshot-floating-menu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
      }}
      onMouseDown={stopMenuPointer}
      onPointerDown={stopMenuPointer}
    >
      <ScreenshotAction label="英译汉" onClick={onTranslate}>
        <Languages />
      </ScreenshotAction>
      <ScreenshotAction label="钉住" onClick={onPin}>
        <Pin />
      </ScreenshotAction>
      <ScreenshotAction label="下载" onClick={onDownload}>
        <Download />
      </ScreenshotAction>
      <ScreenshotAction label="插入笔记" onClick={onInsertNote}>
        <NotebookPen />
      </ScreenshotAction>
      <ScreenshotAction label="AI解读" onClick={onAskAI} accent>
        <Sparkles />
      </ScreenshotAction>
      <button
        type="button"
        className="screenshot-floating-menu__close"
        title="关闭"
        aria-label="关闭"
        onMouseDown={stopMenuPointer}
        onPointerDown={stopMenuPointer}
        onClick={(event) => {
          event.stopPropagation()
          onClose?.()
        }}
      >
        <X />
      </button>
    </div>
  )
}
