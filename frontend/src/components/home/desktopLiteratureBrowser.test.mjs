import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const literatureSearchPagePath = new URL('./LiteratureSearchPage.jsx', import.meta.url)
const homePagePath = new URL('./HomePage.jsx', import.meta.url)
const homeLibraryStylesPath = new URL('../../styles/home-library.css', import.meta.url)

test('desktop literature search stays inside the existing literature section', async () => {
  const source = await readFile(literatureSearchPagePath, 'utf8')

  assert.match(source, /isDesktopShell/)
  assert.match(source, /DesktopLiteratureBrowser/)
  assert.match(source, /<webview/)
  assert.match(source, /partition="persist:xk-literature-browser"/)
})

test('HomePage does not add a separate desktop tools section', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.doesNotMatch(source, /desktop-tools/)
  assert.doesNotMatch(source, /desktopHomeSection/)
})

test('continue-reading summary keeps only the paper title and timestamp', async () => {
  const source = await readFile(homePagePath, 'utf8')
  const sectionStart = source.indexOf('function ContinueWorkSection')
  const sectionEnd = source.indexOf('function PendingTaskSection', sectionStart)
  const continueSection = source.slice(sectionStart, sectionEnd)

  assert.match(continueSection, /home-continue-card__time/)
  assert.doesNotMatch(continueSection, /paper\.metadata|paper\.author/)
  assert.doesNotMatch(continueSection, /item\.statusLabel|item\.statusHint|item\.statusTags/)
})

test('library table does not clip a row action menu', async () => {
  const styles = await readFile(homeLibraryStylesPath, 'utf8')

  assert.match(
    styles,
    /\.home-content\.is-library \.home-category-table\s*\{[^}]*overflow:\s*visible/,
  )
})

test('library status tabs keep advanced filters in the same control row', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /home-status-filter__options/)
  assert.match(source, /home-status-filter[\s\S]*home-library-advanced-filter/)
})

test('active library folder uses a straight vertical marker', async () => {
  const styles = await readFile(homeLibraryStylesPath, 'utf8')

  assert.match(styles, /home-sidebar-folder-tree__item\.is-active::before/)
  assert.match(styles, /home-sidebar-folder-tree__item\.is-active\s*\{[\s\S]*background:\s*transparent/)
})
