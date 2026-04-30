import { useEffect, useMemo, useState } from 'react'
import { loginUser, registerUser } from '../services/authApi'
import './Login.css'

const EDUCATION_OPTIONS = ['本科', '硕士', '博士', '教师', '其他']
const OCCUPATION_OPTIONS = ['学生', '教师', '研究员', '工程师', '其他']
const DISCIPLINE_OPTIONS = [
  '计算机科学与技术',
  '人工智能',
  '软件工程',
  '数据科学',
  '信息与通信工程',
  '其他',
]

const copy = {
  login: {
    title: '欢迎回来',
    description: '请输入手机号或邮箱和密码，继续你的论文阅读进度。',
    primary: '登录',
    footerPrefix: '还没有账号？',
    footerAction: '立即注册',
  },
  signup: {
    title: '创建账号',
    description: '加入 XK 阅读，让你的论文、批注和个人资料开始同步。',
    next: '下一步',
    primary: '创建账号',
    back: '上一步',
    footerPrefix: '已经有账号？',
    footerAction: '去登录',
  },
}

function Pupil({ size = 12, pupilColor = 'black', offsetX = 0, offsetY = 0 }) {
  return (
    <div
      className="shape-pupil"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${offsetX}px, ${offsetY}px)`,
      }}
    />
  )
}

function EyeBall({
  size = 48,
  pupilSize = 16,
  eyeColor = 'white',
  pupilColor = 'black',
  isBlinking = false,
  offsetX = 0,
  offsetY = 0,
}) {
  return (
    <div
      className="shape-eye"
      style={{
        width: `${size}px`,
        height: isBlinking ? '2px' : `${size}px`,
        backgroundColor: eyeColor,
      }}
    >
      {!isBlinking ? (
        <div
          className="shape-eye__pupil"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${offsetX}px, ${offsetY}px)`,
          }}
        />
      ) : null}
    </div>
  )
}

