import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const loginSource = readFileSync(new URL('./Login.jsx', import.meta.url), 'utf8')

test('login page focuses the desktop account field without delayed timer chains', () => {
  assert.match(loginSource, /import \{ isDesktopShell \} from '..\/utils\/desktopShell'/)
  assert.match(loginSource, /const isDesktop = isDesktopShell\(\)/)
  assert.match(loginSource, /autoFocus=\{isDesktop\}/)
  assert.match(loginSource, /accountInputRef/)
  assert.match(loginSource, /accountInputRef\.current\?\.focus/)
  assert.match(loginSource, /window\.addEventListener\('focus', focusAccountInput/)
  assert.match(loginSource, /document\.activeElement/)
  assert.doesNotMatch(loginSource, /desktopFocusTimers/)
  assert.doesNotMatch(loginSource, /\[0,\s*120,\s*420,\s*900\]/)
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
