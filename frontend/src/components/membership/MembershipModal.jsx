import { useEffect, useMemo, useState } from 'react'
import { Check, Crown, Gauge, LayoutTemplate, QrCode, Rocket, Sparkles, X, FileDown } from 'lucide-react'
import { redeemMembershipCode } from '../../services/membershipApi'

const TAB_ITEMS = [
  { key: 'vip', label: 'VIP 月卡' },
  { key: 'free', label: '免费权益' },
  { key: 'redeem', label: '兑换开通' },
]

const QUOTA_LABELS = {
  selection_explain_daily: '划词解释',
}

const VIP_FALLBACK_LIMITS = {
  selection_explain_daily: 300,
}

const FREE_COMPARE_ROWS = [
  { label: '划词解释', free: '每天 100 次', vip: '每天 300 次' },
  { label: '笔记/标注导出', free: '不可用', vip: 'Word、PDF、Markdown 可用' },
  { label: '笔记模板', free: '默认 5 个模板', vip: '全部系统模板' },
  { label: '任务处理', free: '普通队列', vip: '全文翻译优先处理' },
]

const REDEEM_STEPS = [
  '扫码关注公众号',
  '联系客服领取或购买兑换码',
  '回到站内输入兑换码开通 VIP',
]

const VIP_PRIVILEGES = [
  {
    title: '更高阅读额度',
    Icon: Gauge,
  },
  {
    title: '笔记与标注导出',
    description: '阅读笔记、重点摘录、标注清单可导出为 Word、PDF、Markdown，方便交作业或汇报。',
    Icon: FileDown,
  },
  {
    title: '全部笔记模板',
    description: '解锁全部系统模板。免费版保留默认 5 个常用模板，自建模板仍可继续使用。',
    Icon: LayoutTemplate,
  },
  {
    title: '任务优先处理',
    Icon: Rocket,
  },
]

function formatLimit(plan, quotaKey, fallback = 0) {
  const target = (plan?.quotas || []).find((item) => item.quota_key === quotaKey)
  return target?.limit ?? fallback
}

function BenefitRow({ text }) {
  return (
    <div className="membership-side-benefit">
      <span className="membership-side-benefit__icon">
        <Sparkles size={13} />
      </span>
      <span>{text}</span>
    </div>
  )
}

function CompareTable() {
  return (
    <div className="membership-compare-table">
      <div className="membership-compare-table__head">
        <span>功能</span>
        <span>免费版</span>
        <span>VIP</span>
      </div>
      {FREE_COMPARE_ROWS.map((item) => (
        <div key={item.label} className="membership-compare-table__row">
          <strong>{item.label}</strong>
          <span>{item.free}</span>
          <span>{item.vip}</span>
        </div>
      ))}
    </div>
  )
}

function PrivilegeCard({ item }) {
  const Icon = item.Icon
  return (
    <article className="membership-privilege-card">
      <span className="membership-privilege-card__icon">
        <Icon size={16} />
      </span>
      <div>
        <strong>{item.title}</strong>
        <p>{item.description}</p>
      </div>
    </article>
  )
}

