import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const scriptSource = readFileSync(new URL('../deploy-web-and-desktop.ps1', import.meta.url), 'utf8')

test('one-step deploy packages the desktop app before deploying the web app', () => {
  assert.match(scriptSource, /\$DesktopDir = Join-Path \$Root "paper-reader-desktop"/)
  assert.match(scriptSource, /npm run package:win/)
  assert.match(scriptSource, /\$deployArgs \+= "-SkipBuild"/)
  assert.match(scriptSource, /& \$DeployScript @deployArgs/)
})

test('one-step deploy verifies the generated desktop installer', () => {
  assert.match(scriptSource, /\$DesktopInstaller = Join-Path \$Root "frontend\\public\\downloads\\xk-reader-setup\.exe"/)
  assert.match(scriptSource, /Test-Path -LiteralPath \$DesktopInstaller/)
  assert.match(scriptSource, /Desktop installer was not generated/)
})
