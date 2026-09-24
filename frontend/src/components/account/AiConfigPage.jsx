import './AiConfigPage.css'
import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Edit3,
  Power,
  PowerOff,
  Trash2,
  Plus,
  X,
  Languages,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import {
  fetchAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  testAiProvider,
  fetchTranslationConfig,
  updateTranslationConfig,
  deleteTranslationConfig,
  testBaiduTranslation,
} from '../../services/paperReaderApi'

const INITIAL_EDIT = { label: '', base_url: '', api_key: '', model: '' }

const PRESETS = [
  {
    name: 'DeepSeek 官方',
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    placeholder: 'sk-xxxxxxxx',
  },
  {
    name: '月之暗面 Kimi',
    label: 'Kimi',
    base_url: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    placeholder: 'sk-xxxxxxxx',
  },
  {
    name: '通义千问',
    label: '通义千问',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    placeholder: 'sk-xxxxxxxx',
  },
  {
    name: '硅基流动',
    label: 'SiliconFlow',
    base_url: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    placeholder: 'sk-xxxxxxxx',
  },
]

function isSiliconFlowProvider(provider) {
  return /siliconflow\.(cn|com)/i.test(String(provider?.base_url || ''))
}

export function AiConfigPage({ onBack }) {
  // ── AI 厂商状态 ──
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(INITIAL_EDIT)
  const [saving, setSaving] = useState(false)
  const [providerTesting, setProviderTesting] = useState(false)
  const [providerTestResult, setProviderTestResult] = useState(null)

  // ── 百度翻译配置状态 ──
  const [transConfig, setTransConfig] = useState({
    app_id: '',
    has_secret_key: false,
    is_configured: false,
  })
  const [transForm, setTransForm] = useState({ app_id: '', secret_key: '' })
  const [transLoading, setTransLoading] = useState(true)
  const [transSaving, setTransSaving] = useState(false)
  const [transTesting, setTransTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // { success: boolean, msg: string }

  useEffect(() => {
    loadProviders()
    loadTransConfig()
  }, [])

  async function loadProviders() {
    try {
      const data = await fetchAiProviders()
      setProviders(data.providers || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function loadTransConfig() {
    try {
      setTransLoading(true)
      const data = await fetchTranslationConfig()
      setTransConfig(data)
      setTransForm({ app_id: data.app_id || '', secret_key: '' })
    } catch { /* ignore */ }
    setTransLoading(false)
  }

  // ── 百度翻译处理函数 ──
  async function handleSaveTransConfig() {
    if (!transForm.app_id.trim()) {
      alert('请填写百度翻译 APP ID')
      return
    }
    if (!transConfig.has_secret_key && !transForm.secret_key.trim()) {
      alert('请填写百度翻译 密钥 (Secret Key)')
      return
    }
    setTransSaving(true)
    setTestResult(null)
    try {
      const payload = { app_id: transForm.app_id.trim() }
      if (transForm.secret_key.trim()) {
        payload.secret_key = transForm.secret_key.trim()
      }
      const res = await updateTranslationConfig(payload)
      setTransConfig(res)
      setTransForm((prev) => ({ ...prev, secret_key: '' }))
      alert('百度翻译配置保存成功！')
    } catch (err) {
      alert(err.message || '保存百度翻译配置失败')
    } finally {
      setTransSaving(false)
    }
  }

  async function handleDeleteTransConfig() {
    if (!window.confirm('确定要清除你保存的百度翻译配置吗？清除后划词将提示未配置。')) return
    setTransSaving(true)
    setTestResult(null)
    try {
      const res = await deleteTranslationConfig()
      setTransConfig(res)
      setTransForm({ app_id: '', secret_key: '' })
      alert('百度翻译配置已清除')
    } catch (err) {
      alert(err.message || '清除配置失败')
    } finally {
      setTransSaving(false)
    }
  }

  async function handleTestTransConfig() {
    setTransTesting(true)
    setTestResult(null)
    try {
      const payload = {}
      if (transForm.app_id.trim()) payload.app_id = transForm.app_id.trim()
      if (transForm.secret_key.trim()) payload.secret_key = transForm.secret_key.trim()

      const res = await testBaiduTranslation(payload)
      if (res.success) {
        setTestResult({
          success: true,
          msg: `连通测试成功！翻译结果：“${res.result}”`,
        })
      } else {
        setTestResult({
          success: false,
          msg: res.error_message || '测试失败，请检查 APP ID 与密钥',
        })
      }
    } catch (err) {
      setTestResult({
        success: false,
        msg: err.message || '网络或接口异常',
      })
    } finally {
      setTransTesting(false)
    }
  }

  // ── AI 厂商处理函数 ──
  function openNew() {
    setForm({ ...INITIAL_EDIT })
    setProviderTestResult(null)
    setEditing('new')
  }

  function applyPreset(preset) {
    setForm((f) => ({
      ...f,
      label: preset.label,
      base_url: preset.base_url,
      model: preset.model,
    }))
  }

  function openEdit(provider) {
    setForm({
      label: provider.label,
      base_url: provider.base_url,
      api_key: '',
      model: provider.model,
    })
    setProviderTestResult(null)
    setEditing(provider.id)
  }

  function closeEdit() {
    setProviderTestResult(null)
    setEditing(null)
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function save() {
    if (!form.label.trim() || !form.base_url.trim() || !form.model.trim()) {
      alert('请填写完整的厂商名称、Base URL 与模型名称')
      return
    }
    if (editing === 'new' && !form.api_key.trim()) {
      alert('请填写 API Key')
      return
    }
    setSaving(true)
    try {
      if (editing === 'new') {
        await createAiProvider(form)
      } else {
        const data = { label: form.label, base_url: form.base_url, model: form.model }
        if (form.api_key) data.api_key = form.api_key
        await updateAiProvider(editing, data)
      }
      setEditing(null)
      await loadProviders()
    } catch (err) {
      alert(err.message || '保存失败')
    }
    setSaving(false)
  }

  async function handleTestProvider() {
    if (!form.base_url.trim() || !form.model.trim() || (editing === 'new' && !form.api_key.trim())) {
      setProviderTestResult({
        success: false,
        message: '请先填写 Base URL、模型名称和 API Key。',
      })
      return
    }
    setProviderTesting(true)
    setProviderTestResult(null)
    try {
      const result = await testAiProvider({
        provider_id: editing === 'new' ? undefined : editing,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim() || undefined,
        model: form.model.trim(),
      })
      setProviderTestResult(result)
    } catch (error) {
      setProviderTestResult({
        success: false,
        message: error.message || '连接测试失败，请检查后端连接。',
      })
    } finally {
      setProviderTesting(false)
    }
  }

  async function toggleActive(provider) {
    try {
      const newActive = !provider.is_active
      if (newActive) {
        const others = providers.filter((p) => p.id !== provider.id && p.is_active)
        await Promise.all(others.map((p) => updateAiProvider(p.id, { is_active: false })))
      }
      await updateAiProvider(provider.id, { is_active: newActive })
      await loadProviders()
    } catch {
      alert('切换失败，请检查后端连接')
    }
  }

  async function remove(provider) {
    if (!window.confirm(`确定删除自定义厂商 "${provider.label}"？`)) return
    try {
      await deleteAiProvider(provider.id)
      await loadProviders()
    } catch (err) {
      alert(err.message || '删除失败')
    }
  }

  return (
    <div className="ai-config-page">
      <div className="ai-config-header">
        <button type="button" className="ai-config-back" onClick={onBack}>
          <ArrowLeft /> 返回
        </button>
        <div>
          <h2>模型与翻译配置</h2>
          <p className="muted">配置属于你自己的专属 API Key，数据均加密存储在你的个人账户下</p>
        </div>
      </div>

      {/* ── 模块 1：划词即时翻译（百度翻译 API） ── */}
      <section className="config-section">
        <div className="config-section__header">
          <div className="config-section__title-row">
            <Languages className="config-section__icon" />
            <div>
              <h3>划词翻译配置（百度翻译 API）</h3>
              <p className="muted">划词即时翻译服务。填写你自己的百度开放平台凭据，独享个人免费翻译额度。</p>
            </div>
          </div>
          {transConfig.is_configured ? (
            <span className="ai-badge ai-badge--success" title="已成功配置个人密钥">
              <ShieldCheck style={{ width: 14, height: 14, display: 'inline', marginRight: 4 }} />
              已配置专属 Key
            </span>
          ) : (
            <span className="ai-badge ai-badge--warning" title="未配置">未配置</span>
          )}
        </div>

        <div className="trans-config-card">
          <div className="trans-form-grid">
            <label className="trans-form-label">
              <span>APP ID</span>
              <input
                type="text"
                className="trans-input"
                placeholder="例如：20260501002605247"
                value={transForm.app_id}
                onChange={(e) => setTransForm((prev) => ({ ...prev, app_id: e.target.value }))}
              />
            </label>

            <label className="trans-form-label">
              <span>密钥 (Secret Key)</span>
              <input
                type="password"
                className="trans-input"
                placeholder={transConfig.has_secret_key ? '已加密保存（留空保持不变）' : '百度翻译开放平台的密钥'}
                value={transForm.secret_key}
                onChange={(e) => setTransForm((prev) => ({ ...prev, secret_key: e.target.value }))}
              />
            </label>
          </div>

          {testResult ? (
            <div className={`trans-test-box ${testResult.success ? 'is-success' : 'is-error'}`}>
              {testResult.success ? <Check className="test-icon" /> : <AlertCircle className="test-icon" />}
              <span>{testResult.msg}</span>
            </div>
          ) : null}

          <div className="trans-actions-row">
            <div className="trans-actions-left">
              <button
                type="button"
                className="btn-trans-save"
                onClick={handleSaveTransConfig}
                disabled={transSaving || transLoading}
              >
                {transSaving ? '保存中...' : '保存配置'}
              </button>
              <button
                type="button"
                className="btn-trans-test"
                onClick={handleTestTransConfig}
                disabled={transTesting || transLoading}
              >
                <RefreshCw className={transTesting ? 'is-spinning' : ''} />
                {transTesting ? '测试中...' : '测试连通性'}
              </button>
              {transConfig.is_configured ? (
                <button
                  type="button"
                  className="btn-trans-delete"
                  onClick={handleDeleteTransConfig}
                  disabled={transSaving}
                  title="清空配置"
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                  清除配置
                </button>
              ) : null}
            </div>

            <a
              href="https://fanyi-api.baidu.com/"
              target="_blank"
              rel="noreferrer"
              className="trans-guide-link"
            >
              <span>如何获取百度翻译 API Key？</span>
              <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          </div>
        </div>
      </section>

      {/* ── 模块 2：AI 对话与精读大模型 ── */}
      <section className="config-section" style={{ marginTop: 32 }}>
        <div className="config-section__header">
          <div className="config-section__title-row">
            <Sparkles className="config-section__icon" />
            <div>
              <h3>AI 对话与精读大模型</h3>
              <p className="muted">
                用于边读边问、全文精读与智能总结。系统自带官方免费模型，若需更强推理体验可添加你自己的 DeepSeek 等模型。
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="muted">加载中...</p>
        ) : (
          <div className="ai-config-list">
            {providers.map((p) => {
              const translationOnly = isSiliconFlowProvider(p)
              return (
                <div
                  key={p.id}
                  className={`ai-provider-card${p.is_active || translationOnly ? '' : ' is-inactive'}${p.is_system ? ' is-system' : ''}`}
                >
                  <div className="ai-provider-main">
                    <div className="ai-provider-info">
                      <strong>
                        {p.label}
                        {p.is_system ? <span className="ai-badge">官方内置 · 免费</span> : null}
                        {translationOnly ? <span className="ai-badge">全文翻译专用</span> : null}
                      </strong>
                      <span className="ai-provider-detail">{p.base_url}</span>
                      <span className="ai-provider-detail">模型 {p.model}</span>
                      <span className="ai-provider-detail">密钥 {p.api_key_masked}</span>
                    </div>
                    <div className="ai-provider-actions">
                      {translationOnly ? (
                        <span
                          className="ai-toggle ai-toggle--translation-only"
                          title="翻译专用，由系统统一支持"
                        >
                          <Check />
                          <span>翻译可用</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`ai-toggle${p.is_active ? ' is-on' : ''}`}
                          onClick={() => toggleActive(p)}
                        >
                          {p.is_active ? <Power /> : <PowerOff />}
                          <span>{p.is_active ? '已启用' : '已禁用'}</span>
                        </button>
                      )}
                      {!p.is_system ? (
                        <>
                          <button
                            type="button"
                            className="ai-icon-btn"
                            title="编辑"
                            onClick={() => openEdit(p)}
                          >
                            <Edit3 />
                          </button>
                          <button
                            type="button"
                            className="ai-icon-btn ai-icon-btn--danger"
                            title="删除"
                            onClick={() => remove(p)}
                          >
                            <Trash2 />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}

            <button type="button" className="ai-add-btn" onClick={openNew}>
              <Plus /> 添加自定义模型厂商 (如 DeepSeek)
            </button>
          </div>
        )}
      </section>

      {/* ── 添加/编辑厂商弹窗 ── */}
      {editing ? (
        <div className="ai-modal-overlay" onClick={closeEdit}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3>{editing === 'new' ? '新增 AI 厂商' : '编辑 AI 厂商'}</h3>
              <button type="button" className="ai-icon-btn" onClick={closeEdit}>
                <X />
              </button>
            </div>
            <div className="ai-modal-body">
              {editing === 'new' ? (
                <div className="preset-row">
                  <span className="preset-title">常用厂商快捷填入：</span>
                  <div className="preset-buttons">
                    {PRESETS.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className="preset-btn"
                        onClick={() => applyPreset(item)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label>
                厂商名称
                <input
                  value={form.label}
                  onChange={(e) => updateField('label', e.target.value)}
                  placeholder="例如：我的 DeepSeek"
                />
              </label>
              <label>
                Base URL
                <input
                  value={form.base_url}
                  onChange={(e) => updateField('base_url', e.target.value)}
                  placeholder="https://api.deepseek.com"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => updateField('api_key', e.target.value)}
                  placeholder={editing === 'new' ? 'sk-xxxxxxxx' : '留空保持不变'}
                />
              </label>
              <label>
                模型名称
                <input
                  value={form.model}
                  onChange={(e) => updateField('model', e.target.value)}
                  placeholder="deepseek-chat"
                />
              </label>
              {providerTestResult ? (
                <p className={`ai-provider-test-result${providerTestResult.success ? ' is-success' : ' is-error'}`}>
                  {providerTestResult.message}
                </p>
              ) : null}
            </div>
            <div className="ai-modal-footer">
              <button
                type="button"
                className="ai-btn-test"
                onClick={handleTestProvider}
                disabled={providerTesting || saving}
              >
                <RefreshCw className={providerTesting ? 'is-spinning' : ''} />
                {providerTesting ? '测试中...' : '测试连接'}
              </button>
              <button type="button" className="ai-btn-cancel" onClick={closeEdit}>
                取消
              </button>
              <button type="button" className="ai-btn-save" onClick={save} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
