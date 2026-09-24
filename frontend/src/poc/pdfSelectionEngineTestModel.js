export const ENGINE_IDS = ['pdfjs-native', 'pdfium-wasm']

export const RESULT_OPTIONS = [
  { value: 'pending', label: '未测试' },
  { value: 'exact', label: '准确' },
  { value: 'over', label: '多选' },
  { value: 'under', label: '少选' },
  { value: 'column-jump', label: '跳栏' },
  { value: 'failed', label: '失败' },
]

export const TEST_CASES = [
  { id: 'word', name: '单词', instruction: '只选中一个英文单词' },
  { id: 'sentence', name: '完整句子', instruction: '从句首拖到句号' },
  { id: 'reverse', name: '反向拖动', instruction: '从句尾向句首拖动' },
  { id: 'multiline', name: '连续三行', instruction: '精确选择连续 3 行' },
  { id: 'two-column', name: '双栏边界', instruction: '左栏向下选取，不进入右栏' },
  { id: 'hyphen', name: '断词', instruction: '选取带行末连字符的单词' },
  { id: 'citation', name: '引用/上标', instruction: '选取带上标引用的短句' },
  { id: 'blank-release', name: '空白收尾', instruction: '在文字右侧或下方空白处松开' },
]

const VALID_RESULTS = new Set(RESULT_OPTIONS.map((option) => option.value))

export function createEmptyResults() {
  return Object.fromEntries(TEST_CASES.map((testCase) => [
    testCase.id,
    Object.fromEntries(ENGINE_IDS.map((engineId) => [engineId, 'pending'])),
  ]))
}

export function normalizeResults(value) {
  const empty = createEmptyResults()
  if (!value || typeof value !== 'object') return empty

  for (const testCase of TEST_CASES) {
    for (const engineId of ENGINE_IDS) {
      const result = value?.[testCase.id]?.[engineId]
      if (VALID_RESULTS.has(result)) empty[testCase.id][engineId] = result
    }
  }
  return empty
}

export function summarizeResults(results) {
  const normalized = normalizeResults(results)
  return Object.fromEntries(ENGINE_IDS.map((engineId) => {
    const summary = Object.fromEntries(RESULT_OPTIONS.map((option) => [option.value, 0]))
    for (const testCase of TEST_CASES) summary[normalized[testCase.id][engineId]] += 1
    return [engineId, summary]
  }))
}

export function buildExportReport({ sourceLabel, zoomLabel, notes, results }) {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceLabel: String(sourceLabel || ''),
    zoomLabel: String(zoomLabel || ''),
    notes: String(notes || ''),
    engines: {
      'pdfjs-native': 'PDF.js native text layer',
      'pdfium-wasm': 'EmbedPDF 2.15.0 / PDFium WASM',
    },
    cases: TEST_CASES,
    results: normalizeResults(results),
    summary: summarizeResults(results),
  }
}

