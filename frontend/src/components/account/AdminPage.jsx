import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  LayoutDashboard,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  Undo2,
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
  fetchAdminOverview,
  fetchAdminUserDetail,
  fetchAdminUsers,
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

const NAV_ITEMS = [
  { id: 'overview', label: '总览', description: '整体数据与最近动态', icon: LayoutDashboard },
  { id: 'users', label: '用户', description: '搜索、编辑、查看行为', icon: Users },
  { id: 'broadcast', label: '通知', description: '向所有用户发送通知', icon: Bell },
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
  if (nickname && !/^[?\s]+$/.test(nickname)) return nickname
  const uid = String(user?.uid || '').trim()
  return uid ? `UID ${uid}` : fallback
}

function getUserInitials(user) {
  return getDisplayName(user, 'U').replace(/^UID\s+/i, '').slice(0, 2).toUpperCase()
}

function getIdentityLine(user) {
  const values = [user?.organization, user?.discipline]
    .map((item) => String(item || '').trim())
    .filter((item) => item && !/^[?\s]+$/.test(item))
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
    if (previous !== null && value - previous > 1) {
      pages.push(`ellipsis-${previous}-${value}`)
    }
    pages.push(value)
    previous = value
  })

  return pages
}

function normalizePagedUsers(payload) {
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    page: Number(payload?.page || 1),
    page_size: Number(payload?.page_size || PAGE_SIZE),
    total: Number(payload?.total || 0),
    total_pages: Number(payload?.total_pages || 1),
  }
}

