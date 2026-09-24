import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const frontendUrl = 'http://127.0.0.1:5190'
const backendUrl = 'http://127.0.0.1:8000'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const paperPath = 'C:\\Users\\xk\\Desktop\\论文文献资料\\2026-8-7\\STHELAR, a multi-tissue dataset linking spatial transcriptomics and histology for cell type annotation.pdf'
const profilePath = 'C:\\Users\\xk\\AppData\\Local\\Temp\\xk-reader-formal-smoke-profile'

function getLocalToken() {
  const source = [
    'from sqlalchemy import select',
    'from app.db.session import SessionLocal',
    'from app.models import User',
    'from app.services.security import create_access_token',
    'db=SessionLocal()',
    'u=db.scalar(select(User).where(User.status=="active").order_by(User.id))',
    'print(create_access_token(u.uid, u.token_version))',
    'db.close()',
  ].join(';')
  return execFileSync('C:\\Python314\\python.exe', ['-c', source], {
    cwd: resolve('../backend'),
    encoding: 'utf8',
    env: {
      ...process.env,
      XK_READER_USE_LOCAL_DATABASE: 'true',
      XK_READER_LOCAL_DATABASE_HOST: '127.0.0.1',
      XK_READER_LOCAL_DATABASE_PORT: '3306',
    },
  }).trim()
}

async function uploadTemporaryPaper(token) {
  const source = readFileSync(paperPath)
  const uniquePdf = Buffer.concat([
    source,
    Buffer.from(`\n% XK reader interaction smoke ${Date.now()}\n`),
  ])
  const form = new FormData()
  form.append('file', new Blob([uniquePdf], { type: 'application/pdf' }), 'xk-reader-interaction-smoke.pdf')
  form.append('metadata_json', JSON.stringify({ title: 'XK Reader Interaction Smoke' }))
  const response = await fetch(`${backendUrl}/api/papers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) throw new Error(`临时文献上传失败：${response.status} ${await response.text()}`)
  return response.json()
}

async function removeTemporaryPaper(token, paperId) {
  await fetch(`${backendUrl}/api/papers/${paperId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  await fetch(`${backendUrl}/api/papers/trash/${paperId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function waitForDebuggerUrl(edge) {
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

function createCdpClient(socketUrl) {
  const socket = new WebSocket(socketUrl)
  const pending = new Map()
  let messageId = 0
  const ready = new Promise((resolveReady, reject) => {
    socket.addEventListener('open', resolveReady, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    if (message.error) call.reject(new Error(message.error.message))
    else call.resolve(message.result)
  })
  return {
    async call(method, params = {}) {
      await ready
      const id = ++messageId
      const result = new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }))
      socket.send(JSON.stringify({ id, method, params }))
      return result
    },
    close() {
      socket.close()
    },
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result?.value
}

async function waitFor(cdp, expression, label, timeout = 40_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const value = await evaluate(cdp, expression)
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`${label}超时`)
}

async function clickByLabel(cdp, label, selector = 'button') {
  const found = await evaluate(cdp, `(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((item) => (item.getAttribute('aria-label') || item.textContent || '').trim() === ${JSON.stringify(label)})
    if (!node) return false
    node.click()
    return true
  })()`)
  if (!found) throw new Error(`找不到工具：${label}`)
}

async function drag(cdp, start, end) {
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
  })
  for (let step = 1; step <= 12; step += 1) {
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + ((end.x - start.x) * step) / 12,
      y: start.y + ((end.y - start.y) * step) / 12,
      button: 'left',
      buttons: 1,
      pointerType: 'mouse',
    })
  }
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: end.x,
    y: end.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
  })
}

async function clickPoint(cdp, point) {
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
  })
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
  })
}

async function clickSelector(cdp, selector) {
  const rect = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  })())`))
  if (!rect || rect.width < 1 || rect.height < 1) {
    throw new Error(`无法点击元素：${selector}`)
  }
  await clickPoint(cdp, {
    x: rect.left + Math.min(rect.width / 2, 18),
    y: rect.top + Math.min(rect.height / 2, 18),
  })
}

