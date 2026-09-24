import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('topbar does not expose the source code link', () => {
  assert.doesNotMatch(appSource, /SOURCE_CODE_/)
  assert.doesNotMatch(appSource, /topbar-action--source/)
  assert.doesNotMatch(appSource, /<Code2/)
})

test('topbar exposes the desktop download link only on the web', () => {
  assert.match(appSource, /DESKTOP_DOWNLOAD_URL/)
  assert.match(appSource, /DESKTOP_DOWNLOAD_FILENAME/)
  assert.match(appSource, /className="topbar-action topbar-action--desktop-download"/)
  assert.match(appSource, /download=\{DESKTOP_DOWNLOAD_FILENAME\}/)
})

test('full translation opens a chrome-free focus shell', () => {
  assert.match(appSource, /app-shell--full-translation/)
  assert.match(appSource, /!isCurrentPaperFullTranslationOpen \? \(/)
})

test('login success stores the auth token with the remember me option', () => {
  assert.match(appSource, /onAuthSuccess=\{\(authPayload, loginOptions = \{\}\) =>/)
  assert.match(appSource, /storeAuthToken\(authPayload\.access_token, \{ remember: loginOptions\.remember !== false \}\)/)
})
