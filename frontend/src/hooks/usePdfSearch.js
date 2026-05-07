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
    pageIndexesRef.current = []
    renderedPageIndexesRef.current = []
    setMatches([])
    setMatchIndex(-1)

    if (!pdfDocument || !pageNumbers.length) {
      return undefined
    }

    async function buildDocumentSearchIndex() {
      const nextIndexes = []
      for (const pageNum of pageNumbers) {
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
    }
  }, [pdfDocument, pageNumbersKey, runSearch])

  function goToMatch(idx) {
    if (idx < 0 || idx >= matches.length) return
    matchIndexRef.current = idx
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
