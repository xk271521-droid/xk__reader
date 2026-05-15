const UI_PREFERENCES_STORAGE_PREFIX = 'xk_reader_ui_preferences'

export const UI_FONT_SIZE_MIN = 100
export const UI_FONT_SIZE_MAX = 130
export const UI_FONT_SIZE_STEP = 5
export const UI_FONT_SIZE_DEFAULT = 110

const DEFAULT_UI_PREFERENCES = {
  fontSize: UI_FONT_SIZE_DEFAULT,
}

function buildStorageKey(userId) {
  return `${UI_PREFERENCES_STORAGE_PREFIX}:${userId || 'guest'}`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeUiFontSize(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return UI_FONT_SIZE_DEFAULT
  }
  return clamp(Math.round(numericValue), UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX)
}

export function getStoredUiPreferences(userId) {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(buildStorageKey(userId))
    if (!raw) {
      return DEFAULT_UI_PREFERENCES
    }

    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_UI_PREFERENCES,
      ...parsed,
      fontSize: normalizeUiFontSize(parsed?.fontSize),
    }
  } catch {
    return DEFAULT_UI_PREFERENCES
  }
}

export function storeUiPreferences(userId, preferences) {
  if (typeof window === 'undefined') {
    return
  }

  const nextPreferences = {
    ...DEFAULT_UI_PREFERENCES,
    ...preferences,
    fontSize: normalizeUiFontSize(preferences?.fontSize),
  }

  window.localStorage.setItem(buildStorageKey(userId), JSON.stringify(nextPreferences))
}

export function getUiFontScale(fontSize) {
  return normalizeUiFontSize(fontSize) / 100
}

export function getUiTopbarScale(fontSize) {
  const ratio = normalizeUiFontSize(fontSize) / 100
  return 1 + (ratio - 1) * 0.8
}

export function formatUiFontSizeLabel(fontSize) {
  return `${normalizeUiFontSize(fontSize)}%`
}
