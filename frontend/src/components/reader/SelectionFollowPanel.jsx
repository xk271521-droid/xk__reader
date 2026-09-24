import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, LoaderCircle, X } from 'lucide-react'
import {
  clampSelectionFollowPanelPosition,
  getSelectionFollowPanelPosition,
  resolveSelectionFollowAnchor,
} from '../../hooks/selectionFollowModel'
import './SelectionFollowPanel.css'

function copyText(text) {
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(text).catch(() => {})
}

function getViewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function getReaderBounds(boundsRef) {
  const viewport = getViewportSize()
  const rect = boundsRef?.current?.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { left: 12, top: 12, right: viewport.width - 12, bottom: viewport.height - 12 }
  }
  return {
    left: Math.max(12, rect.left),
    top: Math.max(12, rect.top),
    right: Math.min(viewport.width - 12, rect.right),
    bottom: Math.min(viewport.height - 12, rect.bottom),
  }
}

function applyPosition(panel, position, boundsRef) {
  if (!panel || !position) return false
  const panelRect = panel.getBoundingClientRect()
  const bounds = getReaderBounds(boundsRef)
  const actualLeft = position.left - panelRect.width / 2
  const actualTop = position.placement === 'above'
    ? position.top - panelRect.height
    : position.top
  const clamped = clampSelectionFollowPanelPosition(
    { left: actualLeft, top: actualTop },
    { width: panelRect.width, height: panelRect.height },
    bounds,
  )
  if (!clamped) return false
  panel.style.left = `${clamped.left + panelRect.width / 2}px`
  panel.style.top = `${position.placement === 'above' ? clamped.top + panelRect.height : clamped.top}px`
  panel.style.visibility = 'visible'
  panel.classList.toggle('is-above', position.placement === 'above')
  return true
}

function clampDraggedPanel(panel, boundsRef, positionRef) {
  if (!panel) return
  const panelRect = panel.getBoundingClientRect()
  const bounds = getReaderBounds(boundsRef)
  const clamped = clampSelectionFollowPanelPosition(
    { left: panelRect.left, top: panelRect.top },
    { width: panelRect.width, height: panelRect.height },
    bounds,
  )
  if (!clamped) return
  panel.style.left = `${clamped.left}px`
  panel.style.top = `${clamped.top}px`
  // A previous invalid anchor can hide the panel; restoring its dragged
  // position must also restore visibility for the next selection.
  panel.style.visibility = 'visible'
  if (positionRef) positionRef.current = clamped
}

