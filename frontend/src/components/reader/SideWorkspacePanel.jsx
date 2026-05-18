import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bold,
  Bot,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Download,
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
  fetchPaperSummaries,
  fetchPaperSummaryStatus,
  generatePaperSummary,
} from '../../services/paperReaderApi'
import {
  addChildNode,
  addRootNode,
  addTextBlock,
  buildNodeChildren,
  createTemplateDescriptor,
  createTemplateFromNotebook,
  deleteBlock,
  deleteNode,
  deleteNotebook,
  NOTEBOOK_TEMPLATES,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/tabs'

function buildPaperTitle(fileName) {
  if (!fileName) return 'Untitled paper'
  return fileName.replace(/\.pdf$/i, '')
}

const NOTEBOOK_TEMPLATE_ICON_MAP = {
  blank: NotebookPen,
  default: Layers3,
  review_writing: FileText,
  experiment_design: FlaskConical,
  clinical_research: ClipboardCopy,
  critical_reading: Highlighter,
  paper_reproduction: RefreshCw,
  related_work_compare: Layers3,
  proposal_research: NotebookPen,
  figure_deep_read: ImageIcon,
  writing_citation: Type,
}

const CUSTOM_TEMPLATE_STORAGE_KEY = 'xk:note-custom-templates:v1'

function stripTemplateDescriptor(template) {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    accent: template.accent,
    nodes: Array.isArray(template.nodes) ? template.nodes : [],
  }
}

function readStoredCustomTemplates() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_TEMPLATE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((template) => createTemplateDescriptor(template))
  } catch {
    return []
  }
}

function writeStoredCustomTemplates(templates) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    CUSTOM_TEMPLATE_STORAGE_KEY,
    JSON.stringify((templates || []).map((template) => stripTemplateDescriptor(template))),
  )
}

const BLANK_NOTEBOOK_TEMPLATE = createTemplateDescriptor({
  id: 'blank',
  title: '空白笔记本',
  description: '先创建一个笔记本，再自由添加标题和笔记内容。',
  accent: '#64748b',
  nodes: [
    {
      title: '从这里开始',
      colorIndex: 0,
      blocks: ['创建笔记本后，你可以自由添加一级标题、子标题和正文内容。'],
      children: ['自定义一级标题', '自定义二级标题'],
    },
  ],
})

