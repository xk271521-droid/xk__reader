import { useEffect, useRef, useState } from 'react'
import { fetchAiProviders, fetchSelectionInsight, fetchSelectionInsightExplain } from '../services/paperReaderApi'

function createInitialSelectionState() {
  return {
    text: '', translation: '', explanation: '',
    keywords: [], glossary: [], focusPoints: [],
    loading: false, explaining: false, error: '', visible: false,
    source: '', textKind: '', charCount: 0, wordCount: 0, requestedAt: 0, domain: 'it',
  }
}

function normalizeSelectedText(text) { return text.replace(/\s+/g, ' ').trim() }
function getWordCount(text) { return text.split(/\s+/).filter(Boolean).length }

function inferTextKind(text) {
  const words = getWordCount(text)
  if (words <= 1) return 'word'
  if (words >= 40) return 'passage'
  if (words >= 6 && !/[.!?;:]\s*$/.test(text) && text[0] === text[0].toUpperCase()) return 'title'
  if (words >= 10 || /[.!?;:]\s*$/.test(text)) return 'sentence'
  if (words <= 5) return 'phrase'
  return 'sentence'
}

function extractSurroundingContext(range, n) {
  n = n || 3
  try {
    var a = range.startContainer, b = range.endContainer
    if (a.nodeType === 3) a = a.parentElement
    if (b.nodeType === 3) b = b.parentElement
    var tl = a.closest('.textLayer')
    if (!tl) return ''
    var spans = Array.from(tl.querySelectorAll('span'))
    var si = spans.indexOf(a.closest('span')), ei = spans.indexOf(b.closest('span'))
    if (si < 0 || ei < 0) return ''
    var r = []
    for (var i = Math.max(0, si - n); i <= Math.min(spans.length - 1, ei + n); i++) r.push(spans[i].textContent)
    return r.join(' ').replace(/\s+/g, ' ').trim()
  } catch (_) { return '' }
}

var NL = String.fromCharCode(10)

export function useSelectionInsight(_ref) {
  var readerRef = _ref.readerRef, paperTitle = _ref.paperTitle, paperSummary = _ref.paperSummary
  var activeRequestRef = useRef(0)
  var selectionTimerRef = useRef(null)
  var _s = useState(createInitialSelectionState), selectionCard = _s[0], setSelectionCard = _s[1]
  var _a = useState(true), aiEnabled = _a[0], setAiEnabled = _a[1]
  var summaryRef = useRef(paperSummary); summaryRef.current = paperSummary
  var providerRef = useRef(null)
  var explRef = useRef('')

  useEffect(function () {
    var c = false
    fetchAiProviders().then(function (d) {
      if (!c) { var a = (d && d.providers || []).find(function (p) { return p.is_active }); if (a) providerRef.current = a.id }
    }).catch(function () {})
    return function () { c = true }
  }, [])

  function dismissSelectionCard() { activeRequestRef.current += 1; clearTimeout(selectionTimerRef.current); setSelectionCard(createInitialSelectionState()) }
  useEffect(function () { return function () { clearTimeout(selectionTimerRef.current) } }, [])

  function handleSelection() { clearTimeout(selectionTimerRef.current); selectionTimerRef.current = setTimeout(loadSelectionInsight, 120) }

  async function loadSelectionInsight(domainOverride) {
    var selectedText, domain, ctx = ''
    if (domainOverride !== undefined) { selectedText = selectionCard.text; domain = domainOverride }
    else {
      var sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
      selectedText = normalizeSelectedText(sel.toString())
      if (selectedText.length < 2) return
      var readerElement = readerRef.current, range = sel.getRangeAt(0)
      if (!readerElement || !readerElement.contains(range.commonAncestorContainer)) return
      domain = selectionCard.domain; ctx = extractSurroundingContext(range)
    }
    var requestId = activeRequestRef.current + 1, wc = getWordCount(selectedText)
    activeRequestRef.current = requestId
    setSelectionCard(Object.assign({}, createInitialSelectionState(), { text: selectedText, loading: true, visible: true, source: '正在生成即时理解', textKind: inferTextKind(selectedText), charCount: selectedText.length, wordCount: wc, requestedAt: Date.now(), domain: domain }))
    try {
      var summary = summaryRef.current || undefined, providerId = providerRef.current || undefined
      var data = await fetchSelectionInsight({ text: selectedText, paper_title: paperTitle, domain: domain, summary: summary, context: ctx || undefined, provider_id: providerId || undefined })
      if (activeRequestRef.current !== requestId) return
      setSelectionCard(function (c) { return Object.assign({}, c, { translation: data.translation, keywords: Array.isArray(data.keywords) ? data.keywords : [], glossary: Array.isArray(data.glossary) ? data.glossary : [], focusPoints: Array.isArray(data.focus_points) ? data.focus_points : [], loading: false, source: data.source || '', textKind: data.text_kind || c.textKind }) })
      if (aiEnabled && providerId && wc >= 5) {
        setSelectionCard(function (c) { return Object.assign({}, c, { explaining: true, explanation: '' }) })
        explRef.current = ''
        try {
          var resp = await fetch('/api/selection-insight/explain-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: selectedText, paper_title: paperTitle, summary: summary, context: ctx || undefined, provider_id: providerId }) })
          if (resp.ok) {
            var reader = resp.body.getReader(); var decoder = new TextDecoder(); var buf = ''
            while (true) {
              var chunk = await reader.read(); if (chunk.done) break
              buf += decoder.decode(chunk.value, { stream: true })
              var parts = buf.split(NL); buf = parts.pop()
              for (var pi = 0; pi < parts.length; pi++) {
                var line = parts[pi]
                if (line.indexOf('data: ') === 0) {
                  var token = line.slice(6)
                  if (activeRequestRef.current !== requestId) return
                  explRef.current += token
                  setSelectionCard(function (c) { return Object.assign({}, c, { explanation: explRef.current }) })
                  await new Promise(function (r) { setTimeout(r, 0) })
                }
              }
            }
          }
        } catch (_) { }
        if (activeRequestRef.current !== requestId) return
        if (!explRef.current) {
          try {
            var fb = await fetchSelectionInsightExplain({ text: selectedText, paper_title: paperTitle, summary: summary, context: ctx || undefined, provider_id: providerId })
            if (activeRequestRef.current === requestId && fb && fb.explanation) { setSelectionCard(function (c) { return Object.assign({}, c, { explanation: fb.explanation }) }) }
          } catch (_) { }
        }
        if (activeRequestRef.current === requestId) { setSelectionCard(function (c) { return Object.assign({}, c, { explaining: false }) }) }
      }
    } catch (_) {
      if (activeRequestRef.current !== requestId) return
      setSelectionCard(function (c) { return Object.assign({}, c, { loading: false, explaining: false, error: '网络好像开了个小差……刷新试试？反正 AI 不会跑。' }) })
    }
  }

  function setDomain(d) { setSelectionCard(function (c) { return Object.assign({}, c, { domain: d }) }); loadSelectionInsight(d) }

  function toggleAI() {
    setAiEnabled(function (prev) {
      if (prev) { activeRequestRef.current += 1; setSelectionCard(function (c) { return Object.assign({}, c, { explaining: false, explanation: '' }) }) }
      return !prev
    })
  }

  return { selectionCard: selectionCard, handleSelection: handleSelection, dismissSelectionCard: dismissSelectionCard, setDomain: setDomain, aiEnabled: aiEnabled, toggleAI: toggleAI }
}
