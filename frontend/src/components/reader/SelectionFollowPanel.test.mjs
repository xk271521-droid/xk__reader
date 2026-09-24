import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./SelectionFollowPanel.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./SelectionFollowPanel.css', import.meta.url), 'utf8')

test('loads a fixed viewport layer for the portaled follow translation', () => {
  assert.match(source, /import '\.\/SelectionFollowPanel\.css'/)
  assert.match(styles, /\.selection-follow-panel\s*\{[\s\S]*?position:\s*fixed[\s\S]*?z-index:\s*1200/)
  assert.match(styles, /\.selection-follow-panel__header[\s\S]*?cursor:\s*grab/)
})
