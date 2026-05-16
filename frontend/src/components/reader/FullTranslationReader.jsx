import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, FileText, Languages, Link2, Minus, Plus } from 'lucide-react'
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
      layoutMode: parsed.layoutMode === 'flow' ? 'flow' : 'layout',
    }
  } catch {
    return { split: 50, leftZoom: 1, rightZoom: 1, linked: true, layoutMode: 'layout' }
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

function containsCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''))
}

function isAllowedSourceText(block, text) {
  if (block?.skip_translate) return true
  const value = String(text || '').trim()
  if (!value) return false
  if (/^(https?:\/\/|doi:|www\.)/i.test(value)) return true
  if (/^[\d\s()[\].,;:/\\+\-=<>%°]+$/.test(value)) return true
  if (/^(\[[\d,\s]+\]|[A-Z]{2,}(?:[-\s][A-Z0-9]+)*)$/.test(value)) return true
  return false
}

function getDisplayBlock(block, options = {}) {
  const translated = String(block?.translated_text || '').trim()
  const source = String(block?.source_text || '').trim()
  if (containsCjk(translated)) return { text: translated, pending: false }
  if (translated && isAllowedSourceText(block, translated)) return { text: translated, pending: false }
  if (source && isAllowedSourceText(block, source)) return { text: source, pending: false }
  return {
    text: options.compactPending ? '待重试' : '该段落暂未翻译完成',
    pending: true,
  }
}

function ZoomControl({ label, value, onZoomOut, onZoomIn }) {
  return (
    <div className="translation-pane-zoom" aria-label={`${label}缩放`}>
      <span>{label}</span>
      <button type="button" onClick={onZoomOut} aria-label={`${label}缩小`}>
        <Minus size={14} />
      </button>
      <b>{Math.round(value * 100)}%</b>
      <button type="button" onClick={onZoomIn} aria-label={`${label}放大`}>
        <Plus size={14} />
      </button>
    </div>
  )
}

function getParseLabel(translation) {
  const engine = translation?.parse_engine || 'local'
  const summary = translation?.parse_summary || {}
  if (engine === 'aliyun') return '阿里云文档解析（大模型版）'
  if (summary?.decision === 'aliyun_unavailable') return '本地解析（阿里云未启用）'
  if (summary?.decision === 'aliyun_failed_fallback_local') return '本地解析（阿里云失败后回退）'
  return '本地解析'
}

function getTranslationEngineLabel(translation) {
  if (translation?.translation_engine === 'tencent_mt') return '腾讯云机器翻译'
  return 'AI 翻译'
}

function TranslationPage({ page, scale, hoverId, activeId, onHover, onActivate }) {
  const width = Math.max(420, Math.min(820, page.width * 0.86 * scale))
  return (
    <div
      className="translation-page"
      data-page-number={page.page_number}
      style={{ width, '--translation-scale': scale }}
    >
      <span className="translation-page__badge">{page.page_number}</span>
      {(page.blocks || []).map((block) => {
        const isTitle = block.kind === 'title'
        const isHeading = block.kind === 'heading'
        const display = getDisplayBlock(block)
        const text = display.text
        if (!text) return null
        return (
          <button
            key={block.id}
            type="button"
            className={`translation-block translation-block--${block.kind || 'paragraph'}${
              display.pending ? ' is-pending' : ''
            }${hoverId === block.id ? ' is-hovered' : ''}${activeId === block.id ? ' is-active' : ''}`}
            data-segment-id={block.id}
            onMouseEnter={() => onHover(block.id)}
            onMouseLeave={() => onHover('')}
            onClick={() => onActivate(block.id)}
            style={{
              fontSize: `${Math.max(13, Math.min(24, (block.font_size || 12) * 0.96 * scale * (isTitle ? 1.08 : 1)))}px`,
              fontWeight: block.font_weight || (isTitle || isHeading ? 700 : 400),
              textAlign: block.align || 'left',
            }}
          >
            {text}
            {display.pending ? <span className="translation-block__pending">待重试</span> : null}
          </button>
        )
      })}
    </div>
  )
}

function normalizeBBox(page, block) {
  const pageWidth = Number(page?.width) || 595
  const pageHeight = Number(page?.height) || 842
  const raw = Array.isArray(block?.bbox) ? block.bbox.map(Number) : []
  if (raw.length < 4 || raw.some((value) => !Number.isFinite(value))) {
    return [48, 64, pageWidth - 48, 90]
  }
  const left = clamp(Math.min(raw[0], raw[2]), 0, pageWidth)
  const top = clamp(Math.min(raw[1], raw[3]), 0, pageHeight)
  const right = clamp(Math.max(raw[0], raw[2]), left + 4, pageWidth)
  const bottom = clamp(Math.max(raw[1], raw[3]), top + 4, pageHeight)
  return [left, top, right, bottom]
}

