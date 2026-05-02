import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Edit3, Power, Trash2, Plus, X } from 'lucide-react'
import {
  fetchAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
} from '../../services/paperReaderApi'

const INITIAL_EDIT = { label: '', base_url: '', api_key: '', model: '' }

export function AiConfigPage({ onBack }) {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(INITIAL_EDIT)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadProviders()
  }, [])

  async function loadProviders() {
    try {
      const data = await fetchAiProviders()
      setProviders(data.providers || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  function openNew() {
    setForm({ ...INITIAL_EDIT })
    setEditing('new')
  }

  function openEdit(provider) {
    setForm({
      label: provider.label,
      base_url: provider.base_url,
      api_key: '',
      model: provider.model,
    })
    setEditing(provider.id)
  }

  function closeEdit() {
    setEditing(null)
  }

  function updateField(field, value) { setForm((f) => ({ ...f, [field]: value })) }

  async function save() {
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
    } catch {
      alert('保存失败')
    }
    setSaving(false)
  }

  async function toggleActive(provider) {
    try {
      await updateAiProvider(provider.id, { is_active: !provider.is_active })
      await loadProviders()
    } catch { /* ignore */ }
  }

  async function remove(provider) {
    if (!window.confirm(`确定删除 "${provider.label}"？`)) return
    try {
      await deleteAiProvider(provider.id)
      await loadProviders()
    } catch { /* ignore */ }
  }

  return (
    <div className="ai-config-page">
      <div className="ai-config-header">
        <button type="button" className="ai-config-back" onClick={onBack}>
          <ArrowLeft /> 返回
        </button>
        <div>
          <h2>AI 厂商配置</h2>
          <p className="muted">管理你的大模型 API，按需启用或切换</p>
        </div>
      </div>

      {loading ? (
        <p className="muted">加载中...</p>
      ) : (
        <div className="ai-config-list">
          {providers.map((p) => (
            <div
              key={p.id}
              className={`ai-provider-card${p.is_active ? '' : ' is-inactive'}${p.is_system ? ' is-system' : ''}`}
            >
              <div className="ai-provider-main">
                <div className="ai-provider-info">
                  <strong>
                    {p.label}
                    {p.is_system ? <span className="ai-badge">官方</span> : null}
                  </strong>
                  <span className="ai-provider-detail">{p.base_url}</span>
                  <span className="ai-provider-detail">模型 {p.model}</span>
                  <span className="ai-provider-detail">密钥 {p.api_key_masked}</span>
                </div>
                <div className="ai-provider-actions">
                  <button
                    type="button"
                    className={`ai-toggle${p.is_active ? ' is-on' : ''}`}
                    title={p.is_active ? '已启用' : '已禁用'}
                    onClick={() => toggleActive(p)}
                  >
                    <Power />
                  </button>
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
          ))}

          <button type="button" className="ai-add-btn" onClick={openNew}>
            <Plus /> 添加厂商
          </button>
        </div>
      )}

      {editing ? (
        <div className="ai-modal-overlay" onClick={closeEdit}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3>{editing === 'new' ? '新增厂商' : '编辑厂商'}</h3>
              <button type="button" className="ai-icon-btn" onClick={closeEdit}>
                <X />
              </button>
            </div>
            <div className="ai-modal-body">
              <label>
                厂商名称
                <input value={form.label} onChange={(e) => updateField('label', e.target.value)} placeholder="例如：我的 DeepSeek" />
              </label>
              <label>
                Base URL
                <input value={form.base_url} onChange={(e) => updateField('base_url', e.target.value)} placeholder="https://api.deepseek.com" />
              </label>
              <label>
                API Key
                <input value={form.api_key} onChange={(e) => updateField('api_key', e.target.value)} placeholder={editing === 'new' ? 'sk-xxx' : '留空不修改'} />
              </label>
              <label>
                模型名
                <input value={form.model} onChange={(e) => updateField('model', e.target.value)} placeholder="deepseek-chat" />
              </label>
            </div>
            <div className="ai-modal-footer">
              <button type="button" className="ai-btn-cancel" onClick={closeEdit}>取消</button>
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
