import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, Link2, Minus, Plus } from 'lucide-react'
import { PdfPage } from './PdfPage'
import { getFullTranslationDownloadUrl } from '../../services/paperReaderApi'

const MIN_SPLIT = 35
const MAX_SPLIT = 65
const MIN_ZOOM = 0.8
const MAX_ZOOM = 2.2
const ZOOM_STEP = 0.1

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function prefsKey(paperId) {
  return `xk_full_translation_reader:${paperId || 'global'}`
}

function readPrefs(paperId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(prefsKey(paperId)) || '{}')
    return {
      split: clamp(Number(parsed.split) || 50, MIN_SPLIT, MAX_SPLIT),
      leftZoom: clamp(Number(parsed.leftZoom) || 1, MIN_ZOOM, MAX_ZOOM),
      rightZoom: clamp(Number(parsed.rightZoom) || 1, MIN_ZOOM, MAX_ZOOM),
      linked: parsed.linked !== false,
    }
  } catch {
    return { split: 50, leftZoom: 1, rightZoom: 1, linked: true }
  }
}

function writePrefs(paperId, prefs) {
  try {
    window.localStorage.setItem(prefsKey(paperId), JSON.stringify(prefs))
  } catch {}
}

function zoomBy(value, delta) {
  return Math.round(clamp(value + delta, MIN_ZOOM, MAX_ZOOM) * 100) / 100
}

function findVisiblePageInfo(scroller) {
  if (!scroller) return null
  const pages = Array.from(scroller.querySelectorAll('[data-page-number]'))
  const containerRect = scroller.getBoundingClientRect()
  let best = null
  for (const page of pages) {
    const rect = page.getBoundingClientRect()
    const overlap = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
    if (overlap > (best?.overlap || 0)) {
      best = { page, overlap, rect }
    }
  }
  if (!best) return null
  const pageTopInScroller = best.page.offsetTop
  const offset = Math.max(0, scroller.scrollTop - pageTopInScroller)
  const ratio = offset / Math.max(1, best.page.offsetHeight)
  return {
    pageNumber: Number(best.page.dataset.pageNumber),
    ratio: clamp(ratio, 0, 1),
  }
}

function syncScrollerToPage(scroller, pageNumber, ratio) {
  if (!scroller || !pageNumber) return
  const page = scroller.querySelector(`[data-page-number="${pageNumber}"]`)
  if (!page) return
  scroller.scrollTop = page.offsetTop + page.offsetHeight * clamp(ratio, 0, 1)
}

