import { useCallback, useEffect, useRef, useState } from 'react'

function clampWidth(width, minWidth, maxWidth) {
  return Math.min(maxWidth, Math.max(minWidth, width))
}

const NOOP = () => {}

export function useResizableWidth({ initialWidth, minWidth, maxWidth }) {
  const [width, setWidth] = useState(initialWidth)
  const resizeStateRef = useRef(null)
  const handlePointerMoveRef = useRef(null)
  const stopResizeRef = useRef(null)
  const frameRef = useRef(0)
  const latestClientXRef = useRef(0)

  const handlePointerMove = useCallback((event) => {
    if (!resizeStateRef.current) return

    latestClientXRef.current = event.clientX
    if (frameRef.current) return

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      if (!resizeStateRef.current) return

      const { startX, startWidth, direction } = resizeStateRef.current
      const delta = latestClientXRef.current - startX
      const nextWidth = clampWidth(
        direction === 'left' ? startWidth + delta : startWidth - delta,
        minWidth,
        maxWidth,
      )
      setWidth((current) => (current === nextWidth ? current : nextWidth))
    })
  }, [maxWidth, minWidth])

  const stopResize = useCallback(() => {
    resizeStateRef.current = null
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    document.body.classList.remove('is-resizing-panel')
    window.removeEventListener('pointermove', handlePointerMove)
    if (stopResizeRef.current) {
      window.removeEventListener('pointerup', stopResizeRef.current)
    }
  }, [handlePointerMove])

  const startResize = useCallback((event) => {
    event.preventDefault()

    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    }

    document.body.classList.add('is-resizing-panel')
    latestClientXRef.current = event.clientX
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }, [handlePointerMove, stopResize, width])

  function startResizeLeft(event) {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
      direction: 'left',
    }

    document.body.classList.add('is-resizing-panel')
    latestClientXRef.current = event.clientX
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  useEffect(() => {
    handlePointerMoveRef.current = handlePointerMove
    stopResizeRef.current = stopResize
  }, [handlePointerMove, stopResize])

  useEffect(() => () => {
    document.body.classList.remove('is-resizing-panel')
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    if (handlePointerMoveRef.current) {
      window.removeEventListener('pointermove', handlePointerMoveRef.current)
    }
    if (stopResizeRef.current) {
      window.removeEventListener('pointerup', stopResizeRef.current)
    }
  }, [])

  return {
    width,
    setWidth,
    startResize,
    startResizeLeft,
  }
}
