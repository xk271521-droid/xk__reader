import { useState } from 'react'
import { ArrowLeft, LogIn, UserPlus } from 'lucide-react'

const initialLoginForm = {
  email: '',
  password: '',
}

const initialRegisterForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
}

export function AuthPage({ mode, onBack, onLoginSuccess, onModeChange }) {
  const [loginForm, setLoginForm] = useState(initialLoginForm)
  const [registerForm, setRegisterForm] = useState(initialRegisterForm)
  const [error, setError] = useState('')

  function handleLoginSubmit(event) {
    event.preventDefault()

    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      setError('请输入邮箱和密码。')
      return
    }

    setError('')
    onLoginSuccess({
      name: loginForm.email.split('@')[0] || 'xk',
      email: loginForm.email.trim(),
    })
  }

  function handleRegisterSubmit(event) {
    event.preventDefault()

    if (
      !registerForm.name.trim() ||
      !registerForm.email.trim() ||
      !registerForm.password.trim()
    ) {
      setError('请把注册信息填写完整。')
      return
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      setError('两次输入的密码不一致。')
      return
    }

    setError('')
    onLoginSuccess({
      name: registerForm.name.trim(),
      email: registerForm.email.trim(),
    })
  }

  return (
    <section className="auth-shell">
      <div className="auth-stage">
        <aside className="auth-panel auth-panel--brand">
          <p className="panel-label">Account</p>
          <h1>xk阅读</h1>
          <p className="auth-copy">
            把论文、即时理解、批注和文献信息放进一个连续工作流里。
          </p>

          <ul className="auth-feature-list">
            <li>登录后同步账号信息和阅读身份</li>
            <li>注册后可继续接入后端数据库与个人空间</li>
            <li>后续可扩展最近阅读、笔记、分类和全文翻译记录</li>
          </ul>

          <button type="button" className="auth-back" onClick={onBack}>
            <ArrowLeft />
            <span>返回当前工作台</span>
          </button>
        </aside>

        <div className="auth-panel auth-panel--form">
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab${mode === 'login' ? ' is-active' : ''}`}
              onClick={() => {
                setError('')
                onModeChange('login')
              }}
            >
              登录
            </button>
            <button
              type="button"
              className={`auth-tab${mode === 'register' ? ' is-active' : ''}`}
              onClick={() => {
                setError('')
                onModeChange('register')
              }}
            >
              注册
            </button>
          </div>

          {mode === 'login' ? (
            <form className="auth-form" onSubmit={handleLoginSubmit}>
              <div className="auth-form__heading">
                <LogIn />
                <div>
                  <h2>登录账号</h2>
                  <p>先接入页面流，后续再把接口和数据库接上。</p>
                </div>
              </div>

              <label className="auth-field">
                <span>邮箱</span>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="name@example.com"
                />
              </label>

              <label className="auth-field">
                <span>密码</span>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="请输入密码"
                />
              </label>

              {error ? <p className="auth-error">{error}</p> : null}

              <button type="submit" className="auth-submit">
                登录
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRegisterSubmit}>
              <div className="auth-form__heading">
                <UserPlus />
                <div>
                  <h2>注册账号</h2>
                  <p>这一步先走前端表单，后端数据库结构我会在下面给你说明。</p>
                </div>
              </div>

              <label className="auth-field">
                <span>昵称</span>
                <input
                  type="text"
                  value={registerForm.name}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="例如 xk"
                />
              </label>

              <label className="auth-field">
                <span>邮箱</span>
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="name@example.com"
                />
              </label>

              <label className="auth-field">
                <span>密码</span>
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="至少 8 位"
                />
              </label>

              <label className="auth-field">
                <span>确认密码</span>
                <input
                  type="password"
                  value={registerForm.confirmPassword}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="再次输入密码"
                />
              </label>

              {error ? <p className="auth-error">{error}</p> : null}

              <button type="submit" className="auth-submit">
                注册并进入
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
