import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Bell, Code2, Crown, ListChecks, LogIn, Sparkles, Trash2, X } from 'lucide-react'
import { TaskCenterSheet } from '../components/layout/TaskCenterSheet'
import { UserHoverMenu } from '../components/layout/UserHoverMenu'
import { UtilityRail } from '../components/layout/UtilityRail'
import { DEFAULT_SHAPE_OPTIONS } from '../components/reader/shapeAnnotationModel'
import {
  readReadingSessionSnapshot,
  saveReadingSessionSnapshot,
} from '../components/reader/readingSessionStorage'
import { usePdfReader } from '../hooks/usePdfReader'
import { useAnnotations } from '../hooks/useAnnotations'
import { useInkAnnotations } from '../hooks/useInkAnnotations'
import { usePaperNotes } from '../hooks/usePaperNotes'
import { usePdfSearch } from '../hooks/usePdfSearch'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { useShapeAnnotations } from '../hooks/useShapeAnnotations'
import { useSelectionInsight } from '../hooks/useSelectionInsight'
import {
  createImageBlockDraft,
  createQuoteBlockDraft,
  createTextBlockDraft,
  ensureInsertTarget,
  insertBlockIntoNotebooks,
} from '../components/reader/noteTree'
import { buildNoteAnchorFocus } from '../components/reader/noteAnchorModel'
import { buildPaperChatContextPayload } from '../components/reader/paperChatContext'
import {
  clearStoredAuthToken,
  deleteCurrentUser,
  fetchCurrentUser,
  getStoredAuthToken,
  storeAuthToken,
  uploadAvatar,
  updateCurrentUser,
} from '../services/authApi'
import {
  clearAllNotifications,
  deleteNotification,
  fetchNotifications,
  fetchNotificationSummary,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationApi'
import {
  archiveCompletedTaskCenterItems,
  archiveTaskCenterItems,
  cancelTask,
  fetchTaskCenter,
  fetchTaskCenterSummary,
  retryTask,
} from '../services/taskApi'
import {
  getStoredUiPreferences,
  getUiFontScale,
  getUiTopbarScale,
  normalizeUiFontSize,
  storeUiPreferences,
  UI_FONT_SIZE_DEFAULT,
} from '../services/uiPreferences'
import {
  cancelFullTranslation,
  downloadPaperExport,
  fetchFullTranslation,
  fetchReadingDashboard,
  fetchResourceOverview,
  retryFullTranslation,
  saveResourceLayout,
  startFullTranslation,
  streamFullTranslation,
} from '../services/paperReaderApi'
import {
  buildFullTranslationPages,
  hashTranslationPages,
} from '../components/reader/fullTranslationLayout'
import { resolveAssetUrl } from '../utils/assetUrl'
import { countLogicalAnnotations } from '../utils/annotationAggregation'
import { toUserMessage } from '../utils/errorMessage'
import { MembershipModal } from '../components/membership/MembershipModal'
import { fetchMembershipPlans } from '../services/membershipApi'
import { SOURCE_CODE_LABEL, SOURCE_CODE_TITLE, SOURCE_CODE_URL } from '../config/sourceCode'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet'
import '../styles/app.css'

const AdminPage = lazy(() =>
  import('../components/account/AdminPage').then((module) => ({ default: module.AdminPage })),
)
const HomePage = lazy(() =>
  import('../components/home/HomePage').then((module) => ({ default: module.HomePage })),
)
const AiConfigPage = lazy(() =>
  import('../components/account/AiConfigPage').then((module) => ({ default: module.AiConfigPage })),
)
const UserCenterPage = lazy(() =>
  import('../components/account/UserCenterPage').then((module) => ({ default: module.UserCenterPage })),
)
const ResourcePreviewModal = lazy(() =>
  import('../components/home/ResourcePreviewModal').then((module) => ({ default: module.ResourcePreviewModal })),
)
const FullTranslationReader = lazy(() =>
  import('../components/reader/FullTranslationReader').then((module) => ({ default: module.FullTranslationReader })),
)
const PaperReader = lazy(() =>
  import('../components/reader/PaperReader').then((module) => ({ default: module.PaperReader })),
)
const SelectionInsightPanel = lazy(() =>
  import('../components/reader/SelectionInsightPanel').then((module) => ({ default: module.SelectionInsightPanel })),
)
let sideWorkspacePanelPromise
function loadSideWorkspacePanel() {
  if (!sideWorkspacePanelPromise) {
    sideWorkspacePanelPromise = import('../components/reader/SideWorkspacePanel').then((module) => ({
      default: module.SideWorkspacePanel,
    }))
  }
  return sideWorkspacePanelPromise
}

function preloadSideWorkspacePanel() {
  void loadSideWorkspacePanel()
}

const SideWorkspacePanel = lazy(loadSideWorkspacePanel)
const Login = lazy(() => import('../log/Login.jsx'))

function ViewFallback({ message }) {
  return (
    <div className="view-skeleton" role="status" aria-busy="true">
      <span className="view-skeleton__line view-skeleton__line--title" />
      <span className="view-skeleton__line" />
      <span className="view-skeleton__block" />
      <strong>{message}</strong>
    </div>
  )
}

function shouldPauseBackgroundPolling() {
  const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  return isHidden || isOffline
}

function confirmDangerAction(message) {
  if (typeof window === 'undefined') return true
  return window.confirm(message)
}

function isDesktopShell() {
  return typeof window !== 'undefined' && Boolean(window.paperDesktop)
}

function WorkspacePanelFallback({ width, uiFontScale = 1 }) {
  return (
    <aside
      aria-busy="true"
      aria-label="正在加载工作区"
      className="workspace-panel workspace-panel--loading"
      style={{ width, '--ui-reader-scale': uiFontScale }}
    >
      <div className="workspace-panel__content workspace-panel-loading">
        <div className="workspace-panel-loading__hero">
          <span className="workspace-panel-loading__line workspace-panel-loading__line--title" />
          <span className="workspace-panel-loading__line workspace-panel-loading__line--wide" />
          <span className="workspace-panel-loading__line workspace-panel-loading__line--medium" />
        </div>
        <div className="workspace-panel-loading__block" />
        <div className="workspace-panel-loading__block is-short" />
      </div>
    </aside>
  )
}

function sanitizeDownloadName(value, fallback = 'paper') {
  const text = String(value || fallback)
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

function splitAuthors(authorText) {
  return String(authorText || '')
    .split(/;|；|, and | and /i)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getCitationYear(metadata) {
  const values = [
    metadata?.year,
    metadata?.published,
    metadata?.publicationDate,
    metadata?.creationDate,
    metadata?.modificationDate,
  ]
  for (const value of values) {
    const year = String(value || '').match(/\b(19|20)\d{2}\b/)?.[0]
    if (year) return year
  }
  return ''
}

function normalizeCitationSource(metadata) {
  return {
    title: String(metadata?.title || '').trim() || '未命名论文',
    authors: splitAuthors(metadata?.author),
    journal: String(metadata?.subject || metadata?.journal || '').trim(),
    year: getCitationYear(metadata),
    doi: String(metadata?.doi || '').trim(),
  }
}

function joinChineseAuthors(authors) {
  if (!authors.length) return '佚名'
  return authors.join(', ')
}

function joinMlaAuthors(authors) {
  if (!authors.length) return 'Unknown Author'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]}, and ${authors[1]}`
  return `${authors[0]}, et al.`
}

function buildCitationText(format, metadata, fileName) {
  const source = normalizeCitationSource({
    ...metadata,
    title: metadata?.title || sanitizeDownloadName(fileName),
  })
  const title = source.title
  const journal = source.journal || '期刊信息缺失'
  const year = source.year || '出版年不详'
  const doiPart = source.doi ? ` DOI: ${source.doi}.` : ''

  if (format === 'mla') {
    const mlaYear = source.year || 'n.d.'
    const mlaJournal = source.journal ? ` ${source.journal},` : ''
    const mlaDoi = source.doi ? ` doi:${source.doi}.` : ''
    return `${joinMlaAuthors(source.authors)}. "${title}."${mlaJournal} ${mlaYear}.${mlaDoi}`.replace(/\s+/g, ' ').trim()
  }

  if (format === 'cajcd') {
    return `${joinChineseAuthors(source.authors)}. ${title}[J/OL]. ${journal}, ${year}.${doiPart}`.trim()
  }

  if (format === 'bibtex') {
    const citeKey = [
      source.authors[0]?.split(/\s+/).at(-1) || 'paper',
      source.year || 'nd',
      title.split(/\s+/)[0] || 'work',
    ].join('').replace(/[^A-Za-z0-9_:-]/g, '')
    return [
      `@article{${citeKey},`,
      `  title = {${title}},`,
      source.authors.length ? `  author = {${source.authors.join(' and ')}},` : '',
      source.journal ? `  journal = {${source.journal}},` : '',
      source.year ? `  year = {${source.year}},` : '',
      source.doi ? `  doi = {${source.doi}},` : '',
      '}',
    ].filter(Boolean).join('\n')
  }

  return `${joinChineseAuthors(source.authors)}. ${title}[J]. ${journal}, ${year}.${doiPart}`.trim()
}

function triggerTextDownload(content, fileName) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function normalizeFullTranslationStatus(value) {
  return ['idle', 'running', 'completed', 'partial_failed', 'error', 'cancelled'].includes(value) ? value : 'idle'
}

function getFullTranslationProgress(payload) {
  const total = Number(payload?.total_units) || 0
  const completed = Number(payload?.completed_units) || 0
  if (payload?.status === 'completed' || payload?.status === 'partial_failed') return 100
  if (total <= 0) return payload?.status === 'running' ? 3 : 0
  return Math.max(3, Math.min(99, (completed / total) * 100))
}

function hasReadableFullTranslationCache(payload) {
  return Boolean(
    ['completed', 'partial_failed'].includes(payload?.status)
    && payload?.pages?.length
  )
}

const READER_LAYOUT_GAP = 8
const RESIZER_WIDTH = 10
const WORKSPACE_RAIL_EXPANDED_WIDTH = 72
const WORKSPACE_RAIL_COLLAPSED_WIDTH = 46
const READER_MIN_WIDTH = 640
const INSIGHT_MIN_WIDTH = 180
const INSIGHT_MAX_WIDTH = 460
const WORKSPACE_MIN_WIDTH = 300
const WORKSPACE_DEFAULT_WIDTH = 380
const WORKSPACE_MAX_WIDTH = 620
const NOTIFICATION_SUMMARY_POLL_MS = 30000
const NOTIFICATION_DRAWER_POLL_MS = 15000
const NOTIFICATION_LIST_LIMIT = 20
const TASK_CENTER_SUMMARY_POLL_MS = 30000
const TASK_CENTER_LIST_POLL_MS = 10000
const TASK_CENTER_LIST_LIMIT = 50
const FULL_TRANSLATION_FEATURE_ENABLED = false
const TASK_EVENT_SOURCE_KINDS = new Set(['paper_summary', 'research_matrix'])
const AUTH_INVALID_EVENT = 'xk-auth-invalid'
const NOTIFICATION_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatNotificationTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return NOTIFICATION_TIME_FORMATTER.format(parsed)
}

function getNotificationLabel(item) {
  const actionKind = String(item?.action_kind || '').trim()
  const eventKind = String(item?.event_kind || '').trim()
  const sourceKind = String(item?.source_kind || '').trim()

  if (actionKind.includes('summary') || eventKind.includes('summary')) return '摘要结果'
  if (eventKind.includes('partial_failed')) return '翻译待处理'
  if (actionKind.includes('translation') || eventKind.includes('translation')) return '翻译完成'
  if (actionKind.includes('matrix') || eventKind.includes('matrix')) return '矩阵更新'
  if (sourceKind.includes('admin') || eventKind.includes('broadcast')) return '系统广播'
  return '系统通知'
}

function normalizeNotificationSummary(summary) {
  return {
    unread_count: Number(summary?.unread_count || 0),
    latest_notification_id: summary?.latest_notification_id ?? null,
    latest_created_at: summary?.latest_created_at || null,
  }
}

function normalizeNotificationItem(item) {
  return {
    id: Number(item?.id || 0),
    source_kind: String(item?.source_kind || ''),
    source_id: Number(item?.source_id || 0),
    event_kind: String(item?.event_kind || ''),
    title: String(item?.title || '').trim(),
    message: String(item?.message || '').trim(),
    action_kind: String(item?.action_kind || ''),
    action_payload: item?.action_payload && typeof item.action_payload === 'object' ? item.action_payload : {},
    read_at: item?.read_at || null,
    created_at: item?.created_at || null,
  }
}

function isFullTranslationNotification(item) {
  return (
    String(item?.source_kind || '') === 'full_translation'
    || String(item?.action_kind || '') === 'open-full-translation'
  )
}

function areNotificationSummariesEqual(left, right) {
  return (
    Number(left?.unread_count || 0) === Number(right?.unread_count || 0)
    && (left?.latest_notification_id ?? null) === (right?.latest_notification_id ?? null)
    && (left?.latest_created_at || null) === (right?.latest_created_at || null)
  )
}

function areNotificationItemsEqual(left = [], right = []) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index]
    const rightItem = right[index]
    if (
      leftItem.id !== rightItem.id
      || leftItem.source_kind !== rightItem.source_kind
      || leftItem.source_id !== rightItem.source_id
      || leftItem.event_kind !== rightItem.event_kind
      || leftItem.title !== rightItem.title
      || leftItem.message !== rightItem.message
      || leftItem.action_kind !== rightItem.action_kind
      || (leftItem.read_at || null) !== (rightItem.read_at || null)
      || (leftItem.created_at || null) !== (rightItem.created_at || null)
      || JSON.stringify(leftItem.action_payload || {}) !== JSON.stringify(rightItem.action_payload || {})
    ) {
      return false
    }
  }
  return true
}

function normalizeTaskCenterSummary(summary) {
  return {
    active_count: Number(summary?.active_count || 0),
    failed_count: Number(summary?.failed_count || 0),
    completed_count: Number(summary?.completed_count || 0),
    total_count: Number(summary?.total_count || 0),
    attention_count: Number(summary?.attention_count || 0),
  }
}

function normalizeTaskCenterItem(item) {
  return {
    id: String(item?.id || ''),
    source_kind: String(item?.source_kind || ''),
    source_id: Number(item?.source_id || 0),
    status: String(item?.status || 'idle'),
    status_group: String(item?.status_group || 'idle'),
    status_label: String(item?.status_label || ''),
    stage: String(item?.stage || 'idle'),
    stage_label: String(item?.stage_label || ''),
    title: String(item?.title || '').trim(),
    subtitle: String(item?.subtitle || '').trim(),
    progress_percent: Number(item?.progress_percent || 0),
    error_message: String(item?.error_message || '').trim(),
    action_kind: String(item?.action_kind || 'none'),
    action_payload: item?.action_payload && typeof item.action_payload === 'object' ? item.action_payload : {},
    can_cancel: Boolean(item?.can_cancel),
    can_retry: Boolean(item?.can_retry),
    created_at: item?.created_at || null,
    updated_at: item?.updated_at || null,
  }
}

function normalizeTaskCenter(payload) {
  const items = Array.isArray(payload?.items) ? payload.items.map(normalizeTaskCenterItem).filter((item) => item.id) : []
  return {
    summary: normalizeTaskCenterSummary(payload?.summary),
    items,
  }
}

function buildVisibleTaskCenterPayload(payload) {
  const normalized = normalizeTaskCenter(payload)
  if (FULL_TRANSLATION_FEATURE_ENABLED) return normalized
  const items = normalized.items.filter((item) => item.source_kind !== 'full_translation')
  if (items.length === normalized.items.length) {
    return { ...normalized, items }
  }
  const summary = items.reduce((result, item) => {
    const group = item.status_group || 'idle'
    if (group === 'active') result.active_count += 1
    if (group === 'failed') result.failed_count += 1
    if (group === 'completed') result.completed_count += 1
    result.total_count += 1
    return result
  }, normalizeTaskCenterSummary())
  summary.attention_count = summary.active_count + summary.failed_count
  return { summary, items }
}

function areTaskCenterSummariesEqual(left, right) {
  return (
    Number(left?.active_count || 0) === Number(right?.active_count || 0)
    && Number(left?.failed_count || 0) === Number(right?.failed_count || 0)
    && Number(left?.completed_count || 0) === Number(right?.completed_count || 0)
    && Number(left?.total_count || 0) === Number(right?.total_count || 0)
    && Number(left?.attention_count || 0) === Number(right?.attention_count || 0)
  )
}

function areTaskCenterItemsEqual(left = [], right = []) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index]
    const rightItem = right[index]
    if (
      leftItem.id !== rightItem.id
      || leftItem.source_kind !== rightItem.source_kind
      || leftItem.source_id !== rightItem.source_id
      || leftItem.status !== rightItem.status
      || leftItem.status_group !== rightItem.status_group
      || leftItem.status_label !== rightItem.status_label
      || leftItem.stage !== rightItem.stage
      || leftItem.stage_label !== rightItem.stage_label
      || leftItem.title !== rightItem.title
      || leftItem.subtitle !== rightItem.subtitle
      || leftItem.progress_percent !== rightItem.progress_percent
      || leftItem.error_message !== rightItem.error_message
      || leftItem.action_kind !== rightItem.action_kind
      || leftItem.can_cancel !== rightItem.can_cancel
      || leftItem.can_retry !== rightItem.can_retry
      || (leftItem.created_at || null) !== (rightItem.created_at || null)
      || (leftItem.updated_at || null) !== (rightItem.updated_at || null)
      || JSON.stringify(leftItem.action_payload || {}) !== JSON.stringify(rightItem.action_payload || {})
    ) {
      return false
    }
  }
  return true
}

function areTaskCenterPayloadsEqual(left, right) {
  return (
    areTaskCenterSummariesEqual(left?.summary, right?.summary)
    && areTaskCenterItemsEqual(left?.items || [], right?.items || [])
  )
}

const EMPTY_RESOURCE_OVERVIEW = { stats: {}, papers: [] }

function getNow() {
  return Date.now()
}

let transientIdCounter = 0

function createTransientId(prefix = 'temp') {
  transientIdCounter += 1
  return `${prefix}-${getNow()}-${transientIdCounter}`
}

function App() {
  const isDesktop = isDesktopShell()
  const readerRef = useRef(null)
  const readerLayoutRef = useRef(null)
  const userMenuRef = useRef(null)
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState('')
  const [activeTool, setActiveTool] = useState('select')
  const [activeEraserMode, setActiveEraserMode] = useState('brush')
  const [inkOptions, setInkOptions] = useState({ color: '#15803D', opacity: 0.85, strokeWidth: 6 })
  const [shapeOptions, setShapeOptions] = useState(DEFAULT_SHAPE_OPTIONS)
  const [isThumbnailsOpen, setIsThumbnailsOpen] = useState(false)
  const [isUtilityRailCollapsed, setIsUtilityRailCollapsed] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [isAuthViewOpen, setIsAuthViewOpen] = useState(false)
  const [isSessionRestoring, setIsSessionRestoring] = useState(() => Boolean(getStoredAuthToken()))
  const [currentUser, setCurrentUser] = useState(null)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [accountSection, setAccountSection] = useState('')
  const [uiFontSize, setUiFontSize] = useState(UI_FONT_SIZE_DEFAULT)
  const [readerLayoutWidth, setReaderLayoutWidth] = useState(0)
  const [chatMessages, setChatMessages] = useState({})
  const [chatInput, setChatInput] = useState({})
  const [chatAsking, setChatAsking] = useState({})
  const [chatInitialSuggestions, setChatInitialSuggestions] = useState({})
  const [chatInitialSuggestionsLoading, setChatInitialSuggestionsLoading] = useState({})
  const [chatFollowupLoadingMessageId, setChatFollowupLoadingMessageId] = useState({})
  const [activeProviderId, setActiveProviderId] = useState(null)
  const [fullTranslation, setFullTranslation] = useState(null)
  const [fullTranslationStatus, setFullTranslationStatus] = useState('idle')
  const [fullTranslationProgress, setFullTranslationProgress] = useState(0)
  const [fullTranslationBusy, setFullTranslationBusy] = useState(false)
  const [fullTranslationParseMode, setFullTranslationParseMode] = useState('auto')
  const [isFullTranslationOpen, setIsFullTranslationOpen] = useState(false)
  const [fullTranslationOpenPaperId, setFullTranslationOpenPaperId] = useState(null)
  const [resourceOverview, setResourceOverview] = useState(EMPTY_RESOURCE_OVERVIEW)
  const [readingDashboard, setReadingDashboard] = useState(null)
  const [insightTimeframe, setInsightTimeframe] = useState('month')
  const [resourcePreview, setResourcePreview] = useState(null)
  const [homeInitialSection, setHomeInitialSection] = useState('recent')
  const [summaryInitialType, setSummaryInitialType] = useState('')
  const [isNotificationOpen, setIsNotificationOpen] = useState(false)
  const [notificationSummary, setNotificationSummary] = useState(() => normalizeNotificationSummary())
  const [notificationItems, setNotificationItems] = useState([])
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationActionBusy, setNotificationActionBusy] = useState('')
  const [notificationToast, setNotificationToast] = useState(null)
  const [isTaskCenterOpen, setIsTaskCenterOpen] = useState(false)
  const [taskCenterPayload, setTaskCenterPayload] = useState(() => normalizeTaskCenter())
  const [taskCenterLoading, setTaskCenterLoading] = useState(false)
  const [taskCenterError, setTaskCenterError] = useState('')
  const [taskCenterActionBusyId, setTaskCenterActionBusyId] = useState('')
  const [membershipPlans, setMembershipPlans] = useState([])
  const [isMembershipModalOpen, setIsMembershipModalOpen] = useState(false)
  const chatMessageCounterRef = useRef(0)
  const chatRequestCounterRef = useRef(0)
  const initialSuggestionRequestRef = useRef({})
  const initialSuggestionBatchRef = useRef({})
  const followupSuggestionRequestRef = useRef({})
  const fullTranslationPollRef = useRef(null)
  const notificationSummaryPollRef = useRef(null)
  const notificationDrawerPollRef = useRef(null)
  const notificationToastTimerRef = useRef(null)
  const notificationSummaryInFlightRef = useRef(false)
  const notificationListInFlightRef = useRef(false)
  const notificationSummaryRef = useRef(normalizeNotificationSummary())
  const notificationItemsRef = useRef([])
  const isNotificationOpenRef = useRef(false)
  const taskCenterSummaryPollRef = useRef(null)
  const taskCenterListPollRef = useRef(null)
  const taskCenterSummaryInFlightRef = useRef(false)
  const taskCenterListInFlightRef = useRef(false)
  const taskCenterPayloadRef = useRef(normalizeTaskCenter())
  const isTaskCenterOpenRef = useRef(false)
  const realtimeEventSourceRef = useRef(null)
  const realtimeLastEventIdRef = useRef('')
  const notificationPermissionRequestRef = useRef(false)
  const lastSeenNotificationIdRef = useRef(null)
  const didInitNotificationPollingRef = useRef(false)
  const toastedNotificationIdsRef = useRef(new Set())
  const readingResourceRefreshTimerRef = useRef(null)
  const readingResourceIdleRefreshRef = useRef(null)
  const restoredWorkspaceSessionRef = useRef('')
  const userMenuCloseTimerRef = useRef(null)
  const userMenuRefreshInFlightRef = useRef(false)
  const authInvalidHandlerRef = useRef(null)
  const currentUserAvatarSrc = resolveAssetUrl(currentUser?.avatar_url)
  notificationSummaryRef.current = notificationSummary
  notificationItemsRef.current = notificationItems
  isNotificationOpenRef.current = isNotificationOpen
  taskCenterPayloadRef.current = taskCenterPayload
  isTaskCenterOpenRef.current = isTaskCenterOpen
  authInvalidHandlerRef.current = () => {
    if (!getStoredAuthToken()) return
    handleLogout()
    setAuthMode('login')
    setIsAuthViewOpen(true)
  }

  function openFullTranslationReader(paperId = activePaperId) {
    if (!FULL_TRANSLATION_FEATURE_ENABLED) return
    if (!paperId) return
    setFullTranslationOpenPaperId(paperId)
    setIsFullTranslationOpen(true)
  }

  function closeFullTranslationReader() {
    setIsFullTranslationOpen(false)
    setFullTranslationOpenPaperId(null)
  }

  function openMembershipModal() {
    setIsMembershipModalOpen(true)
  }

  function closeMembershipModal() {
    setIsMembershipModalOpen(false)
  }

  async function openSupportCenter() {
    if (!currentUser) {
      setAuthMode('login')
      setIsAuthViewOpen(true)
      return
    }

    const canLeave = await ensureNotesSavedBeforeLeaving()
    if (!canLeave) return
    setSummaryInitialType('')
    setHomeInitialSection('recent')
    setAccountSection(currentUser?.is_admin ? 'admin-feedback' : 'feedback')
    closeFullTranslationReader()
  }

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      const rawUrl = typeof input === 'string' ? input : input?.url || ''
      const pathname = rawUrl ? new URL(rawUrl, window.location.origin).pathname : ''

      if (
        response.status === 401
        && pathname.startsWith('/api/')
        && pathname !== '/api/auth/login'
        && getStoredAuthToken()
      ) {
        window.dispatchEvent(new Event(AUTH_INVALID_EVENT))
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  useEffect(() => {
    const handleInvalidAuth = () => {
      authInvalidHandlerRef.current?.()
    }
    window.addEventListener(AUTH_INVALID_EVENT, handleInvalidAuth)
    return () => {
      window.removeEventListener(AUTH_INVALID_EVENT, handleInvalidAuth)
    }
  }, [])

  // Get active AI provider
  useEffect(function () {
    fetch('/api/providers', { headers: getStoredAuthToken() ? { Authorization: 'Bearer ' + getStoredAuthToken() } : {} })
      .then(function (r) { return r.json() })
      .then(function (d) {
        var a = (d && d.providers || []).find(function (p) { return p.is_active })
        if (a) {
          setActiveProviderId(a.id)
        } else {
          setActiveProviderId(null)
        }
      })
      .catch(function () {})
  }, [currentUser])

  useEffect(() => {
    fetchMembershipPlans()
      .then((payload) => {
        setMembershipPlans(Array.isArray(payload?.plans) ? payload.plans : [])
      })
      .catch(() => {
        setMembershipPlans([])
      })
  }, [])

  const {
    activeView,
    assignPaperToFolder,
    cancelImportConflict,
    closePaper,
    createFolder,
    deletePaper,
    deleteFolder,
    emptyTrash,
    error,
    fileInputRef,
    fileName,
    fitToWidth,
    folders,
    goHome,
    handleFileChange,
    importConflict,
    importStatus,
    isImporting,
    isLoading,
    metadata,
    openFilePicker,
    openTabs,
    pageMetrics,
    pageNumber,
    pageNumbers,
    pdfDocument,
    permanentlyDeletePaper,
    recentPapers,
    readingStats,
    recentReadings,
    readingDurationVersion,
    refreshPaperMetadata,
    refreshTrashPapers,
    renameFolder,
    resolveImportConflict,
    retryImportConflict,
    restorePaperFromTrash,
    scale,
    savePaperMetadata,
    setCurrentPage,
    switchToPaper,
    totalPages,
    trashPapers,
    uncategorizedFolderId,
    zoomIn,
    zoomOut,
    zoomBy,
    activePaperSummary,
    activePaperFullText,
  } = usePdfReader({ currentUser })
  const pdfSearch = usePdfSearch(readerRef, { pdfDocument, pageNumbers })
  const activePaperId = activeView !== 'home' ? Number(activeView) : null
  const isHomeView = activeView === 'home'
  const isReaderView = activeView !== 'home'
  const isAccountView = Boolean(accountSection)
  const isAdminUser = Boolean(currentUser?.is_admin)
  const isFullTranslationBetaEnabled = FULL_TRANSLATION_FEATURE_ENABLED

  useEffect(() => {
    if (!isReaderView) return undefined

    if (typeof window === 'undefined') {
      preloadSideWorkspacePanel()
      return undefined
    }

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preloadSideWorkspacePanel, { timeout: 800 })
      return () => window.cancelIdleCallback?.(idleId)
    }

    const timerId = window.setTimeout(preloadSideWorkspacePanel, 120)
    return () => window.clearTimeout(timerId)
  }, [isReaderView])

  const {
    annotations,
    createAnnotation,
    deleteAnnotation,
    clearAnnotations,
    eraseAnnotationRange,
    restoreAnnotations,
  } = useAnnotations(activePaperId)
  const logicalAnnotationTotal = countLogicalAnnotations(annotations)
  const {
    inkAnnotations,
    createInkAnnotation,
    deleteInkAnnotation,
  } = useInkAnnotations(activePaperId)
  const {
    shapeAnnotations,
    createShapeAnnotation,
    updateShapeAnnotation,
    deleteShapeAnnotation,
  } = useShapeAnnotations(activePaperId)
  const {
    notebooks,
    loading: notesLoading,
    saving: notesSaving,
    saveStatus: notesSaveStatus,
    saveError: notesSaveError,
    hasUnsavedChanges: hasUnsavedNotes,
    setNotebooks,
    saveNotebooks,
    retrySaveNotebooks,
    flushUnsavedNotes,
    createNotebookDraft,
  } = usePaperNotes(activePaperId)
  const [activeNoteTarget, setActiveNoteTarget] = useState(null)
  const [noteFocus, setNoteFocus] = useState(null)
  const [annotationUndoStacks, setAnnotationUndoStacks] = useState({})
  const eraseUndoSessionsRef = useRef(new Set())
  const thumbnailPanel = useResizableWidth({
    initialWidth: 300,
    minWidth: 160,
    maxWidth: 420,
  })
  const workspacePanel = useResizableWidth({
    initialWidth: WORKSPACE_DEFAULT_WIDTH,
    minWidth: WORKSPACE_MIN_WIDTH,
    maxWidth: WORKSPACE_MAX_WIDTH,
  })
  const setWorkspacePanelWidth = workspacePanel.setWidth
  const railWidth = isUtilityRailCollapsed ? WORKSPACE_RAIL_COLLAPSED_WIDTH : WORKSPACE_RAIL_EXPANDED_WIDTH
  const readerShellWidth = readerLayoutWidth || (typeof window !== 'undefined' ? window.innerWidth : 1440)
  const workspaceWidth = activeWorkspacePanel ? workspacePanel.width : 0
  const workspaceReserveWidth = activeWorkspacePanel
    ? workspaceWidth + railWidth + RESIZER_WIDTH + READER_LAYOUT_GAP * 2
    : railWidth + READER_LAYOUT_GAP
  const insightSafeMaxWidth = Math.max(
    INSIGHT_MIN_WIDTH,
    Math.min(
      INSIGHT_MAX_WIDTH,
      readerShellWidth - workspaceReserveWidth - READER_MIN_WIDTH - RESIZER_WIDTH - READER_LAYOUT_GAP * 3,
    ),
  )
  const insightPanel = useResizableWidth({
    initialWidth: 300,
    minWidth: INSIGHT_MIN_WIDTH,
    maxWidth: insightSafeMaxWidth,
  })
  const workspaceSafeMaxWidth = Math.max(
    WORKSPACE_MIN_WIDTH,
    Math.min(
      WORKSPACE_MAX_WIDTH,
      readerShellWidth - insightPanel.width - railWidth - READER_MIN_WIDTH - RESIZER_WIDTH * 2 - READER_LAYOUT_GAP * 5,
    ),
  )

  useEffect(() => {
    const element = readerLayoutRef.current
    if (!element) return undefined

    function updateWidth() {
      setReaderLayoutWidth(element.clientWidth || 0)
    }

    updateWidth()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateWidth) : null
    observer?.observe(element)
    window.addEventListener('resize', updateWidth)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [isReaderView])

  useEffect(() => {
    window.setTimeout(() => {
      setWorkspacePanelWidth((current) => Math.min(current, workspaceSafeMaxWidth))
    }, 0)
  }, [setWorkspacePanelWidth, workspaceSafeMaxWidth])

  const activePaperSessionKey = isReaderView ? String(activeView) : ''

  useEffect(() => {
    if (!activePaperSessionKey) return
    const restoredSession = readReadingSessionSnapshot(activePaperSessionKey)
    if (!restoredSession) return

    restoredWorkspaceSessionRef.current = activePaperSessionKey
    setActiveWorkspacePanel(restoredSession.activeWorkspacePanel || '')
    setWorkspacePanelWidth(restoredSession.workspaceWidth)
  }, [activePaperSessionKey, setWorkspacePanelWidth])

  useEffect(() => {
    if (!activePaperSessionKey) return
    if (restoredWorkspaceSessionRef.current === activePaperSessionKey) {
      restoredWorkspaceSessionRef.current = ''
      return
    }

    saveReadingSessionSnapshot(activePaperSessionKey, {
      activeWorkspacePanel,
      workspaceWidth: workspacePanel.width,
    })
  }, [activePaperSessionKey, activeWorkspacePanel, workspacePanel.width])

  const { selectionCard, handleSelection, aiEnabled, toggleAI } = useSelectionInsight({
    readerRef,
    paperTitle: metadata.title || fileName,
    paperSummary: activePaperSummary,
    activePaperFullText,
  })
  const latestRecentOpenedAt = recentReadings?.[0]?.openedAt ?? null
  const weeklyOpens = readingStats?.weekly_opens ?? 0
  const weeklyDistinctPapers = readingStats?.weekly_distinct_papers ?? 0
  const dominantReadingPeriod = readingStats?.dominant_period ?? ''
  const annotationCount = resourceOverview?.stats?.annotation_count ?? 0
  const noteCount = resourceOverview?.stats?.note_count ?? 0
  const summaryCount = resourceOverview?.stats?.summary_count ?? 0
  const translationCount = resourceOverview?.stats?.translation_count ?? 0
  const visibleResourceOverview = currentUser ? resourceOverview : EMPTY_RESOURCE_OVERVIEW
  const visibleReadingDashboard = currentUser ? readingDashboard : null

  useEffect(() => {
    let cancelled = false

    if (!currentUser) {
      return undefined
    }

    async function loadResourceOverview() {
      try {
        const payload = await fetchResourceOverview()
        if (!cancelled) {
          setResourceOverview({
            stats: payload?.stats || {},
            papers: payload?.papers || [],
          })
        }
      } catch {
        if (!cancelled) {
          setResourceOverview(EMPTY_RESOURCE_OVERVIEW)
        }
      }
    }

    loadResourceOverview()
    return () => {
      cancelled = true
    }
  }, [currentUser, recentPapers.length])

  useEffect(() => {
    let cancelled = false

    if (!currentUser) {
      return undefined
    }

    async function loadReadingDashboard() {
      try {
        const payload = await fetchReadingDashboard(insightTimeframe)
        if (!cancelled) {
          setReadingDashboard(payload || null)
        }
      } catch {
        if (!cancelled) {
          setReadingDashboard(null)
        }
      }
    }

    loadReadingDashboard()
    return () => {
      cancelled = true
    }
  }, [
    currentUser,
    recentPapers.length,
    latestRecentOpenedAt,
    weeklyOpens,
    weeklyDistinctPapers,
    dominantReadingPeriod,
    readingDurationVersion,
    annotationCount,
    noteCount,
    summaryCount,
    translationCount,
    insightTimeframe,
  ])

  async function refreshReadingDashboard() {
    if (!currentUser) return
    try {
      const payload = await fetchReadingDashboard(insightTimeframe)
      setReadingDashboard(payload || null)
    } catch {
      // Reading dashboard is non-blocking.
    }
  }

  async function refreshResourceOverview() {
    if (!currentUser) return
    try {
      const payload = await fetchResourceOverview()
      setResourceOverview({
        stats: payload?.stats || {},
        papers: payload?.papers || [],
      })
    } catch {
      // 资源图只是增强入口，刷新失败不影响阅读主流程。
    }
  }

  function clearReadingResourceRefreshTimer() {
    if (readingResourceRefreshTimerRef.current) {
      window.clearTimeout(readingResourceRefreshTimerRef.current)
      readingResourceRefreshTimerRef.current = null
    }
    if (readingResourceIdleRefreshRef.current != null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(readingResourceIdleRefreshRef.current)
      } else {
        window.clearTimeout(readingResourceIdleRefreshRef.current)
      }
      readingResourceIdleRefreshRef.current = null
    }
  }

  function scheduleReadingResourceRefresh(delay = 900) {
    if (!currentUser) return
    clearReadingResourceRefreshTimer()
    readingResourceRefreshTimerRef.current = window.setTimeout(() => {
      readingResourceRefreshTimerRef.current = null
      const runRefresh = () => {
        readingResourceIdleRefreshRef.current = null
        void Promise.all([
          refreshResourceOverview(),
          refreshReadingDashboard(),
        ])
      }

      if (typeof window.requestIdleCallback === 'function') {
        readingResourceIdleRefreshRef.current = window.requestIdleCallback(runRefresh, {
          timeout: 1800,
        })
        return
      }

      readingResourceIdleRefreshRef.current = window.setTimeout(runRefresh, 0)
    }, delay)
  }

  async function handleSaveResourceLayout(paperId, layout) {
    if (!currentUser || !paperId || !layout?.resource_type) return null
    const saved = await saveResourceLayout(paperId, layout)
    setResourceOverview((previous) => ({
      stats: previous?.stats || {},
      papers: (previous?.papers || []).map((paper) => {
        if (String(paper.paper_id) !== String(paperId)) return paper
        return {
          ...paper,
          resources: (paper.resources || []).map((resource) =>
            resource.type === saved.resource_type
              ? {
                  ...resource,
                  layout: {
                    x_pct: saved.x_pct,
                    y_pct: saved.y_pct,
                    rotation_deg: saved.rotation_deg,
                  },
                }
              : resource,
          ),
        }
      }),
    }))
    return saved
  }

  function openResourcePreview(preview) {
    setResourcePreview(preview)
  }

  function closeResourcePreview() {
    setResourcePreview(null)
  }

  async function ensureNotesSavedBeforeLeaving() {
    if (!hasUnsavedNotes && notesSaveStatus !== 'error') return true
    const saved = await flushUnsavedNotes()
    if (!saved && typeof window !== 'undefined') {
      window.alert('笔记保存失败，请点击顶部“保存失败，点击重试”或手动保存后再切换。')
    }
    return saved
  }

  async function switchToPaperSafely(paperId) {
    if (!paperId) return
    if (String(paperId) !== String(activePaperId)) {
      const canLeave = await ensureNotesSavedBeforeLeaving()
      if (!canLeave) return false
    }
    switchToPaper(paperId)
    return true
  }

  async function goHomeSafely() {
    const canLeave = await ensureNotesSavedBeforeLeaving()
    if (!canLeave) return false
    goHome()
    return true
  }

  async function openPaperResource(paperId, resource = null) {
    if (!paperId) return
    const opened = await switchToPaperSafely(paperId)
    if (!opened) return
    setAccountSection('')
    setHomeInitialSection('recent')
    setSummaryInitialType('')
    closeFullTranslationReader()

    const resourceType = resource?.type || ''
    if (resourceType === 'notes') {
      setActiveWorkspacePanel('notes')
      return true
    }

    if (resourceType.startsWith('summary_')) {
      setActiveWorkspacePanel('summary')
      return true
    }

    if (resourceType === 'annotations') {
      setActiveWorkspacePanel('info')
      return true
    }

    return true
  }

  useEffect(() => {
    let cancelled = false
    const token = getStoredAuthToken()

    if (!token) {
      return undefined
    }

    async function restoreSession() {
      try {
        const user = await fetchCurrentUser(token)
        if (!cancelled) {
          setCurrentUser(user)
          setIsAuthViewOpen(false)
        }
      } catch {
        clearStoredAuthToken()
        if (!cancelled) {
          setCurrentUser(null)
          setIsAuthViewOpen(false)
        }
      } finally {
        if (!cancelled) {
          setIsSessionRestoring(false)
        }
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const nextPreferences = getStoredUiPreferences(currentUser?.uid)
    const nextFontSize = normalizeUiFontSize(nextPreferences.fontSize)
    const frameId = window.requestAnimationFrame(() => {
      setUiFontSize((current) => (current === nextFontSize ? current : nextFontSize))
    })
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [currentUser?.uid])

  // Toolbar button ripple effect
  useEffect(() => {
    function handleRipple(event) {
      const btn = event.target.closest('.toolbar-icon-button, .toolbar-tool')
      if (!btn) return

      const ripple = document.createElement('span')
      ripple.className = 'ripple-effect'
      const rect = btn.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`
      ripple.style.width = `${size}px`
      ripple.style.height = `${size}px`
      btn.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove())
    }

    document.addEventListener('click', handleRipple)
    return () => document.removeEventListener('click', handleRipple)
  }, [])

  useEffect(() => {
    return () => {
      if (userMenuCloseTimerRef.current) {
        window.clearTimeout(userMenuCloseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isUserMenuOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isUserMenuOpen])

  useEffect(() => {
    if (!isUserMenuOpen) {
      return undefined
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isUserMenuOpen])

  function clearNotificationSummaryPolling() {
    if (notificationSummaryPollRef.current) {
      window.clearInterval(notificationSummaryPollRef.current)
      notificationSummaryPollRef.current = null
    }
  }

  function clearNotificationDrawerPolling() {
    if (notificationDrawerPollRef.current) {
      window.clearInterval(notificationDrawerPollRef.current)
      notificationDrawerPollRef.current = null
    }
  }

  function clearNotificationToastTimer() {
    if (notificationToastTimerRef.current) {
      window.clearTimeout(notificationToastTimerRef.current)
      notificationToastTimerRef.current = null
    }
  }

  function clearTaskCenterPolling() {
    if (taskCenterSummaryPollRef.current) {
      window.clearInterval(taskCenterSummaryPollRef.current)
      taskCenterSummaryPollRef.current = null
    }
    clearTaskCenterListPolling()
  }

  function clearTaskCenterListPolling() {
    if (taskCenterListPollRef.current) {
      window.clearInterval(taskCenterListPollRef.current)
      taskCenterListPollRef.current = null
    }
  }

  function clearRealtimeEventStream() {
    if (realtimeEventSourceRef.current) {
      realtimeEventSourceRef.current.close()
      realtimeEventSourceRef.current = null
    }
  }

  function handleRealtimeNotificationEvent(event) {
    if (event?.lastEventId) {
      realtimeLastEventIdRef.current = event.lastEventId
    }

    let payload = {}
    try {
      payload = JSON.parse(event?.data || '{}')
    } catch {
      payload = {}
    }

    void loadNotificationSummary({ background: true })
    if (TASK_EVENT_SOURCE_KINDS.has(String(payload?.source_kind || ''))) {
      if (isTaskCenterOpenRef.current) {
        void loadTaskCenter({ background: true })
      } else {
        void loadTaskCenterSummary({ background: true })
      }
    }
  }

  function beginRealtimeEventStream() {
    clearRealtimeEventStream()
    if (!currentUser || typeof window === 'undefined' || !('EventSource' in window)) return
    const token = getStoredAuthToken()
    if (!token) return

    const params = new URLSearchParams({ token })
    if (realtimeLastEventIdRef.current) {
      params.set('last_event_id', realtimeLastEventIdRef.current)
    }
    const stream = new window.EventSource(`/api/events/stream?${params.toString()}`)
    realtimeEventSourceRef.current = stream
    stream.addEventListener('notification', handleRealtimeNotificationEvent)
    stream.addEventListener('connected', (event) => {
      let payload = {}
      try {
        payload = JSON.parse(event?.data || '{}')
      } catch {
        payload = {}
      }
      const latestId = payload?.latest_notification_id
      if (latestId && !realtimeLastEventIdRef.current) {
        realtimeLastEventIdRef.current = String(latestId)
      }
      updateNotificationSummaryState((current) => ({
        ...current,
        unread_count: Number(payload?.unread_count ?? current.unread_count ?? 0),
        latest_notification_id: payload?.latest_notification_id ?? current.latest_notification_id,
      }))
    })
    stream.onerror = () => {
      // EventSource reconnects by itself. Existing polling remains as a fallback.
    }
  }

  function updateNotificationSummaryState(updater) {
    setNotificationSummary((current) => {
      const next = normalizeNotificationSummary(
        typeof updater === 'function' ? updater(current) : updater,
      )
      if (areNotificationSummariesEqual(current, next)) {
        notificationSummaryRef.current = current
        return current
      }
      notificationSummaryRef.current = next
      return next
    })
  }

  function updateNotificationItemsState(updater) {
    setNotificationItems((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      notificationItemsRef.current = next
      return areNotificationItemsEqual(current, next) ? current : next
    })
  }

  function updateTaskCenterPayloadState(updater) {
    setTaskCenterPayload((current) => {
      const next = normalizeTaskCenter(typeof updater === 'function' ? updater(current) : updater)
      taskCenterPayloadRef.current = next
      return areTaskCenterPayloadsEqual(current, next) ? current : next
    })
  }

  function showSystemNotification(item) {
    if (!item?.id || typeof window === 'undefined' || !('Notification' in window)) return
    if (window.Notification.permission !== 'granted') return
    const pageVisible = document.visibilityState === 'visible'
    const pageFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
    if (pageVisible && pageFocused) return

    const systemNotice = new window.Notification(item.title || '通知', {
      body: item.message || '点击查看详情',
      tag: `xk-reader-notification-${item.id}`,
      renotify: true,
    })
    systemNotice.onclick = () => {
      window.focus()
      systemNotice.close()
      void handleNotificationOpen(item)
    }
    window.setTimeout(() => {
      systemNotice.close()
    }, 6000)
  }

  function showNotificationToast(item) {
    if (!item?.id) return
    if (!FULL_TRANSLATION_FEATURE_ENABLED && isFullTranslationNotification(item)) return
    toastedNotificationIdsRef.current.add(item.id)
    setNotificationToast(item)
    showSystemNotification(item)
    clearNotificationToastTimer()
    notificationToastTimerRef.current = window.setTimeout(() => {
      setNotificationToast(null)
      notificationToastTimerRef.current = null
    }, 4000)
  }

  function applyNotificationSummary(summary, options = {}) {
    const normalized = normalizeNotificationSummary(summary)
    updateNotificationSummaryState(normalized)
    const latestId = normalized.latest_notification_id
    if (!latestId) {
      lastSeenNotificationIdRef.current = null
      return
    }

    if (!didInitNotificationPollingRef.current || options.silentInit) {
      didInitNotificationPollingRef.current = true
      lastSeenNotificationIdRef.current = latestId
      return
    }

    if (lastSeenNotificationIdRef.current !== latestId) {
      lastSeenNotificationIdRef.current = latestId
      loadNotificationList({ toastLatest: true })
    }
  }

  async function loadNotificationSummary(options = {}) {
    if (!currentUser) return
    if (notificationSummaryInFlightRef.current) return notificationSummaryRef.current
    notificationSummaryInFlightRef.current = true
    try {
      const payload = await fetchNotificationSummary()
      applyNotificationSummary(payload, options)
      return payload
    } catch {
      if (options.resetOnError) {
        updateNotificationSummaryState(normalizeNotificationSummary())
      }
      return null
    } finally {
      notificationSummaryInFlightRef.current = false
    }
  }

  async function loadNotificationList(options = {}) {
    if (!currentUser) return
    if (notificationListInFlightRef.current) return notificationItemsRef.current
    notificationListInFlightRef.current = true
    if (!options.background) {
      setNotificationLoading(true)
    }
    try {
      const payload = await fetchNotifications(NOTIFICATION_LIST_LIMIT)
      const items = Array.isArray(payload?.items) ? payload.items.map(normalizeNotificationItem) : []
      const visibleItems = FULL_TRANSLATION_FEATURE_ENABLED
        ? items
        : items.filter((item) => !isFullTranslationNotification(item))
      updateNotificationItemsState(visibleItems)
      setNotificationError('')
      updateNotificationSummaryState((current) => ({
        ...current,
        unread_count: Number(payload?.unread_count || 0),
        latest_notification_id: visibleItems[0]?.id ?? current.latest_notification_id,
        latest_created_at: visibleItems[0]?.created_at ?? current.latest_created_at,
      }))
      if (options.toastLatest) {
        const target = visibleItems.find((item) => !item.read_at && !toastedNotificationIdsRef.current.has(item.id))
        if (target) {
          showNotificationToast(target)
        }
      }
      return visibleItems
    } catch (error) {
      if (!options.background) {
        setNotificationError(toUserMessage(error, '通知加载失败，请稍后重试。'))
      }
      return notificationItemsRef.current
    } finally {
      notificationListInFlightRef.current = false
      if (!options.background) {
        setNotificationLoading(false)
      }
    }
  }

  function beginNotificationSummaryPolling() {
    clearNotificationSummaryPolling()
    notificationSummaryPollRef.current = window.setInterval(() => {
      if (shouldPauseBackgroundPolling()) return
      if (!isNotificationOpenRef.current) {
        loadNotificationSummary()
      }
    }, NOTIFICATION_SUMMARY_POLL_MS)
  }

  function beginNotificationDrawerPolling() {
    clearNotificationDrawerPolling()
    notificationDrawerPollRef.current = window.setInterval(() => {
      if (shouldPauseBackgroundPolling()) return
      loadNotificationList({ background: true })
    }, NOTIFICATION_DRAWER_POLL_MS)
  }

  async function loadTaskCenter(options = {}) {
    if (!currentUser) return normalizeTaskCenter()
    if (taskCenterListInFlightRef.current) return taskCenterPayloadRef.current
    taskCenterListInFlightRef.current = true
    if (!options.background) {
      setTaskCenterLoading(true)
    }
    try {
      const payload = normalizeTaskCenter(await fetchTaskCenter(TASK_CENTER_LIST_LIMIT))
      updateTaskCenterPayloadState(payload)
      setTaskCenterError('')
      return payload
    } catch (error) {
      if (options.resetOnError) {
        updateTaskCenterPayloadState(normalizeTaskCenter())
      }
      if (!options.background) {
        setTaskCenterError(toUserMessage(error, '任务列表加载失败'))
      }
      return null
    } finally {
      taskCenterListInFlightRef.current = false
      if (!options.background) {
        setTaskCenterLoading(false)
      }
    }
  }

  async function loadTaskCenterSummary(options = {}) {
    if (!currentUser) return normalizeTaskCenterSummary()
    if (taskCenterSummaryInFlightRef.current) return taskCenterPayloadRef.current.summary
    taskCenterSummaryInFlightRef.current = true
    try {
      const summary = normalizeTaskCenterSummary(await fetchTaskCenterSummary())
      updateTaskCenterPayloadState((current) => ({
        ...current,
        summary,
      }))
      return summary
    } catch (error) {
      if (options.resetOnError) {
        updateTaskCenterPayloadState((current) => ({
          ...current,
          summary: normalizeTaskCenterSummary(),
        }))
      }
      if (!options.background) {
        setTaskCenterError(toUserMessage(error, '任务状态加载失败'))
      }
      return null
    } finally {
      taskCenterSummaryInFlightRef.current = false
    }
  }

  function beginTaskCenterPolling() {
    clearTaskCenterPolling()
    taskCenterSummaryPollRef.current = window.setInterval(() => {
      if (shouldPauseBackgroundPolling()) return
      if (!isTaskCenterOpenRef.current) {
        loadTaskCenterSummary({ background: true })
      }
    }, TASK_CENTER_SUMMARY_POLL_MS)
  }

  function beginTaskCenterListPolling() {
    clearTaskCenterListPolling()
    taskCenterListPollRef.current = window.setInterval(() => {
      if (shouldPauseBackgroundPolling()) return
      loadTaskCenter({ background: true })
    }, TASK_CENTER_LIST_POLL_MS)
  }

  async function navigateFromNotification(item) {
    const actionKind = String(item?.action_kind || '')
    const payload = item?.action_payload || {}

    if (actionKind === 'open-summary') {
      const paperId = Number(payload.paper_id || 0)
      const summaryType = String(payload.summary_type || '').trim()
      if (!paperId) {
        showNotificationToast({ id: createTransientId('missing'), title: '提示', message: '目标内容已不存在或无权限访问' })
        return
      }
      const opened = await switchToPaperSafely(paperId)
      if (!opened) return
      setAccountSection('')
      setHomeInitialSection('recent')
      setSummaryInitialType(summaryType)
      closeFullTranslationReader()
      setActiveWorkspacePanel('summary')
      return
    }

    if (actionKind === 'open-full-translation') {
      if (!FULL_TRANSLATION_FEATURE_ENABLED) return
      const paperId = Number(payload.paper_id || 0)
      if (!paperId) {
        showNotificationToast({ id: createTransientId('missing'), title: '提示', message: '目标内容已不存在或无权限访问' })
        return
      }
      const opened = await switchToPaperSafely(paperId)
      if (!opened) return
      setAccountSection('')
      setHomeInitialSection('recent')
      setSummaryInitialType('')
      setActiveWorkspacePanel('')
      openFullTranslationReader(paperId)
      return
    }

    if (actionKind === 'open-matrix') {
      const opened = await goHomeSafely()
      if (!opened) return
      setSummaryInitialType('')
      setAccountSection('')
      closeFullTranslationReader()
      setHomeInitialSection('matrix')
      return
    }

    if (actionKind === 'open-membership') {
      openMembershipModal()
    }
  }

  async function handleTaskCenterOpen(item) {
    if (!item) return
    setIsTaskCenterOpen(false)
    await navigateFromNotification(item)
  }

  async function handleTaskCenterAction(item, action) {
    if (!item?.id || taskCenterActionBusyId) return
    if (action === 'cancel' && !confirmDangerAction('确定取消这个后台任务吗？取消后可能需要重新生成。')) return
    setTaskCenterActionBusyId(item.id)
    setTaskCenterError('')
    try {
      if (action === 'cancel') {
        await cancelTask(item.id)
      } else {
        await retryTask(item.id)
      }
      await loadTaskCenter({ background: true })
    } catch (error) {
      setTaskCenterError(toUserMessage(error, '任务操作失败'))
    } finally {
      setTaskCenterActionBusyId('')
    }
  }

  async function handleDeleteTaskCenterItem(item) {
    if (!item?.id || item.status_group !== 'completed') return
    if (!confirmDangerAction('确定从任务中心移除这条已完成记录吗？')) return
    setTaskCenterActionBusyId(item.id)
    setTaskCenterError('')
    try {
      await archiveTaskCenterItems([item.id])
      await loadTaskCenter({ background: true })
    } catch (error) {
      setTaskCenterError(toUserMessage(error, '任务移除失败'))
    } finally {
      setTaskCenterActionBusyId('')
    }
  }

  async function handleClearCompletedTasks() {
    const completedIds = (taskCenterPayloadRef.current.items || [])
      .filter((item) => item.status_group === 'completed')
      .map((item) => String(item.id))
    if (!completedIds.length) return
    if (!confirmDangerAction(`确定清理 ${completedIds.length} 条已完成任务记录吗？`)) return
    setTaskCenterActionBusyId('__archive_completed__')
    setTaskCenterError('')
    try {
      await archiveCompletedTaskCenterItems()
      await loadTaskCenter({ background: true })
    } catch (error) {
      setTaskCenterError(toUserMessage(error, '清理已完成任务失败'))
    } finally {
      setTaskCenterActionBusyId('')
    }
  }

  async function handleNotificationOpen(item) {
    if (!item?.id) return
    try {
      await markNotificationRead(item.id)
      updateNotificationItemsState((previous) =>
        previous.map((entry) =>
          entry.id === item.id ? { ...entry, read_at: entry.read_at || new Date().toISOString() } : entry,
        ),
      )
      updateNotificationSummaryState((current) => ({
        ...current,
        unread_count: Math.max(0, Number(current.unread_count || 0) - (item.read_at ? 0 : 1)),
      }))
    } catch {
      // Read failure should not block navigation.
    }
    setIsNotificationOpen(false)
    await navigateFromNotification(item)
  }

  async function handleReadAllNotifications() {
    if (notificationActionBusy || notificationSummary.unread_count <= 0) return
    setNotificationActionBusy('read-all')
    setNotificationError('')
    try {
      const payload = await markAllNotificationsRead()
      if (Number(payload?.updated_count || 0) >= 0) {
        const readAt = new Date().toISOString()
        updateNotificationItemsState((previous) => previous.map((item) => ({ ...item, read_at: item.read_at || readAt })))
        updateNotificationSummaryState((current) => ({ ...current, unread_count: 0 }))
      }
    } catch (error) {
      setNotificationError(toUserMessage(error, '全部已读失败，请稍后重试。'))
    } finally {
      setNotificationActionBusy('')
    }
  }

  async function handleDeleteNotification(notificationId) {
    if (!notificationId || notificationActionBusy) return
    if (!confirmDangerAction('确定删除这条通知吗？')) return
    setNotificationActionBusy(`delete:${notificationId}`)
    setNotificationError('')
    try {
      await deleteNotification(notificationId)
      const previousItems = notificationItemsRef.current
      const nextItems = previousItems.filter((item) => item.id !== notificationId)
      const removedItem = previousItems.find((item) => item.id === notificationId)
      updateNotificationItemsState(nextItems)
      updateNotificationSummaryState((current) => {
        const unreadDelta = removedItem && !removedItem.read_at ? 1 : 0
        return {
          ...current,
          unread_count: Math.max(0, Number(current.unread_count || 0) - unreadDelta),
          latest_notification_id: nextItems[0]?.id ?? null,
          latest_created_at: nextItems[0]?.created_at ?? null,
        }
      })
    } catch (error) {
      setNotificationError(toUserMessage(error, '删除通知失败，请稍后重试。'))
    } finally {
      setNotificationActionBusy('')
    }
  }

  async function handleClearAllNotifications() {
    if (notificationActionBusy || !notificationItemsRef.current.length) return
    if (!confirmDangerAction(`确定清空 ${notificationItemsRef.current.length} 条通知吗？`)) return
    setNotificationActionBusy('clear-all')
    setNotificationError('')
    try {
      await clearAllNotifications()
      updateNotificationItemsState([])
      updateNotificationSummaryState((current) => ({
        ...current,
        unread_count: 0,
        latest_notification_id: null,
        latest_created_at: null,
      }))
    } catch (error) {
      setNotificationError(toUserMessage(error, '清空通知失败，请稍后重试。'))
    } finally {
      setNotificationActionBusy('')
    }
  }

  useEffect(() => {
    clearNotificationSummaryPolling()
    clearNotificationDrawerPolling()
    clearNotificationToastTimer()
    clearTaskCenterPolling()
    clearRealtimeEventStream()
    notificationPermissionRequestRef.current = false

    if (!currentUser) {
      didInitNotificationPollingRef.current = false
      lastSeenNotificationIdRef.current = null
      realtimeLastEventIdRef.current = ''
      toastedNotificationIdsRef.current = new Set()
      setNotificationError('')
      setNotificationActionBusy('')
      return undefined
    }

    const initTimerId = window.setTimeout(() => {
      loadNotificationSummary({ silentInit: true, resetOnError: true })
      beginRealtimeEventStream()
      beginNotificationSummaryPolling()
    }, 0)

    return () => {
      window.clearTimeout(initTimerId)
      clearNotificationSummaryPolling()
      clearNotificationDrawerPolling()
      clearNotificationToastTimer()
      clearRealtimeEventStream()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid])

  useEffect(() => {
    clearTaskCenterPolling()

    if (!currentUser) {
      setIsTaskCenterOpen(false)
      updateTaskCenterPayloadState(normalizeTaskCenter())
      setTaskCenterError('')
      setTaskCenterActionBusyId('')
      return undefined
    }

    const initTimerId = window.setTimeout(() => {
      loadTaskCenterSummary({ background: true, resetOnError: true })
      beginTaskCenterPolling()
    }, 0)

    return () => {
      window.clearTimeout(initTimerId)
      clearTaskCenterPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid])

  useEffect(() => {
    if (!currentUser || !isTaskCenterOpen) {
      clearTaskCenterListPolling()
      return undefined
    }
    loadTaskCenter()
    beginTaskCenterListPolling()
    return () => {
      clearTaskCenterListPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, isTaskCenterOpen])

  useEffect(() => {
    if (!currentUser || typeof window === 'undefined' || !('Notification' in window)) {
      notificationPermissionRequestRef.current = false
      return undefined
    }
    if (window.Notification.permission !== 'default' || notificationPermissionRequestRef.current) {
      return undefined
    }

    notificationPermissionRequestRef.current = true
    const requestPermission = () => {
      window.removeEventListener('pointerdown', requestPermission)
      window.removeEventListener('keydown', requestPermission)
      void window.Notification.requestPermission().catch(() => {})
    }

    window.addEventListener('pointerdown', requestPermission, { once: true })
    window.addEventListener('keydown', requestPermission, { once: true })
    return () => {
      window.removeEventListener('pointerdown', requestPermission)
      window.removeEventListener('keydown', requestPermission)
    }
  }, [currentUser?.uid])

  useEffect(() => {
    if (!currentUser || !isNotificationOpen) {
      clearNotificationDrawerPolling()
      return undefined
    }
    loadNotificationList()
    beginNotificationDrawerPolling()
    return () => {
      clearNotificationDrawerPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, isNotificationOpen])

  useEffect(() => {
    if (!currentUser) return undefined

    const handleResume = () => {
      if (shouldPauseBackgroundPolling()) return
      void loadNotificationSummary()
      if (isTaskCenterOpenRef.current) {
        void loadTaskCenter({ background: true })
      } else {
        void loadTaskCenterSummary({ background: true })
      }
    }

    window.addEventListener('focus', handleResume)
    window.addEventListener('online', handleResume)
    document.addEventListener('visibilitychange', handleResume)
    return () => {
      window.removeEventListener('focus', handleResume)
      window.removeEventListener('online', handleResume)
      document.removeEventListener('visibilitychange', handleResume)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid])

  const activeChatMessages = chatMessages[activeView] || []
  const activeChatInput = chatInput[activeView] || ''
  const activeChatAsking = chatAsking[activeView] || false
  const activeInitialSuggestions = chatInitialSuggestions[activeView] || []
  const activeInitialSuggestionsLoading = chatInitialSuggestionsLoading[activeView] || false
  const activeFollowupLoadingMessageId = chatFollowupLoadingMessageId[activeView] || ''
  const isCurrentPaperFullTranslationOpen = Boolean(
    isFullTranslationBetaEnabled
    && isFullTranslationOpen
    && activePaperId
    && fullTranslationOpenPaperId === activePaperId,
  )
  const visibleNotificationToast = currentUser && (
    FULL_TRANSLATION_FEATURE_ENABLED || !isFullTranslationNotification(notificationToast)
  ) ? notificationToast : null
  const notificationHasItems = notificationItems.length > 0
  const visibleTaskCenterPayload = buildVisibleTaskCenterPayload(taskCenterPayload)
  const taskCenterSummary = visibleTaskCenterPayload.summary || normalizeTaskCenterSummary()
  const paperReaderState = {
    error,
    fileName,
    fitToWidth,
    isLoading,
    metadata,
    pageMetrics,
    pageNumber,
    pageNumbers,
    pdfDocument,
    scale,
    setCurrentPage,
    totalPages,
    zoomIn,
    zoomOut,
  }
  const canUndoAnnotation = activePaperId
    ? (annotationUndoStacks[activePaperId]?.length || 0) > 0
    : false

  function applyFullTranslationState(payload) {
    const status = normalizeFullTranslationStatus(payload?.status)
    setFullTranslation(payload || null)
    setFullTranslationStatus(status)
    setFullTranslationProgress(getFullTranslationProgress(payload))
  }

  function clearFullTranslationPolling() {
    if (fullTranslationPollRef.current) {
      window.clearInterval(fullTranslationPollRef.current)
      fullTranslationPollRef.current = null
    }
  }

  function beginFullTranslationPolling(paperId) {
    clearFullTranslationPolling()
    if (!FULL_TRANSLATION_FEATURE_ENABLED) return
    if (!paperId) return
    fullTranslationPollRef.current = window.setInterval(async () => {
      try {
        const payload = await streamFullTranslation(paperId)
        applyFullTranslationState(payload)
        if (payload?.status !== 'running') {
          clearFullTranslationPolling()
        }
      } catch {
        clearFullTranslationPolling()
        setFullTranslationStatus('error')
      }
    }, 1500)
  }

  useEffect(() => () => clearFullTranslationPolling(), [])

  useEffect(() => {
    let cancelled = false
    clearFullTranslationPolling()

    if (!isFullTranslationBetaEnabled) {
      setFullTranslation(null)
      setFullTranslationStatus('idle')
      setFullTranslationProgress(0)
      return undefined
    }

    if (!activePaperId) {
      return undefined
    }

    async function restoreFullTranslationState() {
      try {
        const payload = await fetchFullTranslation(activePaperId)
        if (cancelled) return
        applyFullTranslationState(payload)
        if (payload?.status === 'running') {
          beginFullTranslationPolling(activePaperId)
        }
      } catch {
        if (!cancelled) {
          setFullTranslationStatus('idle')
          setFullTranslationProgress(0)
        }
      }
    }

    restoreFullTranslationState()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaperId, isFullTranslationBetaEnabled])

  function snapshotAnnotations(items) {
    return (items || []).map((annotation) => ({
      page_number: annotation.page_number,
      start_char: annotation.start_char,
      end_char: annotation.end_char,
      quote_text: annotation.quote_text,
      rects: annotation.rects || [],
      type: annotation.type,
      color: annotation.color || null,
      source: annotation.source || 'native',
      geometry_version: annotation.geometry_version || 'v1',
    }))
  }

  function pushAnnotationUndo(paperId, snapshot) {
    if (!paperId) return
    setAnnotationUndoStacks((prev) => {
      const stack = prev[paperId] || []
      return {
        ...prev,
        [paperId]: [...stack, snapshot].slice(-80),
      }
    })
  }

  function clearAnnotationUndo(paperId) {
    if (!paperId) return
    setAnnotationUndoStacks((prev) => {
      const next = { ...prev }
      delete next[paperId]
      return next
    })
    for (const sessionKey of Array.from(eraseUndoSessionsRef.current)) {
      if (sessionKey.startsWith(`${paperId}:`)) {
        eraseUndoSessionsRef.current.delete(sessionKey)
      }
    }
  }

  function handleScreenshotTranslate(selectionPayload) {
    if (!selectionPayload?.text) return
    handleSelection(selectionPayload)
  }

  function createChatMessageId(prefix) {
    chatMessageCounterRef.current += 1
    return `${prefix}-${getNow()}-${chatMessageCounterRef.current}`
  }

  useEffect(() => () => {
    clearReadingResourceRefreshTimer()
  }, [])

  function nextChatRequestToken() {
    chatRequestCounterRef.current += 1
    return chatRequestCounterRef.current
  }

  function normalizeSuggestionQuestions(value) {
    if (!Array.isArray(value)) return []
    const questions = []
    const seen = new Set()

    value.forEach(function (item) {
      const text = String(item || '').trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      questions.push(text)
    })

    return questions.slice(0, 3)
  }

  function sameQuestionSet(left, right) {
    const leftText = normalizeSuggestionQuestions(left).join('\n')
    const rightText = normalizeSuggestionQuestions(right).join('\n')
    return Boolean(leftText) && leftText === rightText
  }

  function normalizeFollowupTitle(title, index) {
    const fallbackTitles = ['深入理解', '结果追问', '延伸应用']
    const text = String(title || '').trim()
    if (!text) return fallbackTitles[index] || `推荐问题 ${index + 1}`
    if (text.includes('迁移')) return '延伸应用'
    return text
  }

  function compactQuestionSubject(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length <= limit ? text : `${text.slice(0, limit).trim()}...`
  }

  function buildInitialSuggestionQuestions(chatContext, batchIndex = 0) {
    const subject = compactQuestionSubject(chatContext?.selected_text || chatContext?.paper_title, 36) || '这篇论文'
    const title = compactQuestionSubject(chatContext?.paper_title, 28) || '这篇论文'
    const batches = [
      [
        `${title} 的核心创新点是什么？`,
        `作者用了什么方法解决 ${subject} 相关问题？`,
        '实验结果最值得关注的是哪几项？',
      ],
      [
        `这篇论文主要想解决什么问题？`,
        `${subject} 在方法流程里起什么作用？`,
        '作者的结论有没有明显局限？',
      ],
      [
        `读这篇论文时应该先抓住哪条主线？`,
        '论文里的关键术语分别是什么意思？',
        '如果要复现这篇论文，第一步该看哪里？',
      ],
      [
        `这篇论文和已有方法最大的差别是什么？`,
        '哪些实验能证明作者的方法有效？',
        `${subject} 对后续研究有什么启发？`,
      ],
    ]

    return normalizeSuggestionQuestions(batches[Math.abs(batchIndex) % batches.length])
  }

  function normalizeFollowupGroups(value) {
    if (!Array.isArray(value)) return []

    return value
      .map(function (item, index) {
        const questions = normalizeSuggestionQuestions(item?.questions || [])
        if (!questions.length) return null

        return {
          title: normalizeFollowupTitle(item?.title, index),
          rationale: String(item?.rationale || '').trim(),
          questions,
        }
      })
      .filter(Boolean)
      .slice(0, 3)
  }

  function mergeQuestionPool(primary, fallback) {
    return normalizeSuggestionQuestions([...(primary || []), ...(fallback || [])])
  }

  function buildFallbackFollowupGroups(payload) {
    const subject = compactQuestionSubject(payload?.selectedText || payload?.paperTitle, 36) || '这篇论文'
    const lastQuestion = compactQuestionSubject(payload?.lastUserQuestion, 42) || '刚才这个问题'
    const legacyQuestions = normalizeSuggestionQuestions(payload?.legacyQuestions || [])

    return [
      {
        title: '深入理解',
        rationale: `围绕 ${subject} 继续拆方法、术语和设计逻辑。`,
        questions: mergeQuestionPool(
          legacyQuestions.slice(0, 1),
          [
            `${subject} 在整篇论文的方法里具体承担什么作用？`,
            `作者为什么这样设计 ${subject}？`,
            `如果只保留最关键的一步，这部分的核心逻辑是什么？`,
          ],
        ),
      },
      {
        title: '结果追问',
        rationale: `顺着“${lastQuestion}”继续追实验结果、对比和局限。`,
        questions: mergeQuestionPool(
          legacyQuestions.slice(1, 2),
          [
            `${lastQuestion} 对应的实验结果是怎么证明的？`,
            '和之前的方法相比，这篇论文提升最明显的是哪一项？',
            '作者有没有提到这个方法的局限或失效场景？',
          ],
        ),
      },
      {
        title: '延伸应用',
        rationale: '把当前论文结论延伸到复现、应用和阅读启发。',
        questions: mergeQuestionPool(
          legacyQuestions.slice(2, 3),
          [
            `${subject} 能迁移到别的任务或数据集上吗？`,
            '如果我想复现这篇论文，最先该准备什么？',
            '这部分结论对我继续读后文有什么帮助？',
          ],
        ),
      },
    ]
  }

  function buildPaperChatContext() {
    return buildPaperChatContextPayload({
      fileName,
      fullText: activePaperFullText,
      metadata,
      notebooks,
      providerId: activeProviderId,
      selectedText: selectionCard.text,
      summary: activePaperSummary,
    })
  }

  function buildRecentChatMessages(messages) {
    return (messages || [])
      .filter(function (message) {
        return (message.role === 'user' || message.role === 'assistant') && (message.text || '').trim()
      })
      .slice(-6)
      .map(function (message) {
        return {
          role: message.role === 'assistant' ? 'assistant' : 'user',
          text: (message.text || '').trim(),
        }
      })
  }

  function clearMessageFollowups(messages) {
    return (messages || []).map(function (message) {
      if (!message?.followupGroups?.length) return message
      return { ...message, followupGroups: [] }
    })
  }

  function updateChatMessagesForView(viewKey, updater) {
    setChatMessages(function (previous) {
      return {
        ...previous,
        [viewKey]: updater(previous[viewKey] || []),
      }
    })
  }

  function handleAskAIText(text) {
    if (!text) return
    setActiveWorkspacePanel('ask')
    setChatInput(function (previous) {
      return {
        ...previous,
        [activeView]: text,
      }
    })
  }

  function handleWorkspacePanelSelect(nextPanel) {
    preloadSideWorkspacePanel()
    setActiveWorkspacePanel(nextPanel)
  }

  async function handleDownloadOption(format) {
    const baseName = sanitizeDownloadName(metadata.title || fileName)
    const suffixMap = {
      pdf: 'pdf',
      word: 'docx',
      'citation-md': 'md',
      bibtex: 'bib',
    }
    const hasExportableAnnotations = (annotations?.length || 0) > 0 || (inkAnnotations?.length || 0) > 0
    if (!activePaperId || Number.isNaN(activePaperId) || !suffixMap[format]) {
      window.alert('当前文献暂时没有可下载地址')
      return
    }
    if (format === 'citation-md') {
      triggerTextDownload(
        [
          `# ${metadata.title || fileName || '文献引用'}`,
          '',
          `- GB/T：${buildCitationText('cajcd', metadata, fileName)}`,
          `- MLA：${buildCitationText('mla', metadata, fileName)}`,
          `- 常规：${buildCitationText('default', metadata, fileName)}`,
        ].join('\n'),
        `${baseName}-citation.md`,
      )
      return
    }
    if (format === 'bibtex') {
      triggerTextDownload(buildCitationText('bibtex', metadata, fileName), `${baseName}.bib`)
      return
    }
    if (!currentUser?.features?.can_export_notes && (format === 'word' || (format === 'pdf' && hasExportableAnnotations))) {
      openMembershipModal()
      return
    }

    try {
      const result = await downloadPaperExport(
        activePaperId,
        format,
        `${baseName}-annotated.${suffixMap[format]}`,
      )
      triggerBlobDownload(result.blob, result.fileName)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '下载失败，请稍后再试。')
    }
  }

  async function handleFullTranslate(options = {}) {
    const force = Boolean(options?.force)
    if (!activePaperId) return

    if (!isFullTranslationBetaEnabled) {
      clearFullTranslationPolling()
      setFullTranslation(null)
      setFullTranslationStatus('idle')
      setFullTranslationProgress(0)
      return
    }

    if (!force && hasReadableFullTranslationCache(fullTranslation)) {
      openFullTranslationReader(activePaperId)
      return
    }

    if (fullTranslationStatus === 'running') {
      const shouldCancel = window.confirm('全文翻译正在进行，确定要取消吗？')
      if (!shouldCancel) {
        beginFullTranslationPolling(activePaperId)
        return
      }
      try {
        const result = await cancelFullTranslation(activePaperId)
        applyFullTranslationState(result)
        clearFullTranslationPolling()
      } catch (err) {
        window.alert(err?.message || '取消全文翻译失败，请稍后再试。')
      }
      return
    }

    if (fullTranslationBusy) {
      return
    }

    if (!pdfDocument) {
      window.alert('PDF 还在加载，稍等一下再启动全文翻译。')
      return
    }

    const shouldRetry = force
      || fullTranslationStatus === 'error'
      || fullTranslationStatus === 'partial_failed'
      || Number(fullTranslation?.pending_blocks_count || 0) > 0
    const shouldPatchFailedBlocks = fullTranslationStatus === 'partial_failed' && hasReadableFullTranslationCache(fullTranslation)
    const confirmMessage = shouldRetry
      ? shouldPatchFailedBlocks
        ? '将优先补译未完成的段落，已完成译文会保留。任务会在后台运行，可在任务中心查看进度。继续吗？'
        : '将重新生成全文翻译 Beta。任务会在后台运行，可在任务中心查看进度；旧译文会被新的结果覆盖。继续吗？'
      : '将启动全文翻译 Beta。当前版本会优先生成右侧重排译文，版式对照仅在解析质量足够时启用；任务可在任务中心查看和取消。继续吗？'
    if (!window.confirm(confirmMessage)) {
      return
    }

    setFullTranslationBusy(true)
    try {
      const pages = await buildFullTranslationPages(pdfDocument, pageMetrics)
      if (!pages.length) {
        window.alert('没有提取到可翻译的正文内容。')
        return
      }
      const payload = {
        source_hash: hashTranslationPages(pages),
        pages,
        provider_id: activeProviderId || null,
        parse_mode: fullTranslationParseMode,
      }
      const request = shouldRetry ? retryFullTranslation : startFullTranslation
      const result = await request(activePaperId, payload)
      applyFullTranslationState(result)
      if (result?.status === 'completed') {
        openFullTranslationReader(activePaperId)
      } else {
        beginFullTranslationPolling(activePaperId)
      }
    } catch (err) {
      window.alert(err?.message || '全文翻译启动失败，请检查 AI 配置后重试。')
      setFullTranslationStatus('error')
    } finally {
      setFullTranslationBusy(false)
    }
  }

  async function fetchInitialSuggestions(force = false) {
    const viewKey = activeView
    if (!viewKey || viewKey === 'home') return

    const existingMessages = chatMessages[viewKey] || []
    const existingSuggestions = chatInitialSuggestions[viewKey] || []
    const isLoading = chatInitialSuggestionsLoading[viewKey] || false

    if (!force) {
      if (existingMessages.length > 0 || existingSuggestions.length > 0 || isLoading) {
        return
      }
    }

    const chatContext = buildPaperChatContext()
    const previousBatch = initialSuggestionBatchRef.current[viewKey] || 0
    const batchIndex = force ? previousBatch + 1 : previousBatch
    initialSuggestionBatchRef.current[viewKey] = batchIndex
    const fallbackQuestions = buildInitialSuggestionQuestions(chatContext, batchIndex)
    const requestToken = nextChatRequestToken()
    initialSuggestionRequestRef.current[viewKey] = requestToken
    setChatInitialSuggestionsLoading(function (previous) {
      return {
        ...previous,
        [viewKey]: true,
      }
    })

    try {
      const token = getStoredAuthToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const response = await fetch('/api/suggest-questions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'initial',
          ...chatContext,
          recent_messages: [],
        }),
      })
      const data = await response.json().catch(function () { return null })

      if (initialSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }

      const aiQuestions = normalizeSuggestionQuestions(data?.questions || [])
      const questions = (!aiQuestions.length || (force && sameQuestionSet(aiQuestions, existingSuggestions)))
        ? fallbackQuestions
        : aiQuestions
      setChatInitialSuggestions(function (previous) {
        return {
          ...previous,
          [viewKey]: questions,
        }
      })
    } catch {
      if (initialSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }
      setChatInitialSuggestions(function (previous) {
        return {
          ...previous,
          [viewKey]: fallbackQuestions,
        }
      })
    } finally {
      if (initialSuggestionRequestRef.current[viewKey] === requestToken) {
        setChatInitialSuggestionsLoading(function (previous) {
          return {
            ...previous,
            [viewKey]: false,
          }
        })
      }
    }
  }

  async function fetchFollowupSuggestions({
    viewKey,
    assistantMessageId,
    lastUserQuestion,
    lastAssistantAnswer,
    messages,
    chatContext,
  }) {
    if (!viewKey || !assistantMessageId || !lastAssistantAnswer.trim()) return

    const fallbackGroups = buildFallbackFollowupGroups({
      paperTitle: chatContext?.paper_title,
      selectedText: chatContext?.selected_text,
      lastUserQuestion,
      lastAssistantAnswer,
      legacyQuestions: [],
    })

    const requestToken = nextChatRequestToken()
    followupSuggestionRequestRef.current[viewKey] = requestToken
    setChatFollowupLoadingMessageId(function (previous) {
      return {
        ...previous,
        [viewKey]: assistantMessageId,
      }
    })

    try {
      const token = getStoredAuthToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const response = await fetch('/api/suggest-questions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'followup',
          ...chatContext,
          last_user_question: lastUserQuestion,
          last_assistant_answer: lastAssistantAnswer,
          recent_messages: buildRecentChatMessages(messages),
        }),
      })
      const data = await response.json().catch(function () { return null })

      if (followupSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }

      const legacyQuestions = normalizeSuggestionQuestions(data?.questions || [])
      const groups = normalizeFollowupGroups(data?.groups || [])
      const resolvedGroups = groups.length
        ? groups
        : buildFallbackFollowupGroups({
            paperTitle: chatContext?.paper_title,
            selectedText: chatContext?.selected_text,
            lastUserQuestion,
            lastAssistantAnswer,
            legacyQuestions,
          })
      updateChatMessagesForView(viewKey, function (entries) {
        return entries.map(function (message) {
          if (message.id === assistantMessageId) {
            return { ...message, followupGroups: resolvedGroups }
          }
          if (message.followupGroups?.length) {
            return { ...message, followupGroups: [] }
          }
          return message
        })
      })
    } catch {
      if (followupSuggestionRequestRef.current[viewKey] !== requestToken) {
        return
      }

      updateChatMessagesForView(viewKey, function (entries) {
        return entries.map(function (message) {
          if (message.id === assistantMessageId) {
            return { ...message, followupGroups: fallbackGroups }
          }
          if (message.followupGroups?.length) {
            return { ...message, followupGroups: [] }
          }
          return message
        })
      })
    } finally {
      if (followupSuggestionRequestRef.current[viewKey] === requestToken) {
        setChatFollowupLoadingMessageId(function (previous) {
          return {
            ...previous,
            [viewKey]: '',
          }
        })
      }
    }
  }

  async function handleChatSubmit(rawQuestion) {
    const chatView = activeView
    const question = String(rawQuestion || chatInput[chatView] || '').trim()
    if (!question || !chatView || chatView === 'home') return

    const chatContext = buildPaperChatContext()
    const baseMessages = clearMessageFollowups(chatMessages[chatView] || [])
    const userMessage = {
      id: createChatMessageId('user'),
      role: 'user',
      text: question,
      status: 'done',
    }
    const assistantMessageId = createChatMessageId('assistant')
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      status: 'streaming',
      followupGroups: [],
    }

    followupSuggestionRequestRef.current[chatView] = null
    setChatFollowupLoadingMessageId(function (previous) {
      return {
        ...previous,
        [chatView]: '',
      }
    })
    setChatMessages(function (previous) {
      return {
        ...previous,
        [chatView]: baseMessages.concat([userMessage, assistantMessage]),
      }
    })
    setChatInput(function (previous) {
      return {
        ...previous,
        [chatView]: '',
      }
    })
    setChatAsking(function (previous) {
      return {
        ...previous,
        [chatView]: true,
      }
    })

    let aiText = ''
    let streamFailed = false

    try {
      const token = getStoredAuthToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const response = await fetch('/api/ask-stream', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question,
          selected_text: chatContext.selected_text,
          paper_title: chatContext.paper_title,
          summary: chatContext.summary,
          provider_id: chatContext.provider_id,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error('stream failed')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break

        buffer += decoder.decode(chunk.value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() || ''

        for (let i = 0; i < parts.length; i += 1) {
          const line = parts[i]
          if (!line.startsWith('data: ')) continue
          aiText += line.slice(6)

          updateChatMessagesForView(chatView, function (entries) {
            return entries.map(function (entry) {
              if (entry.id === assistantMessageId) {
                return {
                  ...entry,
                  text: aiText,
                  status: 'streaming',
                }
              }
              return entry
            })
          })
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        }
      }
    } catch {
      streamFailed = true
    }

    const finalAssistantText = streamFailed
      ? 'AI 回答失败，请稍后再试。'
      : (aiText.trim() || 'AI 暂时没有返回内容。')
    const finalAssistantStatus = streamFailed ? 'error' : 'done'
    const finalMessages = baseMessages.concat([
      userMessage,
      {
        ...assistantMessage,
        text: finalAssistantText,
        status: finalAssistantStatus,
      },
    ])

    setChatMessages(function (previous) {
      return {
        ...previous,
        [chatView]: finalMessages,
      }
    })
    setChatAsking(function (previous) {
      return {
        ...previous,
        [chatView]: false,
      }
    })

    if (!streamFailed && aiText.trim()) {
      await fetchFollowupSuggestions({
        viewKey: chatView,
        assistantMessageId,
        lastUserQuestion: question,
        lastAssistantAnswer: finalAssistantText,
        messages: finalMessages,
        chatContext,
      })
    }
  }

  useEffect(() => {
    if (activeWorkspacePanel !== 'ask' || activeView === 'home') return
    if (activeChatMessages.length > 0) return
    if (activeInitialSuggestions.length > 0 || activeInitialSuggestionsLoading) return
    const timerId = window.setTimeout(() => {
      fetchInitialSuggestions(false)
    }, 0)
    return () => {
      window.clearTimeout(timerId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWorkspacePanel,
    activeView,
    activeChatMessages.length,
    activeInitialSuggestions.length,
    activeInitialSuggestionsLoading,
    metadata.title,
    fileName,
    activePaperSummary,
    selectionCard.text,
  ])

  function applyNoteInsert(block) {
    if (!activePaperId || !block) return
    setActiveWorkspacePanel('notes')
    setNotebooks((previous) => {
      const inserted = insertBlockIntoNotebooks(previous, activeNoteTarget, block)
      setActiveNoteTarget(inserted.target)
      return inserted.notebooks
    })
  }

  async function handleInsertScreenshotNote(payload) {
    if (!activePaperId || !payload?.imageUrl) return
    applyNoteInsert(createImageBlockDraft(payload))
  }

  async function handleInsertSelectionNote(payload) {
    if (!activePaperId || !payload?.text) return
    applyNoteInsert(createQuoteBlockDraft(payload))
  }

  async function handleInsertSummaryNote(content) {
    if (!activePaperId || !content) return
    applyNoteInsert(createTextBlockDraft(0, content))
  }

  function handleCreateNotebook(kind) {
    if (!activePaperId) return
    setActiveWorkspacePanel('notes')
    createNotebookDraft(kind || 'blank')
  }

  async function handleSaveAllNotebooks(nextNotebooks) {
    if (!activePaperId) return null
    const saved = await saveNotebooks(nextNotebooks || notebooks)
    if (saved) {
      const prepared = ensureInsertTarget(saved, activeNoteTarget)
      setActiveNoteTarget(prepared.target)
      scheduleReadingResourceRefresh(1200)
    }
    return saved
  }

  function handleJumpToNoteAnchor(note) {
    const focus = buildNoteAnchorFocus(note, createTransientId('note-focus'))
    if (!focus) return
    setCurrentPage(focus.pageNumber)
    setNoteFocus(focus)
  }

  function handleJumpToSummaryEvidence(source) {
    const focus = buildNoteAnchorFocus(source, createTransientId('summary-focus'))
    if (!focus) return
    setCurrentPage(focus.pageNumber)
    setNoteFocus(focus)
  }

  async function handleJumpToPreviewEvidence(source) {
    if (!resourcePreview?.paperId) {
      handleJumpToSummaryEvidence(source)
      return
    }
    const opened = await openPaperResource(resourcePreview.paperId, { type: resourcePreview.resourceType || 'summary_review' })
    if (!opened) return
    closeResourcePreview()
    window.setTimeout(() => {
      handleJumpToSummaryEvidence(source)
    }, 80)
  }

  async function handleJumpToPaperEvidence(paperId, source) {
    if (!paperId) return
    const opened = await openPaperResource(paperId, { type: 'summary_review' })
    if (!opened) return
    window.setTimeout(() => {
      handleJumpToSummaryEvidence(source)
    }, 80)
  }

  useEffect(() => {
    if (!noteFocus) return undefined
    const timer = window.setTimeout(() => setNoteFocus(null), 2800)
    return () => window.clearTimeout(timer)
  }, [noteFocus])

  async function handleCreateAnnotation(payload) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await createAnnotation(payload)
    if (result) pushAnnotationUndo(activePaperId, before)
    if (result) scheduleReadingResourceRefresh(1200)
    return result
  }

  async function handleDeleteAnnotation(annotationId) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await deleteAnnotation(annotationId)
    if (result) pushAnnotationUndo(activePaperId, before)
    if (result) scheduleReadingResourceRefresh(1200)
    return result
  }

  async function handleClearAnnotations() {
    if (!activePaperId || !annotations.length) return null
    if (!window.confirm(`确定清空当前论文的 ${logicalAnnotationTotal} 条标注吗？此操作可通过撤销恢复一次。`)) return null
    const before = snapshotAnnotations(annotations)
    const result = await clearAnnotations()
    if (result) pushAnnotationUndo(activePaperId, before)
    if (result) scheduleReadingResourceRefresh(1200)
    return result
  }

  async function handleEraseAnnotationRange(payload) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await eraseAnnotationRange(payload)
    if (!result) return null

    const sessionKey = payload?.eraseSessionId
      ? `${activePaperId}:${payload.eraseSessionId}`
      : ''
    if (!sessionKey || !eraseUndoSessionsRef.current.has(sessionKey)) {
      pushAnnotationUndo(activePaperId, before)
      if (sessionKey) eraseUndoSessionsRef.current.add(sessionKey)
    }
    scheduleReadingResourceRefresh()
    return result
  }

  async function handleUndoAnnotation() {
    if (!activePaperId) return
    const stack = annotationUndoStacks[activePaperId] || []
    const previous = stack[stack.length - 1]
    if (!previous) return

    const result = await restoreAnnotations(previous)
    if (!result) return

    setAnnotationUndoStacks((prev) => ({
      ...prev,
      [activePaperId]: (prev[activePaperId] || []).slice(0, -1),
    }))
    scheduleReadingResourceRefresh(1200)
  }

  async function handleCreateInkAnnotation(payload) {
    if (!activePaperId) return null
    const result = await createInkAnnotation(payload)
    if (result) {
      scheduleReadingResourceRefresh()
    }
    return result
  }

  async function handleDeleteInkAnnotation(inkId) {
    if (!activePaperId) return null
    const result = await deleteInkAnnotation(inkId)
    if (result) {
      scheduleReadingResourceRefresh()
    }
    return result
  }

  async function handleCreateShapeAnnotation(payload) {
    if (!activePaperId) return null
    const result = await createShapeAnnotation(payload)
    if (result) {
      scheduleReadingResourceRefresh()
    }
    return result
  }

  async function handleUpdateShapeAnnotation(shapeId, payload) {
    if (!activePaperId) return null
    const result = await updateShapeAnnotation(shapeId, payload)
    if (result) {
      scheduleReadingResourceRefresh()
    }
    return result
  }

  async function handleDeleteShapeAnnotation(shapeId) {
    if (!activePaperId) return null
    const result = await deleteShapeAnnotation(shapeId)
    if (result) {
      scheduleReadingResourceRefresh()
    }
    return result
  }

  async function handleClosePaper(paperId) {
    if (String(paperId) === String(activePaperId)) {
      const canClose = await ensureNotesSavedBeforeLeaving()
      if (!canClose) return
    }
    clearAnnotationUndo(paperId)
    closePaper(paperId)
  }

  async function handleLogout() {
    const canLeave = await ensureNotesSavedBeforeLeaving()
    if (!canLeave) return
    clearNotificationSummaryPolling()
    clearNotificationDrawerPolling()
    clearNotificationToastTimer()
    clearRealtimeEventStream()
    clearStoredAuthToken()
    localStorage.removeItem('xk_read_recent')
    setAnnotationUndoStacks({})
    setChatMessages({})
    setChatInput({})
    setChatAsking({})
    setChatInitialSuggestions({})
    setChatInitialSuggestionsLoading({})
    setChatFollowupLoadingMessageId({})
    initialSuggestionRequestRef.current = {}
    initialSuggestionBatchRef.current = {}
    followupSuggestionRequestRef.current = {}
    eraseUndoSessionsRef.current.clear()
    setCurrentUser(null)
    setIsUserMenuOpen(false)
    setIsNotificationOpen(false)
    updateNotificationItemsState([])
    updateNotificationSummaryState(normalizeNotificationSummary())
    setNotificationToast(null)
    setIsTaskCenterOpen(false)
    updateTaskCenterPayloadState(normalizeTaskCenter())
    setTaskCenterError('')
    setTaskCenterActionBusyId('')
    setHomeInitialSection('recent')
    setSummaryInitialType('')
    setAccountSection('')
    setAuthMode('login')
    setIsAuthViewOpen(false)
    goHome()
  }

  function clearUserMenuCloseTimer() {
    if (userMenuCloseTimerRef.current) {
      window.clearTimeout(userMenuCloseTimerRef.current)
      userMenuCloseTimerRef.current = null
    }
  }

  async function refreshCurrentUserSnapshot() {
    if (!currentUser || userMenuRefreshInFlightRef.current) return
    userMenuRefreshInFlightRef.current = true
    try {
      const nextUser = await fetchCurrentUser()
      setCurrentUser(nextUser)
    } catch {
      // 用户菜单打开时的额度刷新失败不阻断当前交互。
    } finally {
      userMenuRefreshInFlightRef.current = false
    }
  }

  function openUserMenu() {
    clearUserMenuCloseTimer()
    setIsUserMenuOpen(true)
    void refreshCurrentUserSnapshot()
  }

  function scheduleUserMenuClose() {
    clearUserMenuCloseTimer()
    userMenuCloseTimerRef.current = window.setTimeout(() => {
      setIsUserMenuOpen(false)
      userMenuCloseTimerRef.current = null
    }, 140)
  }

  async function openAccountSection(section) {
    const canLeave = await ensureNotesSavedBeforeLeaving()
    if (!canLeave) return
    clearUserMenuCloseTimer()
    setAccountSection(section)
    setIsUserMenuOpen(false)
  }

  function handleCopyUid() {
    if (!currentUser?.uid || !navigator.clipboard) {
      return
    }

    navigator.clipboard.writeText(currentUser.uid).catch(() => {})
  }

  async function handleSaveProfile(payload) {
    const user = await updateCurrentUser(payload)
    setCurrentUser(user)
    return user
  }

  async function handleUploadAvatar(file) {
    const user = await uploadAvatar(file)
    setCurrentUser(user)
    return user
  }

  async function handleDeleteAccount() {
    await deleteCurrentUser()
    handleLogout()
  }

  function handleUiFontSizeChange(nextValue) {
    const normalizedValue = normalizeUiFontSize(nextValue)
    setUiFontSize(normalizedValue)
    storeUiPreferences(currentUser?.uid, { fontSize: normalizedValue })
  }

  const uiFontScale = getUiFontScale(uiFontSize)
  const uiTopbarScale = getUiTopbarScale(uiFontSize)
  const appShellStyle = {
    '--ui-font-scale': uiFontScale,
    '--ui-topbar-scale': uiTopbarScale,
  }
  const shouldShowAuthView = !isSessionRestoring && isAuthViewOpen
  const isHomeWorkspaceActive = !shouldShowAuthView && !isAccountView && isHomeView
  const isReaderWorkspaceActive = !shouldShowAuthView && !isAccountView && isReaderView
  const isAccountWorkspaceActive = !shouldShowAuthView && isAccountView

if (!shouldShowAuthView && currentUser?.is_admin) {
    return (
      <div className="app-shell app-shell--account" style={appShellStyle}>
        <main className="workspace">
          <div className="workspace-view workspace-view--account is-active">
            <Suspense fallback={<ViewFallback message="正在加载管理后台..." />}>
              <AdminPage
                key={accountSection || 'admin-overview'}
                currentUser={currentUser}
                initialSection={accountSection === 'admin-feedback' ? 'feedback' : 'overview'}
                onBack={handleLogout}
              />
            </Suspense>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div
      className={`app-shell${shouldShowAuthView ? ' app-shell--auth' : ''}${
        !shouldShowAuthView && isAccountView ? ' app-shell--account' : ''
      }`}
      style={appShellStyle}
    >
      <input
        ref={fileInputRef}
        accept="application/pdf"
        className="hidden-input"
        multiple
        onChange={handleFileChange}
        type="file"
      />

      {!shouldShowAuthView && !isAccountView ? (
        <header className="topbar">
          <div className="brand-tabs">
            <div className="brand-mark">xk</div>
            <strong>xk 阅读</strong>
            <div className="topbar-tabs">
              <button
                type="button"
                className={`doc-tab doc-tab--home${isHomeView ? ' is-active' : ''}`}
                onClick={async () => {
                  const opened = await goHomeSafely()
                  if (opened) setAccountSection('')
                }}
              >
                首页
              </button>

              {openTabs.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  className={`doc-tab${activeView === paper.id ? ' is-active' : ''}`}
                  onClick={async () => {
                    const opened = await switchToPaperSafely(paper.id)
                    if (opened) setAccountSection('')
                  }}
                >
                  <span className="doc-tab__label">{paper.fileName.replace(/\.pdf$/i, '')}</span>
                  <span
                    aria-label={`关闭 ${paper.fileName}`}
                    className="doc-tab__close"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleClosePaper(paper.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        void handleClosePaper(paper.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-meta">
            <button
              type="button"
              className={`topbar-action topbar-action--vip${currentUser?.membership?.is_vip ? ' is-active' : ''}`}
              onClick={openMembershipModal}
              aria-label="打开 VIP 会员"
            >
              <span className="topbar-action__vip-icon" aria-hidden="true">
                <Crown size={13} />
              </span>
              <span className="topbar-action__vip-copy">
                <span className="topbar-action__label">VIP</span>
              </span>
            </button>
            <button
              type="button"
              className="topbar-action topbar-action--notification"
              onClick={() => setIsNotificationOpen(true)}
            >
              <Bell size={14} />
              <span className="topbar-action__label">通知</span>
              {notificationSummary.unread_count > 0 ? (
                <span className="topbar-action__badge">
                  {notificationSummary.unread_count > 99 ? '99+' : notificationSummary.unread_count}
                </span>
              ) : null}
            </button>
            {!isDesktop ? (
              <a
                className="topbar-action topbar-action--source"
                href={SOURCE_CODE_URL}
                target="_blank"
                rel="noreferrer"
                title={SOURCE_CODE_TITLE}
                aria-label={SOURCE_CODE_TITLE}
              >
                <Code2 size={14} />
                <span className="topbar-action__label">{SOURCE_CODE_LABEL}</span>
              </a>
            ) : null}

            {currentUser ? (
              <button
                type="button"
                className="topbar-action topbar-action--task"
                onClick={() => {
                  setIsTaskCenterOpen(true)
                  void loadTaskCenter()
                }}
                aria-label="打开任务中心"
              >
                <ListChecks size={14} />
                <span className="topbar-action__label">任务</span>
                {taskCenterSummary.attention_count > 0 ? (
                  <span className="topbar-action__badge">
                    {taskCenterSummary.attention_count > 99 ? '99+' : taskCenterSummary.attention_count}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button type="button" className="topbar-action" onClick={openSupportCenter}>
              公众号/客服
            </button>

            {currentUser ? (
              <UserHoverMenu
                currentUser={currentUser}
                currentUserAvatarSrc={currentUserAvatarSrc}
                isAdminUser={isAdminUser}
                isOpen={isUserMenuOpen}
                menuRef={userMenuRef}
                onOpen={openUserMenu}
                onCloseSoon={scheduleUserMenuClose}
                onToggle={() => {
                  clearUserMenuCloseTimer()
                  setIsUserMenuOpen((value) => {
                    const nextValue = !value
                    if (nextValue) {
                      void refreshCurrentUserSnapshot()
                    }
                    return nextValue
                  })
                }}
                onCopyUid={handleCopyUid}
                onOpenMembership={() => {
                  clearUserMenuCloseTimer()
                  setIsUserMenuOpen(false)
                  openMembershipModal()
                }}
                onOpenProfile={() => openAccountSection('profile')}
                onOpenSettings={() => openAccountSection('settings')}
                onOpenAiConfig={() => openAccountSection('ai-config')}
                onOpenAdmin={() => openAccountSection('admin')}
                onLogout={handleLogout}
                notificationSummary={notificationSummary}
                resourceStats={resourceOverview?.stats}
                membershipPlans={membershipPlans}
              />
            ) : (
              <button
                type="button"
                className="topbar-action topbar-action--login"
                onClick={() => {
                  setAuthMode('login')
                  setIsAuthViewOpen(true)
                }}
              >
                <LogIn />
                <span>登录</span>
              </button>
            )}
          </div>
        </header>
      ) : null}

      <main className="workspace">
        {shouldShowAuthView ? (
          <div className="workspace-view workspace-view--auth is-active">
            <Suspense fallback={<ViewFallback message="正在加载登录页..." />}>
              <Login
                key={authMode}
                initialMode={authMode}
                onAuthSuccess={(authPayload) => {
                  storeAuthToken(authPayload.access_token)
                  setCurrentUser(authPayload.user)
                  setIsAuthViewOpen(false)
                }}
              />
            </Suspense>
          </div>
        ) : null}

        <div
          className={`workspace-view workspace-view--home${
            isHomeWorkspaceActive ? ' is-active' : ' is-hidden'
          }`}
        >
          <Suspense fallback={<ViewFallback message="正在加载首页..." />}>
            <HomePage
              currentUser={currentUser}
              folders={folders}
              importConflict={importConflict}
              importStatus={importStatus}
              isImporting={isImporting}
              onCancelImportConflict={cancelImportConflict}
              onCreateFolder={createFolder}
              onDeleteFolder={deleteFolder}
              onDeletePaper={deletePaper}
              onEmptyTrash={emptyTrash}
              onMovePaper={assignPaperToFolder}
              onOpenFilePicker={openFilePicker}
              onOpenPaper={switchToPaperSafely}
              onJumpToPaperEvidence={handleJumpToPaperEvidence}
              onOpenResource={openResourcePreview}
              onPermanentlyDeletePaper={permanentlyDeletePaper}
              onRefreshPaperMetadata={refreshPaperMetadata}
              onRefreshResources={refreshResourceOverview}
              onRefreshTrash={refreshTrashPapers}
              onRestorePaper={restorePaperFromTrash}
              onSaveResourceLayout={handleSaveResourceLayout}
              onRenameFolder={renameFolder}
              onResolveImportConflict={resolveImportConflict}
              onRetryImportConflict={retryImportConflict}
              recentPapers={recentPapers}
              readingDashboard={visibleReadingDashboard}
              insightTimeframe={insightTimeframe}
              onInsightTimeframeChange={setInsightTimeframe}
              recentReadings={recentReadings}
              readingStats={readingStats}
              resourceOverview={visibleResourceOverview}
              trashPapers={trashPapers}
              uiFontScale={uiFontScale}
              uncategorizedFolderId={uncategorizedFolderId}
              initialSection={homeInitialSection}
              onRequestLogin={() => {
                setAuthMode('login')
                setIsAuthViewOpen(true)
              }}
            />
          </Suspense>
        </div>

        <div
          className={`workspace-view workspace-view--reader${
            isReaderWorkspaceActive ? ' is-active' : ' is-hidden'
          }`}
          ref={readerLayoutRef}
        >
          {isReaderWorkspaceActive ? (
            <Suspense fallback={<ViewFallback message="正在加载阅读器..." />}>
              {isCurrentPaperFullTranslationOpen ? (
                <FullTranslationReader
              paperId={activePaperId}
              fileName={fileName}
              metadata={metadata}
              pageMetrics={pageMetrics}
              pageNumbers={pageNumbers}
              pdfDocument={pdfDocument}
              translation={fullTranslation}
              parseMode={fullTranslationParseMode}
              uiFontScale={uiFontScale}
              onParseModeChange={setFullTranslationParseMode}
                  onRegenerate={() => handleFullTranslate({ force: true })}
                  onBack={closeFullTranslationReader}
                />
              ) : (
                <>
                  <PaperReader
                key={`paper-reader:${activePaperId || 'none'}`}
                pdfReader={paperReaderState}
                readerRef={readerRef}
                activeTool={activeTool}
                isThumbnailsOpen={isThumbnailsOpen}
                thumbnailWidth={thumbnailPanel.width}
                onThumbnailResizeStart={thumbnailPanel.startResizeLeft}
                onToggleThumbnails={() => setIsThumbnailsOpen((v) => !v)}
                onToolChange={setActiveTool}
                activeEraserMode={activeEraserMode}
                onEraserModeChange={setActiveEraserMode}
                inkOptions={inkOptions}
                onInkOptionsChange={setInkOptions}
                shapeOptions={shapeOptions}
                onShapeOptionsChange={setShapeOptions}
                onSelect={handleSelection}
                onThumbnailPageClick={(pageNum) => {
                  setCurrentPage(pageNum)
                  const el = readerRef.current?.querySelector(`[data-page-number="${pageNum}"]`)
                  if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' })
                }}
                onWheelZoom={zoomBy}
                searchTerm={pdfSearch.searchTerm}
                onSearchChange={pdfSearch.onSearchChange}
                matchIndex={pdfSearch.matchIndex}
                matches={pdfSearch.matches}
                noteFocus={noteFocus}
                onSearchExecute={pdfSearch.performSearch}
                totalMatches={pdfSearch.totalMatches}
                onSearchPrev={pdfSearch.onSearchPrev}
                onSearchNext={pdfSearch.onSearchNext}
                canUndoAnnotation={canUndoAnnotation}
                onUndoAnnotation={handleUndoAnnotation}
                currentPaperId={activePaperId}
                annotations={annotations}
                inkAnnotations={inkAnnotations}
                shapeAnnotations={shapeAnnotations}
                onCreateAnnotation={handleCreateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onEraseAnnotationRange={handleEraseAnnotationRange}
                onCreateInkAnnotation={handleCreateInkAnnotation}
                onDeleteInkAnnotation={handleDeleteInkAnnotation}
                onCreateShapeAnnotation={handleCreateShapeAnnotation}
                onUpdateShapeAnnotation={handleUpdateShapeAnnotation}
                onDeleteShapeAnnotation={handleDeleteShapeAnnotation}
                onInsertSelectionNote={handleInsertSelectionNote}
                onAskAI={function () { if (selectionCard.text) handleAskAIText(selectionCard.text) }}
                onScreenshotTranslate={handleScreenshotTranslate}
                onScreenshotAskAI={handleAskAIText}
                onScreenshotInsertNote={handleInsertScreenshotNote}
                onDownload={handleDownloadOption}
                fullTranslateVisible={isFullTranslationBetaEnabled}
                fullTranslateActive={hasReadableFullTranslationCache(fullTranslation)}
              fullTranslateStatus={fullTranslationBusy ? 'running' : fullTranslationStatus}
              fullTranslateProgress={fullTranslationProgress}
              fullTranslateParseMode={fullTranslationParseMode}
              onFullTranslateParseModeChange={setFullTranslationParseMode}
              onFullTranslate={handleFullTranslate}
            />

              <div
                aria-label="调整即时理解面板宽度"
                aria-orientation="vertical"
                className="workspace-resizer"
                onPointerDown={insightPanel.startResize}
                role="separator"
              />

              <SelectionInsightPanel
                selectionCard={selectionCard}
                width={insightPanel.width}
                aiEnabled={aiEnabled}
                onToggleAI={toggleAI}
              />

              {activeWorkspacePanel ? (
                <div
                  aria-label="调整工作面板宽度"
                  aria-orientation="vertical"
                  className="workspace-resizer"
                  onPointerDown={workspacePanel.startResize}
                  role="separator"
                />
              ) : null}

              {activeWorkspacePanel ? (
                <Suspense fallback={<WorkspacePanelFallback width={workspacePanel.width} uiFontScale={uiFontScale} />}>
                  <SideWorkspacePanel
                    activePanel={activeWorkspacePanel}
                    paperId={activePaperId}
                    fileName={fileName}
                    metadata={metadata}
                    onSaveMetadata={savePaperMetadata}
                    onRefreshMetadata={refreshPaperMetadata}
                    annotations={annotations}
                    activePaperFullText={activePaperFullText}
                    providerId={activeProviderId}
                    currentUser={currentUser}
                    width={workspacePanel.width}
                    notebooks={notebooks}
                    notesLoading={notesLoading}
                    notesSaving={notesSaving}
                    notesSaveStatus={notesSaveStatus}
                    notesSaveError={notesSaveError}
                    hasUnsavedNotes={hasUnsavedNotes}
                    onRetrySaveNotebooks={retrySaveNotebooks}
                    activeNoteTarget={activeNoteTarget}
                    onCreateNotebook={handleCreateNotebook}
                    onDraftChange={setNotebooks}
                    onSaveNotebooks={handleSaveAllNotebooks}
                    onSetActiveNoteTarget={setActiveNoteTarget}
                    onJumpToNote={handleJumpToNoteAnchor}
                    onRequireVip={openMembershipModal}
                    onJumpToEvidence={handleJumpToSummaryEvidence}
                    onClearAnnotations={handleClearAnnotations}
                    chatMessages={activeChatMessages}
                    chatInput={activeChatInput}
                    chatAsking={activeChatAsking}
                    chatInitialSuggestions={activeInitialSuggestions}
                    chatInitialSuggestionsLoading={activeInitialSuggestionsLoading}
                    chatFollowupLoadingMessageId={activeFollowupLoadingMessageId}
                    uiFontScale={uiFontScale}
                    onChatInputChange={function (value) {
                      setChatInput(function (previous) {
                        return {
                          ...previous,
                          [activeView]: value,
                        }
                      })
                    }}
                    onChatSubmit={handleChatSubmit}
                    onRefreshInitialSuggestions={function () { fetchInitialSuggestions(true) }}
                    onInsertSummaryNote={handleInsertSummaryNote}
                    initialSummaryId={summaryInitialType}
                  />
                </Suspense>
              ) : null}

              <UtilityRail
                activeItem={activeWorkspacePanel}
                collapsed={isUtilityRailCollapsed}
                onSelect={handleWorkspacePanelSelect}
                onItemIntent={preloadSideWorkspacePanel}
                onToggleCollapsed={() => setIsUtilityRailCollapsed((value) => !value)}
              />
                </>
              )}
            </Suspense>
          ) : null}
        </div>

        <div
          className={`workspace-view workspace-view--account${
            isAccountWorkspaceActive ? ' is-active' : ' is-hidden'
          }`}
        >
          {isAccountWorkspaceActive ? (
            <Suspense fallback={<ViewFallback message="正在加载账户页面..." />}>
              {accountSection === 'admin' ? (
                <AdminPage currentUser={currentUser} onBack={() => setAccountSection('')} />
              ) : accountSection === 'ai-config' ? (
                <AiConfigPage onBack={() => setAccountSection('')} />
              ) : (
                <UserCenterPage
                  key={[
                    accountSection || 'profile',
                    currentUser?.uid || 'guest',
                    currentUser?.nickname || '',
                    currentUser?.education || '',
                    currentUser?.occupation || '',
                    currentUser?.organization || '',
                    currentUser?.discipline || '',
                    currentUser?.avatar_url || '',
                  ].join(':')}
                  activeSection={accountSection || 'profile'}
                  currentUser={currentUser}
                  onBack={() => setAccountSection('')}
                  onSaveProfile={handleSaveProfile}
                  onSectionChange={setAccountSection}
                  uiFontSize={uiFontSize}
                  onUiFontSizeChange={handleUiFontSizeChange}
                  onUploadAvatar={handleUploadAvatar}
                  onOpenMembership={openMembershipModal}
                  onDeleteAccount={handleDeleteAccount}
                />
              )}
            </Suspense>
          ) : null}
        </div>
      </main>

      {resourcePreview ? (
        <Suspense fallback={<ViewFallback message="正在加载资源预览..." />}>
          <ResourcePreviewModal
            preview={resourcePreview}
            currentUser={currentUser}
            uiFontScale={uiFontScale}
            onClose={closeResourcePreview}
            onJumpToEvidence={handleJumpToPreviewEvidence}
            onRequireVip={openMembershipModal}
          />
        </Suspense>
      ) : null}

      <Sheet open={isNotificationOpen} onOpenChange={setIsNotificationOpen}>
        <SheetContent className="notification-sheet" side="right">
          <SheetHeader className="notification-sheet__header">
            <div className="notification-sheet__hero">
              <div className="notification-sheet__hero-copy">
                <span className="notification-sheet__eyebrow">消息中心</span>
                <SheetTitle>通知中心</SheetTitle>
                <SheetDescription>这里会保存系统消息、管理员广播和任务结果通知。</SheetDescription>
              </div>
              <div className="notification-sheet__hero-icon" aria-hidden="true">
                <Bell size={18} />
              </div>
            </div>
            <div className="notification-sheet__meta">
              <div className="notification-sheet__meta-card">
                <span className="notification-sheet__meta-label">未读通知</span>
                <strong>{notificationSummary.unread_count}</strong>
              </div>
              <div className="notification-sheet__actions">
                <button
                  type="button"
                  className="notification-sheet__read-all"
                  onClick={handleReadAllNotifications}
                  disabled={Boolean(notificationActionBusy) || notificationSummary.unread_count <= 0}
                >
                  {notificationActionBusy === 'read-all' ? '处理中' : '全部已读'}
                </button>
                <button
                  type="button"
                  className="notification-sheet__clear-all"
                  onClick={handleClearAllNotifications}
                  disabled={Boolean(notificationActionBusy) || notificationItems.length <= 0}
                >
                  {notificationActionBusy === 'clear-all' ? '清理中' : '清空全部'}
                </button>
              </div>
            </div>
          </SheetHeader>

          <div className="notification-sheet__body" aria-busy={notificationLoading}>
            {notificationError && notificationHasItems ? (
              <div className="notification-sheet__notice is-error">
                <span>{notificationError}</span>
                <button type="button" onClick={() => void loadNotificationList()}>
                  重试
                </button>
              </div>
            ) : null}
            {notificationLoading && notificationHasItems ? (
              <div className="notification-sheet__notice">
                <span>正在同步最新通知...</span>
              </div>
            ) : null}
            {notificationError && !notificationHasItems ? (
              <div className="notification-sheet__empty is-error">
                <div className="notification-sheet__empty-icon" aria-hidden="true">
                  <X size={18} />
                </div>
                <strong>通知加载失败</strong>
                <span>{notificationError}</span>
                <button type="button" className="notification-sheet__retry" onClick={() => void loadNotificationList()}>
                  重新加载
                </button>
              </div>
            ) : notificationLoading && !notificationHasItems ? (
              <div className="notification-sheet__empty">
                <div className="notification-sheet__empty-icon" aria-hidden="true">
                  <Sparkles size={18} />
                </div>
                <strong>通知加载中</strong>
                <span>正在整理你最近的系统消息和任务动态。</span>
              </div>
            ) : notificationItems.length ? (
              <div className="notification-list">
                {notificationItems.map((item) => (
                  <div key={item.id} className={`notification-item${item.read_at ? '' : ' is-unread'}`}>
                    <button
                      type="button"
                      className="notification-item__open"
                      onClick={() => handleNotificationOpen(item)}
                    >
                      <div className="notification-item__badge-row">
                        <span className="notification-item__badge">{getNotificationLabel(item)}</span>
                        {!item.read_at ? <span className="notification-item__dot" aria-hidden="true" /> : null}
                      </div>
                      <div className="notification-item__head">
                        <strong>{item.title || '通知'}</strong>
                        <span>{formatNotificationTime(item.created_at)}</span>
                      </div>
                      <p>{item.message || '点击查看通知详情'}</p>
                    </button>
                    <button
                      type="button"
                      className="notification-item__delete"
                      onClick={() => void handleDeleteNotification(item.id)}
                      disabled={Boolean(notificationActionBusy)}
                      aria-label="删除通知"
                      title="删除通知"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="notification-sheet__empty">
                <div className="notification-sheet__empty-icon" aria-hidden="true">
                  <Bell size={18} />
                </div>
                <strong>当前没有通知</strong>
                <span>新的系统消息、广播和任务结果会优先出现在这里。</span>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <TaskCenterSheet
        open={isTaskCenterOpen}
        onOpenChange={setIsTaskCenterOpen}
        payload={visibleTaskCenterPayload}
        loading={taskCenterLoading}
        error={taskCenterError}
        actionBusyId={taskCenterActionBusyId}
        onRefresh={() => void loadTaskCenter()}
        onClearCompletedTasks={handleClearCompletedTasks}
        onDeleteTask={handleDeleteTaskCenterItem}
        onOpenTask={handleTaskCenterOpen}
        onCancelTask={(item) => void handleTaskCenterAction(item, 'cancel')}
        onRetryTask={(item) => void handleTaskCenterAction(item, 'retry')}
      />

      {visibleNotificationToast ? (
        <button type="button" className="notification-toast" onClick={() => handleNotificationOpen(visibleNotificationToast)}>
          <div className="notification-toast__icon">
            <Bell size={16} />
          </div>
          <div className="notification-toast__content">
            <span className="notification-toast__eyebrow">{getNotificationLabel(visibleNotificationToast)}</span>
            <strong>{visibleNotificationToast.title || '通知'}</strong>
            <p>{visibleNotificationToast.message || '点击查看详情'}</p>
          </div>
          <span
            className="notification-toast__close"
            onClick={(event) => {
              event.stopPropagation()
              clearNotificationToastTimer()
              setNotificationToast(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                clearNotificationToastTimer()
                setNotificationToast(null)
              }
            }}
            role="button"
            tabIndex={0}
          >
            <X size={14} />
          </span>
        </button>
      ) : null}

      <MembershipModal
        open={isMembershipModalOpen}
        plans={membershipPlans}
        currentUser={currentUser}
        onClose={closeMembershipModal}
        onRequireLogin={() => {
          closeMembershipModal()
          setAuthMode('login')
          setIsAuthViewOpen(true)
        }}
        onRedeemed={async () => {
          closeMembershipModal()
          try {
            const nextUser = await fetchCurrentUser()
            setCurrentUser(nextUser)
          } catch {
            void 0
          }
        }}
      />
    </div>
  )
}

export default App
