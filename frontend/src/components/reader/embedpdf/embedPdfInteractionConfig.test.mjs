import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./EmbedPdfViewport.jsx', import.meta.url), 'utf8')

test('keeps touch-capable devices in text-selection mode by default', () => {
  assert.match(source, /createPluginRegistration\(PanPluginPackage, \{ defaultMode: 'never' \}\)/)
  assert.match(source, /selectionCapability\.enableForMode\('pointerMode'/)
})

test('exposes deterministic restore controls for page and zoom state', () => {
  assert.match(source, /setZoom: \(zoomLevel\) => zoomScope\.requestZoom\(zoomLevel\)/)
  assert.match(source, /scrollToPage: \(pageNumber\) => scrollScope\.scrollToPage/)
})