async function doubleClickPoint(cdp, point) {
  for (const clickCount of [1, 2]) {
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount,
      pointerType: 'mouse',
    })
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount,
      pointerType: 'mouse',
    })
  }
}

async function getSavedAnnotationCount(token, paperId) {
  const annotations = await getSavedAnnotations(token, paperId)
  return annotations.length
}

async function getSavedAnnotations(token, paperId) {
  const response = await fetch(`${backendUrl}/api/papers/${paperId}/pdf-annotations`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`读取批注失败：${response.status}`)
  const payload = await response.json()
  return payload.annotations || []
}

async function waitForAnnotationCount(token, paperId, expected) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 12_000) {
    const count = await getSavedAnnotationCount(token, paperId)
    if (count >= expected) return count
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`批注未保存，预期至少 ${expected} 条`)
}

async function waitForAnnotationCountExact(token, paperId, expected) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 12_000) {
    const count = await getSavedAnnotationCount(token, paperId)
    if (count === expected) return count
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`批注数量未更新，预期 ${expected} 条`)
}

async function readInteractionDebug(cdp) {
  return JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const root = document.querySelector('[data-embedpdf-document-id]')
    const indicator = [...document.querySelectorAll('.toolbar-indicator')]
      .find((item) => item.textContent.includes('%'))
    return {
      activeMode: root?.dataset.embedpdfActiveMode || '',
      activeExclusive: root?.dataset.embedpdfActiveExclusive || '',
      requestedTool: root?.dataset.embedpdfRequestedTool || '',
      localAnnotationCount: Number(
        document.querySelector('.embedpdf-sync-state')?.dataset.annotationCount || 0
      ),
      zoom: indicator?.textContent.trim() || '',
      syncText: document.querySelector('.embedpdf-sync-state')?.textContent.trim() || '',
    }
  })())`))
}

async function readPointDebug(cdp, point) {
  return JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const page = document.querySelector('[data-embedpdf-page-index="0"], .embedpdf-page')
    const rect = page?.getBoundingClientRect()
    const hit = document.elementFromPoint(${point.x}, ${point.y})
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      point: ${JSON.stringify(point)},
      hitTag: hit?.tagName || '',
      hitClass: String(hit?.className || ''),
      hitPage: hit?.closest?.('[data-embedpdf-page-index], .embedpdf-page')?.className || '',
      ancestors: (() => {
        const items = []
        let current = hit
        while (current && items.length < 8) {
          items.push({
            tag: current.tagName || '',
            className: String(current.className || ''),
            style: current.getAttribute?.('style') || '',
          })
          current = current.parentElement
        }
        return items
      })(),
    }
  })())`))
}

