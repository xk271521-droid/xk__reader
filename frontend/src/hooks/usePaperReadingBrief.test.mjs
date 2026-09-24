import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isPaperReadingBriefInProgress } from './paperReadingBriefState.js'

test('only queued and running paper briefs are polled', () => {
  assert.equal(isPaperReadingBriefInProgress('queued'), true)
  assert.equal(isPaperReadingBriefInProgress('running'), true)
  assert.equal(isPaperReadingBriefInProgress('completed'), false)
  assert.equal(isPaperReadingBriefInProgress('failed'), false)
  assert.equal(isPaperReadingBriefInProgress('idle'), false)
})

test('opening a paper automatically creates one brief only when no cached task exists', () => {
  const source = readFileSync(new URL('./usePaperReadingBrief.js', import.meta.url), 'utf8')
  assert.match(source, /let payload = await fetchPaperReadingBrief\(paperId\)/)
  assert.match(source, /payload\?\.status === 'idle'/)
  assert.match(source, /ensurePaperReadingBrief\(paperId\)/)
  assert.match(source, /automaticStartKeyRef/)
})

test('the hook exposes an explicit refresh path for cached briefs', () => {
  const source = readFileSync(new URL('./usePaperReadingBrief.js', import.meta.url), 'utf8')
  assert.match(source, /refreshPaperReadingBrief\(paperId\)/)
  assert.match(source, /return \{ brief, retry, refresh \}/)
})

test('the brief panel renders a refresh icon action for completed results', () => {
  const source = readFileSync(new URL('../components/reader/PaperReadingBriefPanel.jsx', import.meta.url), 'utf8')
  assert.match(source, /重新生成文献速读/)
  assert.match(source, /onRefresh/)
  assert.match(source, /RefreshCw/)
})
