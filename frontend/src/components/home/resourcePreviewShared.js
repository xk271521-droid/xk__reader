import { buildNodeChildren } from '../reader/noteTree'
import { buildRichTextSegments, DEFAULT_NOTE_TEXT_COLOR } from '../reader/richNoteContent'

export const PREVIEW_SUMMARY_TYPES = [
  {
    id: 'overview',
    resourceType: 'summary_overview',
    title: '整篇总结',
    subtitle: '快速理解论文主线、方法、实验和结论',
    themeClass: 'summary-theme--overview',
  },
  {
    id: 'annotations',
    resourceType: 'summary_annotations',
    title: '我的标注总结',
    subtitle: '只归纳你高亮、下划线和重点标记过的内容',
    themeClass: 'summary-theme--annotations',
  },
  {
    id: 'review',
    resourceType: 'summary_review',
    title: '文献综述卡片',
    subtitle: '背景、问题、方法、实验、指标、发现、创新与局限的结构化底稿',
    themeClass: 'summary-theme--review',
  },
  {
    id: 'reproduction',
    resourceType: 'summary_reproduction',
    title: '复现总结',
    subtitle: '模型结构、数据集、参数、环境和公式逻辑',
    themeClass: 'summary-theme--reproduction',
  },
  {
    id: 'meeting',
    resourceType: 'summary_meeting',
    title: '组会汇报稿',
    subtitle: '按研究生组会口径生成可直接开口讲的稿子',
    themeClass: 'summary-theme--meeting',
  },
]

export const PREVIEW_SUMMARY_TYPE_MAP = PREVIEW_SUMMARY_TYPES.reduce((acc, item) => {
  acc[item.id] = item
  acc[item.resourceType] = item
  return acc
}, {})

export function splitSummaryBodyText(value) {
  const text = String(value || '').trim()
  if (!text) return []
  const explicitBlocks = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (explicitBlocks.length > 1) return explicitBlocks
  const sentences = text
    .split(/(?<=[。！？!?；;])\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (sentences.length <= 2) return [text]
  const blocks = []
  for (let index = 0; index < sentences.length; index += 2) {
    blocks.push(sentences.slice(index, index + 2).join(''))
  }
  return blocks
}

export function getAnnotationGroups(summary) {
  return Array.isArray(summary?.annotation_groups) ? summary.annotation_groups : []
}

export function getQualityAssistantPanels(summary) {
  return (summary?.assistant_panels || [])
    .filter((panel) => Array.isArray(panel?.items) && panel.items.length > 0)
    .slice(0, 3)
}

export function renderEvidenceSourceLabel(item) {
  const prefix = item?.source_type === 'annotation' ? '标注' : '论文'
  return item?.page ? `${prefix}｜第 ${item.page} 页` : prefix
}

export function escapePreviewHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function sanitizePreviewExportName(value, fallback = 'resource-preview') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, 80)
}

export function renderSummaryTextHtml(value) {
  return splitSummaryBodyText(value)
    .map((part) => {
      const bullet = part.match(/^[-*•]\s*(.+)$/)
      if (bullet) return `<li>${escapePreviewHtml(bullet[1])}</li>`
      return `<p>${escapePreviewHtml(part)}</p>`
    })
    .join('')
}

export function normalizeSummaryPreview(preview, fallbackTitle) {
  if (!preview) return []
  const value = String(preview || '').trim()
  if (!value) return []
  const blocks = splitSummaryBodyText(value)
  if (!blocks.length) return []
  return blocks.slice(0, 4).map((item, index) => ({
    id: `${fallbackTitle || 'summary'}-preview-${index}`,
    title: index === 0 ? '一句话概览' : `重点 ${String(index + 1).padStart(2, '0')}`,
    body: item,
  }))
}

export function buildSummaryNavigation(summary) {
  const links = []
  if (summary?.highlights?.length) {
    links.push({ id: 'summary-highlights', label: '重点结论' })
  }
  ;(summary?.sections || []).forEach((section, index) => {
    links.push({
      id: `summary-section-${index}`,
      label: section?.heading || `模块 ${String(index + 1).padStart(2, '0')}`,
    })
  })
  if (getAnnotationGroups(summary).length) {
    links.push({ id: 'summary-annotations', label: '标注清单' })
  }
  if (getQualityAssistantPanels(summary).length) {
    links.push({ id: 'summary-assistant', label: '研究助手' })
  }
  if (summary?.missing_items?.length || summary?.followup_questions?.length) {
    links.push({ id: 'summary-followup', label: '后续问题' })
  }
  return links
}

