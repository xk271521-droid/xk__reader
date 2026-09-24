import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./FullTranslationReader.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./FullTranslationReader.css', import.meta.url), 'utf8')

test('full translation can switch to a translation-only reading surface', () => {
  assert.match(source, /const \[isTranslationOnly, setIsTranslationOnly\] = useState\(false\)/)
  assert.match(source, /isTranslationOnly \? '返回双屏' : '只看译文'/)
  assert.match(source, /full-translation-pdf-split\$\{isTranslationOnly \? ' is-translation-only' : ''\}/)
  assert.match(source, /!isTranslationOnly \? \(/)
})

test('gives both PDFium panes an actual flexible viewport height', () => {
  assert.match(source, /import '\.\/FullTranslationReader\.css'/)
  assert.match(styles, /\.full-translation-pdf-split\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(styles, /\.full-translation-pdf-pane\s*\{[\s\S]*?min-height:\s*0[\s\S]*?display:\s*flex/)
  assert.match(styles, /> \.embedpdf-reader-shell,[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0/)
})
