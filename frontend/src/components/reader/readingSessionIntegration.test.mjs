import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../../app/App.jsx', import.meta.url), 'utf8')
const readerSource = readFileSync(new URL('../../hooks/usePdfReader.js', import.meta.url), 'utf8')

test('restores reader page and zoom through the reading session storage module', () => {
  assert.match(readerSource, /readReadingSessionSnapshot/)
  assert.match(readerSource, /saveReadingSessionSnapshot/)
  assert.match(readerSource, /pageNumber:\s*restoredSession\?\.pageNumber/)
  assert.match(readerSource, /scale:\s*restoredSession\?\.scale/)
})

test('persists workspace panel state from the app shell per active paper', () => {
  assert.match(appSource, /readReadingSessionSnapshot/)
  assert.match(appSource, /saveReadingSessionSnapshot/)
  assert.match(appSource, /activeWorkspacePanel/)
  assert.match(appSource, /workspacePanel\.width/)
})