function AnimatedCharacters({
  activeFieldGroup = 'default',
  activePasswordField = '',
  isTyping = false,
  showPassword = false,
  showConfirmPassword = false,
  passwordLength = 0,
}) {
  const [mouseX, setMouseX] = useState(0)
  const [mouseY, setMouseY] = useState(0)
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false)
  const [isBlackBlinking, setIsBlackBlinking] = useState(false)

  useEffect(() => {
    const handleMouseMove = (event) => {
      setMouseX(event.clientX)
      setMouseY(event.clientY)
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000
    let blinkTimeout

    const scheduleBlink = () => {
      blinkTimeout = window.setTimeout(() => {
        setIsPurpleBlinking(true)
        window.setTimeout(() => {
          setIsPurpleBlinking(false)
          scheduleBlink()
        }, 150)
      }, getRandomBlinkInterval())
    }

    scheduleBlink()
    return () => window.clearTimeout(blinkTimeout)
  }, [])

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000
    let blinkTimeout

    const scheduleBlink = () => {
      blinkTimeout = window.setTimeout(() => {
        setIsBlackBlinking(true)
        window.setTimeout(() => {
          setIsBlackBlinking(false)
          scheduleBlink()
        }, 150)
      }, getRandomBlinkInterval())
    }

    scheduleBlink()
    return () => window.clearTimeout(blinkTimeout)
  }, [])

  const centerX = mouseX - window.innerWidth / 2
  const centerY = mouseY - window.innerHeight / 2
  const isAccountFocus = activeFieldGroup === 'account'
  const isPasswordFocus = activeFieldGroup === 'password'
  const isProfileFocus = activeFieldGroup === 'profile'
  const isAgreementFocus = activeFieldGroup === 'agreement'
  const isVisiblePasswordFocus =
    isPasswordFocus &&
    ((activePasswordField === 'password' && showPassword) ||
      (activePasswordField === 'confirmPassword' && showConfirmPassword))
  const isSecretPasswordFocus = isPasswordFocus && !isVisiblePasswordFocus
  const isLookingAtInput = isTyping || isAccountFocus || isProfileFocus || isVisiblePasswordFocus
  const isPurplePeeking = passwordLength > 0 && isSecretPasswordFocus
  const isHidingPassword = passwordLength > 0 && isVisiblePasswordFocus

  const purplePos = {
    faceX: Math.max(-15, Math.min(15, centerX / 28)),
    faceY: Math.max(-10, Math.min(10, centerY / 46)),
    bodySkew: Math.max(-6, Math.min(6, -centerX / 180)),
  }
  const blackPos = {
    faceX: Math.max(-15, Math.min(15, centerX / 34)),
    faceY: Math.max(-10, Math.min(10, centerY / 54)),
    bodySkew: Math.max(-6, Math.min(6, -centerX / 220)),
  }
  const yellowPos = {
    faceX: Math.max(-15, Math.min(15, centerX / 30)),
    faceY: Math.max(-10, Math.min(10, centerY / 52)),
    bodySkew: Math.max(-6, Math.min(6, -centerX / 200)),
  }
  const orangePos = {
    faceX: Math.max(-15, Math.min(15, centerX / 24)),
    faceY: Math.max(-10, Math.min(10, centerY / 40)),
    bodySkew: Math.max(-6, Math.min(6, -centerX / 150)),
  }

  return (
    <div className="characters-stage">
      <div
        className="shape shape--purple"
        style={{
          height: isPasswordFocus || isHidingPassword ? '440px' : isProfileFocus ? '426px' : '400px',
          transform:
            isSecretPasswordFocus
              ? 'skewX(0deg)'
              : isProfileFocus
                ? `skewX(${(purplePos.bodySkew || 0) - 6}deg) translateX(16px)`
                : isLookingAtInput
                  ? `skewX(${(purplePos.bodySkew || 0) - 10}deg) translateX(32px)`
                  : isAgreementFocus
                    ? 'skewX(-2deg)'
                    : `skewX(${purplePos.bodySkew || 0}deg)`,
        }}
      >
        <div
          className="shape__eyes shape__eyes--purple"
          style={{
            left:
              isSecretPasswordFocus
                ? '20px'
                : isProfileFocus
                  ? '68px'
                  : isLookingAtInput
                    ? '55px'
                    : `${45 + purplePos.faceX}px`,
            top:
              isSecretPasswordFocus
                ? '35px'
                : isProfileFocus
                  ? '56px'
                  : isLookingAtInput
                    ? '65px'
                    : `${40 + purplePos.faceY}px`,
          }}
        >
          <EyeBall
            size={18}
            pupilSize={7}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isPurpleBlinking}
            offsetX={
              isSecretPasswordFocus
                ? isPurplePeeking
                  ? 4
                  : -4
                : isProfileFocus
                  ? 6
                  : isLookingAtInput
                    ? 3
                    : undefined
            }
            offsetY={
              isSecretPasswordFocus
                ? isPurplePeeking
                  ? 5
                  : -4
                : isProfileFocus
                  ? 1
                  : isLookingAtInput
                    ? 4
                    : undefined
            }
          />
          <EyeBall
            size={18}
            pupilSize={7}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isPurpleBlinking}
            offsetX={
              isSecretPasswordFocus
                ? isPurplePeeking
                  ? 4
                  : -4
                : isProfileFocus
                  ? 6
                  : isLookingAtInput
                    ? 3
                    : undefined
            }
            offsetY={
              isSecretPasswordFocus
                ? isPurplePeeking
                  ? 5
                  : -4
                : isProfileFocus
                  ? 1
                  : isLookingAtInput
                    ? 4
                    : undefined
            }
          />
        </div>
      </div>

      <div
        className="shape shape--black"
        style={{
          transform:
            isSecretPasswordFocus
              ? 'skewX(0deg)'
              : isProfileFocus
                ? `skewX(${(blackPos.bodySkew || 0) + 8}deg) translateX(14px)`
                : isLookingAtInput
                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                  : `skewX(${blackPos.bodySkew || 0}deg)`,
        }}
      >
        <div
          className="shape__eyes shape__eyes--black"
          style={{
            left:
              isSecretPasswordFocus
                ? '10px'
                : isProfileFocus
                  ? '38px'
                  : isLookingAtInput
                    ? '32px'
                    : `${26 + blackPos.faceX}px`,
            top:
              isSecretPasswordFocus
                ? '28px'
                : isProfileFocus
                  ? '20px'
                  : isLookingAtInput
                    ? '12px'
                    : `${32 + blackPos.faceY}px`,
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isBlackBlinking}
            offsetX={isSecretPasswordFocus ? -4 : isProfileFocus ? 4 : isLookingAtInput ? 0 : undefined}
            offsetY={isSecretPasswordFocus ? -4 : isProfileFocus ? -1 : isLookingAtInput ? -4 : undefined}
          />
          <EyeBall
            size={16}
            pupilSize={6}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isBlackBlinking}
            offsetX={isSecretPasswordFocus ? -4 : isProfileFocus ? 4 : isLookingAtInput ? 0 : undefined}
            offsetY={isSecretPasswordFocus ? -4 : isProfileFocus ? -1 : isLookingAtInput ? -4 : undefined}
          />
        </div>
      </div>

      <div
        className="shape shape--orange"
        style={{
          transform:
            isSecretPasswordFocus
              ? 'skewX(0deg)'
              : isProfileFocus
                ? `skewX(${(orangePos.bodySkew || 0) - 6}deg) translateY(-8px)`
                : `skewX(${orangePos.bodySkew || 0}deg)`,
        }}
      >
        <div
          className="shape__eyes shape__eyes--orange"
          style={{
            left:
              isSecretPasswordFocus
                ? '50px'
                : isProfileFocus
                  ? '96px'
                  : `${82 + (orangePos.faceX || 0)}px`,
            top:
              isSecretPasswordFocus
                ? '85px'
                : isProfileFocus
                  ? '74px'
                  : `${90 + (orangePos.faceY || 0)}px`,
          }}
        >
          <Pupil
            size={12}
            pupilColor="#2D2D2D"
            offsetX={isSecretPasswordFocus ? -5 : isProfileFocus ? 5 : isLookingAtInput ? 2 : 0}
            offsetY={isSecretPasswordFocus ? -4 : isProfileFocus ? -3 : isLookingAtInput ? -1 : 0}
          />
          <Pupil
            size={12}
            pupilColor="#2D2D2D"
            offsetX={isSecretPasswordFocus ? -5 : isProfileFocus ? 5 : isLookingAtInput ? 2 : 0}
            offsetY={isSecretPasswordFocus ? -4 : isProfileFocus ? -3 : isLookingAtInput ? -1 : 0}
          />
        </div>
      </div>

      <div
        className="shape shape--yellow"
        style={{
          transform:
            isSecretPasswordFocus
              ? 'skewX(0deg)'
              : isProfileFocus
                ? `skewX(${(yellowPos.bodySkew || 0) + 4}deg) translateY(-4px)`
                : `skewX(${yellowPos.bodySkew || 0}deg)`,
        }}
      >
        <div
          className="shape__eyes shape__eyes--yellow"
          style={{
            left:
              isSecretPasswordFocus
                ? '20px'
                : isProfileFocus
                  ? '64px'
                  : `${52 + (yellowPos.faceX || 0)}px`,
            top:
              isSecretPasswordFocus
                ? '35px'
                : isProfileFocus
                  ? '28px'
                  : `${40 + (yellowPos.faceY || 0)}px`,
          }}
        >
          <Pupil
            size={12}
            pupilColor="#2D2D2D"
            offsetX={isSecretPasswordFocus ? -5 : isProfileFocus ? 4 : isLookingAtInput ? 2 : 0}
            offsetY={isSecretPasswordFocus ? -4 : isProfileFocus ? -3 : isLookingAtInput ? -1 : 0}
          />
          <Pupil
            size={12}
            pupilColor="#2D2D2D"
            offsetX={isSecretPasswordFocus ? -5 : isProfileFocus ? 4 : isLookingAtInput ? 2 : 0}
            offsetY={isSecretPasswordFocus ? -4 : isProfileFocus ? -3 : isLookingAtInput ? -1 : 0}
          />
        </div>

        <div
          className="shape__mouth-line"
          style={{
            left:
              isSecretPasswordFocus
                ? '10px'
                : isProfileFocus
                  ? '50px'
                  : `${40 + (yellowPos.faceX || 0)}px`,
            top:
              isSecretPasswordFocus
                ? '88px'
                : isProfileFocus
                  ? '78px'
                  : `${88 + (yellowPos.faceY || 0)}px`,
          }}
        />
      </div>
    </div>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

