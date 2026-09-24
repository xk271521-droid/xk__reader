import {
  Brain,
  ChevronRight,
  Copy,
  Crown,
  LogOut,
  Settings2,
  Shield,
  UserRound,
} from 'lucide-react'

const STATUS_LABELS = {
  active: '有效中',
  inactive: '未开通',
  expired: '已到期',
  cancelled: '已取消',
}

const PLAN_LIMIT_FALLBACKS = {
  free: {
    selection_explain_daily: 100,
  },
  vip_monthly: {
    selection_explain_daily: 300,
  },
}

const QUOTA_LABELS = {
  selection_explain_daily: '划词解释',
}

function getPlanLimit(membershipPlans, planCode, quotaKey) {
  const matchedPlan = (membershipPlans || []).find((item) => item.code === planCode)
  const matchedQuota = (matchedPlan?.quotas || []).find((item) => item.quota_key === quotaKey)
  if (matchedQuota?.limit != null) {
    return Number(matchedQuota.limit || 0)
  }
  return Number(PLAN_LIMIT_FALLBACKS[planCode]?.[quotaKey] || PLAN_LIMIT_FALLBACKS.free?.[quotaKey] || 0)
}

function normalizeQuota(item, fallbackLimit) {
  const limit = Number(item?.limit ?? fallbackLimit ?? 0)
  const used = Number(item?.used || 0)
  const remaining = item?.remaining != null ? Number(item.remaining || 0) : Math.max(0, limit - used)
  return {
    used,
    limit,
    remaining,
  }
}

function formatQuotaValue(item, fallbackLimit) {
  const quota = normalizeQuota(item, fallbackLimit)
  return `${quota.remaining} / ${quota.limit}`
}

function getQuotaPeriodLabel(quotaKey) {
  return quotaKey.includes('_monthly') ? '本月剩余' : '今日剩余'
}

function formatExpiryDate(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(parsed)
}

function QuickAction({ label, Icon, onClick, tone = 'default' }) {
  return (
    <button
      type="button"
      className={`user-menu__quick-action user-menu__quick-action--${tone}`}
      onClick={onClick}
    >
      <span className="user-menu__quick-icon">
        <Icon size={16} />
      </span>
      <span>{label}</span>
    </button>
  )
}

function DetailAction({ label, description, Icon, onClick, tone = 'default' }) {
  return (
    <button
      type="button"
      className={`user-menu__detail-action user-menu__detail-action--${tone}`}
      onClick={onClick}
    >
      <span className="user-menu__detail-icon">
        <Icon size={16} />
      </span>
      <span className="user-menu__detail-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <ChevronRight size={16} />
    </button>
  )
}

