
import { ChevronDown, PanelRightClose } from 'lucide-react'
import './SelectionInsightPanel.css'

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

export function SelectionInsightPanel({
  selectionCard,
  width,
  translationProvider,
  onTranslationProviderChange,
  followTranslationEnabled,
  onFollowTranslationEnabledChange,
  onCollapse,
  onOpenAiConfig,
}) {
  return (
    <aside className="insight-panel" style={{ width }}>
      <div className="insight-panel__header">
        <div className="insight-panel__heading">
          <p className="panel-label">划词结果</p>
          <h2>即时理解</h2>
        </div>
        <div className="insight-panel__actions">
          <div className="insight-panel__provider-select">
            <select
              aria-label="选择翻译服务"
              className="insight-translation-provider"
              onChange={(event) => onTranslationProviderChange(event.target.value)}
              title="选择翻译服务"
              value={translationProvider}
              >
                <option value="baidu">百度翻译</option>
                <option value="tencent">腾讯翻译</option>
                <option value="siliconflow_glm4">GLM-4</option>
                <option value="siliconflow_qwen3">Qwen3</option>
                <option value="siliconflow_glmz1">GLM-Z1</option>
                <option value="siliconflow_hunyuan">Hunyuan</option>
              </select>
            <ChevronDown aria-hidden="true" className="insight-panel__provider-chevron" />
          </div>
          <div className="insight-panel__follow-row">
            <label className="insight-follow-toggle" title="选词后在原文附近显示译文">
              <span>跟随</span>
              <input
                aria-label="开启跟随翻译浮层"
                checked={followTranslationEnabled}
                onChange={(event) => onFollowTranslationEnabledChange(event.target.checked)}
                type="checkbox"
              />
              <i aria-hidden="true" />
            </label>
            <button
              aria-label="隐藏即时理解面板"
              className="insight-panel__collapse-button"
              onClick={onCollapse}
              title="隐藏即时理解面板"
              type="button"
            >
              <PanelRightClose aria-hidden="true" />
            </button>
          </div>
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
            <span className="insight-meta-chip insight-meta-chip--words">{selectionCard.wordCount} words</span>
            <span className="insight-meta-chip insight-meta-chip--chars">{selectionCard.charCount} chars</span>
            <span className="insight-meta-chip insight-meta-chip--kind">{getTextKindLabel(selectionCard.textKind)}</span>
          </div>

          {selectionCard.loading ? (
            <div className="insight-status-card">
              <p className="muted">正在生成即时理解，请稍等片刻...</p>
            </div>
          ) : null}

          {selectionCard.error ? (
            <div className="insight-status-card insight-status-card--error">
              <p className="error-text">{selectionCard.error}</p>
              {selectionCard.error.includes('未配置百度翻译') && onOpenAiConfig ? (
                <button
                  type="button"
                  className="insight-config-link-btn"
                  onClick={onOpenAiConfig}
                >
                  前往配置百度翻译 API
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="insight-block insight-block--source">
            <div className="insight-block__title-row">
              <span>原文片段</span>
              <button type="button" onClick={() => copyText(selectionCard.text)}>
                复制原文
              </button>
            </div>
            <p>{selectionCard.text}</p>
          </div>

          {selectionCard.translation ? (
            <div className="insight-block insight-block--translation">
              <div className="insight-block__title-row">
                <span>即时翻译</span>
                <button type="button" onClick={() => copyText(selectionCard.translation)}>
                  复制译文
                </button>
              </div>
              <p>{selectionCard.translation}</p>
            </div>
          ) : null}

        </div>
      ) : null}
    </aside>
  )
}
