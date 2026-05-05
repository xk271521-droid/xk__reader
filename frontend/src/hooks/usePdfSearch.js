import { useCallback, useEffect, useState } from 'react'
import { normalizeSearchText } from '../components/reader/pdfSelectionModel'

function buildMatchRanges(pageIndex, searchTerm) {
  if (!pageIndex || !searchTerm) return []
  const pageNormalized = normalizeSearchText(pageIndex.fullText)
  const termNormalized = normalizeSearchText(searchTerm)
  if (!termNormalized.text) return []

  const matches = []
  let fromIndex = 0

  while (fromIndex < pageNormalized.text.length) {
    const hit = pageNormalized.text.indexOf(termNormalized.text, fromIndex)
    if (hit === -1) break

    const startChar = pageNormalized.charMap[hit]
    const endMapIndex = hit + termNormalized.text.length - 1
    const endChar = (pageNormalized.charMap[endMapIndex] ?? startChar) + 1
    matches.push({
      pageNumber: pageIndex.pageNumber,
      startChar,
      endChar,
    })
    fromIndex = hit + Math.max(1, termNormalized.text.length)
  }

  return matches
}

export function usePdfSearch(readerRef) {
  const [searchTerm, setSearchTerm] = useState('')
  const [matches, setMatches] = useState([])
  const [matchIndex, setMatchIndex] = useState(-1)

  const performSearch = useCallback((term, pageIndexes) => {
    if (!term || !pageIndexes?.length) {
      setMatches([])
      setMatchIndex(-1)
      return
    }

    const nextMatches = pageIndexes.flatMap((pageIndex) => buildMatchRanges(pageIndex, term))
    setMatches(nextMatches)
    setMatchIndex(nextMatches.length > 0 ? 0 : -1)
  }, [readerRef])

  useEffect(() => {
    if (!searchTerm) {
      setMatches([])
      setMatchIndex(-1)
    }
  }, [searchTerm])

  function goToMatch(idx) {
    if (idx < 0 || idx >= matches.length) return
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
    matches,
    performSearch,
    searchTerm,
    onSearchChange: handleSearchChange,
    matchIndex,
    totalMatches: matches.length,
    onSearchPrev: goPrev,
    onSearchNext: goNext,
  }
}
