import { useEffect, useState } from 'react'
import { fetchAiProviders } from '../../services/paperReaderApi'

function getTextKindLabel(textKind) {
  switch (textKind) {
    case 'word': return '术语'
    case 'phrase': return '短语'
    case 'sentence': return '句子'
    case 'title': return '标题'
    case 'passage': return '段落'
    default: return '选区'
  }
}

function copyText(text) {
  if (!text || !navigator.clipboard) return
  navigator.clipboard.writeText(text).catch(() => {})
}

const DOMAIN_OPTIONS = [
  { value: '', label: '通用翻译' },
  { value: 'it', label: '信息技术' },
  { value: 'finance', label: '金融财经' },
  { value: 'machinery', label: '机械制造' },
  { value: 'senimed', label: '生物医药' },
  { value: 'academic', label: '学术论文' },
  { value: 'aerospace', label: '航空航天' },
  { value: 'news', label: '新闻资讯' },
  { value: 'law', label: '法律法规' },
  { value: 'contract', label: '合同' },
]

export function SelectionInsightPanel({ domain, onDomainChange, selectionCard, width, currentProviderId, onProviderChange }) {
  const [providers, setProviders] = useState([])

  useEffect(() => {
    let cancelled = false
    fetchAiProviders()
      .then(data => {
        if (!cancelled) setProviders((data?.providers || []).filter(p => p.is_active))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 自动选择第一个启用的厂商
  useEffect(() => {
    if (currentProviderId == null && providers.length > 0) {
      onProviderChange?.(providers[0].id)
    }
  }, [providers, currentProviderId, onProviderChange])

  return (
    <aside className="insight-panel" style={{ width }}>
      <div className="insight-panel__header">
        <div>
          <p className="panel-label">划词结果</p>
          <h2>即时理解</h2>
        </div>

        <div className="insight-header-selects">
          {selectionCard.visible ? (
            <select
              className="insight-domain-select"
              value={domain}
              onChange={(e) => onDomainChange(e.target.value)}
            >
              {DOMAIN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : null}

          {providers.length > 0 ? (
            <select
              className="insight-model-select"
              value={currentProviderId ?? ''}
              onChange={(e) => onProviderChange?.(Number(e.target.value))}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {!selectionCard.visible ? (
        <div className="insight-placeholder">
          <p>选中一段英文后，这里会即时给出译文、阅读提示和关键词。</p>
        </div>
      ) : null}

      {selectionCard.visible ? (
        <div className="insight-content">
          <div className="insight-meta-row">
            <span>{selectionCard.wordCount} words</span>
            <span>{selectionCard.charCount} chars</span>
            <span>{getTextKindLabel(selectionCard.textKind)}</span>
          </div>

          {selectionCard.loading ? (
            <div className="insight-status-card">
              <p className="muted">正在生成即时理解，请稍等片刻...</p>
            </div>
          ) : null}

          {selectionCard.error ? (
            <div className="insight-status-card insight-status-card--error">
              <p className="error-text">{selectionCard.error}</p>
            </div>
          ) : null}

          {selectionCard.translation ? (
            <div className="insight-block">
              <div className="insight-block__title-row">
                <span>即时翻译</span>
                <button type="button" onClick={() => copyText(selectionCard.translation)}>
                  复制译文
                </button>
              </div>
              <p>{selectionCard.translation}</p>
            </div>
          ) : null}

          <div className="insight-block">
            <div className="insight-block__title-row">
              <span>原文片段</span>
              <button type="button" onClick={() => copyText(selectionCard.text)}>
                复制原文
              </button>
            </div>
            <p>{selectionCard.text}</p>
          </div>

          {selectionCard.explanation ? (
            <div className="insight-block">
              <span>阅读理解</span>
              <p>{selectionCard.explanation}</p>
            </div>
          ) : null}

          {selectionCard.focusPoints.length > 0 ? (
            <div className="insight-block">
              <span>精读抓手</span>
              <div className="insight-focus-list">
                {selectionCard.focusPoints.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>
          ) : null}

          {selectionCard.glossary.length > 0 ? (
            <div className="insight-block">
              <span>术语提示</span>
              <div className="insight-glossary-list">
                {selectionCard.glossary.map((item) => (
                  <article className="insight-glossary-item" key={item.term}>
                    <strong>{item.term}</strong>
                    <p>{item.note}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {selectionCard.keywords.length > 0 ? (
            <div className="insight-block">
              <span>关键词</span>
              <div className="keyword-row">
                {selectionCard.keywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            </div>
          ) : null}

          {selectionCard.source ? (
            <p className="card-footnote">结果来源：{selectionCard.source}</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
