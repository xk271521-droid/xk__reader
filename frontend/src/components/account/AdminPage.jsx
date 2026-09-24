import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Bell,
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  Users,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  broadcastAdminNotification,
  createAdminMembershipCodes,
  fetchAdminFeedback,
  fetchAdminMembershipCodes,
  fetchAdminOverview,
  fetchAdminUserDetail,
  fetchAdminUsers,
  fetchSystemHealth,
  updateAdminMembershipCode,
  updateAdminFeedback,
  updateAdminUser,
  uploadAdminUserAvatar,
} from '../../services/adminApi'
import { resolveAssetUrl } from '../../utils/assetUrl'
import '../../styles/admin-dashboard.css'

const PAGE_SIZE = 12
const AUTO_REFRESH_MS = 3 * 60 * 1000

const DEFAULT_FILTERS = {
  q: '',
  status: '',
  is_admin: '',
  education_verified: '',
  created_from: '',
  created_to: '',
}

const DEFAULT_FEEDBACK_FILTERS = {
  q: '',
  status: '',
  category: '',
  page: 1,
  page_size: PAGE_SIZE,
}

const DEFAULT_PROFILE_DRAFT = {
  nickname: '',
  phone: '',
  email: '',
  education: '',
  occupation: '',
  organization: '',
  discipline: '',
}

const DEFAULT_BROADCAST_DRAFT = {
  title: '',
  message: '',
}

const DEFAULT_CODE_FILTERS = {
  q: '',
  status: '',
  note_state: '',
  batch_label: '',
}

const DEFAULT_CODE_DRAFT = {
  plan_code: 'vip_monthly',
  quantity: 10,
  duration_days: 30,
  batch_label: '',
  note: '',
}

const NAV_ITEMS = [
  { id: 'codes', label: '兑换码', description: '批量生成、筛选、复制与导出', icon: KeyRound },
  { id: 'overview', label: '总览', description: '整体数据与最近动态', icon: LayoutDashboard },
  { id: 'users', label: '用户', description: '搜索、编辑、查看行为', icon: Users },
  { id: 'feedback', label: '问题箱', description: '查看用户反馈与处理进度', icon: Bug },
  { id: 'broadcast', label: '通知', description: '向所有用户发送通知', icon: Bell },
  { id: 'health', label: '监控', description: '查看后端健康、任务积压与恢复情况', icon: Activity },
]

const DETAIL_TABS = [
  { id: 'profile', label: '资料' },
  { id: 'activity', label: '行为' },
  { id: 'permissions', label: '权限' },
]

function formatDateTime(value) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0))
}

function formatDuration(seconds) {
  const total = Number(seconds || 0)
  if (!total) return '0 分钟'
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  if (hours <= 0) return `${minutes} 分钟`
  return `${hours} 小时 ${minutes} 分钟`
}

function getDisplayName(user, fallback = '未命名用户') {
  const nickname = String(user?.nickname || '').trim()
  if (nickname) return nickname
  const uid = String(user?.uid || '').trim()
  return uid ? `UID ${uid}` : fallback
}

function getRedeemedUserDisplay(item) {
  const candidates = [
    item?.redeemed_by_name,
    item?.redeemed_by_phone,
    item?.redeemed_by_email,
    item?.redeemed_by_uid ? `UID ${item.redeemed_by_uid}` : '',
  ]
  const display = candidates.map((value) => String(value || '').trim()).find(Boolean)
  if (display) return display
  return item?.redeemed_by ? `用户 #${item.redeemed_by}` : '--'
}

function getIdentityLine(user) {
  const values = [user?.organization, user?.discipline]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  if (!values.length) return '未填写单位与学科'
  return values.join(' / ')
}

function buildPagination(page, totalPages) {
  if (totalPages <= 1) return [1]
  const values = new Set([1, totalPages, page - 1, page, page + 1])
  const sorted = [...values].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b)
  const pages = []
  let previous = null

  sorted.forEach((value) => {
    if (previous !== null && value - previous > 1) pages.push(`ellipsis-${previous}-${value}`)
    pages.push(value)
    previous = value
  })

  return pages
}

function normalizePagedPayload(payload) {
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    page: Number(payload?.page || 1),
    page_size: Number(payload?.page_size || PAGE_SIZE),
    total: Number(payload?.total || 0),
    total_pages: Number(payload?.total_pages || 1),
  }
}

function buildProfileDraft(user) {
  return {
    nickname: String(user?.nickname || '').trim(),
    phone: String(user?.phone || '').trim(),
    email: String(user?.email || '').trim(),
    education: String(user?.education || '').trim(),
    occupation: String(user?.occupation || '').trim(),
    organization: String(user?.organization || '').trim(),
    discipline: String(user?.discipline || '').trim(),
  }
}

function areProfileDraftsEqual(a, b) {
  return (
    a.nickname === b.nickname
    && a.phone === b.phone
    && a.email === b.email
    && a.education === b.education
    && a.occupation === b.occupation
    && a.organization === b.organization
    && a.discipline === b.discipline
  )
}

function buildProfileUpdatePayload(currentDraft, baseDraft) {
  const payload = {}
  if (currentDraft.nickname !== baseDraft.nickname) payload.nickname = currentDraft.nickname
  if (currentDraft.phone !== baseDraft.phone) payload.phone = currentDraft.phone
  if (currentDraft.email !== baseDraft.email) payload.email = currentDraft.email || null
  if (currentDraft.education !== baseDraft.education) payload.education = currentDraft.education
  if (currentDraft.occupation !== baseDraft.occupation) payload.occupation = currentDraft.occupation
  if (currentDraft.organization !== baseDraft.organization) payload.organization = currentDraft.organization
  if (currentDraft.discipline !== baseDraft.discipline) payload.discipline = currentDraft.discipline
  return payload
}

function UserAvatar({ user, className = '' }) {
  const avatarSrc = resolveAssetUrl(user?.avatar_url)
  const initials = getDisplayName(user, 'U').replace(/^UID\s+/i, '').slice(0, 2).toUpperCase()

  return (
    <div className={`adminx-avatar ${className}`.trim()}>
      {avatarSrc ? <img src={avatarSrc} alt={getDisplayName(user)} /> : <span>{initials}</span>}
    </div>
  )
}

function EmptyState({ title, description, action = null }) {
  return (
    <div className="adminx-empty-state">
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  )
}

function StatusBadge({ tone = 'slate', children }) {
  return <span className={`adminx-badge adminx-badge--${tone}`}>{children}</span>
}

function StatCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  return (
    <article className={`adminx-stat-card adminx-stat-card--${tone}`}>
      <div className="adminx-stat-card__icon">
        <Icon />
      </div>
      <div className="adminx-stat-card__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

function AdminToast({ flash, onClose }) {
  if (!flash) return null
  return (
    <div className={`adminx-toast adminx-toast--${flash.tone || 'error'}`}>
      <span>{flash.message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">知道了</button>
    </div>
  )
}

function getFeedbackStatusLabel(value) {
  if (value === 'in_progress') return '处理中'
  if (value === 'resolved') return '已解决'
  if (value === 'closed') return '已关闭'
  return '待处理'
}

function getCodeStatusLabel(value) {
  if (value === 'active') return '可用'
  if (value === 'disabled') return '已禁用'
  if (value === 'expired') return '已过期'
  if (value === 'redeemed') return '已兑换'
  return value || '未知'
}

function getCodeStatusTone(value) {
  if (value === 'active') return 'green'
  if (value === 'disabled') return 'red'
  if (value === 'expired') return 'gold'
  if (value === 'redeemed') return 'slate'
  return 'slate'
}

function getHealthStatusLabel(value) {
  if (value === 'ok') return '正常'
  if (value === 'degraded') return '需关注'
  if (value === 'error') return '异常'
  return value ? String(value) : '未知'
}

function getHealthStatusTone(value) {
  if (value === 'ok' || value === true) return 'green'
  if (value === 'degraded') return 'gold'
  if (value === 'error' || value === false) return 'red'
  return 'slate'
}

function formatFeatureEnabled(value) {
  return value ? '已启用' : '未启用'
}

function getStatusCount(counts, key) {
  return Number(counts?.[key] || 0)
}

function normalizeCodeDraft(draft) {
  return {
    plan_code: String(draft?.plan_code || 'vip_monthly').trim() || 'vip_monthly',
    quantity: Math.max(1, Math.min(200, Number(draft?.quantity || 1) || 1)),
    duration_days: Math.max(1, Math.min(3650, Number(draft?.duration_days || 30) || 30)),
    batch_label: String(draft?.batch_label || '').trim().toUpperCase(),
    note: String(draft?.note || '').trim(),
  }
}

async function copyPlainText(text) {
  const value = String(text || '')
  if (!value) return false

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {}

  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function AdminPage({ currentUser, onBack, initialSection = 'overview' }) {
  const [activeSection, setActiveSection] = useState(initialSection)
  const [detailTab, setDetailTab] = useState('profile')
  const [overview, setOverview] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState({ ...DEFAULT_FILTERS, page: 1, page_size: PAGE_SIZE })
  const [pageData, setPageData] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 })
  const [feedbackQuery, setFeedbackQuery] = useState(DEFAULT_FEEDBACK_FILTERS)
  const [feedbackSearchInput, setFeedbackSearchInput] = useState('')
  const [feedbackPageData, setFeedbackPageData] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 })
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedFeedbackId, setSelectedFeedbackId] = useState(null)
  const [profileDraft, setProfileDraft] = useState(DEFAULT_PROFILE_DRAFT)
  const [feedbackNoteDraft, setFeedbackNoteDraft] = useState('')
  const [broadcastDraft, setBroadcastDraft] = useState(DEFAULT_BROADCAST_DRAFT)
  const [codeDraft, setCodeDraft] = useState(DEFAULT_CODE_DRAFT)
  const [codeFilters, setCodeFilters] = useState(DEFAULT_CODE_FILTERS)
  const [codeSearchInput, setCodeSearchInput] = useState('')
  const [membershipCodes, setMembershipCodes] = useState([])
  const [lastCreatedCodes, setLastCreatedCodes] = useState([])
  const [healthReport, setHealthReport] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [listLoading, setListLoading] = useState(true)
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const [healthLoading, setHealthLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  const [codeCreating, setCodeCreating] = useState(false)
  const [codeUpdatingId, setCodeUpdatingId] = useState(null)
  const [flash, setFlash] = useState(null)

  const usersRequestRef = useRef(0)
  const feedbackRequestRef = useRef(0)
  const codesRequestRef = useRef(0)
  const healthRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const avatarInputRef = useRef(null)
  const flashTimerRef = useRef(null)

  const stats = overview?.stats || {}
  const adminDisplayName = getDisplayName(currentUser, '管理员')
  const selectedDisplayName = getDisplayName(selectedUser, '未选中用户')
  const selectedFeedback = feedbackPageData.items.find((item) => item.id === selectedFeedbackId) || feedbackPageData.items[0] || null
  const normalizedProfileDraft = useMemo(
    () => ({
      nickname: profileDraft.nickname.trim(),
      phone: profileDraft.phone.trim(),
      email: profileDraft.email.trim().toLowerCase(),
      education: profileDraft.education.trim(),
      occupation: profileDraft.occupation.trim(),
      organization: profileDraft.organization.trim(),
      discipline: profileDraft.discipline.trim(),
    }),
    [profileDraft],
  )
  const baseProfileDraft = useMemo(() => buildProfileDraft(selectedUser), [selectedUser])
  const isProfileDirty = !areProfileDraftsEqual(normalizedProfileDraft, baseProfileDraft)
  const registrationTrend = useMemo(() => {
    if (!Array.isArray(overview?.activity_trend)) return []
    return overview.activity_trend.map((item) => ({
      name: item.date || '--',
      registrations: Number(item.registrations || 0),
      imports: Number(item.imports || 0),
    }))
  }, [overview])
  const normalizedCodeDraft = useMemo(() => normalizeCodeDraft(codeDraft), [codeDraft])
  const filteredMembershipCodes = useMemo(() => {
    const keyword = String(codeFilters.q || '').trim().toLowerCase()
    const batchKeyword = String(codeFilters.batch_label || '').trim().toLowerCase()
    return membershipCodes.filter((item) => {
      const statusValue = String(item?.status || '')
      const noteValue = String(item?.notes || '').trim()
      const haystack = [
        item?.code,
        item?.code_prefix,
        item?.batch_label,
        item?.notes,
        item?.plan_code,
        item?.redeemed_by,
        item?.redeemed_by_name,
        item?.redeemed_by_uid,
        item?.redeemed_by_phone,
        item?.redeemed_by_email,
        getRedeemedUserDisplay(item),
      ].join(' ').toLowerCase()

      if (keyword && !haystack.includes(keyword)) return false
      if (batchKeyword && !String(item?.batch_label || '').toLowerCase().includes(batchKeyword)) return false
      if (codeFilters.status && statusValue !== codeFilters.status) return false
      if (codeFilters.note_state === 'with' && !noteValue) return false
      if (codeFilters.note_state === 'without' && noteValue) return false
      return true
    })
  }, [codeFilters, membershipCodes])
  const codeStatusSummary = useMemo(() => {
    return membershipCodes.reduce((summary, item) => {
      const key = String(item?.status || 'unknown')
      summary[key] = Number(summary[key] || 0) + 1
      return summary
    }, {})
  }, [membershipCodes])

  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
  }, [])

  useEffect(() => {
    void loadOverviewData()
  }, [])

  useEffect(() => {
    void loadUsersPage(query)
  }, [query])

  useEffect(() => {
    if (activeSection !== 'feedback') return
    void loadFeedbackPage(feedbackQuery)
  }, [activeSection, feedbackQuery])

  useEffect(() => {
    if (activeSection !== 'codes') return
    void loadMembershipCodes()
  }, [activeSection])

  useEffect(() => {
    if (activeSection !== 'health') return
    void loadSystemHealth()
  }, [activeSection])

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUser(null)
      return
    }

    const matchingUser = pageData.items.find((item) => item.id === selectedUserId)
    if (matchingUser) {
      setSelectedUser((previous) => {
        if (previous?.id !== matchingUser.id) return matchingUser
        return { ...previous, ...matchingUser, avatar_url: previous?.avatar_url || matchingUser.avatar_url || '' }
      })
    }

    void loadUserDetail(selectedUserId)
  }, [pageData.items, selectedUserId])

  useEffect(() => {
    setProfileDraft(buildProfileDraft(selectedUser))
  }, [selectedUser])

  useEffect(() => {
    setFeedbackNoteDraft(selectedFeedback?.admin_note || '')
  }, [selectedFeedback?.id, selectedFeedback?.admin_note])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void handleRefreshData()
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [query, selectedUserId, activeSection, feedbackQuery])

  function showFlash(message, tone = 'error') {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    setFlash({ message, tone })
    flashTimerRef.current = window.setTimeout(() => {
      setFlash(null)
      flashTimerRef.current = null
    }, 3200)
  }

  async function loadOverviewData(options = {}) {
    const { silent = false, suppressErrors = false } = options
    if (!silent) setOverviewLoading(true)

    try {
      const payload = await fetchAdminOverview()
      setOverview(payload || null)
      return payload || null
    } catch (error) {
      if (!suppressErrors) showFlash(error instanceof Error ? error.message : '总览数据加载失败')
      return null
    } finally {
      if (!silent) setOverviewLoading(false)
    }
  }

  async function loadUsersPage(nextQuery = query, options = {}) {
    const requestId = ++usersRequestRef.current
    if (!options.silent) setListLoading(true)

    try {
      const payload = await fetchAdminUsers(nextQuery)
      if (requestId !== usersRequestRef.current) return null
      const normalized = normalizePagedPayload(payload)
      setPageData(normalized)

      if (!selectedUserId && normalized.items[0]) {
        setSelectedUserId(normalized.items[0].id)
      } else if (normalized.items.length && !normalized.items.some((item) => item.id === selectedUserId)) {
        setSelectedUserId(normalized.items[0].id)
      }

      return normalized
    } catch (error) {
      if (!options.suppressErrors) showFlash(error instanceof Error ? error.message : '用户列表加载失败')
      return null
    } finally {
      if (!options.silent && requestId === usersRequestRef.current) setListLoading(false)
    }
  }

  async function loadFeedbackPage(nextQuery = feedbackQuery, options = {}) {
    const requestId = ++feedbackRequestRef.current
    if (!options.silent) setFeedbackLoading(true)

    try {
      const payload = await fetchAdminFeedback(nextQuery)
      if (requestId !== feedbackRequestRef.current) return null
      const normalized = normalizePagedPayload(payload)
      setFeedbackPageData(normalized)

      if (!selectedFeedbackId && normalized.items[0]) {
        setSelectedFeedbackId(normalized.items[0].id)
      } else if (normalized.items.length && !normalized.items.some((item) => item.id === selectedFeedbackId)) {
        setSelectedFeedbackId(normalized.items[0].id)
      }

      return normalized
    } catch (error) {
      if (!options.suppressErrors) showFlash(error instanceof Error ? error.message : '问题反馈加载失败')
      return null
    } finally {
      if (!options.silent && requestId === feedbackRequestRef.current) setFeedbackLoading(false)
    }
  }

  async function loadMembershipCodes(options = {}) {
    const requestId = ++codesRequestRef.current
    if (!options.silent) setCodeLoading(true)

    try {
      const payload = await fetchAdminMembershipCodes()
      if (requestId !== codesRequestRef.current) return null
      const items = Array.isArray(payload?.items) ? payload.items : []
      setMembershipCodes(items)
      return items
    } catch (error) {
      if (!options.suppressErrors) showFlash(error instanceof Error ? error.message : '兑换码加载失败')
      return null
    } finally {
      if (!options.silent && requestId === codesRequestRef.current) setCodeLoading(false)
    }
  }

  async function loadSystemHealth(options = {}) {
    const requestId = ++healthRequestRef.current
    if (!options.silent) setHealthLoading(true)

    try {
      const payload = await fetchSystemHealth()
      if (requestId !== healthRequestRef.current) return null
      setHealthReport(payload || null)
      return payload || null
    } catch (error) {
      if (!options.suppressErrors) showFlash(error instanceof Error ? error.message : '系统监控加载失败')
      return null
    } finally {
      if (!options.silent && requestId === healthRequestRef.current) setHealthLoading(false)
    }
  }

  async function loadUserDetail(userId, options = {}) {
    const { silent = false, suppressErrors = false } = options
    if (!userId) return null

    const requestId = ++detailRequestRef.current
    if (!silent) setDetailLoading(true)

    try {
      const payload = await fetchAdminUserDetail(userId)
      if (requestId !== detailRequestRef.current) return null
      const nextUser = payload?.user || null
      setSelectedUser(nextUser)
      return nextUser
    } catch (error) {
      if (!suppressErrors) showFlash(error instanceof Error ? error.message : '用户详情加载失败')
      return null
    } finally {
      if (!silent && requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }

  async function handleRefreshData() {
    setRefreshing(true)
    try {
      await Promise.all([
        loadOverviewData({ silent: true, suppressErrors: true }),
        loadUsersPage(query, { silent: true, suppressErrors: true }),
        activeSection === 'feedback' ? loadFeedbackPage(feedbackQuery, { silent: true, suppressErrors: true }) : Promise.resolve(null),
        activeSection === 'codes' ? loadMembershipCodes({ silent: true, suppressErrors: true }) : Promise.resolve(null),
        activeSection === 'health' ? loadSystemHealth({ silent: true, suppressErrors: true }) : Promise.resolve(null),
        selectedUserId ? loadUserDetail(selectedUserId, { silent: true, suppressErrors: true }) : Promise.resolve(null),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  function patchUserEverywhere(updatedUser) {
    setSelectedUser(updatedUser)
    setPageData((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === updatedUser.id ? { ...item, ...updatedUser } : item)),
    }))
  }

  function patchFeedbackEverywhere(updatedItem) {
    setFeedbackPageData((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    }))
  }

  function updateFilter(key, value) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setQuery((previous) => ({ ...previous, [key]: value, page: 1 }))
  }

  function applySearch() {
    setQuery((previous) => ({ ...previous, q: searchInput.trim(), page: 1 }))
  }

  function clearAllFilters() {
    setFilters(DEFAULT_FILTERS)
    setSearchInput('')
    setQuery({ ...DEFAULT_FILTERS, page: 1, page_size: PAGE_SIZE })
  }

  function applyFeedbackSearch() {
    setFeedbackQuery((previous) => ({ ...previous, q: feedbackSearchInput.trim(), page: 1 }))
  }

  function updateFeedbackFilter(key, value) {
    setFeedbackQuery((previous) => ({ ...previous, [key]: value, page: 1 }))
  }

  function clearFeedbackFilters() {
    setFeedbackSearchInput('')
    setFeedbackQuery(DEFAULT_FEEDBACK_FILTERS)
  }

  function updateCodeDraftField(key, value) {
    setCodeDraft((previous) => ({ ...previous, [key]: value }))
  }

  function updateCodeFilter(key, value) {
    setCodeFilters((previous) => ({ ...previous, [key]: value }))
  }

  function applyCodeSearch() {
    setCodeFilters((previous) => ({ ...previous, q: codeSearchInput.trim() }))
  }

  function clearCodeFilters() {
    setCodeSearchInput('')
    setCodeFilters(DEFAULT_CODE_FILTERS)
  }

  function patchMembershipCode(updatedItem) {
    setMembershipCodes((previous) => previous.map((item) => (item.id === updatedItem.id ? updatedItem : item)))
    setLastCreatedCodes((previous) => previous.map((item) => (item.id === updatedItem.id ? updatedItem : item)))
  }

  async function handleCopyCodes(items, onlyCodes = false) {
    const list = Array.isArray(items) ? items : []
    if (!list.length) {
      showFlash('当前没有可复制的兑换码')
      return
    }

    const text = onlyCodes
      ? list.map((item) => item.code).join('\n')
      : list.map((item) => [
        item.code,
        item.status,
        item.plan_code,
        item.duration_days,
        item.batch_label || '',
        item.notes || '',
      ].join('\t')).join('\n')

    const copied = await copyPlainText(text)
    showFlash(copied ? `已复制 ${list.length} 条兑换码` : '复制失败，请重试', copied ? 'success' : 'error')
  }

  function handleExportCodes(items) {
    const list = Array.isArray(items) ? items : []
    if (!list.length) {
      showFlash('当前没有可导出的兑换码')
      return
    }

    const header = ['code', 'status', 'plan_code', 'duration_days', 'batch_label', 'notes', 'redeemed_user', 'redeemed_by', 'redeemed_at', 'expires_at', 'created_at']
    const rows = list.map((item) => header.map((key) => {
      const value = key === 'redeemed_user' ? getRedeemedUserDisplay(item) : item?.[key]
      return `"${String(value ?? '').replaceAll('"', '""')}"`
    }).join(','))
    downloadTextFile(`membership-codes-${Date.now()}.csv`, [header.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8')
    showFlash(`已导出 ${list.length} 条兑换码`, 'success')
  }

  function handleSelectUser(userId, nextSection = null) {
    setSelectedUserId(userId)
    if (nextSection) setActiveSection(nextSection)
  }

  function updateProfileField(key, value) {
    setProfileDraft((previous) => ({ ...previous, [key]: value }))
  }

  function updateBroadcastField(key, value) {
    setBroadcastDraft((previous) => ({ ...previous, [key]: value }))
  }

  function resetProfileDraft() {
    setProfileDraft(baseProfileDraft)
  }

  async function saveProfileDraft() {
    if (!selectedUserId || !selectedUser) return

    const requiredFields = [
      ['nickname', '昵称'],
      ['phone', '手机号'],
      ['education', '学历'],
      ['occupation', '职业'],
      ['organization', '单位'],
      ['discipline', '学科'],
    ]
    const firstMissingField = requiredFields.find(([key]) => !normalizedProfileDraft[key])
    if (firstMissingField) {
      showFlash(`${firstMissingField[1]}不能为空`)
      return
    }

    const payload = buildProfileUpdatePayload(normalizedProfileDraft, baseProfileDraft)
    if (!Object.keys(payload).length) {
      showFlash('资料没有变化', 'success')
      return
    }

    setProfileSaving(true)
    try {
      const updated = await updateAdminUser(selectedUserId, payload)
      patchUserEverywhere(updated)
      await loadUserDetail(selectedUserId, { silent: true, suppressErrors: true })
      await loadUsersPage(query, { silent: true, suppressErrors: true })
      showFlash('资料已保存', 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '资料保存失败')
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selectedUserId) return

    setAvatarUploading(true)
    try {
      const updated = await uploadAdminUserAvatar(selectedUserId, file)
      patchUserEverywhere(updated)
      await loadUserDetail(selectedUserId, { silent: true, suppressErrors: true })
      await loadUsersPage(query, { silent: true, suppressErrors: true })
      showFlash('头像已更新', 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '头像上传失败')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function submitBroadcastNotification() {
    const title = String(broadcastDraft.title || '').trim()
    const message = String(broadcastDraft.message || '').trim()
    if (!title) return showFlash('通知标题不能为空')
    if (!message) return showFlash('通知内容不能为空')
    if (!window.confirm('确定发送给所有用户吗？发送后用户会立即收到通知。')) return

    setBroadcastSending(true)
    try {
      const payload = await broadcastAdminNotification({ title, message })
      setBroadcastDraft(DEFAULT_BROADCAST_DRAFT)
      showFlash(`通知已发出，${Number(payload?.delivered_count || 0)} 个用户可收到`, 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '通知发送失败')
    } finally {
      setBroadcastSending(false)
    }
  }

  async function handlePermissionAction(payload, successMessage) {
    if (!selectedUserId || !selectedUser) return
    try {
      const updated = await updateAdminUser(selectedUserId, payload)
      patchUserEverywhere(updated)
      await loadUserDetail(selectedUserId, { silent: true, suppressErrors: true })
      await loadUsersPage(query, { silent: true, suppressErrors: true })
      void loadOverviewData({ silent: true, suppressErrors: true })
      showFlash(successMessage, 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '权限更新失败')
    }
  }

  async function updateFeedbackStatus(status) {
    if (!selectedFeedback) return
    setFeedbackSaving(true)
    try {
      const updated = await updateAdminFeedback(selectedFeedback.id, { status, admin_note: feedbackNoteDraft })
      patchFeedbackEverywhere(updated)
      showFlash('反馈状态已更新', 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '反馈状态更新失败')
    } finally {
      setFeedbackSaving(false)
    }
  }

  async function saveFeedbackNote() {
    if (!selectedFeedback) return
    setFeedbackSaving(true)
    try {
      const updated = await updateAdminFeedback(selectedFeedback.id, { admin_note: feedbackNoteDraft })
      patchFeedbackEverywhere(updated)
      showFlash('管理员备注已保存', 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '备注保存失败')
    } finally {
      setFeedbackSaving(false)
    }
  }

  async function submitCodeBatch() {
    setCodeCreating(true)
    try {
      const payload = await createAdminMembershipCodes(normalizedCodeDraft)
      const items = Array.isArray(payload?.items) ? payload.items : []
      setMembershipCodes((previous) => [...items, ...previous])
      setLastCreatedCodes(items)
      setCodeDraft((previous) => ({
        ...DEFAULT_CODE_DRAFT,
        batch_label: previous.batch_label,
        note: previous.note,
      }))
      showFlash(`已生成 ${items.length} 条兑换码`, 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '兑换码生成失败')
    } finally {
      setCodeCreating(false)
    }
  }

  async function toggleMembershipCode(item) {
    if (!item?.id) return
    const nextStatus = item.status === 'active' ? 'disabled' : 'active'
    setCodeUpdatingId(item.id)
    try {
      const updated = await updateAdminMembershipCode(item.id, { status: nextStatus })
      patchMembershipCode(updated)
      showFlash(nextStatus === 'active' ? '兑换码已重新启用' : '兑换码已禁用', 'success')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '兑换码状态更新失败')
    } finally {
      setCodeUpdatingId(null)
    }
  }

  function renderSectionHeader(title, description) {
    return (
      <div className="adminx-section-header">
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </div>
    )
  }

  function renderOverviewSection() {
    return (
      <div className="adminx-surface adminx-overview">
        <section className="adminx-stat-grid">
          <StatCard icon={Users} label="总用户数" value={formatNumber(stats.total_users)} detail="平台累计注册用户" tone="blue" />
          <StatCard icon={CheckCircle2} label="启用用户" value={formatNumber(stats.active_users)} detail="当前可正常登录" tone="green" />
          <StatCard icon={Shield} label="管理员" value={formatNumber(stats.admin_users)} detail="具备后台权限" tone="gold" />
          <StatCard icon={Activity} label="文献总量" value={formatNumber(stats.total_papers)} detail="含回收站中的文献" tone="slate" />
        </section>

        <div className="adminx-overview-grid">
          <section className="adminx-card">
            {renderSectionHeader('近 30 天新增趋势', '图表展示近期注册与导入变化。')}
            <div className="adminx-chart-card">
              {registrationTrend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={registrationTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="adminxUsersFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="adminxPapersFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="registrations" name="新增注册" stroke="#2563eb" strokeWidth={2} fill="url(#adminxUsersFill)" isAnimationActive={false} />
                    <Area type="monotone" dataKey="imports" name="新增导入" stroke="#14b8a6" strokeWidth={2} fill="url(#adminxPapersFill)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="还没有趋势数据" description="等有更多注册和导入记录后，这里会自动显示。" />
              )}
            </div>
          </section>

          <section className="adminx-card">
            {renderSectionHeader('最近注册用户', '点击可直接切到用户模块并选中对应账号。')}
            <div className="adminx-list-card">
              {(overview?.recent_users || []).length ? (
                (overview?.recent_users || []).map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="adminx-list-row"
                    onClick={() => handleSelectUser(user.id, 'users')}
                  >
                    <div>
                      <strong>{getDisplayName(user)}</strong>
                      <span>{user.uid}</span>
                    </div>
                    <small>{formatDateTime(user.created_at)}</small>
                  </button>
                ))
              ) : (
                <EmptyState title="暂无最近用户" description="这里会展示最近注册的账号。" />
              )}
            </div>
          </section>
        </div>
      </div>
    )
  }

  function renderProfileTab() {
    if (!selectedUser) return <EmptyState title="还没有选中用户" description="先在列表里点一个用户。" />

    return (
      <div className="adminx-detail-stack">
        <div className="adminx-profile-head">
          <UserAvatar user={selectedUser} className="adminx-profile-head__avatar" />
          <div className="adminx-profile-head__copy">
            <strong>{getDisplayName(selectedUser)}</strong>
            <span>{selectedUser.uid}</span>
            <small>{getIdentityLine(selectedUser)}</small>
          </div>
        </div>

        <input ref={avatarInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarChange} />

        <div className="adminx-action-row">
          <button type="button" className="adminx-action-button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
            {avatarUploading ? '上传中' : '更新头像'}
          </button>
          <button type="button" className="adminx-ghost-button" onClick={resetProfileDraft} disabled={!isProfileDirty || profileSaving}>重置</button>
          <button type="button" className="adminx-primary-button" onClick={() => void saveProfileDraft()} disabled={!isProfileDirty || profileSaving}>
            <Save size={16} />
            <span>{profileSaving ? '保存中' : '保存资料'}</span>
          </button>
        </div>

        {[
          ['nickname', '昵称'],
          ['phone', '手机号'],
          ['email', '邮箱'],
          ['education', '学历'],
          ['occupation', '职业'],
          ['organization', '学校或单位'],
          ['discipline', '学科领域'],
        ].map(([key, label]) => (
          <label key={key} className="adminx-form-field">
            <span>{label}</span>
            <input value={profileDraft[key]} onChange={(event) => updateProfileField(key, event.target.value)} />
          </label>
        ))}
      </div>
    )
  }

  function renderActivityTab() {
    if (!selectedUser) return <EmptyState title="还没有选中用户" description="先在列表里点一个用户。" />

    return (
      <div className="adminx-detail-stack">
        <div className="adminx-metric-grid">
          <div className="adminx-metric-card">
            <span>累计导入</span>
            <strong>{formatNumber(selectedUser.import_count)}</strong>
            <small>最近导入：{formatDateTime(selectedUser.latest_imported_at)}</small>
          </div>
          <div className="adminx-metric-card">
            <span>阅读记录</span>
            <strong>{formatNumber(selectedUser.reading_record_count)}</strong>
            <small>最近阅读：{formatDateTime(selectedUser.latest_reading_at)}</small>
          </div>
          <div className="adminx-metric-card">
            <span>阅读时长</span>
            <strong>{formatDuration(selectedUser.reading_duration_seconds)}</strong>
            <small>最近登录：{formatDateTime(selectedUser.last_login_at)}</small>
          </div>
        </div>
      </div>
    )
  }

  function renderPermissionsTab() {
    if (!selectedUser) return <EmptyState title="还没有选中用户" description="先在列表里点一个用户。" />

    return (
      <div className="adminx-detail-stack">
        <div className="adminx-action-panel__row">
          <div>
            <strong>账号状态</strong>
            <span>{selectedUser.status === 'active' ? '当前可登录' : '当前已停用'}</span>
          </div>
          <button
            type="button"
            className={`adminx-action-button ${selectedUser.status === 'active' ? 'adminx-action-button--danger-lite' : 'adminx-action-button--confirm-lite'}`}
            onClick={() => void handlePermissionAction(
              { status: selectedUser.status === 'active' ? 'disabled' : 'active' },
              selectedUser.status === 'active' ? '账号已停用' : '账号已启用',
            )}
          >
            {selectedUser.status === 'active' ? '停用账号' : '启用账号'}
          </button>
        </div>

        <div className="adminx-action-panel__row">
          <div>
            <strong>学历认证</strong>
            <span>{selectedUser.education_verified ? '当前已认证' : '当前未认证'}</span>
          </div>
          <button
            type="button"
            className="adminx-action-button adminx-action-button--confirm-lite"
            onClick={() => void handlePermissionAction(
              { education_verified: !selectedUser.education_verified },
              selectedUser.education_verified ? '已取消学历认证' : '已通过学历认证',
            )}
          >
            {selectedUser.education_verified ? '取消认证' : '通过认证'}
          </button>
        </div>
      </div>
    )
  }

  function renderDetailBody() {
    if (detailLoading && !selectedUser) {
      return <EmptyState title="正在加载用户详情" description="请稍等一下。" />
    }
    if (detailTab === 'activity') return renderActivityTab()
    if (detailTab === 'permissions') return renderPermissionsTab()
    return renderProfileTab()
  }

  function renderUsersSection() {
    return (
      <div className="adminx-surface adminx-users">
        <section className="adminx-card adminx-card--toolbar">
          <div className="adminx-toolbar-head">
            <div className="adminx-toolbar-head__title">
              <strong>用户列表</strong>
            </div>
            <div className="adminx-toolbar-actions">
              <div className="adminx-search-field">
                <Search size={16} />
                <input
                  type="text"
                  value={searchInput}
                  placeholder="搜索昵称 / UID / 手机号"
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      applySearch()
                    }
                  }}
                />
              </div>
              <button type="button" className="adminx-toolbar-icon-button adminx-toolbar-icon-button--primary" onClick={applySearch} aria-label="搜索用户">
                <Search size={16} />
              </button>
            </div>
          </div>

          <div className="adminx-filter-row">
            <label className="adminx-select-field">
              <span>状态</span>
              <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
                <option value="">全部状态</option>
                <option value="active">启用中</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
            <label className="adminx-select-field">
              <span>身份</span>
              <select value={filters.is_admin} onChange={(event) => updateFilter('is_admin', event.target.value)}>
                <option value="">全部用户</option>
                <option value="true">仅管理员</option>
                <option value="false">仅普通用户</option>
              </select>
            </label>
            <label className="adminx-select-field">
              <span>学历认证</span>
              <select value={filters.education_verified} onChange={(event) => updateFilter('education_verified', event.target.value)}>
                <option value="">全部学历认证</option>
                <option value="true">已认证</option>
                <option value="false">未认证</option>
              </select>
            </label>
            <label className="adminx-select-field">
              <span>注册开始</span>
              <input type="date" value={filters.created_from} onChange={(event) => updateFilter('created_from', event.target.value)} />
            </label>
            <label className="adminx-select-field">
              <span>注册结束</span>
              <input type="date" value={filters.created_to} onChange={(event) => updateFilter('created_to', event.target.value)} />
            </label>
            <div className="adminx-filter-row__actions">
              <button type="button" className="adminx-toolbar-icon-button" onClick={clearAllFilters} aria-label="清空筛选">
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
        </section>

        <div className="adminx-users-layout">
          <section className="adminx-card adminx-card--table">
            <div className="adminx-table-wrap">
              <table className="adminx-user-table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>UID</th>
                    <th>手机号</th>
                    <th>身份</th>
                    <th>学历认证</th>
                    <th>导入</th>
                    <th>阅读</th>
                    <th>最近活跃</th>
                    <th>注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.items.length ? (
                    pageData.items.map((user) => (
                      <tr key={user.id} className={selectedUserId === user.id ? 'is-selected' : ''} onClick={() => handleSelectUser(user.id)}>
                        <td>
                          <div className="adminx-user-cell">
                            <UserAvatar user={user} className="adminx-user-cell__avatar" />
                            <div className="adminx-user-cell__copy">
                              <strong>{getDisplayName(user)}</strong>
                              <span>{getIdentityLine(user)}</span>
                            </div>
                          </div>
                        </td>
                        <td>{user.uid}</td>
                        <td>{user.phone || '--'}</td>
                        <td>{user.is_admin ? '管理员' : '普通用户'}</td>
                        <td>{user.education_verified ? '已认证' : '未认证'}</td>
                        <td>{formatNumber(user.import_count)}</td>
                        <td>{formatNumber(user.reading_record_count)}</td>
                        <td>{formatDateTime(user.latest_reading_at || user.last_login_at)}</td>
                        <td>{formatDateTime(user.created_at)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="9">
                        <EmptyState title="这一页没有用户" description="换个筛选条件试试，或者翻到别的分页。" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="adminx-pagination">
              <div className="adminx-pagination__summary">
                当前第 {pageData.page} / {pageData.total_pages} 页，共 {formatNumber(pageData.total)} 个用户
              </div>
              <div className="adminx-pagination__controls">
                <button type="button" className="adminx-page-arrow" disabled={pageData.page <= 1} onClick={() => setQuery((previous) => ({ ...previous, page: previous.page - 1 }))}>
                  <ChevronLeft size={16} />
                </button>
                <div className="adminx-page-list">
                  {buildPagination(pageData.page, pageData.total_pages).map((value) => (
                    typeof value === 'number' ? (
                      <button key={value} type="button" className={`adminx-page-button${value === pageData.page ? ' is-active' : ''}`} onClick={() => setQuery((previous) => ({ ...previous, page: value }))}>
                        {value}
                      </button>
                    ) : (
                      <span key={value} className="adminx-page-ellipsis">...</span>
                    )
                  ))}
                </div>
                <button type="button" className="adminx-page-arrow" disabled={pageData.page >= pageData.total_pages} onClick={() => setQuery((previous) => ({ ...previous, page: previous.page + 1 }))}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>

          <aside className="adminx-card adminx-card--detail">
            <div className="adminx-detail-tabs">
              {DETAIL_TABS.map((tab) => (
                <button key={tab.id} type="button" className={`adminx-detail-tab${detailTab === tab.id ? ' is-active' : ''}`} onClick={() => setDetailTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="adminx-detail-panel">{renderDetailBody()}</div>
          </aside>
        </div>
      </div>
    )
  }

  function renderCodesSection() {
    return (
      <div className="adminx-surface adminx-codes">
        <div className="adminx-codes-grid">
          <section className="adminx-card adminx-card--focused">
            {renderSectionHeader('批量生成兑换码', '支持批次前缀、备注和一次性批量发码，生成后可立即复制或导出。')}
            <div className="adminx-detail-stack">
              <div className="adminx-metric-grid adminx-metric-grid--codes">
                <div className="adminx-metric-card">
                  <span>可用</span>
                  <strong>{formatNumber(codeStatusSummary.active)}</strong>
                  <small>当前可直接发放</small>
                </div>
                <div className="adminx-metric-card">
                  <span>已兑换</span>
                  <strong>{formatNumber(codeStatusSummary.redeemed)}</strong>
                  <small>已被用户使用</small>
                </div>
                <div className="adminx-metric-card">
                  <span>异常状态</span>
                  <strong>{formatNumber((codeStatusSummary.disabled || 0) + (codeStatusSummary.expired || 0))}</strong>
                  <small>禁用或过期</small>
                </div>
              </div>

              <div className="adminx-form-grid">
                <label className="adminx-form-field">
                  <span>套餐</span>
                  <select value={codeDraft.plan_code} onChange={(event) => updateCodeDraftField('plan_code', event.target.value)}>
                    <option value="vip_monthly">VIP 月卡</option>
                  </select>
                </label>
                <label className="adminx-form-field">
                  <span>数量</span>
                  <input type="number" min="1" max="200" value={codeDraft.quantity} onChange={(event) => updateCodeDraftField('quantity', event.target.value)} />
                </label>
                <label className="adminx-form-field">
                  <span>有效天数</span>
                  <input type="number" min="1" max="3650" value={codeDraft.duration_days} onChange={(event) => updateCodeDraftField('duration_days', event.target.value)} />
                </label>
                <label className="adminx-form-field">
                  <span>批次前缀</span>
                  <input value={codeDraft.batch_label} placeholder="如 MAY20 / VIPA" onChange={(event) => updateCodeDraftField('batch_label', event.target.value.toUpperCase())} />
                </label>
              </div>

              <label className="adminx-form-field adminx-form-field--textarea">
                <span>备注</span>
                <textarea
                  value={codeDraft.note}
                  rows={4}
                  maxLength={500}
                  placeholder="例如：公众号 5 月活动、渠道 A、客服补发"
                  onChange={(event) => updateCodeDraftField('note', event.target.value)}
                />
              </label>

              <div className="adminx-action-row adminx-action-row--wrap">
                <button type="button" className="adminx-action-button" onClick={() => setCodeDraft(DEFAULT_CODE_DRAFT)} disabled={codeCreating}>
                  清空表单
                </button>
                <button type="button" className="adminx-primary-button" onClick={() => void submitCodeBatch()} disabled={codeCreating}>
                  {codeCreating ? '生成中' : `生成 ${normalizedCodeDraft.quantity} 条兑换码`}
                </button>
              </div>
            </div>
          </section>

          <section className="adminx-card adminx-card--detail adminx-card--codes-list">
            <div className="adminx-toolbar-head adminx-toolbar-head--codes-list">
              <div className="adminx-toolbar-head__title">
                <strong>兑换码列表</strong>
                <span>生成后新兑换码会显示在最上方。</span>
              </div>
              <div className="adminx-toolbar-actions">
                <div className="adminx-search-field">
                  <Search size={16} />
                  <input
                    type="text"
                    value={codeSearchInput}
                    placeholder="搜索兑换码 / 前缀 / 备注"
                    onChange={(event) => setCodeSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        applyCodeSearch()
                      }
                    }}
                  />
                </div>
                <button type="button" className="adminx-toolbar-icon-button adminx-toolbar-icon-button--primary" onClick={applyCodeSearch} aria-label="搜索兑换码">
                  <Search size={16} />
                </button>
              </div>
            </div>

            <div className="adminx-filter-row adminx-filter-row--codes">
              <label className="adminx-select-field">
                <span>状态</span>
                <select value={codeFilters.status} onChange={(event) => updateCodeFilter('status', event.target.value)}>
                  <option value="">全部状态</option>
                  <option value="active">可用</option>
                  <option value="disabled">已禁用</option>
                  <option value="expired">已过期</option>
                  <option value="redeemed">已兑换</option>
                </select>
              </label>
              <label className="adminx-select-field">
                <span>备注</span>
                <select value={codeFilters.note_state} onChange={(event) => updateCodeFilter('note_state', event.target.value)}>
                  <option value="">全部</option>
                  <option value="with">仅有备注</option>
                  <option value="without">仅无备注</option>
                </select>
              </label>
              <label className="adminx-select-field">
                <span>批次前缀</span>
                <input value={codeFilters.batch_label} placeholder="如 MAY20" onChange={(event) => updateCodeFilter('batch_label', event.target.value)} />
              </label>
              <div className="adminx-filter-row__actions">
                <button type="button" className="adminx-toolbar-icon-button" onClick={clearCodeFilters} aria-label="清空兑换码筛选">
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>

            <div className="adminx-action-row adminx-action-row--wrap adminx-code-list-actions">
              <button type="button" className="adminx-action-button" onClick={() => void handleCopyCodes(filteredMembershipCodes, true)} disabled={!filteredMembershipCodes.length}>
                <Copy size={16} />
                <span>复制筛选结果</span>
              </button>
              <button type="button" className="adminx-ghost-button" onClick={() => handleExportCodes(filteredMembershipCodes)} disabled={!filteredMembershipCodes.length}>
                <Download size={16} />
                <span>导出筛选结果</span>
              </button>
            </div>

            <div className="adminx-table-wrap adminx-code-list-wrap">
              <table className="adminx-user-table adminx-code-table">
                <thead>
                  <tr>
                    <th>兑换码</th>
                    <th>状态</th>
                    <th>套餐</th>
                    <th>时长</th>
                    <th>批次</th>
                    <th>备注</th>
                    <th>兑换用户</th>
                    <th>过期时间</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembershipCodes.length ? (
                    filteredMembershipCodes.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="adminx-code-cell">
                            <strong>{item.code}</strong>
                            <span>{item.code_prefix || '无前缀'}</span>
                          </div>
                        </td>
                        <td>
                          <StatusBadge tone={getCodeStatusTone(item.status)}>
                            {getCodeStatusLabel(item.status)}
                          </StatusBadge>
                        </td>
                        <td>{item.plan_code}</td>
                        <td>{item.duration_days} 天</td>
                        <td>{item.batch_label || '--'}</td>
                        <td>{item.notes || '--'}</td>
                        <td>{getRedeemedUserDisplay(item)}</td>
                        <td>{formatDateTime(item.expires_at)}</td>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>
                          <div className="adminx-inline-actions">
                            <button type="button" className="adminx-icon-button" onClick={() => void handleCopyCodes([item], true)} aria-label="复制兑换码">
                              <Copy size={15} />
                            </button>
                            {item.status === 'active' || item.status === 'disabled' ? (
                              <button
                                type="button"
                                className={item.status === 'active' ? 'adminx-danger-button' : 'adminx-action-button'}
                                onClick={() => void toggleMembershipCode(item)}
                                disabled={codeUpdatingId === item.id}
                              >
                                {codeUpdatingId === item.id ? '处理中' : item.status === 'active' ? '禁用' : '启用'}
                              </button>
                            ) : (
                              <span className="adminx-table-muted">不可变更</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="10">
                        <EmptyState title={codeLoading ? '正在加载兑换码' : '没有匹配结果'} description={codeLoading ? '请稍等，后台正在同步兑换码列表。' : '换个筛选条件试试，或者先生成一批新的兑换码。'} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    )
  }

  function renderFeedbackSection() {
    return (
      <div className="adminx-surface adminx-users">
        <section className="adminx-card adminx-card--toolbar">
          <div className="adminx-toolbar-head">
            <div className="adminx-toolbar-head__title">
              <strong>问题反馈箱</strong>
            </div>
            <div className="adminx-toolbar-actions">
              <div className="adminx-search-field">
                <Search size={16} />
                <input
                  type="text"
                  value={feedbackSearchInput}
                  placeholder="搜索标题 / 内容 / UID / 手机号"
                  onChange={(event) => setFeedbackSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      applyFeedbackSearch()
                    }
                  }}
                />
              </div>
              <button type="button" className="adminx-toolbar-icon-button adminx-toolbar-icon-button--primary" onClick={applyFeedbackSearch} aria-label="搜索反馈">
                <Search size={16} />
              </button>
            </div>
          </div>

          <div className="adminx-filter-row">
            <label className="adminx-select-field">
              <span>状态</span>
              <select value={feedbackQuery.status} onChange={(event) => updateFeedbackFilter('status', event.target.value)}>
                <option value="">全部状态</option>
                <option value="open">待处理</option>
                <option value="in_progress">处理中</option>
                <option value="resolved">已解决</option>
                <option value="closed">已关闭</option>
              </select>
            </label>
            <label className="adminx-select-field">
              <span>类型</span>
              <select value={feedbackQuery.category} onChange={(event) => updateFeedbackFilter('category', event.target.value)}>
                <option value="">全部类型</option>
                <option value="bug">Bug</option>
                <option value="feature">功能建议</option>
                <option value="question">使用问题</option>
                <option value="other">其他</option>
              </select>
            </label>
            <div className="adminx-filter-row__actions">
              <button type="button" className="adminx-toolbar-icon-button" onClick={clearFeedbackFilters} aria-label="清空反馈筛选">
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
        </section>

        <div className="adminx-users-layout">
          <section className="adminx-card adminx-card--table">
            <div className="adminx-table-wrap">
              <table className="adminx-user-table">
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>用户</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>联系方式</th>
                    <th>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {feedbackPageData.items.length ? (
                    feedbackPageData.items.map((item) => (
                      <tr key={item.id} className={selectedFeedbackId === item.id ? 'is-selected' : ''} onClick={() => setSelectedFeedbackId(item.id)}>
                        <td>{item.title}</td>
                        <td>{item.nickname || item.uid}</td>
                        <td>{item.category}</td>
                        <td>{getFeedbackStatusLabel(item.status)}</td>
                        <td>{item.contact || item.phone || '--'}</td>
                        <td>{formatDateTime(item.created_at)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6">
                        <EmptyState title="还没有反馈记录" description="等用户提交问题后，这里会自动出现。" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="adminx-pagination">
              <div className="adminx-pagination__summary">
                当前第 {feedbackPageData.page} / {feedbackPageData.total_pages} 页，共 {formatNumber(feedbackPageData.total)} 条反馈
              </div>
              <div className="adminx-pagination__controls">
                <button type="button" className="adminx-page-arrow" disabled={feedbackPageData.page <= 1} onClick={() => setFeedbackQuery((previous) => ({ ...previous, page: previous.page - 1 }))}>
                  <ChevronLeft size={16} />
                </button>
                <div className="adminx-page-list">
                  {buildPagination(feedbackPageData.page, feedbackPageData.total_pages).map((value) => (
                    typeof value === 'number' ? (
                      <button key={value} type="button" className={`adminx-page-button${value === feedbackPageData.page ? ' is-active' : ''}`} onClick={() => setFeedbackQuery((previous) => ({ ...previous, page: value }))}>
                        {value}
                      </button>
                    ) : (
                      <span key={value} className="adminx-page-ellipsis">...</span>
                    )
                  ))}
                </div>
                <button type="button" className="adminx-page-arrow" disabled={feedbackPageData.page >= feedbackPageData.total_pages} onClick={() => setFeedbackQuery((previous) => ({ ...previous, page: previous.page + 1 }))}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>

          <aside className="adminx-card adminx-card--detail">
            {selectedFeedback ? (
              <div className="adminx-detail-stack">
                <div className="adminx-feedback-head">
                  <strong>{selectedFeedback.title}</strong>
                  <span>{selectedFeedback.nickname || selectedFeedback.uid}</span>
                </div>
                <div className="adminx-feedback-meta">
                  <span>类型：{selectedFeedback.category}</span>
                  <span>状态：{getFeedbackStatusLabel(selectedFeedback.status)}</span>
                  <span>联系方式：{selectedFeedback.contact || selectedFeedback.phone || '--'}</span>
                </div>
                <div className="adminx-feedback-body">
                  <p>{selectedFeedback.content}</p>
                </div>
                {selectedFeedback.screenshot_url ? (
                  <a className="adminx-feedback-link" href={resolveAssetUrl(selectedFeedback.screenshot_url)} target="_blank" rel="noreferrer">
                    查看用户截图
                  </a>
                ) : null}
                <label className="adminx-form-field adminx-form-field--textarea">
                  <span>管理员备注</span>
                  <textarea
                    value={feedbackNoteDraft}
                    maxLength={2000}
                    rows={8}
                    placeholder="记录排查结论、处理进度或回访结果"
                    onChange={(event) => setFeedbackNoteDraft(event.target.value)}
                  />
                </label>
                <div className="adminx-action-row adminx-action-row--wrap">
                  <button type="button" className="adminx-action-button" disabled={feedbackSaving} onClick={() => void updateFeedbackStatus('in_progress')}>标记处理中</button>
                  <button type="button" className="adminx-action-button" disabled={feedbackSaving} onClick={() => void updateFeedbackStatus('resolved')}>标记已解决</button>
                  <button type="button" className="adminx-ghost-button" disabled={feedbackSaving} onClick={() => void updateFeedbackStatus('closed')}>关闭问题</button>
                  <button type="button" className="adminx-primary-button" disabled={feedbackSaving} onClick={() => void saveFeedbackNote()}>
                    {feedbackSaving ? '保存中' : '保存备注'}
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState title="还没有选中反馈" description="先在左侧列表里点开一条用户反馈。" />
            )}
          </aside>
        </div>
      </div>
    )
  }

  function renderBroadcastSection() {
    const previewTitle = String(broadcastDraft.title || '').trim() || '系统通知'
    const previewMessage = String(broadcastDraft.message || '').trim() || '通知正文会在这里预览，发送前可以先检查标题和换行。'
    const hasDraftContent = Boolean(String(broadcastDraft.title || '').trim() || String(broadcastDraft.message || '').trim())

    return (
      <div className="adminx-surface">
        <section className="adminx-card adminx-card--focused">
          {renderSectionHeader('全员通知', '管理员发出后，所有用户都能收到；每个用户都能单独删除或一键清空自己的通知。')}
          <div className="adminx-detail-stack">
            <label className="adminx-form-field">
              <span>通知标题</span>
              <input
                value={broadcastDraft.title}
                maxLength={160}
                placeholder="例如：系统维护通知"
                onChange={(event) => updateBroadcastField('title', event.target.value)}
              />
            </label>

            <label className="adminx-form-field adminx-form-field--textarea">
              <span>通知内容</span>
              <textarea
                value={broadcastDraft.message}
                maxLength={1000}
                rows={8}
                placeholder="输入要发送给所有用户的通知内容"
                onChange={(event) => updateBroadcastField('message', event.target.value)}
              />
            </label>

            <aside className="adminx-broadcast-preview" aria-label="通知预览">
              <span>发送预览</span>
              <strong>{previewTitle}</strong>
              <p>{previewMessage}</p>
              <small>用户会在通知中心和顶部提醒里看到这条消息。</small>
            </aside>

            <div className="adminx-action-row">
              <button
                type="button"
                className="adminx-action-button"
                onClick={() => {
                  if (!hasDraftContent || window.confirm('确定清空当前通知草稿吗？')) {
                    setBroadcastDraft(DEFAULT_BROADCAST_DRAFT)
                  }
                }}
                disabled={broadcastSending}
              >
                清空内容
              </button>
              <button type="button" className="adminx-primary-button" onClick={() => void submitBroadcastNotification()} disabled={broadcastSending}>
                {broadcastSending ? '发送中' : '发送给所有用户'}
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  function renderHealthSection() {
    const tasks = healthReport?.tasks || {}
    const totals = tasks.totals || {}
    const recovered = tasks.recovered || {}
    const recentFailures = Array.isArray(tasks.recent_failures) ? tasks.recent_failures : []
    const features = healthReport?.features || {}
    const databaseStatus = healthReport?.database || 'unknown'
    const statusRows = [
      ['full_translations', '全文翻译', tasks.full_translations || {}],
    ]
    const featureRows = [
      ['AI 生成', features.ai_enabled],
      ['OSS 文件存储', features.oss_available],
      ['文档解析', features.aliyun_docmind_available],
      ['机器翻译', features.tencent_mt_available],
      ['邮件服务', features.smtp_available],
    ]

    if (healthLoading && !healthReport) {
      return (
        <div className="adminx-surface">
          <section className="adminx-card adminx-card--focused">
            <EmptyState title="正在读取系统状态" description="正在检查数据库和后台任务状态。" />
          </section>
        </div>
      )
    }

    return (
      <div className="adminx-surface adminx-health">
        <section className="adminx-stat-grid">
          <StatCard
            icon={Activity}
            label="系统状态"
            value={getHealthStatusLabel(healthReport?.status)}
            detail={`数据库：${getHealthStatusLabel(databaseStatus)}`}
            tone={healthReport?.status === 'ok' ? 'green' : 'gold'}
          />
          <StatCard
            icon={RefreshCw}
            label="进行中"
            value={formatNumber(totals.active)}
            detail="排队和运行中的任务"
            tone="blue"
          />
          <StatCard
            icon={Bug}
            label="异常"
            value={formatNumber(totals.failed)}
            detail="失败、取消或中断任务"
            tone={Number(totals.failed || 0) ? 'gold' : 'green'}
          />
          <StatCard
            icon={CheckCircle2}
            label="已完成"
            value={formatNumber(totals.completed)}
            detail="摘要、矩阵和全文翻译"
            tone="slate"
          />
        </section>

        <div className="adminx-health-grid">
          <section className="adminx-card adminx-card--focused">
            {renderSectionHeader('任务队列', '长任务积压、失败与自动恢复结果。')}
            <div className="adminx-health-table">
              {statusRows.map(([key, label, counts]) => (
                <div className="adminx-health-row" key={key}>
                  <div>
                    <strong>{label}</strong>
                    <span>
                      排队 {formatNumber(getStatusCount(counts, 'queued'))}
                      {' / '}
                      运行 {formatNumber(getStatusCount(counts, 'running'))}
                      {' / '}
                    </span>
                  </div>
                  <StatusBadge tone={getStatusCount(counts, 'failed') + getStatusCount(counts, 'error') ? 'red' : 'green'}>
                    异常 {formatNumber(getStatusCount(counts, 'failed') + getStatusCount(counts, 'error') + getStatusCount(counts, 'cancelled'))}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </section>

          <section className="adminx-card adminx-card--focused">
            {renderSectionHeader('运行能力', '关键后端能力开关与服务依赖。')}
            <div className="adminx-health-table">
              <div className="adminx-health-row">
                <div>
                  <strong>数据库</strong>
                  <span>接口请求会先做一次轻量连通性检查</span>
                </div>
                <StatusBadge tone={getHealthStatusTone(databaseStatus)}>{getHealthStatusLabel(databaseStatus)}</StatusBadge>
              </div>
              {featureRows.map(([label, enabled]) => (
                <div className="adminx-health-row" key={label}>
                  <div>
                    <strong>{label}</strong>
                    <span>{enabled ? '当前可用' : '未配置或关闭'}</span>
                  </div>
                  <StatusBadge tone={getHealthStatusTone(Boolean(enabled))}>{formatFeatureEnabled(enabled)}</StatusBadge>
                </div>
              ))}
            </div>
          </section>

          <section className="adminx-card adminx-card--focused">
            {renderSectionHeader('自动恢复', '页面打开时会顺手整理卡住的任务。')}
            <div className="adminx-metric-grid">
              <div className="adminx-metric-card">
                <span>摘要中断整理</span>
                <strong>{formatNumber(recovered.summaries_interrupted)}</strong>
                <small>卡住的运行中摘要会转为可重试</small>
              </div>
              <div className="adminx-metric-card">
                <span>矩阵重排队</span>
                <strong>{formatNumber(recovered.matrix_requeued)}</strong>
                <small>卡住的矩阵任务会被归一化</small>
              </div>
              <div className="adminx-metric-card">
                <span>翻译中断整理</span>
                <strong>{formatNumber(recovered.translations_interrupted)}</strong>
                <small>长时间无进度会转为失败可重试</small>
              </div>
            </div>
          </section>

          <section className="adminx-card adminx-card--focused adminx-card--wide">
            {renderSectionHeader('最近失败任务', '用于快速判断是摘要、矩阵还是翻译链路出问题。')}
            {recentFailures.length ? (
              <div className="adminx-health-table adminx-health-failures">
                {recentFailures.map((item) => (
                  <div className="adminx-health-row adminx-health-row--failure" key={item.id}>
                    <div>
                      <strong>{item.title || '未命名任务'}</strong>
                      <span>{item.label || '后台任务'} · {item.subtitle || item.status || 'failed'} · {formatDateTime(item.updated_at)}</span>
                      <p>{item.error_message || '未记录错误原因。'}</p>
                    </div>
                    <StatusBadge tone="red">{item.status || 'failed'}</StatusBadge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="最近没有失败任务" description="当前后台任务队列看起来很干净。" />
            )}
          </section>
        </div>
      </div>
    )
  }

  function renderActiveSection() {
    if (activeSection === 'users') return renderUsersSection()
    if (activeSection === 'codes') return renderCodesSection()
    if (activeSection === 'feedback') return renderFeedbackSection()
    if (activeSection === 'broadcast') return renderBroadcastSection()
    if (activeSection === 'health') return renderHealthSection()
    return renderOverviewSection()
  }

  if (!currentUser?.is_admin) {
    return (
      <section className="adminx-shell">
        <EmptyState title="没有后台访问权限" description="请使用管理员账号登录后再访问这个页面。" />
      </section>
    )
  }

  const bootLoading = (overviewLoading || listLoading) && !overview && !pageData.items.length

  return (
    <section className="adminx-shell">
      <header className="adminx-topbar">
        <div className="adminx-topbar__brand">
          <div className="adminx-topbar__badge">XK</div>
          <div>
            <strong>Admin Console</strong>
            <span>{adminDisplayName} / 用户管理后台</span>
          </div>
        </div>

        <div className="adminx-topbar__actions">
          <button
            type="button"
            className={`adminx-header-button adminx-header-button--icon${refreshing ? ' is-spinning' : ''}`}
            onClick={() => void handleRefreshData()}
            aria-label="刷新数据"
            title="刷新数据"
          >
            <RefreshCw size={16} />
          </button>
          <button type="button" className="adminx-header-button" onClick={onBack}>
            <ArrowLeft size={16} />
            <span>返回</span>
          </button>
        </div>
      </header>

      {bootLoading ? (
        <div className="adminx-loading-state">
          <strong>正在加载管理员后台</strong>
          <span>会同步总览、用户列表和用户详情，请稍等一下。</span>
        </div>
      ) : (
        <div className="adminx-workbench">
          <aside className="adminx-sidebar">
            <div className="adminx-sidebar__header">
              <span>Modules</span>
              <strong>管理导航</strong>
              <small>左边切换模块，右边只展示当前模块内容。</small>
            </div>

            <nav className="adminx-sidebar__nav">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`adminx-nav-item${activeSection === item.id ? ' is-active' : ''}`}
                    onClick={() => setActiveSection(item.id)}
                  >
                    <span className="adminx-nav-item__icon">
                      <Icon size={18} />
                    </span>
                    <span className="adminx-nav-item__copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                )
              })}
            </nav>

            <div className="adminx-sidebar__current">
              <span>当前对象</span>
              <strong>{selectedDisplayName}</strong>
              <small>{selectedUser?.uid || '先到用户模块选择账号'}</small>
            </div>
          </aside>

          <main className="adminx-main">
            <div className="adminx-main__header">
              <div>
                <strong>{NAV_ITEMS.find((item) => item.id === activeSection)?.label || '总览'}</strong>
                <span>{NAV_ITEMS.find((item) => item.id === activeSection)?.description || '整体数据与最近动态'}</span>
              </div>
              {activeSection === 'users' && selectedUser ? (
                <div className="adminx-main__status">
                  <StatusBadge tone={selectedUser.status === 'active' ? 'green' : 'red'}>
                    {selectedUser.status === 'active' ? '账号启用中' : '账号已停用'}
                  </StatusBadge>
                  <StatusBadge tone={selectedUser.is_admin ? 'gold' : 'slate'}>
                    {selectedUser.is_admin ? '管理员' : '普通用户'}
                  </StatusBadge>
                </div>
              ) : activeSection === 'codes' ? (
                <div className="adminx-main__status">
                  <StatusBadge tone="green">可用 {formatNumber(codeStatusSummary.active)}</StatusBadge>
                  <StatusBadge tone="slate">已兑换 {formatNumber(codeStatusSummary.redeemed)}</StatusBadge>
                  <StatusBadge tone="gold">筛选结果 {formatNumber(filteredMembershipCodes.length)}</StatusBadge>
                </div>
              ) : activeSection === 'health' ? (
                <div className="adminx-main__status">
                  <StatusBadge tone={getHealthStatusTone(healthReport?.status)}>
                    {getHealthStatusLabel(healthReport?.status)}
                  </StatusBadge>
                  <StatusBadge tone={healthLoading ? 'gold' : 'slate'}>{healthLoading ? '检查中' : '已同步'}</StatusBadge>
                </div>
              ) : null}
            </div>

            <div className="adminx-main__body">
              <AdminToast flash={flash} onClose={() => setFlash(null)} />
              {renderActiveSection()}
            </div>
          </main>
        </div>
      )}
    </section>
  )
}
