import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bold,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCopy,
  Copy,
  Crown,
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
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { getStoredAuthToken } from '../../services/authApi'
import { checkNotesExportAllowed } from '../../services/paperReaderApi'
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
import { resolveAssetUrl } from '../../utils/assetUrl'
import { resolveApiErrorMessage } from '../../utils/errorMessage'
import { PaperReadingBriefPanel } from './PaperReadingBriefPanel'

function buildPaperTitle(fileName) {
  if (!fileName) return 'Untitled paper'
  return fileName.replace(/\.pdf$/i, '')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

const FREE_NOTE_TEMPLATE_IDS = new Set([
  'blank',
  'default',
  'review_writing',
  'paper_reproduction',
  'writing_citation',
])

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

function createMetadataDraft(metadata = {}) {
  return {
    title: metadata.title || '',
    doi: metadata.doi || '',
    arxivId: metadata.arxivId || '',
    author: metadata.author || '',
    subject: metadata.subject || '',
    keywords: metadata.keywords || '',
  }
}

function displayValue(value) {
  return value || 'PDF 元数据中未识别'
}

function buildLiteratureLookupQuery(doi, arxivId, title) {
  const params = new URLSearchParams()
  if (doi) params.set('doi', doi)
  if (arxivId) params.set('arxiv_id', arxivId)
  if (title) params.set('title', title)
  return params.toString()
}

async function parseLiteratureResponse(response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(resolveApiErrorMessage(payload, '外部文献数据加载失败，请稍后重试。'))
  }
  return payload
}

