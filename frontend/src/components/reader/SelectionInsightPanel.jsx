export function SelectionInsightPanel({ selectionCard, width }) {
  return (
    <aside className="insight-panel" style={{ width }}>
      <div className="insight-panel__header">
        <p className="panel-label">划词结果</p>
        <h2>即时理解</h2>
      </div>

      {!selectionCard.visible ? (
        <div className="insight-placeholder">
          <p>选中一段英文后，这里会出现翻译、术语解释和关键词。</p>
        </div>
      ) : null}

      {selectionCard.visible ? (
        <div className="insight-content">
          <div className="insight-block">
            <span>原文</span>
            <p>{selectionCard.text}</p>
          </div>

          {selectionCard.loading ? <p className="muted">正在生成翻译和解释...</p> : null}
          {selectionCard.error ? <p className="error-text">{selectionCard.error}</p> : null}

          {selectionCard.translation ? (
            <div className="insight-block">
              <span>翻译</span>
              <p>{selectionCard.translation}</p>
            </div>
          ) : null}

          {selectionCard.explanation ? (
            <div className="insight-block">
              <span>术语解释</span>
              <p>{selectionCard.explanation}</p>
            </div>
          ) : null}

          {selectionCard.keywords.length > 0 ? (
            <div className="keyword-row">
              {selectionCard.keywords.map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
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
