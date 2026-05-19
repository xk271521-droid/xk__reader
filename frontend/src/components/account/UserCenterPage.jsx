import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Building2,
  GraduationCap,
  Mail,
  Pencil,
  Plus,
  Phone,
  Save,
  Settings2,
  Sparkles,
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
import { resolveAssetUrl } from '../../utils/assetUrl'

const NAV_ITEMS = [
  { key: 'profile', label: '个人信息', icon: UserRound },
  { key: 'report', label: '阅读报告', icon: BarChart3 },
  { key: 'settings', label: '个性化设置', icon: Settings2 },
]

const PROFILE_FIELDS = [
  { key: 'nickname', label: '昵称', icon: UserRound, editable: true },
  { key: 'email', label: '邮箱', icon: Mail, editable: false },
  { key: 'education', label: '学历', icon: GraduationCap, editable: true },
  { key: 'occupation', label: '职业', icon: Sparkles, editable: true },
  { key: 'organization', label: '学校或单位', icon: Building2, editable: true },
  { key: 'discipline', label: '学科领域', icon: BarChart3, editable: true },
  { key: 'phone', label: '手机', icon: Phone, editable: false },
]

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
          <span>{value || '未填写'}</span>
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
}) {
  const avatarSrc = resolveAssetUrl(currentUser?.avatar_url)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const fileInputRef = useRef(null)
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

  function handleChange(key, value) {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }))
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
      setError('请先把可编辑信息填写完整后再保存。')
      return
    }

    setIsSaving(true)
    setError('')

    try {
      await onSaveProfile(payload)
      setEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请稍后再试。')
    } finally {
      setIsSaving(false)
    }
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

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setError('')
    setIsUploadingAvatar(true)

    try {
      await onUploadAvatar(file)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '头像上传失败，请稍后再试。')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  function handleFontSliderChange(event) {
    onUiFontSizeChange?.(Number(event.target.value))
  }

  return (
    <section className="account-shell">
      <div className="account-header">
        <h1>个人中心</h1>
        <button type="button" className="home-secondary-button" onClick={onBack}>
          <ArrowLeft />
          <span>返回</span>
        </button>
      </div>

      <div className="account-layout">
        <aside className="account-sidebar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                className={`account-sidebar__item${activeSection === item.key ? ' is-active' : ''}`}
                onClick={() => onSectionChange(item.key)}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            )
          })}
        </aside>

        <div className="account-panel">
          {activeSection === 'profile' ? (
            <>
              <div className="account-panel__header">
                <h2>个人信息</h2>
                {editing ? (
                  <div className="account-panel__actions">
                    <button
                      type="button"
                      className="home-secondary-button"
                      onClick={handleCancel}
                      disabled={isSaving}
                    >
                      <X />
                      <span>取消</span>
                    </button>
                    <button
                      type="button"
                      className="home-secondary-button account-save-button"
                      onClick={handleSave}
                      disabled={isSaving}
                    >
                      <Save />
                      <span>{isSaving ? '保存中...' : '保存信息'}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="home-secondary-button"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil />
                    <span>编辑个人信息</span>
                  </button>
                )}
              </div>

              <div className="account-profile-card">
                <div className="account-profile-card__hero">
                  <div className="account-avatar">
                    {avatarSrc ? (
                      <img src={avatarSrc} alt={currentUser.nickname || '用户头像'} />
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
                    <span>{isUploadingAvatar ? '上传中...' : '上传头像'}</span>
                  </button>

                  <div className="account-profile-card__identity">
                    <strong>{currentUser?.nickname || '未命名用户'}</strong>
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
                      <span>教育认证</span>
                    </div>
                    <div className="account-row__value">
                      <span>{currentUser?.education_verified ? '已认证' : '暂未认证'}</span>
                    </div>
                  </div>
                </div>

                {error ? <p className="account-error">{error}</p> : null}
              </div>
            </>
          ) : null}

          {activeSection === 'report' ? (
            <div className="account-placeholder-card">
              <BarChart3 />
              <div>
                <h2>阅读报告</h2>
                <p>这里后面会接你的阅读时长、阅读篇数、重点论文分布和阶段性阅读节奏。</p>
              </div>
            </div>
          ) : null}

          {activeSection === 'settings' ? (
            <div className="account-settings-panel">
              <div className="account-panel__header">
                <h2>个性化设置</h2>
              </div>

              <section className="account-settings-row">
                <div className="account-settings-row__main">
                  <div className="account-settings-row__icon">
                    <Settings2 />
                  </div>
                  <div className="account-settings-row__copy">
                    <strong>字体大小</strong>
                    <span>拖动后立即作用到全站界面文字和弹层。</span>
                  </div>
                </div>

                <div className="account-font-slider">
                  <span className="account-font-slider__value">{formatUiFontSizeLabel(fontSizeValue)}</span>
                  <input
                    type="range"
                    min={UI_FONT_SIZE_MIN}
                    max={UI_FONT_SIZE_MAX}
                    step={UI_FONT_SIZE_STEP}
                    value={fontSizeValue}
                    onInput={handleFontSliderChange}
                    onChange={handleFontSliderChange}
                    aria-label="字体大小"
                  />
                  <div className="account-font-slider__scale" aria-hidden="true">
                    <span>小</span>
                    <span>大</span>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
