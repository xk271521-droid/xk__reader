function normalizeSelectionText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export const TRANSLATION_PROVIDERS = Object.freeze({
  BAIDU: 'baidu',
  TENCENT: 'tencent',
  SILICONFLOW_GLM4: 'siliconflow_glm4',
  SILICONFLOW_QWEN3: 'siliconflow_qwen3',
  SILICONFLOW_GLMZ1: 'siliconflow_glmz1',
  SILICONFLOW_HUNYUAN: 'siliconflow_hunyuan',
})

const TRANSLATION_PROVIDER_VALUES = new Set(Object.values(TRANSLATION_PROVIDERS))

export function normalizeTranslationProvider(value) {
  return TRANSLATION_PROVIDER_VALUES.has(value)
    ? value
    : TRANSLATION_PROVIDERS.BAIDU
}

export function buildSelectionRequestKey(selectionPayload) {
  if (!selectionPayload?.text) return ''
  const anchor = selectionPayload.anchorRect
  return [
    normalizeSelectionText(selectionPayload.text),
    selectionPayload.pageNumber || 0,
    selectionPayload.startChar ?? '',
    selectionPayload.endChar ?? '',
    anchor?.origin?.x ?? '',
    anchor?.origin?.y ?? '',
    anchor?.size?.width ?? '',
    anchor?.size?.height ?? '',
  ].join('|')
}
