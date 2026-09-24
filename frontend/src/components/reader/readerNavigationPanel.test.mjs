import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./ReaderNavigationPanel.jsx', import.meta.url), 'utf8')

test('AI outline presentation is cache-first and does not expose a second automatic trigger', () => {
  assert.doesNotMatch(source, /onGenerateAiOutline/)
  assert.match(source, /正在准备 AI 目录/)
})
