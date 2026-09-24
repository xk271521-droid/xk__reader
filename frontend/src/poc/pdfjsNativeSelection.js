import 'pdfjs-dist/web/pdf_viewer.css'
import './pdfjsNativeSelection.css'
import { createPdfLoadingTask, loadPdfJs } from '../services/pdfjsClient'

const query = new URLSearchParams(window.location.search)
const DEFAULT_PDF_URL = query.get('pdf') || '/poc/sthelar-selection-test.pdf'
const IS_EMBEDDED = query.get('embedded') === '1'
const SCALE_PRESETS = [
  { label: '90%', value: 0.9 },
  { label: '110%', value: 1.1 },
  { label: '130%', value: 1.3 },
  { label: '150%', value: 1.5 },
  { label: '170%', value: 1.7 },
]

const root = document.getElementById('selection-poc-root')

if (IS_EMBEDDED) document.body.classList.add('poc-embedded')

let activeLoadToken = 0
let activeSource = { kind: 'url', value: DEFAULT_PDF_URL }
let activeScale = 1.3
const pageViews = new Map()

root.innerHTML = `
  <main class="poc-shell">
    <section class="poc-viewer">
      <div class="poc-header">
        <h1 class="poc-title">PDF Selection POC</h1>
        <div class="poc-status" data-status>Idle</div>
      </div>
      <div class="poc-pages" data-pages>
        <div class="poc-empty">Load a PDF to test native browser text selection.</div>
      </div>
    </section>
    <aside class="poc-sidebar">
      <div class="poc-controls">
        <label class="poc-field">
          <span>PDF URL</span>
          <div class="poc-input-row">
            <input class="poc-input" data-url-input value="${DEFAULT_PDF_URL}" />
            <button class="poc-btn" data-load-url>Load</button>
          </div>
        </label>
        <label class="poc-field">
          <span>Local PDF</span>
          <input class="poc-file" data-file-input type="file" accept="application/pdf,.pdf" />
        </label>
        <label class="poc-field">
          <span>Scale</span>
          <select class="poc-select" data-scale-select>
            ${SCALE_PRESETS.map((item) => `
              <option value="${item.value}" ${item.value === activeScale ? 'selected' : ''}>${item.label}</option>
            `).join('')}
          </select>
        </label>
      </div>

      <section class="poc-panel">
        <div class="poc-panel-title">Selection</div>
        <div class="poc-metrics">
          <div class="poc-metric"><strong data-char-count>0</strong><span>chars</span></div>
          <div class="poc-metric"><strong data-rect-count>0</strong><span>rects</span></div>
          <div class="poc-metric"><strong data-page-count>0</strong><span>pages</span></div>
        </div>
        <pre class="poc-readout" data-text-output></pre>
      </section>

      <section class="poc-panel">
        <div class="poc-panel-title">Rects</div>
        <pre class="poc-readout" data-rect-output></pre>
      </section>
    </aside>
  </main>
`

const statusEl = root.querySelector('[data-status]')
const pagesEl = root.querySelector('[data-pages]')
const urlInput = root.querySelector('[data-url-input]')
const loadUrlButton = root.querySelector('[data-load-url]')
const fileInput = root.querySelector('[data-file-input]')
const scaleSelect = root.querySelector('[data-scale-select]')
const textOutput = root.querySelector('[data-text-output]')
const rectOutput = root.querySelector('[data-rect-output]')
const charCountEl = root.querySelector('[data-char-count]')
const rectCountEl = root.querySelector('[data-rect-count]')
const pageCountEl = root.querySelector('[data-page-count]')

function setStatus(message) {
  statusEl.textContent = message
  if (IS_EMBEDDED && window.parent !== window) {
    window.parent.postMessage({
      type: 'pdf-selection-poc:status',
      message,
      ready: message.startsWith('Ready:'),
    }, window.location.origin)
  }
}

function clearSelectionReadout() {
  textOutput.textContent = ''
  rectOutput.textContent = ''
  charCountEl.textContent = '0'
  rectCountEl.textContent = '0'
  pageCountEl.textContent = '0'
  for (const view of pageViews.values()) {
    view.rectLayer.innerHTML = ''
  }
}

function getRenderScale() {
  return Math.max(1, window.devicePixelRatio || 1)
}

function normalizeRectToPage(rect, pageRect) {
  const left = Math.max(rect.left, pageRect.left)
  const top = Math.max(rect.top, pageRect.top)
  const right = Math.min(rect.right, pageRect.right)
  const bottom = Math.min(rect.bottom, pageRect.bottom)

  if (right <= left || bottom <= top) return null

  return {
    left: (left - pageRect.left) / pageRect.width,
    top: (top - pageRect.top) / pageRect.height,
    width: (right - left) / pageRect.width,
    height: (bottom - top) / pageRect.height,
  }
}

function getPageRectsFromNativeSelection(selection) {
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return []

  const range = selection.getRangeAt(0)
  const nativeRects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)

  const result = []
  for (const [pageNumber, view] of pageViews.entries()) {
    const pageRect = view.frame.getBoundingClientRect()
    const rects = nativeRects
      .map((rect) => normalizeRectToPage(rect, pageRect))
      .filter(Boolean)

    if (rects.length) {
      result.push({ pageNumber, rects })
    }
  }

  return result
}

