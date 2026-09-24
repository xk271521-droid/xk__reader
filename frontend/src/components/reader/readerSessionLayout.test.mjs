import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const layoutCss = readFileSync(new URL('./readerSessionLayout.css', import.meta.url), 'utf8')

test('reader session stack keeps an absolute PDF session in the flexible main track', () => {
  assert.match(layoutCss, /\.reader-session-stack\s*\{[\s\S]*?flex:\s*auto;/)
  assert.match(layoutCss, /\.reader-session-stack\s*\{[\s\S]*?min-width:\s*0;/)
  assert.match(layoutCss, /\.reader-session\s*\{[\s\S]*?position:\s*absolute;/)
  assert.match(layoutCss, /\.reader-session\s*\{[\s\S]*?inset:\s*0;/)
})
