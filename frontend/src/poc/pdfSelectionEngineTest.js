import './pdfSelectionEngineTest.css'
import { EMBEDPDF_PDFIUM_WASM_URL } from '../components/reader/embedpdf/embedPdfAssets'
import {
  buildExportReport,
  createEmptyResults,
  normalizeResults,
  RESULT_OPTIONS,
  summarizeResults,
  TEST_CASES,
} from './pdfSelectionEngineTestModel.js'

const DEFAULT_PDF_URL = '/poc/sthelar-selection-test.pdf'
const STORAGE_KEY = 'xk-pdf-selection-engine-test-v1'
const root = document.getElementById('selection-engine-test-root')

let currentSource = DEFAULT_PDF_URL
let currentSourceLabel = DEFAULT_PDF_URL
let currentObjectUrl = ''
let pdfiumViewer = null
let embedPdfModulePromise = null
let results = loadStoredResults()

root.innerHTML = `
  <main class="engine-test-shell">
    <header class="engine-test-header">
      <div>
        <div class="engine-test-eyebrow">隔离实验 · 不影响正式阅读器</div>
        <h1>PDF 文字选区引擎对比</h1>
        <p>同一份 PDF 左右各选一次，再记录“准确 / 多选 / 少选 / 跳栏 / 失败”。</p>
      </div>
      <div class="engine-test-version">PDFium 候选固定为 EmbedPDF 2.15.0</div>
    </header>

    <section class="engine-test-controls" aria-label="测试 PDF">
      <label class="engine-test-field engine-test-url-field">
        <span>PDF 地址</span>
        <input data-url-input value="${DEFAULT_PDF_URL}" spellcheck="false" />
      </label>
      <button class="engine-test-button engine-test-button-primary" data-load-url>载入同一份 PDF</button>
      <label class="engine-test-file-button">
        <input data-file-input type="file" accept="application/pdf,.pdf" />
        选择本地 PDF
      </label>
      <label class="engine-test-field engine-test-zoom-field">
        <span>本轮缩放记录</span>
        <select data-zoom-label>
          <option>100%</option>
          <option selected>150%</option>
          <option>200%</option>
          <option>其他</option>
        </select>
      </label>
      <div class="engine-test-source" data-source-label title="${DEFAULT_PDF_URL}">${DEFAULT_PDF_URL}</div>
    </section>

    <section class="engine-grid" aria-label="选区引擎并排比较">
      <article class="engine-card">
        <div class="engine-card-header">
          <div>
            <span class="engine-index">A</span>
            <strong>PDF.js 原生文字层</strong>
            <small>浏览器原生选区基准，不是当前正式选区</small>
          </div>
          <span class="engine-status" data-pdfjs-status>准备中</span>
        </div>
        <iframe
          class="engine-frame"
          data-pdfjs-frame
          src="/poc/pdfjs-native-selection.html?embedded=1"
          title="PDF.js 原生文字选区基准"
        ></iframe>
      </article>

      <article class="engine-card">
        <div class="engine-card-header">
          <div>
            <span class="engine-index engine-index-candidate">B</span>
            <strong>PDFium / WASM</strong>
            <small>免费候选，使用 EmbedPDF 稳定版</small>
          </div>
          <span class="engine-status" data-pdfium-status>等待载入</span>
        </div>
        <div class="engine-viewer" data-pdfium-host>
          <div class="engine-placeholder">正在载入 PDFium/WASM 组件…</div>
        </div>
      </article>
    </section>

    <section class="score-card">
      <div class="score-heading">
        <div>
          <h2>统一动作与结果记录</h2>
          <p>每项建议重复 3 次；这里记录总体表现。结果自动保存在本机浏览器。</p>
        </div>
        <div class="score-actions">
          <button class="engine-test-button" data-reset>清空记录</button>
          <button class="engine-test-button engine-test-button-primary" data-export>导出 JSON</button>
        </div>
      </div>

      <div class="score-table-wrap">
        <table class="score-table">
          <thead>
            <tr>
              <th>测试动作</th>
              <th>操作要求</th>
              <th>PDF.js 原生</th>
              <th>PDFium/WASM</th>
            </tr>
          </thead>
          <tbody>
            ${TEST_CASES.map((testCase, index) => `
              <tr>
                <td><span class="case-number">${index + 1}</span><strong>${testCase.name}</strong></td>
                <td>${testCase.instruction}</td>
                <td>${renderResultSelect(testCase.id, 'pdfjs-native')}</td>
                <td>${renderResultSelect(testCase.id, 'pdfium-wasm')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="score-footer">
        <label class="engine-test-field score-notes">
          <span>现象备注</span>
          <textarea data-notes rows="3" placeholder="例如：左栏拖到行末时突然跳入右栏；反向拖动稳定……"></textarea>
        </label>
        <div class="score-summary" data-summary></div>
      </div>
    </section>
  </main>
`

const urlInput = root.querySelector('[data-url-input]')
const loadUrlButton = root.querySelector('[data-load-url]')
const fileInput = root.querySelector('[data-file-input]')
const zoomLabel = root.querySelector('[data-zoom-label]')
const sourceLabel = root.querySelector('[data-source-label]')
const pdfJsFrame = root.querySelector('[data-pdfjs-frame]')
const pdfJsStatus = root.querySelector('[data-pdfjs-status]')
const pdfiumHost = root.querySelector('[data-pdfium-host]')
const pdfiumStatus = root.querySelector('[data-pdfium-status]')
const notes = root.querySelector('[data-notes]')
const summary = root.querySelector('[data-summary]')

function renderResultSelect(caseId, engineId) {
  return `
    <select class="result-select" data-result-select data-case-id="${caseId}" data-engine-id="${engineId}">
      ${RESULT_OPTIONS.map((option) => `
        <option value="${option.value}" ${results[caseId][engineId] === option.value ? 'selected' : ''}>${option.label}</option>
      `).join('')}
    </select>
  `
}

function loadStoredResults() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return normalizeResults(stored?.results)
  } catch {
    return createEmptyResults()
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    results,
    notes: notes.value,
    zoomLabel: zoomLabel.value,
  }))
}

function restoreStoredFields() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    notes.value = stored?.notes || ''
    if (['100%', '150%', '200%', '其他'].includes(stored?.zoomLabel)) {
      zoomLabel.value = stored.zoomLabel
    }
  } catch {
    // Corrupt local test data must never block the comparison page.
  }
}

function renderSummary() {
  const counts = summarizeResults(results)
  summary.innerHTML = `
    <div><strong>PDF.js 原生</strong><span>准确 ${counts['pdfjs-native'].exact} / 8</span><span>跳栏 ${counts['pdfjs-native']['column-jump']}</span></div>
    <div><strong>PDFium/WASM</strong><span>准确 ${counts['pdfium-wasm'].exact} / 8</span><span>跳栏 ${counts['pdfium-wasm']['column-jump']}</span></div>
  `
}

function sendPdfToNativeFrame() {
  // Blob URLs cannot be safely transferred through an iframe query string, so the
  // isolated parent and child POCs communicate via a same-origin message.
  pdfJsFrame.contentWindow?.postMessage({
    type: 'pdf-selection-poc:load',
    url: currentSource,
  }, window.location.origin)
}

async function getEmbedPdfModule() {
  if (!embedPdfModulePromise) {
    // Use the pinned local package so the same test also proves that the viewer
    // and PDFium WASM work without reaching EmbedPDF's CDN.
    embedPdfModulePromise = import('@embedpdf/snippet')
  }
  return embedPdfModulePromise
}

async function loadPdfiumViewer(source) {
  pdfiumStatus.textContent = '载入组件…'
  pdfiumStatus.className = 'engine-status is-loading'
  pdfiumHost.innerHTML = '<div class="engine-placeholder">正在载入 PDFium/WASM 组件…</div>'

  try {
    const module = await getEmbedPdfModule()

    // Removing the previous custom element triggers its disconnected cleanup. A new
    // host also prevents old document state from leaking into the next test file.
    pdfiumHost.replaceChildren()
    const target = document.createElement('div')
    target.className = 'engine-viewer-target'
    pdfiumHost.append(target)
    pdfiumViewer = module.default.init({
      type: 'container',
      target,
      src: source,
      wasmUrl: EMBEDPDF_PDFIUM_WASM_URL,
      worker: false,
      log: false,
      fonts: { ui: null, signature: null },
    })

    await pdfiumViewer.registry
    pdfiumStatus.textContent = '已就绪'
    pdfiumStatus.className = 'engine-status is-ready'
  } catch (error) {
    pdfiumViewer = null
    pdfiumStatus.textContent = '载入失败'
    pdfiumStatus.className = 'engine-status is-error'
    pdfiumHost.innerHTML = `
      <div class="engine-error">
        <strong>PDFium/WASM 组件未能载入</strong>
        <span>${escapeHtml(error?.message || '请检查网络后重试。')}</span>
        <button class="engine-test-button" data-retry-pdfium>重试</button>
      </div>
    `
    pdfiumHost.querySelector('[data-retry-pdfium]')?.addEventListener('click', () => {
      embedPdfModulePromise = null
      void loadPdfiumViewer(currentSource)
    })
  }
}

function escapeHtml(value) {
  const node = document.createElement('div')
  node.textContent = value
  return node.innerHTML
}

function updateSourceDisplay(label) {
  currentSourceLabel = label
  sourceLabel.textContent = label
  sourceLabel.title = label
}

function revokeCurrentObjectUrl() {
  if (!currentObjectUrl) return
  URL.revokeObjectURL(currentObjectUrl)
  currentObjectUrl = ''
}

function loadSharedSource(source, label) {
  currentSource = source
  updateSourceDisplay(label)
  pdfJsStatus.textContent = '载入中'
  sendPdfToNativeFrame()
  void loadPdfiumViewer(source)
}

loadUrlButton.addEventListener('click', () => {
  const value = urlInput.value.trim()
  if (!value) return
  revokeCurrentObjectUrl()
  loadSharedSource(value, value)
})

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadUrlButton.click()
})

fileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  revokeCurrentObjectUrl()
  currentObjectUrl = URL.createObjectURL(file)
  loadSharedSource(currentObjectUrl, file.name)
})

root.addEventListener('change', (event) => {
  const select = event.target.closest('[data-result-select]')
  if (select) {
    results[select.dataset.caseId][select.dataset.engineId] = select.value
    persistState()
    renderSummary()
    return
  }
  if (event.target === zoomLabel) persistState()
})

notes.addEventListener('input', persistState)

root.querySelector('[data-reset]').addEventListener('click', () => {
  results = createEmptyResults()
  notes.value = ''
  root.querySelectorAll('[data-result-select]').forEach((select) => {
    select.value = 'pending'
  })
  persistState()
  renderSummary()
})

root.querySelector('[data-export]').addEventListener('click', () => {
  const report = buildExportReport({
    sourceLabel: currentSourceLabel,
    zoomLabel: zoomLabel.value,
    notes: notes.value,
    results,
  })
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `pdf-selection-engine-test-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
})

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== pdfJsFrame.contentWindow) return
  if (event.data?.type === 'pdf-selection-poc:ready') {
    pdfJsStatus.textContent = '已就绪'
    pdfJsStatus.className = 'engine-status is-ready'
    sendPdfToNativeFrame()
  }
  if (event.data?.type === 'pdf-selection-poc:status') {
    pdfJsStatus.textContent = event.data.message
    pdfJsStatus.className = `engine-status ${event.data.ready ? 'is-ready' : 'is-loading'}`
  }
})

window.addEventListener('beforeunload', revokeCurrentObjectUrl)

restoreStoredFields()
renderSummary()
void loadPdfiumViewer(currentSource)
