import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const loginSource = readFileSync(new URL('./Login.jsx', import.meta.url), 'utf8')

test('login page settles focus on the desktop account field after the shell becomes active', () => {
  assert.match(loginSource, /import \{ isDesktopShell \} from '..\/utils\/desktopShell'/)
  assert.match(loginSource, /const isDesktop = isDesktopShell\(\)/)
  assert.match(loginSource, /autoFocus=\{isDesktop\}/)
  assert.match(loginSource, /accountInputRef/)
  assert.match(loginSource, /const input = accountInputRef\.current/)
  assert.match(loginSource, /input\.focus\(\{ preventScroll: true \}\)/)
  assert.match(loginSource, /DESKTOP_LOGIN_FOCUS_DELAYS = \[0,\s*80,\s*240,\s*600,\s*1200\]/)
  assert.match(loginSource, /window\.setTimeout\(focusAccountInput, delay\)/)
  assert.match(loginSource, /window\.addEventListener\('focus', handleWindowFocus/)
  assert.match(loginSource, /document\.addEventListener\('visibilitychange', handleVisibilityChange/)
  assert.match(loginSource, /document\.activeElement/)
  assert.match(loginSource, /document\.activeElement === input \|\| isPageFocusIdle\(\)/)
  assert.doesNotMatch(loginSource, /document\.getElementById\('account'\)\?\.focus/)
})

test('login page does not expose the source code link', () => {
  assert.doesNotMatch(loginSource, /SOURCE_CODE_/)
  assert.doesNotMatch(loginSource, /auth-card__source/)
})

test('login character mouse tracking is animation-frame throttled', () => {
  assert.match(loginSource, /animationFrameRef/)
  assert.match(loginSource, /window\.requestAnimationFrame/)
  assert.match(loginSource, /window\.cancelAnimationFrame/)
})

test('login page exposes the desktop download link only on the web', () => {
  assert.match(loginSource, /DESKTOP_DOWNLOAD_URL/)
  assert.match(loginSource, /DESKTOP_DOWNLOAD_FILENAME/)
  assert.match(loginSource, /className="auth-card__desktop-download"/)
  assert.match(loginSource, /download=\{DESKTOP_DOWNLOAD_FILENAME\}/)
})

test('login page wires the remember me checkbox into the login request', () => {
  assert.match(loginSource, /getRememberedLogin/)
  assert.match(loginSource, /storeRememberedLogin/)
  assert.match(loginSource, /rememberMe: false/)
  assert.match(loginSource, /useState\(buildRememberedLoginForm\)/)
  assert.match(loginSource, /remember_me: form\.rememberMe/)
  assert.match(loginSource, /checked=\{form\.rememberMe\}/)
  assert.match(loginSource, /updateField\('rememberMe', event\.target\.checked\)/)
})
