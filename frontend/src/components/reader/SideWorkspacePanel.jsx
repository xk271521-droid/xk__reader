import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bold,
  Bot,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileText,
  FlaskConical,
  Highlighter,
  Image as ImageIcon,
  Layers3,
  LocateFixed,
  Loader2,
  Minus,
  NotebookPen,
  Palette,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Sparkles,
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
import {
  DEFAULT_NOTE_TEXT_COLOR,
  NOTE_TEXT_COLORS,
  applyColorToRichText,
  buildRichTextSegments,
  inferRichTextEdit,
  normalizeNoteColor,
  parseRichNoteContent,
  serializeRichNoteContent,
} from './richNoteContent'

function buildPaperTitle(fileName) {
  if (!fileName) return 'Untitled paper'
  return fileName.replace(/\.pdf$/i, '')
}

function buildCompactModelLabel(providerLabel) {
  if (!providerLabel) return '模型准备中'
  const parts = String(providerLabel)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  const rawLabel = parts[1] || parts[0] || ''
  return rawLabel.replace(/^智谱\s*/i, '').replace(/\s*\(官方\)\s*/g, '').trim() || '模型已连接'
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
                {reference.authors ? ` 鈥?${reference.authors}` : ''}
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
            <h3>琚紩鏂囩尞</h3>
            {!doi ? <p className="muted">这篇文献暂未识别 DOI。</p> : null}
            {doi && cites?.loading ? <p className="muted">加载中...</p> : null}
            {doi && !cites?.loading && cites?.data?.length > 0 ? cites.data.map((citation, index) => (
              <p key={`${citation.title || 'cite'}:${index}`}>
                [{index + 1}] {citation.doi ? (
                  <a href={`https://doi.org/${citation.doi}`} target="_blank" rel="noopener" className="ref-link">
                    {citation.title}
                  </a>
                ) : citation.title}
                {citation.authors ? ` 鈥?${citation.authors}` : ''}
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

const NOTE_FONT_SIZES = {
  '-2': 12.5,
  '-1': 13.25,
  0: 14,
  1: 15.25,
  2: 16.5,
  3: 18,
  4: 19.5,
}

const NOTE_WEIGHT_STEPS = {
  '-1': {
    body: 390,
    subheading: 450,
    heading: 640,
    notebook: 660,
  },
  0: {
    body: 430,
    subheading: 500,
    heading: 700,
    notebook: 720,
  },
  1: {
    body: 540,
    subheading: 600,
    heading: 800,
    notebook: 820,
  },
}

function clampNoteStep(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0))
}

function buildNotePrefsKey(paperId) {
  return `xk_note_style:${paperId || 'global'}`
}

function readNotePrefs(paperId) {
  const fallback = {
    color: DEFAULT_NOTE_TEXT_COLOR,
    fontScale: 0,
    weightLevel: 1,
  }
  try {
    const raw = window.localStorage.getItem(buildNotePrefsKey(paperId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return {
      color: normalizeNoteColor(parsed?.color),
      fontScale: clampNoteStep(parsed?.fontScale, -2, 4),
      weightLevel: Number(parsed?.weightLevel) === -1 ? -1 : 1,
    }
  } catch (_) {
    return fallback
  }
}

function writeNotePrefs(paperId, prefs) {
  try {
    window.localStorage.setItem(buildNotePrefsKey(paperId), JSON.stringify({
      color: normalizeNoteColor(prefs?.color),
      fontScale: clampNoteStep(prefs?.fontScale, -2, 4),
      weightLevel: Number(prefs?.weightLevel) === -1 ? -1 : 1,
    }))
  } catch (_) {}
}

function buildNotesStyle(prefs) {
  const fontScale = clampNoteStep(prefs?.fontScale, -2, 4)
  const weightLevel = Number(prefs?.weightLevel) === -1 ? -1 : 1
  const weights = NOTE_WEIGHT_STEPS[weightLevel] || NOTE_WEIGHT_STEPS[0]
  const bodySize = NOTE_FONT_SIZES[fontScale] || NOTE_FONT_SIZES[0]

  return {
    '--note-body-size': `${bodySize}px`,
    '--note-small-size': `${Math.max(11.5, bodySize - 1)}px`,
    '--note-title-size': `${bodySize + 1}px`,
    '--note-body-weight': weights.body,
    '--note-subheading-weight': weights.subheading,
    '--note-heading-weight': weights.heading,
    '--note-notebook-weight': weights.notebook,
  }
}

function getEditorText(editor) {
  return (editor?.textContent || '').replace(/\u00a0/g, ' ')
}

function nodeContains(root, node) {
  return Boolean(root && node && (root === node || root.contains(node)))
}

function getTextOffset(root, targetNode, targetOffset) {
  if (!root || !targetNode) return 0

  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()

  while (current) {
    if (current === targetNode) {
      return offset + Math.min(targetOffset, current.textContent.length)
    }
    offset += current.textContent.length
    current = walker.nextNode()
  }

  if (targetNode === root) {
    const children = Array.from(root.childNodes).slice(0, targetOffset)
    return children.reduce((total, child) => total + (child.textContent || '').length, 0)
  }

  return offset
}

function getSelectionOffsets(root) {
  const selection = window.getSelection()
  if (!root || !selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!nodeContains(root, range.startContainer) || !nodeContains(root, range.endContainer)) {
    return null
  }

  const start = getTextOffset(root, range.startContainer, range.startOffset)
  const end = getTextOffset(root, range.endContainer, range.endOffset)
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  }
}

function findNodeAtTextOffset(root, targetOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  let offset = 0

  while (current) {
    const length = current.textContent.length
    if (targetOffset <= offset + length) {
      return {
        node: current,
        offset: Math.max(0, Math.min(length, targetOffset - offset)),
      }
    }
    offset += length
    current = walker.nextNode()
  }

  return {
    node: root,
    offset: root.childNodes.length,
  }
}

function restoreEditorSelection(root, start, end = start) {
  if (!root) return
  const selection = window.getSelection()
  if (!selection) return

  const startPoint = findNodeAtTextOffset(root, start)
  const endPoint = findNodeAtTextOffset(root, end)
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  selection.removeAllRanges()
  selection.addRange(range)
  root.focus()
}

function getTextareaSelection(textarea) {
  if (!textarea) return null
  return {
    start: textarea.selectionStart || 0,
    end: textarea.selectionEnd || textarea.selectionStart || 0,
  }
}

function RichTextBlockEditor({
  value,
  active,
  inputColor,
  colorCommand,
  onChange,
  onFocus,
}) {
  const textareaRef = useRef(null)
  const docRef = useRef(parseRichNoteContent(value))
  const lastSelectionRef = useRef({ start: 0, end: 0 })
  const lastColorCommandRef = useRef(0)
  const [focused, setFocused] = useState(false)
  const doc = useMemo(() => parseRichNoteContent(value), [value])
  const segments = useMemo(() => buildRichTextSegments(doc), [doc])

  useEffect(() => {
    docRef.current = doc
  }, [doc])

  useEffect(() => {
    if (!active || !colorCommand?.id || colorCommand.id === lastColorCommandRef.current) return
    lastColorCommandRef.current = colorCommand.id
    const selection = getTextareaSelection(textareaRef.current) || lastSelectionRef.current
    if (!selection || selection.end <= selection.start) return

    const nextDoc = applyColorToRichText(docRef.current, selection.start, selection.end, colorCommand.color)
    docRef.current = nextDoc
    lastSelectionRef.current = selection
    onChange?.(serializeRichNoteContent(nextDoc))
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.selectionStart = selection.start
      textareaRef.current.selectionEnd = selection.end
    })
  }, [active, colorCommand, onChange])

  function rememberSelection() {
    lastSelectionRef.current = getTextareaSelection(textareaRef.current) || lastSelectionRef.current
  }

  function handleChange(event) {
    const textarea = event.currentTarget
    const nextDoc = inferRichTextEdit(docRef.current, textarea.value, inputColor)
    docRef.current = nextDoc
    lastSelectionRef.current = getTextareaSelection(textarea)
    onChange?.(serializeRichNoteContent(nextDoc))
  }

  const hasStyledText = doc.ranges.length > 0
  const showEditor = focused || !hasStyledText

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !showEditor) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.max(34, textarea.scrollHeight)}px`
  }, [doc.text, showEditor])

  return (
    <div
      className="note-rich-editor-shell"
      role="textbox"
      aria-multiline="true"
      onMouseDown={() => {
        if (showEditor) return
        setFocused(true)
        onFocus?.()
        requestAnimationFrame(() => textareaRef.current?.focus())
      }}
    >
      {showEditor ? (
        <textarea
          ref={textareaRef}
          className="note-rich-editor"
          placeholder="写下你的想法..."
          rows={1}
          value={doc.text}
          spellCheck={false}
          style={{ color: inputColor }}
          onFocus={() => {
            setFocused(true)
            onFocus?.()
            rememberSelection()
          }}
          onBlur={() => {
            rememberSelection()
            setFocused(false)
          }}
          onChange={handleChange}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
        />
      ) : (
        <div className="note-rich-preview">
          {segments.map((segment, index) => (
            <span
              key={`${index}:${segment.color}:${segment.text}`}
              style={segment.color !== DEFAULT_NOTE_TEXT_COLOR ? { color: segment.color } : undefined}
            >
              {segment.text}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function AutoGrowTextarea({ className, value, placeholder, onChange, onFocus, onKeyDown }) {
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
      onKeyDown={onKeyDown}
    />
  )
}

function NotesPanel({
  paperId,
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
  const [prefs, setPrefs] = useState(() => readNotePrefs(paperId))
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const [colorCommand, setColorCommand] = useState(null)
  const notesStyle = useMemo(() => buildNotesStyle(prefs), [prefs])

  useEffect(() => {
    setPrefs(readNotePrefs(paperId))
    setColorMenuOpen(false)
  }, [paperId])

  useEffect(() => {
    writeNotePrefs(paperId, prefs)
  }, [paperId, prefs])

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

  function updatePrefs(updater) {
    setPrefs((current) => {
      const next = updater(current)
      return {
        color: normalizeNoteColor(next.color),
        fontScale: clampNoteStep(next.fontScale, -2, 4),
        weightLevel: Number(next.weightLevel) === -1 ? -1 : 1,
      }
    })
  }

  function chooseColor(color) {
    const normalized = normalizeNoteColor(color)
    updatePrefs((current) => ({ ...current, color: normalized }))
    setColorCommand({ id: Date.now(), color: normalized })
    setColorMenuOpen(false)
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
          <RichTextBlockEditor
            value={block.content || ''}
            active={isActive}
            inputColor={prefs.color}
            colorCommand={colorCommand}
            onFocus={() => touchTarget(notebookId, nodeId, block.id)}
            onChange={(value) => {
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
                title="瀹氫綅鍘熸枃"
                aria-label="瀹氫綅鍘熸枃"
                onClick={(event) => {
                  event.stopPropagation()
                  onJumpToNote?.(block)
                }}
              >
                <LocateFixed size={13} />
              </button>
            ) : null}
            <p>{block.content || '鍘熸枃寮曠敤'}</p>
          </div>
        ) : null}

        {block.type === 'image' ? (
          <div className="note-text-tree-image">
            {block.page_number ? (
              <button
                type="button"
                className="note-source-link"
                title="瀹氫綅鍘熸枃"
                aria-label="瀹氫綅鍘熸枃"
                onClick={(event) => {
                  event.stopPropagation()
                  onJumpToNote?.(block)
                }}
              >
                <LocateFixed size={13} />
              </button>
            ) : null}
            {block.image_url ? (
              <img src={block.image_url} alt="绗旇鎴浘" />
            ) : (
              <div className="note-image-placeholder"><ImageIcon size={16} /> 鍥剧墖</div>
            )}
          </div>
        ) : null}

        <div className="note-text-tree-block__actions">
          {renderIconButton('鍒犻櫎', <Trash2 size={14} />, () => {
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
              title={node.collapsed ? '灞曞紑' : '鏀惰捣'}
              aria-label={node.collapsed ? '灞曞紑' : '鏀惰捣'}
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
    <div className="workspace-panel__content notes-workspace" style={notesStyle}>
      <div className="notes-topbar">
        <div className="notes-topbar__main">
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
        </div>

        <div className="notes-format-toolbar" aria-label="笔记排版工具">
          <div className="notes-color-picker">
            <button
              type="button"
              className="notes-command notes-command--square"
              title="字体颜色"
              aria-label="字体颜色"
              aria-expanded={colorMenuOpen}
              onClick={() => setColorMenuOpen((current) => !current)}
            >
              <Palette size={15} />
              <span className="notes-color-dot" style={{ background: prefs.color }} />
            </button>

            {colorMenuOpen ? (
              <div className="notes-color-popover" role="menu" aria-label="选择字体颜色">
                {NOTE_TEXT_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    className={`notes-color-swatch${prefs.color === color.value ? ' is-active' : ''}`}
                    title={color.label}
                    aria-label={color.label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseColor(color.value)}
                  >
                    <span style={{ background: color.value }} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="notes-command notes-command--square"
            title="缩小字体"
            aria-label="缩小字体"
            disabled={prefs.fontScale <= -2}
            onClick={() => updatePrefs((current) => ({ ...current, fontScale: current.fontScale - 1 }))}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="notes-command notes-command--square"
            title="放大字体"
            aria-label="放大字体"
            disabled={prefs.fontScale >= 4}
            onClick={() => updatePrefs((current) => ({ ...current, fontScale: current.fontScale + 1 }))}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className={`notes-command notes-command--square${prefs.weightLevel >= 1 ? ' is-bold' : ''}`}
            title={prefs.weightLevel >= 1 ? '整体变细' : '整体变粗'}
            aria-label={prefs.weightLevel >= 1 ? '整体变细' : '整体变粗'}
            aria-pressed={prefs.weightLevel >= 1}
            onClick={() => updatePrefs((current) => ({ ...current, weightLevel: current.weightLevel >= 1 ? -1 : 1 }))}
          >
            <Bold size={14} strokeWidth={prefs.weightLevel >= 1 ? 2.8 : 1.5} />
          </button>
        </div>
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

function AskPanel({
  currentUser,
  providerLabel,
  asking,
  messages,
  inputText,
  onInputChange,
  onSubmit,
  initialSuggestions,
  initialSuggestionsLoading,
  onRefreshInitialSuggestions,
  followupLoadingMessageId,
}) {
  const listRef = useRef(null)
  const userInitials = (currentUser?.nickname || '我').slice(0, 2).toUpperCase()
  const modelLabel = useMemo(() => buildCompactModelLabel(providerLabel), [providerLabel])
  const [activeFollowupTabs, setActiveFollowupTabs] = useState({})
  const hasMessages = (messages || []).length > 0

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, followupLoadingMessageId])

  function renderAvatar(isUser) {
    if (isUser) {
      if (currentUser?.avatar_url) {
        return <img src={currentUser.avatar_url} alt={currentUser.nickname || '用户'} />
      }
      return <span>{userInitials}</span>
    }
    return <Bot size={16} />
  }

  function renderFollowups(message) {
    const groups = Array.isArray(message.followupGroups) ? message.followupGroups : []
    const isLoading = followupLoadingMessageId && followupLoadingMessageId === message.id

    if (!groups.length && !isLoading) return null

    const activeIndex = Math.min(activeFollowupTabs[message.id] || 0, Math.max(groups.length - 1, 0))
    const activeGroup = groups[activeIndex] || groups[0]

    return (
      <div className="ask-followups">
        <div className="ask-followups__label">猜你接下来会问</div>

        {groups.length ? (
          <section className="ask-followup-card">
            <div className="ask-followup-tabs" role="tablist" aria-label="推荐问题分类">
              {groups.map((group, groupIndex) => (
                <button
                  key={`${message.id}:tab:${group.title || groupIndex}`}
                  type="button"
                  className={`ask-followup-tab${groupIndex === activeIndex ? ' is-active' : ''}`}
                  onClick={() => {
                    setActiveFollowupTabs((current) => ({
                      ...current,
                      [message.id]: groupIndex,
                    }))
                  }}
                >
                  {group.title || `分类 ${groupIndex + 1}`}
                </button>
              ))}
            </div>

            <div className="ask-followup-card__head">
              <strong>{activeGroup.title || '推荐问题'}</strong>
              {activeGroup.rationale ? <p>{activeGroup.rationale}</p> : null}
            </div>

            <div className="ask-followup-card__questions">
              {(activeGroup.questions || []).map((question, questionIndex) => (
                <button
                  key={`${message.id}:question:${activeIndex}:${questionIndex}`}
                  type="button"
                  className="ask-followup-question"
                  onClick={() => onSubmit?.(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {isLoading ? (
          <div className="ask-followup-loading" role="status" aria-live="polite">
            正在根据刚才的回答整理下一轮问题...
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="workspace-panel__content ask-panel">
      <div className="ask-chat__header">
        <div className="ask-chat__header-main">
          <strong className="ask-chat__title">边读边问</strong>
          <span className="ask-chat__subtitle">
            {modelLabel}
          </span>
        </div>
      </div>

      <div className="ask-chat__body" ref={listRef}>
        {!hasMessages ? (
          <div className="ask-welcome">
            <div className="ask-welcome__card">
              <span className="ask-welcome__eyebrow">AI 推荐问题</span>
              <div className="ask-welcome__topline">
                <strong>从这几个问题开始读</strong>
              </div>
              <p className="ask-welcome__caption">
                围绕方法、实验和结论，先抓住这篇论文的主线。
              </p>

              <div className="ask-welcome__questions">
                {(initialSuggestions || []).map((question, index) => (
                  <button
                    key={`${question}:${index}`}
                    type="button"
                    className="ask-initial-question"
                    onClick={() => onSubmit?.(question)}
                  >
                    <span>{question}</span>
                    <span className="ask-initial-question__arrow">›</span>
                  </button>
                ))}

                {initialSuggestionsLoading && !(initialSuggestions || []).length ? (
                  <>
                    <div className="ask-initial-question is-placeholder" />
                    <div className="ask-initial-question is-placeholder" />
                    <div className="ask-initial-question is-placeholder" />
                  </>
                ) : null}

                {!initialSuggestionsLoading && !(initialSuggestions || []).length ? (
                  <div className="ask-welcome__empty">
                    正在根据论文内容准备问题，你也可以直接在下方输入。
                  </div>
                ) : null}
              </div>

              <div className="ask-welcome__actions">
                <button
                  type="button"
                  className="ask-welcome__refresh"
                  onClick={() => onRefreshInitialSuggestions?.()}
                  disabled={initialSuggestionsLoading}
                >
                  {initialSuggestionsLoading ? '正在生成下一批' : '换一批问题'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {(messages || []).map((message) => {
          const isUser = message.role === 'user'
          const bubbleText = message.text || ''
          return (
            <div
              key={message.id || `${message.role}:${bubbleText}`}
              className={`ask-msg ${isUser ? 'ask-msg-user' : 'ask-msg-ai'}`}
            >
              {!isUser ? <div className="ask-avatar">{renderAvatar(false)}</div> : null}

              <div className="ask-msg__content">
                <div
                  className={`ask-bubble${
                    message.status === 'error' ? ' is-error' : ''
                  }${message.status === 'streaming' ? ' is-streaming' : ''}`}
                >
                  {bubbleText || (message.status === 'streaming' ? <span className="ask-typing">...</span> : '')}
                </div>
                {!isUser ? renderFollowups(message) : null}
              </div>

              {isUser ? <div className="ask-avatar">{renderAvatar(true)}</div> : null}
            </div>
          )
        })}
      </div>

      <div className="ask-composer">
        <div className="ask-input-row">
          <input
            type="text"
            className="ask-input"
            placeholder="问这篇论文..."
            value={inputText || ''}
            onChange={(event) => onInputChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSubmit?.()
              }
            }}
          />
          <button
            type="button"
            className="ask-send-btn"
            onClick={() => onSubmit?.()}
            disabled={asking || !(inputText || '').trim()}
          >
            发送
          </button>
        </div>
      </div>
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
function FullTranslatePanelV2() {
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

const SUMMARY_TYPES = [
  {
    id: 'overview',
    title: '整篇总结',
    subtitle: '快速理解论文主线、方法、实验和结论',
    emptyHint: '生成一份结构化总览，适合第一次快速读懂全文。',
    themeClass: 'summary-theme--overview',
    Icon: FileText,
  },
  {
    id: 'annotations',
    title: '我的标注总结',
    subtitle: '只归纳你高亮、下划线和重点标记过的内容',
    emptyHint: '把你自己划过的重点重新整理成可复习的摘要。',
    themeClass: 'summary-theme--annotations',
    Icon: Highlighter,
  },
  {
    id: 'review',
    title: '文献综述卡片',
    subtitle: '研究问题、方法、结果、不足和优点统一成卡',
    emptyHint: '适合多篇论文横向对比，后面能直接服务综述写作。',
    themeClass: 'summary-theme--review',
    Icon: Layers3,
  },
  {
    id: 'reproduction',
    title: '复现总结',
    subtitle: '模型结构、数据集、参数、环境和公式逻辑',
    emptyHint: '给后续实验复现和代码阅读准备一份工程向清单。',
    themeClass: 'summary-theme--reproduction',
    Icon: FlaskConical,
  },
  {
    id: 'meeting',
    title: '组会汇报稿',
    subtitle: '按研究生组会口径生成可直接开口讲的稿子',
    emptyHint: '自动整理背景、创新点、实验结果、局限和下周计划。',
    themeClass: 'summary-theme--meeting',
    Icon: Presentation,
  },
]

const SUMMARY_STATUS_LABELS = {
  idle: '未生成',
  generating: '生成中',
  generated: '已生成',
  failed: '失败',
}

function buildSummarySections(typeId, paperTitle) {
  const safeTitle = paperTitle || '当前文献'
  const sectionsByType = {
    overview: [
      ['论文主要讲什么', `围绕《${safeTitle}》建立全局阅读框架，先抓论文主题、研究对象和核心贡献。`],
      ['要解决什么问题', '提炼作者想解决的学术痛点、现有方法不足，以及论文为什么有必要做。'],
      ['用了什么方法', '概括模型、算法、实验流程或理论分析路径，保留关键术语，避免把方法讲散。'],
      ['做了什么实验', '整理数据来源、对比对象、评价指标和主要实验设置。'],
      ['得出什么结论', '压缩出论文最重要的发现，并标明哪些结论可以服务你的研究。'],
      ['论文有哪些不足', '指出适用场景、实验验证、泛化能力和未来工作里的潜在问题。'],
    ],
    annotations: [
      ['标注重点概览', '只读取你标过的高亮、下划线、波浪线内容，生成属于你自己的重点摘要。'],
      ['方法相关重点', '把标注中的模型、步骤、变量、公式含义集中到一个模块，方便复习。'],
      ['结果相关重点', '归纳你标出的实验结果、性能提升、对比结论和作者解释。'],
      ['可继续追问', '根据标注内容生成后续可以问 AI 的问题，帮助继续深读。'],
    ],
    review: [
      ['研究问题', '用一句话说明论文研究的问题、对象和场景。'],
      ['核心方法', '固定格式整理论文使用的核心方法，便于多篇文献横向比较。'],
      ['实验结果', '提取关键结果、指标变化、对比结论和有效性证据。'],
      ['研究不足/空白', '总结论文没解决的问题，为你后续选题和创新点提供入口。'],
      ['优点', '归纳论文值得借鉴的思路、结构、实验设计或论证方式。'],
    ],
    reproduction: [
      ['模型结构', '抽取网络结构、模块组成、输入输出关系和整体流程。'],
      ['用到的数据集', '列出数据集、样本来源、划分方式和预处理信息。'],
      ['实验参数', '整理训练参数、评价指标、消融设置和对比基线。'],
      ['实验环境', '记录框架、硬件、软件环境等可能影响复现的条件。'],
      ['关键公式逻辑', '解释公式变量和推导用途，优先服务代码实现和实验复现。'],
    ],
    meeting: [
      ['本周阅读论文简介', `这周阅读了一篇与《${safeTitle}》相关的论文，主要围绕研究问题和方法改进展开。`],
      ['研究背景 & 现存问题', '用组会口吻说明领域痛点，以及传统方法目前解决不了的地方。'],
      ['论文核心创新点', '突出导师最关心的创新点：相比旧方法改了哪里，新思路是什么。'],
      ['研究方法/模型思路', '用大白话讲清楚作者方法从输入到输出的实现流程。'],
      ['实验结果 & 效果表现', '说明在哪些数据集上验证、效果提升多少、结论是否可靠。'],
      ['论文不足 & 局限性', '主动总结适用限制、实验不足和未来改进空间。'],
      ['对自己课题的启发 + 下周计划', '把论文思路连接到自己的课题，并形成下一步阅读或实验计划。'],
    ],
  }
  return (sectionsByType[typeId] || sectionsByType.overview).map(([title, body]) => ({ title, body }))
}

function formatSummaryMarkdown(type, sections) {
  return [`# ${type.title}`, ...sections.map((section, index) => `\n## ${String(index + 1).padStart(2, '0')} ${section.title}\n${section.body}`)].join('\n')
}

