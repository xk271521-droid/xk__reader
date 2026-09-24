import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookText,
  ChevronDown,
  ChevronUp,
  Download,
  FileSearch,
  FileText,
  Highlighter,
  Languages,
  Loader2,
  NotebookPen,
  X,
} from 'lucide-react'
import {
  checkNotesExportAllowed,
  fetchFullTranslation,
  fetchPaperAnnotations,
  fetchPaperNotebooks,
} from '../../services/paperReaderApi'
import {
  buildAnnotationsExportHtml,
  buildAnnotationsPreviewGroups,
  buildNotesExportHtml,
  buildNotesPreviewTree,
  buildTranslationExportHtml,
  buildTranslationPreviewSections,
  openPreviewPdfExport,
  triggerPreviewWordExport,
} from './resourcePreviewShared'
import { buildRichTextSegments, DEFAULT_NOTE_TEXT_COLOR, parseRichNoteContent } from '../reader/richNoteContent'
import { mergeLogicalAnnotations } from '../../utils/annotationAggregation'

const HEADER_COMPACT_ENTER = 44
const HEADER_COMPACT_EXIT = 20

function darkenColor(hex, ratio = 0.26) {
  const normalized = String(hex || '').trim()
  if (!/^#([\da-f]{6})$/i.test(normalized)) return '#172033'
  const channels = normalized.slice(1).match(/.{2}/g) || ['17', '20', '33']
  const next = channels
    .map((channel) => {
      const value = parseInt(channel, 16)
      const adjusted = Math.max(0, Math.min(255, Math.round(value * (1 - ratio))))
      return adjusted.toString(16).padStart(2, '0')
    })
    .join('')
  return `#${next}`
}

function rgbaFromHex(hex, alpha = 1) {
  const normalized = String(hex || '').trim()
  if (!/^#([\da-f]{6})$/i.test(normalized)) return `rgba(15, 23, 42, ${alpha})`
  const channels = normalized.slice(1).match(/.{2}/g) || ['0f', '17', '2a']
  const [r, g, b] = channels.map((channel) => parseInt(channel, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function SectionShell({ id, kicker, title, subtitle, children }) {
  return (
    <section className="resource-preview__section" id={id} data-section-id={id}>
      <header className="resource-preview__section-head">
        {kicker ? <small>{kicker}</small> : null}
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      {children}
    </section>
  )
}

function AnnotationsPreviewView({
  paperId,
  paperTitle,
  resourceLabel,
  cacheEntry,
  onCacheUpdate,
  onBusyChange,
  exportSignal,
}) {
  const [expandedGroups, setExpandedGroups] = useState({})
  const annotations = cacheEntry?.data?.annotations || []
  const effectiveAnnotations = useMemo(() => mergeLogicalAnnotations(annotations), [annotations])
  const isLoading = cacheEntry?.status === 'loading'
  const error = cacheEntry?.error || ''

  useEffect(() => {
    if (!paperId) return undefined
    if (cacheEntry?.status === 'ready' || cacheEntry?.status === 'loading') return undefined

    onBusyChange?.(true)
    onCacheUpdate?.((previous) => ({
      ...previous,
      status: 'loading',
      error: '',
    }))

    fetchPaperAnnotations(paperId)
      .then((response) => {
        onCacheUpdate?.({
          status: 'ready',
          data: response,
          error: '',
          loadedAt: Date.now(),
        })
      })
      .catch((loadError) => {
        onCacheUpdate?.({
          status: 'error',
          data: null,
          error: loadError instanceof Error ? loadError.message : '标注内容加载失败',
          loadedAt: Date.now(),
        })
      })
      .finally(() => {
        onBusyChange?.(false)
      })
  }, [cacheEntry?.status, onBusyChange, onCacheUpdate, paperId])

  const groups = useMemo(() => buildAnnotationsPreviewGroups(effectiveAnnotations), [effectiveAnnotations])
  useEffect(() => {
    if (!exportSignal || !effectiveAnnotations.length) return
    const html = buildAnnotationsExportHtml(resourceLabel, paperTitle, effectiveAnnotations)
    if (exportSignal === 'pdf') {
      openPreviewPdfExport(html)
      return
    }
    if (exportSignal === 'word') {
      triggerPreviewWordExport(html, `${paperTitle || resourceLabel}-annotations`)
    }
  }, [effectiveAnnotations, exportSignal, paperTitle, resourceLabel])

  if (isLoading) {
    return (
      <div className="resource-preview__body resource-preview__body--annotations">
        <div className="resource-preview__loading">
          <Loader2 className="summary-spin" size={18} />
          <strong>正在整理标注摘录</strong>
          <p>会按页码分组，把引用片段、类型和阅读顺序整理好再展示。</p>
        </div>
      </div>
    )
  }

  if (error || !groups.length) {
    return (
      <div className="resource-preview__body resource-preview__body--annotations">
        <div className="resource-preview__empty">
          <Highlighter size={18} />
          <strong>{resourceLabel}暂时不可读</strong>
          <p>{error || '当前论文还没有可展示的文本标注。'}</p>
        </div>
      </div>
    )
  }

  const stats = [
    { label: '标注总数', value: effectiveAnnotations.length },
    { label: '覆盖页数', value: groups.length },
    { label: '类型数量', value: new Set(effectiveAnnotations.map((item) => item.type)).size },
  ]

  return (
    <div className="resource-preview__body resource-preview__body--annotations">
      <div className="resource-preview__main">
        <section className="resource-preview__hero resource-preview__hero--annotations">
          <div className="resource-preview__hero-copy">
            <small>Annotations</small>
            <h2>{resourceLabel}</h2>
            <p>先看统计，再按页码浏览摘录，避免把所有引用片段一股脑堆在一起。</p>
          </div>
          <div className="resource-preview__hero-meta">
            <span>{paperTitle}</span>
            <span>{effectiveAnnotations.length} 条文本标注</span>
          </div>
        </section>

        <SectionShell
          id="annotations-overview"
          kicker="Overview"
          title="先看范围"
          subtitle="先确认这批标注覆盖了多少页、多少类型，再深入查看片段。"
        >
          <div className="resource-preview__stats-grid">
            {stats.map((item) => (
              <article className="resource-preview__stat-card" key={item.label}>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        </SectionShell>

        {groups.map((group) => {
          const isExpanded = expandedGroups[group.id] !== false
          return (
            <SectionShell
              key={group.id}
              id={group.id}
              kicker={`页码 ${String(group.pageNumber).padStart(2, '0')}`}
              title={group.title}
              subtitle={group.preview}
            >
              <div>
                <div className={`resource-preview__section-card resource-preview__section-card--annotations${isExpanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="resource-preview__accordion-toggle"
                    onClick={() => setExpandedGroups((current) => ({ ...current, [group.id]: !isExpanded }))}
                  >
                    <span>{isExpanded ? '收起摘录' : '展开摘录'}</span>
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {isExpanded ? (
                    <ol className="resource-preview__annotation-list">
                      {group.items.map((item, itemIndex) => (
                        <li className={`resource-preview__annotation-item resource-preview__annotation-item--${item.type || 'highlight'}`} key={`${group.id}-${item.id || itemIndex}`}>
                          <b>{String(itemIndex + 1).padStart(2, '0')}</b>
                          <div>
                            <div className="resource-preview__annotation-meta">
                              <span>{item.type || 'highlight'}</span>
                              <span>第 {item.page_number || group.pageNumber} 页</span>
                            </div>
                            <p>{item.quote_text}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              </div>
            </SectionShell>
          )
        })}
      </div>
    </div>
  )
}

function RichTextPreview({ value }) {
  const doc = useMemo(() => parseRichNoteContent(value), [value])
  const segments = useMemo(() => buildRichTextSegments(doc), [doc])
  const lines = []
  let current = []

  segments.forEach((segment, segmentIndex) => {
    const parts = String(segment.text || '').split('\n')
    parts.forEach((part, partIndex) => {
      if (part) {
        current.push(
          <span
            key={`${segmentIndex}-${partIndex}-${part}`}
            style={segment.color !== DEFAULT_NOTE_TEXT_COLOR ? { color: segment.color } : undefined}
          >
            {part}
          </span>,
        )
      }
      if (partIndex < parts.length - 1) {
        lines.push(
          <p key={`line-${segmentIndex}-${partIndex}`}>
            {current.length ? current : <span>&nbsp;</span>}
          </p>,
        )
        current = []
      }
    })
  })

  if (current.length) {
    lines.push(<p key="line-last">{current}</p>)
  }

  if (!lines.length) return <p>暂无内容。</p>
  return <>{lines}</>
}

function NoteNodePreview({ node, level = 1 }) {
  return (
    <section className={`resource-preview__note-node resource-preview__note-node--level-${level}`}>
      <header>
        <small>层级 {level}</small>
        {level === 1 ? <h3>{node.title || '未命名标题'}</h3> : null}
        {level === 2 ? <h4>{node.title || '未命名标题'}</h4> : null}
        {level >= 3 ? <h5>{node.title || '未命名标题'}</h5> : null}
      </header>
      {node.blocks?.length ? (
        <div className="resource-preview__note-blocks">
          {node.blocks.map((block, blockIndex) => {
            if (block.type === 'quote') {
              return (
                <article className="resource-preview__note-block resource-preview__note-block--quote" key={`${node.id}-quote-${block.id || blockIndex}`}>
                  <small>{block.page_number ? `第 ${block.page_number} 页` : '引用摘录'}</small>
                  <blockquote>{block.content || '暂无引用内容。'}</blockquote>
                </article>
              )
            }
            if (block.type === 'image') {
              return (
                <article className="resource-preview__note-block resource-preview__note-block--image" key={`${node.id}-image-${block.id || blockIndex}`}>
                  <small>{block.page_number ? `第 ${block.page_number} 页` : '图像笔记'}</small>
                  {block.image_url ? <img src={block.image_url} alt="笔记图像" /> : null}
                  {block.content ? <p>{block.content}</p> : null}
                </article>
              )
            }
            return (
              <article className="resource-preview__note-block resource-preview__note-block--text" key={`${node.id}-text-${block.id || blockIndex}`}>
                <RichTextPreview value={block.content} />
              </article>
            )
          })}
        </div>
      ) : null}
      {node.children?.length ? (
        <div className="resource-preview__note-children">
          {node.children.map((child) => <NoteNodePreview key={child.id} node={child} level={Math.min(level + 1, 3)} />)}
        </div>
      ) : null}
    </section>
  )
}

function NotesPreviewView({
  paperId,
  paperTitle,
  resourceLabel,
  cacheEntry,
  onCacheUpdate,
  onBusyChange,
  exportSignal,
}) {
  const [expandedNotebooks, setExpandedNotebooks] = useState({})
  const notebooks = cacheEntry?.data?.notebooks || []
  const isLoading = cacheEntry?.status === 'loading'
  const error = cacheEntry?.error || ''

  useEffect(() => {
    if (!paperId) return undefined
    if (cacheEntry?.status === 'ready' || cacheEntry?.status === 'loading') return undefined

    onBusyChange?.(true)
    onCacheUpdate?.((previous) => ({
      ...previous,
      status: 'loading',
      error: '',
    }))

    fetchPaperNotebooks(paperId)
      .then((response) => {
        onCacheUpdate?.({
          status: 'ready',
          data: response,
          error: '',
          loadedAt: Date.now(),
        })
      })
      .catch((loadError) => {
        onCacheUpdate?.({
          status: 'error',
          data: null,
          error: loadError instanceof Error ? loadError.message : '笔记内容加载失败',
          loadedAt: Date.now(),
        })
      })
      .finally(() => {
        onBusyChange?.(false)
      })
  }, [cacheEntry?.status, onBusyChange, onCacheUpdate, paperId])

  const tree = useMemo(() => buildNotesPreviewTree(notebooks), [notebooks])
  useEffect(() => {
    if (!exportSignal || !notebooks.length) return
    const html = buildNotesExportHtml(resourceLabel, paperTitle, notebooks)
    if (exportSignal === 'pdf') {
      openPreviewPdfExport(html)
      return
    }
    if (exportSignal === 'word') {
      triggerPreviewWordExport(html, `${paperTitle || resourceLabel}-notes`)
    }
  }, [exportSignal, notebooks, paperTitle, resourceLabel])

  if (isLoading) {
    return (
      <div className="resource-preview__body resource-preview__body--notes">
        <div className="resource-preview__loading">
          <Loader2 className="summary-spin" size={18} />
          <strong>正在整理笔记阅读结构</strong>
          <p>会优先建立笔记本层级和标题骨架，再铺开正文、引用和图像块。</p>
        </div>
      </div>
    )
  }

  if (error || !tree.length) {
    return (
      <div className="resource-preview__body resource-preview__body--notes">
        <div className="resource-preview__empty">
          <NotebookPen size={18} />
          <strong>{resourceLabel}暂时不可读</strong>
          <p>{error || '当前论文还没有可展示的笔记内容。'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="resource-preview__body resource-preview__body--notes">
      <div className="resource-preview__main">
        <section className="resource-preview__hero resource-preview__hero--notes">
          <div className="resource-preview__hero-copy">
            <small>Notes</small>
            <h2>{resourceLabel}</h2>
            <p>保留笔记本、层级标题、正文、引用和图片块，让阅读顺着结构走，而不是回到编辑器界面。</p>
          </div>
          <div className="resource-preview__hero-meta">
            <span>{paperTitle}</span>
            <span>{tree.length} 个笔记本</span>
          </div>
        </section>

        <SectionShell
          id="notes-overview"
          kicker="Overview"
          title="先看笔记骨架"
          subtitle="先扫一眼每个笔记本收录了什么，再决定展开哪一本。"
        >
          <div className="resource-preview__overview-grid">
            {tree.slice(0, 4).map((notebook, index) => (
              <article className="resource-preview__overview-card" key={notebook.id}>
                <small>笔记本 {String(index + 1).padStart(2, '0')}</small>
                <p>{notebook.title}</p>
                <span>{notebook.nodes.length} 个一级节点</span>
              </article>
            ))}
          </div>
        </SectionShell>

        {tree.map((notebook, index) => {
          const isExpanded = expandedNotebooks[notebook.id] !== false
          return (
            <SectionShell
              key={notebook.id}
              id={notebook.id}
              kicker={`Notebook ${String(index + 1).padStart(2, '0')}`}
              title={notebook.title}
              subtitle={notebook.templateType === 'default' ? '默认模板结构' : '自由笔记结构'}
            >
              <div>
                <div className={`resource-preview__section-card resource-preview__section-card--notes${isExpanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="resource-preview__accordion-toggle"
                    onClick={() => setExpandedNotebooks((current) => ({ ...current, [notebook.id]: !isExpanded }))}
                  >
                    <span>{isExpanded ? '收起笔记本' : '展开笔记本'}</span>
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {isExpanded ? (
                    notebook.nodes.length ? (
                      <div className="resource-preview__note-tree">
                        {notebook.nodes.map((node) => <NoteNodePreview key={node.id} node={node} level={1} />)}
                      </div>
                    ) : (
                      <div className="resource-preview__empty-inline">
                        <p>这个笔记本还没有写入内容。</p>
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            </SectionShell>
          )
        })}
      </div>
    </div>
  )
}

export function ResourcePreviewModal({
  preview,
  currentUser,
  uiFontScale = 1,
  onClose,
  onJumpToEvidence,
  onRequireVip,
}) {
  const panelRef = useRef(null)
  const triggerRef = useRef(preview?.trigger || null)
  const [activeExportFormat, setActiveExportFormat] = useState('')
  const [cache, setCache] = useState({})
  const [isBusy, setIsBusy] = useState(false)
  const [isCheckingExport, setIsCheckingExport] = useState(false)
  const [isHeaderCompact, setIsHeaderCompact] = useState(false)
  const resourceType = preview?.resourceType || ''
  const themeClass = ''

  useEffect(() => {
    triggerRef.current = preview?.trigger || null
  }, [preview?.trigger])

  useEffect(() => {
    setIsHeaderCompact(false)
  }, [preview?.paperId, preview?.resourceType])

  useEffect(() => {
    if (!preview) return undefined
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const keyHandler = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    const previousActive = document.activeElement
    window.addEventListener('keydown', keyHandler)
    window.setTimeout(() => {
      panelRef.current?.focus()
    }, 0)
    return () => {
      document.body.style.overflow = previousBodyOverflow
      window.removeEventListener('keydown', keyHandler)
      const target = triggerRef.current || previousActive
      if (target?.focus) target.focus()
    }
  }, [onClose, preview])

  useEffect(() => {
    if (!preview) return
    const cacheKey = `${preview.paperId}:${preview.resourceType}`
    const current = cache[cacheKey]
    const shouldReset = current && current.updatedAt !== (preview.updatedAt || '')
    if (shouldReset) {
      setCache((previous) => ({
        ...previous,
        [cacheKey]: {
          status: 'idle',
          data: null,
          error: '',
          loadedAt: 0,
          updatedAt: preview.updatedAt || '',
        },
      }))
    }
  }, [cache, preview])

  if (!preview) return null

  const cacheKey = `${preview.paperId}:${preview.resourceType}`
  const cacheEntry = cache[cacheKey] || {
    status: 'idle',
    data: null,
    error: '',
    loadedAt: 0,
    updatedAt: preview.updatedAt || '',
  }

  function updateCache(next) {
    setCache((previous) => ({
      ...previous,
      [cacheKey]: {
        ...(previous[cacheKey] || cacheEntry),
        ...(typeof next === 'function' ? next(previous[cacheKey] || cacheEntry) : next),
        updatedAt: preview.updatedAt || '',
      },
    }))
  }

  async function handleExport(format) {
    const needsVipExport = preview?.resourceType === 'notes' || preview?.resourceType === 'annotations'
    if (needsVipExport && !currentUser?.features?.can_export_notes) {
      onRequireVip?.()
      return
    }
    if (needsVipExport) {
      setIsCheckingExport(true)
      try {
        await checkNotesExportAllowed(preview.paperId)
      } catch (error) {
        if (error?.status === 403 || error?.code === 'membership_feature_locked') {
          onRequireVip?.()
        } else {
          window.alert(error?.message || '导出权限校验失败，请稍后再试。')
        }
        return
      } finally {
        setIsCheckingExport(false)
      }
    }
    setActiveExportFormat(format)
    window.setTimeout(() => {
      setActiveExportFormat('')
    }, 0)
  }

  function handlePanelScroll(event) {
    const scrollTop = event.currentTarget.scrollTop
    setIsHeaderCompact((current) => {
      const nextCompact = current ? scrollTop > HEADER_COMPACT_EXIT : scrollTop > HEADER_COMPACT_ENTER
      return current === nextCompact ? current : nextCompact
    })
  }

  const visualColor = preview.resourceColor || '#2563EB'
  const inkColor = darkenColor(visualColor, 0.38)
  const surfaceGlow = rgbaFromHex(visualColor, 0.16)
  const overlayGlow = rgbaFromHex(visualColor, 0.08)

  const contentProps = {
    paperId: preview.paperId,
    paperTitle: preview.paperTitle,
    resourceLabel: preview.resourceLabel,
    resourceType: preview.resourceType,
    updatedAt: preview.updatedAt,
    cacheEntry,
    onCacheUpdate: updateCache,
    onBusyChange: setIsBusy,
    exportSignal: activeExportFormat,
    themeClass,
    onJumpToEvidence,
  }

  return (
    <div
      className="resource-preview-modal"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
      style={{
        '--resource-preview-accent': visualColor,
        '--ui-dialog-scale': uiFontScale,
        '--resource-preview-ink': inkColor,
        '--resource-preview-soft': surfaceGlow,
        '--resource-preview-soft-strong': overlayGlow,
      }}
    >
      <div
        ref={panelRef}
        className={`resource-preview-modal__panel${themeClass ? ` ${themeClass}` : ''}${isHeaderCompact ? ' is-scrolled' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${preview.resourceLabel}预览`}
        tabIndex={-1}
        onScroll={handlePanelScroll}
      >
        <header className="resource-preview-modal__header">
          <div className="resource-preview-modal__title">
            <span className="resource-preview-modal__badge" style={{ background: surfaceGlow, color: inkColor }}>
              {preview.resourceLabel}
            </span>
            <div className="resource-preview-modal__title-copy">
              <h2 title={preview.paperTitle}>{preview.paperTitle}</h2>
              <p>
                <span>{preview.resourceStatus === 'stale' ? '内容待更新' : '只读预览'}</span>
                {preview.updatedAt ? <span>更新于 {new Date(preview.updatedAt).toLocaleString('zh-CN')}</span> : null}
              </p>
            </div>
          </div>
          <div className="resource-preview-modal__actions">
            <div className="resource-preview-modal__export">
              <button type="button" className="resource-preview-modal__action" disabled={isBusy || isCheckingExport} onClick={() => handleExport('pdf')}>
                <Download size={15} />
                <span>PDF</span>
              </button>
              <button type="button" className="resource-preview-modal__action" disabled={isBusy || isCheckingExport} onClick={() => handleExport('word')}>
                <FileText size={15} />
                <span>Word</span>
              </button>
            </div>
            <button type="button" className="resource-preview-modal__close" onClick={() => onClose?.()} aria-label="关闭预览">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="resource-preview-modal__content">
          {resourceType === 'translation' ? (
            <TranslationPreviewView {...contentProps} />
          ) : null}
          {resourceType === 'annotations' ? (
            <AnnotationsPreviewView {...contentProps} />
          ) : null}
          {resourceType === 'notes' ? (
            <NotesPreviewView {...contentProps} />
          ) : null}
          {!resourceType ? (
            <div className="resource-preview__body">
              <div className="resource-preview__empty">
                <BookText size={18} />
                <strong>没有可预览的资源</strong>
                <p>当前资源类型暂未配置阅读视图。</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
