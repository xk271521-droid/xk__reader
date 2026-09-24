import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./PdfToolbar.jsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('./readerToolbarLayout.css', import.meta.url), 'utf8')

test('keeps every reader tool visible without a category collection', () => {
  for (const toolId of [
    'select',
    'highlight',
    'strikeout',
    'underline',
    'squiggly',
    'ink',
    'ink_highlighter',
    'comment',
    'text',
    'line',
    'arrow',
    'rect',
    'circle',
    'pin',
    'screenshot',
  ]) {
    assert.match(source, new RegExp(`id: '${toolId}'`))
  }
  assert.match(source, /\{toolItems\.map\(\(item\) => \{/)
  assert.doesNotMatch(source, /toolbar-category-tabs/)
  assert.doesNotMatch(source, /toolCategories/)
  assert.doesNotMatch(source, /activeCategory/)
  assert.doesNotMatch(source, /SELECT_CATEGORY_TOOL_IDS/)
  assert.doesNotMatch(source, /category:/)
  assert.match(source, /MARKUP_TOOL_IDS\.includes\(activeTool\)/)
  assert.match(source, /isShapeToolActive \? \(/)
})

test('keeps all reader controls in one compact toolbar row', () => {
  assert.match(source, /import '\.\/readerToolbarLayout\.css'/)
  assert.match(layoutSource, /display: flex/)
  assert.match(layoutSource, /height: 38px/)
  assert.doesNotMatch(layoutSource, /toolbar-category-tab/)
  assert.doesNotMatch(layoutSource, /toolbar-category-tabs/)
  assert.match(layoutSource, /\.toolbar-group--tools[\s\S]*?order: 2/)
  assert.match(layoutSource, /\.toolbar-group--tool-options[\s\S]*?order: 4/)
  assert.match(layoutSource, /\.toolbar-tool\.is-active::after/)
  assert.match(layoutSource, /border-radius: 0/)
})

test('keeps eraser in the first-row quick actions and exposes shared markup styling', () => {
  assert.match(source, /className="toolbar-quick-actions"/)
  assert.match(source, /fullTranslateVisible \? \(/)
  assert.match(source, /toolbar-tool--full-translate/)
  assert.match(source, /MARKUP_TOOL_IDS\.includes\(activeTool\)/)
  assert.match(source, /aria-label="批注样式"/)
  assert.match(source, /MARKUP_COLOR_PALETTE/)
  assert.match(source, /activeTool === 'ink_highlighter'/)
})

test('does not show a fabricated percentage while full-PDF translation has no real progress event', () => {
  assert.match(source, /: '正在保版翻译…'/)
  assert.match(source, /fullTranslateProgress > 0/)
})

test('keeps the real full-translation progress ring visible in compact mode', () => {
  assert.match(layoutSource, /toolbar-quick-actions \.toolbar-tool > span:not\(\.toolbar-progress-ring\)/)
  assert.doesNotMatch(layoutSource, /toolbar-quick-actions \.toolbar-tool > span,/) 
})