function TranslationPage({ page, scale, hoverId, activeId, onHover, onActivate }) {
  const width = page.width * scale
  const height = page.height * scale
  return (
    <div
      className="translation-page"
      data-page-number={page.page_number}
      style={{ width, height }}
    >
      <span className="translation-page__badge">{page.page_number}</span>
      {(page.blocks || []).map((block) => {
        const [left, top, right, bottom] = block.bbox || [0, 0, page.width, 20]
        const isTitle = block.kind === 'title' || block.kind === 'heading'
        const text = block.translated_text || block.source_text || ''
        return (
          <button
            key={block.id}
            type="button"
            className={`translation-block${hoverId === block.id ? ' is-hovered' : ''}${activeId === block.id ? ' is-active' : ''}`}
            data-segment-id={block.id}
            onMouseEnter={() => onHover(block.id)}
            onMouseLeave={() => onHover('')}
            onClick={() => onActivate(block.id)}
            style={{
              left: left * scale,
              top: top * scale,
              width: Math.max(24, (right - left) * scale),
              minHeight: Math.max(12, (bottom - top) * scale),
              fontSize: Math.max(9, (block.font_size || 12) * scale * (text.length > 80 ? 0.92 : 1)),
              fontWeight: block.font_weight || (isTitle ? 700 : 400),
              textAlign: block.align || 'left',
            }}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

function OriginalPageWithOverlay({
  page,
  pageMetric,
  pageNumber,
  pdfDocument,
  scale,
  hoverId,
  activeId,
  onHover,
  onActivate,
}) {
  const width = (pageMetric?.width || page?.width || 0) * scale
  const height = (pageMetric?.height || page?.height || 0) * scale
  return (
    <div className="translation-original-page-wrap" style={{ width, height }}>
      <PdfPage
        annotations={[]}
        pageMetric={pageMetric}
        pageNumber={pageNumber}
        pdfDocument={pdfDocument}
        scale={scale}
        shouldRender
      />
      <div className="translation-original-overlay">
        {(page?.blocks || []).map((block) => {
          const [left, top, right, bottom] = block.bbox || [0, 0, page?.width || 0, 20]
          return (
            <button
              key={block.id}
              type="button"
              data-segment-id={block.id}
              className={`translation-source-hotspot${hoverId === block.id ? ' is-hovered' : ''}${activeId === block.id ? ' is-active' : ''}`}
              onMouseEnter={() => onHover(block.id)}
              onMouseLeave={() => onHover('')}
              onClick={() => onActivate(block.id)}
              style={{
                left: left * scale,
                top: top * scale,
                width: Math.max(12, (right - left) * scale),
                height: Math.max(12, (bottom - top) * scale),
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

export function FullTranslationReader({
  paperId,
  fileName,
  metadata,
  pageMetrics,
  pageNumbers,
  pdfDocument,
  translation,
  onBack,
}) {
  const [prefs, setPrefs] = useState(() => readPrefs(paperId))
  const [dragging, setDragging] = useState(false)
  const [hoverId, setHoverId] = useState('')
  const [activeId, setActiveId] = useState('')
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const syncingRef = useRef(false)
  const shellRef = useRef(null)
  const pages = translation?.pages || []

  useEffect(() => {
    setPrefs(readPrefs(paperId))
  }, [paperId])

  useEffect(() => {
    writePrefs(paperId, prefs)
  }, [paperId, prefs])

  useEffect(() => {
    if (!dragging) return undefined
    function handlePointerMove(event) {
      const rect = shellRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100
      setPrefs((current) => ({ ...current, split: clamp(next, MIN_SPLIT, MAX_SPLIT) }))
    }
    function handlePointerUp() {
      setDragging(false)
      document.body.classList.remove('is-resizing-panel')
    }
    document.body.classList.add('is-resizing-panel')
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.body.classList.remove('is-resizing-panel')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragging])

  const title = metadata?.title || fileName || '全文翻译'
  const pdfPages = useMemo(() => pageNumbers || [], [pageNumbers])

  function updateZoom(side, delta) {
    setPrefs((current) => ({
      ...current,
      [side]: zoomBy(current[side], delta),
    }))
  }

  function handleScroll(source) {
    if (!prefs.linked || syncingRef.current) return
    const from = source === 'left' ? leftRef.current : rightRef.current
    const to = source === 'left' ? rightRef.current : leftRef.current
    const info = findVisiblePageInfo(from)
    if (!info) return
    syncingRef.current = true
    syncScrollerToPage(to, info.pageNumber, info.ratio)
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }

  function handleWheel(event, side) {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    updateZoom(side, event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }

  function activateSegment(segmentId) {
    setActiveId(segmentId)
    const leftTarget = leftRef.current?.querySelector(`[data-segment-id="${segmentId}"]`)
    const rightTarget = rightRef.current?.querySelector(`[data-segment-id="${segmentId}"]`)
    leftTarget?.scrollIntoView({ block: 'center' })
    rightTarget?.scrollIntoView({ block: 'center' })
  }

  function downloadTranslation() {
    const link = document.createElement('a')
    link.href = getFullTranslationDownloadUrl(paperId)
    link.download = ''
    link.click()
  }

  return (
    <section className="full-translation-view">
      <header className="full-translation-toolbar">
        <button type="button" className="full-translation-action" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>返回 PDF</span>
        </button>
        <div className="full-translation-title">
          <strong>{title}</strong>
          <span>{translation?.status === 'completed' ? '已缓存全文翻译' : '全文翻译未完成'}</span>
        </div>
        <div className="full-translation-controls">
          <div className="translation-zoom-group">
            <span>原文</span>
            <button type="button" onClick={() => updateZoom('leftZoom', -ZOOM_STEP)}><Minus size={14} /></button>
            <b>{Math.round(prefs.leftZoom * 100)}%</b>
            <button type="button" onClick={() => updateZoom('leftZoom', ZOOM_STEP)}><Plus size={14} /></button>
          </div>
          <div className="translation-zoom-group">
            <span>译文</span>
            <button type="button" onClick={() => updateZoom('rightZoom', -ZOOM_STEP)}><Minus size={14} /></button>
            <b>{Math.round(prefs.rightZoom * 100)}%</b>
            <button type="button" onClick={() => updateZoom('rightZoom', ZOOM_STEP)}><Plus size={14} /></button>
          </div>
          <button
            type="button"
            className={`full-translation-action${prefs.linked ? ' is-active' : ''}`}
            onClick={() => setPrefs((current) => ({ ...current, linked: !current.linked }))}
          >
            <Link2 size={15} />
            <span>双屏联动</span>
          </button>
          <button type="button" className="full-translation-action" onClick={downloadTranslation}>
            <Download size={15} />
            <span>下载译文</span>
          </button>
        </div>
      </header>

      <div className="translation-split-shell" ref={shellRef}>
        <div className="translation-pane" style={{ flexBasis: `${prefs.split}%` }}>
          <div
            className="translation-scroll"
            ref={leftRef}
            onScroll={() => handleScroll('left')}
            onWheel={(event) => handleWheel(event, 'leftZoom')}
          >
            {pdfPages.map((pageNumber) => (
              <OriginalPageWithOverlay
                key={pageNumber}
                page={pages.find((item) => item.page_number === pageNumber)}
                pageMetric={pageMetrics[pageNumber - 1]}
                pageNumber={pageNumber}
                pdfDocument={pdfDocument}
                scale={prefs.leftZoom}
                hoverId={hoverId}
                activeId={activeId}
                onHover={setHoverId}
                onActivate={activateSegment}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          className="translation-split-resizer"
          aria-label="调整原文和译文宽度"
          onPointerDown={() => setDragging(true)}
        />
        <div className="translation-pane" style={{ flexBasis: `${100 - prefs.split}%` }}>
          <div
            className="translation-scroll translation-scroll--translated"
            ref={rightRef}
            onScroll={() => handleScroll('right')}
            onWheel={(event) => handleWheel(event, 'rightZoom')}
          >
            {pages.length ? pages.map((page) => (
              <TranslationPage
                key={page.page_number}
                page={page}
                scale={prefs.rightZoom}
                hoverId={hoverId}
                activeId={activeId}
                onHover={setHoverId}
                onActivate={activateSegment}
              />
            )) : (
              <div className="translation-empty-state">
                <p>全文翻译还没有完成，请返回 PDF 页面启动翻译。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
