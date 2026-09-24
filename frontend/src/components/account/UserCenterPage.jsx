import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bug,
  Building2,
  GraduationCap,
  Mail,
  Pencil,
  Plus,
  Phone,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import {
  formatUiFontSizeLabel,
  normalizeUiFontSize,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_STEP,
} from '../../services/uiPreferences'
import { createFeedbackTicket, fetchMyFeedbackTickets } from '../../services/feedbackApi'
import { resolveAssetUrl } from '../../utils/assetUrl'

const TEXT = {
  navProfile: '\u4e2a\u4eba\u4fe1\u606f',
  navFeedback: '\u95ee\u9898\u53cd\u9988',
  navSettings: '\u4e2a\u6027\u5316\u8bbe\u7f6e',
  pageTitle: '\u4e2a\u4eba\u4fe1\u606f',
  back: '\u8fd4\u56de',
  editProfile: '\u7f16\u8f91\u4e2a\u4eba\u4fe1\u606f',
  cancel: '\u53d6\u6d88',
  saveProfile: '\u4fdd\u5b58\u8d44\u6599',
  saving: '\u4fdd\u5b58\u4e2d...',
  uploadAvatar: '\u4e0a\u4f20\u5934\u50cf',
  uploadingAvatar: '\u4e0a\u4f20\u4e2d...',
  userAvatarAlt: '\u7528\u6237\u5934\u50cf',
  unnamedUser: '\u672a\u547d\u540d\u7528\u6237',
  profileSection: '\u4e2a\u4eba\u4fe1\u606f',
  feedbackSection: '\u95ee\u9898\u53cd\u9988',
  settingsSection: '\u4e2a\u6027\u5316\u8bbe\u7f6e',
  educationVerified: '\u6559\u80b2\u8ba4\u8bc1',
  verified: '\u5df2\u8ba4\u8bc1',
  unverified: '\u6682\u672a\u8ba4\u8bc1',
  emptyValue: '\u672a\u586b\u5199',
  membershipEyebrow: '\u4f1a\u5458\u4e0e\u989d\u5ea6',
  freePlan: '\u514d\u8d39\u7248',
  membershipOpen: '\u67e5\u770b\u5957\u9910/\u5151\u6362\u5f00\u901a',
  membershipOpenHint: '\u5f53\u524d\u4e3a\u514d\u8d39\u7248\uff0c\u53ef\u7ee7\u7eed\u4f7f\u7528\u57fa\u7840\u914d\u989d\u4e0e\u5e38\u7528\u529f\u80fd\u3002',
  membershipVipHint: '\u5df2\u89e3\u9501\u66f4\u9ad8\u914d\u989d\u4e0e\u5b8c\u6574\u4f1a\u5458\u80fd\u529b\u3002',
  currentStatus: '\u5f53\u524d\u72b6\u6001',
  startedAt: '\u5f00\u901a\u65f6\u95f4',
  expiresAt: '\u5230\u671f\u65f6\u95f4',
  statusActive: '\u5df2\u5f00\u901a',
  statusInactive: '\u514d\u8d39\u7248\u53ef\u7528',
  statusExpired: '\u5df2\u5230\u671f',
  statusCancelled: '\u5df2\u53d6\u6d88',
  quotaExplain: '\u5212\u8bcd\u89e3\u91ca',
  periodToday: '\u4eca\u65e5',
  periodMonth: '\u672c\u6708',
  remainingPrefix: '\u5269\u4f59',
  usedPrefix: '\u5df2\u7528',
  feedbackTitle: '\u63d0\u4ea4 Bug \u6216\u5efa\u8bae',
  feedbackDesc:
    '\u9002\u5408\u8bb0\u5f55\u9875\u9762\u62a5\u9519\u3001\u529f\u80fd\u5f02\u5e38\u3001\u4f53\u9a8c\u95ee\u9898\u548c\u6539\u8fdb\u5efa\u8bae\uff0c\u7ba1\u7406\u5458\u4f1a\u7edf\u4e00\u67e5\u770b\u548c\u5904\u7406\u3002',
  feedbackQuickTip: '\u5199\u6e05\u9875\u9762\u3001\u64cd\u4f5c\u548c\u5f02\u5e38\u73b0\u8c61\uff0c\u5904\u7406\u901f\u5ea6\u4f1a\u66f4\u5feb\u3002',
  feedbackAttachTip: '\u5982\u679c\u6709\u754c\u9762\u9519\u4f4d\u6216\u62a5\u9519\uff0c\u5efa\u8bae\u9644\u4e0a\u622a\u56fe\u3002',
  feedbackType: '\u53cd\u9988\u7c7b\u578b',
  feedbackBug: 'Bug',
  feedbackSuggestion: '\u5efa\u8bae',
  feedbackContent: '\u5185\u5bb9\u95ee\u9898',
  feedbackOther: '\u5176\u4ed6',
  feedbackSubject: '\u95ee\u9898\u6807\u9898',
  feedbackSubjectPlaceholder: '\u4e00\u53e5\u8bdd\u6982\u62ec\u95ee\u9898',
  feedbackBody: '\u8be6\u7ec6\u63cf\u8ff0',
  feedbackBodyPlaceholder:
    '\u8bf7\u5c3d\u91cf\u5199\u6e05\u695a\u89e6\u53d1\u6b65\u9aa4\u3001\u671f\u671b\u7ed3\u679c\u548c\u5b9e\u9645\u7ed3\u679c',
  feedbackContact: '\u8054\u7cfb\u65b9\u5f0f',
  feedbackContactPlaceholder: '\u65b9\u4fbf\u7ba1\u7406\u5458\u8054\u7cfb\u4f60',
  feedbackScreenshot: '\u622a\u56fe\u9644\u4ef6',
  feedbackScreenshotHint:
    '\u53ef\u9009\uff0c\u652f\u6301 JPG / PNG / WEBP\uff0c\u4fbf\u4e8e\u7ba1\u7406\u5458\u5feb\u901f\u5b9a\u4f4d\u3002',
  feedbackScreenshotSelected: '\u5df2\u9009\u62e9\uff1a',
  feedbackSubmit: '\u63d0\u4ea4\u53cd\u9988',
  feedbackSubmitting: '\u63d0\u4ea4\u4e2d...',
  feedbackHistoryTitle: '\u6211\u7684\u53cd\u9988\u8bb0\u5f55',
  feedbackHistoryDesc: '\u8fd9\u91cc\u4f1a\u5c55\u793a\u4f60\u63d0\u4ea4\u8fc7\u7684\u5de5\u5355\u548c\u5f53\u524d\u5904\u7406\u72b6\u6001\u3002',
  feedbackLoading: '\u6b63\u5728\u52a0\u8f7d\u53cd\u9988\u8bb0\u5f55...',
  feedbackEmpty: '\u8fd8\u6ca1\u6709\u53cd\u9988\u8bb0\u5f55\u3002',
  feedbackNeedTitle: '\u8bf7\u5148\u586b\u5199\u95ee\u9898\u6807\u9898\u3002',
  feedbackNeedBody: '\u95ee\u9898\u63cf\u8ff0\u81f3\u5c11\u5199 10 \u4e2a\u5b57\uff0c\u65b9\u4fbf\u7ba1\u7406\u5458\u5b9a\u4f4d\u3002',
  feedbackSubmitted: '\u53cd\u9988\u5df2\u63d0\u4ea4\uff0c\u7ba1\u7406\u5458\u767b\u5f55\u540e\u53f0\u540e\u5c31\u80fd\u770b\u5230\u3002',
  feedbackSubmitFailed: '\u53cd\u9988\u63d0\u4ea4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  feedbackLoadFailed: '\u53cd\u9988\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  feedbackStatusPending: '\u5f85\u5904\u7406',
  feedbackStatusProgress: '\u5904\u7406\u4e2d',
  feedbackStatusResolved: '\u5df2\u89e3\u51b3',
  feedbackStatusClosed: '\u5df2\u5173\u95ed',
  settingsFontTitle: '\u754c\u9762\u5b57\u53f7',
  settingsFontDesc: '\u8c03\u6574\u4e2a\u4eba\u4e2d\u5fc3\u4e0e\u9605\u8bfb\u754c\u9762\u7684\u57fa\u7840\u6587\u5b57\u5927\u5c0f\u3002',
  deleteAccountTitle: '注销账户',
  deleteAccountDesc: '注销后会永久删除账号、论文、批注、笔记、反馈记录和相关缓存文件，操作无法恢复。',
  deleteAccountButton: '永久注销',
  deletingAccount: '正在注销...',
  deleteAccountAdminHint: '管理员账户暂不支持自助注销，请联系系统维护者处理。',
  deleteAccountPrompt:
    '如确认注销，请在输入框中填写“注销账户”后继续。这个操作会永久删除你的全部数据。',
  deleteAccountPromptKeyword: '注销账户',
  deleteAccountPromptMismatch: '未完成确认输入，已取消注销。',
  deleteAccountFinalConfirm: '注销后所有账号数据都会被永久删除，确认继续吗？',
  deleteAccountFailed: '注销失败，请稍后再试。',
  fillProfileError: '\u8bf7\u5148\u628a\u53ef\u7f16\u8f91\u4fe1\u606f\u586b\u5199\u5b8c\u6574\u540e\u518d\u4fdd\u5b58\u3002',
  saveProfileFailed: '\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  uploadAvatarFailed: '\u5934\u50cf\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
}

