import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarRange,
  Crown,
  KeyRound,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import {
  fetchAdminOverview,
  fetchAdminUserDetail,
  fetchAdminUsers,
  updateAdminUser,
} from '../../services/adminApi'

const INITIAL_FILTERS = {
  q: '',
  status: '',
  is_admin: '',
  education_verified: '',
  created_from: '',
  created_to: '',
}

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
  })
}

function formatDuration(seconds) {
  const total = Number(seconds || 0)
  if (!total) return '0 分钟'
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  if (hours <= 0) return `${minutes} 分钟`
  return `${hours} 小时 ${minutes} 分钟`
}

function getPasswordStrengthHint(password) {
  const value = password.trim()
  if (!value) return ''
  const hasLetter = /[A-Za-z]/.test(value)
  const hasDigit = /\d/.test(value)
  if (value.length < 8) return '至少 8 位'
  if (!hasLetter || !hasDigit) return '需要同时包含字母和数字'
  return '密码强度通过'
}

function MetricStrip({ icon: Icon, label, value, tone = 'slate' }) {
  return (
    <div className={`admin-metric-strip admin-metric-strip--${tone}`}>
      <div className="admin-metric-strip__icon">
        <Icon />
      </div>
      <div className="admin-metric-strip__copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function LabeledMeta({ label, value, emphasis = false }) {
  return (
    <div className="admin-meta-item">
      <span>{label}</span>
      <strong className={emphasis ? 'is-emphasis' : ''}>{value || '暂无'}</strong>
    </div>
  )
}

function FilterPill({ active, children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`admin-filter-pill${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function AdminPage({ currentUser, onBack }) {
  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingAction, setSavingAction] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadOverviewAndUsers() {
      setLoading(true)
      setError('')
      setNotice('')
      try {
        const [overviewPayload, usersPayload] = await Promise.all([
          fetchAdminOverview(),
          fetchAdminUsers(INITIAL_FILTERS),
        ])
        if (cancelled) return
        const loadedUsers = usersPayload?.users || []
        setOverview(overviewPayload)
        setUsers(loadedUsers)
        const firstUserId = loadedUsers[0]?.id || null
        setSelectedUserId(firstUserId)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '后台数据加载失败。')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadOverviewAndUsers()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!selectedUserId) {
      setSelectedUser(null)
      return undefined
    }

    async function loadSelectedUser() {
      setDetailLoading(true)
      setError('')
      setNotice('')
      try {
        const payload = await fetchAdminUserDetail(selectedUserId)
        if (!cancelled) {
          setSelectedUser(payload?.user || null)
        }
      } catch (detailError) {
        if (!cancelled) {
          setError(detailError instanceof Error ? detailError.message : '用户详情加载失败。')
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    loadSelectedUser()
    return () => {
      cancelled = true
    }
  }, [selectedUserId])

  const stats = overview?.stats || {}
  const activeUserCount = useMemo(
    () => users.filter((item) => item.status === 'active').length,
    [users],
  )

  async function refreshUsers(nextFilters = filters) {
    setListLoading(true)
    setError('')
    setNotice('')
    try {
      const payload = await fetchAdminUsers(nextFilters)
      const nextUsers = payload?.users || []
      setUsers(nextUsers)
      if (!nextUsers.some((item) => item.id === selectedUserId)) {
        setSelectedUserId(nextUsers[0]?.id || null)
      }
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : '用户列表加载失败。')
    } finally {
      setListLoading(false)
    }
  }

  function updateFilter(key, value) {
    setFilters((previous) => ({
      ...previous,
      [key]: value,
    }))
  }

  async function applyAccountAction(payload, options = {}) {
    if (!selectedUserId) return
    if (options.confirmMessage && !window.confirm(options.confirmMessage)) return

    const previousSelectedUser = selectedUser
    setSavingAction(options.actionKey || 'saving')
    setError('')
    setNotice('')

    try {
      const updated = await updateAdminUser(selectedUserId, payload)
      setSelectedUser(updated)
      setUsers((previous) => previous.map((item) => (item.id === updated.id ? updated : item)))
      setOverview((previous) => {
        if (!previous) return previous
        const nextStats = { ...(previous.stats || {}) }
        if (previousSelectedUser && previousSelectedUser.status !== updated.status) {
          nextStats.active_users = Math.max(
            0,
            Number(nextStats.active_users || 0) + (updated.status === 'active' ? 1 : -1),
          )
        }
        if (previousSelectedUser && previousSelectedUser.is_admin !== updated.is_admin) {
          nextStats.admin_users = Math.max(
            0,
            Number(nextStats.admin_users || 0) + (updated.is_admin ? 1 : -1),
          )
        }
        return {
          ...previous,
          stats: nextStats,
          recent_users: (previous.recent_users || []).map((item) => (item.id === updated.id ? updated : item)),
        }
      })
      if (payload.temporary_password) {
        setTemporaryPassword('')
      }
      setNotice(options.successMessage || '账号状态已更新。')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '账号操作失败。')
    } finally {
      setSavingAction('')
    }
  }

  const passwordHint = getPasswordStrengthHint(temporaryPassword)
  const passwordReady = passwordHint === '密码强度通过'
  const isSelfAccount = selectedUser?.id === currentUser?.id

  if (!currentUser?.is_admin) {
    return (
      <section className="account-shell">
        <div className="admin-state-card admin-state-card--error">
          <strong>没有后台访问权限</strong>
          <span>请使用管理员账号登录后再访问这个页面。</span>
        </div>
      </section>
    )
  }

  return (
    <section className="admin-console-shell">
      <div className="admin-console-topbar">
        <div className="admin-console-topbar__brand">
          <div className="admin-console-topbar__badge">XK</div>
          <div>
            <strong>Account Admin Console</strong>
            <span>{currentUser?.nickname || '管理员账号'} · 账号管理工作台</span>
          </div>
        </div>

        <div className="admin-console-topbar__actions">
          <button type="button" className="home-secondary-button" onClick={onBack}>
            <ArrowLeft />
            <span>退出后台</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="admin-state-card">
          <strong>正在加载账号管理台</strong>
          <span>会同步管理员总览、账号列表和当前选中用户详情。</span>
        </div>
      ) : error && !users.length ? (
        <div className="admin-state-card admin-state-card--error">
          <strong>后台暂时不可用</strong>
          <span>{error}</span>
        </div>
      ) : (
        <div className="admin-workbench">
          <section className="admin-command-deck">
            <div className="admin-command-deck__hero">
              <span className="admin-eyebrow">Operations</span>
              <h1>围绕账号本身完成定位、判断和处置</h1>
              <p>这套后台聚焦用户账号信息、活跃表现和管理动作，让管理员不需要翻用户内容，也能完成日常运营与账号治理。</p>
            </div>

            <div className="admin-command-deck__metrics">
              <MetricStrip icon={Users} label="当前筛选用户" value={users.length} tone="slate" />
              <MetricStrip icon={ShieldCheck} label="启用中账号" value={activeUserCount} tone="green" />
              <MetricStrip icon={Crown} label="管理员账号" value={stats.admin_users || 0} tone="gold" />
              <MetricStrip icon={UserRound} label="系统总用户" value={stats.total_users || 0} tone="blue" />
            </div>
          </section>

          <section className="admin-stage">
            <aside className="admin-sidebar">
              <div className="admin-sidebar__section">
                <div className="admin-sidebar__section-head">
                  <strong>账号筛选</strong>
                  <span>先缩小范围，再进入用户详情。</span>
                </div>

                <div className="admin-search-box">
                  <Search />
                  <input
                    type="text"
                    value={filters.q}
                    placeholder="搜索手机号 / UID / 昵称"
                    onChange={(event) => updateFilter('q', event.target.value)}
                  />
                </div>

                <div className="admin-filter-grid">
                  <label>
                    <span>账号状态</span>
                    <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
                      <option value="">全部状态</option>
                      <option value="active">启用中</option>
                      <option value="disabled">已停用</option>
                    </select>
                  </label>

                  <label>
                    <span>管理员</span>
                    <select value={filters.is_admin} onChange={(event) => updateFilter('is_admin', event.target.value)}>
                      <option value="">全部账号</option>
                      <option value="true">仅管理员</option>
                      <option value="false">仅普通用户</option>
                    </select>
                  </label>

                  <label>
                    <span>认证状态</span>
                    <select
                      value={filters.education_verified}
                      onChange={(event) => updateFilter('education_verified', event.target.value)}
                    >
                      <option value="">全部认证</option>
                      <option value="true">已认证</option>
                      <option value="false">未认证</option>
                    </select>
                  </label>
                </div>

                <div className="admin-date-row">
                  <label>
                    <span>注册开始</span>
                    <div className="admin-date-field">
                      <CalendarRange />
                      <input
                        type="date"
                        value={filters.created_from}
                        onChange={(event) => updateFilter('created_from', event.target.value)}
                      />
                    </div>
                  </label>

                  <label>
                    <span>注册结束</span>
                    <div className="admin-date-field">
                      <CalendarRange />
                      <input
                        type="date"
                        value={filters.created_to}
                        onChange={(event) => updateFilter('created_to', event.target.value)}
                      />
                    </div>
                  </label>
                </div>

                <div className="admin-sidebar__actions">
                  <button type="button" className="admin-primary-button" onClick={() => refreshUsers()}>
                    刷新列表
                  </button>
                  <button
                    type="button"
                    className="admin-ghost-button"
                    onClick={() => {
                      setFilters(INITIAL_FILTERS)
                      refreshUsers(INITIAL_FILTERS)
                    }}
                  >
                    清空筛选
                  </button>
                </div>
              </div>

              <div className="admin-sidebar__section">
                <div className="admin-sidebar__section-head">
                  <strong>用户目录</strong>
                  <span>{listLoading ? '正在同步列表…' : `共 ${users.length} 个账号`}</span>
                </div>

                <div className="admin-user-rail">
                  {users.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`admin-user-rail__item${selectedUserId === item.id ? ' is-active' : ''}`}
                      onClick={() => setSelectedUserId(item.id)}
                    >
                      <div className="admin-user-rail__topline">
                        <strong>{item.nickname}</strong>
                        <span className={`admin-status-dot admin-status-dot--${item.status === 'active' ? 'green' : 'red'}`} />
                      </div>
                      <div className="admin-user-rail__meta">
                        <span>{item.uid}</span>
                        <span>{item.phone}</span>
                      </div>
                      <div className="admin-user-rail__chips">
                        <span className={`admin-chip admin-chip--${item.is_admin ? 'gold' : 'slate'}`}>
                          {item.is_admin ? '管理员' : '普通'}
                        </span>
                        <span className={`admin-chip admin-chip--${item.education_verified ? 'blue' : 'slate'}`}>
                          {item.education_verified ? '已认证' : '未认证'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <main className="admin-main-panel">
              {detailLoading ? (
                <div className="admin-state-card">
                  <strong>正在加载账号详情</strong>
                  <span>正在同步该用户的账号资料和行为数据。</span>
                </div>
              ) : selectedUser ? (
                <>
                  <section className="admin-profile-hero">
                    <div className="admin-profile-hero__identity">
                      <div className="admin-profile-hero__avatar">
                        {(selectedUser.nickname || 'U').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="admin-profile-hero__copy">
                        <span className="admin-eyebrow">Selected Account</span>
                        <h2>{selectedUser.nickname}</h2>
                        <p>{selectedUser.organization || '未填写单位'} · {selectedUser.discipline || '未填写学科'}</p>
                        <small>
                          {selectedUser.phone || '未绑定手机号'} · {selectedUser.email || '未填写邮箱'}
                        </small>
                      </div>
                    </div>

                    <div className="admin-profile-hero__chips">
                      <span className={`admin-chip admin-chip--${selectedUser.status === 'active' ? 'green' : 'red'}`}>
                        {selectedUser.status === 'active' ? '账号启用中' : '账号已停用'}
                      </span>
                      <span className={`admin-chip admin-chip--${selectedUser.is_admin ? 'gold' : 'slate'}`}>
                        {selectedUser.is_admin ? '管理员权限' : '普通账号'}
                      </span>
                      <span className={`admin-chip admin-chip--${selectedUser.education_verified ? 'blue' : 'slate'}`}>
                        {selectedUser.education_verified ? '认证已通过' : '认证未通过'}
                      </span>
                    </div>
                  </section>

                  {error ? (
                    <div className="admin-inline-alert">{error}</div>
                  ) : null}

                  {notice ? (
                    <div className="admin-inline-alert admin-inline-alert--success">{notice}</div>
                  ) : null}

                  <section className="admin-main-grid">
                    <div className="admin-panel-card admin-panel-card--profile">
                      <div className="admin-panel-card__header">
                        <div>
                          <strong>账号信息</strong>
                          <span>围绕身份资料、注册状态和联系方式进行判断。</span>
                        </div>
                      </div>

                      <div className="admin-meta-grid">
                        <LabeledMeta label="UID" value={selectedUser.uid} emphasis />
                        <LabeledMeta label="手机号" value={selectedUser.phone} />
                        <LabeledMeta label="邮箱" value={selectedUser.email} />
                        <LabeledMeta label="职业" value={selectedUser.occupation} />
                        <LabeledMeta label="单位" value={selectedUser.organization} />
                        <LabeledMeta label="学科" value={selectedUser.discipline} />
                        <LabeledMeta label="注册时间" value={formatDateTime(selectedUser.created_at)} />
                        <LabeledMeta label="最后登录" value={formatDateTime(selectedUser.last_login_at)} />
                      </div>
                    </div>

                    <div className="admin-panel-card admin-panel-card--behavior">
                      <div className="admin-panel-card__header">
                        <div>
                          <strong>行为数据</strong>
                          <span>把账号活跃度和导入表现放在一个视角里看。</span>
                        </div>
                      </div>

                      <div className="admin-behavior-band">
                        <MetricStrip icon={UserRound} label="导入文献数" value={selectedUser.import_count || 0} tone="blue" />
                        <MetricStrip icon={CalendarRange} label="阅读记录数" value={selectedUser.reading_record_count || 0} tone="slate" />
                        <MetricStrip icon={ShieldCheck} label="累计阅读时长" value={formatDuration(selectedUser.reading_duration_seconds)} tone="green" />
                        <MetricStrip icon={Crown} label="账号权限" value={selectedUser.is_admin ? '管理员' : '普通用户'} tone="gold" />
                      </div>

                      <div className="admin-meta-grid admin-meta-grid--compact">
                        <LabeledMeta label="最近导入时间" value={formatDateTime(selectedUser.latest_imported_at)} />
                        <LabeledMeta label="累计阅读时长" value={formatDuration(selectedUser.reading_duration_seconds)} />
                        <LabeledMeta label="最近阅读时间" value={formatDateTime(selectedUser.latest_reading_at)} />
                      </div>
                    </div>
                  </section>

                  <section className="admin-actions-grid">
                    <div className="admin-panel-card admin-panel-card--action">
                      <div className="admin-panel-card__header">
                        <div>
                          <strong>账号状态</strong>
                          <span>处理启停、权限和认证，适合日常运营处置。</span>
                        </div>
                      </div>

                      <div className="admin-action-cluster">
                        <FilterPill
                          active={selectedUser.status === 'active'}
                          disabled={savingAction === 'status' || isSelfAccount}
                          onClick={() =>
                            applyAccountAction(
                              { status: selectedUser.status === 'active' ? 'disabled' : 'active' },
                              {
                                actionKey: 'status',
                                confirmMessage: selectedUser.status === 'active' ? '确认停用该账号？' : '确认重新启用该账号？',
                                successMessage: selectedUser.status === 'active' ? '账号已停用，旧登录状态已立即失效。' : '账号已重新启用，需要重新登录后才能继续使用。',
                              },
                            )
                          }
                        >
                          {selectedUser.status === 'active' ? '停用账号' : '重新启用'}
                        </FilterPill>

                        <FilterPill
                          active={selectedUser.is_admin}
                          disabled={savingAction === 'admin' || isSelfAccount}
                          onClick={() =>
                            applyAccountAction(
                              { is_admin: !selectedUser.is_admin },
                              {
                                actionKey: 'admin',
                                confirmMessage: selectedUser.is_admin ? '确认移除该账号的管理员权限？' : '确认授予管理员权限？',
                                successMessage: selectedUser.is_admin ? '管理员权限已移除。' : '管理员权限已授予。',
                              },
                            )
                          }
                        >
                          {selectedUser.is_admin ? '移除管理员' : '设为管理员'}
                        </FilterPill>

                        <FilterPill
                          active={selectedUser.education_verified}
                          disabled={savingAction === 'verify'}
                          onClick={() =>
                            applyAccountAction(
                              { education_verified: !selectedUser.education_verified },
                              {
                                actionKey: 'verify',
                                successMessage: selectedUser.education_verified ? '认证状态已改为未通过。' : '认证状态已更新为通过。',
                              },
                            )
                          }
                        >
                          {selectedUser.education_verified ? '取消认证' : '通过认证'}
                        </FilterPill>
                      </div>

                      {isSelfAccount ? (
                        <div className="admin-action-note">
                          当前登录管理员不能停用自己的账号，也不能移除自己的管理员权限。
                        </div>
                      ) : null}
                    </div>

                    <div className="admin-panel-card admin-panel-card--security">
                      <div className="admin-panel-card__header">
                        <div>
                          <strong>安全处置</strong>
                          <span>适合做应急账号治理，所有动作都会立即生效。</span>
                        </div>
                      </div>

                      <div className="admin-password-box">
                        <label>
                          <span>设置临时密码</span>
                          <div className="admin-password-box__field">
                            <KeyRound />
                            <input
                              type="text"
                              value={temporaryPassword}
                              placeholder="至少 8 位，包含字母和数字中的两类"
                              onChange={(event) => setTemporaryPassword(event.target.value)}
                            />
                          </div>
                        </label>

                        {temporaryPassword ? (
                          <div className={`admin-password-hint${passwordReady ? ' is-valid' : ' is-invalid'}`}>
                            {passwordHint}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          className="admin-primary-button"
                          disabled={!passwordReady || savingAction === 'password'}
                          onClick={() =>
                            applyAccountAction(
                              { temporary_password: temporaryPassword },
                              {
                                actionKey: 'password',
                                confirmMessage: '确认给该用户设置临时密码？',
                                successMessage: '临时密码已设置，旧密码与旧登录状态均已失效。',
                              },
                            )
                          }
                        >
                          设置临时密码
                        </button>
                      </div>

                      <button
                        type="button"
                        className="admin-danger-button"
                        disabled={savingAction === 'force-logout'}
                        onClick={() =>
                          applyAccountAction(
                            { force_logout: true },
                            {
                              actionKey: 'force-logout',
                              confirmMessage: '确认强制该账号退出所有旧登录状态？',
                              successMessage: '该账号的所有旧 token 已立即失效。',
                            },
                          )
                        }
                      >
                        强制退出所有登录
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <div className="admin-state-card">
                  <strong>还没有选中账号</strong>
                  <span>从左侧用户目录选择一个账号后，这里会显示完整的账号信息和管理动作。</span>
                </div>
              )}
            </main>
          </section>
        </div>
      )}
    </section>
  )
}
