import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const loginSource = readFileSync(new URL('./Login.jsx', import.meta.url), 'utf8')

test('login page has desktop shell guards for source links and startup focus', () => {
  assert.match(loginSource, /import \{ isDesktopShell \} from '..\/utils\/desktopShell'/)
  assert.match(loginSource, /const isDesktop = isDesktopShell\(\)/)
  assert.match(loginSource, /!isDesktop \? \(/)
  assert.match(loginSource, /autoFocus=\{isDesktop\}/)
  assert.match(loginSource, /desktopFocusTimers/)
  assert.match(loginSource, /document\.activeElement/)
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
