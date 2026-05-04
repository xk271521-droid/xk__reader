import { useCallback, useEffect, useRef, useState } from 'react'

function highlightMatches(container, searchTerm) {
  clearHighlights(container)
  if (!searchTerm || !container) return []

  const marks = []
  const lower = searchTerm.toLowerCase()

  container.querySelectorAll('.textLayer span').forEach((span) => {
    const text = span.textContent.toLowerCase()
    if (text.includes(lower)) {
      span.style.backgroundColor = '#FDE68A'
      span.style.borderRadius = '2px'
      span.style.padding = '0 1px'
      marks.push(span)
    }
  })

  return marks
}

function clearHighlights(container) {
  if (!container) return
  container.querySelectorAll('.textLayer span').forEach((span) => {
    span.style.backgroundColor = ''
    span.style.borderRadius = ''
    span.style.padding = ''
  })
}

export function usePdfSearch(readerRef) {
  const [searchTerm, setSearchTerm] = useState('')
  const [matches, setMatches] = useState([])
  const [matchIndex, setMatchIndex] = useState(-1)
  const rafRef = useRef(null)

  const performSearch = useCallback((term) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (!readerRef.current) return

    rafRef.current = requestAnimationFrame(() => {
      const container = readerRef.current
      const newMatches = highlightMatches(container, term)
      setMatches(newMatches)
      if (newMatches.length > 0) {
        setMatchIndex(0)
        const el = newMatches[0]
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.style.backgroundColor = '#F59E0B'
        setTimeout(() => { el.style.backgroundColor = '#FDE68A' }, 300)
        setTimeout(() => { el.style.backgroundColor = '#F59E0B' }, 600)
        setTimeout(() => { el.style.backgroundColor = '#FDE68A' }, 900)
      } else {
        setMatchIndex(-1)
      }
    })
  }, [readerRef])

  useEffect(() => {
    if (!searchTerm) {
      clearHighlights(readerRef.current)
      setMatches([])
      setMatchIndex(-1)
      return
    }
    performSearch(searchTerm)
  }, [searchTerm, performSearch, readerRef])

  function goToMatch(idx) {
    if (idx < 0 || idx >= matches.length) return
    const el = matches[idx]
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.style.backgroundColor = '#F59E0B'
    setTimeout(() => { el.style.backgroundColor = '#FDE68A' }, 300)
    setTimeout(() => { el.style.backgroundColor = '#F59E0B' }, 600)
    setTimeout(() => { el.style.backgroundColor = '#FDE68A' }, 900)
    setMatchIndex(idx)
  }

  const goNext = useCallback(() => {
    if (matches.length === 0) return
    const next = (matchIndex + 1) % matches.length
    goToMatch(next)
  }, [matches, matchIndex])

  const goPrev = useCallback(() => {
    if (matches.length === 0) return
    const prev = matchIndex <= 0 ? matches.length - 1 : matchIndex - 1
    goToMatch(prev)
  }, [matches, matchIndex])

  const handleSearchChange = useCallback((term) => {
    setSearchTerm(term)
  }, [])

  return {
    searchTerm,
    onSearchChange: handleSearchChange,
    matchIndex,
    totalMatches: matches.length,
    onSearchPrev: goPrev,
    onSearchNext: goNext,
  }
}
