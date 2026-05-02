function getTextKindLabel(textKind) {
  switch (textKind) {
    case 'word':
      return '术语'
    case 'phrase':
      return '短语'
    case 'sentence':
      return '句子'
    case 'title':
      return '标题'
    case 'passage':
      return '段落'
    default:
      return '选区'
  }
}

function copyText(text) {
  if (!text || !navigator.clipboard) {
    return
  }

  navigator.clipboard.writeText(text).catch(() => {})
}

export function SelectionInsightPanel({ selectionCard, width }) {
  return (
    <aside className="insight-panel" style={{ width }}>
      <div className="insight-panel__header">
        <div>
          <p className="panel-label">划词结果</p>
          <h2>即时理解</h2>
        </div>

        {selectionCard.visible ? (
          <span className="insight-kind-chip">
            {getTextKindLabel(selectionCard.textKind)}
          </span>
        ) : null}
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

          <div className="insight-block">
            <div className="insight-block__title-row">
              <span>原文片段</span>
              <button type="button" onClick={() => copyText(selectionCard.text)}>
                复制原文
              </button>
            </div>
            <p>{selectionCard.text}</p>
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