function drawSelectionRects(rectsByPage) {
  for (const view of pageViews.values()) {
    view.rectLayer.innerHTML = ''
  }

  for (const page of rectsByPage) {
    const view = pageViews.get(page.pageNumber)
    if (!view) continue

    const fragment = document.createDocumentFragment()
    for (const rect of page.rects) {
      const node = document.createElement('div')
      node.className = 'poc-rect'
      node.style.left = `${rect.left * 100}%`
      node.style.top = `${rect.top * 100}%`
      node.style.width = `${rect.width * 100}%`
      node.style.height = `${rect.height * 100}%`
      fragment.append(node)
    }
    view.rectLayer.append(fragment)
  }
}

function updateSelectionReadout() {
  const selection = window.getSelection()
  const text = selection?.toString() || ''
  const rectsByPage = getPageRectsFromNativeSelection(selection)
  const rectCount = rectsByPage.reduce((total, page) => total + page.rects.length, 0)

  drawSelectionRects(rectsByPage)
  textOutput.textContent = text
  rectOutput.textContent = JSON.stringify(rectsByPage, null, 2)
  charCountEl.textContent = String(text.length)
  rectCountEl.textContent = String(rectCount)
  pageCountEl.textContent = String(rectsByPage.length)
}

async function renderPage(pdfDocument, pageNumber, token) {
  if (token !== activeLoadToken) return

  const pdfJs = await loadPdfJs()
  const page = await pdfDocument.getPage(pageNumber)
  if (token !== activeLoadToken) return

  const viewport = page.getViewport({ scale: activeScale })
  const outputScale = getRenderScale()

  const frame = document.createElement('div')
  frame.className = 'poc-page'
  frame.dataset.pageNumber = String(pageNumber)
  frame.style.width = `${viewport.width}px`
  frame.style.height = `${viewport.height}px`

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  const textLayerElement = document.createElement('div')
  textLayerElement.className = 'textLayer'
  textLayerElement.style.width = `${viewport.width}px`
  textLayerElement.style.height = `${viewport.height}px`
  textLayerElement.style.setProperty('--total-scale-factor', activeScale)

  const rectLayer = document.createElement('div')
  rectLayer.className = 'poc-rect-layer'

  const label = document.createElement('div')
  label.className = 'poc-page-label'
  label.textContent = `Page ${pageNumber}`

  frame.append(canvas, textLayerElement, rectLayer, label)
  pagesEl.append(frame)
  pageViews.set(pageNumber, { frame, rectLayer, textLayerElement })

  const canvasContext = canvas.getContext('2d', { alpha: true })
  await page.render({
    canvasContext,
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    background: 'rgba(255, 255, 255, 0)',
  }).promise

  if (token !== activeLoadToken) return

  const textContent = await page.getTextContent()
  if (token !== activeLoadToken) return

  const textLayer = new pdfJs.TextLayer({
    container: textLayerElement,
    textContentSource: textContent,
    viewport,
  })

  await textLayer.render()
}

async function loadPdf(source) {
  const token = activeLoadToken + 1
  activeLoadToken = token
  pageViews.clear()
  clearSelectionReadout()
  pagesEl.innerHTML = ''
  setStatus('Loading PDF...')

  try {
    const loadingTask = await createPdfLoadingTask(source)
    const pdfDocument = await loadingTask.promise
    if (token !== activeLoadToken) return

    setStatus(`Rendering ${pdfDocument.numPages} pages...`)

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      await renderPage(pdfDocument, pageNumber, token)
      if (token !== activeLoadToken) return
      setStatus(`Rendered ${pageNumber}/${pdfDocument.numPages} pages`)
    }

    setStatus(`Ready: ${pdfDocument.numPages} pages`)
  } catch (error) {
    pagesEl.innerHTML = `<div class="poc-empty">${error?.message || 'Failed to load PDF.'}</div>`
    setStatus('Load failed')
  }
}

async function loadFromCurrentUrl() {
  const value = urlInput.value.trim()
  if (!value) return
  activeSource = { kind: 'url', value }
  await loadPdf(value)
}

async function loadFromFile(file) {
  if (!file) return
  const buffer = await file.arrayBuffer()
  activeSource = { kind: 'file', file, data: new Uint8Array(buffer) }
  await loadPdf({ data: activeSource.data })
}

async function reloadActiveSource() {
  if (activeSource.kind === 'file') {
    await loadPdf({ data: activeSource.data })
    return
  }
  await loadPdf(activeSource.value)
}

loadUrlButton.addEventListener('click', () => {
  void loadFromCurrentUrl()
})

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void loadFromCurrentUrl()
  }
})

fileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0]
  void loadFromFile(file)
})

scaleSelect.addEventListener('change', (event) => {
  const next = Number(event.target.value)
  if (!Number.isFinite(next) || next <= 0) return
  activeScale = next
  void reloadActiveSource()
})

document.addEventListener('selectionchange', () => {
  window.requestAnimationFrame(updateSelectionReadout)
})

window.addEventListener('resize', () => {
  window.requestAnimationFrame(updateSelectionReadout)
})

window.addEventListener('message', (event) => {
  if (!IS_EMBEDDED || event.origin !== window.location.origin) return
  if (event.data?.type !== 'pdf-selection-poc:load' || typeof event.data.url !== 'string') return

  // This bridge exists only for the isolated comparison page. It lets the parent
  // feed the same HTTP or blob URL to both engines without touching production code.
  activeSource = { kind: 'url', value: event.data.url }
  urlInput.value = event.data.url
  void loadPdf(event.data.url)
})

if (IS_EMBEDDED && window.parent !== window) {
  window.parent.postMessage({ type: 'pdf-selection-poc:ready' }, window.location.origin)
}

void loadPdf(DEFAULT_PDF_URL)
