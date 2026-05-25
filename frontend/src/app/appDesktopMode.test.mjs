import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('topbar source link is hidden in the desktop shell', () => {
  assert.match(appSource, /import \{ isDesktopShell \} from '..\/utils\/desktopShell'/)
  assert.match(appSource, /const isDesktop = isDesktopShell\(\)/)
  assert.match(appSource, /!isDesktop \? \(\s*<a\s+className="topbar-action topbar-action--source"/s)
})

test('topbar exposes the desktop download link only on the web', () => {
  assert.match(appSource, /DESKTOP_DOWNLOAD_URL/)
  assert.match(appSource, /DESKTOP_DOWNLOAD_FILENAME/)
  assert.match(appSource, /className="topbar-action topbar-action--desktop-download"/)
  assert.match(appSource, /download=\{DESKTOP_DOWNLOAD_FILENAME\}/)
})
