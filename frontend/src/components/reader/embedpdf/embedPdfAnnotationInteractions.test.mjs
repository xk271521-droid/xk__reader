import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const viewportSource = await readFile(new URL('./EmbedPdfViewport.jsx', import.meta.url), 'utf8')
const captureSource = await readFile(new URL('./EmbedPdfCaptureTools.jsx', import.meta.url), 'utf8')
const viewportStyles = await readFile(new URL('./embedPdfViewport.css', import.meta.url), 'utf8')

test('annotation menu keeps selection alive and deletes with the layer page index', () => {
  assert.match(viewportSource, /onPointerDown=\{stopMenuPointer\}/)
  assert.match(
    viewportSource,
    /deleteAnnotation\(context\.pageIndex, annotation\.id\)/,
  )
  assert.doesNotMatch(
    viewportSource,
    /deleteAnnotation\(context\.annotation\.object\.pageIndex/,
  )
})

test('text comments expose an editor and persist their contents', () => {
  assert.match(viewportSource, /toolId === 'textComment'/)
  assert.match(viewportSource, /placeholder="输入评论内容"/)
  assert.match(viewportSource, /contents: commentText\.trim\(\)/)
  assert.match(viewportSource, /pointerEvents: 'auto'/)
  assert.match(viewportSource, /zIndex: 100/)
})

test('ink highlighter stays on vector rendering after pointerup', () => {
  assert.match(viewportSource, /id: 'inkHighlighter'/)
  assert.match(viewportSource, /useAppearanceStream: false/)
  assert.match(viewportSource, /strokeWidth: markupOptions\.strokeWidth/)
})

test('pinned screenshot image follows its resized container', () => {
  assert.match(captureSource, /className="pdf-pinned-shot__image"/)
  assert.match(captureSource, /currentItem\.width \* multiplier/)
})

test('selection visuals hide PDFium outlier rectangles and use the compact palette', () => {
  assert.match(viewportSource, /filterSafeSelectionRects\(rects, page\?\.size\)/)
  assert.match(viewportSource, /textStyle=\{\{ background: 'transparent' \}\}/)
  assert.match(viewportSource, /QUICK_MARKUP_COLOR_PALETTE\.map/)
})

test('PDFium pages suppress browser-native image selection without blocking editors', () => {
  assert.match(viewportStyles, /\.embedpdf-page\s*\{[\s\S]*?user-select:\s*none/)
  assert.match(viewportStyles, /\.embedpdf-page \*::selection\s*\{[\s\S]*?background:\s*transparent/)
  assert.match(viewportStyles, /\.embedpdf-page textarea[\s\S]*?user-select:\s*text/)
})