async function runBrowser(token, paper) {
  const edge = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    '--window-size=1900,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let cdp
  try {
    const browserSocketUrl = await waitForDebuggerUrl(edge)
    const pageSocketUrl = await waitForPageTarget(new URL(browserSocketUrl).port)
    cdp = createCdpClient(pageSocketUrl)
    await cdp.call('Page.enable')
    await cdp.call('Runtime.enable')
    await cdp.call('Page.navigate', { url: frontendUrl })
    await waitFor(cdp, 'location.origin === "http://127.0.0.1:5190"', '前端打开')
    await evaluate(cdp, `localStorage.setItem('xk_reader_auth_token', ${JSON.stringify(token)}); location.reload(); true`)
    await waitFor(
      cdp,
      'document.body?.innerText.includes("XK Reader Interaction Smoke")',
      '文献首页',
    )
    const opened = await evaluate(cdp, `(() => {
      const title = 'XK Reader Interaction Smoke'
      // 首页的继续阅读卡与最近阅读行有不同的 DOM 结构；从标题定位到各自真正的打开控件，
      // 避免页面文案重构后误点到不可交互的容器。
      const headings = [...document.querySelectorAll('.home-continue-card h3, .home-paper-row h3')]
        .filter((item) => item.textContent.includes(title))
      for (const heading of headings) {
        const continueButton = heading.closest('.home-continue-card')
          ?.querySelector('button.home-primary-button')
        const recentRow = heading.closest('button.home-paper-row')
        const target = continueButton || recentRow
        if (target) {
          target.click()
          return true
        }
      }
      return false
    })()`)
    if (!opened) throw new Error('找不到临时测试文献')
    try {
      await waitFor(
        cdp,
        'Boolean(document.querySelector("[data-embedpdf-page-index=\\"0\\"], .embedpdf-page"))',
        'PDFium 正式阅读器',
      )
    } catch (error) {
      const debug = await evaluate(cdp, `JSON.stringify({
        body: document.body.innerText.slice(0, 1600),
        state: document.querySelector('.embedpdf-state')?.textContent || '',
        tabs: [...document.querySelectorAll('.doc-tab')].map((item) => item.textContent.trim()),
        root: Boolean(document.querySelector('[data-embedpdf-document-id]')),
        pages: document.querySelectorAll('.embedpdf-page').length,
        images: document.querySelectorAll('.embedpdf-page img').length,
        classes: [...document.querySelectorAll('[class*="page"]')]
          .slice(0, 30)
          .map((item) => item.className)
      })`)
      throw new Error(`${error.message}：${debug}`)
    }
    await waitFor(cdp, 'document.querySelectorAll(".embedpdf-page img").length > 0', 'PDF 页面渲染')

    await clickByLabel(cdp, '显示阅读导航')
    await waitFor(cdp, 'Boolean(document.querySelector(".reader-navigation-panel"))', '阅读导航面板')
    await waitFor(cdp, 'document.querySelector(".thumbnails-slide")?.getBoundingClientRect().width >= 160', '阅读导航展开')
    const navigation = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const tabs = [...document.querySelectorAll('.reader-navigation-panel [role="tab"]')]
      const thumbnailTab = tabs.find((item) => item.textContent.trim() === '缩略图')
      const outlineTab = tabs.find((item) => item.textContent.trim() === '目录')
      const underline = getComputedStyle(thumbnailTab, '::after')
      const tabPanelRect = document.querySelector('.reader-navigation-panel__tabs').getBoundingClientRect()
      const tabGroupCenter = (tabs[0].getBoundingClientRect().left + tabs.at(-1).getBoundingClientRect().right) / 2
      const navigationButton = document.querySelector('.toolbar-icon-button--navigation')
      const navigationButtonStyle = getComputedStyle(navigationButton)
      const navigationButtonUnderline = getComputedStyle(navigationButton, '::after')
      return {
        tabs: tabs.map((item) => item.textContent.trim()),
        thumbnailsSelected: thumbnailTab?.getAttribute('aria-selected') === 'true',
        outlineExists: Boolean(outlineTab),
        underlineHeight: underline.height,
        underlineRadius: underline.borderRadius,
        tabsCentered: Math.abs(tabGroupCenter - (tabPanelRect.left + tabPanelRect.width / 2)) < 1,
        navigationUnderlineHeight: navigationButtonUnderline.height,
        navigationUnderlineRadius: navigationButtonUnderline.borderRadius,
        navigationBackground: navigationButtonStyle.backgroundColor,
        navigationBoxShadow: navigationButtonStyle.boxShadow,
      }
    })())`))
    if (
      !navigation.thumbnailsSelected
      || !navigation.outlineExists
      || !navigation.tabsCentered
      || navigation.underlineHeight !== '2px'
      || navigation.underlineRadius !== '0px'
      || navigation.navigationUnderlineHeight !== '2px'
      || navigation.navigationUnderlineRadius !== '0px'
      || navigation.navigationBackground !== 'rgba(0, 0, 0, 0)'
      || navigation.navigationBoxShadow !== 'none'
    ) {
      throw new Error(`阅读导航结构或直线选中态异常：${JSON.stringify(navigation)}`)
    }
    const navigationShot = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })
    writeFileSync(
      resolve('../output/reader-navigation-panel.png'),
      Buffer.from(navigationShot.data, 'base64'),
    )
    // 后续批注回归用的是固定视窗坐标。截图后恢复原布局，保证该测试只验证导航而不改变其他交互条件。
    await clickByLabel(cdp, '隐藏阅读导航')
    await waitFor(cdp, 'document.querySelector(".thumbnails-slide")?.getBoundingClientRect().width < 2', '阅读导航收起')

    const pageRect = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const rect = document.querySelector('[data-embedpdf-page-index="0"], .embedpdf-page').getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })())`))
    const point = (x, y) => ({
      x: pageRect.left + pageRect.width * x,
      y: pageRect.top + pageRect.height * y,
    })

    // “选择”已是阅读区的直达入口，不再需要先展开旧版“阅读”分类。
    await clickByLabel(cdp, '选择')
    const selectionY = pageRect.top + pageRect.width * 0.48
    await doubleClickPoint(cdp, {
      x: pageRect.left + pageRect.width * 0.15,
      y: pageRect.top + pageRect.height * 0.15,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 450))
    const doubleClickOverlayAudit = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const page = document.querySelector('[data-embedpdf-page-index="0"], .embedpdf-page')
      const pageRect = page.getBoundingClientRect()
      const nodes = [...page.querySelectorAll('div')]
        .map((node) => {
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return {
            className: String(node.className || ''),
            inlineStyle: node.getAttribute('style') || '',
            background: style.backgroundColor,
            position: style.position,
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            areaRatio: (rect.width * rect.height) / (pageRect.width * pageRect.height),
          }
        })
        .filter((item) => (
          item.position === 'absolute'
          && item.areaRatio > 0.08
          && item.background !== 'rgba(0, 0, 0, 0)'
        ))
      return {
        safeRects: document.querySelectorAll('.embedpdf-safe-selection-rect').length,
        selectionMenu: Boolean(document.querySelector('.embedpdf-selection-menu')),
        nativeSelection: (() => {
          const selection = window.getSelection()
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null
          const rangeRect = range?.getBoundingClientRect()
          return {
            type: selection?.type || '',
            text: selection?.toString() || '',
            anchorNode: selection?.anchorNode?.nodeName || '',
            focusNode: selection?.focusNode?.nodeName || '',
            commonAncestor: range?.commonAncestorContainer?.nodeName || '',
            rect: rangeRect ? {
              width: rangeRect.width,
              height: rangeRect.height,
              areaRatio: (rangeRect.width * rangeRect.height) / (pageRect.width * pageRect.height),
            } : null,
          }
        })(),
        pageUserSelect: getComputedStyle(page).userSelect,
        nodes,
      }
    })())`))
    if (
      doubleClickOverlayAudit.pageUserSelect !== 'none'
      || (doubleClickOverlayAudit.nativeSelection.rect?.areaRatio || 0) > 0.08
    ) {
      throw new Error(`双击触发了浏览器整页原生选区：${JSON.stringify(doubleClickOverlayAudit)}`)
    }
    const doubleClickShot = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })
    writeFileSync(
      resolve('../output/reader-double-click-selection.png'),
      Buffer.from(doubleClickShot.data, 'base64'),
    )
    // Clear the diagnostic selection before exercising the drag-selection flow.
    await clickPoint(cdp, point(0.90, 0.10))
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    await drag(
      cdp,
      { x: pageRect.left + pageRect.width * 0.27, y: selectionY },
      { x: pageRect.left + pageRect.width * 0.72, y: selectionY },
    )
    await waitFor(cdp, 'Boolean(document.querySelector(".embedpdf-selection-menu"))', '划词浮窗')
    const quickMarkupColors = JSON.parse(await evaluate(cdp, `JSON.stringify(
      [...document.querySelectorAll('.embedpdf-selection-menu__colors button')]
        .map((item) => item.getAttribute('aria-label'))
    )`))
    if (quickMarkupColors.length !== 4) {
      throw new Error(`划词浮窗颜色数量不是 4 个：${JSON.stringify(quickMarkupColors)}`)
    }
    await waitFor(
      cdp,
      'document.body.innerText.includes("即时翻译") && !document.body.innerText.includes("网络好像开小差了")',
      '划词翻译',
      25_000,
    )
    const translatedSelection = JSON.parse(await evaluate(cdp, `JSON.stringify({
      original: [...document.querySelectorAll('.insight-block p')][0]?.textContent.trim() || '',
      translation: [...document.querySelectorAll('.insight-block p')][1]?.textContent.trim() || ''
    })`))

    await clickByLabel(cdp, '批注')
    const annotationToolbarLayout = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const eraser = [...document.querySelectorAll('.toolbar-quick-actions button')]
        .find((item) => item.getAttribute('aria-label')?.startsWith('擦除：'))
      const highlight = [...document.querySelectorAll('button')]
        .find((item) => item.getAttribute('aria-label') === '高亮')
      const eraserRect = eraser?.getBoundingClientRect()
      const highlightRect = highlight?.getBoundingClientRect()
      return {
        eraser: eraserRect ? { top: eraserRect.top, left: eraserRect.left } : null,
        highlight: highlightRect ? { top: highlightRect.top, left: highlightRect.left } : null,
      }
    })())`))
    if (
      !annotationToolbarLayout.eraser
      || !annotationToolbarLayout.highlight
      || annotationToolbarLayout.eraser.top >= annotationToolbarLayout.highlight.top
    ) {
      throw new Error(`橡皮没有独立放在工具栏第一行：${JSON.stringify(annotationToolbarLayout)}`)
    }
    const annotationToolbarShot = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })
    writeFileSync(
      resolve('../output/reader-annotation-tools.png'),
      Buffer.from(annotationToolbarShot.data, 'base64'),
    )
    await clickByLabel(cdp, '高亮')
    await waitFor(cdp, `document.querySelector('[data-embedpdf-document-id]')?.dataset.embedpdfActiveMode === 'highlight'`, '文字高亮模式')
    const markupY = pageRect.top + pageRect.width * 0.48
    await drag(
      cdp,
      { x: pageRect.left + pageRect.width * 0.27, y: markupY },
      { x: pageRect.left + pageRect.width * 0.62, y: markupY },
    )
    let markupCount
    try {
      markupCount = await waitForAnnotationCount(token, paper.id, 1)
    } catch (error) {
      const markupDebug = await readInteractionDebug(cdp)
      const markupSelection = JSON.parse(await evaluate(cdp, `JSON.stringify({
        menu: Boolean(document.querySelector('.embedpdf-selection-menu')),
        insight: [...document.querySelectorAll('.insight-block p')][0]?.textContent.trim() || ''
      })`))
      throw new Error(`${error.message}：${JSON.stringify({ ...markupDebug, markupSelection })}`)
    }

    // The ribbon style panel must affect real PDFium markup data, not merely
    // recolor its swatch. Persist a blue underline and read it back from the API.
    await clickByLabel(cdp, '下划线')
    await waitFor(cdp, `document.querySelector('[data-embedpdf-document-id]')?.dataset.embedpdfActiveMode === 'underline'`, '下划线模式')
    await clickByLabel(cdp, '批注样式')
    await clickByLabel(cdp, '批注颜色 #3B82F6')
    await clickByLabel(cdp, '批注样式')
    const underlineY = markupY + pageRect.width * 0.035
    await drag(
      cdp,
      { x: pageRect.left + pageRect.width * 0.27, y: underlineY },
      { x: pageRect.left + pageRect.width * 0.58, y: underlineY },
    )
    const underlineCount = await waitForAnnotationCount(token, paper.id, 2)
    const underlineAnnotation = (await getSavedAnnotations(token, paper.id))
      .find((item) => item.annotation_type === 'underline')
    if (underlineAnnotation?.payload?.strokeColor !== '#3B82F6') {
      throw new Error(`下划线自定义颜色未保存：${JSON.stringify(underlineAnnotation)}`)
    }

    await clickByLabel(cdp, '手写')
    await waitFor(cdp, `document.querySelector('[data-embedpdf-document-id]')?.dataset.embedpdfActiveMode === 'ink'`, '手写模式')
    const inkStart = point(0.30, 0.12)
    const inkEnd = point(0.48, 0.16)
    const inkPointDebug = await readPointDebug(cdp, inkStart)
    await drag(cdp, inkStart, inkEnd)
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))
    const inkDebug = await readInteractionDebug(cdp)
    let inkCount
    try {
      inkCount = await waitForAnnotationCount(token, paper.id, 3)
    } catch (error) {
      throw new Error(`${error.message}：${JSON.stringify({ ...inkDebug, inkPointDebug })}`)
    }

    await clickByLabel(cdp, '荧光笔')
    await waitFor(cdp, `document.querySelector('[data-embedpdf-document-id]')?.dataset.embedpdfActiveMode === 'inkHighlighter'`, '荧光笔模式')
    await clickByLabel(cdp, '批注样式')
    await clickByLabel(cdp, '批注颜色 #DB2777')
    await drag(cdp, point(0.30, 0.20), point(0.58, 0.20))
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))
    const highlighterDebug = await readInteractionDebug(cdp)
    let highlighterCount
    try {
      highlighterCount = await waitForAnnotationCount(token, paper.id, 4)
    } catch (error) {
      throw new Error(`${error.message}：${JSON.stringify(highlighterDebug)}`)
    }
    const highlighterAnnotation = (await getSavedAnnotations(token, paper.id))
      .find((item) => item.annotation_type === 'inkHighlighter')
    if (highlighterAnnotation?.payload?.strokeColor !== '#DB2777') {
      throw new Error(`荧光笔颜色未保存：${JSON.stringify(highlighterAnnotation)}`)
    }
    const visibleHighlighter = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const allPaths = [...document.querySelectorAll('[data-embedpdf-page-index="0"] svg path')]
        .map((path) => {
          const style = getComputedStyle(path)
          const rect = path.getBoundingClientRect()
          return {
            stroke: style.stroke,
            inlineStyle: path.getAttribute('style') || '',
            display: style.display,
            opacity: Number(style.opacity || 1),
            width: rect.width,
            height: rect.height,
          }
        })
      const paths = allPaths
        .filter((item) => (
          item.opacity > 0
          && item.width > 20
          && /219[^0-9]+39[^0-9]+119|#db2777/i.test(item.stroke + item.inlineStyle)
        ))
      return { count: paths.length, paths, allPaths }
    })())`))
    if (!visibleHighlighter.count) {
      throw new Error(`荧光笔松手后没有可见路径：${JSON.stringify(visibleHighlighter)}`)
    }

    await clickByLabel(cdp, '评论')
    await waitFor(cdp, `document.querySelector('[data-embedpdf-document-id]')?.dataset.embedpdfActiveMode === 'textComment'`, '评论模式')
    const commentPoint = point(0.70, 0.22)
    await clickPoint(cdp, commentPoint)
    await waitFor(cdp, 'Boolean(document.querySelector(".embedpdf-comment-editor textarea"))', '评论输入框')
    await clickSelector(cdp, '.embedpdf-comment-editor textarea')
    await new Promise((resolveWait) => setTimeout(resolveWait, 350))
    const commentFocusDebug = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const textarea = document.querySelector('.embedpdf-comment-editor textarea')
      const rect = textarea?.getBoundingClientRect()
      const hit = rect ? document.elementFromPoint(rect.left + 18, rect.top + 18) : null
      return {
        activeTag: document.activeElement?.tagName || '',
        activeClass: String(document.activeElement?.className || ''),
        value: textarea?.value || '',
        textareaRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        textareaPointerEvents: textarea ? getComputedStyle(textarea).pointerEvents : '',
        hitTag: hit?.tagName || '',
        hitClass: String(hit?.className || ''),
        ancestors: (() => {
          const items = []
          let current = hit
          while (current && items.length < 7) {
            const bounds = current.getBoundingClientRect()
            const style = getComputedStyle(current)
            items.push({
              tag: current.tagName || '',
              className: String(current.className || ''),
              pointerEvents: style.pointerEvents,
              zIndex: style.zIndex,
              rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
            })
            current = current.parentElement
          }
          return items
        })(),
      }
    })())`))
    if (commentFocusDebug.activeTag !== 'TEXTAREA') {
      throw new Error(`评论输入框未获得鼠标焦点：${JSON.stringify(commentFocusDebug)}`)
    }
    await cdp.call('Input.insertText', { text: '真实评论保存测试' })
    await waitFor(cdp, 'document.querySelector(".embedpdf-comment-editor textarea")?.value === "真实评论保存测试"', '评论输入')
    await clickSelector(cdp, 'button[aria-label="保存评论"]')
    await waitForAnnotationCount(token, paper.id, 5)
    const savedComment = (await getSavedAnnotations(token, paper.id))
      .find((item) => item.annotation_type === 'textComment')
    if (savedComment?.payload?.contents !== '真实评论保存测试') {
      throw new Error(`评论正文未保存：${JSON.stringify(savedComment)}`)
    }
    await clickSelector(cdp, 'button[aria-label="删除批注"]')
    const commentDeleteCount = await waitForAnnotationCountExact(token, paper.id, 4)

    await clickByLabel(cdp, '图形')
    const shapeCases = [
      { label: '直线', mode: 'line', start: point(0.25, 0.25), end: point(0.45, 0.28) },
      { label: '箭头', mode: 'lineArrow', start: point(0.25, 0.29), end: point(0.45, 0.32) },
      { label: '矩形', mode: 'square', start: point(0.25, 0.34), end: point(0.45, 0.39) },
      { label: '圆形', mode: 'circle', start: point(0.25, 0.41), end: point(0.43, 0.46) },
    ]
    const shapeCounts = {}
    for (let index = 0; index < shapeCases.length; index += 1) {
      const shapeCase = shapeCases[index]
      await clickByLabel(cdp, shapeCase.label)
      await waitFor(
        cdp,
        `document.querySelector('[data-embedpdf-document-id]')?.dataset.embedpdfActiveMode === ${JSON.stringify(shapeCase.mode)}`,
        `${shapeCase.label}模式`,
      )
      const shapePointDebug = await readPointDebug(cdp, shapeCase.start)
      await drag(cdp, shapeCase.start, shapeCase.end)
      await new Promise((resolveWait) => setTimeout(resolveWait, 800))
      const expectedCount = 5 + index
      try {
        shapeCounts[shapeCase.label] = await waitForAnnotationCount(token, paper.id, expectedCount)
      } catch (error) {
        const shapeDebug = await readInteractionDebug(cdp)
        throw new Error(`${error.message}：${JSON.stringify({
          shape: shapeCase.label,
          ...shapeDebug,
          shapePointDebug,
        })}`)
      }
    }

    const beforeZoom = JSON.parse(await evaluate(cdp, `JSON.stringify({
      width: window.innerWidth,
      pdf: document.querySelector('.toolbar-indicator--strong')?.textContent.trim()
    })`))
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point(0.5, 0.5).x,
      y: point(0.5, 0.20).y,
      deltaX: 0,
      deltaY: -120,
      modifiers: 2,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 450))
    const afterZoom = JSON.parse(await evaluate(cdp, `JSON.stringify({
      width: window.innerWidth,
      pdf: document.querySelector('.toolbar-indicator--strong')?.textContent.trim()
    })`))
    if (beforeZoom.width !== afterZoom.width || beforeZoom.pdf === afterZoom.pdf) {
      throw new Error(`Ctrl+滚轮缩放范围错误：${JSON.stringify({ beforeZoom, afterZoom })}`)
    }

    await clickByLabel(cdp, '插入 / XK 工具')
    await clickByLabel(cdp, '截图')
    const capturePageRect = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const rect = document.querySelector('[data-embedpdf-page-index="0"], .embedpdf-page').getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })())`))
    const capturePoint = (x, y) => ({
      x: capturePageRect.left + capturePageRect.width * x,
      y: capturePageRect.top + capturePageRect.height * y,
    })
    await drag(cdp, capturePoint(0.30, 0.22), capturePoint(0.58, 0.29))
    await waitFor(cdp, 'Boolean(document.querySelector(".embedpdf-capture-selection"))', '截图选区保持')
    await waitFor(cdp, 'Boolean(document.querySelector(".screenshot-floating-menu"))', '截图浮窗')
    const screenshotFlowShot = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })
    writeFileSync(
      resolve('../output/reader-screenshot-flow.png'),
      Buffer.from(screenshotFlowShot.data, 'base64'),
    )
    const screenshot = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const selection = document.querySelector('.embedpdf-capture-selection').getBoundingClientRect()
      const menu = document.querySelector('.screenshot-floating-menu').getBoundingClientRect()
      return { selectionBottom: selection.bottom, menuTop: menu.top, gap: Math.round(menu.top - selection.bottom) }
    })())`))
    if (Math.abs(screenshot.gap) > 18) throw new Error(`截图菜单未贴近选区：${JSON.stringify(screenshot)}`)

    await clickByLabel(cdp, '钉住')
    await waitFor(cdp, 'Boolean(document.querySelector(".pdf-pinned-shot"))', '钉住截图')
    const pinnedBefore = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const frame = document.querySelector('.pdf-pinned-shot').getBoundingClientRect()
      const image = document.querySelector('.pdf-pinned-shot__image').getBoundingClientRect()
      return {
        frame: { width: frame.width, height: frame.height, left: frame.left, top: frame.top },
        image: { width: image.width, height: image.height },
      }
    })())`))
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: pinnedBefore.frame.left + pinnedBefore.frame.width / 2,
      y: pinnedBefore.frame.top + pinnedBefore.frame.height / 2,
      deltaX: 0,
      deltaY: -120,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    const pinnedAfter = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const frame = document.querySelector('.pdf-pinned-shot').getBoundingClientRect()
      const image = document.querySelector('.pdf-pinned-shot__image').getBoundingClientRect()
      return {
        frame: { width: frame.width, height: frame.height },
        image: { width: image.width, height: image.height },
      }
    })())`))
    if (
      pinnedAfter.frame.width <= pinnedBefore.frame.width
      || pinnedAfter.image.width <= pinnedBefore.image.width
      || Math.abs(pinnedAfter.frame.width - pinnedAfter.image.width) > 2
      || Math.abs(pinnedAfter.frame.height - pinnedAfter.image.height) > 2
    ) {
      throw new Error(`截图内容未随浮窗放大：${JSON.stringify({ pinnedBefore, pinnedAfter })}`)
    }

    const translationResponse = await fetch(`${backendUrl}/api/selection-insight`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Spatial transcriptomics profiles gene expressions in spatial context.',
        paper_title: 'XK Reader Interaction Smoke',
      }),
    })
    if (!translationResponse.ok) {
      throw new Error(`划词翻译失败：${translationResponse.status} ${await translationResponse.text()}`)
    }
    const translation = await translationResponse.json()
    if (!translation.translation) throw new Error('划词翻译返回空结果')

    return {
      highlighterCount,
      inkCount,
      markupCount,
      underlineCount,
      quickMarkupColors,
      annotationToolbarLayout,
      doubleClickOverlayAudit,
      shapeCounts,
      beforeZoom,
      afterZoom,
      screenshot,
      pinnedBefore,
      pinnedAfter,
      commentDeleteCount,
      visibleHighlighterCount: visibleHighlighter.count,
      translatedSelection,
      translationSource: translation.source,
    }
  } finally {
    cdp?.close()
    edge.kill()
  }
}

const token = getLocalToken()
const paper = await uploadTemporaryPaper(token)
try {
  const result = await runBrowser(token, paper)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await removeTemporaryPaper(token, paper.id)
}
