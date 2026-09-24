import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const targetUrl = process.argv[2] || 'http://127.0.0.1:5186/poc/embedpdf-ui-runtime.html'
const outputPath = resolve(process.argv[3] || '.tmp/embedpdf-ui-smoke.png')
const profilePath = resolve('.tmp/embedpdf-edge-profile')

mkdirSync(profilePath, { recursive: true })
mkdirSync(resolve(outputPath, '..'), { recursive: true })

const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  `--user-data-dir=${profilePath}`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })

function waitForDebuggerUrl() {
  return new Promise((resolveUrl, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error('Edge DevTools 启动超时')), 15_000)
    edge.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (!match) return
      clearTimeout(timer)
      resolveUrl(match[1])
    })
    edge.once('exit', (code) => reject(new Error(`Edge 提前退出：${code}`)))
  })
}

function createCdpClient(socketUrl) {
  const socket = new WebSocket(socketUrl)
  let messageId = 0
  const pending = new Map()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve: resolveCall, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolveCall(message.result)
  })

  const ready = new Promise((resolveReady, reject) => {
    socket.addEventListener('open', resolveReady, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
  })

  return {
    async call(method, params = {}) {
      await ready
      const id = ++messageId
      const response = new Promise((resolveCall, reject) => {
        pending.set(id, { resolve: resolveCall, reject })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return response
    },
    close() {
      socket.close()
    },
  }
}

async function waitForPageTarget(port) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10_000) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
    const page = targets.find((target) => target.type === 'page')
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('未找到 Edge 页面调试目标')
}

async function main() {
  const browserSocketUrl = await waitForDebuggerUrl()
  const port = new URL(browserSocketUrl).port
  const pageSocketUrl = await waitForPageTarget(port)
  const cdp = createCdpClient(pageSocketUrl)

  await cdp.call('Page.enable')
  await cdp.call('Runtime.enable')
  await cdp.call('Page.navigate', { url: targetUrl })

  const startedAt = Date.now()
  let status = ''
  while (Date.now() - startedAt < 40_000) {
    const result = await cdp.call('Runtime.evaluate', {
      expression: `document.querySelector('[data-poc-status]')?.textContent || ''`,
      returnByValue: true,
    })
    status = result.result?.value || ''
    if (status.includes('已就绪')) break

    const errorResult = await cdp.call('Runtime.evaluate', {
      expression: `document.querySelector('.embedpdf-state.is-error')?.textContent || ''`,
      returnByValue: true,
    })
    if (errorResult.result?.value) throw new Error(errorResult.result.value)
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  if (!status.includes('已就绪')) throw new Error(`阅读器未就绪：${status || '无状态'}`)

  let rendered = { pageImages: 0, thumbnailImages: 0 }
  const renderStartedAt = Date.now()
  while (Date.now() - renderStartedAt < 30_000) {
    const renderResult = await cdp.call('Runtime.evaluate', {
      expression: `JSON.stringify({
        pageImages: document.querySelectorAll('.embedpdf-page img').length,
        thumbnailImages: document.querySelectorAll('.embedpdf-thumbnail-panel__item img').length
      })`,
      returnByValue: true,
    })
    rendered = JSON.parse(renderResult.result.value)
    if (rendered.pageImages > 0 && rendered.thumbnailImages > 0) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  if (!rendered.pageImages || !rendered.thumbnailImages) {
    throw new Error(`PDF 页面位图未完成：${JSON.stringify(rendered)}`)
  }

  // Give Chromium one compositor frame after image decode/canvas paint.
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))

  const pageRectResult = await cdp.call('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const rect = document.querySelector('[data-embedpdf-page-index="0"]')?.getBoundingClientRect()
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
    })())`,
    returnByValue: true,
  })
  const pageRect = JSON.parse(pageRectResult.result.value)
  if (!pageRect) throw new Error('找不到第一页坐标')

  // Drag across one abstract line on the stable STHELAR first page. The
  // assertion below verifies PDFium hit-testing and the XK floating menu.
  const start = {
    x: pageRect.left + pageRect.width * 0.27,
    y: pageRect.top + pageRect.width * 0.48,
  }
  const end = {
    x: pageRect.left + pageRect.width * 0.72,
    y: start.y,
  }
  await cdp.call('Runtime.evaluate', {
    expression: `window.__xkPointerEvents = [];
      ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'].forEach((type) => {
        document.addEventListener(type, (event) => window.__xkPointerEvents.push({
          type,
          target: typeof event.target?.className === 'string' ? event.target.className : event.target?.tagName || ''
        }), { capture: true, once: type !== 'pointermove' && type !== 'mousemove' })
      })`,
  })
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
  })
  for (let step = 1; step <= 12; step += 1) {
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + ((end.x - start.x) * step) / 12,
      y: start.y,
      button: 'left',
      buttons: 1,
      pointerType: 'mouse',
    })
  }
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
  })

  let selection = { text: '', menu: false }
  const selectionStartedAt = Date.now()
  while (Date.now() - selectionStartedAt < 8_000) {
    const selectionResult = await cdp.call('Runtime.evaluate', {
      expression: `JSON.stringify({
        text: document.querySelector('[data-poc-selection]')?.textContent || '',
        menu: Boolean(document.querySelector('.embedpdf-selection-menu'))
      })`,
      returnByValue: true,
    })
    selection = JSON.parse(selectionResult.result.value)
    if (selection.text && selection.menu) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (!selection.text || !selection.menu) {
    const debugResult = await cdp.call('Runtime.evaluate', {
      expression: `JSON.stringify({
        events: window.__xkPointerEvents,
        startTarget: (() => {
          const element = document.elementFromPoint(${start.x}, ${start.y})
          return element ? { tag: element.tagName, className: element.className, style: element.getAttribute('style') } : null
        })()
      })`,
      returnByValue: true,
    })
    throw new Error(`PDFium 拖拽选区验收失败：${JSON.stringify({
      ...selection,
      pageRect,
      start,
      end,
      debug: JSON.parse(debugResult.result.value),
    })}`)
  }

  const metrics = await cdp.call('Runtime.evaluate', {
    expression: `JSON.stringify({
      pages: document.querySelectorAll('[data-embedpdf-page-index]').length,
      thumbnails: document.querySelectorAll('.embedpdf-thumbnail-panel__item').length,
      activeThumbnails: document.querySelectorAll('.embedpdf-thumbnail-panel__item.is-active').length,
      error: document.querySelector('.embedpdf-state.is-error')?.textContent || ''
    })`,
    returnByValue: true,
  })
  const summary = JSON.parse(metrics.result.value)
  if (!summary.pages || !summary.thumbnails || summary.error) {
    throw new Error(`阅读器 DOM 验收失败：${JSON.stringify(summary)}`)
  }

  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'))
  cdp.close()
  process.stdout.write(`${JSON.stringify({
    status,
    ...summary,
    ...rendered,
    selectionChars: selection.text.length,
    selectionMenu: selection.menu,
    screenshot: outputPath,
  })}\n`)
}

try {
  await main()
} finally {
  edge.kill()
}
