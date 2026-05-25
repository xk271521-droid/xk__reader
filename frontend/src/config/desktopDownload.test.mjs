import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DESKTOP_DOWNLOAD_FILENAME,
  DESKTOP_DOWNLOAD_LABEL,
  DESKTOP_DOWNLOAD_TITLE,
  DESKTOP_DOWNLOAD_URL,
} from './desktopDownload.js'

test('desktop download config points to the generated Windows package', () => {
  assert.equal(DESKTOP_DOWNLOAD_LABEL, '\u4e0b\u8f7d\u684c\u9762\u7aef')
  assert.equal(DESKTOP_DOWNLOAD_TITLE, '\u4e0b\u8f7d XK \u9605\u8bfb Windows \u5b89\u88c5\u7a0b\u5e8f')
  assert.equal(DESKTOP_DOWNLOAD_FILENAME, 'xk-reader-setup.exe')
  assert.equal(DESKTOP_DOWNLOAD_URL, '/downloads/xk-reader-setup.exe')
})