async function fetchReferences(doi, arxivId, title) {
  const token = getStoredAuthToken()
  const response = await fetch(`/api/papers/references?${buildLiteratureLookupQuery(doi, arxivId, title)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return parseLiteratureResponse(response)
}

async function fetchCitations(doi, arxivId, title) {
  const token = getStoredAuthToken()
  const response = await fetch(`/api/papers/citations?${buildLiteratureLookupQuery(doi, arxivId, title)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return parseLiteratureResponse(response)
}

function renderLiteratureTitle(item) {
  const title = item.title || 'Untitled'
  if (item.doi) {
    return (
      <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noopener" className="ref-link">
        {title}
      </a>
    )
  }
  if (item.arxiv_id) {
    return (
      <a href={`https://arxiv.org/abs/${item.arxiv_id}`} target="_blank" rel="noopener" className="ref-link">
        {title}
      </a>
    )
  }
  return title
}

function InfoPanel({ fileName, metadata, onRefreshMetadata, onSaveMetadata, paperId }) {
  const [activeTab, setActiveTab] = useState('basic')
  const [cache, setCache] = useState({})
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(() => createMetadataDraft(metadata))
  const [refreshingMetadata, setRefreshingMetadata] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const doi = metadata.doi || ''
  const arxivId = metadata.arxivId || ''
  const paperTitle = useMemo(() => metadata.title || buildPaperTitle(fileName), [fileName, metadata.title])
  const lookupMode = doi ? 'DOI' : (arxivId ? 'arXiv' : (paperTitle ? '标题' : ''))
  const lookupKey = doi || (arxivId ? `arxiv:${arxivId}` : (paperTitle ? `title:${paperTitle}` : ''))
  const refs = cache[`${lookupKey}:refs`]
  const cites = cache[`${lookupKey}:cites`]

  const updateCache = (suffix, value) => setCache((previous) => ({ ...previous, [`${lookupKey}${suffix}`]: value }))

  const updateDraft = (field, value) => {
    setDraft((previous) => ({ ...previous, [field]: value }))
  }

  function loadLiterature(kind) {
    if (!lookupKey) return
    const suffix = kind === 'references' ? ':refs' : ':cites'
    const request = kind === 'references' ? fetchReferences : fetchCitations
    const resultKey = kind === 'references' ? 'references' : 'citations'
    const fallback = kind === 'references' ? '参考文献加载失败' : '被引文献加载失败'

    updateCache(suffix, { loading: true, data: [], source: '' })
    request(doi, arxivId, paperTitle)
      .then((data) => updateCache(suffix, {
        loading: false,
        data: data?.[resultKey] || [],
        source: data?.source || '',
      }))
      .catch((error) => updateCache(suffix, {
        loading: false,
        data: [],
        source: error?.message || fallback,
      }))
  }

  async function handleSaveMetadata(event) {
    event?.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError('')
    try {
      if (onSaveMetadata) {
        await onSaveMetadata(paperId, draft)
      }
      setCache({})
      setIsEditing(false)
    } catch (error) {
      setSaveError(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleRefreshMetadata() {
    if (refreshingMetadata || !onRefreshMetadata) return
    setRefreshingMetadata(true)
    setRefreshError('')
    setSaveError('')
    try {
      const result = await onRefreshMetadata(paperId)
      if (result?.metadata) {
        setDraft(createMetadataDraft(result.metadata))
      }
      setCache({})
      setIsEditing(false)
    } catch (error) {
      setRefreshError(error?.message || '重新识别失败')
    } finally {
      setRefreshingMetadata(false)
    }
  }

  useEffect(() => {
    if (!isEditing) {
      setDraft(createMetadataDraft(metadata))
    }
  }, [isEditing, metadata])

  useEffect(() => {
    if (activeTab !== 'references' || !lookupKey || refs) return
    loadLiterature('references')
  }, [activeTab, arxivId, doi, lookupKey, paperTitle, refs])

  useEffect(() => {
    if (activeTab !== 'citations' || !lookupKey || cites) return
    loadLiterature('citations')
  }, [activeTab, arxivId, cites, doi, lookupKey, paperTitle])

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
          {isEditing ? (
            <form className="workspace-metadata-editor" onSubmit={handleSaveMetadata}>
              <div className="workspace-metadata-editor__header">
                <h3>编辑基本信息</h3>
                <div className="workspace-metadata-editor__actions">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(createMetadataDraft(metadata))
                      setSaveError('')
                      setRefreshError('')
                      setIsEditing(false)
                    }}
                    disabled={saving}
                    aria-label="取消"
                    title="取消"
                  >
                    <X size={14} />
                  </button>
                  <button type="submit" disabled={saving} aria-label="保存" title="保存">
                    {saving ? <Loader2 size={14} className="is-spinning" /> : <Save size={14} />}
                  </button>
                </div>
              </div>
              <label>
                <span>标题</span>
                <input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} />
              </label>
              <label>
                <span>DOI</span>
                <input value={draft.doi} onChange={(event) => updateDraft('doi', event.target.value)} />
              </label>
              <label>
                <span>arXiv ID</span>
                <input value={draft.arxivId} onChange={(event) => updateDraft('arxivId', event.target.value)} />
              </label>
              <label>
                <span>作者</span>
                <input value={draft.author} onChange={(event) => updateDraft('author', event.target.value)} />
              </label>
              <label>
                <span>主题摘要</span>
                <textarea value={draft.subject} onChange={(event) => updateDraft('subject', event.target.value)} rows={4} />
              </label>
              <label>
                <span>关键词</span>
                <input value={draft.keywords} onChange={(event) => updateDraft('keywords', event.target.value)} />
              </label>
              {saveError ? <p className="workspace-metadata-editor__error">{saveError}</p> : null}
            </form>
          ) : (
            <>
              <div className="workspace-title-card">
                <div className="workspace-title-card__header">
                  <h3>{paperTitle}</h3>
                  <div className="workspace-title-card__actions">
                    {onRefreshMetadata ? (
                      <button
                        type="button"
                        onClick={() => void handleRefreshMetadata()}
                        disabled={refreshingMetadata}
                        aria-label="重新识别元数据"
                        title="重新识别元数据"
                      >
                        {refreshingMetadata ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(createMetadataDraft(metadata))
                        setSaveError('')
                        setRefreshError('')
                        setIsEditing(true)
                      }}
                      aria-label="编辑基本信息"
                      title="编辑基本信息"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>
                <p>主题摘要：{displayValue(metadata.subject)}</p>
                {refreshError ? <p className="workspace-metadata-editor__error">{refreshError}</p> : null}
              </div>
              <div className="workspace-info-grid">
                <div><span>DOI / arXiv</span><p>{displayValue(metadata.doi || metadata.arxivId)}</p></div>
                <div><span>作者</span><p>{displayValue(metadata.author)}</p></div>
                <div><span>关键词</span><p>{displayValue(metadata.keywords)}</p></div>
                <div><span>页数 / 大小</span><p>{metadata.pageCount || '-'} 页{metadata.fileSize ? ` / ${metadata.fileSize}` : ''}</p></div>
                <div><span>生成工具</span><p>{displayValue(metadata.creator || metadata.producer)}</p></div>
                <div><span>创建 / 修改</span><p>{displayValue([metadata.creationDate, metadata.modificationDate].filter(Boolean).join(' / '))}</p></div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'references' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card workspace-ref-list">
            <div className="workspace-ref-list__header">
              <h3>参考文献</h3>
              {lookupKey ? (
                <button
                  type="button"
                  onClick={() => loadLiterature('references')}
                  disabled={Boolean(refs?.loading)}
                  aria-label="重新检索参考文献"
                  title="重新检索参考文献"
                >
                  {refs?.loading ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />}
                </button>
              ) : null}
            </div>
            {!lookupKey ? <p className="muted">这篇文献暂未识别标题、DOI 或 arXiv ID。</p> : null}
            {lookupKey && !refs?.loading ? <p className="card-footnote">检索方式：{lookupMode} 匹配</p> : null}
            {lookupKey && refs?.loading ? <p className="muted">正在通过 {lookupMode} 匹配外部文献库...</p> : null}
            {lookupKey && !refs?.loading && refs?.data?.length > 0 ? refs.data.map((reference, index) => (
              <p key={`${reference.title || 'ref'}:${index}`}>
                [{index + 1}] {renderLiteratureTitle(reference)}
                {reference.authors ? ` · ${reference.authors}` : ''}
                {reference.year ? ` (${reference.year})` : ''}
              </p>
            )) : null}
            {lookupKey && !refs?.loading && (!refs?.data || refs.data.length === 0) ? <p className="muted">暂未获取到参考文献数据。</p> : null}
            {refs?.source ? <p className="card-footnote">来源：{refs.source}</p> : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'citations' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card workspace-ref-list">
            <div className="workspace-ref-list__header">
              <h3>被引文献</h3>
              {lookupKey ? (
                <button
                  type="button"
                  onClick={() => loadLiterature('citations')}
                  disabled={Boolean(cites?.loading)}
                  aria-label="重新检索被引文献"
                  title="重新检索被引文献"
                >
                  {cites?.loading ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />}
                </button>
              ) : null}
            </div>
            {!lookupKey ? <p className="muted">这篇文献暂未识别标题、DOI 或 arXiv ID。</p> : null}
            {lookupKey && !cites?.loading ? <p className="card-footnote">检索方式：{lookupMode} 匹配</p> : null}
            {lookupKey && cites?.loading ? <p className="muted">正在通过 {lookupMode} 匹配外部文献库...</p> : null}
            {lookupKey && !cites?.loading && cites?.data?.length > 0 ? cites.data.map((citation, index) => (
              <p key={`${citation.title || 'cite'}:${index}`}>
                [{index + 1}] {renderLiteratureTitle(citation)}
                {citation.authors ? ` · ${citation.authors}` : ''}
                {citation.year ? ` (${citation.year})` : ''}
              </p>
            )) : null}
            {lookupKey && !cites?.loading && (!cites?.data || cites.data.length === 0) ? <p className="muted">暂未获取到被引数据。</p> : null}
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
    syncTextareaHeight(textarea)
  }, [doc.text, showEditor])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !showEditor) return undefined
    return watchTextareaHeight(textarea)
  }, [showEditor])

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
    syncTextareaHeight(ref.current)
  }, [value])

  useEffect(() => {
    const textarea = ref.current
    if (!textarea) return undefined
    return watchTextareaHeight(textarea)
  }, [])

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

