import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearRememberedLogin,
  clearStoredAuthToken,
  getRememberedLogin,
  getStoredAuthToken,
  storeAuthToken,
  storeRememberedLogin,
} from './authApi.js'

function createMemoryStorage() {
  const items = new Map()
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    clear: () => items.clear(),
  }
}

function installStorage() {
  const previousWindow = globalThis.window
  const localStorage = createMemoryStorage()
  const sessionStorage = createMemoryStorage()
  globalThis.window = { localStorage, sessionStorage }
  return {
    localStorage,
    sessionStorage,
    restore: () => {
      if (previousWindow === undefined) {
        delete globalThis.window
        return
      }
      globalThis.window = previousWindow
    },
  }
}

test('auth token storage respects the remember me choice', () => {
  const storage = installStorage()
  try {
    storeAuthToken('remembered-token')
    assert.equal(storage.localStorage.getItem('xk_reader_auth_token'), 'remembered-token')
    assert.equal(storage.sessionStorage.getItem('xk_reader_auth_token'), null)
    assert.equal(getStoredAuthToken(), 'remembered-token')

    storeAuthToken('session-token', { remember: false })
    assert.equal(storage.localStorage.getItem('xk_reader_auth_token'), null)
    assert.equal(storage.sessionStorage.getItem('xk_reader_auth_token'), 'session-token')
    assert.equal(getStoredAuthToken(), 'session-token')

    clearStoredAuthToken()
    assert.equal(getStoredAuthToken(), '')
  } finally {
    storage.restore()
  }
})

test('remembered login stores the account only when enabled', () => {
  const storage = installStorage()
  try {
    assert.deepEqual(getRememberedLogin(), { account: '', remember: false })

    storeRememberedLogin({ account: ' xk@example.com ', remember: true })
    assert.deepEqual(getRememberedLogin(), { account: 'xk@example.com', remember: true })

    storeRememberedLogin({ account: 'xk@example.com', remember: false })
    assert.deepEqual(getRememberedLogin(), { account: '', remember: false })

    storeRememberedLogin({ account: 'xk@example.com', remember: true })
    clearRememberedLogin()
    assert.deepEqual(getRememberedLogin(), { account: '', remember: false })
  } finally {
    storage.restore()
  }
})