function shouldKeepOriginalInLayout(block) {
  const type = String(block?.type || '').toLowerCase()
  const kind = String(block?.kind || '').toLowerCase()
  const policy = String(block?.translate_policy || '').toLowerCase()
  const translated = String(block?.translated_text || '').trim()
  if (containsCjk(translated)) return false
  if (['image', 'table', 'formula', 'page_meta'].includes(type)) return true
  if (['caption', 'footer'].includes(kind)) return true
  if (policy === 'copy' || policy === 'skip' || block?.skip_translate) return true
  return false
}

function getTranslatedCoverage(pages) {
  let translated = 0
  let translatable = 0
  for (const page of pages || []) {
    for (const block of page.blocks || []) {
      if (shouldKeepOriginalInLayout(block)) continue
      translatable += 1
      if (containsCjk(block?.translated_text)) translated += 1
    }
  }
  return translatable > 0 ? translated / translatable : 1
}

function estimateLayoutFontSize(block, text, bbox) {
  const base = Number(block?.font_size) || 12
  const width = Math.max(24, bbox[2] - bbox[0])
  const height = Math.max(10, bbox[3] - bbox[1])
  const isTitle = block?.kind === 'title'
  const maxSize = Math.max(8, Math.min(isTitle ? base * 1.08 : base * 0.98, 26))
  const minSize = isTitle ? 8 : 6.8
  const length = Array.from(String(text || '')).length || 1
  const charWidth = maxSize * (containsCjk(text) ? 0.92 : 0.55)
  const charsPerLine = Math.max(2, Math.floor(width / Math.max(4, charWidth)))
  const lines = Math.max(1, Math.ceil(length / charsPerLine))
  const lineHeight = isTitle ? 1.16 : 1.2
  const fitted = height / (lines * lineHeight)
  return Math.max(minSize, Math.min(maxSize, fitted * 0.98))
}

