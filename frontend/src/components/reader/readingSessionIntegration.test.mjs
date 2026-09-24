import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../../app/App.jsx', import.meta.url), 'utf8')
const readerSource = readFileSync(new URL('../../hooks/usePdfReader.js', import.meta.url), 'utf8')
const paperReaderSource = readFileSync(new URL('./PaperReader.jsx', import.meta.url), 'utf8')

test('restores reader page and zoom through the reading session storage module', () => {
  assert.match(readerSource, /readReadingSessionSnapshot/)
  assert.match(readerSource, /saveReadingSessionSnapshot/)
  assert.match(readerSource, /pageNumber:\s*restoredSession\?\.pageNumber/)
  assert.match(readerSource, /scale:\s*restoredSession\?\.scale/)
})

test('persists workspace panel state from the app shell per active paper', () => {
  assert.match(appSource, /readReadingSessionSnapshot/)
  assert.match(appSource, /saveReadingSessionSnapshot/)
  assert.match(appSource, /activeWorkspacePanel/)
  assert.match(appSource, /workspacePanel\.width/)
})

test('keeps every open PDFium tab mounted and isolates inactive readers', () => {
  assert.match(appSource, /readerSessionTabs/)
  assert.match(appSource, /readerSessionTabs\.map/)
  assert.match(appSource, /is-kept-alive/)
  assert.match(appSource, /key=\{`paper-reader-session:\$\{paper\.id\}`\}/)
  assert.match(appSource, /inert=\{!isActiveSession\}/)
})

test('keeps the reader stack mounted while the instant-insight panel is toggled', () => {
  assert.match(appSource, /isInsightPanelCollapsed/)
  assert.match(appSource, /setIsInsightPanelCollapsed\(true\)/)
  assert.match(appSource, /Keep the portal mounted so hiding the sidebar never dismisses a follow translation/)
})

test('persists confirmed PDFium page and zoom state per paper', () => {
  assert.match(readerSource, /syncPdfiumReaderState/)
  assert.match(readerSource, /requestedPage/)
  assert.match(readerSource, /requestedScale/)
  assert.match(readerSource, /setPapers\(\(currentPapers\)/)
  assert.match(appSource, /onPdfiumViewerState=\{isActiveSession \? syncPdfiumReaderState : undefined\}/)
})

test('restores a newly mounted PDFium tab from the saved session snapshot', () => {
  assert.match(paperReaderSource, /readReadingSessionSnapshot/)
  assert.match(paperReaderSource, /preparedPdfiumRestoreKeyRef/)
  assert.match(paperReaderSource, /isActive = true/)
  assert.match(paperReaderSource, /Reset the preparation marker while hidden/)
  assert.match(paperReaderSource, /Child effects in PDFium publish page one/)
  assert.match(paperReaderSource, /savedSession\?\.pageNumber \|\| pdfReader\.pageNumber/)
  assert.match(paperReaderSource, /savedSession\?\.scale \|\| pdfReader\.scale/)
})

test('guards a reopened PDFium tab against its delayed page-one layout reset', () => {
  assert.match(paperReaderSource, /expiresAt: Date\.now\(\) \+ 2800/)
  assert.match(paperReaderSource, /PDFium can apply a second layout after reporting the requested page/)
  assert.match(paperReaderSource, /onViewerNavigationIntent=\{handleEmbedUserNavigation\}/)
  assert.match(paperReaderSource, /Pointer, wheel, and keyboard navigation are explicit user intent/)
})