function getPlainNoteText(value) {
  return parseRichNoteContent(value).text
}

function syncTextareaHeight(textarea) {
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.max(34, textarea.scrollHeight)}px`
}

function watchTextareaHeight(textarea) {
  syncTextareaHeight(textarea)

  let frameId = 0
  const scheduleSync = () => {
    if (typeof requestAnimationFrame === 'undefined') {
      syncTextareaHeight(textarea)
      return
    }
    if (frameId) cancelAnimationFrame(frameId)
    frameId = requestAnimationFrame(() => {
      frameId = 0
      syncTextareaHeight(textarea)
    })
  }

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSync) : null
  observer?.observe(textarea)
  if (textarea.parentElement) observer?.observe(textarea.parentElement)

  const targetWindow = typeof window !== 'undefined' ? window : null
  targetWindow?.addEventListener('resize', scheduleSync)

  return () => {
    if (frameId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frameId)
    observer?.disconnect()
    targetWindow?.removeEventListener('resize', scheduleSync)
  }
}

function getNoteExportTitle(fileName, metadata) {
  return metadata?.title || buildPaperTitle(fileName) || '阅读笔记'
}

function sanitizeNoteExportName(value, fallback = 'reading-notes') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, 80)
}

function triggerNoteDownload(content, fileName, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function formatNoteExportTime() {
  return new Date().toLocaleString('zh-CN')
}

const NOTE_EXPORT_PALETTES = [
  { accent: '#2563EB', soft: '#EFF6FF', wash: '#DBEAFE', text: '#1D4ED8', dark: '#1E3A8A' },
  { accent: '#0F766E', soft: '#F0FDFA', wash: '#CCFBF1', text: '#0F766E', dark: '#134E4A' },
  { accent: '#D97706', soft: '#FFFBEB', wash: '#FDE68A', text: '#B45309', dark: '#78350F' },
  { accent: '#DC2626', soft: '#FEF2F2', wash: '#FECACA', text: '#B91C1C', dark: '#7F1D1D' },
  { accent: '#7C3AED', soft: '#F5F3FF', wash: '#DDD6FE', text: '#6D28D9', dark: '#4C1D95' },
  { accent: '#0891B2', soft: '#ECFEFF', wash: '#CFFAFE', text: '#0E7490', dark: '#164E63' },
  { accent: '#16A34A', soft: '#F0FDF4', wash: '#BBF7D0', text: '#15803D', dark: '#14532D' },
  { accent: '#DB2777', soft: '#FDF2F8', wash: '#FBCFE8', text: '#BE185D', dark: '#831843' },
]

function getNoteExportPalette(index = 0) {
  return NOTE_EXPORT_PALETTES[Math.abs(Number(index) || 0) % NOTE_EXPORT_PALETTES.length]
}

function notePaletteStyle(palette) {
  return [
    `--note-accent:${palette.accent}`,
    `--note-soft:${palette.soft}`,
    `--note-wash:${palette.wash}`,
    `--note-text:${palette.text}`,
    `--note-dark:${palette.dark}`,
  ].join(';')
}

function noteBlockSourceText(block) {
  return block?.page_number ? `第 ${block.page_number} 页` : ''
}

function escapeMarkdownText(value) {
  return String(value || '').replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
}

function markdownQuote(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.split(/\n/).map((line) => `> ${line || ' '}`).join('\n')
}

function countNotebookTree(treeNodes = []) {
  return treeNodes.reduce((stats, node) => {
    stats.nodes += 1
    for (const block of node.blocks || []) {
      stats.blocks += 1
      if (block.type === 'quote') stats.quotes += 1
      else if (block.type === 'image') stats.images += 1
      else stats.texts += 1
    }
    const childStats = countNotebookTree(node.children || [])
    stats.nodes += childStats.nodes
    stats.blocks += childStats.blocks
    stats.quotes += childStats.quotes
    stats.images += childStats.images
    stats.texts += childStats.texts
    return stats
  }, { nodes: 0, blocks: 0, quotes: 0, images: 0, texts: 0 })
}

function buildNoteExportStats(notebooks = []) {
  return notebooks.reduce((stats, notebook) => {
    const treeStats = countNotebookTree(buildNodeChildren(notebook.nodes || [], null))
    stats.notebooks += 1
    stats.nodes += treeStats.nodes
    stats.blocks += treeStats.blocks
    stats.quotes += treeStats.quotes
    stats.images += treeStats.images
    stats.texts += treeStats.texts
    return stats
  }, { notebooks: 0, nodes: 0, blocks: 0, quotes: 0, images: 0, texts: 0 })
}

function renderNoteBlockMarkdown(block) {
  const source = noteBlockSourceText(block)
  if (block.type === 'quote') {
    const quote = markdownQuote(block.content || '')
    return [
      source ? `> 来源：${source}` : '',
      quote,
    ].filter(Boolean).join('\n')
  }

  if (block.type === 'image') {
    const label = source ? `截图（${source}）` : '截图'
    const src = block.image_url || ''
    const caption = String(block.content || '').trim()
    return [
      src ? `![${escapeMarkdownText(label)}](${src})` : `![${escapeMarkdownText(label)}]()`,
      caption ? escapeMarkdownText(caption) : '',
    ].filter(Boolean).join('\n')
  }

  const text = getPlainNoteText(block.content || '').trim()
  return text ? escapeMarkdownText(text) : ''
}

function renderNoteNodeMarkdown(node) {
  const level = Math.max(3, Math.min(6, Number(node.level || 1) + 2))
  const heading = `${'#'.repeat(level)} ${node.title || '未命名标题'}`
  const blocks = (node.blocks || [])
    .map(renderNoteBlockMarkdown)
    .filter(Boolean)
    .join('\n\n')
  const children = (node.children || [])
    .map(renderNoteNodeMarkdown)
    .filter(Boolean)
    .join('\n\n')
  return [heading, blocks, children].filter(Boolean).join('\n\n')
}

function buildNoteExportMarkdown(notebooks, fileName, metadata) {
  const title = getNoteExportTitle(fileName, metadata)
  const stats = buildNoteExportStats(notebooks || [])
  const sections = (notebooks || []).map((notebook) => {
    const tree = buildNodeChildren(notebook.nodes || [], null)
    const content = tree.map(renderNoteNodeMarkdown).filter(Boolean).join('\n\n')
    return [
      `## ${notebook.title || '未命名笔记本'}`,
      content || '> 暂无笔记内容。',
    ].join('\n\n')
  })

  return [
    `# ${title} - 阅读笔记`,
    `导出时间：${formatNoteExportTime()}`,
    `笔记本：${stats.notebooks} 个｜标题：${stats.nodes} 个｜内容块：${stats.blocks} 个`,
    '',
    sections.join('\n\n'),
    '',
  ].join('\n')
}

function resolveNoteExportImageUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^(https?:|data:|blob:)/i.test(value)) return value
  if (typeof window !== 'undefined' && value.startsWith('/')) {
    return `${window.location.origin}${value}`
  }
  return value
}

function renderRichNoteHtml(value) {
  const doc = parseRichNoteContent(value)
  const segments = buildRichTextSegments(doc)
  const html = segments
    .map((segment) => {
      const text = escapeHtml(segment.text || '')
      if (!text) return ''
      if (segment.color && segment.color !== DEFAULT_NOTE_TEXT_COLOR) {
        return `<span style="color:${escapeHtml(segment.color)}">${text}</span>`
      }
      return text
    })
    .join('')
    .replace(/\n/g, '<br />')
  return html || '<span class="export-note-muted">空白笔记</span>'
}

function renderNoteBlockHtml(block) {
  const source = noteBlockSourceText(block)
  if (block.type === 'quote') {
    return `
      <blockquote class="export-note-quote">
        ${source ? `<span class="export-note-source">${escapeHtml(source)}</span>` : ''}
        <p>${escapeHtml(block.content || '').replace(/\n/g, '<br />')}</p>
      </blockquote>
    `
  }

  if (block.type === 'image') {
    const src = resolveNoteExportImageUrl(block.image_url)
    return `
      <figure class="export-note-image">
        ${src ? `<img src="${escapeHtml(src)}" alt="笔记截图" />` : '<div class="export-note-image__empty">图片未保存</div>'}
        ${source || block.content ? `<figcaption>${escapeHtml([source, block.content].filter(Boolean).join(' / '))}</figcaption>` : ''}
      </figure>
    `
  }

  return `<div class="export-note-text">${renderRichNoteHtml(block.content || '')}</div>`
}

function renderNoteNodeHtml(node, indexPath = []) {
  const level = Number(node.level || 1)
  const headingLevel = Math.max(3, Math.min(6, level + 2))
  const palette = getNoteExportPalette(node.color_index ?? indexPath.at(-1) ?? level)
  const marker = indexPath.map((item) => item + 1).join('.')
  const blocks = (node.blocks || []).map(renderNoteBlockHtml).join('')
  const children = (node.children || []).map((child, childIndex) => (
    renderNoteNodeHtml(child, [...indexPath, childIndex])
  )).join('')
  return `
    <section class="export-note-node export-note-node--level-${level}" style="${notePaletteStyle(palette)}">
      <div class="export-note-heading export-note-heading--level-${level}">
        <span>${escapeHtml(marker || '•')}</span>
        <h${headingLevel}>${escapeHtml(node.title || '未命名标题')}</h${headingLevel}>
      </div>
      <div class="export-note-node__body">
        ${blocks || '<p class="export-note-muted">暂无内容。</p>'}
        ${children}
      </div>
    </section>
  `
}