function LiteratureSummaryPanel({ fileName, metadata }) {
  const paperTitle = metadata?.title || buildPaperTitle(fileName)
  const timersRef = useRef([])
  const [activeSummaryId, setActiveSummaryId] = useState('')
  const [summaryState, setSummaryState] = useState(() =>
    SUMMARY_TYPES.reduce((acc, type) => {
      acc[type.id] = { status: 'idle', sections: [], updatedAt: '', justCompleted: false }
      return acc
    }, {}),
  )

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      timersRef.current = []
    }
  }, [])

  const activeType = SUMMARY_TYPES.find((type) => type.id === activeSummaryId)
  const activeSummary = activeType ? summaryState[activeType.id] : null
  const generatedCount = SUMMARY_TYPES.filter((type) => summaryState[type.id]?.status === 'generated').length
  const generatingCount = SUMMARY_TYPES.filter((type) => summaryState[type.id]?.status === 'generating').length

  function schedule(callback, delay) {
    const timerId = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((id) => id !== timerId)
      callback()
    }, delay)
    timersRef.current.push(timerId)
  }

  function finishGenerate(typeId) {
    setSummaryState((current) => ({
      ...current,
      [typeId]: {
        status: 'generated',
        sections: buildSummarySections(typeId, paperTitle),
        updatedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        justCompleted: true,
      },
    }))
    schedule(() => {
      setSummaryState((current) => ({
        ...current,
        [typeId]: { ...current[typeId], justCompleted: false },
      }))
    }, 1000)
  }

  function beginGenerate(typeId, options = {}) {
    if (summaryState[typeId]?.status === 'generating') return
    if (options.open) setActiveSummaryId(typeId)
    setSummaryState((current) => ({
      ...current,
      [typeId]: { ...current[typeId], status: 'generating', justCompleted: false },
    }))
    schedule(() => finishGenerate(typeId), options.delay || 760)
  }

  function handleCardClick(type) {
    const current = summaryState[type.id]
    setActiveSummaryId(type.id)
    if (current?.status === 'idle' || current?.status === 'failed') beginGenerate(type.id, { open: true })
  }

  function handleRegenerate(typeId) {
    const current = summaryState[typeId]
    if (current?.status === 'generated' && !window.confirm('会覆盖当前总结，确定重新生成吗？')) return
    beginGenerate(typeId, { open: true })
  }

  function handleGenerateAll() {
    SUMMARY_TYPES.forEach((type, index) => {
      const current = summaryState[type.id]
      if (current?.status === 'generated' || current?.status === 'generating') return
      schedule(() => beginGenerate(type.id, { delay: 720 }), index * 260)
    })
  }

  async function handleCopy(type, sections) {
    if (!sections.length) return
    try {
      await navigator.clipboard.writeText(formatSummaryMarkdown(type, sections))
    } catch (error) {
      console.warn('copy summary failed', error)
    }
  }

  if (activeType) {
    const isGenerating = activeSummary?.status === 'generating'
    const sections = activeSummary?.sections || []
    const Icon = activeType.Icon
    return (
      <div className={`workspace-panel__content summary-panel ${activeType.themeClass}`}>
        <section className="summary-detail">
          <div className="summary-detail__hero">
            <button className="summary-back-btn" type="button" onClick={() => setActiveSummaryId('')}>
              <ArrowLeft size={16} />
              <span>返回总结列表</span>
            </button>
            <div className="summary-detail__title-row">
              <div className="summary-detail__icon">
                <Icon size={22} />
              </div>
              <div>
                <span>AI Literature Summary</span>
                <h3>{activeType.title}</h3>
                <p>{activeType.subtitle}</p>
              </div>
            </div>
          </div>
          <div className="summary-detail__actions">
            <button className="summary-primary-action" type="button" disabled={isGenerating} onClick={() => handleRegenerate(activeType.id)}>
              {isGenerating ? <Loader2 size={15} className="summary-spin" /> : <RefreshCw size={15} />}
              {isGenerating ? '生成中...' : sections.length ? '重新生成' : '生成'}
            </button>
            <button className="summary-secondary-action" type="button" disabled={!sections.length || isGenerating} onClick={() => handleCopy(activeType, sections)}>
              <ClipboardCopy size={15} />
              复制
            </button>
            <button
              className="summary-secondary-action"
              type="button"
              disabled={!sections.length || isGenerating}
              onClick={() => window.alert('插入阅读笔记入口已预留，下一步会接入笔记树。')}
            >
              <NotebookPen size={15} />
              插入笔记
            </button>
          </div>
          {isGenerating ? (
            <div className="summary-detail__loading">
              <Sparkles size={18} />
              <strong>正在生成结构化总结</strong>
              <p>先搭建模块骨架，再逐段填充重点内容。</p>
            </div>
          ) : null}
          <div className="summary-section-list">
            {(sections.length ? sections : buildSummarySections(activeType.id, paperTitle).slice(0, 3)).map((section, index) => (
              <article className={`summary-section ${!sections.length ? 'is-preview' : ''}`} key={`${section.title}-${index}`} style={{ '--summary-section-index': index }}>
                <span className="summary-section__index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h4>{section.title}</h4>
                  <p>{sections.length ? section.body : '生成后这里会展示该模块的正式内容。'}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="workspace-panel__content summary-panel">
      <section className="summary-home">
        <div className="summary-home__hero">
          <span>AI SUMMARY CENTER</span>
          <h3>文献总结</h3>
          <p>把一篇论文拆成不同用途的总结卡片：速读、标注复盘、综述写作、复现实验和组会汇报。</p>
          <div className="summary-home__meta">
            <strong>{generatedCount}/5 已生成</strong>
            <span>{generatingCount ? `${generatingCount} 个正在生成` : '点击卡片开始生成'}</span>
          </div>
          <button className="summary-generate-all" type="button" disabled={generatingCount > 0} onClick={handleGenerateAll}>
            <Sparkles size={15} />
            全部生成
          </button>
        </div>
        <div className="summary-card-grid">
          {SUMMARY_TYPES.map((type) => {
            const state = summaryState[type.id]
            const status = state?.status || 'idle'
            const preview = state?.sections?.[0]?.body || type.emptyHint
            const Icon = type.Icon
            return (
              <button
                className={`summary-card ${type.themeClass} is-${status} ${state?.justCompleted ? 'is-complete-flash' : ''}`}
                type="button"
                key={type.id}
                onClick={() => handleCardClick(type)}
              >
                <div className="summary-card__top">
                  <span className="summary-card__icon">
                    <Icon size={19} />
                  </span>
                  <span className={`summary-status summary-status--${status}`}>
                    {status === 'generating' ? <Loader2 size={12} className="summary-spin" /> : null}
                    {SUMMARY_STATUS_LABELS[status]}
                  </span>
                </div>
                <h4>{type.title}</h4>
                <p className="summary-card__subtitle">{type.subtitle}</p>
                <p className={`summary-card__preview ${status === 'idle' ? 'is-muted' : ''}`}>{preview}</p>
                <div className="summary-card__footer">
                  <span>{state?.updatedAt ? `更新于 ${state.updatedAt}` : '点击进入详情'}</span>
                  <Sparkles size={14} />
                </div>
              </button>
            )
          })}
        </div>
      </section>
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
        <p>本版先展示工作区，下一步可以接入流式总结、保存到阅读笔记和生成脑图。</p>
      </div>
    </div>
  )
}

export function SideWorkspacePanel({
  activePanel,
  paperId,
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
  chatInitialSuggestions,
  chatInitialSuggestionsLoading,
  chatFollowupLoadingMessageId,
  providerLabel,
  onChatInputChange,
  onChatSubmit,
  onRefreshInitialSuggestions,
}) {
  if (!activePanel) return null

  return (
    <aside className="workspace-panel" style={{ width }}>
      {activePanel === 'info' ? <InfoPanel fileName={fileName} metadata={metadata} /> : null}
      {activePanel === 'notes' ? (
        <NotesPanel
          paperId={paperId}
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
        <AskPanel
          currentUser={currentUser}
          providerLabel={providerLabel}
          messages={chatMessages || []}
          inputText={chatInput || ''}
          asking={chatAsking || false}
          initialSuggestions={chatInitialSuggestions || []}
          initialSuggestionsLoading={chatInitialSuggestionsLoading || false}
          followupLoadingMessageId={chatFollowupLoadingMessageId || ''}
          onInputChange={onChatInputChange}
          onSubmit={onChatSubmit}
          onRefreshInitialSuggestions={onRefreshInitialSuggestions}
        />
      ) : null}
      {activePanel === 'words' ? <FullTranslatePanel /> : null}
      {activePanel === 'summary' ? <LiteratureSummaryPanel fileName={fileName} metadata={metadata} /> : null}
    </aside>
  )
}

