import { useState } from 'react'
import {
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  RefreshCw,
} from 'lucide-react'

const SECTION_DEFINITIONS = [
  { key: 'background_and_pain_points', title: '研究背景与痛点' },
  { key: 'research_objective', title: '研究目标' },
  { key: 'core_methods_or_models', title: '核心方法或模型' },
  { key: 'results_and_comparisons', title: '实验结果与对比' },
  { key: 'conclusions_and_contributions', title: '结论与创新贡献' },
  { key: 'limitations_and_boundaries', title: '局限与适用边界' },
]

const STAGE_LABELS = {
  queued: '正在等待生成',
  extracting_full_text: '正在提取论文全文',
  generating_brief: '正在生成文献速读',
  checking_coverage: '正在核对结构与证据',
}

const BASIS_LABELS = {
  paper_explicit: '论文明确',
  paper_inference: '基于论文推断',
  general_knowledge: '通用知识补充',
}

function buildCitationLabel(item = {}) {
  const pages = Array.isArray(item.pages) ? item.pages : []
  const figures = Array.isArray(item.figures) ? item.figures : []
  const locations = [
    ...pages.map((page) => `第 ${page} 页`),
    ...figures,
  ]
  return locations.join(' · ')
}

function BasisLabel({ basis }) {
  if (!basis || basis === 'paper_explicit') return null
  return (
    <span className={`paper-brief__basis is-${basis}`}>
      {BASIS_LABELS[basis] || '补充说明'}
    </span>
  )
}

function BriefEvidenceList({ items }) {
  const entries = Array.isArray(items) ? items : []
  return (
    <ul className="paper-brief__evidence-list">
      {entries.map((item, index) => {
        const citation = buildCitationLabel(item)
        return (
          <li key={`${item?.text || 'evidence'}:${index}`}>
            <p>
              <BasisLabel basis={item?.basis} />
              {item?.text || '原文未明确说明。'}
            </p>
            {citation ? <span className="paper-brief__citation">{citation}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

function BriefTerms({ terms }) {
  const [expandedTerms, setExpandedTerms] = useState({})
  const entries = Array.isArray(terms) ? terms : []

  if (!entries.length) {
    return <p className="paper-brief__empty">原文未提取到足够的关键术语。</p>
  }

  return (
    <div className="paper-brief__terms">
      {entries.map((term, index) => {
        const termKey = `${term?.term || 'term'}:${index}`
        const expanded = Boolean(expandedTerms[termKey])
        const citation = buildCitationLabel(term)
        const displayName = [term?.term, term?.chinese_name]
          .filter(Boolean)
          .filter((value, position, list) => list.indexOf(value) === position)
          .join(' / ')
        return (
          <article className="paper-brief__term" key={termKey}>
            <button
              type="button"
              className="paper-brief__term-trigger"
              aria-expanded={expanded}
              onClick={() => setExpandedTerms((current) => ({
                ...current,
                [termKey]: !current[termKey],
              }))}
            >
              <span className="paper-brief__term-heading">
                <strong>{displayName || '术语'}</strong>
                {term?.abbreviation ? <em>{term.abbreviation}</em> : null}
              </span>
              {expanded ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
            </button>
            <p className="paper-brief__term-plain">
              <BasisLabel basis={term?.basis} />
              {term?.plain_explanation || '原文未明确说明。'}
            </p>
            {expanded ? (
              <dl className="paper-brief__term-details">
                <div>
                  <dt>标准解释</dt>
                  <dd>{term?.standard_explanation || '原文未明确说明。'}</dd>
                </div>
                <div>
                  <dt>本文作用</dt>
                  <dd>{term?.paper_role || '原文未明确说明。'}</dd>
                </div>
                {citation ? (
                  <div>
                    <dt>原文位置</dt>
                    <dd className="paper-brief__citation">{citation}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function BriefProgress({ brief }) {
  const stage = STAGE_LABELS[brief?.stage] || STAGE_LABELS.queued
  const progress = Math.max(4, Math.min(96, Number(brief?.progress) || 0))
  return (
    <div className="paper-brief paper-brief--progress" role="status" aria-live="polite" aria-busy="true">
      <div className="paper-brief__progress-heading">
        <Loader2 className="is-spinning" size={18} aria-hidden="true" />
        <strong>{stage}</strong>
      </div>
      <div className="paper-brief__progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="paper-brief__skeleton" aria-hidden="true">
        <span className="is-long" />
        <span />
        <span className="is-medium" />
      </div>
    </div>
  )
}

function BriefIdle() {
  return (
    <div className="paper-brief paper-brief--progress" role="status" aria-live="polite" aria-busy="true">
      <Loader2 className="is-spinning" size={18} aria-hidden="true" />
      <div>
        <strong>正在准备文献速读</strong>
      </div>
    </div>
  )
}

function BriefFailure({ brief, onRetry }) {
  const [retrying, setRetrying] = useState(false)
  async function retry() {
    if (!onRetry || retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="paper-brief paper-brief--failure" role="alert">
      <CircleAlert size={20} aria-hidden="true" />
      <div>
        <strong>文献速读暂未生成</strong>
        <p>{brief?.error_message || '生成时发生错误，请稍后重试。'}</p>
        <button type="button" className="paper-brief__retry" onClick={() => void retry()} disabled={retrying}>
          {retrying ? <Loader2 className="is-spinning" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          重试
        </button>
      </div>
    </div>
  )
}

export function PaperReadingBriefPanel({ brief, onRetry, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false)

  if (!brief || brief.status === 'idle') return <BriefIdle />
  if (brief?.status === 'failed') return <BriefFailure brief={brief} onRetry={onRetry} />
  if (brief?.status !== 'completed' || !brief?.brief) return <BriefProgress brief={brief} />

  const content = brief.brief
  const conclusionCitation = buildCitationLabel(content.one_sentence_conclusion)
  return (
    <div className="workspace-panel__content paper-brief">
      <header className="paper-brief__header">
        <div className="paper-brief__header-title">
          <BookOpenCheck size={19} aria-hidden="true" />
          <strong>文献速读</strong>
        </div>
        <div className="paper-brief__header-actions">
          {brief.model ? <span>{brief.model}</span> : null}
          <button
            type="button"
            className="paper-brief__refresh"
            title="重新生成文献速读"
            aria-label="重新生成文献速读"
            disabled={refreshing || !onRefresh}
            onClick={async () => {
              if (!onRefresh || refreshing) return
              setRefreshing(true)
              try {
                await onRefresh()
              } finally {
                setRefreshing(false)
              }
            }}
          >
            <RefreshCw className={refreshing ? 'is-spinning' : undefined} size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="paper-brief__conclusion" aria-labelledby="paper-brief-conclusion">
        <h2 id="paper-brief-conclusion">一句话结论</h2>
        <p>
          <BasisLabel basis={content.one_sentence_conclusion?.basis} />
          {content.one_sentence_conclusion?.text || '原文未明确说明。'}
        </p>
        {conclusionCitation ? <span className="paper-brief__citation">{conclusionCitation}</span> : null}
      </section>

      {SECTION_DEFINITIONS.map((section) => (
        <section className="paper-brief__section" key={section.key}>
          <h2>{section.title}</h2>
          <BriefEvidenceList items={content[section.key]} />
        </section>
      ))}

      <section className="paper-brief__section paper-brief__section--terms">
        <h2>关键术语速查</h2>
        <BriefTerms terms={content.key_terms} />
      </section>

      {content.source_note ? <p className="paper-brief__source-note">{content.source_note}</p> : null}
    </div>
  )
}
