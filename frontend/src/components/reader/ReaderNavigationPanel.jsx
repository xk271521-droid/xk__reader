import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, RefreshCw } from 'lucide-react'
import './readerNavigationPanel.css'

function OutlineItem({ item, depth = 0, onNavigate }) {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const [isExpanded, setIsExpanded] = useState(true)
  const page = Number(item.page)
  const canNavigate = Number.isInteger(page) && page > 0
  const englishTitle = String(item.title_en || '').trim()
  const chineseTitle = String(item.title_cn || '').trim()
  const title = englishTitle || chineseTitle || '未命名章节'
  const chineseExplanation = englishTitle && chineseTitle && chineseTitle !== englishTitle
    ? chineseTitle
    : ''
  const accessibleTitle = chineseExplanation
    ? `${englishTitle}，中文释义：${chineseExplanation}`
    : title

  return (
    <li className="reader-outline__item" style={{ '--outline-depth': depth }}>
      <div className="reader-outline__row">
        {hasChildren ? (
          <button
            type="button"
            className="reader-outline__expand"
            aria-label={`${isExpanded ? '收起' : '展开'} ${accessibleTitle}`}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((value) => !value)}
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : <span className="reader-outline__indent" aria-hidden="true" />}
        <button
          type="button"
          className="reader-outline__link"
          disabled={!canNavigate}
          aria-label={canNavigate ? `${accessibleTitle}，跳转到第 ${page} 页` : `${accessibleTitle}，该目录项没有可用页码`}
          onClick={() => canNavigate && onNavigate?.(page)}
        >
          <span className="reader-outline__title">
            {title}
          </span>
          {chineseExplanation ? <span className="reader-outline__translation" role="tooltip">{chineseExplanation}</span> : null}
          {canNavigate ? <span className="reader-outline__page">{page}</span> : null}
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ul className="reader-outline__tree">
          {item.children.map((child, index) => (
            <OutlineItem
              key={`${child.title_en || child.title_cn || 'section'}:${child.page || 'none'}:${index}`}
              item={child}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function PdfOutlinePanel({ nativeOutline, aiOutline, onNavigate, onRetryAiOutline }) {
  const nativeStatus = nativeOutline?.status || 'loading'
  const nativeItems = Array.isArray(nativeOutline?.items) ? nativeOutline.items : []
  const aiStatus = aiOutline?.status || 'idle'
  const aiItems = Array.isArray(aiOutline?.outline?.items) ? aiOutline.outline.items : []
  const isNativeTitleEnrichment = aiOutline?.mode === 'native_titles'

  if (nativeStatus === 'loading') {
    return <div className="reader-outline-state">正在读取论文原生目录…</div>
  }

  if (nativeItems.length > 0) {
    const translatedItems = isNativeTitleEnrichment && aiStatus === 'completed' && aiItems.length > 0
      ? aiItems
      : nativeItems
    const sourceLabel = isNativeTitleEnrichment && aiStatus === 'completed'
      ? 'PDF 原生目录 · 已附中文释义'
      : aiStatus === 'failed' && isNativeTitleEnrichment
        ? 'PDF 原生目录 · 中文释义生成失败，暂保留英文原文'
        : aiStatus === 'queued' || aiStatus === 'running'
          ? 'PDF 原生目录 · 正在生成中文释义…'
          : 'PDF 原生目录'
    return (
      <section className="reader-outline" aria-label="论文目录">
        <p className="reader-outline__source">{sourceLabel}</p>
        <ul className="reader-outline__tree">
          {translatedItems.map((item, index) => (
            <OutlineItem key={`${item.title_en || item.title_cn || 'section'}:${item.page || 'none'}:${index}`} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
        {aiStatus === 'failed' && isNativeTitleEnrichment ? (
          <div className="reader-outline__retry">
            <span>{aiOutline?.error_message || '请重试生成中文释义。'}</span>
            <button type="button" onClick={onRetryAiOutline}><RefreshCw />重试</button>
          </div>
        ) : null}
      </section>
    )
  }

  if (aiStatus === 'completed' && aiItems.length > 0) {
    return (
      <section className="reader-outline" aria-label="AI 生成的论文目录">
        <p className="reader-outline__source">AI 生成目录 · 已缓存</p>
        <ul className="reader-outline__tree">
          {aiItems.map((item, index) => (
            <OutlineItem key={`${item.title_en || item.title_cn || 'section'}:${item.page || 'none'}:${index}`} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      </section>
    )
  }

  if (aiStatus === 'failed') {
    return (
      <div className="reader-outline-state is-error">
        <FileText />
        <p>{aiOutline?.error_message || 'AI 目录生成失败。'}</p>
        <button type="button" onClick={onRetryAiOutline}><RefreshCw />重新生成</button>
      </div>
    )
  }

  if (aiStatus === 'idle') {
    return (
      <div className="reader-outline-state">
        <FileText />
        <p>正在准备 AI 目录…</p>
      </div>
    )
  }

  const stageLabel = aiStatus === 'queued'
    ? '正在排队生成 AI 目录…'
    : aiStatus === 'running'
      ? '正在根据论文正文整理双语目录…'
      : '正在准备 AI 双语目录…'
  return (
    <div className="reader-outline-state" aria-live="polite">
      <FileText />
      <p>{stageLabel}</p>
      <span>{Math.max(0, Math.min(100, Number(aiOutline?.progress || 0)))}%</span>
    </div>
  )
}

function OutlineProgressRing({ progress }) {
  const value = Math.max(0, Math.min(100, Number(progress?.value || 0)))
  const isIndeterminate = Boolean(progress?.indeterminate)

  return (
    <span
      aria-hidden="true"
      className={`reader-navigation-panel__outline-progress${isIndeterminate ? ' is-indeterminate' : ''}`}
      style={{ '--outline-progress': `${value}%` }}
    />
  )
}

export function ReaderNavigationPanel({ activeTab, onTabChange, thumbnailContent, outlineContent, outlineProgress, width }) {
  const outlineProgressLabel = outlineProgress
    ? `${outlineProgress.label}${outlineProgress.indeterminate ? '，请稍候' : `，${Math.round(outlineProgress.value)}%`}`
    : '目录'

  return (
    <div className="reader-navigation-panel" style={{ width }}>
      <div className="reader-navigation-panel__tabs" role="tablist" aria-label="阅读导航">
        <button
          id="reader-navigation-tab-thumbnails"
          type="button"
          role="tab"
          aria-selected={activeTab === 'thumbnails'}
          aria-controls="reader-navigation-panel-content"
          className={`reader-navigation-panel__tab${activeTab === 'thumbnails' ? ' is-active' : ''}`}
          onClick={() => onTabChange('thumbnails')}
        >
          缩略图
        </button>
        <button
          id="reader-navigation-tab-outline"
          type="button"
          role="tab"
          aria-selected={activeTab === 'outline'}
          aria-controls="reader-navigation-panel-content"
          aria-label={outlineProgressLabel}
          title={outlineProgressLabel}
          className={`reader-navigation-panel__tab${activeTab === 'outline' ? ' is-active' : ''}`}
          onClick={() => onTabChange('outline')}
        >
          目录
          {outlineProgress ? <OutlineProgressRing progress={outlineProgress} /> : null}
        </button>
      </div>
      <div
        id="reader-navigation-panel-content"
        role="tabpanel"
        aria-labelledby={`reader-navigation-tab-${activeTab}`}
        className="reader-navigation-panel__content"
      >
        {activeTab === 'thumbnails' ? thumbnailContent : outlineContent}
      </div>
    </div>
  )
}