export function buildSummaryExportHtml(type, summary, paperTitle) {
  const assistantPanels = getQualityAssistantPanels(summary)
  const generatedAt = new Date().toLocaleString('zh-CN')
  const overviewCards = normalizeSummaryPreview(summary?.preview, type?.title)
  const sectionHtml = (summary?.sections || []).map((section, index) => {
    const keywords = (section?.keywords || [])
      .map((keyword) => `<span>${escapePreviewHtml(keyword)}</span>`)
      .join('')
    const evidence = (section?.evidence || [])
      .map((item) => `
        <li>
          <strong>${escapePreviewHtml(renderEvidenceSourceLabel(item))}</strong>
          <span>${escapePreviewHtml(item.quote || '')}</span>
        </li>
      `)
      .join('')
    return `
      <section class="export-section">
        <div class="export-section-title">
          <b>${String(index + 1).padStart(2, '0')}</b>
          <h2>${escapePreviewHtml(section?.heading || '总结要点')}</h2>
        </div>
        ${keywords ? `<div class="export-keywords">${keywords}</div>` : ''}
        <div class="export-body">${renderSummaryTextHtml(section?.body)}</div>
        ${evidence ? `<details class="export-detail-block" open><summary>已核验来源依据</summary><ul>${evidence}</ul></details>` : ''}
      </section>
    `
  }).join('')
  const annotationGroupsHtml = getAnnotationGroups(summary).map((group) => {
    const items = (group?.items || [])
      .map((item, index) => `
        <li>
          <b>${String(index + 1).padStart(2, '0')}</b>
          <span>${item.page ? `第 ${escapePreviewHtml(item.page)} 页：` : ''}${escapePreviewHtml(item.quote || '')}</span>
        </li>
      `)
      .join('')
    return `
      <section class="export-group-card">
        <h3>${escapePreviewHtml(group?.label || group?.type)} <span>${escapePreviewHtml(group?.count || 0)} 条</span></h3>
        ${items ? `<ol>${items}</ol>` : '<p>暂无。</p>'}
      </section>
    `
  }).join('')
  const highlightsHtml = (summary?.highlights || [])
    .map((item, index) => `
      <li>
        <b>${String(index + 1).padStart(2, '0')}</b>
        <span>${escapePreviewHtml(item)}</span>
      </li>
    `)
    .join('')
  const assistantHtml = assistantPanels.map((panel) => `
    <section class="export-assistant-card">
      <h3>${escapePreviewHtml(panel.title)}</h3>
      <ol>
        ${panel.items.map((item) => `<li>${escapePreviewHtml(item)}</li>`).join('')}
      </ol>
    </section>
  `).join('')
  const missingHtml = (summary?.missing_items || []).map((item) => `<li>${escapePreviewHtml(item)}</li>`).join('')
  const followupHtml = (summary?.followup_questions || []).map((item) => `<li>${escapePreviewHtml(item)}</li>`).join('')
  const previewCardsHtml = overviewCards.map((card) => `
    <article class="export-overview-card">
      <small>${escapePreviewHtml(card.title)}</small>
      <p>${escapePreviewHtml(card.body)}</p>
    </article>
  `).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapePreviewHtml(summary?.title || type?.title || '总结导出')}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #162133;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      line-height: 1.7;
      background: #ffffff;
    }
    .export-document { max-width: 820px; margin: 0 auto; }
    .export-cover {
      padding: 0 0 18px;
      border-bottom: 3px solid #2563eb;
      margin-bottom: 18px;
    }
    .export-type {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #075985;
      font-size: 12px;
      font-weight: 700;
    }
    h1 { margin: 12px 0 8px; font-size: 28px; line-height: 1.25; color: #0f172a; }
    .export-paper { margin: 0; color: #334155; font-size: 13px; }
    .export-preview { margin: 8px 0 0; color: #475569; font-size: 14px; }
    .export-meta { margin-top: 10px; color: #64748b; font-size: 11px; }
    .export-overview-grid {
      display: grid;
      gap: 10px;
      margin: 0 0 18px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .export-overview-card,
    .export-highlights,
    .export-annotation-shell,
    .export-tail section {
      border: 1px solid #dbeafe;
      border-radius: 14px;
      padding: 12px 14px;
      background: #f8fbff;
      page-break-inside: avoid;
    }
    .export-overview-card small {
      display: inline-flex;
      margin-bottom: 6px;
      color: #1d4ed8;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .export-overview-card p,
    .export-body p { margin: 0; font-size: 13.5px; color: #334155; }
    .export-highlights { margin-bottom: 18px; }
    .export-highlights h2,
    .export-annotation-shell h2,
    .export-assistant h2,
    .export-tail h2 { margin: 0 0 10px; font-size: 16px; color: #0f172a; }
    .export-highlights ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .export-highlights li { display: grid; grid-template-columns: 34px 1fr; gap: 10px; align-items: start; }
    .export-highlights b,
    .export-section-title b,
    .export-group-card b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      height: 24px;
      border-radius: 999px;
      background: #2563eb;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
    }
    .export-section {
      margin: 0 0 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid #e2e8f0;
      page-break-inside: avoid;
    }
    .export-section-title { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center; }
    .export-section h2 { margin: 0; color: #0f172a; font-size: 18px; line-height: 1.35; }
    .export-keywords { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .export-keywords span {
      padding: 3px 8px;
      border-radius: 999px;
      background: #ecfdf5;
      color: #047857;
      font-size: 11px;
      font-weight: 700;
    }
    .export-body { display: grid; gap: 8px; margin-top: 10px; }
    .export-body li {
      margin-left: 18px;
      color: #334155;
      font-size: 13.5px;
    }
    .export-detail-block {
      margin-top: 12px;
      padding: 0 10px 10px;
      border-left: 3px solid #93c5fd;
      background: #f8fafc;
      border-radius: 0 10px 10px 0;
    }
    .export-detail-block summary {
      padding: 10px 0 8px;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 700;
      cursor: default;
      list-style: none;
    }
    .export-detail-block summary::-webkit-details-marker { display: none; }
    .export-detail-block ul,
    .export-tail ul { margin: 0; padding-left: 18px; }
    .export-detail-block li,
    .export-tail li { margin: 4px 0; font-size: 12px; color: #475569; }
    .export-detail-block strong { margin-right: 6px; color: #0f172a; }
    .export-annotation-shell { margin-bottom: 18px; }
    .export-annotation-grid,
    .export-assistant-grid,
    .export-tail { display: grid; gap: 10px; }
    .export-group-card {
      border: 1px solid #bfdbfe;
      border-radius: 14px;
      padding: 12px;
      background: #ffffff;
    }
    .export-group-card h3 { margin: 0 0 8px; color: #0f172a; font-size: 13px; }
    .export-group-card h3 span { color: #64748b; font-size: 11px; }
    .export-group-card ol { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .export-group-card li { display: grid; grid-template-columns: 30px 1fr; gap: 8px; color: #475569; font-size: 12px; }
    .export-assistant { margin: 18px 0; page-break-inside: avoid; }
    .export-assistant-card {
      padding: 12px;
      border: 1px solid #dbeafe;
      border-radius: 12px;
      background: #eff6ff;
    }
    .export-assistant-card h3 { margin: 0 0 6px; color: #1e3a8a; font-size: 14px; }
    .export-assistant-card ol { margin: 0; padding-left: 20px; }
    .export-assistant-card li { margin: 4px 0; font-size: 12.5px; }
    .export-tail { margin-top: 16px; }
    .export-source { margin-top: 18px; color: #64748b; font-size: 11px; }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .export-section { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="export-document">
    <header class="export-cover">
      <span class="export-type">${escapePreviewHtml(type?.title || '总结')}</span>
      <h1>${escapePreviewHtml(summary?.title || type?.title || '总结')}</h1>
      ${paperTitle ? `<p class="export-paper">论文：${escapePreviewHtml(paperTitle)}</p>` : ''}
      ${summary?.preview ? `<p class="export-preview">${escapePreviewHtml(summary.preview)}</p>` : ''}
      <div class="export-meta">导出时间：${escapePreviewHtml(generatedAt)}</div>
    </header>
    ${previewCardsHtml ? `<section class="export-overview-grid">${previewCardsHtml}</section>` : ''}
    ${highlightsHtml ? `<section class="export-highlights"><h2>关键结论</h2><ol>${highlightsHtml}</ol></section>` : ''}
    ${sectionHtml}
    ${annotationGroupsHtml ? `<section class="export-annotation-shell"><h2>标注清单</h2><div class="export-annotation-grid">${annotationGroupsHtml}</div></section>` : ''}
    ${assistantHtml ? `<section class="export-assistant"><h2>研究助手</h2><div class="export-assistant-grid">${assistantHtml}</div></section>` : ''}
    ${missingHtml || followupHtml ? `<section class="export-tail">
      ${missingHtml ? `<section><h2>回查清单</h2><ul>${missingHtml}</ul></section>` : ''}
      ${followupHtml ? `<section><h2>可继续深挖的问题</h2><ul>${followupHtml}</ul></section>` : ''}
    </section>` : ''}
    ${summary?.source_note ? `<p class="export-source">来源说明：${escapePreviewHtml(summary.source_note)}</p>` : ''}
  </main>
</body>
</html>`
}

export function triggerSummaryWordExport(type, summary, paperTitle) {
  const html = buildSummaryExportHtml(type, summary, paperTitle)
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizePreviewExportName(summary?.title || type?.title || paperTitle || 'summary')}.doc`
  link.click()
  URL.revokeObjectURL(url)
}

export function openSummaryPdfExport(type, summary, paperTitle) {
  const html = buildSummaryExportHtml(type, summary, paperTitle)
  const printWindow = window.open('', '_blank', 'width=980,height=720')
  if (!printWindow) {
    window.alert('浏览器拦截了导出窗口，请允许弹窗后再试。')
    return
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => {
    printWindow.print()
  }, 320)
}

export function buildTranslationPreviewSections(translation) {
  const pages = translation?.pages || []
  return pages
    .map((page, pageIndex) => {
      const blocks = (page?.blocks || [])
        .map((block, blockIndex) => {
          const text = String(block?.translated_text || '').trim()
          if (!text || !/[\u3400-\u9fff]/.test(text)) return null
          return {
            id: `${page.page_number || pageIndex + 1}-block-${block.id || blockIndex}`,
            kind: String(block?.kind || 'paragraph'),
            text,
          }
        })
        .filter(Boolean)
      if (!blocks.length) return null
      const titleBlock = blocks.find((block) => block.kind === 'title' || block.kind === 'heading')
      const preview = blocks
        .filter((block) => block.kind !== 'title')
        .slice(0, 2)
        .map((block) => block.text)
        .join(' ')
      return {
        id: `translation-page-${page.page_number || pageIndex + 1}`,
        pageNumber: page.page_number || pageIndex + 1,
        title: titleBlock?.text || `第 ${page.page_number || pageIndex + 1} 页`,
        preview: preview || titleBlock?.text || '',
        highlights: blocks
          .filter((block) => block.kind === 'title' || block.kind === 'heading')
          .slice(0, 3)
          .map((block) => block.text),
        blocks,
      }
    })
    .filter(Boolean)
}

export function buildTranslationExportHtml(title, paperTitle, translation) {
  const sections = buildTranslationPreviewSections(translation)
  const generatedAt = new Date().toLocaleString('zh-CN')
  const tocHtml = sections
    .map((section, index) => `<li><b>${String(index + 1).padStart(2, '0')}</b><span>${escapePreviewHtml(section.title)}</span></li>`)
    .join('')
  const sectionHtml = sections
    .map((section, index) => {
      const blocksHtml = section.blocks
        .map((block) => {
          if (block.kind === 'title') return `<h2>${escapePreviewHtml(block.text)}</h2>`
          if (block.kind === 'heading') return `<h3>${escapePreviewHtml(block.text)}</h3>`
          return `<p>${escapePreviewHtml(block.text)}</p>`
        })
        .join('')
      const highlights = (section.highlights || [])
        .map((item) => `<span>${escapePreviewHtml(item)}</span>`)
        .join('')
      return `
        <section class="translation-section">
          <header>
            <small>章节 ${String(index + 1).padStart(2, '0')} · 第 ${section.pageNumber} 页</small>
            <h2>${escapePreviewHtml(section.title)}</h2>
            ${section.preview ? `<p class="translation-preview">${escapePreviewHtml(section.preview)}</p>` : ''}
            ${highlights ? `<div class="translation-tags">${highlights}</div>` : ''}
          </header>
          <div class="translation-body">${blocksHtml}</div>
        </section>
      `
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapePreviewHtml(title || '全文翻译')}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", serif;
      line-height: 1.8;
      background: #fffdf8;
    }
    .doc { max-width: 820px; margin: 0 auto; }
    .cover {
      padding: 0 0 18px;
      margin-bottom: 18px;
      border-bottom: 3px solid #c084fc;
    }
    .eyebrow {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: #f3e8ff;
      color: #7e22ce;
      font-size: 12px;
      font-weight: 700;
      font-family: "Microsoft YaHei", sans-serif;
    }
    h1 { margin: 12px 0 8px; font-size: 28px; line-height: 1.25; color: #1f1632; }
    .paper, .meta, .translation-preview {
      margin: 0;
      color: #5b4d6f;
      font-size: 13px;
      font-family: "Microsoft YaHei", sans-serif;
    }
    .meta { margin-top: 10px; font-size: 11px; }
    .toc {
      display: grid;
      gap: 8px;
      margin: 0 0 18px;
      padding: 14px;
      border: 1px solid #e9d5ff;
      border-radius: 16px;
      background: #faf5ff;
      font-family: "Microsoft YaHei", sans-serif;
    }
    .toc h2 { margin: 0; font-size: 16px; color: #3b0764; }
    .toc ol { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .toc li { display: grid; grid-template-columns: 34px 1fr; gap: 8px; align-items: start; color: #4c1d95; font-size: 12px; }
    .toc b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      height: 22px;
      border-radius: 999px;
      background: linear-gradient(135deg, #c084fc, #8b5cf6);
      color: #fff;
    }
    .translation-section {
      margin-bottom: 18px;
      padding: 16px 18px;
      border: 1px solid #ede9fe;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.95);
      page-break-inside: avoid;
    }
    .translation-section small {
      display: inline-flex;
      color: #7e22ce;
      font-family: "Microsoft YaHei", sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .translation-section h2,
    .translation-body h2 {
      margin: 6px 0 8px;
      color: #231942;
      font-size: 22px;
      line-height: 1.4;
    }
    .translation-body h3 {
      margin: 16px 0 8px;
      color: #4c1d95;
      font-size: 17px;
      line-height: 1.5;
    }
    .translation-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .translation-tags span {
      padding: 3px 8px;
      border-radius: 999px;
      background: #f3e8ff;
      color: #6b21a8;
      font-family: "Microsoft YaHei", sans-serif;
      font-size: 11px;
      font-weight: 700;
    }
    .translation-body { margin-top: 14px; }
    .translation-body p {
      margin: 0 0 10px;
      font-size: 13.8px;
      color: #2b2438;
      text-indent: 2em;
    }
  </style>
</head>
<body>
  <main class="doc">
    <header class="cover">
      <span class="eyebrow">全文翻译</span>
      <h1>${escapePreviewHtml(title || '全文翻译')}</h1>
      ${paperTitle ? `<p class="paper">论文：${escapePreviewHtml(paperTitle)}</p>` : ''}
      <p class="meta">导出时间：${escapePreviewHtml(generatedAt)}</p>
    </header>
    ${tocHtml ? `<section class="toc"><h2>阅读目录</h2><ol>${tocHtml}</ol></section>` : ''}
    ${sectionHtml || '<p class="paper">暂无可导出的译文内容。</p>'}
  </main>
</body>
</html>`
}

export function buildAnnotationsPreviewGroups(annotations = []) {
  const pageMap = new Map()
  ;(annotations || []).forEach((annotation) => {
    const page = annotation?.page_number || 0
    if (!pageMap.has(page)) pageMap.set(page, [])
    pageMap.get(page).push(annotation)
  })
  return [...pageMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, items]) => ({
      id: `annotation-page-${pageNumber}`,
      pageNumber,
      title: `第 ${pageNumber} 页`,
      preview: items.slice(0, 2).map((item) => item.quote_text).join(' '),
      items: items.sort((left, right) => {
        const pageDiff = Number(left.page_number || 0) - Number(right.page_number || 0)
        if (pageDiff !== 0) return pageDiff
        return Number(left.start_char || 0) - Number(right.start_char || 0)
      }),
    }))
}

export function buildAnnotationsExportHtml(title, paperTitle, annotations = []) {
  const groups = buildAnnotationsPreviewGroups(annotations)
  const generatedAt = new Date().toLocaleString('zh-CN')
  const statItems = [
    { label: '标注总数', value: String(annotations.length) },
    { label: '覆盖页数', value: String(groups.length) },
    { label: '高亮类型', value: String(new Set((annotations || []).map((item) => item.type)).size || 0) },
  ]
  const groupHtml = groups.map((group, groupIndex) => {
    const itemsHtml = group.items.map((item, itemIndex) => `
      <li class="annotation-item annotation-item--${escapePreviewHtml(item.type || 'highlight')}">
        <b>${String(itemIndex + 1).padStart(2, '0')}</b>
        <div>
          <div class="annotation-meta">
            <span>${escapePreviewHtml(item.type || 'highlight')}</span>
            <span>第 ${escapePreviewHtml(item.page_number || group.pageNumber)} 页</span>
          </div>
          <p>${escapePreviewHtml(item.quote_text || '')}</p>
        </div>
      </li>
    `).join('')
    return `
      <section class="annotation-group">
        <header>
          <small>分组 ${String(groupIndex + 1).padStart(2, '0')}</small>
          <h2>${escapePreviewHtml(group.title)}</h2>
          ${group.preview ? `<p>${escapePreviewHtml(group.preview)}</p>` : ''}
        </header>
        <ol>${itemsHtml}</ol>
      </section>
    `
  }).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapePreviewHtml(title || '原文标注')}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1f2937;
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      line-height: 1.7;
      background: #fffaf9;
    }
    .doc { max-width: 820px; margin: 0 auto; }
    .cover {
      padding: 0 0 18px;
      margin-bottom: 18px;
      border-bottom: 3px solid #ef4444;
    }
    .eyebrow {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: #fee2e2;
      color: #b91c1c;
      font-size: 12px;
      font-weight: 700;
    }
    h1 { margin: 12px 0 8px; font-size: 28px; line-height: 1.25; color: #450a0a; }
    .paper, .meta { margin: 0; color: #7f1d1d; font-size: 13px; }
    .meta { margin-top: 10px; font-size: 11px; }
    .stats {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 0 0 18px;
    }
    .stat-card {
      padding: 12px 14px;
      border: 1px solid #fecaca;
      border-radius: 14px;
      background: #fff5f5;
    }
    .stat-card small {
      display: inline-flex;
      margin-bottom: 6px;
      color: #b91c1c;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .stat-card strong { color: #450a0a; font-size: 22px; }
    .annotation-group {
      margin-bottom: 18px;
      padding: 14px 16px;
      border: 1px solid #fecaca;
      border-radius: 18px;
      background: #ffffff;
      page-break-inside: avoid;
    }
    .annotation-group small {
      display: inline-flex;
      color: #b91c1c;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .annotation-group h2 {
      margin: 6px 0 6px;
      color: #450a0a;
      font-size: 20px;
      line-height: 1.35;
    }
    .annotation-group > header > p {
      margin: 0;
      color: #7f1d1d;
      font-size: 13px;
    }
    .annotation-group ol {
      display: grid;
      gap: 10px;
      margin: 14px 0 0;
      padding: 0;
      list-style: none;
    }
    .annotation-item {
      display: grid;
      grid-template-columns: 34px 1fr;
      gap: 10px;
      padding: 12px;
      border-radius: 14px;
      background: #fff5f5;
      border: 1px solid #fee2e2;
    }
    .annotation-item b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 24px;
      border-radius: 999px;
      background: linear-gradient(135deg, #f87171, #ef4444);
      color: #fff;
      font-size: 12px;
    }
    .annotation-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: #991b1b;
      font-size: 11px;
      font-weight: 700;
    }
    .annotation-item p {
      margin: 8px 0 0;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(254, 226, 226, 0.88);
      color: #1f2937;
      font-size: 13.5px;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <main class="doc">
    <header class="cover">
      <span class="eyebrow">原文标注</span>
      <h1>${escapePreviewHtml(title || '原文标注')}</h1>
      ${paperTitle ? `<p class="paper">论文：${escapePreviewHtml(paperTitle)}</p>` : ''}
      <p class="meta">导出时间：${escapePreviewHtml(generatedAt)}</p>
    </header>
    <section class="stats">
      ${statItems.map((item) => `<article class="stat-card"><small>${escapePreviewHtml(item.label)}</small><strong>${escapePreviewHtml(item.value)}</strong></article>`).join('')}
    </section>
    ${groupHtml || '<p class="paper">暂无可导出的标注内容。</p>'}
  </main>
</body>
</html>`
}

export function buildNotesPreviewTree(notebooks = []) {
  return (notebooks || []).map((notebook, notebookIndex) => ({
    id: notebook.id || `notebook-${notebookIndex}`,
    title: notebook.title || `笔记本 ${notebookIndex + 1}`,
    templateType: notebook.template_type || '',
    nodes: buildNodeChildren(notebook.nodes || [], null),
  }))
}

export function buildNotesExportHtml(title, paperTitle, notebooks = []) {
  const tree = buildNotesPreviewTree(notebooks)
  const generatedAt = new Date().toLocaleString('zh-CN')

  function renderTextContent(rawValue) {
    const safeValue = String(rawValue || '')
    if (!safeValue) return '<p>暂无内容。</p>'
    try {
      const parsed = JSON.parse(safeValue)
      if (parsed?.__xk_note_rich_text_v1 === true) {
        const segments = buildRichTextSegments(parsed)
        const lines = []
        let currentLine = []
        segments.forEach((segment) => {
          const parts = String(segment.text || '').split('\n')
          parts.forEach((part, index) => {
            if (part) {
              currentLine.push(
                segment.color && segment.color !== DEFAULT_NOTE_TEXT_COLOR
                  ? `<span style="color:${escapePreviewHtml(segment.color)}">${escapePreviewHtml(part)}</span>`
                  : `<span>${escapePreviewHtml(part)}</span>`,
              )
            }
            if (index < parts.length - 1) {
              lines.push(`<p>${currentLine.join('') || '&nbsp;'}</p>`)
              currentLine = []
            }
          })
        })
        if (currentLine.length) lines.push(`<p>${currentLine.join('')}</p>`)
        return lines.join('') || '<p>暂无内容。</p>'
      }
    } catch {
      // Fall through to plain text rendering.
    }
    return splitSummaryBodyText(safeValue)
      .map((part) => `<p>${escapePreviewHtml(part)}</p>`)
      .join('')
  }

  function renderNodes(nodes = [], level = 1) {
    return (nodes || []).map((node) => {
      const blocksHtml = (node.blocks || []).map((block) => {
        if (block.type === 'quote') {
          return `
            <article class="note-block note-block--quote">
              <small>${block.page_number ? `第 ${escapePreviewHtml(block.page_number)} 页` : '引用'}</small>
              <blockquote>${escapePreviewHtml(block.content || '')}</blockquote>
            </article>
          `
        }
        if (block.type === 'image') {
          return `
            <article class="note-block note-block--image">
              <small>${block.page_number ? `第 ${escapePreviewHtml(block.page_number)} 页` : '图像笔记'}</small>
              ${block.image_url ? `<img src="${escapePreviewHtml(block.image_url)}" alt="笔记图像" />` : ''}
              ${block.content ? `<p>${escapePreviewHtml(block.content)}</p>` : ''}
            </article>
          `
        }
        return `
          <article class="note-block note-block--text">
            ${renderTextContent(block.content)}
          </article>
        `
      }).join('')
      const childHtml = renderNodes(node.children || [], level + 1)
      return `
        <section class="note-node note-node--level-${level}">
          <header>
            <small>层级 ${level}</small>
            <h${Math.min(level + 1, 4)}>${escapePreviewHtml(node.title || '未命名标题')}</h${Math.min(level + 1, 4)}>
          </header>
          ${blocksHtml ? `<div class="note-node__blocks">${blocksHtml}</div>` : ''}
          ${childHtml ? `<div class="note-node__children">${childHtml}</div>` : ''}
        </section>
      `
    }).join('')
  }

  const notebookHtml = tree.map((notebook, index) => `
    <section class="notebook-card">
      <header>
        <small>笔记本 ${String(index + 1).padStart(2, '0')}</small>
        <h2>${escapePreviewHtml(notebook.title)}</h2>
      </header>
      ${renderNodes(notebook.nodes, 1) || '<p class="empty">暂无层级内容。</p>'}
    </section>
  `).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapePreviewHtml(title || '笔记')}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1f2937;
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      line-height: 1.75;
      background: #fffdf8;
    }
    .doc { max-width: 820px; margin: 0 auto; }
    .cover {
      padding: 0 0 18px;
      margin-bottom: 18px;
      border-bottom: 3px solid #ca8a04;
    }
    .eyebrow {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: #fef3c7;
      color: #a16207;
      font-size: 12px;
      font-weight: 700;
    }
    h1 { margin: 12px 0 8px; font-size: 28px; line-height: 1.25; color: #3f2d0f; }
    .paper, .meta { margin: 0; color: #7c5a10; font-size: 13px; }
    .meta { margin-top: 10px; font-size: 11px; }
    .notebook-card {
      margin-bottom: 18px;
      padding: 16px 18px;
      border: 1px solid #fde68a;
      border-radius: 18px;
      background: #fffdf7;
      page-break-inside: avoid;
    }
    .notebook-card small,
    .note-node header small {
      display: inline-flex;
      color: #a16207;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .notebook-card h2,
    .note-node h2,
    .note-node h3,
    .note-node h4 {
      margin: 6px 0 0;
      color: #3f2d0f;
      line-height: 1.4;
    }
    .notebook-card h2 { font-size: 22px; }
    .note-node {
      margin-top: 14px;
      padding-left: 14px;
      border-left: 2px solid rgba(202, 138, 4, 0.22);
    }
    .note-node--level-2 { margin-left: 14px; }
    .note-node--level-3 { margin-left: 28px; }
    .note-node__blocks {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }
    .note-block {
      padding: 12px 14px;
      border-radius: 14px;
      background: #ffffff;
      border: 1px solid #f3e2ac;
    }
    .note-block p {
      margin: 0 0 8px;
      color: #2f2a23;
      font-size: 13.5px;
    }
    .note-block p:last-child { margin-bottom: 0; }
    .note-block--quote {
      background: #fffbeb;
      border-left: 4px solid #f59e0b;
    }
    .note-block--quote small,
    .note-block--image small {
      display: inline-flex;
      margin-bottom: 8px;
      color: #a16207;
      font-size: 11px;
      font-weight: 700;
    }
    .note-block--quote blockquote {
      margin: 0;
      color: #4b5563;
      font-size: 13px;
      line-height: 1.7;
    }
    .note-block--image img {
      display: block;
      max-width: 100%;
      border-radius: 12px;
      margin-bottom: 10px;
    }
    .note-node__children { margin-top: 10px; }
    .empty { color: #8a6b28; font-size: 13px; }
  </style>
</head>
<body>
  <main class="doc">
    <header class="cover">
      <span class="eyebrow">笔记</span>
      <h1>${escapePreviewHtml(title || '笔记')}</h1>
      ${paperTitle ? `<p class="paper">论文：${escapePreviewHtml(paperTitle)}</p>` : ''}
      <p class="meta">导出时间：${escapePreviewHtml(generatedAt)}</p>
    </header>
    ${notebookHtml || '<p class="paper">暂无可导出的笔记内容。</p>'}
  </main>
</body>
</html>`
}

export function openPreviewPdfExport(html) {
  const printWindow = window.open('', '_blank', 'width=980,height=720')
  if (!printWindow) {
    window.alert('浏览器拦截了导出窗口，请允许弹窗后再试。')
    return
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => {
    printWindow.print()
  }, 320)
}

export function triggerPreviewWordExport(html, fileName) {
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizePreviewExportName(fileName)}.doc`
  link.click()
  URL.revokeObjectURL(url)
}
