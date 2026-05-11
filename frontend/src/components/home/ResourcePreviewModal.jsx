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
  fetchFullTranslation,
  fetchPaperAnnotations,
  fetchPaperNotebooks,
  fetchPaperSummaryStatus,
} from '../../services/paperReaderApi'
import {
  PREVIEW_SUMMARY_TYPE_MAP,
  buildAnnotationsExportHtml,
  buildAnnotationsPreviewGroups,
  buildNotesExportHtml,
  buildNotesPreviewTree,
  buildTranslationExportHtml,
  buildTranslationPreviewSections,
  getAnnotationGroups,
  getQualityAssistantPanels,
  openPreviewPdfExport,
  openSummaryPdfExport,
  renderEvidenceSourceLabel,
  splitSummaryBodyText,
  triggerPreviewWordExport,
  triggerSummaryWordExport,
} from './resourcePreviewShared'
import { buildRichTextSegments, DEFAULT_NOTE_TEXT_COLOR, parseRichNoteContent } from '../reader/richNoteContent'

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

function SummaryPreviewView({
  paperTitle,
  resourceLabel,
  resourceType,
  paperId,
  updatedAt,
  themeClass,
  cacheEntry,
  onCacheUpdate,
  onBusyChange,
  exportSignal,
}) {
  const summaryType = PREVIEW_SUMMARY_TYPE_MAP[resourceType]?.id
  const summaryMeta = PREVIEW_SUMMARY_TYPE_MAP[resourceType] || PREVIEW_SUMMARY_TYPE_MAP[summaryType] || {}
  const [expandedSections, setExpandedSections] = useState({})
  const payload = cacheEntry?.data || null
  const summary = payload?.summary || null
  const isLoading = cacheEntry?.status === 'loading'
  const error = cacheEntry?.error || ''

  useEffect(() => {
    if (!paperId || !summaryType) return undefined
    if (cacheEntry?.status === 'ready' || cacheEntry?.status === 'loading') return undefined

    onBusyChange?.(true)
    onCacheUpdate?.((previous) => ({
      ...previous,
      status: 'loading',
      error: '',
    }))

    fetchPaperSummaryStatus(paperId, summaryType)
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
          error: loadError instanceof Error ? loadError.message : '总结内容加载失败',
          loadedAt: Date.now(),
        })
      })
      .finally(() => {
        onBusyChange?.(false)
      })
  }, [cacheEntry?.status, onBusyChange, onCacheUpdate, paperId, summaryType])

  const overviewCards = useMemo(() => {
    const items = []
    ;(summary?.highlights || []).slice(0, 4).forEach((item, index) => {
      items.push({
        id: `highlight-${index}`,
        title: `重点 ${String(index + 1).padStart(2, '0')}`,
        body: item,
      })
    })
    if (!items.length && summary?.preview) {
      splitSummaryBodyText(summary.preview).slice(0, 4).forEach((item, index) => {
        items.push({
          id: `preview-${index}`,
          title: index === 0 ? '一句话概览' : `概览 ${String(index + 1).padStart(2, '0')}`,
          body: item,
        })
      })
    }
    return items
  }, [summary])

  useEffect(() => {
    if (!exportSignal || !summary) return
    if (exportSignal === 'pdf') {
      openSummaryPdfExport(summaryMeta, summary, paperTitle)
      return
    }
    if (exportSignal === 'word') {
      triggerSummaryWordExport(summaryMeta, summary, paperTitle)
    }
  }, [exportSignal, paperTitle, summary, summaryMeta])

  if (isLoading) {
    return (
      <div className={`resource-preview__body ${themeClass}`}>
        <div className="resource-preview__loading">
          <Loader2 className="summary-spin" size={18} />
          <strong>正在整理总结内容</strong>
          <p>会优先加载概览、目录和模块结构，避免一打开就是整屏文字。</p>
        </div>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className={`resource-preview__body ${themeClass}`}>
        <div className="resource-preview__empty">
          <FileSearch size={18} />
          <strong>{resourceLabel}暂时不可读</strong>
          <p>{error || '当前资源还没有可展示的总结内容。'}</p>
        </div>
      </div>
    )
  }

  const annotationGroups = getAnnotationGroups(summary)
  const assistantPanels = getQualityAssistantPanels(summary)

  return (
    <div className={`resource-preview__body ${themeClass}`}>
      <div className="resource-preview__main">
        <section className="resource-preview__hero">
          <div className="resource-preview__hero-copy">
            <small>{resourceLabel}</small>
            <h2>{summary.title || summaryMeta.title || resourceLabel}</h2>
            <p>{summary.preview || summaryMeta.subtitle || `${paperTitle} 的结构化阅读预览`}</p>
          </div>
          <div className="resource-preview__hero-meta">
            <span>{paperTitle}</span>
            {updatedAt ? <span>更新于 {new Date(updatedAt).toLocaleString('zh-CN')}</span> : null}
          </div>
        </section>

        {overviewCards.length ? (
          <SectionShell
            id="summary-highlights"
            kicker="Overview"
            title="先看重点"
            subtitle="先扫一眼关键结论，再决定往下读哪一部分。"
          >
            <div className="resource-preview__overview-grid">
              {overviewCards.map((card) => (
                <article className="resource-preview__overview-card" key={card.id}>
                  <small>{card.title}</small>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </SectionShell>
        ) : null}

        {(summary.sections || []).map((section, index) => {
          const sectionId = `summary-section-${index}`
          const isExpanded = expandedSections[sectionId] !== false
          return (
            <SectionShell
              key={sectionId}
              id={sectionId}
              kicker={`模块 ${String(index + 1).padStart(2, '0')}`}
              title={section.heading || `总结模块 ${index + 1}`}
              subtitle={(section.keywords || []).slice(0, 4).join(' · ')}
            >
              <div>
                {section.keywords?.length ? (
                  <div className="resource-preview__tag-row">
                    {section.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                  </div>
                ) : null}
                <div className={`resource-preview__section-card${isExpanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="resource-preview__accordion-toggle"
                    onClick={() => setExpandedSections((current) => ({ ...current, [sectionId]: !isExpanded }))}
                  >
                    <span>{isExpanded ? '收起正文' : '展开正文'}</span>
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {isExpanded ? (
                    <div className="resource-preview__copy">
                      {splitSummaryBodyText(section.body).map((paragraph, paragraphIndex) => {
                        const bullet = paragraph.match(/^[-*•]\s*(.+)$/)
                        return bullet
                          ? <p className="resource-preview__bullet" key={`${sectionId}-bullet-${paragraphIndex}`}>{bullet[1]}</p>
                          : <p key={`${sectionId}-paragraph-${paragraphIndex}`}>{paragraph}</p>
                      })}
                    </div>
                  ) : null}
                  {section.evidence?.length ? (
                    <details className="resource-preview__detail-block">
                      <summary>引用与页码依据 {section.evidence.length} 条</summary>
                      <ul>
                        {section.evidence.map((item, evidenceIndex) => (
                          <li key={`${sectionId}-evidence-${evidenceIndex}`}>
                            <strong>{renderEvidenceSourceLabel(item)}</strong>
                            <span>{item.quote}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            </SectionShell>
          )
        })}

        {annotationGroups.length ? (
          <SectionShell
            id="summary-annotations"
            kicker="Annotations"
            title="关联标注"
            subtitle="这一部分只保留和当前总结直接相关的标注摘录。"
          >
            <div className="resource-preview__group-grid">
              {annotationGroups.map((group) => (
                <article className="resource-preview__group-card" key={group.type}>
                  <header>
                    <strong>{group.label || group.type}</strong>
                    <span>{group.count || 0} 条</span>
                  </header>
                  <ol>
                    {(group.items || []).slice(0, 6).map((item, index) => (
                      <li key={`${group.type}-${item.id || index}`}>
                        <b>{String(index + 1).padStart(2, '0')}</b>
                        <span>{item.page ? `第 ${item.page} 页：` : ''}{item.quote}</span>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </SectionShell>
        ) : null}

        {assistantPanels.length ? (
          <SectionShell
            id="summary-assistant"
            kicker="Assistant"
            title="研究助手"
            subtitle="把适合继续追问或复用的部分单独提出来，减少正文负担。"
          >
            <div className="resource-preview__assistant-grid">
              {assistantPanels.map((panel) => (
                <article className="resource-preview__assistant-card" key={panel.title}>
                  <strong>{panel.title}</strong>
                  <ol>
                    {panel.items.map((item, index) => <li key={`${panel.title}-${index}`}>{item}</li>)}
                  </ol>
                </article>
              ))}
            </div>
          </SectionShell>
        ) : null}

        {summary.missing_items?.length || summary.followup_questions?.length ? (
          <SectionShell
            id="summary-followup"
            kicker="Follow-up"
            title="继续往下读"
            subtitle="把需要回查和后续追问的内容单独收口，避免打断主阅读。"
          >
            <div className="resource-preview__tail-grid">
              {summary.missing_items?.length ? (
                <article className="resource-preview__tail-card">
                  <strong>回查清单</strong>
                  <ul>
                    {summary.missing_items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              ) : null}
              {summary.followup_questions?.length ? (
                <article className="resource-preview__tail-card">
                  <strong>后续问题</strong>
                  <ul>
                    {summary.followup_questions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              ) : null}
            </div>
          </SectionShell>
        ) : null}
      </div>
    </div>
  )
}

function TranslationPreviewView({
  paperId,
  paperTitle,
  resourceLabel,
  cacheEntry,
  onCacheUpdate,
  onBusyChange,
  exportSignal,
}) {
  const [expandedSections, setExpandedSections] = useState({})
  const translation = cacheEntry?.data || null
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

    fetchFullTranslation(paperId)
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
          error: loadError instanceof Error ? loadError.message : '译文加载失败',
          loadedAt: Date.now(),
        })
      })
      .finally(() => {
        onBusyChange?.(false)
      })
  }, [cacheEntry?.status, onBusyChange, onCacheUpdate, paperId])

  const sections = useMemo(() => buildTranslationPreviewSections(translation), [translation])
  useEffect(() => {
    if (!exportSignal || !translation) return
    const html = buildTranslationExportHtml(resourceLabel, paperTitle, translation)
    if (exportSignal === 'pdf') {
      openPreviewPdfExport(html)
      return
    }
    if (exportSignal === 'word') {
      triggerPreviewWordExport(html, `${paperTitle || resourceLabel}-translation`)
    }
  }, [exportSignal, paperTitle, resourceLabel, translation])

  if (isLoading) {
    return (
      <div className="resource-preview__body resource-preview__body--translation">
        <div className="resource-preview__loading">
          <Loader2 className="summary-spin" size={18} />
          <strong>正在排出版式更轻的译文阅读流</strong>
          <p>会先构建目录和章节，再把译文正文按适合阅读的列宽铺开。</p>
        </div>
      </div>
    )
  }

  if (error || !sections.length) {
    return (
      <div className="resource-preview__body resource-preview__body--translation">
        <div className="resource-preview__empty">
          <Languages size={18} />
          <strong>{resourceLabel}暂时不可读</strong>
          <p>{error || '当前论文还没有可展示的译文内容。'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="resource-preview__body resource-preview__body--translation">
      <div className="resource-preview__main">
        <section className="resource-preview__hero resource-preview__hero--translation">
          <div className="resource-preview__hero-copy">
            <small>Translation</small>
            <h2>{resourceLabel}</h2>
            <p>只保留译文阅读流，优先突出章节、标题和段落节奏，避免原文对照打断阅读。</p>
          </div>
          <div className="resource-preview__hero-meta">
            <span>{paperTitle}</span>
            <span>{sections.length} 个阅读分段</span>
          </div>
        </section>

        <SectionShell
          id="translation-overview"
          kicker="Overview"
          title="先看目录"
          subtitle="从标题块和首句预览里快速决定先读哪一段。"
        >
          <div className="resource-preview__overview-grid resource-preview__overview-grid--translation">
            {sections.slice(0, 4).map((section, index) => (
              <article className="resource-preview__overview-card" key={section.id}>
                <small>章节 {String(index + 1).padStart(2, '0')}</small>
                <p>{section.title}</p>
                {section.preview ? <span>{section.preview}</span> : null}
              </article>
            ))}
          </div>
        </SectionShell>

        {sections.map((section, index) => {
          const isExpanded = expandedSections[section.id] !== false
          const leadParagraphs = section.blocks
            .filter((block) => block.kind !== 'title')
            .slice(0, 2)
            .map((block) => block.text)
          return (
            <SectionShell
              key={section.id}
              id={section.id}
              kicker={`章节 ${String(index + 1).padStart(2, '0')} · 第 ${section.pageNumber} 页`}
              title={section.title}
              subtitle={leadParagraphs[0] || section.preview}
            >
              <div>
                {section.highlights?.length ? (
                  <div className="resource-preview__tag-row">
                    {section.highlights.map((item) => <span key={item}>{item}</span>)}
                  </div>
                ) : null}
                <div className={`resource-preview__section-card resource-preview__section-card--translation${isExpanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="resource-preview__accordion-toggle"
                    onClick={() => setExpandedSections((current) => ({ ...current, [section.id]: !isExpanded }))}
                  >
                    <span>{isExpanded ? '收起正文' : '展开正文'}</span>
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {isExpanded ? (
                    <div className="resource-preview__translation-copy">
                      {section.blocks.map((block) => {
                        if (block.kind === 'title') {
                          return <h3 key={block.id}>{block.text}</h3>
                        }
                        if (block.kind === 'heading') {
                          return <h4 key={block.id}>{block.text}</h4>
                        }
                        return <p key={block.id}>{block.text}</p>
                      })}
                    </div>
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

  const groups = useMemo(() => buildAnnotationsPreviewGroups(annotations), [annotations])
  useEffect(() => {
    if (!exportSignal || !annotations.length) return
    const html = buildAnnotationsExportHtml(resourceLabel, paperTitle, annotations)
    if (exportSignal === 'pdf') {
      openPreviewPdfExport(html)
      return
    }
    if (exportSignal === 'word') {
      triggerPreviewWordExport(html, `${paperTitle || resourceLabel}-annotations`)
    }
  }, [annotations, exportSignal, paperTitle, resourceLabel])

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
    { label: '标注总数', value: annotations.length },
    { label: '覆盖页数', value: groups.length },
    { label: '类型数量', value: new Set(annotations.map((item) => item.type)).size },
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
            <span>{annotations.length} 条文本标注</span>
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
  onClose,
}) {
  const panelRef = useRef(null)
  const triggerRef = useRef(preview?.trigger || null)
  const [activeExportFormat, setActiveExportFormat] = useState('')
  const [cache, setCache] = useState({})
  const [isBusy, setIsBusy] = useState(false)
  const [isHeaderCompact, setIsHeaderCompact] = useState(false)
  const resourceType = preview?.resourceType || ''
  const summaryMeta = PREVIEW_SUMMARY_TYPE_MAP[resourceType]
  const themeClass = summaryMeta?.themeClass || ''

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

  function handleExport(format) {
    setActiveExportFormat(format)
    window.setTimeout(() => {
      setActiveExportFormat('')
    }, 0)
  }

  function handlePanelScroll(event) {
    const nextCompact = event.currentTarget.scrollTop > 36
    setIsHeaderCompact((current) => (current === nextCompact ? current : nextCompact))
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
              <button type="button" className="resource-preview-modal__action" disabled={isBusy} onClick={() => handleExport('pdf')}>
                <Download size={15} />
                <span>PDF</span>
              </button>
              <button type="button" className="resource-preview-modal__action" disabled={isBusy} onClick={() => handleExport('word')}>
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
          {resourceType.startsWith('summary_') ? (
            <SummaryPreviewView {...contentProps} />
          ) : null}
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
