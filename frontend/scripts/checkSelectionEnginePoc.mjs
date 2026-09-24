import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PAGE_URL = process.argv[2] || 'http://127.0.0.1:5186/poc/pdf-selection-engine-test.html'
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

const chromePath = CHROME_CANDIDATES.find(existsSync)
if (!chromePath) throw new Error('Chrome or Edge was not found for the POC smoke test.')

const port = await getFreePort()
const profileDirectory = mkdtempSync(join(tmpdir(), 'xk-selection-poc-'))
const browser = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDirectory}`,
  PAGE_URL,
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })

let session
try {
  const pageTarget = await waitForPageTarget(port, PAGE_URL, 15_000)
  session = createCdpSession(pageTarget.webSocketDebuggerUrl)
  const browserErrors = []

  await session.call('Runtime.enable')
  await session.call('Log.enable')
  session.on('Runtime.exceptionThrown', (event) => {
    browserErrors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Unknown browser error')
  })
  session.on('Log.entryAdded', (event) => {
    if (event.entry?.level === 'error' && !event.entry.url?.endsWith('/favicon.ico')) {
      browserErrors.push(`${event.entry.text}${event.entry.url ? ` (${event.entry.url})` : ''}`)
    }
  })

  const result = await waitForEvaluation(session, `(() => {
    const pdfjs = document.querySelector('[data-pdfjs-status]')?.textContent?.trim() || '';
    const pdfium = document.querySelector('[data-pdfium-status]')?.textContent?.trim() || '';
    const pdfiumElement = document.querySelector('[data-pdfium-host] embedpdf-container');
    const nativeDocument = document.querySelector('[data-pdfjs-frame]')?.contentDocument;
    const pdfiumShadow = pdfiumElement?.shadowRoot;
    const renderedPdfiumImages = Array.from(pdfiumShadow?.querySelectorAll('img') || [])
      .filter((image) => image.currentSrc.startsWith('blob:') && image.naturalWidth > 0);
    return {
      title: document.title,
      pdfjs,
      pdfium,
      hasPdfiumElement: Boolean(pdfiumElement),
      nativeCanvasCount: nativeDocument?.querySelectorAll('canvas').length || 0,
      nativeTextSpanCount: nativeDocument?.querySelectorAll('.textLayer span').length || 0,
      pdfiumCanvasCount: pdfiumShadow?.querySelectorAll('canvas').length || 0,
      pdfiumImageCount: pdfiumShadow?.querySelectorAll('img').length || 0,
      pdfiumPageImageCount: renderedPdfiumImages.length,
      pdfiumSvgCount: pdfiumShadow?.querySelectorAll('svg').length || 0,
      pdfiumImages: Array.from(pdfiumShadow?.querySelectorAll('img') || []).slice(0, 12).map((image) => ({
        className: image.className,
        source: image.currentSrc.slice(0, 100),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })),
      pdfiumText: pdfiumShadow?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 300) || '',
      scoreRows: document.querySelectorAll('[data-result-select]').length,
      ready: (pdfjs.includes('Ready') || pdfjs.includes('已就绪')) &&
        (nativeDocument?.querySelectorAll('.textLayer span').length || 0) > 0,
      candidateReady: pdfium === '已就绪' &&
        renderedPdfiumImages.length > 0,
    };
  })()`, (value) => value.ready && value.candidateReady, 25_000)

  if (browserErrors.length) {
    throw new Error(`Browser exceptions:\n${browserErrors.join('\n')}\nLast state: ${JSON.stringify(result)}`)
  }
  if (!result.hasPdfiumElement) throw new Error('PDFium custom element was not mounted.')
  if (result.scoreRows !== 16) throw new Error(`Expected 16 score selectors, received ${result.scoreRows}.`)
  if (!result.ready || !result.candidateReady) {
    throw new Error(`Viewers did not become ready: ${JSON.stringify(result)}`)
  }

  console.log(JSON.stringify(result, null, 2))
} finally {
  session?.close()
  browser.kill()

  // The path is created by mkdtemp under the OS temp directory; guard the
  // recursive cleanup so this script can never target a workspace or home root.
  const resolvedProfile = resolve(profileDirectory)
  const resolvedTemp = resolve(tmpdir())
  if (resolvedProfile.startsWith(`${resolvedTemp}\\`) && resolvedProfile.includes('xk-selection-poc-')) {
    try {
      rmSync(resolvedProfile, { recursive: true, force: true })
    } catch {
      // Chrome may briefly retain cache handles on Windows; temp cleanup is best-effort.
    }
  }
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolvePort(address.port))
    })
  })
}

async function waitForPageTarget(portNumber, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${portNumber}/json/list`).then((response) => response.json())
      const target = targets.find((item) => item.type === 'page' && item.url.startsWith(url))
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      // Chrome's debugging endpoint needs a short startup window.
    }
    await delay(150)
  }
  throw new Error('Timed out waiting for the headless browser target.')
}

function createCdpSession(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()

  const opened = new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', () => reject(new Error('Failed to connect to Chrome DevTools.')), { once: true })
  })

  socket.addEventListener('message', (message) => {
    const payload = JSON.parse(message.data)
    if (payload.id && pending.has(payload.id)) {
      const { resolveCall, rejectCall } = pending.get(payload.id)
      pending.delete(payload.id)
      if (payload.error) rejectCall(new Error(payload.error.message))
      else resolveCall(payload.result)
      return
    }
    for (const listener of listeners.get(payload.method) || []) listener(payload.params || {})
  })

  return {
    async call(method, params = {}) {
      await opened
      const id = nextId
      nextId += 1
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolveCall, rejectCall) => pending.set(id, { resolveCall, rejectCall }))
    },
    on(method, listener) {
      const entries = listeners.get(method) || []
      entries.push(listener)
      listeners.set(method, entries)
    },
    close() {
      socket.close()
    },
  }
}

async function waitForEvaluation(cdp, expression, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastValue = null
  while (Date.now() < deadline) {
    const response = await cdp.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    lastValue = response.result?.value
    if (predicate(lastValue)) return lastValue
    await delay(500)
  }
  return lastValue
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
