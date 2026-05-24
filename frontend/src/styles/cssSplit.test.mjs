import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const homePageSource = readFileSync(new URL('../components/home/HomePage.jsx', import.meta.url), 'utf8')
const appCss = readFileSync(new URL('./app.css', import.meta.url), 'utf8')

test('loads library-page CSS separately from the global app stylesheet', () => {
  assert.match(homePageSource, /import '..\/..\/styles\/home-library\.css'/)
  assert.doesNotMatch(appCss, /^\.home-content\.is-library\s*\{/m)
  assert.doesNotMatch(appCss, /^\.home-content\.is-library \.home-category-panel\s*\{/m)
  assert.doesNotMatch(appCss, /^\.home-content\.is-library \.home-category-table\s*\{/m)
  assert.doesNotMatch(appCss, /^\.home-content\.is-library \.home-pagination\s*\{/m)
})