export function UserHoverMenu({
  currentUser,
  currentUserAvatarSrc,
  isAdminUser,
  isOpen,
  menuRef,
  onOpen,
  onCloseSoon,
  onToggle,
  onCopyUid,
  onOpenMembership,
  onOpenProfile,
  onOpenSettings,
  onOpenAiConfig,
  onOpenAdmin,
  onLogout,
  notificationSummary,
  membershipPlans = [],
}) {
  if (!currentUser) return null

  const userInitials = (currentUser.nickname || 'xk').slice(0, 2).toLowerCase()
  const unreadCount = Number(notificationSummary?.unread_count || 0)
  const planCode = currentUser?.membership?.plan_code || 'free'
  const explainQuota = currentUser?.usage?.selection_explain_daily
  const explainLimit = getPlanLimit(membershipPlans, planCode, 'selection_explain_daily')
  const quotaCards = [
    ['selection_explain_daily', explainQuota, explainLimit],
  ].map(([key, item, limit]) => {
    const quota = normalizeQuota(item, limit)
    return {
      key,
      title: QUOTA_LABELS[key] || key,
      periodLabel: getQuotaPeriodLabel(key),
      value: formatQuotaValue(item, limit),
      remaining: quota.remaining,
    }
  })
  const planName = currentUser?.membership?.plan_name || '免费版'
  const statusText = STATUS_LABELS[currentUser?.membership?.status] || '未开通'
  const expiryText = formatExpiryDate(currentUser?.membership?.expires_at)
  const featureHint = currentUser?.membership?.is_vip
    ? (expiryText ? `会员有效期至 ${expiryText}` : '已解锁更高额度与完整能力')
    : '解锁更高额度、完整模板与更多 AI 能力'

  return (
    <div
      ref={menuRef}
      className="topbar-user-wrap"
      onPointerEnter={onOpen}
      onPointerLeave={onCloseSoon}
    >
      <button
        type="button"
        className={`topbar-user${isOpen ? ' is-open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={onToggle}
        onFocus={onOpen}
      >
        <span className="topbar-user__avatar">
          {currentUserAvatarSrc ? (
            <img src={currentUserAvatarSrc} alt={currentUser.nickname} />
          ) : (
            userInitials
          )}
        </span>
        <span className="topbar-user__name">{currentUser.nickname}</span>
        <span className={`topbar-user__vip topbar-user__vip--${currentUser?.membership?.is_vip ? 'gold' : 'muted'}`}>
          VIP
        </span>
      </button>

      {isOpen ? (
        <div className="user-menu" role="menu">
          <div className="user-menu__header">
            <div className="user-menu__avatar">
              {currentUserAvatarSrc ? (
                <img src={currentUserAvatarSrc} alt={currentUser.nickname} />
              ) : (
                userInitials
              )}
            </div>
            <div className="user-menu__identity">
              <div className="user-menu__identity-top">
                <strong>{currentUser.nickname}</strong>
                <span className={`user-menu__plan user-menu__plan--${currentUser?.membership?.is_vip ? 'gold' : 'muted'}`}>
                  {planName}
                </span>
              </div>
              <div className="user-menu__uid-inline">
                <span>{`ID ${currentUser.uid}`}</span>
                <button type="button" onClick={onCopyUid} aria-label="复制用户 ID">
                  <Copy size={12} />
                </button>
              </div>
              <div className="user-menu__meta-row">
                <span>{statusText}</span>
                <span>{unreadCount > 0 ? `${unreadCount} 条新通知` : '通知已读完'}</span>
              </div>
            </div>
          </div>

          <button type="button" className="user-menu__feature-card" onClick={onOpenMembership}>
            <div className="user-menu__feature-copy">
              <span className="user-menu__feature-eyebrow">AI 会员特权</span>
              <strong>{currentUser?.membership?.is_vip ? '高级能力已解锁' : '更高额度与完整体验'}</strong>
              <small>{featureHint}</small>
            </div>
            <span className="user-menu__feature-cta">
              {currentUser?.membership?.is_vip ? '查看权益' : '立即开通'}
            </span>
          </button>

          <div className="user-menu__quick-grid">
            <QuickAction label="AI 功能" Icon={Brain} onClick={onOpenAiConfig} />
            <QuickAction label="个人中心" Icon={UserRound} onClick={onOpenProfile} />
            <QuickAction label="系统设置" Icon={Settings2} onClick={onOpenSettings} />
            <QuickAction label="会员权益" Icon={Crown} tone="gold" onClick={onOpenMembership} />
          </div>

          <div className="user-menu__stats-grid">
            {quotaCards.map((card) => (
              <div key={card.key} className="user-menu__stat-card">
                <span>{card.title}</span>
                <strong>{card.remaining}</strong>
                <small>{`${card.periodLabel} ${card.value}`}</small>
              </div>
            ))}
          </div>

          <div className="user-menu__actions">
            <DetailAction
              label="资料管理"
              description="编辑昵称、头像与基础账户信息"
              Icon={UserRound}
              onClick={onOpenProfile}
            />
            {isAdminUser ? (
              <DetailAction
                label="管理后台"
                description="用户、兑换码与系统运营入口"
                Icon={Shield}
                onClick={onOpenAdmin}
              />
            ) : null}
            <DetailAction
              label="退出登录"
              description="结束当前账号会话"
              Icon={LogOut}
              onClick={onLogout}
              tone="danger"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