function buildProfileDraft(user) {
  function normalizeField(value) {
    const text = String(value || '').trim()
    return /^[?\s]+$/.test(text) ? '' : text
  }

  return {
    nickname: normalizeField(user?.nickname),
    phone: normalizeField(user?.phone),
    email: normalizeField(user?.email),
    education: normalizeField(user?.education),
    occupation: normalizeField(user?.occupation),
    organization: normalizeField(user?.organization),
    discipline: normalizeField(user?.discipline),
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

function EmptyState({ title, description, action }) {
  return (
    <div className="adminx-empty-state">
      <strong>{title}</strong>
      <span>{description}</span>
      {action || null}
    </div>
  )
}

function StatusBadge({ tone = 'slate', children }) {
  return <span className={`adminx-badge adminx-badge--${tone}`}>{children}</span>
}

function MetaItem({ label, value, emphasis = false }) {
  return (
    <div className="adminx-meta-item">
      <span>{label}</span>
      <strong className={emphasis ? 'is-emphasis' : ''}>{value || '暂无'}</strong>
    </div>
  )
}

function UserAvatar({ user, className = '', large = false }) {
  const avatarSrc = resolveAssetUrl(user?.avatar_url)
  const classes = `${className} ${large ? 'is-large' : ''}`.trim()

  if (avatarSrc) {
    return (
      <div className={classes}>
        <img src={avatarSrc} alt={getDisplayName(user)} />
      </div>
    )
  }

  return <div className={classes}>{getUserInitials(user)}</div>
}

function AdminToast({ flash, onClose }) {
  if (!flash?.message) return null
  return (
    <div className={`adminx-floating-alert adminx-floating-alert--${flash.tone || 'error'}`}>
      <span>{flash.message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">知道了</button>
    </div>
  )
}

export function AdminPage({ currentUser, onBack }) {
  const [activeSection, setActiveSection] = useState('overview')
  const [detailTab, setDetailTab] = useState('profile')
  const [overview, setOverview] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState({ ...DEFAULT_FILTERS, page: 1, page_size: PAGE_SIZE })
  const [pageData, setPageData] = useState({
    items: [],
    page: 1,
    page_size: PAGE_SIZE,
    total: 0,
    total_pages: 1,
  })
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [profileDraft, setProfileDraft] = useState(DEFAULT_PROFILE_DRAFT)
  const [broadcastDraft, setBroadcastDraft] = useState(DEFAULT_BROADCAST_DRAFT)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [flash, setFlash] = useState(null)

  const usersRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const avatarInputRef = useRef(null)
  const flashTimerRef = useRef(null)

  const stats = overview?.stats || {}
  const adminDisplayName = getDisplayName(currentUser, '管理员')
  const selectedDisplayName = getDisplayName(selectedUser, '未选中用户')
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

  useEffect(() => () => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current)
    }
  }, [])

  function showFlash(message, tone = 'error') {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current)
    }
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
      if (!suppressErrors) {
        showFlash(error instanceof Error ? error.message : '总览数据加载失败')
      }
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

      const normalized = normalizePagedUsers(payload)
      setPageData(normalized)

      if (!selectedUserId && normalized.items[0]) {
        setSelectedUserId(normalized.items[0].id)
      } else if (normalized.items.length && !normalized.items.some((item) => item.id === selectedUserId)) {
        setSelectedUserId(normalized.items[0].id)
      }

      return normalized
    } catch (error) {
      if (!options.suppressErrors) {
        showFlash(error instanceof Error ? error.message : '用户列表加载失败')
      }
      return null
    } finally {
      if (!options.silent && requestId === usersRequestRef.current) {
        setListLoading(false)
      }
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
      if (!suppressErrors) {
        showFlash(error instanceof Error ? error.message : '用户详情加载失败')
      }
      return null
    } finally {
      if (!silent && requestId === detailRequestRef.current) {
        setDetailLoading(false)
      }
    }
  }

  async function handleRefreshData() {
    setRefreshing(true)
    try {
      await Promise.all([
        loadOverviewData({ silent: true, suppressErrors: true }),
        loadUsersPage(query, { silent: true, suppressErrors: true }),
        selectedUserId ? loadUserDetail(selectedUserId, { silent: true, suppressErrors: true }) : Promise.resolve(null),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadOverviewData()
  }, [])

  useEffect(() => {
    void loadUsersPage(query)
  }, [query])

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUser(null)
      return
    }

    const matchingUser = pageData.items.find((item) => item.id === selectedUserId)
    if (matchingUser) {
      setSelectedUser((previous) => {
        if (previous?.id !== matchingUser.id) return matchingUser
        return {
          ...previous,
          ...matchingUser,
          avatar_url: previous?.avatar_url || matchingUser.avatar_url || '',
        }
      })
    }

    void loadUserDetail(selectedUserId)
  }, [pageData.items, selectedUserId])

  useEffect(() => {
    setProfileDraft(buildProfileDraft(selectedUser))
  }, [selectedUser])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void handleRefreshData()
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [query, selectedUserId])

  function patchUserEverywhere(updatedUser) {
    setSelectedUser(updatedUser)
    setPageData((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === updatedUser.id ? { ...item, ...updatedUser } : item)),
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

  function openAvatarPicker() {
    avatarInputRef.current?.click()
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
    if (!title) {
      showFlash('通知标题不能为空')
      return
    }
    if (!message) {
      showFlash('通知内容不能为空')
      return
    }

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
            {renderSectionHeader('近 30 天新增趋势', '不会再被顶部提示挤压，图表区域固定展示。')}
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
            {renderSectionHeader('最近注册用户', '点一下就会切到用户模块并选中对应账号。')}
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
                <EmptyState title="暂无最近用户" description="这里会展示最近 7 天注册的账号。" />
              )}
            </div>
          </section>
        </div>
      </div>
    )
  }

  function renderProfileTab() {
    if (!selectedUser) {
      return <EmptyState title="还没有选中用户" description="先在左侧列表里点一个用户。" />
    }

    return (
      <div className="adminx-detail-stack">
        <div className="adminx-profile-toolbar">
          <div>
            <strong>用户资料</strong>
          </div>
          <div className="adminx-action-row">
            <button type="button" className="adminx-action-button" onClick={resetProfileDraft} disabled={!isProfileDirty || profileSaving}>
              <Undo2 size={14} strokeWidth={1.65} />
              <span>还原</span>
            </button>
            <button type="button" className="adminx-primary-button" onClick={() => void saveProfileDraft()} disabled={!isProfileDirty || profileSaving}>
              <Save size={14} strokeWidth={1.65} />
              <span>{profileSaving ? '保存中' : '保存资料'}</span>
            </button>
          </div>
        </div>

        <div className="adminx-profile-grid">
          <div className="adminx-avatar-editor">
            <strong>头像</strong>
            <UserAvatar user={selectedUser} className="adminx-avatar-editor__preview" large />
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="adminx-file-input"
              onChange={(event) => void handleAvatarChange(event)}
            />
            <button type="button" className="adminx-action-button" onClick={openAvatarPicker} disabled={avatarUploading}>
              <ImagePlus size={15} />
              <span>{avatarUploading ? '上传中' : '更换头像'}</span>
            </button>
          </div>

          <label className="adminx-form-field">
            <span>昵称</span>
            <input value={profileDraft.nickname} onChange={(event) => updateProfileField('nickname', event.target.value)} />
          </label>
          <label className="adminx-form-field">
            <span>手机号</span>
            <input value={profileDraft.phone} onChange={(event) => updateProfileField('phone', event.target.value)} />
          </label>
          <label className="adminx-form-field">
            <span>邮箱</span>
            <input value={profileDraft.email} onChange={(event) => updateProfileField('email', event.target.value)} />
          </label>
          <label className="adminx-form-field">
            <span>学历</span>
            <input value={profileDraft.education} onChange={(event) => updateProfileField('education', event.target.value)} />
          </label>
          <label className="adminx-form-field">
            <span>职业</span>
            <input value={profileDraft.occupation} onChange={(event) => updateProfileField('occupation', event.target.value)} />
          </label>
          <label className="adminx-form-field">
            <span>单位</span>
            <input value={profileDraft.organization} onChange={(event) => updateProfileField('organization', event.target.value)} />
          </label>
          <label className="adminx-form-field">
            <span>学科</span>
            <input value={profileDraft.discipline} onChange={(event) => updateProfileField('discipline', event.target.value)} />
          </label>
        </div>

        <div className="adminx-meta-grid">
          <MetaItem label="UID" value={selectedUser.uid} />
          <MetaItem label="注册时间" value={formatDateTime(selectedUser.created_at)} />
          <MetaItem label="最后登录" value={formatDateTime(selectedUser.last_login_at)} />
          <MetaItem label="当前身份" value={selectedUser.is_admin ? '管理员' : '普通用户'} />
        </div>
      </div>
    )
  }

  function renderActivityTab() {
    if (!selectedUser) {
      return <EmptyState title="还没有选中用户" description="先在左侧列表里点一个用户。" />
    }

    return (
      <div className="adminx-detail-stack">
        <div className="adminx-inline-stats">
          <MetaItem label="导入文献数" value={formatNumber(selectedUser.import_count)} emphasis />
          <MetaItem label="阅读记录数" value={formatNumber(selectedUser.reading_record_count)} emphasis />
          <MetaItem label="阅读时长" value={formatDuration(selectedUser.reading_duration_seconds)} emphasis />
        </div>
        <div className="adminx-meta-grid">
          <MetaItem label="最近导入" value={formatDateTime(selectedUser.latest_imported_at)} />
          <MetaItem label="最近阅读" value={formatDateTime(selectedUser.latest_reading_at)} />
          <MetaItem label="单位 / 学科" value={getIdentityLine(selectedUser)} />
          <MetaItem label="学历认证" value={selectedUser.education_verified ? '已认证' : '未认证'} />
        </div>
      </div>
    )
  }

  function renderPermissionsTab() {
    if (!selectedUser) {
      return <EmptyState title="还没有选中用户" description="先在左侧列表里点一个用户。" />
    }

    return (
      <div className="adminx-detail-stack">
        <div className="adminx-note">
          这里只保留真正有用的权限操作，不再放重复的上方大块信息。
        </div>
        <div className="adminx-action-panel">
          <div className="adminx-action-panel__row">
            <div>
              <strong>账号状态</strong>
              <span>{selectedUser.status === 'active' ? '当前可正常登录' : '当前已停用'}</span>
            </div>
            <button
              type="button"
              className={selectedUser.status === 'active' ? 'adminx-danger-button' : 'adminx-primary-button'}
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
              <strong>管理员权限</strong>
              <span>{selectedUser.is_admin ? '当前拥有后台权限' : '当前为普通用户'}</span>
            </div>
            <button
              type="button"
              className={selectedUser.is_admin ? 'adminx-action-button' : 'adminx-primary-button'}
              onClick={() => void handlePermissionAction(
                { is_admin: !selectedUser.is_admin },
                selectedUser.is_admin ? '已移除管理员权限' : '已授予管理员权限',
              )}
            >
              {selectedUser.is_admin ? '取消管理员' : '设为管理员'}
            </button>
          </div>

          <div className="adminx-action-panel__row">
            <div>
              <strong>学历认证</strong>
              <span>{selectedUser.education_verified ? '当前已认证' : '当前未认证'}</span>
            </div>
            <button
              type="button"
              className="adminx-action-button"
              onClick={() => void handlePermissionAction(
                { education_verified: !selectedUser.education_verified },
                selectedUser.education_verified ? '已取消学历认证' : '已通过学历认证',
              )}
            >
              {selectedUser.education_verified ? '取消认证' : '通过认证'}
            </button>
          </div>
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
                      <button
                        key={value}
                        type="button"
                        className={`adminx-page-button${value === pageData.page ? ' is-active' : ''}`}
                        onClick={() => setQuery((previous) => ({ ...previous, page: value }))}
                      >
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
                <button
                  key={tab.id}
                  type="button"
                  className={`adminx-detail-tab${detailTab === tab.id ? ' is-active' : ''}`}
                  onClick={() => setDetailTab(tab.id)}
                >
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

  function renderBroadcastSection() {
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

            <div className="adminx-action-row">
              <button type="button" className="adminx-action-button" onClick={() => setBroadcastDraft(DEFAULT_BROADCAST_DRAFT)} disabled={broadcastSending}>
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

  function renderActiveSection() {
    if (activeSection === 'users') return renderUsersSection()
    if (activeSection === 'broadcast') return renderBroadcastSection()
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
