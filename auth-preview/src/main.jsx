import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowRight,
  BookLock,
  Eye,
  EyeOff,
  Mail,
  Sparkles,
  UserRound,
} from 'lucide-react'
import './styles.css'

const authCopy = {
  login: {
    eyebrow: '继续阅读',
    title: '欢迎回来',
    desc: '进入你的论文阅读工作台，继续整理翻译、批注和术语。',
    action: '登录',
    switchText: '还没有账号？',
    switchAction: '创建账号',
  },
  register: {
    eyebrow: '创建空间',
    title: '开始新的阅读计划',
    desc: '注册后可以保存文献、笔记和划词结果，让阅读记录一直跟着你。',
    action: '注册',
    switchText: '已经有账号？',
    switchAction: '去登录',
  },
}

function AuthMascots({ status, mousePos }) {
  const pupil = useMemo(() => {
    if (status === 'email') return { x: 7, y: 0 }
    if (status === 'name') return { x: -5, y: -2 }
    if (status === 'idle') return mousePos
    return { x: 0, y: 0 }
  }, [mousePos, status])

  const privacyClass = status === 'password' || status === 'peek' ? 'turned' : ''

  return (
    <div className={`mascot-stage ${status}`} aria-hidden="true">
      <div className="stage-copy">
        <span>XK Reader</span>
        <strong>把论文读成自己的知识库</strong>
      </div>
      <svg viewBox="0 0 440 360" className="mascot-svg">
        <g className={`char violet ${privacyClass}`}>
          <rect className="body" x="150" y="74" width="76" height="238" rx="10" />
          <g className="face">
            <circle cx="172" cy="122" r="7" />
            <circle cx="204" cy="122" r="7" />
            <circle cx={172 + pupil.x} cy={122 + pupil.y} r="3.4" className="pupil" />
            <circle cx={204 + pupil.x} cy={122 + pupil.y} r="3.4" className="pupil" />
            <path d="M 174 148 Q 188 140 202 148" />
          </g>
          <rect className="back-line" x="166" y="112" width="44" height="5" rx="2" />
        </g>

        <g className={`char graphite ${privacyClass}`}>
          <rect className="body" x="226" y="118" width="66" height="194" rx="8" />
          <g className="face">
            <circle cx="248" cy="158" r="7.5" />
            <circle cx="275" cy="158" r="7.5" />
            <circle cx={248 + pupil.x} cy={158 + pupil.y} r="3.4" className="pupil" />
            <circle cx={275 + pupil.x} cy={158 + pupil.y} r="3.4" className="pupil" />
            <circle cx="262" cy="181" r="3" className="soft-dot" />
          </g>
        </g>

        <g className={`char honey ${privacyClass}`}>
          <rect className="body" x="302" y="148" width="76" height="164" rx="38" />
          <g className="face">
            <circle cx="324" cy="188" r="7" />
            <circle cx="354" cy="188" r="7" />
            <circle cx={324 + pupil.x} cy={188 + pupil.y} r="3.2" className="pupil" />
            <circle cx={354 + pupil.x} cy={188 + pupil.y} r="3.2" className="pupil" />
            <line x1="330" y1="214" x2="350" y2="214" />
          </g>
        </g>

        <g className={`char ember ${status === 'password' ? 'turned' : ''} ${status === 'peek' ? 'peeking' : ''}`}>
          <path className="body" d="M 42 312 A 86 86 0 0 1 214 312 Z" />
          <g className="face">
            <circle cx="104" cy="270" r="7.5" />
            <circle cx="148" cy="270" r="7.5" />
            <circle cx={104 + pupil.x} cy={270 + pupil.y} r="3.4" className="pupil" />
            <circle cx={148 + pupil.x} cy={270 + pupil.y} r="3.4" className="pupil" />
            <path d="M 114 289 Q 126 298 138 289" />
          </g>
          <g className="peek-eye">
            <circle cx="154" cy="266" r="7" />
            <circle cx="157" cy="266" r="3.4" className="pupil" />
          </g>
        </g>
      </svg>
      <div className="status-strip">
        <Sparkles size={16} />
        <span>{status === 'password' ? '隐私输入中' : status === 'peek' ? '密码可见' : '准备同步阅读记录'}</span>
      </div>
    </div>
  )
}

function AuthForm() {
  const [mode, setMode] = useState('login')
  const [status, setStatus] = useState('idle')
  const [showPassword, setShowPassword] = useState(false)
  const [result, setResult] = useState('')
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const pageRef = useRef(null)
  const copy = authCopy[mode]

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (status !== 'idle') return
      const rect = pageRef.current?.getBoundingClientRect()
      const width = rect?.width || window.innerWidth
      const height = rect?.height || window.innerHeight
      setMousePos({
        x: (event.clientX / width - 0.32) * 14,
        y: (event.clientY / height - 0.5) * 12,
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [status])

  function handleSubmit(event) {
    event.preventDefault()
    setStatus('success')
    setResult(mode === 'login' ? '登录成功，正在进入工作台。' : '注册成功，阅读空间已准备好。')
    window.setTimeout(() => {
      setStatus('idle')
      setResult('')
    }, 1800)
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setShowPassword(false)
    setResult('')
    setStatus('idle')
  }

  return (
    <main className="auth-page" ref={pageRef}>
      <AuthMascots status={status} mousePos={mousePos} />

      <section className="form-pane" aria-label={`${copy.action}表单`}>
        <div className="form-shell">
          <div className="mode-switch" role="tablist" aria-label="登录或注册">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>

          <div className="form-heading">
            <span>{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.desc}</p>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === 'register' ? (
              <label className="field">
                <span>昵称</span>
                <div className="input-wrap">
                  <UserRound size={18} />
                  <input
                    type="text"
                    placeholder="例如：李同学"
                    onFocus={() => setStatus('name')}
                    onBlur={() => setStatus('idle')}
                    required
                  />
                </div>
              </label>
            ) : null}

            <label className="field">
              <span>邮箱</span>
              <div className="input-wrap">
                <Mail size={18} />
                <input
                  type="email"
                  placeholder="you@example.com"
                  onFocus={() => setStatus('email')}
                  onBlur={() => setStatus('idle')}
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>密码</span>
              <div className="input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={mode === 'register' ? '至少 8 位字符' : '输入你的密码'}
                  minLength={mode === 'register' ? 8 : 1}
                  onFocus={() => setStatus(showPassword ? 'peek' : 'password')}
                  onBlur={() => setStatus('idle')}
                  required
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const next = !showPassword
                    setShowPassword(next)
                    setStatus(next ? 'peek' : 'password')
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <div className="form-options">
              <label>
                <input type="checkbox" />
                <span>{mode === 'login' ? '30 天内保持登录' : '接收阅读提醒'}</span>
              </label>
              <button type="button">{mode === 'login' ? '忘记密码？' : '已有邀请码？'}</button>
            </div>

            <button type="submit" className="primary-button">
              <span>{copy.action}</span>
              <ArrowRight size={18} />
            </button>

            <button type="button" className="secondary-button">
              <BookLock size={18} />
              <span>{mode === 'login' ? '使用机构账号登录' : '使用机构账号注册'}</span>
            </button>
          </form>

          {result ? <p className="result-text">{result}</p> : null}

          <p className="switch-copy">
            {copy.switchText}
            <button
              type="button"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            >
              {copy.switchAction}
            </button>
          </p>
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthForm />
  </React.StrictMode>,
)
