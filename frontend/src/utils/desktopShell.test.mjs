import assert from 'node:assert/strict'
import test from 'node:test'

import { isDesktopShell } from './desktopShell.js'

test('isDesktopShell is false outside browser-like environments', () => {
  const previousWindow = globalThis.window

  try {
    delete globalThis.window

    assert.equal(isDesktopShell(), false)
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})

test('isDesktopShell accepts preload and server injected desktop markers', () => {
  const previousWindow = globalThis.window

  try {
    globalThis.window = {}
    assert.equal(isDesktopShell(), false)

    globalThis.window = { paperDesktop: { platform: 'win32' } }
    assert.equal(isDesktopShell(), true)

    globalThis.window = { __PAPER_READER_DESKTOP__: true }
    assert.equal(isDesktopShell(), true)
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})