export function SelectionFollowPanel({ selectionCard, enabled, boundsRef, onDismiss }) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const selectionKeyRef = useRef('')
  // Keep the last dragged coordinate for this reading session only.
  const draggedPositionRef = useRef(null)
  const selectionAnchor = useMemo(() => ({
    requestedAt: selectionCard.requestedAt,
    text: selectionCard.text,
    rects: selectionCard.rects,
    anchorRect: selectionCard.anchorRect,
    anchorElement: selectionCard.anchorElement,
    anchorClientRect: selectionCard.anchorClientRect,
  }), [
    selectionCard.anchorClientRect,
    selectionCard.anchorElement,
    selectionCard.anchorRect,
    selectionCard.rects,
    selectionCard.requestedAt,
    selectionCard.text,
  ])
  const visible = enabled && selectionCard.visible

  useLayoutEffect(() => {
    if (!visible) return undefined

    const selectionKey = `${selectionAnchor.requestedAt}:${selectionAnchor.text}`
    const isNewSelection = selectionKeyRef.current !== selectionKey
    selectionKeyRef.current = selectionKey

    let frameId = 0
    function updatePosition() {
      frameId = 0
      const anchorRect = resolveSelectionFollowAnchor(selectionAnchor)
      const panel = panelRef.current
      if (!panel) return
      if (panel.classList.contains('is-dragged')) {
        clampDraggedPanel(panel, boundsRef, draggedPositionRef)
        return
      }
      const position = getSelectionFollowPanelPosition(anchorRect, panel.getBoundingClientRect(), getViewportSize())
      if (!position) {
        panel.style.visibility = 'hidden'
        return
      }
      applyPosition(panel, position, boundsRef)
    }
    function schedulePositionUpdate() {
      if (!frameId) frameId = window.requestAnimationFrame(updatePosition)
    }

    if (isNewSelection) {
      dragRef.current = null
    }

    const savedPosition = draggedPositionRef.current
    if (savedPosition && panelRef.current) {
      panelRef.current.classList.add('is-dragged')
      panelRef.current.classList.remove('is-above', 'is-dragging')
      panelRef.current.style.left = `${savedPosition.left}px`
      panelRef.current.style.top = `${savedPosition.top}px`
    } else if (isNewSelection) {
      panelRef.current?.classList.remove('is-dragged', 'is-above', 'is-dragging')
    }
    schedulePositionUpdate()
    window.addEventListener('resize', schedulePositionUpdate)
    // PDF scrolling changes the temporary menu's viewport rect; keep an
    // undragged follow panel attached to the selected text as the reader moves.
    window.addEventListener('scroll', schedulePositionUpdate, true)
    window.visualViewport?.addEventListener('resize', schedulePositionUpdate)
    window.visualViewport?.addEventListener('scroll', schedulePositionUpdate)
    return () => {
      window.removeEventListener('resize', schedulePositionUpdate)
      window.removeEventListener('scroll', schedulePositionUpdate, true)
      window.visualViewport?.removeEventListener('resize', schedulePositionUpdate)
      window.visualViewport?.removeEventListener('scroll', schedulePositionUpdate)
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [boundsRef, selectionAnchor, visible])

  useEffect(() => {
    if (!visible) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') onDismiss?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDismiss, visible])

  if (!visible || typeof document === 'undefined') return null

  function handlePointerDown(event) {
    if (event.button !== 0 || event.target.closest('button')) return
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    }
    panel.classList.add('is-dragged', 'is-dragging')
    panel.classList.remove('is-above')
    panel.style.left = `${rect.left}px`
    panel.style.top = `${rect.top}px`
    draggedPositionRef.current = { left: rect.left, top: rect.top }
    panel.style.visibility = 'visible'
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event) {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || drag.pointerId !== event.pointerId || !panel) return
    const bounds = getReaderBounds(boundsRef)
    const rect = panel.getBoundingClientRect()
    const clamped = clampSelectionFollowPanelPosition(
      {
        left: drag.startLeft + event.clientX - drag.startX,
        top: drag.startTop + event.clientY - drag.startY,
      },
      { width: rect.width, height: rect.height },
      bounds,
    )
    if (!clamped) return
    panel.style.left = `${clamped.left}px`
    panel.style.top = `${clamped.top}px`
    draggedPositionRef.current = clamped
  }

  function handlePointerUp(event) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    dragRef.current = null
    panelRef.current?.classList.remove('is-dragging')
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return createPortal(
    <aside
      aria-busy={selectionCard.loading || undefined}
      aria-label="跟随翻译"
      className="selection-follow-panel"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      ref={panelRef}
      style={{ left: -10000, top: -10000, visibility: 'hidden' }}
    >
      <div
        className="selection-follow-panel__header"
        onPointerDown={handlePointerDown}
      >
        <span>{selectionCard.source || '即时翻译'}</span>
        <button
          aria-label="关闭本次跟随翻译"
          className="selection-follow-panel__icon-button"
          onClick={onDismiss}
          title="关闭本次跟随翻译"
          type="button"
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="selection-follow-panel__section selection-follow-panel__section--source">
        <div className="selection-follow-panel__section-heading">
          <span>原文</span>
          <button
            aria-label="复制原文"
            className="selection-follow-panel__icon-button"
            onClick={() => copyText(selectionCard.text)}
            title="复制原文"
            type="button"
          >
            <Copy aria-hidden="true" />
          </button>
        </div>
        <p lang="en">{selectionCard.text}</p>
      </div>

      <div aria-live="polite" className="selection-follow-panel__section selection-follow-panel__section--translation">
        <div className="selection-follow-panel__section-heading">
          <span>译文</span>
          {selectionCard.translation ? (
            <button
              aria-label="复制译文"
              className="selection-follow-panel__icon-button"
              onClick={() => copyText(selectionCard.translation)}
              title="复制译文"
              type="button"
            >
              <Copy aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {selectionCard.loading ? (
          <p className="selection-follow-panel__status"><LoaderCircle aria-hidden="true" />正在翻译</p>
        ) : null}
        {selectionCard.error ? <p className="selection-follow-panel__error">{selectionCard.error}</p> : null}
        {!selectionCard.loading && !selectionCard.error && selectionCard.translation ? (
          <p lang="zh-CN">{selectionCard.translation}</p>
        ) : null}
      </div>
    </aside>,
    document.body,
  )
}
