import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { getStoredAuthToken } from '../../services/authApi'

function buildPaperTitle(fileName) {
  if (!fileName) return '未打开文献'
  return fileName.replace(/\.pdf$/i, '')
}

const infoTabs = [
  { id: 'basic', label: '基本信息' },
  { id: 'references', label: '参考文献' },
  { id: 'citations', label: '引用线索' },
]

function displayValue(value) {
  return value || '未在 PDF 元数据中找到'
}

async function fetchReferences(doi) {
  const token = getStoredAuthToken()
  const response = await fetch(`/api/papers/references?doi=${encodeURIComponent(doi)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return response.json()
}

async function fetchCitations(doi) {
  const token = getStoredAuthToken()
  const response = await fetch(`/api/papers/citations?doi=${encodeURIComponent(doi)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return response.json()
}

function InfoPanel({ fileName, metadata }) {
  const [activeTab, setActiveTab] = useState('basic')
  const [cache, setCache] = useState({})
  const doi = metadata.doi || ''
  const refs = cache[`${doi}:refs`]
  const cites = cache[`${doi}:cites`]
  const paperTitle = useMemo(() => metadata.title || buildPaperTitle(fileName), [fileName, metadata.title])

  const updateCache = (suffix, value) => setCache((previous) => ({ ...previous, [`${doi}${suffix}`]: value }))

  useEffect(() => {
    if (activeTab !== 'references' || !doi || refs) return
    updateCache(':refs', { loading: true })
    fetchReferences(doi)
      .then((data) => updateCache(':refs', { loading: false, data: data?.references || [], source: data?.source || '' }))
      .catch(() => updateCache(':refs', { loading: false, data: [], source: '加载失败' }))
  }, [activeTab, doi, refs])

  useEffect(() => {
    if (activeTab !== 'citations' || !doi || cites) return
    updateCache(':cites', { loading: true })
    fetchCitations(doi)
      .then((data) => updateCache(':cites', { loading: false, data: data?.citations || [], source: data?.source || '' }))
      .catch(() => updateCache(':cites', { loading: false, data: [], source: '加载失败' }))
  }, [activeTab, cites, doi])

  return (
    <div className="workspace-panel__content">
      <div className="workspace-tabs">
        {infoTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`workspace-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'basic' ? (
        <div className="workspace-card-list">
          <div className="workspace-title-card">
            <h3>{paperTitle}</h3>
            <p>文献摘要：{displayValue(metadata.subject)}</p>
          </div>
          <div className="workspace-info-grid">
            <div><span>DOI</span><p>{displayValue(metadata.doi)}</p></div>
            <div><span>作者</span><p>{displayValue(metadata.author)}</p></div>
            <div><span>关键词</span><p>{displayValue(metadata.keywords)}</p></div>
            <div><span>页数 / 文件大小</span><p>{metadata.pageCount || '-'} 页{metadata.fileSize ? ` / ${metadata.fileSize}` : ''}</p></div>
            <div><span>创建工具</span><p>{displayValue(metadata.creator || metadata.producer)}</p></div>
            <div><span>创建 / 修改日期</span><p>{displayValue([metadata.creationDate, metadata.modificationDate].filter(Boolean).join(' / '))}</p></div>
          </div>
        </div>
      ) : null}

      {activeTab === 'references' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card workspace-ref-list">
            <h3>参考文献</h3>
            {!doi ? <p className="muted">该论文没有 DOI 信息。</p> : null}
            {doi && refs?.loading ? <p className="muted">正在获取...</p> : null}
            {doi && !refs?.loading && refs?.data?.length > 0 ? refs.data.map((reference, index) => (
              <p key={`${reference.title || 'ref'}:${index}`}>
                [{index + 1}] {reference.doi ? (
                  <a href={`https://doi.org/${reference.doi}`} target="_blank" rel="noopener" className="ref-link">
                    {reference.title}
                  </a>
                ) : reference.title}
                {reference.authors ? ` — ${reference.authors}` : ''}
                {reference.year ? ` (${reference.year})` : ''}
              </p>
            )) : null}
            {doi && !refs?.loading && (!refs?.data || refs.data.length === 0) ? <p className="muted">暂无参考文献数据。</p> : null}
            {refs?.source ? <p className="card-footnote">来源：{refs.source}</p> : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'citations' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card workspace-ref-list">
            <h3>引用线索</h3>
            {!doi ? <p className="muted">该论文没有 DOI 信息。</p> : null}
            {doi && cites?.loading ? <p className="muted">正在获取...</p> : null}
            {doi && !cites?.loading && cites?.data?.length > 0 ? cites.data.map((citation, index) => (
              <p key={`${citation.title || 'cite'}:${index}`}>
                [{index + 1}] {citation.doi ? (
                  <a href={`https://doi.org/${citation.doi}`} target="_blank" rel="noopener" className="ref-link">
                    {citation.title}
                  </a>
                ) : citation.title}
                {citation.authors ? ` — ${citation.authors}` : ''}
                {citation.year ? ` (${citation.year})` : ''}
              </p>
            )) : null}
            {doi && !cites?.loading && (!cites?.data || cites.data.length === 0) ? <p className="muted">暂无引用数据。</p> : null}
            {cites?.source ? <p className="card-footnote">来源：{cites.source}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NotesPanel({ noteText, onNoteChange }) {
  return (
    <div className="workspace-panel__content">
      <div className="workspace-title-card">
        <h3>阅读笔记</h3>
        <p>这里可以沉淀高亮片段、截图片段、批注内容和你的理解。</p>
      </div>
      <textarea
        className="workspace-textarea"
        placeholder="记录你的理解、方法拆解或实验疑问..."
        value={noteText || ''}
        onChange={(event) => onNoteChange?.(event.target.value)}
      />
    </div>
  )
}

function AskPanel({ currentUser, providerLabel, asking, messages, inputText, onInputChange, onSubmit, fileName }) {
  const listRef = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  useEffect(function () {
    if (messages.length > 0) return
    fetch("/api/suggest-questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: fileName || "" }) })
      .then(function(r) { return r.json() })
      .then(function(d) { if (d && d.questions) setSuggestions(d.questions) })
      .catch(function() {})
  }, [messages.length, fileName])
  const userInitials = (currentUser?.nickname || '我').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="workspace-panel__content ask-panel">
      <div className="ask-messages" ref={listRef}>
        {suggestions.length > 0 ? (
          <div className="ask-suggestions">
            {suggestions.map(function(q, idx) {
              return <button key={idx} className="ask-suggestion-chip" onClick={function() { onInputChange(q); setTimeout(function() { onSubmit(q) }, 50) }}>{q}</button>
            })}
          </div>
        ) : null}
        {messages.length === 0 ? <p className="muted" style={{ textAlign: 'center', padding: 20 }}>向 AI 提问这篇论文的任何问题</p> : null}
        {messages.map((message, index) => (
          <div key={index} className={`ask-msg ${message.role === 'user' ? 'ask-msg-user' : 'ask-msg-ai'}`}>
            <div className="ask-avatar">
              {message.role === 'user'
                ? (currentUser?.avatar_url
                  ? <img src={currentUser.avatar_url} alt={currentUser.nickname || '用户'} />
                  : <span>{userInitials}</span>)
                : <Bot size={16} />}
            </div>
            <div className="ask-bubble">{message.text || (asking && message.role === 'ai' ? <span className="ask-typing">...</span> : '')}</div>
          </div>
        ))}
        {asking && !messages.some((message) => message.role === 'ai' && !message.text) ? <div className="ask-msg ask-msg-ai"><div className="ask-avatar"><Bot size={16} /></div><div className="ask-bubble"><span className="ask-typing">...</span></div></div> : null}
      </div>
      <div className="ask-input-row">
        <textarea
          className="ask-input"
          placeholder="输入问题，Enter 发送"
          value={inputText || ''}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
          rows={1}
        />
        <button className="ask-send-btn" onClick={onSubmit} disabled={asking || !(inputText || '').trim()}>
          发送
        </button>
      </div>
      {providerLabel ? <div className="ask-provider">AI: {providerLabel}</div> : null}
    </div>
  )
}

function FullTranslatePanel() {
  return (
    <div className="workspace-panel__content">
      <div className="workspace-title-card"><h3>全文翻译</h3><p>这里后续可以放整篇论文的连续译文。</p></div>
      <div className="workspace-list-card"><p>当前先保留入口和面板结构。</p></div>
    </div>
  )
}

export function SideWorkspacePanel({
  activePanel,
  fileName,
  metadata,
  currentUser,
  selectionCard,
  width,
  chatMessages,
  chatInput,
  chatAsking,
  providerLabel,
  noteText,
  onNoteChange,
  onChatInputChange,
  onChatSubmit,
}) {
  if (!activePanel) return null

  return (
    <aside className="workspace-panel" style={{ width }}>
      {activePanel === 'info' ? <InfoPanel fileName={fileName} metadata={metadata} /> : null}
      {activePanel === 'notes' ? <NotesPanel noteText={noteText} onNoteChange={onNoteChange} /> : null}
      {activePanel === 'ask' ? (
        <AskPanel
          currentUser={currentUser}
          selectionCard={selectionCard}
          providerLabel={providerLabel}
          messages={chatMessages || []}
          inputText={chatInput || ''}
          asking={chatAsking || false}
          onInputChange={onChatInputChange}
          onSubmit={() => onChatSubmit(chatInput)}
        />
      ) : null}
      {activePanel === 'words' ? <FullTranslatePanel /> : null}
    </aside>
  )
}