const NAV_ITEMS = [
  { key: 'profile', label: TEXT.navProfile, icon: UserRound },
  { key: 'feedback', label: TEXT.navFeedback, icon: Bug },
  { key: 'settings', label: TEXT.navSettings, icon: Settings2 },
]

const PROFILE_FIELDS = [
  { key: 'nickname', label: '\u6635\u79f0', icon: UserRound, editable: true },
  { key: 'email', label: '\u90ae\u7bb1', icon: Mail, editable: false },
  { key: 'education', label: '\u5b66\u5386', icon: GraduationCap, editable: true },
  { key: 'occupation', label: '\u804c\u4e1a', icon: Sparkles, editable: true },
  { key: 'organization', label: '\u5b66\u6821\u6216\u5355\u4f4d', icon: Building2, editable: true },
  { key: 'discipline', label: '\u5b66\u79d1\u9886\u57df', icon: BarChart3, editable: true },
  { key: 'phone', label: '\u624b\u673a', icon: Phone, editable: false },
]

const MEMBERSHIP_STATUS_LABELS = {
  active: TEXT.statusActive,
  inactive: TEXT.statusInactive,
  expired: TEXT.statusExpired,
  cancelled: TEXT.statusCancelled,
}

const MEMBERSHIP_QUOTA_ORDER = [
  'selection_explain_daily',
]