const BLANK_NOTEBOOK_TEMPLATE_OPTION = {
  ...BLANK_NOTEBOOK_TEMPLATE,
  createKind: 'blank',
  footerText: '自由搭建',
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
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [templateDialogTab, setTemplateDialogTab] = useState('system')
  const [customTemplates, setCustomTemplates] = useState(() => readStoredCustomTemplates())
  const [colorCommand, setColorCommand] = useState(null)
  const notesStyle = useMemo(() => buildNotesStyle(prefs), [prefs])
  const systemTemplateOptions = useMemo(
    () => [BLANK_NOTEBOOK_TEMPLATE_OPTION, ...NOTEBOOK_TEMPLATES],
    [],
  )

  useEffect(() => {
    setPrefs(readNotePrefs(paperId))
    setColorMenuOpen(false)
    setTemplateMenuOpen(false)
    setTemplateDialogTab('system')
  }, [paperId])

  useEffect(() => {
    writeNotePrefs(paperId, prefs)
  }, [paperId, prefs])

  useEffect(() => {
    setCustomTemplates(readStoredCustomTemplates())
  }, [])

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

  function openNotebookTemplateDialog(nextTab = 'system') {
    setColorMenuOpen(false)
    setTemplateDialogTab(nextTab)
    setTemplateMenuOpen(true)
  }

  function handleCreateNotebook(kind) {
    setTemplateMenuOpen(false)
    onCreateNotebook?.(kind)
  }

  function handleCreateCustomTemplateNotebook() {
    const nextIndex = customTemplates.length + 1
    handleCreateNotebook({
      id: `custom-draft:${Date.now()}`,
      title: `自建模板草稿 ${nextIndex}`,
      description: '从空白笔记本开始搭建自定义模板',
      accent: '#8b5cf6',
      nodes: [],
    })
  }

  function handleSaveNotebookAsTemplate(notebookId) {
    const notebook = (notebooks || []).find((item) => item.id === notebookId)
    if (!notebook) return
    if (!Array.isArray(notebook.nodes) || notebook.nodes.length === 0) {
      window.alert('先在笔记本里添加标题结构，再存为模板。')
      return
    }

    const existing = customTemplates.find((item) => item.title === notebook.title)
    const savedTemplate = createTemplateFromNotebook(notebook, {
      id: existing?.id || `custom:${Date.now()}`,
      description: existing?.description || `来自笔记本“${notebook.title || '未命名笔记本'}”的自建模板`,
      accent: existing?.accent || '#8b5cf6',
    })

    const nextTemplates = [
      savedTemplate,
      ...customTemplates.filter((item) => item.id !== savedTemplate.id && item.title !== savedTemplate.title),
    ]
    setCustomTemplates(nextTemplates)
    writeStoredCustomTemplates(nextTemplates)
    setTemplateDialogTab('custom')
    window.alert(existing ? `已更新自建模板：${savedTemplate.title}` : `已保存为自建模板：${savedTemplate.title}`)
  }

  function renderTemplateCard(template) {
    const Icon = NOTEBOOK_TEMPLATE_ICON_MAP[template.id] || FileText
    return (
      <button
        key={template.id}
        type="button"
        className="notes-template-card"
        onClick={() => handleCreateNotebook(template.createKind || template)}
      >
        <div className="notes-template-preview" aria-hidden="true">
          {template.previewSections?.slice(0, 5).map((section, sectionIndex) => (
            <div key={`${template.id}:${section.title}:${sectionIndex}`} className="notes-template-preview__section">
              <div className="notes-template-preview__header">
                <span className={`note-tree-index color-${(section.colorIndex || 0) % 6}`}>{sectionIndex + 1}</span>
                <strong>{section.title}</strong>
              </div>
              {section.hint ? <div className="notes-template-preview__hint">{section.hint}</div> : null}
              {section.children?.slice(0, 3).map((child, childIndex) => (
                <div key={`${section.title}:${child.title}:${childIndex}`} className="notes-template-preview__branch">
                  <span className="notes-template-preview__dot" />
                  <div className="notes-template-preview__branch-copy">
                    <span>{child.title}</span>
                    {child.children?.length ? (
                      <small>{child.children.join(' / ')}</small>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="notes-template-card__footer">
          <span className="notes-template-card__label">
            <Icon size={15} />
            {template.title}
          </span>
          <span className="notes-template-card__footer-meta">
            {template.footerText || `${template.sectionCount} 个分区`}
          </span>
        </div>
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

            <AutoGrowTextarea
              className="note-tree-title-input"
              value={node.title || ''}
              placeholder="标题"
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
          <button type="button" className="notes-command" onClick={() => openNotebookTemplateDialog('system')}>
            <NotebookPen size={15} />
            <span>新建笔记本</span>
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
              onClick={() => {
                setTemplateMenuOpen(false)
                setColorMenuOpen((current) => !current)
              }}
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

      <Dialog open={templateMenuOpen} onOpenChange={setTemplateMenuOpen}>
        <DialogContent className="notes-template-dialog" showCloseButton>
          <DialogHeader className="notes-template-dialog__header">
            <DialogTitle>新建笔记本</DialogTitle>
            <DialogDescription>
              先选择一个模板来初始化笔记本，创建后再到笔记本里继续加标题和记笔记。
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={templateDialogTab}
            onValueChange={setTemplateDialogTab}
            className="notes-template-tabs"
          >
            <TabsList variant="line" className="notes-template-tabs__list">
              <TabsTrigger value="system">系统模板</TabsTrigger>
              <TabsTrigger value="custom">自建模板</TabsTrigger>
            </TabsList>

            <TabsContent value="system" className="notes-template-tabs__panel">
              <div className="notes-template-grid" role="menu" aria-label="系统笔记本模板">
                {systemTemplateOptions.map((template) => renderTemplateCard(template))}
              </div>
            </TabsContent>

            <TabsContent value="custom" className="notes-template-tabs__panel">
              {customTemplates.length ? (
                <div className="notes-template-custom-shell">
                  <div className="notes-template-custom-bar">
                    <p>先创建笔记本并整理标题结构，再在笔记本右侧点击“存为模板”。</p>
                    <button
                      type="button"
                      className="notes-command"
                      onClick={handleCreateCustomTemplateNotebook}
                    >
                      <Plus size={15} />
                      <span>新建模板笔记本</span>
                    </button>
                  </div>
                  <div className="notes-template-grid" role="menu" aria-label="自建阅读笔记模板">
                    {customTemplates.map((template) => renderTemplateCard(template))}
                  </div>
                </div>
              ) : (
                <div className="notes-template-empty">
                  <NotebookPen size={18} />
                  <strong>先建一个笔记本，再把它存成模板</strong>
                  <p>流程是：新建模板笔记本，搭好标题和提示内容，然后在笔记本右侧点击“存为模板”。</p>
                  <button
                    type="button"
                    className="notes-command"
                    onClick={handleCreateCustomTemplateNotebook}
                  >
                    <Plus size={15} />
                    <span>新建模板笔记本</span>
                  </button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <div className="notes-text-tree-shell">
        {loading ? <p className="muted">正在加载笔记...</p> : null}
        {!loading && (notebooks || []).length === 0 ? (
          <div className="notes-empty-state">
            <NotebookPen size={18} />
            <p>先新建一个笔记本，再在笔记本里整理标题和阅读笔记。</p>
            <button type="button" className="notes-command" onClick={() => openNotebookTemplateDialog('system')}>
              <NotebookPen size={15} />
              <span>新建笔记本</span>
            </button>
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
              <AutoGrowTextarea
                className="note-notebook__title"
                value={notebook.title || ''}
                placeholder="笔记本名称"
                onChange={(event) => {
                  const value = event.target.value
                  changeDraft((current) => updateNotebookTitle(current, notebook.id, value))
                }}
              />
              <div className="note-text-tree-actions">
                {renderIconButton('存为模板', <Layers3 size={14} />, () => {
                  handleSaveNotebookAsTemplate(notebook.id)
                })}
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

const QUALITY_SUMMARY_TYPES = [
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
    emptyHint: '把你自己划过的重点整理成可复习的摘要。',
    themeClass: 'summary-theme--annotations',
    Icon: Highlighter,
  },
  {
    id: 'review',
    title: '文献综述卡片',
    subtitle: '变量指标、核心发现、创新局限和引用价值',
    emptyHint: '适合后期多篇论文横向对比和综述写作，重点沉淀可复用字段。',
    themeClass: 'summary-theme--review',
    Icon: Layers3,
  },
  {
    id: 'reproduction',
    title: '复现总结',
    subtitle: '模型结构、数据集、参数、环境和公式逻辑',
    emptyHint: '给后续实验复现和代码阅读准备工程向清单。',
    themeClass: 'summary-theme--reproduction',
    Icon: FlaskConical,
  },
  {
    id: 'meeting',
    title: '组会汇报稿',
    subtitle: '按研究生组会口径生成可直接开口讲的稿子',
    emptyHint: '整理背景、创新点、实验结果、局限和下周计划。',
    themeClass: 'summary-theme--meeting',
    Icon: Presentation,
  },
]

const QUALITY_SUMMARY_STATUS_LABELS = {
  idle: '未生成',
  running: '生成中',
  generated: '已生成',
  failed: '失败',
}

QUALITY_SUMMARY_STATUS_LABELS.stale = '待更新'

const QUALITY_SUMMARY_STAGE_LABELS = {
  idle: '等待生成',
  extracting_context: '提取全文',
  chunking: '分块分析',
  analyzing_structure: '分析结构',
  generating_summary: '生成总结',
  checking_coverage: '校验结果',
  completed: '完成',
  failed: '生成失败',
}

function createQualitySummaryState() {
  return QUALITY_SUMMARY_TYPES.reduce((acc, type) => {
    acc[type.id] = {
      status: 'idle',
      stage: 'idle',
      progress: 0,
      summary: null,
      preview: '',
      updatedAt: '',
      errorMessage: '',
      model: '',
      isStale: false,
      justCompleted: false,
    }
    return acc
  }, {})
}

function normalizeQualitySummaryPayload(payload) {
  return {
    status: payload?.status || 'idle',
    stage: payload?.stage || 'idle',
    progress: Number(payload?.progress || 0),
    summary: payload?.summary || null,
    preview: payload?.summary?.preview || payload?.preview || '',
    updatedAt: payload?.updated_at || '',
    errorMessage: payload?.error_message || '',
    model: payload?.model || '',
    isStale: Boolean(payload?.is_stale),
  }
}

function visualQualitySummaryStatus(status) {
  return status === 'running' ? 'generating' : status
}

function getQualitySummaryDisplayStatus(state) {
  if (state?.status === 'running') return 'running'
  if (state?.isStale) return 'stale'
  return state?.status || 'idle'
}

function getAnnotationSummaryTotal(summary) {
  return (Array.isArray(summary?.annotation_groups) ? summary.annotation_groups : [])
    .reduce((total, group) => total + Number(group?.count || 0), 0)
}

function formatQualitySummaryTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function buildAnnotationFingerprint(annotations = []) {
  return (annotations || [])
    .map((item) => [
      item.id,
      item.type,
      item.page_number,
      item.start_char,
      item.end_char,
      item.quote_text,
      item.color || '',
    ].join(':'))
    .join('|')
}

function splitSummaryBodyText(value) {
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

function renderSummaryBodyText(value) {
  const blocks = splitSummaryBodyText(value)
  if (!blocks.length) return null
  return (
    <div className="summary-body">
      {blocks.map((block, index) => {
        const bullet = block.match(/^[-*•]\s*(.+)$/)
        return bullet ? <p className="summary-body__bullet" key={`${block}-${index}`}>{bullet[1]}</p> : <p key={`${block}-${index}`}>{block}</p>
      })}
    </div>
  )
}

function renderReviewFieldBlocks(blocks, onJumpToEvidence) {
  if (!Array.isArray(blocks) || !blocks.length) return null
  return (
    <section className="summary-field-blocks" aria-label="综述核心字段">
      {blocks.map((block, index) => (
        <article className="summary-field-block" key={block.key || index} style={{ '--summary-section-index': index }}>
          <div className="summary-field-block__head">
            <span className="summary-field-block__index">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h4>{block.title || block.key}</h4>
              {block.summary ? <p>{block.summary}</p> : null}
            </div>
          </div>
          {Array.isArray(block.items) && block.items.length ? (
            <ol className="summary-field-block__items">
              {block.items.map((item, itemIndex) => (
                <li key={item.id || `${block.key}-${itemIndex}`}>
                  <div className="summary-field-block__item-copy">
                    <strong>{String(itemIndex + 1).padStart(2, '0')}</strong>
                    <span>{item.text}</span>
                  </div>
                  {(item.source_quote || item.source_pages?.length) ? (
                    <button
                      className="summary-source-link summary-source-link--inline"
                      type="button"
                      disabled={!item.source_pages?.length}
                      onClick={() => onJumpToEvidence?.({
                        page: item.source_pages?.[0],
                        quote: item.source_quote || item.text || '',
                        start_char: item.start_char ?? null,
                        end_char: item.end_char ?? null,
                        source_type: 'paper',
                      })}
                    >
                      {item.source_pages?.length ? `论文｜第 ${item.source_pages[0]} 页` : '论文来源'}
                      {item.source_quote ? `：${item.source_quote}` : ''}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </article>
      ))}
    </section>
  )
}

function EvidenceList({ evidence = [], onJumpToEvidence, summaryText = '已核验来源依据' }) {
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? evidence : evidence.slice(0, 3)
  const hiddenCount = Math.max(0, evidence.length - visibleItems.length)
  if (!Array.isArray(evidence) || !evidence.length) return null
  return (
    <div className="summary-evidence">
      <button
        className="summary-evidence__summary"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {summaryText} {evidence.length} 条
      </button>
      <ul>
        {visibleItems.map((item, evidenceIndex) => (
          <li key={`${item.quote}-${evidenceIndex}`}>
            <strong>{renderEvidenceSourceLabel(item)}</strong>
            <button
              className="summary-source-link"
              type="button"
              disabled={!item.page}
              onClick={() => onJumpToEvidence?.(item)}
            >
              {item.quote}
            </button>
          </li>
        ))}
      </ul>
      {evidence.length > 3 ? (
        <button
          className="summary-evidence__toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起多余依据' : `展开剩余 ${hiddenCount} 条依据`}
        </button>
      ) : null}
    </div>
  )
}

function getAnnotationGroups(summary) {
  return Array.isArray(summary?.annotation_groups) ? summary.annotation_groups : []
}

function getAnnotationGroupTotal(groups) {
  return groups.reduce((total, group) => total + Number(group?.count || 0), 0)
}

function renderEvidenceSourceLabel(item) {
  const prefix = item?.source_type === 'annotation' ? '标注' : '论文'
  return item?.page ? `${prefix}｜第 ${item.page} 页` : prefix
}

function formatQualitySummaryMarkdown(type, summary) {
  if (!summary) return ''
  const lines = [`# ${summary.title || type.title}`]
  if (summary.preview) lines.push('', `> ${summary.preview}`)
  if (summary.highlights?.length) {
    lines.push('', '## 关键结论')
    summary.highlights.forEach((item) => lines.push(`- ${item}`))
  }
  ;(summary.sections || []).forEach((section, index) => {
    lines.push('', `## ${String(index + 1).padStart(2, '0')} ${section.heading || '总结要点'}`)
    if (section.keywords?.length) lines.push(`关键词：${section.keywords.join('、')}`)
    lines.push('', section.body || '')
    if (section.evidence?.length) {
      lines.push('', '已核验来源依据：')
      section.evidence.forEach((item) => {
        lines.push(`- ${renderEvidenceSourceLabel(item)}：${item.quote || ''}`)
      })
    }
  })
  const annotationGroups = getAnnotationGroups(summary)
  if (annotationGroups.length) {
    lines.push('', '## 标注清单')
    annotationGroups.forEach((group) => {
      lines.push('', `### ${group.label || group.type}（${group.count || 0} 条）`)
      ;(group.items || []).forEach((item, index) => {
        lines.push(`${index + 1}. ${item.page ? `第 ${item.page} 页：` : ''}${item.quote || ''}`)
      })
    })
  }
  const assistantPanels = getQualityAssistantPanels(summary)
  if (assistantPanels.length) {
    lines.push('', '## 研究助手')
    assistantPanels.forEach((panel) => {
      lines.push('', `### ${panel.title}`)
      panel.items.forEach((item) => lines.push(`- ${item}`))
    })
  }
  if (summary.missing_items?.length) {
    lines.push('', '## 回查清单')
    summary.missing_items.forEach((item) => lines.push(`- ${item}`))
  }
  if (summary.followup_questions?.length) {
    lines.push('', '## 可继续深挖的问题')
    summary.followup_questions.forEach((item) => lines.push(`- ${item}`))
  }
  if (summary.source_note) lines.push('', `来源说明：${summary.source_note}`)
  return lines.join('\n')
}

function getQualityAssistantPanels(summary) {
  return (summary?.assistant_panels || [])
    .filter((panel) => Array.isArray(panel?.items) && panel.items.length > 0)
    .slice(0, 3)
}

function escapeSummaryHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderSummaryTextHtml(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text
    .split(/\n+/)
    .map((part) => `<p>${escapeSummaryHtml(part.replace(/^[-*]\s*/, ''))}</p>`)
    .join('')
}

function sanitizeSummaryExportName(value, fallback = 'literature-summary') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, 80)
}

function buildSummaryExportHtml(type, summary) {
  const assistantPanels = getQualityAssistantPanels(summary)
  const generatedAt = new Date().toLocaleString('zh-CN')
  const sectionHtml = (summary.sections || []).map((section, index) => {
    const keywords = (section.keywords || [])
      .map((keyword) => `<span>${escapeSummaryHtml(keyword)}</span>`)
      .join('')
    const evidence = (section.evidence || [])
      .map((item) => `
        <li>
          <strong>${escapeSummaryHtml(renderEvidenceSourceLabel(item))}</strong>
          <span>${escapeSummaryHtml(item.quote || '')}</span>
        </li>
      `)
      .join('')
    return `
      <section class="export-section">
        <div class="export-section-title">
          <b>${String(index + 1).padStart(2, '0')}</b>
          <h2>${escapeSummaryHtml(section.heading || '总结要点')}</h2>
        </div>
        ${keywords ? `<div class="export-keywords">${keywords}</div>` : ''}
        <div class="export-body">${renderSummaryTextHtml(section.body)}</div>
        ${evidence ? `<div class="export-evidence"><h3>已核验来源依据</h3><ul>${evidence}</ul></div>` : ''}
      </section>
    `
  }).join('')
  const annotationGroupsHtml = getAnnotationGroups(summary).map((group) => {
    const items = (group.items || [])
      .map((item, index) => `
        <li>
          <b>${String(index + 1).padStart(2, '0')}</b>
          <span>${item.page ? `第 ${escapeSummaryHtml(item.page)} 页：` : ''}${escapeSummaryHtml(item.quote || '')}</span>
        </li>
      `)
      .join('')
    return `
      <section class="export-annotation-group">
        <h3>${escapeSummaryHtml(group.label || group.type)} <span>${escapeSummaryHtml(group.count || 0)} 条</span></h3>
        ${items ? `<ol>${items}</ol>` : '<p>暂无。</p>'}
      </section>
    `
  }).join('')
  const highlightsHtml = (summary.highlights || [])
    .map((item, index) => `
      <li>
        <b>${String(index + 1).padStart(2, '0')}</b>
        <span>${escapeSummaryHtml(item)}</span>
      </li>
    `)
    .join('')
  const assistantHtml = assistantPanels.map((panel) => `
    <section class="export-assistant-card">
      <h3>${escapeSummaryHtml(panel.title)}</h3>
      <ol>
        ${panel.items.map((item) => `<li>${escapeSummaryHtml(item)}</li>`).join('')}
      </ol>
    </section>
  `).join('')
  const missingHtml = (summary.missing_items || []).map((item) => `<li>${escapeSummaryHtml(item)}</li>`).join('')
  const followupHtml = (summary.followup_questions || []).map((item) => `<li>${escapeSummaryHtml(item)}</li>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeSummaryHtml(summary.title || type.title)}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", SimSun, sans-serif;
      line-height: 1.65;
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
    .export-preview { margin: 0; color: #475569; font-size: 14px; }
    .export-meta { margin-top: 10px; color: #64748b; font-size: 11px; }
    .export-highlights {
      margin: 0 0 18px;
      padding: 14px;
      border: 1px solid #bae6fd;
      border-radius: 14px;
      background: #f0f9ff;
      page-break-inside: avoid;
    }
    .export-highlights h2,
    .export-annotations h2,
    .export-assistant h2,
    .export-tail h2 { margin: 0 0 10px; font-size: 16px; color: #0f172a; }
    .export-highlights ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .export-highlights li { display: grid; grid-template-columns: 34px 1fr; gap: 10px; align-items: start; }
    .export-highlights b,
    .export-section-title b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      height: 24px;
      border-radius: 999px;
      background: #2563eb;
      color: #ffffff;
      font-size: 12px;
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
    .export-body p { margin: 7px 0; font-size: 13.5px; }
    .export-evidence {
      margin-top: 10px;
      padding: 10px;
      border-left: 4px solid #93c5fd;
      background: #f8fafc;
      border-radius: 10px;
    }
    .export-evidence h3 { margin: 0 0 6px; font-size: 12px; color: #1d4ed8; }
    .export-evidence ul,
    .export-tail ul { margin: 0; padding-left: 18px; }
    .export-evidence li,
    .export-tail li { margin: 4px 0; font-size: 12px; color: #475569; }
    .export-evidence strong { margin-right: 6px; color: #0f172a; }
    .export-annotations {
      margin: 0 0 18px;
      padding: 14px;
      border: 1px solid #ccfbf1;
      border-radius: 14px;
      background: #f0fdfa;
      page-break-inside: avoid;
    }
    .export-annotation-group { margin-top: 10px; }
    .export-annotation-group h3 { margin: 0 0 6px; font-size: 13px; color: #115e59; }
    .export-annotation-group h3 span { color: #0f766e; font-size: 11px; }
    .export-annotation-group ol { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .export-annotation-group li { display: grid; grid-template-columns: 30px 1fr; gap: 8px; color: #475569; font-size: 12px; }
    .export-annotation-group b {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      width: 24px;
      height: 20px;
      border-radius: 999px;
      background: #14b8a6;
      color: #ffffff;
      font-size: 10px;
    }
    .export-annotation-group p { margin: 0; color: #64748b; font-size: 12px; }
    .export-assistant {
      margin: 18px 0;
      page-break-inside: avoid;
    }
    .export-assistant-grid { display: grid; gap: 10px; }
    .export-assistant-card {
      padding: 12px;
      border: 1px solid #dbeafe;
      border-radius: 12px;
      background: #eff6ff;
    }
    .export-assistant-card h3 { margin: 0 0 6px; color: #1e3a8a; font-size: 14px; }
    .export-assistant-card ol { margin: 0; padding-left: 20px; }
    .export-assistant-card li { margin: 4px 0; font-size: 12.5px; }
    .export-tail { display: grid; gap: 12px; margin-top: 16px; }
    .export-tail section { padding: 12px; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; }
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
      <span class="export-type">${escapeSummaryHtml(type.title)}</span>
      <h1>${escapeSummaryHtml(summary.title || type.title)}</h1>
      ${summary.preview ? `<p class="export-preview">${escapeSummaryHtml(summary.preview)}</p>` : ''}
      <div class="export-meta">导出时间：${escapeSummaryHtml(generatedAt)}</div>
    </header>
    ${highlightsHtml ? `<section class="export-highlights"><h2>关键结论</h2><ol>${highlightsHtml}</ol></section>` : ''}
    ${annotationGroupsHtml ? `<section class="export-annotations"><h2>标注清单</h2>${annotationGroupsHtml}</section>` : ''}
    ${sectionHtml}
    ${assistantHtml ? `<section class="export-assistant"><h2>研究助手</h2><div class="export-assistant-grid">${assistantHtml}</div></section>` : ''}
    ${missingHtml || followupHtml ? `<section class="export-tail">
      ${missingHtml ? `<section><h2>回查清单</h2><ul>${missingHtml}</ul></section>` : ''}
      ${followupHtml ? `<section><h2>可继续深挖的问题</h2><ul>${followupHtml}</ul></section>` : ''}
    </section>` : ''}
    ${summary.source_note ? `<p class="export-source">来源说明：${escapeSummaryHtml(summary.source_note)}</p>` : ''}
  </main>
</body>
</html>`
}

function triggerSummaryWordExport(type, summary) {
  const html = buildSummaryExportHtml(type, summary)
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeSummaryExportName(summary.title || type.title)}.doc`
  link.click()
  URL.revokeObjectURL(url)
}

function openSummaryPdfExport(type, summary) {
  const html = buildSummaryExportHtml(type, summary)
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

function qualityDelay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function QualityLiteratureSummaryPanel({
  paperId,
  annotations = [],
  providerId,
  onJumpToEvidence,
  onClearAnnotations,
  initialSummaryId = '',
}) {
  const pollersRef = useRef(new Map())
  const [activeSummaryId, setActiveSummaryId] = useState('')
  const [summaryState, setSummaryState] = useState(createQualitySummaryState)
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false)
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const annotationFingerprint = useMemo(() => buildAnnotationFingerprint(annotations), [annotations])
  const annotationFingerprintRef = useRef('')
  const annotationFingerprintReadyRef = useRef(false)

  function applySummaryStatus(typeId, payload, options = {}) {
    const next = normalizeQualitySummaryPayload(payload)
    setSummaryState((current) => {
      const previous = current[typeId] || {}
      const shouldKeepPreviousSummary = !next.summary && previous.summary && (next.status === 'running' || next.isStale)
      return {
        ...current,
        [typeId]: {
          ...previous,
          ...next,
          summary: shouldKeepPreviousSummary ? previous.summary : next.summary,
          preview: shouldKeepPreviousSummary ? (previous.summary?.preview || previous.preview || next.preview) : next.preview,
          justCompleted: options.flash || (previous.status === 'running' && next.status === 'generated'),
        },
      }
    })
    if (next.status === 'generated') {
      window.setTimeout(() => {
        setSummaryState((current) => ({
          ...current,
          [typeId]: { ...current[typeId], justCompleted: false },
        }))
      }, 1100)
    }
  }

  function stopPolling(typeId) {
    const timer = pollersRef.current.get(typeId)
    if (timer) window.clearInterval(timer)
    pollersRef.current.delete(typeId)
  }

  function pollSummary(typeId) {
    if (!paperId) return
    stopPolling(typeId)
    const timer = window.setInterval(async () => {
      try {
        const payload = await fetchPaperSummaryStatus(paperId, typeId)
        applySummaryStatus(typeId, payload)
        if (payload.status !== 'running') stopPolling(typeId)
      } catch (error) {
        stopPolling(typeId)
        setSummaryState((current) => ({
          ...current,
          [typeId]: {
            ...current[typeId],
            status: current[typeId]?.summary ? 'generated' : 'failed',
            stage: 'failed',
            errorMessage: error?.message || '总结状态获取失败',
          },
        }))
      }
    }, 1800)
    pollersRef.current.set(typeId, timer)
  }

  useEffect(() => {
    let cancelled = false
    async function loadSummaries() {
      if (!paperId) {
        setSummaryState(createQualitySummaryState())
        return
      }
      setIsLoadingSummaries(true)
      try {
        const payload = await fetchPaperSummaries(paperId)
        if (cancelled) return
        const next = createQualitySummaryState()
        ;(payload?.summaries || []).forEach((item) => {
          if (next[item.type]) next[item.type] = { ...next[item.type], ...normalizeQualitySummaryPayload(item) }
          if (item.status === 'running') pollSummary(item.type)
        })
        setSummaryState(next)
      } catch {
        if (!cancelled) setSummaryState(createQualitySummaryState())
      } finally {
        if (!cancelled) setIsLoadingSummaries(false)
      }
    }
    loadSummaries()
    return () => {
      cancelled = true
      pollersRef.current.forEach((timer) => window.clearInterval(timer))
      pollersRef.current.clear()
    }
  }, [paperId])

  useEffect(() => {
    setExportMenuOpen(false)
  }, [activeSummaryId])

  useEffect(() => {
    if (initialSummaryId && QUALITY_SUMMARY_TYPES.some((type) => type.id === initialSummaryId)) {
      setActiveSummaryId(initialSummaryId)
    }
  }, [initialSummaryId, paperId])

  useEffect(() => {
    annotationFingerprintRef.current = ''
    annotationFingerprintReadyRef.current = false
  }, [paperId])

  useEffect(() => {
    if (!paperId) return
    if (!annotationFingerprintReadyRef.current) {
      annotationFingerprintReadyRef.current = true
      annotationFingerprintRef.current = annotationFingerprint
      return
    }
    if (annotationFingerprintRef.current === annotationFingerprint) return
    annotationFingerprintRef.current = annotationFingerprint
    setSummaryState((current) => {
      const previous = current.annotations
      if (!previous?.summary || previous.status === 'running') return current
      const previousTotal = getAnnotationSummaryTotal(previous.summary)
      const currentTotal = Array.isArray(annotations) ? annotations.length : 0
      if (previousTotal === 0 && currentTotal === 0) return current
      return {
        ...current,
        annotations: {
          ...previous,
          status: 'idle',
          stage: 'idle',
          progress: 0,
          preview: previous.summary?.preview || previous.preview,
          errorMessage: '',
          isStale: true,
          justCompleted: false,
        },
      }
    })
  }, [paperId, annotationFingerprint])

  const activeType = QUALITY_SUMMARY_TYPES.find((type) => type.id === activeSummaryId)
  const activeSummary = activeType ? summaryState[activeType.id] : null
  const generatedCount = QUALITY_SUMMARY_TYPES.filter((type) => summaryState[type.id]?.status === 'generated').length
  const generatingCount = QUALITY_SUMMARY_TYPES.filter((type) => summaryState[type.id]?.status === 'running').length

  async function beginGenerate(typeId, options = {}) {
    if (!paperId || summaryState[typeId]?.status === 'running') return null
    if (options.open) setActiveSummaryId(typeId)
    setSummaryState((current) => ({
      ...current,
      [typeId]: { ...current[typeId], status: 'running', stage: 'extracting_context', progress: 3, errorMessage: '', isStale: false, justCompleted: false },
    }))
    try {
      const payload = await generatePaperSummary(paperId, typeId, {
        provider_id: providerId || null,
        force: Boolean(options.force),
      })
      applySummaryStatus(typeId, payload)
      if (payload.status === 'running') pollSummary(typeId)
      return payload
    } catch (error) {
      setSummaryState((current) => ({
        ...current,
        [typeId]: {
          ...current[typeId],
          status: current[typeId]?.summary ? 'generated' : 'failed',
          stage: 'failed',
          progress: current[typeId]?.progress || 0,
          errorMessage: error?.message || '总结生成失败',
        },
      }))
      return null
    }
  }

  async function beginGenerateAndWait(typeId, options = {}) {
    const first = await beginGenerate(typeId, options)
    if (!first || first.status !== 'running') return first
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await qualityDelay(2000)
      const payload = await fetchPaperSummaryStatus(paperId, typeId)
      applySummaryStatus(typeId, payload)
      if (payload.status !== 'running') return payload
    }
    return null
  }

  function handleCardClick(type) {
    setActiveSummaryId(type.id)
  }

  function handleRegenerate(typeId) {
    const current = summaryState[typeId]
    if (current?.status === 'generated' || current?.isStale) {
      const confirmText = current?.isStale
        ? '更新生成会消耗一次 AI 调用，并覆盖当前旧版本。确定继续吗？'
        : '重新生成会消耗一次 AI 调用，并覆盖当前版本。确定继续吗？'
      if (!window.confirm(confirmText)) return
    }
    beginGenerate(typeId, { open: true, force: true })
  }

  async function handleGenerateAll() {
    if (isGeneratingAll || !paperId) return
    setIsGeneratingAll(true)
    try {
      for (const type of QUALITY_SUMMARY_TYPES) {
        const current = summaryState[type.id]
        if (current?.status === 'running') continue
        if (current?.status === 'generated' && !current?.isStale) continue
        await beginGenerateAndWait(type.id, { force: Boolean(current?.isStale) })
      }
    } finally {
      setIsGeneratingAll(false)
    }
  }

  function handleExport(type, summary, format) {
    if (!summary) return
    setExportMenuOpen(false)
    if (format === 'pdf') {
      openSummaryPdfExport(type, summary)
      return
    }
    triggerSummaryWordExport(type, summary)
  }

  if (activeType) {
    const isRunning = activeSummary?.status === 'running'
    const rawSummary = activeSummary?.summary
    const rawAnnotationGroups = getAnnotationGroups(rawSummary)
    const rawAnnotationTotal = getAnnotationGroupTotal(rawAnnotationGroups)
    const liveAnnotationTotal = annotations.length
    const annotationCountMismatch = activeType.id === 'annotations' && rawSummary && rawAnnotationTotal !== liveAnnotationTotal
    const needsManualRefresh = Boolean(activeSummary?.isStale || annotationCountMismatch)
    const summary = rawSummary
    const sections = summary?.sections || []
    const assistantPanels = getQualityAssistantPanels(summary)
    const annotationGroups = getAnnotationGroups(summary)
    const reviewFieldBlocks = Array.isArray(summary?.review_field_blocks) ? summary.review_field_blocks : []
    const annotationTotal = getAnnotationGroupTotal(annotationGroups)
    const annotationTotalLabel = needsManualRefresh ? '上次生成时有效标注' : '当前有效标注'
    const hideFallbackSections = activeType.id === 'annotations' && summary && annotationTotal === 0 && !sections.length
    const displaySections = sections.length
      ? sections
      : hideFallbackSections
        ? []
        : [{ heading: activeType.title, body: isRunning ? '正在分析论文结构和证据来源。' : activeType.emptyHint, keywords: [], evidence: [] }]
    const resolvedDisplaySections = displaySections
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
                <h3>{activeType.title}</h3>
                <p>{activeType.subtitle}</p>
              </div>
            </div>
            <div className="summary-progress-card">
              <div>
                <strong>{QUALITY_SUMMARY_STAGE_LABELS[activeSummary?.stage] || QUALITY_SUMMARY_STAGE_LABELS.idle}</strong>
                <span>{activeSummary?.model || '质量优先模式'}</span>
              </div>
              <div className="summary-progress-track">
                <span style={{ width: `${Math.max(0, Math.min(100, activeSummary?.progress || 0))}%` }} />
              </div>
            </div>
          </div>
          <div className="summary-detail__actions">
            <button className="summary-primary-action" type="button" disabled={isRunning || !paperId} onClick={() => handleRegenerate(activeType.id)}>
              {isRunning ? <Loader2 size={15} className="summary-spin" /> : <RefreshCw size={15} />}
              {isRunning ? '生成中...' : needsManualRefresh ? '更新生成' : summary ? '重新生成' : '生成'}
            </button>
            <div className="summary-export-wrap">
              <button
                className="summary-secondary-action"
                type="button"
                disabled={!summary || isRunning}
                aria-expanded={exportMenuOpen}
                onClick={() => setExportMenuOpen((open) => !open)}
              >
                <Download size={15} />
                导出
              </button>
              {exportMenuOpen && summary && !isRunning ? (
                <div className="summary-export-popover">
                  <button type="button" onClick={() => handleExport(activeType, summary, 'pdf')}>PDF</button>
                  <button type="button" onClick={() => handleExport(activeType, summary, 'word')}>Word</button>
                </div>
              ) : null}
            </div>
          </div>
          {isRunning ? (
            <div className="summary-detail__loading">
              <Sparkles size={18} />
              <strong>正在做质量优先总结</strong>
              <p>先提取全文和证据，再生成对应板块内容。复现和组会稿会更慢一些。</p>
            </div>
          ) : null}
          {needsManualRefresh ? <div className="summary-stale-note">标注已变化，正在显示上一次生成的标注总结。点击“更新生成”后才会读取当前仍存在的高亮和划线。</div> : null}
          {!activeSummary?.isStale && !annotationCountMismatch && activeSummary?.errorMessage ? <div className="summary-error-note">{activeSummary.errorMessage}</div> : null}
          {summary?.highlights?.length ? (
            <section className="summary-highlight-block" aria-label="关键结论">
              <div className="summary-highlight-heading">
                <span>关键结论</span>
              </div>
              <div className="summary-highlight-grid">
                {summary.highlights.map((item, index) => (
                  <div className="summary-highlight" key={`${item}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {activeType.id === 'review' && reviewFieldBlocks.length ? renderReviewFieldBlocks(reviewFieldBlocks, onJumpToEvidence) : null}
          {activeType.id === 'annotations' && summary ? (
            <section className="summary-annotation-block" aria-label="标注清单">
              <div className="summary-annotation-block__head">
                <div>
                  <strong>标注清单</strong>
                  <span>{annotationTotal} 条{annotationTotalLabel}</span>
                </div>
                {liveAnnotationTotal ? (
                  <button className="summary-clear-annotations" type="button" onClick={onClearAnnotations}>
                    <Trash2 size={12} />
                    清空
                  </button>
                ) : null}
              </div>
              {annotationTotal ? (
                <div className="summary-annotation-groups">
                  {annotationGroups.map((group) => (
                    <details className="summary-annotation-group" key={group.type}>
                      <summary>
                        <span>{group.label || group.type}</span>
                        <b>{group.count || 0} 条</b>
                      </summary>
                      {(group.items || []).length ? (
                        <ol>
                          {group.items.map((item, itemIndex) => (
                            <li key={`${group.type}-${item.id || itemIndex}`}>
                              <strong>{String(itemIndex + 1).padStart(2, '0')}</strong>
                              <button
                                className="summary-source-link"
                                type="button"
                                disabled={!item.page}
                                onClick={() => onJumpToEvidence?.({ ...item, source_type: 'annotation' })}
                              >
                                {item.page ? `第 ${item.page} 页：` : ''}{item.quote}
                              </button>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>暂无。</p>
                      )}
                    </details>
                  ))}
                </div>
              ) : (
                <p className="summary-annotation-empty">当前没有高亮、下划线或波浪线标注。先在论文里留下阅读痕迹，再生成标注总结会更有价值。</p>
              )}
            </section>
          ) : null}
          {resolvedDisplaySections.length ? (
            <div className="summary-section-list">
              {resolvedDisplaySections.map((section, index) => (
                <article className={`summary-section ${!sections.length ? 'is-preview' : ''}`} key={`${section.heading}-${index}`} style={{ '--summary-section-index': index }}>
                  <span className="summary-section__index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h4>{section.heading}</h4>
                    {section.keywords?.length ? (
                      <div className="summary-keyword-row">
                        {section.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                      </div>
                    ) : null}
                    {renderSummaryBodyText(section.body)}
                    {section.evidence?.length ? (
                      <EvidenceList evidence={section.evidence} onJumpToEvidence={onJumpToEvidence} />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {assistantPanels.length ? (
            <section className="summary-assistant-block" aria-label="研究助手">
              <h4>研究助手</h4>
              <div className="summary-assistant-grid">
                {assistantPanels.map((panel) => (
                  <article className="summary-assistant-card" key={panel.title}>
                    <strong>{panel.title}</strong>
                    <ol>
                      {panel.items.map((item, index) => <li key={`${panel.title}-${index}`}>{item}</li>)}
                    </ol>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {summary?.missing_items?.length || summary?.followup_questions?.length ? (
            <div className="summary-tail-grid">
              {summary?.missing_items?.length ? (
                <section>
                  <h4>回查清单</h4>
                  {summary.missing_items.map((item) => <p key={item}>{item}</p>)}
                </section>
              ) : null}
              {summary?.followup_questions?.length ? (
                <section>
                  <h4>可继续深挖的问题</h4>
                  {summary.followup_questions.map((item) => <p key={item}>{item}</p>)}
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  return (
    <div className="workspace-panel__content summary-panel">
      <section className="summary-home">
        <div className="summary-home__hero">
          <h3>文献总结</h3>
          <p>按研究生深读场景生成五类结构化卡片，结果会保存，详情页可导出为 PDF 或 Word。</p>
          <div className="summary-home__meta">
            <strong>{generatedCount}/5 已生成</strong>
            <span>
              {isLoadingSummaries
                ? '正在读取缓存'
                : generatingCount
                  ? `${generatingCount} 个正在生成`
                  : `当前 ${annotations.length} 条标注`}
            </span>
          </div>
          <button className="summary-generate-all" type="button" disabled={generatingCount > 0 || isGeneratingAll || !paperId} onClick={handleGenerateAll}>
            {isGeneratingAll ? <Loader2 size={15} className="summary-spin" /> : <Sparkles size={15} />}
            全部生成
          </button>
        </div>
        <div className="summary-card-grid">
          {QUALITY_SUMMARY_TYPES.map((type) => {
            const state = summaryState[type.id]
            const status = getQualitySummaryDisplayStatus(state)
            const visualStatus = visualQualitySummaryStatus(status)
            const preview = state?.isStale
              ? (state?.summary?.preview || state?.preview || type.emptyHint)
              : (state?.preview || state?.summary?.preview || type.emptyHint)
            const Icon = type.Icon
            return (
              <button
                className={`summary-card ${type.themeClass} is-${visualStatus} ${state?.justCompleted ? 'is-complete-flash' : ''}`}
                type="button"
                key={type.id}
                onClick={() => handleCardClick(type)}
              >
                <div className="summary-card__top">
                  <span className="summary-card__icon">
                    <Icon size={19} />
                  </span>
                  <span className={`summary-status summary-status--${visualStatus}`}>
                    {state?.status === 'running' ? <Loader2 size={12} className="summary-spin" /> : null}
                    {QUALITY_SUMMARY_STATUS_LABELS[status] || QUALITY_SUMMARY_STATUS_LABELS.idle}
                  </span>
                </div>
                <h4>{type.title}</h4>
                <p className="summary-card__subtitle">{type.subtitle}</p>
                <p className={`summary-card__preview ${status === 'idle' ? 'is-muted' : ''}`}>{preview}</p>
                {state?.status === 'running' ? (
                  <div className="summary-card__progress">
                    <span style={{ width: `${Math.max(0, Math.min(100, state?.progress || 0))}%` }} />
                  </div>
                ) : null}
                <div className="summary-card__footer">
                  <span>{state?.updatedAt ? `更新于 ${formatQualitySummaryTime(state.updatedAt)}` : '点击进入详情'}</span>
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
  annotations,
  providerId,
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
  uiFontScale = 1,
  onChatInputChange,
  onChatSubmit,
  onRefreshInitialSuggestions,
  onInsertSummaryNote,
  onJumpToEvidence,
  onClearAnnotations,
  initialSummaryId = '',
}) {
  if (!activePanel) return null

  return (
    <aside className="workspace-panel" style={{ width, '--ui-reader-scale': uiFontScale }}>
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
      {activePanel === 'summary' ? (
        <QualityLiteratureSummaryPanel
          paperId={paperId}
          fileName={fileName}
          metadata={metadata}
          annotations={annotations || []}
          providerId={providerId}
          onJumpToEvidence={onJumpToEvidence}
          onClearAnnotations={onClearAnnotations}
          onInsertSummaryNote={onInsertSummaryNote}
          initialSummaryId={initialSummaryId}
        />
      ) : null}
    </aside>
  )
}

