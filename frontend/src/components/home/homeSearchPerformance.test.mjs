import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const homePageSource = readFileSync(new URL('./HomePage.jsx', import.meta.url), 'utf8')

test('defers expensive home search filtering work behind the live input state', () => {
  assert.match(homePageSource, /useDeferredValue/)
  assert.match(homePageSource, /const deferredSearchTerm = useDeferredValue\(searchTerm\)/)
  assert.match(homePageSource, /buildGroupedPapers\(recentPapers, effectiveSearchTerm\)/)
})