function TranslatedLayoutPage({
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
  const pageWidth = Number(pageMetric?.width || page?.width || 595)
  const pageHeight = Number(pageMetric?.height || page?.height || 842)
  return (
    <div
      className="translation-layout-page"
      data-page-number={pageNumber}
      style={{ width: pageWidth * scale, height: pageHeight * scale, '--translation-scale': scale }}
    >
      <PdfPage
        annotations={[]}
        pageMetric={pageMetric || page}
        pageNumber={pageNumber}
        pdfDocument={pdfDocument}
        scale={scale}
        shouldRender
      />
      <div className="translation-layout-overlay">
        {(page?.blocks || []).map((block) => {
          if (shouldKeepOriginalInLayout(block)) return null
          const bbox = normalizeBBox({ width: pageWidth, height: pageHeight }, block)
          const display = getDisplayBlock(block, { compactPending: true })
          if (display.pending) return null
          const text = display.text
          if (!text) return null
          const left = Math.max(0, (bbox[0] - 1) * scale)
          const top = Math.max(0, (bbox[1] - 1) * scale)
          const width = Math.max(10, (bbox[2] - bbox[0] + 2) * scale)
          const height = Math.max(10, (bbox[3] - bbox[1] + 2) * scale)
          const fontSize = estimateLayoutFontSize(block, text, bbox) * scale
          return (
            <button
              key={block.id}
              type="button"
              className={`translation-layout-block translation-layout-block--${block.kind || 'paragraph'}${
                display.pending ? ' is-pending' : ''
              }${hoverId === block.id ? ' is-hovered' : ''}${activeId === block.id ? ' is-active' : ''}`}
              data-segment-id={block.id}
              onMouseEnter={() => onHover(block.id)}
              onMouseLeave={() => onHover('')}
              onClick={() => onActivate(block.id)}
              style={{
                left,
                top,
                width,
                height,
                fontSize: `${fontSize}px`,
                fontWeight: block.font_weight || (block.kind === 'title' || block.kind === 'heading' ? 700 : 400),
                textAlign: block.align || 'left',
              }}
            >
              {text}
            </button>
          )
        })}
      </div>
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
  parseMode = 'auto',
  uiFontScale = 1,
  onParseModeChange,
  onRegenerate,
  onBack,
}) {
  const [prefs, setPrefs] = useState(() => readPrefs(paperId))
  const [dragging, setDragging] = useState(false)
  const [hoverId, setHoverId] = useState('')
  const [activeId, setActiveId] = useState('')
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const syncingRef = useRef(false)
  const scrollSyncFrameRef = useRef(0)
  const shellRef = useRef(null)
  const pages = translation?.pages || []
  const translatedCoverage = useMemo(() => getTranslatedCoverage(pages), [pages])
  const canUseLayoutMode = translatedCoverage >= 0.35

  useEffect(() => {
    setPrefs(readPrefs(paperId))
  }, [paperId])

  useEffect(() => {
    if (prefs.layoutMode === 'layout' && !canUseLayoutMode) {
      setPrefs((current) => ({ ...current, layoutMode: 'flow' }))
    }
  }, [canUseLayoutMode, prefs.layoutMode])

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
    if (scrollSyncFrameRef.current) return
    scrollSyncFrameRef.current = requestAnimationFrame(() => {
      scrollSyncFrameRef.current = 0
      const from = source === 'left' ? leftRef.current : rightRef.current
      const to = source === 'left' ? rightRef.current : leftRef.current
      const info = findVisiblePageInfo(from)
      if (!info) return
      syncingRef.current = true
      syncScrollerToPage(to, info.pageNumber, info.ratio)
      requestAnimationFrame(() => {
        syncingRef.current = false
      })
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
    <section className="full-translation-view" style={{ '--ui-reader-scale': uiFontScale }}>
      <header className="full-translation-toolbar">
        <button type="button" className="full-translation-action" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>返回 PDF</span>
        </button>
        <div className="full-translation-title">
          <strong title={title}>{title}</strong>
          <span>
            {translation?.status === 'completed'
              ? `已缓存全文翻译 · ${getParseLabel(translation)} · ${getTranslationEngineLabel(translation)}`
              : `全文翻译未完成 · ${getTranslationEngineLabel(translation)}`}
            {translation?.termbase_version ? ` · 系统术语库已启用` : ''}
            {translation?.failed_blocks_count ? ` · ${translation.failed_blocks_count} 段待重试` : ''}
          </span>
        </div>
        <div className="full-translation-controls">
          <select
            className="full-translation-mode-select"
            title="重新生成时使用的解析方式"
            value={parseMode}
            onChange={(event) => onParseModeChange?.(event.target.value)}
          >
            <option value="auto">自动解析</option>
            <option value="local">仅本地</option>
            <option value="aliyun">阿里云增强</option>
          </select>
          <button type="button" className="full-translation-action" onClick={onRegenerate}>
            <span>重新生成</span>
          </button>
          <button
            type="button"
            className={`full-translation-action${prefs.linked ? ' is-active' : ''}`}
            onClick={() => setPrefs((current) => ({ ...current, linked: !current.linked }))}
          >
            <Link2 size={15} />
            <span>双屏联动</span>
          </button>
          <button
            type="button"
            className={`full-translation-action${prefs.layoutMode === 'layout' ? ' is-active' : ''}`}
            disabled={!canUseLayoutMode}
            title={canUseLayoutMode ? '切换译文显示方式' : '译文覆盖率太低，请重新生成后再使用版式对照'}
            onClick={() => setPrefs((current) => ({
              ...current,
              layoutMode: !canUseLayoutMode ? 'flow' : current.layoutMode === 'layout' ? 'flow' : 'layout',
            }))}
          >
            <span>{prefs.layoutMode === 'layout' && canUseLayoutMode ? '版式对照' : '流式阅读'}</span>
          </button>
          <button type="button" className="full-translation-action" onClick={downloadTranslation}>
            <Download size={15} />
            <span>下载译文</span>
          </button>
        </div>
      </header>

      <div className="translation-split-shell" ref={shellRef}>
        <div className="translation-pane" style={{ flexBasis: `${prefs.split}%` }}>
          <div className="translation-pane-toolbar">
            <div className="translation-pane-title">
              <FileText size={15} />
              <span>原文</span>
            </div>
            <ZoomControl
              label="原文"
              value={prefs.leftZoom}
              onZoomOut={() => updateZoom('leftZoom', -ZOOM_STEP)}
              onZoomIn={() => updateZoom('leftZoom', ZOOM_STEP)}
            />
          </div>
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
          <div className="translation-pane-toolbar">
            <div className="translation-pane-title">
              <Languages size={15} />
              <span>译文</span>
              <small>{getParseLabel(translation)}</small>
            </div>
            <ZoomControl
              label="译文"
              value={prefs.rightZoom}
              onZoomOut={() => updateZoom('rightZoom', -ZOOM_STEP)}
              onZoomIn={() => updateZoom('rightZoom', ZOOM_STEP)}
            />
          </div>
          <div
            className="translation-scroll translation-scroll--translated"
            ref={rightRef}
            onScroll={() => handleScroll('right')}
            onWheel={(event) => handleWheel(event, 'rightZoom')}
          >
            {pages.length ? (
              prefs.layoutMode === 'layout' && canUseLayoutMode
                ? pdfPages.map((pageNumber) => (
                  <TranslatedLayoutPage
                    key={pageNumber}
                    page={pages.find((item) => item.page_number === pageNumber)}
                    pageMetric={pageMetrics[pageNumber - 1]}
                    pageNumber={pageNumber}
                    pdfDocument={pdfDocument}
                    scale={prefs.rightZoom}
                    hoverId={hoverId}
                    activeId={activeId}
                    onHover={setHoverId}
                    onActivate={activateSegment}
                  />
                ))
                : pages.map((page) => (
                  <TranslationPage
                    key={page.page_number}
                    page={page}
                    scale={prefs.rightZoom}
                    hoverId={hoverId}
                    activeId={activeId}
                    onHover={setHoverId}
                    onActivate={activateSegment}
                  />
                ))
            ) : (
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