function EyeIcon({ hidden = false }) {
  if (hidden) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
        <path d="M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4.1 9.6 5.6a2.3 2.3 0 0 1 0 2.8 18.4 18.4 0 0 1-2.3 2.5" />
        <path d="M6.1 6.7a18.9 18.9 0 0 0-3.7 3.9 2.3 2.3 0 0 0 0 2.8C3.5 14.9 7 19 12 19a9.6 9.6 0 0 0 4.3-1" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function InteractiveHoverButton({ text, icon, className = '', type = 'button', ...props }) {
  return (
    <button
      className={`hover-button ${className}`.trim()}
      type={type}
      {...props}
    >
      <span className="hover-button__text">{text}</span>
      <span className="hover-button__overlay">
        <span>{text}</span>
        {icon || <ArrowIcon />}
      </span>
    </button>
  )
}

function buildEmptyForm() {
  return {
    account: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    education: EDUCATION_OPTIONS[1],
    occupation: OCCUPATION_OPTIONS[0],
    organization: '',
    discipline: DISCIPLINE_OPTIONS[0],
    agreeTerms: false,
  }
}

function isValidPhone(value) {
  return /^1[3-9]\d{9}$/.test(value.trim())
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function Login({ initialMode = 'login', onAuthSuccess }) {
  const [mode, setMode] = useState(initialMode)
  const [signupStep, setSignupStep] = useState(1)
  const [form, setForm] = useState(buildEmptyForm)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [activeFieldGroup, setActiveFieldGroup] = useState('default')
  const [activePasswordField, setActivePasswordField] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const current = copy[mode]

  const passwordLength = useMemo(() => {
    if (mode === 'login') {
      return form.password.length
    }
    return Math.max(form.password.length, form.confirmPassword.length)
  }, [form.confirmPassword.length, form.password.length, mode])

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function handleFieldFocus(group, field = '') {
    setActiveFieldGroup(group)
    setActivePasswordField(group === 'password' ? field : '')
    setIsTyping(group !== 'agreement')
  }

  function handleFieldBlur() {
    setActiveFieldGroup('default')
    setActivePasswordField('')
    setIsTyping(false)
  }

  function resetForMode(nextMode) {
    setMode(nextMode)
    setSignupStep(1)
    setForm(buildEmptyForm())
    setShowPassword(false)
    setShowConfirmPassword(false)
    setIsTyping(false)
    setActiveFieldGroup('default')
    setActivePasswordField('')
    setIsLoading(false)
    setError('')
  }

  function validateLogin() {
    if (!form.account.trim()) {
      return '请输入手机号或邮箱。'
    }
    if (form.password.length < 8) {
      return '密码至少需要 8 位。'
    }
    return ''
  }

  function validateSignupStepOne() {
    if (!isValidPhone(form.phone)) {
      return '请输入正确的手机号。'
    }
    if (!isValidEmail(form.email)) {
      return '请输入正确的邮箱地址。'
    }
    if (form.password.length < 8) {
      return '密码至少需要 8 位。'
    }
    if (form.password !== form.confirmPassword) {
      return '两次输入的密码不一致。'
    }
    return ''
  }

  function validateSignupStepTwo() {
    if (form.nickname.trim().length < 2) {
      return '昵称至少需要 2 个字符。'
    }
    if (!form.organization.trim()) {
      return '请填写学校或单位。'
    }
    if (!form.agreeTerms) {
      return '请先同意用户协议和隐私政策。'
    }
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (mode === 'login') {
      const loginError = validateLogin()
      if (loginError) {
        setError(loginError)
        return
      }

      setIsLoading(true)
      try {
        const authPayload = await loginUser({
          account: form.account.trim(),
          password: form.password,
        })
        onAuthSuccess?.(authPayload)
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '登录失败，请稍后再试。')
      } finally {
        setIsLoading(false)
      }
      return
    }

    if (signupStep === 1) {
      const signupError = validateSignupStepOne()
      if (signupError) {
        setError(signupError)
        return
      }
      setSignupStep(2)
      return
    }

    const signupError = validateSignupStepTwo()
    if (signupError) {
      setError(signupError)
      return
    }

    setIsLoading(true)
    try {
      const authPayload = await registerUser({
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        confirm_password: form.confirmPassword,
        nickname: form.nickname.trim(),
        education: form.education,
        occupation: form.occupation,
        organization: form.organization.trim(),
        discipline: form.discipline,
        agree_terms: form.agreeTerms,
      })
      onAuthSuccess?.(authPayload)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '注册失败，请稍后再试。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-layout__scene">
        <div className="scene-panel">
          <div className="scene-panel__brand">
            <a href="/" className="scene-brand-link" onClick={(event) => event.preventDefault()}>
              <img
                alt="XK 阅读 logo"
                className="scene-brand-link__logo"
                src="https://i.postimg.cc/nLrDYrHW/icon.png"
              />
              <span>XK 阅读</span>
            </a>
          </div>

          <div className="scene-panel__stage">
            <AnimatedCharacters
              activeFieldGroup={activeFieldGroup}
              activePasswordField={activePasswordField}
              isTyping={isTyping}
              showPassword={showPassword}
              showConfirmPassword={showConfirmPassword}
              passwordLength={passwordLength}
            />
          </div>

          <div className="scene-panel__footer">
            <button type="button">隐私政策</button>
            <button type="button">服务条款</button>
          </div>

          <div className="scene-panel__grid" />
          <div className="scene-panel__blur scene-panel__blur--one" />
          <div className="scene-panel__blur scene-panel__blur--two" />
        </div>
      </div>

      <div className="auth-layout__form">
        <div className="auth-card">
          <div className="auth-card__mobile-brand">
            <img
              alt="XK 阅读 logo"
              className="auth-card__mobile-logo"
              src="https://i.postimg.cc/nLrDYrHW/icon.png"
            />
            <span>XK 阅读</span>
          </div>

          <div className="auth-card__header">
            <h1>{current.title}</h1>
            <p>{current.description}</p>
          </div>

          {mode === 'signup' ? (
            <div className="auth-steps" aria-label="注册步骤">
              <div className={`auth-step${signupStep === 1 ? ' is-active' : signupStep > 1 ? ' is-done' : ''}`}>
                1. 账号信息
              </div>
              <div className={`auth-step${signupStep === 2 ? ' is-active' : ''}`}>
                2. 基础资料
              </div>
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'login' ? (
              <>
                <div className="auth-form__field">
                  <label htmlFor="account">手机号或邮箱</label>
                  <input
                    id="account"
                    type="text"
                    placeholder="请输入手机号或邮箱"
                    autoComplete="username"
                    value={form.account}
                    onChange={(event) => updateField('account', event.target.value)}
                    onFocus={() => handleFieldFocus('account')}
                    onBlur={handleFieldBlur}
                    className="auth-input"
                  />
                </div>

                <div className="auth-form__field">
                  <label htmlFor="login-password">密码</label>
                  <div className="auth-input-wrap">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="请输入密码"
                      autoComplete="current-password"
                      value={form.password}
                      onChange={(event) => updateField('password', event.target.value)}
                      onFocus={() => handleFieldFocus('password', 'password')}
                      onBlur={handleFieldBlur}
                      className="auth-input auth-input--password"
                    />
                    <button
                      type="button"
                      className="auth-input-wrap__toggle"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </div>
              </>
            ) : signupStep === 1 ? (
              <>
                <div className="auth-form__field">
                  <label htmlFor="signup-phone">手机号</label>
                  <input
                    id="signup-phone"
                    type="tel"
                    placeholder="请输入手机号"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(event) => updateField('phone', event.target.value)}
                    onFocus={() => handleFieldFocus('account')}
                    onBlur={handleFieldBlur}
                    className="auth-input"
                  />
                </div>

                <div className="auth-form__field">
                  <label htmlFor="signup-email">邮箱</label>
                  <input
                    id="signup-email"
                    type="email"
                    placeholder="请输入邮箱"
                    autoComplete="email"
                    value={form.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    onFocus={() => handleFieldFocus('account')}
                    onBlur={handleFieldBlur}
                    className="auth-input"
                  />
                </div>

                <div className="auth-form__field">
                  <label htmlFor="signup-password">密码</label>
                  <div className="auth-input-wrap">
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="至少 8 位"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(event) => updateField('password', event.target.value)}
                      onFocus={() => handleFieldFocus('password', 'password')}
                      onBlur={handleFieldBlur}
                      className="auth-input auth-input--password"
                    />
                    <button
                      type="button"
                      className="auth-input-wrap__toggle"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </div>

                <div className="auth-form__field">
                  <label htmlFor="signup-confirm-password">确认密码</label>
                  <div className="auth-input-wrap">
                    <input
                      id="signup-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="请再次输入密码"
                      autoComplete="new-password"
                      value={form.confirmPassword}
                      onChange={(event) => updateField('confirmPassword', event.target.value)}
                      onFocus={() => handleFieldFocus('password', 'confirmPassword')}
                      onBlur={handleFieldBlur}
                      className="auth-input auth-input--password"
                    />
                    <button
                      type="button"
                      className="auth-input-wrap__toggle"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                    >
                      <EyeIcon hidden={showConfirmPassword} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="auth-form__field">
                  <label htmlFor="nickname">昵称</label>
                  <input
                    id="nickname"
                    type="text"
                    placeholder="请输入昵称"
                    autoComplete="nickname"
                    value={form.nickname}
                    onChange={(event) => updateField('nickname', event.target.value)}
                    onFocus={() => handleFieldFocus('profile')}
                    onBlur={handleFieldBlur}
                    className="auth-input"
                  />
                </div>

                <div className="auth-form__field">
                  <label htmlFor="education">学历</label>
                  <select
                    id="education"
                    value={form.education}
                    onChange={(event) => updateField('education', event.target.value)}
                    onFocus={() => handleFieldFocus('profile')}
                    onBlur={handleFieldBlur}
                    className="auth-input auth-input--select"
                  >
                    {EDUCATION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="auth-form__field">
                  <label htmlFor="occupation">职业</label>
                  <select
                    id="occupation"
                    value={form.occupation}
                    onChange={(event) => updateField('occupation', event.target.value)}
                    onFocus={() => handleFieldFocus('profile')}
                    onBlur={handleFieldBlur}
                    className="auth-input auth-input--select"
                  >
                    {OCCUPATION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="auth-form__field">
                  <label htmlFor="organization">学校/单位</label>
                  <input
                    id="organization"
                    type="text"
                    placeholder="请输入学校或单位"
                    autoComplete="organization"
                    value={form.organization}
                    onChange={(event) => updateField('organization', event.target.value)}
                    onFocus={() => handleFieldFocus('profile')}
                    onBlur={handleFieldBlur}
                    className="auth-input"
                  />
                </div>

                <div className="auth-form__field">
                  <label htmlFor="discipline">学科领域</label>
                  <select
                    id="discipline"
                    value={form.discipline}
                    onChange={(event) => updateField('discipline', event.target.value)}
                    onFocus={() => handleFieldFocus('profile')}
                    onBlur={handleFieldBlur}
                    className="auth-input auth-input--select"
                  >
                    {DISCIPLINE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="auth-checkbox">
                  <input
                    type="checkbox"
                    checked={form.agreeTerms}
                    onChange={(event) => updateField('agreeTerms', event.target.checked)}
                    onFocus={() => handleFieldFocus('agreement')}
                    onBlur={handleFieldBlur}
                  />
                  <span>我已阅读并同意《用户协议》与《隐私政策》</span>
                </label>
              </>
            )}

            {mode === 'login' ? (
              <div className="auth-form__row">
                <label className="remember-row">
                  <input type="checkbox" />
                  <span>30 天内记住我</span>
                </label>
                <button type="button" className="text-link">
                  忘记密码？
                </button>
              </div>
            ) : null}

            {error ? <div className="auth-error">{error}</div> : null}

            <div className="auth-form__actions">
              {mode === 'signup' && signupStep === 2 ? (
                <InteractiveHoverButton
                  type="button"
                  text={copy.signup.back}
                  className="auth-button auth-button--secondary"
                  onClick={() => {
                    setSignupStep(1)
                    setError('')
                  }}
                />
              ) : null}

              <InteractiveHoverButton
                type="submit"
                text={
                  isLoading
                    ? mode === 'login'
                      ? '登录中...'
                      : '提交中...'
                    : mode === 'signup' && signupStep === 1
                      ? copy.signup.next
                      : current.primary
                }
                className="auth-button auth-button--primary"
                disabled={isLoading}
              />
            </div>
          </form>

          <div className="auth-card__footer">
            {current.footerPrefix}{' '}
            <button
              type="button"
              className="text-link text-link--strong"
              onClick={() => resetForMode(mode === 'login' ? 'signup' : 'login')}
            >
              {current.footerAction}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
