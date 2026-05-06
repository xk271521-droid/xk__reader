import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  FileDown,
  Image as ImageIcon,
  LocateFixed,
  NotebookPen,
  Plus,
  Save,
  Trash2,
  Type,
} from 'lucide-react'
import { getStoredAuthToken } from '../../services/authApi'
import {
  addChildNode,
  addRootNode,
  addTextBlock,
  buildNodeChildren,
  deleteBlock,
  deleteNode,
  deleteNotebook,
  toggleNotebookCollapsed,
  updateBlockContent,
  updateNodeTitle,
  updateNotebookTitle,
  updateNotebookById,
  toggleNodeCollapsed,
} from './noteTree'

function buildPaperTitle(fileName) {
  if (!fileName) return 'Untitled paper'
  return fileName.replace(/\.pdf$/i, '')
}

const infoTabs = [
  { id: 'basic', label: '基本信息' },
  { id: 'references', label: '参考文献' },
  { id: 'citations', label: '被引文献' },
]

function displayValue(value) {
  return value || 'PDF 元数据中未识别'
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
      .catch(() => updateCache(':refs', { loading: false, data: [], source: 'Load failed' }))
  }, [activeTab, doi, refs])

  useEffect(() => {
    if (activeTab !== 'citations' || !doi || cites) return
    updateCache(':cites', { loading: true })
    fetchCitations(doi)
      .then((data) => updateCache(':cites', { loading: false, data: data?.citations || [], source: data?.source || '' }))
      .catch(() => updateCache(':cites', { loading: false, data: [], source: 'Load failed' }))
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
            <p>主题摘要：{displayValue(metadata.subject)}</p>
          </div>
          <div className="workspace-info-grid">
            <div><span>DOI</span><p>{displayValue(metadata.doi)}</p></div>
            <div><span>作者</span><p>{displayValue(metadata.author)}</p></div>
            <div><span>关键词</span><p>{displayValue(metadata.keywords)}</p></div>
            <div><span>页数 / 大小</span><p>{metadata.pageCount || '-'} 页{metadata.fileSize ? ` / ${metadata.fileSize}` : ''}</p></div>
            <div><span>生成工具</span><p>{displayValue(metadata.creator || metadata.producer)}</p></div>
            <div><span>创建 / 修改</span><p>{displayValue([metadata.creationDate, metadata.modificationDate].filter(Boolean).join(' / '))}</p></div>
          </div>
        </div>
      ) : null}

      {activeTab === 'references' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card workspace-ref-list">
            <h3>参考文献</h3>
            {!doi ? <p className="muted">这篇文献暂未识别 DOI。</p> : null}
            {doi && refs?.loading ? <p className="muted">加载中...</p> : null}
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
            {doi && !refs?.loading && (!refs?.data || refs.data.length === 0) ? <p className="muted">暂未获取到参考文献数据。</p> : null}
            {refs?.source ? <p className="card-footnote">来源：{refs.source}</p> : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'citations' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card workspace-ref-list">
            <h3>被引文献</h3>
            {!doi ? <p className="muted">这篇文献暂未识别 DOI。</p> : null}
            {doi && cites?.loading ? <p className="muted">加载中...</p> : null}
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
            {doi && !cites?.loading && (!cites?.data || cites.data.length === 0) ? <p className="muted">暂未获取到被引数据。</p> : null}
            {cites?.source ? <p className="card-footnote">来源：{cites.source}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AutoGrowTextarea({ className, value, placeholder, onChange, onFocus }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = `${Math.max(34, ref.current.scrollHeight)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      className={className}
      placeholder={placeholder}
      rows={1}
      value={value || ''}
      onChange={onChange}
      onFocus={onFocus}
    />
  )
}

function NotesPanel({
  notebooks,
  loading,
  saving,
  activeTarget,
  onCreateNotebook,
  onDraftChange,
  onSaveNotebooks,
  onSetActiveTarget,
  onJumpToNote,
}) {
  function changeDraft(updater) {
    onDraftChange?.(updater(notebooks || []))
  }

  function touchTarget(notebookId, nodeId, blockId = null) {
    onSetActiveTarget?.({ notebookId, nodeId, blockId })
  }

  function renderIconButton(label, icon, onClick, disabled = false) {
    return (
      <button
        type="button"
        className="notes-icon-button"
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onClick?.()
        }}
      >
        {icon}
      </button>
    )
  }

  function renderBlock(notebookId, nodeId, block) {
    const isActive = activeTarget?.notebookId === notebookId
      && activeTarget?.nodeId === nodeId
      && activeTarget?.blockId === block.id

    return (
      <div
        key={block.id}
        className={`note-text-tree-block note-text-tree-block--${block.type}${isActive ? ' is-active' : ''}`}
        onClick={() => touchTarget(notebookId, nodeId, block.id)}
      >
        {block.type === 'text' ? (
          <AutoGrowTextarea
            className="note-text-tree-textarea"
            placeholder="写下你的想法..."
            value={block.content || ''}
            onFocus={() => touchTarget(notebookId, nodeId, block.id)}
            onChange={(event) => {
              const value = event.target.value
              changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
                updateBlockContent(notebook, nodeId, block.id, value),
              ))
            }}
          />
        ) : null}

        {block.type === 'quote' ? (
          <div className="note-text-tree-quote">
            {block.page_number ? (
              <button
                type="button"
                className="note-source-link"
                title="定位原文"
                aria-label="定位原文"
                onClick={(event) => {
                  event.stopPropagation()
                  onJumpToNote?.(block)
                }}
              >
                <LocateFixed size={13} />
              </button>
            ) : null}
            <p>{block.content || '原文引用'}</p>
          </div>
        ) : null}

        {block.type === 'image' ? (
          <div className="note-text-tree-image">
            {block.page_number ? (
              <button
                type="button"
                className="note-source-link"
                title="定位原文"
                aria-label="定位原文"
                onClick={(event) => {
                  event.stopPropagation()
                  onJumpToNote?.(block)
                }}
              >
                <LocateFixed size={13} />
              </button>
            ) : null}
            {block.image_url ? (
              <img src={block.image_url} alt="笔记截图" />
            ) : (
              <div className="note-image-placeholder"><ImageIcon size={16} /> 图片</div>
            )}
          </div>
        ) : null}

        <div className="note-text-tree-block__actions">
          {renderIconButton('删除', <Trash2 size={14} />, () => {
            changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
              deleteBlock(notebook, nodeId, block.id),
            ))
          })}
        </div>
      </div>
    )
  }

  function renderNodeTree(notebookId, treeNodes) {
    return treeNodes.map((node) => {
      const isActive = activeTarget?.notebookId === notebookId && activeTarget?.nodeId === node.id
      return (
        <div
          key={node.id}
          className={`note-text-tree-node note-text-tree-node--level-${node.level}${isActive ? ' is-active' : ''}`}
        >
          <div
            className="note-text-tree-row"
            onClick={() => touchTarget(notebookId, node.id)}
          >
            <button
              type="button"
              className="note-tree-toggle"
              title={node.collapsed ? '展开' : '收起'}
              aria-label={node.collapsed ? '展开' : '收起'}
              onClick={(event) => {
                event.stopPropagation()
                changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
                  toggleNodeCollapsed(notebook, node.id),
                ))
              }}
            >
              {node.collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {node.level === 1 ? (
              <span className={`note-tree-index color-${(node.color_index || 0) % 6}`}>{node.sort_order + 1}</span>
            ) : (
              <span className="note-tree-dot" />
            )}

            <input
              className="note-tree-title-input"
              value={node.title || ''}
              size={Math.max(4, Math.min(24, (node.title || '').length + 1))}
              onFocus={() => touchTarget(notebookId, node.id)}
              onChange={(event) => {
                const value = event.target.value
                changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
                  updateNodeTitle(notebook, node.id, value),
                ))
              }}
            />

            <div className="note-text-tree-actions">
              {node.level < 3 ? renderIconButton('添加子标题', <Plus size={14} />, () => {
                changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
                  addChildNode(notebook, node.id),
                ))
              }) : null}
              {renderIconButton('添加文本', <Type size={14} />, () => {
                changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
                  addTextBlock(notebook, node.id),
                ))
                touchTarget(notebookId, node.id)
              })}
              {renderIconButton('删除', <Trash2 size={14} />, () => {
                changeDraft((current) => updateNotebookById(current, notebookId, (notebook) =>
                  deleteNode(notebook, node.id),
                ))
              })}
            </div>
          </div>

          {!node.collapsed ? (
            <div className="note-text-tree-content">
              {node.blocks?.map((block) => renderBlock(notebookId, node.id, block))}
              {node.children?.length ? <div className="note-text-tree-children">{renderNodeTree(notebookId, node.children)}</div> : null}
            </div>
          ) : null}
        </div>
      )
    })
  }

  return (
    <div className="workspace-panel__content notes-workspace">
      <div className="notes-topbar">
        <button type="button" className="notes-command" onClick={() => onCreateNotebook?.('blank')}>
          <NotebookPen size={15} />
          <span>新建</span>
        </button>
        <button type="button" className="notes-command" onClick={() => onCreateNotebook?.('default')}>
          <Plus size={15} />
          <span>模板</span>
        </button>
        <button type="button" className="notes-command is-primary" onClick={() => onSaveNotebooks?.(notebooks || [])} disabled={saving}>
          <Save size={15} />
          <span>{saving ? '保存中' : '保存'}</span>
        </button>
        <button type="button" className="notes-command" disabled title="后续开放">
          <FileDown size={15} />
          <span>导出</span>
        </button>
      </div>

      <div className="notes-text-tree-shell">
        {loading ? <p className="muted">正在加载笔记...</p> : null}
        {!loading && (notebooks || []).length === 0 ? (
          <div className="notes-empty-state">
            <NotebookPen size={18} />
            <p>新建一个笔记本，开始整理这篇文献。</p>
          </div>
        ) : null}

        {(notebooks || []).map((notebook, notebookIndex) => (
          <section key={notebook.id || notebookIndex} className="note-notebook">
            <div className="note-notebook__row">
              <button
                type="button"
                className="note-tree-toggle"
                title={notebook.collapsed ? '展开' : '收起'}
                aria-label={notebook.collapsed ? '展开' : '收起'}
                onClick={() => {
                  changeDraft((current) => toggleNotebookCollapsed(current, notebook.id))
                }}
              >
                {notebook.collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              <input
                className="note-notebook__title"
                value={notebook.title || ''}
                size={Math.max(6, Math.min(24, (notebook.title || '').length + 1))}
                onChange={(event) => {
                  const value = event.target.value
                  changeDraft((current) => updateNotebookTitle(current, notebook.id, value))
                }}
              />
              <div className="note-text-tree-actions">
                {renderIconButton('添加一级标题', <Plus size={14} />, () => {
                  changeDraft((current) => updateNotebookById(current, notebook.id, (item) =>
                    addRootNode(item, item.nodes.filter((node) => node.level === 1).length),
                  ))
                })}
                {renderIconButton('删除笔记本', <Trash2 size={14} />, () => {
                  changeDraft((current) => deleteNotebook(current, notebook.id))
                })}
              </div>
            </div>

            {!notebook.collapsed ? (
              <div className="note-notebook__tree">
                {renderNodeTree(notebook.id, buildNodeChildren(notebook.nodes || [], null))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  )
}

function AskPanel({ currentUser, providerLabel, asking, messages, inputText, onInputChange, onSubmit, fileName }) {
  const listRef = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  const userInitials = (currentUser?.nickname || '我').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (messages.length > 0) return
    fetch('/api/suggest-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: fileName || '' }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.questions) setSuggestions(data.questions)
      })
      .catch(() => {})
  }, [fileName, messages.length])

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
            {suggestions.map((question, index) => (
              <button key={index} className="ask-suggestion-chip" onClick={() => { onInputChange(question); setTimeout(() => onSubmit(question), 50) }}>{question}</button>
            ))}
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
        {asking && !messages.some((message) => message.role === 'ai' && !message.text) ? (
          <div className="ask-msg ask-msg-ai">
            <div className="ask-avatar"><Bot size={16} /></div>
            <div className="ask-bubble"><span className="ask-typing">...</span></div>
          </div>
        ) : null}
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
      <div className="workspace-title-card">
        <h3>全文翻译</h3>
        <p>这里后续可以放整篇论文的连续译文。</p>
      </div>
      <div className="workspace-list-card">
        <p>当前先保留入口和面板结构。</p>
      </div>
    </div>
  )
}

function AskPanelV2({ currentUser, providerLabel, asking, messages, inputText, onInputChange, onSubmit, fileName }) {
  const listRef = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  const userInitials = (currentUser?.nickname || '我').slice(0, 2).toUpperCase()
  const shortTitle = buildPaperTitle(fileName || '')

  useEffect(() => {
    if (messages.length > 0) return
    fetch('/api/suggest-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: fileName || '' }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.questions) setSuggestions(data.questions)
      })
      .catch(() => {})
  }, [fileName, messages.length])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="workspace-panel__content ask-panel ask-panel--pro">
      <div className="ask-hero">
        <div>
          <span className="ask-hero__eyebrow">AI Research Copilot</span>
          <h3>边读边问</h3>
          <p>{shortTitle || '当前文献'}</p>
        </div>
        <div className="ask-hero__orb">
          <Bot size={18} />
        </div>
      </div>

      <div className="ask-context">
        <span className="ask-context__dot" />
        <span>{providerLabel ? `当前模型：${providerLabel}` : 'AI 模型准备中'}</span>
      </div>

      <div className="ask-messages" ref={listRef}>
        {suggestions.length > 0 ? (
          <div className="ask-suggestions">
            {suggestions.map((question, index) => (
              <button
                key={index}
                type="button"
                className="ask-suggestion-chip"
                onClick={() => {
                  onInputChange(question)
                  setTimeout(() => onSubmit(question), 50)
                }}
              >
                {question}
              </button>
            ))}
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="ask-empty">
            <Bot size={22} />
            <strong>可以直接问这篇文献</strong>
            <span>例如研究问题、方法创新、实验结论、局限性。</span>
          </div>
        ) : null}

        {messages.map((message, index) => (
          <div key={index} className={`ask-msg ${message.role === 'user' ? 'ask-msg-user' : 'ask-msg-ai'}`}>
            <div className="ask-avatar">
              {message.role === 'user'
                ? (currentUser?.avatar_url
                  ? <img src={currentUser.avatar_url} alt={currentUser.nickname || '用户'} />
                  : <span>{userInitials}</span>)
                : <Bot size={16} />}
            </div>
            <div className="ask-bubble">
              {message.text || (asking && message.role === 'ai' ? <span className="ask-typing">...</span> : '')}
            </div>
          </div>
        ))}

        {asking && !messages.some((message) => message.role === 'ai' && !message.text) ? (
          <div className="ask-msg ask-msg-ai">
            <div className="ask-avatar"><Bot size={16} /></div>
            <div className="ask-bubble"><span className="ask-typing">...</span></div>
          </div>
        ) : null}
      </div>

      <div className="ask-input-row">
        <textarea
          className="ask-input"
          placeholder="输入问题，Enter 发送，Shift + Enter 换行"
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
    </div>
  )
}

function FullTranslatePanelV2() {
  return (
    <div className="workspace-panel__content">
      <div className="workspace-title-card">
        <h3>全文翻译</h3>
        <p>这里后续放整篇论文的连续译文。</p>
      </div>
      <div className="workspace-list-card">
        <p>当前先保留入口和面板结构。</p>
      </div>
    </div>
  )
}

function SummaryPanel() {
  return (
    <div className="workspace-panel__content summary-panel">
      <div className="workspace-title-card summary-panel__hero">
        <span>AI Summary</span>
        <h3>文献总结</h3>
        <p>后续这里会生成研究背景、核心方法、实验结论、创新点和局限性。</p>
      </div>
      <div className="workspace-list-card summary-panel__placeholder">
        <h3>总结入口已就绪</h3>
        <p>本版先展示工作区，下一步可以接入流式总结、保存到阅读笔记、生成脑图。</p>
      </div>
    </div>
  )
}

export function SideWorkspacePanel({
  activePanel,
  fileName,
  metadata,
  currentUser,
  width,
  notebooks,
  notesLoading,
  notesSaving,
  onCreateNotebook,
  onDraftChange,
  onSaveNotebooks,
  activeNoteTarget,
  onSetActiveNoteTarget,
  onJumpToNote,
  chatMessages,
  chatInput,
  chatAsking,
  providerLabel,
  onChatInputChange,
  onChatSubmit,
}) {
  if (!activePanel) return null

  return (
    <aside className="workspace-panel" style={{ width }}>
      {activePanel === 'info' ? <InfoPanel fileName={fileName} metadata={metadata} /> : null}
      {activePanel === 'notes' ? (
        <NotesPanel
          notebooks={notebooks || []}
          loading={notesLoading}
          saving={notesSaving}
          activeTarget={activeNoteTarget}
          onCreateNotebook={onCreateNotebook}
          onDraftChange={onDraftChange}
          onSaveNotebooks={onSaveNotebooks}
          onSetActiveTarget={onSetActiveNoteTarget}
          onJumpToNote={onJumpToNote}
        />
      ) : null}
      {activePanel === 'ask' ? (
        <AskPanelV2
          currentUser={currentUser}
          providerLabel={providerLabel}
          messages={chatMessages || []}
          inputText={chatInput || ''}
          asking={chatAsking || false}
          onInputChange={onChatInputChange}
          onSubmit={() => onChatSubmit(chatInput)}
          fileName={fileName}
        />
      ) : null}
      {activePanel === 'words' ? <FullTranslatePanelV2 /> : null}
      {activePanel === 'summary' ? <SummaryPanel /> : null}
    </aside>
  )
}
