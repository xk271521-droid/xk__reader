import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DESKTOP_DOWNLOAD_FILENAME,
  DESKTOP_DOWNLOAD_LABEL,
  DESKTOP_DOWNLOAD_TITLE,
  DESKTOP_DOWNLOAD_URL,
} from './desktopDownload.js'

test('desktop download config points to the generated Windows package', () => {
  assert.equal(DESKTOP_DOWNLOAD_LABEL, '下载桌面端')
  assert.equal(DESKTOP_DOWNLOAD_TITLE, '下载 XK 阅读 Windows 桌面端')
  assert.equal(DESKTOP_DOWNLOAD_FILENAME, 'xk-reader-desktop-windows.zip')
  assert.equal(DESKTOP_DOWNLOAD_URL, '/downloads/xk-reader-desktop-windows.zip')
})