function buildNoteExportHtml(notebooks, fileName, metadata) {
  const title = getNoteExportTitle(fileName, metadata)
  const generatedAt = formatNoteExportTime()
  const stats = buildNoteExportStats(notebooks || [])
  const overviewHtml = [
    ['笔记本', stats.notebooks],
    ['标题', stats.nodes],
    ['文本', stats.texts],
    ['摘录', stats.quotes],
    ['截图', stats.images],
  ].map(([label, value], index) => {
    const palette = getNoteExportPalette(index)
    return `
      <div class="export-note-stat" style="${notePaletteStyle(palette)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `
  }).join('')
  const tocHtml = (notebooks || []).map((notebook, index) => {
    const palette = getNoteExportPalette(index)
    const treeStats = countNotebookTree(buildNodeChildren(notebook.nodes || [], null))
    return `
      <div class="export-note-toc-item" style="${notePaletteStyle(palette)}">
        <b>${String(index + 1).padStart(2, '0')}</b>
        <span>${escapeHtml(notebook.title || '未命名笔记本')}</span>
        <small>${treeStats.nodes} 个标题 / ${treeStats.blocks} 条内容</small>
      </div>
    `
  }).join('')
  const notebookHtml = (notebooks || []).map((notebook, index) => {
    const palette = getNoteExportPalette(index)
    const tree = buildNodeChildren(notebook.nodes || [], null)
    return `
      <section class="export-note-book" style="${notePaletteStyle(palette)}">
        <div class="export-note-book__header">
          <span>${String(index + 1).padStart(2, '0')}</span>
          <div>
            <h2>${escapeHtml(notebook.title || '未命名笔记本')}</h2>
            <p>${tree.length} 个一级标题</p>
          </div>
        </div>
        ${tree.length ? tree.map((node, nodeIndex) => renderNoteNodeHtml(node, [nodeIndex])).join('') : '<p class="export-note-muted">暂无笔记内容。</p>'}
      </section>
    `
  }).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} - 阅读笔记</title>
  <style>
    @page { size: A4; margin: 17mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #eef2f7;
      color: #172033;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
      line-height: 1.72;
    }
    .export-note-document {
      width: min(900px, 100%);
      margin: 0 auto;
      background: #ffffff;
      min-height: 100vh;
      padding: 46px 52px 64px;
    }
    .export-note-cover {
      position: relative;
      overflow: hidden;
      border: 1px solid #dbeafe;
      border-radius: 22px;
      padding: 28px 30px;
      margin-bottom: 26px;
      background:
        linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(15, 118, 110, 0.08) 46%, rgba(217, 119, 6, 0.10)),
        #fbfdff;
    }
    .export-note-type {
      display: inline-flex;
      padding: 5px 12px;
      border-radius: 999px;
      background: #0f172a;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
    }
    h1 { margin: 16px 0 10px; color: #0f172a; font-size: 30px; line-height: 1.22; }
    .export-note-meta { color: #475569; font-size: 12px; }
    .export-note-overview {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin: 20px 0 0;
    }
    .export-note-stat {
      min-height: 68px;
      border: 1px solid var(--note-wash);
      border-radius: 16px;
      padding: 10px 12px;
      background: var(--note-soft);
    }
    .export-note-stat span { display: block; color: var(--note-text); font-size: 12px; font-weight: 700; }
    .export-note-stat strong { display: block; margin-top: 5px; color: var(--note-dark); font-size: 24px; line-height: 1; }
    .export-note-toc {
      display: grid;
      gap: 9px;
      margin: 22px 0 30px;
    }
    .export-note-toc-title {
      margin: 0 0 2px;
      color: #0f172a;
      font-size: 14px;
      font-weight: 800;
    }
    .export-note-toc-item {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 11px 13px;
      border: 1px solid var(--note-wash);
      border-radius: 14px;
      background: linear-gradient(90deg, var(--note-soft), #ffffff);
    }
    .export-note-toc-item b {
      color: var(--note-text);
      font-size: 13px;
    }
    .export-note-toc-item span {
      min-width: 0;
      color: #172033;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .export-note-toc-item small { color: #64748b; font-size: 12px; }
    .export-note-book {
      margin: 30px 0 0;
      padding-top: 6px;
      page-break-inside: auto;
    }
    .export-note-book__header {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid var(--note-wash);
      background: linear-gradient(135deg, var(--note-soft), #ffffff 74%);
    }
    .export-note-book__header > span {
      width: 42px;
      height: 42px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--note-accent);
      color: #ffffff;
      font-weight: 800;
    }
    .export-note-book h2 { margin: 0; color: var(--note-dark); font-size: 22px; line-height: 1.28; }
    .export-note-book__header p { margin: 4px 0 0; color: var(--note-text); font-size: 12px; }
    .export-note-node {
      margin: 16px 0;
      page-break-inside: avoid;
    }
    .export-note-node--level-2 { margin-left: 18px; }
    .export-note-node--level-3 { margin-left: 36px; }
    .export-note-heading {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 9px;
      align-items: center;
      margin: 14px 0 8px;
    }
    .export-note-heading span {
      min-width: 30px;
      min-height: 28px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--note-accent);
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
    }
    .export-note-heading h3,
    .export-note-heading h4,
    .export-note-heading h5,
    .export-note-heading h6 {
      margin: 0;
      color: var(--note-dark);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .export-note-heading h3 { font-size: 17px; }
    .export-note-heading h4 { font-size: 15px; }
    .export-note-heading h5,
    .export-note-heading h6 { font-size: 14px; }
    .export-note-node__body {
      border-left: 2px solid var(--note-wash);
      margin-left: 15px;
      padding-left: 18px;
    }
    .export-note-text {
      margin: 9px 0;
      padding: 11px 13px;
      border-radius: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      color: #243246;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .export-note-quote {
      margin: 10px 0;
      padding: 13px 15px;
      border: 1px solid var(--note-wash);
      border-left: 5px solid var(--note-accent);
      border-radius: 14px;
      background: var(--note-soft);
      color: #334155;
    }
    .export-note-quote p { margin: 7px 0 0; }
    .export-note-source {
      display: inline-flex;
      padding: 2px 8px;
      border-radius: 999px;
      background: #ffffff;
      color: var(--note-text);
      font-size: 12px;
      font-weight: 800;
    }
    .export-note-image {
      margin: 13px 0;
      padding: 13px;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }
    .export-note-image img {
      display: block;
      max-width: 100%;
      max-height: 520px;
      object-fit: contain;
      margin: 0 auto;
      border-radius: 10px;
    }
    .export-note-image figcaption {
      margin-top: 9px;
      color: #64748b;
      font-size: 12px;
      text-align: center;
    }
    .export-note-image__empty {
      padding: 20px;
      color: #94a3b8;
      text-align: center;
      background: #f8fafc;
      border-radius: 12px;
    }
    .export-note-muted { color: #94a3b8; }
    @media print {
      body { background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .export-note-document { width: 100%; padding: 0; }
      .export-note-cover,
      .export-note-book__header,
      .export-note-node,
      .export-note-text,
      .export-note-quote,
      .export-note-image { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="export-note-document">
    <header class="export-note-cover">
      <span class="export-note-type">阅读笔记</span>
      <h1>${escapeHtml(title)}</h1>
      <div class="export-note-meta">导出时间：${escapeHtml(generatedAt)}</div>
      <div class="export-note-overview">${overviewHtml}</div>
    </header>
    ${tocHtml ? `<section class="export-note-toc"><h2 class="export-note-toc-title">笔记目录</h2>${tocHtml}</section>` : ''}
    ${notebookHtml || '<p class="export-note-muted">暂无笔记内容。</p>'}
  </main>
</body>
</html>`
}

function exportNotesAsMarkdown(notebooks, fileName, metadata) {
  const title = getNoteExportTitle(fileName, metadata)
  const markdown = buildNoteExportMarkdown(notebooks, fileName, metadata)
  triggerNoteDownload(
    markdown,
    `${sanitizeNoteExportName(title)}-阅读笔记.md`,
    'text/markdown;charset=utf-8',
  )
}

function exportNotesAsWord(notebooks, fileName, metadata) {
  const title = getNoteExportTitle(fileName, metadata)
  const html = buildNoteExportHtml(notebooks, fileName, metadata)
  triggerNoteDownload(
    `\ufeff${html}`,
    `${sanitizeNoteExportName(title)}-阅读笔记.doc`,
    'application/msword;charset=utf-8',
  )
}

function exportNotesAsPdf(notebooks, fileName, metadata) {
  const html = buildNoteExportHtml(notebooks, fileName, metadata)
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
  }, 300)
}

function NotesPanel({
  paperId,
  fileName,
  metadata,
  notebooks,
  loading,
  saving,
  saveStatus = 'idle',
  saveError = '',
  hasUnsavedChanges = false,
  currentUser,
  activeTarget,
  onCreateNotebook,
  onDraftChange,
  onSaveNotebooks,
  onRetrySave,
  onRequireVip,
  onSetActiveTarget,
  onJumpToNote,
}) {
  const [prefs, setPrefs] = useState(() => readNotePrefs(paperId))
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [templateDialogTab, setTemplateDialogTab] = useState('system')
  const [customTemplates, setCustomTemplates] = useState(() => readStoredCustomTemplates())
  const [colorCommand, setColorCommand] = useState(null)
  const [noteExportMenuOpen, setNoteExportMenuOpen] = useState(false)
  const notesStyle = useMemo(() => buildNotesStyle(prefs), [prefs])
  const hasNotebooks = (notebooks || []).length > 0
  const canExportNotes = Boolean(currentUser?.features?.can_export_notes)
  const effectiveSaveStatus = saving ? 'saving' : saveStatus
  const saveStatusText = (() => {
    if (effectiveSaveStatus === 'saving') return '保存中...'
    if (effectiveSaveStatus === 'error') return '保存失败，点击重试'
    if (hasUnsavedChanges || effectiveSaveStatus === 'dirty') return '有未保存内容'
    return '已保存'
  })()
  const saveIndicatorStatus = (() => {
    if (effectiveSaveStatus === 'saving') return 'saving'
    if (effectiveSaveStatus === 'error') return 'error'
    if (hasUnsavedChanges || effectiveSaveStatus === 'dirty') return 'dirty'
    return 'saved'
  })()
  const canRetrySave = effectiveSaveStatus === 'error' && !saving
  const systemTemplateOptions = useMemo(
    () => [BLANK_NOTEBOOK_TEMPLATE_OPTION, ...NOTEBOOK_TEMPLATES],
    [],
  )
  const canUseAllTemplates = Boolean(currentUser?.features?.can_use_all_templates)
  const allowedTemplateIds = useMemo(
    () => new Set(currentUser?.features?.allowed_template_ids || FREE_NOTE_TEMPLATE_IDS),
    [currentUser?.features?.allowed_template_ids],
  )

  useEffect(() => {
    setPrefs(readNotePrefs(paperId))
    setColorMenuOpen(false)
    setTemplateMenuOpen(false)
    setTemplateDialogTab('system')
    setNoteExportMenuOpen(false)
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

  function isTemplateAvailable(template) {
    const templateId = String(template?.createKind || template?.id || '')
    if (!templateId || canUseAllTemplates) return true
    if (templateId.startsWith('custom')) return true
    return allowedTemplateIds.has(templateId)
  }

  function handleLockedTemplateClick() {
    window.alert('该模板仅限 VIP 使用，开通 VIP 后即可解锁全部笔记模板。')
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

  function handleNotesExportPermissionError(error) {
    if (error?.status === 403 || error?.code === 'membership_feature_locked') {
      onRequireVip?.()
      return
    }
    window.alert(error?.message || '导出权限校验失败，请稍后再试。')
  }

  async function ensureNotesExportPermission() {
    if (!canExportNotes) {
      onRequireVip?.()
      return false
    }
    if (!paperId) {
      window.alert('当前论文信息缺失，暂不能导出。')
      return false
    }
    try {
      await checkNotesExportAllowed(paperId)
      return true
    } catch (error) {
      handleNotesExportPermissionError(error)
      return false
    }
  }

  async function handleExportNotes(format) {
    const draftNotebooks = notebooks || []
    setNoteExportMenuOpen(false)
    if (!draftNotebooks.length) return
    const allowed = await ensureNotesExportPermission()
    if (!allowed) return
    if (format === 'markdown') {
      exportNotesAsMarkdown(draftNotebooks, fileName, metadata)
      return
    }
    if (format === 'pdf') {
      exportNotesAsPdf(draftNotebooks, fileName, metadata)
      return
    }
    exportNotesAsWord(draftNotebooks, fileName, metadata)
  }

  function renderTemplateCard(template) {
    const Icon = NOTEBOOK_TEMPLATE_ICON_MAP[template.id] || FileText
    const isAvailable = isTemplateAvailable(template)
    return (
      <button
        key={template.id}
        type="button"
        className={`notes-template-card${isAvailable ? '' : ' is-locked'}`}
        aria-disabled={!isAvailable}
        onClick={() => {
          if (!isAvailable) {
            handleLockedTemplateClick()
            return
          }
          handleCreateNotebook(template.createKind || template)
        }}
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
            {isAvailable ? (template.footerText || `${template.sectionCount} 个分区`) : 'VIP 解锁'}
          </span>
        </div>
        {!isAvailable ? (
          <span className="notes-template-card__lock-badge">
            <Crown size={12} />
            VIP
          </span>
        ) : null}
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
          <button
            type="button"
            className={`notes-save-state is-${saveIndicatorStatus}`}
            onClick={canRetrySave ? () => onRetrySave?.() : undefined}
            disabled={!canRetrySave}
            title={saveError || saveStatusText}
            aria-label={saveError || saveStatusText}
          >
            <span className="notes-save-state__dot" />
            <span className="notes-save-state__label">{saveStatusText}</span>
          </button>
          <div className="notes-export-wrap">
            <button
              type="button"
              className="notes-command"
              disabled={!hasNotebooks}
              aria-expanded={noteExportMenuOpen}
              title={canExportNotes ? '导出阅读笔记' : 'VIP 可导出阅读笔记'}
              onClick={() => {
                setColorMenuOpen(false)
                setTemplateMenuOpen(false)
                if (!canExportNotes) {
                  setNoteExportMenuOpen(false)
                  onRequireVip?.()
                  return
                }
                setNoteExportMenuOpen((open) => !open)
              }}
            >
              <Download size={15} />
              <span>导出</span>
            </button>
            {noteExportMenuOpen && hasNotebooks ? (
              <div className="notes-export-popover" role="menu" aria-label="导出阅读笔记">
                <button type="button" onClick={() => handleExportNotes('word')}>Word</button>
                <button type="button" onClick={() => handleExportNotes('pdf')}>PDF</button>
                <button type="button" onClick={() => handleExportNotes('markdown')}>Markdown</button>
              </div>
            ) : null}
          </div>
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

const ASK_INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[第\s*\d+\s*页\])/g

function renderAskInline(value) {
  const text = String(value || '')
  return text.split(ASK_INLINE_TOKEN_RE).filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={`strong-${index}`}>{token.slice(2, -2)}</strong>
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={`code-${index}`}>{token.slice(1, -1)}</code>
    }
    if (/^\[第\s*\d+\s*页\]$/.test(token)) {
      return (
        <span className="ask-citation-pill" key={`citation-${index}`}>
          <FileText size={12} aria-hidden="true" />
          {token.replace(/\s+/g, ' ')}
        </span>
      )
    }
    return <span key={`text-${index}`}>{token}</span>
  })
}

function renderAskMarkdown(value) {
  const lines = String(value || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let paragraph = []
  let list = []

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push(
      <p key={`paragraph-${blocks.length}`}>
        {renderAskInline(paragraph.join(' '))}
      </p>,
    )
    paragraph = []
  }

  function flushList() {
    if (!list.length) return
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={`list-item-${index}`}>{renderAskInline(item)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      return
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push(
        <h4 key={`heading-${blocks.length}`}>
          {renderAskInline(heading[2])}
        </h4>,
      )
      return
    }

    const listItem = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/)
    if (listItem) {
      flushParagraph()
      list.push(listItem[1])
      return
    }

    flushList()
    paragraph.push(trimmed)
  })

  flushParagraph()
  flushList()
  return blocks.length ? blocks : renderAskInline(value)
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
  const currentUserAvatarSrc = resolveAssetUrl(currentUser?.avatar_url)
  const [activeFollowupTabs, setActiveFollowupTabs] = useState({})
  const hasMessages = (messages || []).length > 0

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, followupLoadingMessageId])

  function renderAvatar(isUser) {
    if (isUser) {
      if (currentUserAvatarSrc) {
        return <img src={currentUserAvatarSrc} alt={currentUser.nickname || '用户'} />
      }
      return <span>{userInitials}</span>
    }
    return <Bot size={16} />
  }

  async function copyAnswer(text) {
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard permissions are optional; keep the answer usable when denied.
    }
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

            {activeGroup.rationale ? (
              <div className="ask-followup-card__head">
                <p>{activeGroup.rationale}</p>
              </div>
            ) : null}

            <div className="ask-followup-card__questions">
              {(activeGroup.questions || []).map((question, questionIndex) => (
                <button
                  key={`${message.id}:question:${activeIndex}:${questionIndex}`}
                  type="button"
                  className="ask-followup-question"
                  onClick={() => onSubmit?.(question)}
                >
                  {question}
                  <ChevronRight size={16} aria-hidden="true" />
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
                {!isUser ? (
                  <div className="ask-message-meta">
                    <span>AI 回答</span>
                    {message.status === 'streaming' ? <span className="ask-message-meta__state">正在生成</span> : null}
                  </div>
                ) : null}
                {isUser && message.messageType === 'deep_read' ? (
                  <span className="ask-selection-context">
                    <Highlighter size={12} aria-hidden="true" />
                    围绕选中文字
                  </span>
                ) : null}
                <div
                  className={`ask-bubble${
                    message.status === 'error' ? ' is-error' : ''
                  }${message.status === 'streaming' ? ' is-streaming' : ''}`}
                >
                  {bubbleText ? renderAskMarkdown(bubbleText) : (
                    message.status === 'streaming' ? <span className="ask-typing">正在整理回答</span> : ''
                  )}
                </div>
                {!isUser && bubbleText ? (
                  <div className="ask-answer-actions">
                    <button
                      type="button"
                      title="复制回答"
                      aria-label="复制回答"
                      onClick={() => void copyAnswer(bubbleText)}
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {!isUser ? renderFollowups(message) : null}
              </div>

              {isUser ? <div className="ask-avatar">{renderAvatar(true)}</div> : null}
            </div>
          )
        })}
      </div>

      <div className="ask-composer">
        <div className="ask-input-row">
          <textarea
            className="ask-input"
            placeholder="围绕这篇论文提问..."
            value={inputText || ''}
            rows={1}
            onChange={(event) => onInputChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSubmit?.()
              }
            }}
          />
          <button
            type="button"
            className="ask-send-btn"
            title="发送问题"
            aria-label="发送问题"
            onClick={() => onSubmit?.()}
            disabled={asking || !(inputText || '').trim()}
          >
            <Send size={17} aria-hidden="true" />
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
  notesSaveStatus,
  notesSaveError,
  hasUnsavedNotes,
  onCreateNotebook,
  onDraftChange,
  onSaveNotebooks,
  onRetrySaveNotebooks,
  onRequireVip,
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
  onRefreshMetadata,
  onSaveMetadata,
  paperReadingBrief,
  onRetryPaperReadingBrief,
  onRefreshPaperReadingBrief,
}) {
  if (!activePanel) return null

  return (
    <aside className="workspace-panel" style={{ width, '--ui-reader-scale': uiFontScale }}>
      {activePanel === 'info' ? (
        <InfoPanel
          paperId={paperId}
          fileName={fileName}
          metadata={metadata}
          onRefreshMetadata={onRefreshMetadata}
          onSaveMetadata={onSaveMetadata}
        />
      ) : null}
      {activePanel === 'notes' ? (
        <NotesPanel
          paperId={paperId}
          fileName={fileName}
          metadata={metadata}
          notebooks={notebooks || []}
          loading={notesLoading}
          saving={notesSaving}
          saveStatus={notesSaveStatus}
          saveError={notesSaveError}
          hasUnsavedChanges={hasUnsavedNotes}
          currentUser={currentUser}
          activeTarget={activeNoteTarget}
          onCreateNotebook={onCreateNotebook}
          onDraftChange={onDraftChange}
          onSaveNotebooks={onSaveNotebooks}
          onRetrySave={onRetrySaveNotebooks}
          onRequireVip={onRequireVip}
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
      {activePanel === 'summary' ? (
        <PaperReadingBriefPanel
          brief={paperReadingBrief}
          onRetry={onRetryPaperReadingBrief}
          onRefresh={onRefreshPaperReadingBrief}
        />
      ) : null}
      {activePanel === 'words' ? <FullTranslatePanel /> : null}
    </aside>
  )
}

