import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPageTextIndex, normalizeSearchText } from '../components/reader/pdfSelectionModel'

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

function buildTextOnlyPageIndex(pageNumber, textContent) {
  const strings = (textContent?.items || []).map((item) => item?.str || '')
  const base = buildPageTextIndex(strings)
  return {
    ...base,
    pageNumber,
    viewportWidth: 0,
    viewportHeight: 0,
    lines: [],
    lineMap: new Map(),
    words: [],
    blocks: [],
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

export function usePdfSearch(readerRef, { pdfDocument = null, pageNumbers = [] } = {}) {
  const pageIndexesRef = useRef([])
  const renderedPageIndexesRef = useRef([])
  const searchTermRef = useRef('')
  const matchesRef = useRef([])
  const matchIndexRef = useRef(-1)
  const pageNumbersKey = pageNumbers.join(',')
  const [searchTerm, setSearchTerm] = useState('')
  const [matches, setMatches] = useState([])
  const [matchIndex, setMatchIndex] = useState(-1)

  const getSearchIndexes = useCallback(() => {
    return pageIndexesRef.current.length ? pageIndexesRef.current : renderedPageIndexesRef.current
  }, [])

  const runSearch = useCallback((term, pageIndexes = pageIndexesRef.current, options = {}) => {
    const trimmedTerm = (term || '').trim()
    if (!trimmedTerm || !pageIndexes?.length) {
      setMatches([])
      setMatchIndex(-1)
      matchesRef.current = []
      matchIndexRef.current = -1
      return
    }

    const nextMatches = pageIndexes.flatMap((pageIndex) => buildMatchRanges(pageIndex, trimmedTerm))
    const previousMatch = matchesRef.current[matchIndexRef.current]
    let nextIndex = nextMatches.length > 0 ? 0 : -1

    if (options.preserveIndex && nextMatches.length > 0) {
      const sameMatchIndex = previousMatch
        ? nextMatches.findIndex((match) =>
            match.pageNumber === previousMatch.pageNumber &&
            match.startChar === previousMatch.startChar &&
            match.endChar === previousMatch.endChar,
          )
        : -1
      nextIndex = sameMatchIndex >= 0
        ? sameMatchIndex
        : Math.min(Math.max(matchIndexRef.current, 0), nextMatches.length - 1)
    }

    matchesRef.current = nextMatches
    matchIndexRef.current = nextIndex
    setMatches(nextMatches)
    setMatchIndex(nextIndex)
  }, [])

  const resetMatchesState = useCallback(() => {
    matchesRef.current = []
    matchIndexRef.current = -1
    setMatches([])
    setMatchIndex(-1)
  }, [])

  const performSearch = useCallback((term, pageIndexes) => {
    if (pageIndexes?.length) {
      renderedPageIndexesRef.current = pageIndexes
    }
    runSearch(term ?? searchTerm, getSearchIndexes(), { preserveIndex: true })
  }, [getSearchIndexes, runSearch, searchTerm])

  useEffect(() => {
    searchTermRef.current = searchTerm
    runSearch(searchTerm, getSearchIndexes())
  }, [getSearchIndexes, runSearch, searchTerm])

  useEffect(() => {
    let cancelled = false
    const resetTimer = window.setTimeout(() => {
      if (cancelled) return
      resetMatchesState()
    }, 0)

    pageIndexesRef.current = []
    renderedPageIndexesRef.current = []

    const stablePageNumbers = pageNumbersKey
      ? pageNumbersKey.split(',').map((value) => Number(value)).filter((value) => !Number.isNaN(value))
      : []

    if (!pdfDocument || !stablePageNumbers.length) {
      return () => {
        cancelled = true
        window.clearTimeout(resetTimer)
      }
    }

    async function buildDocumentSearchIndex() {
      const nextIndexes = []
      for (const pageNum of stablePageNumbers) {
        if (cancelled) return
        const page = await pdfDocument.getPage(pageNum)
        if (cancelled) return
        const textContent = await page.getTextContent()
        if (cancelled) return
        nextIndexes.push(buildTextOnlyPageIndex(pageNum, textContent))
        if (nextIndexes.length % 2 === 0) {
          await yieldToBrowser()
        }
      }

      if (cancelled) return
      pageIndexesRef.current = nextIndexes
      runSearch(searchTermRef.current, nextIndexes, { preserveIndex: true })
    }

    buildDocumentSearchIndex().catch(() => {
      if (!cancelled) {
        pageIndexesRef.current = []
        runSearch(searchTermRef.current, renderedPageIndexesRef.current)
      }
    })

    return () => {
      cancelled = true
      window.clearTimeout(resetTimer)
    }
  }, [pageNumbersKey, pdfDocument, resetMatchesState, runSearch])

  const goToMatch = useCallback((idx) => {
    if (idx < 0 || idx >= matchesRef.current.length) return
    matchIndexRef.current = idx
    setMatchIndex(idx)
  }, [])

  const goNext = useCallback(() => {
    const totalMatches = matchesRef.current.length
    if (totalMatches === 0) return
    const next = (matchIndexRef.current + 1) % totalMatches
    goToMatch(next)
  }, [goToMatch])

  const goPrev = useCallback(() => {
    const totalMatches = matchesRef.current.length
    if (totalMatches === 0) return
    const prev = matchIndexRef.current <= 0 ? totalMatches - 1 : matchIndexRef.current - 1
    goToMatch(prev)
  }, [goToMatch])

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