const MEMBERSHIP_QUOTA_LABELS = {
  selection_explain_daily: { title: TEXT.quotaExplain, period: TEXT.periodToday },
}

function formatDateTime(value) {
  if (!value) return '\u6682\u65e0'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '\u6682\u65e0'
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function getFeedbackStatusLabel(value) {
  if (value === 'in_progress') return TEXT.feedbackStatusProgress
  if (value === 'resolved') return TEXT.feedbackStatusResolved
  if (value === 'closed') return TEXT.feedbackStatusClosed
  return TEXT.feedbackStatusPending
}

function buildMembershipUsageItems(usage = {}) {
  return MEMBERSHIP_QUOTA_ORDER.map((quotaKey) => {
    const item = usage?.[quotaKey] || {}
    const config = MEMBERSHIP_QUOTA_LABELS[quotaKey] || { title: quotaKey, period: '\u5f53\u524d' }
    const used = Number(item.used || 0)
    const limit = Number(item.limit || 0)
    const remaining = Math.max(0, limit - used)
    const progress = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
    return {
      quotaKey,
      title: config.title,
      period: config.period,
      used,
      limit,
      remaining,
      progress,
    }
  })
}

function ProfileRow({ editing, field, formValue, value, onChange }) {
  const Icon = field.icon

  return (
    <div className="account-row">
      <div className="account-row__label">
        <Icon />
        <span>{field.label}</span>
      </div>
      <div className="account-row__value">
        {editing && field.editable ? (
          <input
            className="account-input"
            type="text"
            value={formValue}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
        ) : (
          <span>{value || TEXT.emptyValue}</span>
        )}
      </div>
    </div>
  )
}

export function UserCenterPage({
  activeSection = 'profile',
  currentUser,
  onBack,
  onSaveProfile,
  onSectionChange,
  uiFontSize = 110,
  onUiFontSizeChange,
  onUploadAvatar,
  onOpenMembership,
  onDeleteAccount,
}) {
  const avatarSrc = resolveAssetUrl(currentUser?.avatar_url)
  const fileInputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [feedbackItems, setFeedbackItems] = useState([])
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [feedbackDraft, setFeedbackDraft] = useState({
    category: 'bug',
    title: '',
    content: '',
    contact: currentUser?.email || currentUser?.phone || '',
    screenshot: null,
  })
  const [form, setForm] = useState({
    nickname: currentUser?.nickname || '',
    education: currentUser?.education || '',
    occupation: currentUser?.occupation || '',
    organization: currentUser?.organization || '',
    discipline: currentUser?.discipline || '',
  })

  const initials = useMemo(
    () => (currentUser?.nickname || 'xk').slice(0, 2).toLowerCase(),
    [currentUser?.nickname],
  )
  const fontSizeValue = normalizeUiFontSize(uiFontSize)
  const membershipStatusLabel =
    MEMBERSHIP_STATUS_LABELS[currentUser?.membership?.status] || MEMBERSHIP_STATUS_LABELS.inactive
  const membershipUsageItems = useMemo(
    () => buildMembershipUsageItems(currentUser?.usage),
    [currentUser?.usage],
  )

  useEffect(() => {
    setForm({
      nickname: currentUser?.nickname || '',
      education: currentUser?.education || '',
      occupation: currentUser?.occupation || '',
      organization: currentUser?.organization || '',
      discipline: currentUser?.discipline || '',
    })
  }, [
    currentUser?.nickname,
    currentUser?.education,
    currentUser?.occupation,
    currentUser?.organization,
    currentUser?.discipline,
  ])

  useEffect(() => {
    setFeedbackDraft((previous) => ({
      ...previous,
      contact: previous.contact || currentUser?.email || currentUser?.phone || '',
    }))
  }, [currentUser?.email, currentUser?.phone])

  useEffect(() => {
    if (activeSection !== 'feedback') return

    let cancelled = false
    setFeedbackLoading(true)
    setFeedbackMessage('')

    fetchMyFeedbackTickets()
      .then((payload) => {
        if (!cancelled) {
          setFeedbackItems(Array.isArray(payload?.items) ? payload.items : [])
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setFeedbackMessage(loadError instanceof Error ? loadError.message : TEXT.feedbackLoadFailed)
        }
      })
      .finally(() => {
        if (!cancelled) setFeedbackLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeSection])

  function handleChange(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  function handleCancel() {
    setForm({
      nickname: currentUser?.nickname || '',
      education: currentUser?.education || '',
      occupation: currentUser?.occupation || '',
      organization: currentUser?.organization || '',
      discipline: currentUser?.discipline || '',
    })
    setEditing(false)
    setError('')
  }

  async function handleSave() {
    const payload = {
      nickname: form.nickname.trim(),
      education: form.education.trim(),
      occupation: form.occupation.trim(),
      organization: form.organization.trim(),
      discipline: form.discipline.trim(),
    }

    if (Object.values(payload).some((item) => !item)) {
      setError(TEXT.fillProfileError)
      return
    }

    setIsSaving(true)
    setError('')

    try {
      await onSaveProfile(payload)
      setEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : TEXT.saveProfileFailed)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setIsUploadingAvatar(true)

    try {
      await onUploadAvatar(file)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : TEXT.uploadAvatarFailed)
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  function updateFeedbackField(key, value) {
    setFeedbackDraft((previous) => ({ ...previous, [key]: value }))
  }

  async function handleSubmitFeedback() {
    const payload = {
      category: String(feedbackDraft.category || 'bug'),
      title: String(feedbackDraft.title || '').trim(),
      content: String(feedbackDraft.content || '').trim(),
      contact: String(feedbackDraft.contact || '').trim(),
      screenshot: feedbackDraft.screenshot || null,
    }

    if (!payload.title) {
      setFeedbackMessage(TEXT.feedbackNeedTitle)
      return
    }
    if (payload.content.length < 10) {
      setFeedbackMessage(TEXT.feedbackNeedBody)
      return
    }

    setFeedbackSubmitting(true)
    setFeedbackMessage('')

    try {
      const created = await createFeedbackTicket(payload)
      setFeedbackDraft((previous) => ({
        ...previous,
        title: '',
        content: '',
        screenshot: null,
      }))
      setFeedbackItems((previous) => [created, ...previous])
      setFeedbackMessage(TEXT.feedbackSubmitted)
    } catch (submitError) {
      setFeedbackMessage(submitError instanceof Error ? submitError.message : TEXT.feedbackSubmitFailed)
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  async function handleDeleteAccount() {
    if (isDeletingAccount || typeof onDeleteAccount !== 'function') return
    if (currentUser?.is_admin) {
      setSettingsMessage(TEXT.deleteAccountAdminHint)
      return
    }

    const keyword = window.prompt(TEXT.deleteAccountPrompt, '')
    if (keyword !== TEXT.deleteAccountPromptKeyword) {
      setSettingsMessage(TEXT.deleteAccountPromptMismatch)
      return
    }

    if (!window.confirm(TEXT.deleteAccountFinalConfirm)) {
      return
    }

    setIsDeletingAccount(true)
    setSettingsMessage('')

    try {
      await onDeleteAccount()
    } catch (deleteError) {
      setSettingsMessage(deleteError instanceof Error ? deleteError.message : TEXT.deleteAccountFailed)
      setIsDeletingAccount(false)
    }
  }

  function renderProfileSection() {
    return (
      <>
        <div className="account-panel__header">
          <h2>{TEXT.pageTitle}</h2>
          <div className="account-panel__actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="home-secondary-button"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  <X />
                  <span>{TEXT.cancel}</span>
                </button>
                <button
                  type="button"
                  className="home-primary-button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                >
                  <Save />
                  <span>{isSaving ? TEXT.saving : TEXT.saveProfile}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="home-secondary-button"
                onClick={() => setEditing(true)}
              >
                <Pencil />
                <span>{TEXT.editProfile}</span>
              </button>
            )}
          </div>
        </div>

        <div className="account-profile-card">
          <div className="account-profile-card__hero">
            <div className="account-avatar">
              {avatarSrc ? (
                <img src={avatarSrc} alt={currentUser?.nickname || TEXT.userAvatarAlt} />
              ) : (
                initials
              )}
            </div>

            <input
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp"
              className="hidden-input"
              type="file"
              onChange={handleAvatarChange}
            />

            <button
              type="button"
              className="home-secondary-button account-avatar-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
            >
              <Plus />
              <span>{isUploadingAvatar ? TEXT.uploadingAvatar : TEXT.uploadAvatar}</span>
            </button>
          </div>

          <div className={`account-membership-card account-membership-card--${currentUser?.membership?.is_vip ? 'gold' : 'muted'}`}>
            <div className="account-membership-card__hero">
              <div className="account-membership-card__hero-copy">
                <span className="account-membership-card__eyebrow">{TEXT.membershipEyebrow}</span>
                <div className="account-membership-card__title-row">
                  <strong>{currentUser?.membership?.plan_name || TEXT.freePlan}</strong>
                  <span className={`account-vip-badge account-vip-badge--${currentUser?.membership?.is_vip ? 'gold' : 'muted'}`}>
                    {membershipStatusLabel}
                  </span>
                </div>
                <p>{currentUser?.membership?.is_vip ? TEXT.membershipVipHint : TEXT.membershipOpenHint}</p>
              </div>
              <button
                type="button"
                className="home-secondary-button account-membership-card__cta"
                onClick={onOpenMembership}
              >
                {TEXT.membershipOpen}
              </button>
            </div>

            <div className="account-membership-card__meta">
              <div className="account-membership-card__meta-item">
                <span>{TEXT.currentStatus}</span>
                <strong>{membershipStatusLabel}</strong>
              </div>
              <div className="account-membership-card__meta-item">
                <span>{TEXT.startedAt}</span>
                <strong>{formatDateTime(currentUser?.membership?.started_at)}</strong>
              </div>
              <div className="account-membership-card__meta-item">
                <span>{TEXT.expiresAt}</span>
                <strong>{formatDateTime(currentUser?.membership?.expires_at)}</strong>
              </div>
            </div>

            <div className="account-membership-card__usage">
              {membershipUsageItems.map((item) => (
                <div key={item.quotaKey} className="account-membership-card__usage-item">
                  <div className="account-membership-card__usage-head">
                    <span>{item.title}</span>
                    <em>{`${item.period}${TEXT.remainingPrefix} ${item.remaining}`}</em>
                  </div>
                  <strong>{item.limit}</strong>
                  <small>{`${TEXT.usedPrefix} ${item.used} / ${item.limit}`}</small>
                  <div className="account-membership-card__usage-bar" aria-hidden="true">
                    <span style={{ width: `${item.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="account-rows">
            {PROFILE_FIELDS.map((field) => (
              <ProfileRow
                key={field.key}
                editing={editing}
                field={field}
                formValue={form[field.key] || ''}
                value={currentUser?.[field.key] || ''}
                onChange={handleChange}
              />
            ))}

            <div className="account-row">
              <div className="account-row__label">
                <Sparkles />
                <span>{TEXT.educationVerified}</span>
              </div>
              <div className="account-row__value">
                <span>{currentUser?.education_verified ? TEXT.verified : TEXT.unverified}</span>
              </div>
            </div>
          </div>

          {error ? <p className="account-error">{error}</p> : null}
        </div>
      </>
    )
  }

  function renderFeedbackSection() {
    return (
      <div className="account-feedback-page">
        <div className="account-panel__header account-feedback-page__header">
          <div>
            <h2>{TEXT.feedbackSection}</h2>
            <p>{TEXT.feedbackDesc}</p>
          </div>
        </div>

        <section className="account-feedback-compose">
          <div className="account-feedback-compose__intro">
            <div className="account-settings-row__icon">
              <Bug />
            </div>
            <div className="account-settings-row__copy">
              <strong>{TEXT.feedbackTitle}</strong>
              <span>{TEXT.feedbackQuickTip}</span>
              <span>{TEXT.feedbackAttachTip}</span>
            </div>
          </div>

          <div className="account-feedback-form">
            <label className="account-feedback-field">
              <span>{TEXT.feedbackType}</span>
              <select
                value={feedbackDraft.category}
                onChange={(event) => updateFeedbackField('category', event.target.value)}
              >
                <option value="bug">{TEXT.feedbackBug}</option>
                <option value="suggestion">{TEXT.feedbackSuggestion}</option>
                <option value="content">{TEXT.feedbackContent}</option>
                <option value="other">{TEXT.feedbackOther}</option>
              </select>
            </label>

            <label className="account-feedback-field">
              <span>{TEXT.feedbackSubject}</span>
              <input
                type="text"
                value={feedbackDraft.title}
                onChange={(event) => updateFeedbackField('title', event.target.value)}
                placeholder={TEXT.feedbackSubjectPlaceholder}
              />
            </label>

            <label className="account-feedback-field">
              <span>{TEXT.feedbackBody}</span>
              <textarea
                rows={5}
                value={feedbackDraft.content}
                onChange={(event) => updateFeedbackField('content', event.target.value)}
                placeholder={TEXT.feedbackBodyPlaceholder}
              />
            </label>

            <label className="account-feedback-field">
              <span>{TEXT.feedbackContact}</span>
              <input
                type="text"
                value={feedbackDraft.contact}
                onChange={(event) => updateFeedbackField('contact', event.target.value)}
                placeholder={TEXT.feedbackContactPlaceholder}
              />
            </label>

            <label className="account-feedback-field">
              <span>{TEXT.feedbackScreenshot}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => updateFeedbackField('screenshot', event.target.files?.[0] || null)}
              />
              <small>
                {feedbackDraft.screenshot
                  ? `${TEXT.feedbackScreenshotSelected}${feedbackDraft.screenshot.name}`
                  : TEXT.feedbackScreenshotHint}
              </small>
            </label>

            <div className="account-feedback-actions">
              <button
                type="button"
                className="home-primary-button"
                onClick={() => void handleSubmitFeedback()}
                disabled={feedbackSubmitting}
              >
                <Save />
                <span>{feedbackSubmitting ? TEXT.feedbackSubmitting : TEXT.feedbackSubmit}</span>
              </button>
            </div>

            {feedbackMessage ? <p className="account-feedback-message">{feedbackMessage}</p> : null}
          </div>
        </section>

        <section className="account-feedback-history">
          <div className="account-feedback-history__head">
            <div className="account-settings-row__icon">
              <Bug />
            </div>
            <div className="account-settings-row__copy">
              <strong>{TEXT.feedbackHistoryTitle}</strong>
              <span>{TEXT.feedbackHistoryDesc}</span>
            </div>
          </div>

          {feedbackLoading ? (
            <p className="account-feedback-empty">{TEXT.feedbackLoading}</p>
          ) : feedbackItems.length ? (
            <div className="account-feedback-list">
              {feedbackItems.map((item) => (
                <article key={item.id} className="account-feedback-item">
                  <div className="account-feedback-item__head">
                    <strong>{item.title}</strong>
                    <span>{getFeedbackStatusLabel(item.status)}</span>
                  </div>
                  <p>{item.content}</p>
                  <div className="account-feedback-item__meta">
                    <span>{item.category}</span>
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="account-feedback-empty">{TEXT.feedbackEmpty}</p>
          )}
        </section>
      </div>
    )
  }

  function renderSettingsSection() {
    return (
      <div className="account-settings-panel">
        <div className="account-panel__header">
          <h2>{TEXT.settingsSection}</h2>
        </div>

        <section className="account-settings-row">
          <div className="account-settings-row__main">
            <div className="account-settings-row__icon">
              <Settings2 />
            </div>
            <div className="account-settings-row__copy">
              <strong>{TEXT.settingsFontTitle}</strong>
              <span>{TEXT.settingsFontDesc}</span>
            </div>
          </div>
          <div className="account-settings-row__control">
            <input
              type="range"
              min={UI_FONT_SIZE_MIN}
              max={UI_FONT_SIZE_MAX}
              step={UI_FONT_SIZE_STEP}
              value={fontSizeValue}
              onChange={(event) => onUiFontSizeChange?.(Number(event.target.value))}
            />
            <span>{formatUiFontSizeLabel(fontSizeValue)}</span>
          </div>
        </section>

        <section className="account-settings-row account-settings-row--danger">
          <div className="account-settings-row__main">
            <div className="account-settings-row__icon account-settings-row__icon--danger">
              <Trash2 />
            </div>
            <div className="account-settings-row__copy">
              <strong>{TEXT.deleteAccountTitle}</strong>
              <span>{TEXT.deleteAccountDesc}</span>
            </div>
          </div>
          <div className="account-settings-row__control account-settings-row__control--danger">
            <button
              type="button"
              className="account-danger-button"
              onClick={() => void handleDeleteAccount()}
              disabled={isDeletingAccount || currentUser?.is_admin}
            >
              <Trash2 />
              <span>{isDeletingAccount ? TEXT.deletingAccount : TEXT.deleteAccountButton}</span>
            </button>
          </div>
        </section>

        {settingsMessage ? <p className="account-error">{settingsMessage}</p> : null}
      </div>
    )
  }

  return (
    <section className="account-shell">
      <div className="account-page-topbar">
        <button type="button" className="home-secondary-button" onClick={onBack}>
          <ArrowLeft />
          <span>{TEXT.back}</span>
        </button>
      </div>

      <div className="account-layout">
        <aside className="account-sidebar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.key
            return (
              <button
                key={item.key}
                type="button"
                className={`account-sidebar__item${isActive ? ' is-active' : ''}`}
                onClick={() => {
                  setEditing(false)
                  setError('')
                  onSectionChange?.(item.key)
                }}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            )
          })}
        </aside>

        <div className="account-content">
          {activeSection === 'profile' ? renderProfileSection() : null}
          {activeSection === 'feedback' ? renderFeedbackSection() : null}
          {activeSection === 'settings' ? renderSettingsSection() : null}
        </div>
      </div>
    </section>
  )
}