export function MembershipModal({
  open,
  plans = [],
  currentUser,
  onClose,
  onRequireLogin,
  onRedeemed,
}) {
  const [activeTab, setActiveTab] = useState('vip')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [qrFailed, setQrFailed] = useState(false)

  useEffect(() => {
    if (!open) {
      setActiveTab('vip')
      setCode('')
      setSubmitting(false)
      setError('')
      setSuccess('')
      setQrFailed(false)
    }
  }, [open])

  const planMap = useMemo(() => {
    const nextMap = new Map()
    for (const plan of plans || []) {
      nextMap.set(plan.code, plan)
    }
    return nextMap
  }, [plans])

  const vipPlan = planMap.get('vip_monthly')
  const isVip = Boolean(currentUser?.membership?.is_vip)
  const vipQuotaItems = Object.entries(QUOTA_LABELS).map(([key, label]) => ({
    key,
    label,
    limit: formatLimit(vipPlan, key, VIP_FALLBACK_LIMITS[key]),
    period: key.includes('daily') ? '每天' : '每月',
  }))

  async function handleRedeem() {
    const normalizedCode = code.trim().toUpperCase()
    if (!normalizedCode) {
      setError('请输入兑换码')
      return
    }
    if (!currentUser) {
      onRequireLogin?.()
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const payload = await redeemMembershipCode(normalizedCode)
      setSuccess(payload?.message || '兑换成功')
      setCode('')
      onRedeemed?.(payload)
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : '兑换失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="membership-modal">
      <div className="membership-modal__backdrop" onClick={onClose} />
      <section className="membership-modal__panel">
        <button type="button" className="membership-modal__close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>

        <header className="membership-modal__hero">
          <div className="membership-modal__hero-copy">
            <div className={`membership-status-pill membership-status-pill--${isVip ? 'gold' : 'muted'}`}>
              <Crown size={14} />
              <span>{isVip ? '已开通 VIP' : '未开通会员'}</span>
            </div>
            <h2>VIP 解锁导出、模板、更高额度和优先队列</h2>
            <p>免费版可继续阅读、标注和使用基础额度；VIP 主要面向高频读论文、需要整理笔记和导出的用户。</p>
          </div>
          <div className="membership-modal__hero-mark" aria-hidden="true">
            <Check size={64} strokeWidth={1.5} />
          </div>
        </header>

        <div className="membership-modal__tabs">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`membership-modal__tab${activeTab === item.key ? ' is-active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="membership-modal__body">
          <aside className="membership-modal__side">
            <div className="membership-modal__side-header">
              <strong>VIP 特权</strong>
              <span>开通后立即生效</span>
            </div>
            <div className="membership-modal__side-list">
              {[
                '笔记/标注导出：Word、PDF、Markdown',
                '全部系统笔记模板',
                '每天 300 次划词解释',
              ].map((item) => (
                <BenefitRow key={item} text={item} />
              ))}
            </div>
          </aside>

          <main className="membership-modal__main">
            {activeTab === 'vip' ? (
              <>
                <div className="membership-main__head">
                  <div>
                    <strong>VIP 月卡</strong>
                    <span>一个主套餐，权益边界清楚，不绕弯。</span>
                  </div>
                </div>

                <div className="membership-plan-focus">
                  <span className="membership-plan-focus__tag">主推</span>
                  <div className="membership-plan-focus__title">
                    <strong>VIP 月卡</strong>
                    <span>适合高频阅读、笔记整理和汇报导出</span>
                  </div>
                  <div className="membership-plan-focus__price">
                    <small>¥</small>
                    <span>10</span>
                    <em>/ 月</em>
                  </div>
                  <div className="membership-plan-focus__desc">
                    <span>{`${vipQuotaItems[0].period} ${vipQuotaItems[0].limit} 次${vipQuotaItems[0].label} / ${vipQuotaItems[1].period} ${vipQuotaItems[1].limit} 次${vipQuotaItems[1].label}`}</span>
                  </div>
                </div>

                <div className="membership-main__tips">
                    <span>免费版保留基础阅读、标注、默认模板和基础额度；VIP 解锁导出、全部模板、更高额度与全文翻译优先处理。</span>
                </div>

                <div className="membership-privilege-grid">
                  {VIP_PRIVILEGES.map((item) => (
                    <PrivilegeCard key={item.title} item={item} />
                  ))}
                </div>

                <div className="membership-main__feature-grid">
                  {vipQuotaItems.map((item) => (
                    <div key={item.key} className="membership-main__feature-card">
                      <Check size={14} />
                      <span>{`${item.period} ${item.limit} 次${item.label}`}</span>
                    </div>
                  ))}
                  <div className="membership-main__feature-card">
                    <Check size={14} />
                    <span>笔记/标注导出：Word、PDF、Markdown</span>
                  </div>
                  <div className="membership-main__feature-card">
                    <Check size={14} />
                    <span>全部系统模板可用</span>
                  </div>
                </div>
              </>
            ) : null}

            {activeTab === 'free' ? (
              <>
                <div className="membership-main__head">
                  <div>
                    <strong>免费版与 VIP 对比</strong>
                    <span>免费版适合日常阅读；导出、全部模板和更高额度需要 VIP。</span>
                  </div>
                </div>
                <CompareTable />
                <div className="membership-free-note">
                  <strong>免费版仍可使用：</strong>
                  <span>上传/阅读论文、基础标注、默认笔记模板、基础划词解释、基础总结与矩阵额度。</span>
                </div>
              </>
            ) : null}

            {activeTab === 'redeem' ? (
              <>
                <div className="membership-main__head">
                  <div>
                    <strong>兑换开通</strong>
                    <span>关注公众号领取兑换码，回到站内输入即可开通。</span>
                  </div>
                </div>

                <div className="membership-redeem-box">
                  <div className="membership-redeem-box__qr">
                    <div className="membership-redeem-box__title">
                      <QrCode size={18} />
                      <strong>关注公众号领 VIP 码</strong>
                    </div>
                    {!qrFailed ? (
                      <img
                        src="/membership/wechat-official-account-qr.jpg"
                        alt="公众号二维码"
                        onError={() => setQrFailed(true)}
                      />
                    ) : (
                      <div className="membership-redeem-box__fallback">
                        <QrCode size={28} />
                        <span>二维码加载失败</span>
                      </div>
                    )}
                  </div>

                  <div className="membership-redeem-box__action">
                    <div className="membership-redeem-box__price">
                      <small>当前主套餐</small>
                      <strong>¥10 / 月</strong>
                    </div>
                    <div className="membership-redeem-box__steps">
                      {REDEEM_STEPS.map((step, index) => (
                        <div key={step} className="membership-redeem-box__step">
                          <span>{index + 1}</span>
                          <strong>{step}</strong>
                        </div>
                      ))}
                    </div>
                    <label className="membership-redeem-box__input">
                      <span>兑换码</span>
                      <div className="membership-redeem-box__input-row">
                        <input
                          value={code}
                          onChange={(event) => setCode(event.target.value.toUpperCase())}
                          placeholder="输入兑换码"
                        />
                        <button type="button" onClick={() => void handleRedeem()} disabled={submitting}>
                          {submitting ? '提交中...' : '立即兑换'}
                        </button>
                      </div>
                    </label>
                    {error ? <p className="membership-modal__error">{error}</p> : null}
                    {success ? <p className="membership-modal__success">{success}</p> : null}
                  </div>
                </div>
              </>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  )
}
