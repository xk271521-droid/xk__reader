const READING_SESSION_STORAGE_KEY = 'xk_reader_sessions_v1'
const READING_SESSION_VERSION = 1
const DEFAULT_PAGE_NUMBER = 1
const DEFAULT_SCALE = 1.35
const MIN_SCALE = 0.9
const MAX_SCALE = 4
const DEFAULT_WORKSPACE_WIDTH = 380
const MIN_WORKSPACE_WIDTH = 300
const MAX_WORKSPACE_WIDTH = 620
const MAX_SESSION_COUNT = 200
const VALID_WORKSPACE_PANELS = new Set(['', 'info', 'notes', 'ask', 'summary'])

function getStorage(storage) {
  if (storage) return storage
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback))
}

function normalizePaperId(paperId) {
  return String(paperId || '').trim()
}

function normalizePanel(value) {
  const panel = String(value || '').trim()
  return VALID_WORKSPACE_PANELS.has(panel) ? panel : ''
}

function readStore(storage) {
  const target = getStorage(storage)
  if (!target) return { version: READING_SESSION_VERSION, sessions: {} }
  try {
    const parsed = JSON.parse(target.getItem(READING_SESSION_STORAGE_KEY) || '{}')
    return {
      version: READING_SESSION_VERSION,
      sessions: parsed && typeof parsed.sessions === 'object' && parsed.sessions ? parsed.sessions : {},
    }
  } catch {
    return { version: READING_SESSION_VERSION, sessions: {} }
  }
}

function writeStore(store, storage) {
  const target = getStorage(storage)
  if (!target) return
  target.setItem(READING_SESSION_STORAGE_KEY, JSON.stringify({
    version: READING_SESSION_VERSION,
    sessions: store.sessions || {},
  }))
}

function getLimits(options = {}) {
  return {
    minScale: Number(options.minScale) || MIN_SCALE,
    maxScale: Number(options.maxScale) || MAX_SCALE,
    minWorkspaceWidth: Number(options.minWorkspaceWidth) || MIN_WORKSPACE_WIDTH,
    maxWorkspaceWidth: Number(options.maxWorkspaceWidth) || MAX_WORKSPACE_WIDTH,
    maxSessionCount: Number(options.maxSessionCount) || MAX_SESSION_COUNT,
    totalPages: Number(options.totalPages) || 0,
  }
}

export function createMemoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null
    },
    setItem(key, value) {
      entries.set(key, String(value))
    },
    removeItem(key) {
      entries.delete(key)
    },
  }
}

export function normalizeReadingSessionSnapshot(patch = {}, existing = {}, options = {}) {
  const limits = getLimits({
    ...options,
    totalPages: options.totalPages || patch.totalPages || existing.totalPages,
  })
  const merged = { ...existing, ...patch }
  const pageMax = limits.totalPages > 0
    ? limits.totalPages
    : Math.max(DEFAULT_PAGE_NUMBER, Number(existing.pageNumber) || DEFAULT_PAGE_NUMBER, Number(patch.pageNumber) || DEFAULT_PAGE_NUMBER)

  return {
    version: READING_SESSION_VERSION,
    pageNumber: clampInteger(merged.pageNumber, DEFAULT_PAGE_NUMBER, pageMax, DEFAULT_PAGE_NUMBER),
    scale: clampNumber(merged.scale, limits.minScale, limits.maxScale, DEFAULT_SCALE),
    activeWorkspacePanel: normalizePanel(merged.activeWorkspacePanel),
    workspaceWidth: clampInteger(
      merged.workspaceWidth,
      limits.minWorkspaceWidth,
      limits.maxWorkspaceWidth,
      DEFAULT_WORKSPACE_WIDTH,
    ),
    updatedAt: Number.isFinite(Number(merged.updatedAt)) ? Number(merged.updatedAt) : Date.now(),
  }
}

export function readReadingSessionSnapshot(paperId, storage, options = {}) {
  const id = normalizePaperId(paperId)
  if (!id) return null
  const store = readStore(storage)
  const session = store.sessions[id]
  if (!session) return null
  return normalizeReadingSessionSnapshot({}, session, options)
}

export function saveReadingSessionSnapshot(paperId, patch = {}, storage, options = {}) {
  const id = normalizePaperId(paperId)
  if (!id) return null
  const store = readStore(storage)
  const previous = store.sessions[id] || {}
  const next = normalizeReadingSessionSnapshot(
    { ...patch, updatedAt: Date.now() },
    previous,
    options,
  )
  store.sessions[id] = next

  const limits = getLimits(options)
  const sorted = Object.entries(store.sessions)
    .sort(([, left], [, right]) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, limits.maxSessionCount)
  store.sessions = Object.fromEntries(sorted)
  writeStore(store, storage)
  return next
}

export function removeReadingSessionSnapshot(paperId, storage) {
  const id = normalizePaperId(paperId)
  if (!id) return
  const store = readStore(storage)
  if (!(id in store.sessions)) return
  delete store.sessions[id]
  writeStore(store, storage)
}
