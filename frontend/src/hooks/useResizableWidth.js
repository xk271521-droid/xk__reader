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

  const handlePointerMove = useCallback((event) => {
    if (!resizeStateRef.current) return

    const { startX, startWidth, direction } = resizeStateRef.current
    requestAnimationFrame(() => {
      const delta = event.clientX - startX
      const nextWidth = clampWidth(
        direction === 'left' ? startWidth + delta : startWidth - delta,
        minWidth,
        maxWidth,
      )
      setWidth(nextWidth)
    })
  }, [maxWidth, minWidth])

  const stopResize = useCallback(() => {
    resizeStateRef.current = null
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
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  useEffect(() => {
    handlePointerMoveRef.current = handlePointerMove
    stopResizeRef.current = stopResize
  }, [handlePointerMove, stopResize])

  useEffect(() => () => {
    document.body.classList.remove('is-resizing-panel')
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
