import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const frontendUrl = process.env.XK_READER_FRONTEND_URL || 'http://127.0.0.1:5173'
const backendUrl = process.env.XK_READER_BACKEND_URL || 'http://127.0.0.1:8000'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const paperPath = 'C:\\Users\\xk\\Desktop\\论文文献资料\\2026-8-7\\STHELAR, a multi-tissue dataset linking spatial transcriptomics and histology for cell type annotation.pdf'
const profilePath = 'C:\\Users\\xk\\AppData\\Local\\Temp\\xk-reader-session-smoke-profile'

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

async function uploadTemporaryPaper(token, title, marker) {
  const source = readFileSync(paperPath)
  const uniquePdf = Buffer.concat([
    source,
    Buffer.from(`\n% XK reader session smoke ${marker} ${Date.now()}\n`),
  ])
  const form = new FormData()
  form.append('file', new Blob([uniquePdf], { type: 'application/pdf' }), `${title}.pdf`)
  form.append('metadata_json', JSON.stringify({ title }))
  const response = await fetch(`${backendUrl}/api/papers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) throw new Error(`临时文献上传失败：${response.status} ${await response.text()}`)
  const paper = await response.json()
  // The upload endpoint refreshes metadata from the source PDF. Give the
  // temporary documents distinct visible titles so the browser test can open
  // the intended row even when both source files share PDF metadata.
  const titleResponse = await fetch(`${backendUrl}/api/papers/${paper.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })
  if (!titleResponse.ok) throw new Error(`临时文献标题更新失败：${titleResponse.status}`)
  return titleResponse.json()
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
  let response
  try {
    response = await cdp.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
  } catch (error) {
    throw new Error(`${error.message}：${String(expression).slice(0, 260)}`)
  }
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result?.value
}

async function waitFor(cdp, expression, label, timeout = 45_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const value = await evaluate(cdp, expression)
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`${label}超时`)
}

async function clickPaperOnHome(cdp, title) {
  const opened = await evaluate(cdp, `(() => {
    const title = ${JSON.stringify(title)}
    const headings = [...document.querySelectorAll('.home-continue-card h3, .home-paper-row h3')]
      .filter((item) => item.textContent.includes(title))
    for (const heading of headings) {
      const target = heading.closest('.home-continue-card')?.querySelector('button.home-primary-button')
        || heading.closest('button.home-paper-row')
      if (target) {
        target.click()
        return true
      }
    }
    const libraryTarget = [...document.querySelectorAll('button.home-category-paper')]
      .find((item) => item.getAttribute('title') === title)
    if (libraryTarget) {
      libraryTarget.click()
      return true
    }
    return false
  })()`)
  if (!opened) throw new Error(`首页找不到文献：${title}`)
}

async function clickDocumentTab(cdp, title) {
  const clicked = await evaluate(cdp, `(() => {
    const tab = [...document.querySelectorAll('button.doc-tab')]
      .find((item) => item.querySelector('.doc-tab__label')?.textContent.includes(${JSON.stringify(title)}))
    if (!tab) return false
    tab.click()
    return true
  })()`)
  if (!clicked) throw new Error(`找不到文献标签：${title}`)
}

async function closeDocumentTab(cdp, title) {
  const clicked = await evaluate(cdp, `(() => {
    const tab = [...document.querySelectorAll('button.doc-tab')]
      .find((item) => item.querySelector('.doc-tab__label')?.textContent.includes(${JSON.stringify(title)}))
    const close = tab?.querySelector('.doc-tab__close')
    if (!close) return false
    close.click()
    return true
  })()`)
  if (!clicked) throw new Error(`找不到文献关闭按钮：${title}`)
}

async function clickHome(cdp) {
  const clicked = await evaluate(cdp, `(() => {
    const tab = document.querySelector('button.doc-tab--home')
    if (!tab) return false
    tab.click()
    return true
  })()`)
  if (!clicked) throw new Error('找不到首页标签')
}

async function runBrowser(token, firstPaper, secondPaper) {
  const firstLabel = String(firstPaper.title || firstPaper.file_name || '').replace(/\.pdf$/i, '')
  const secondLabel = String(secondPaper.title || secondPaper.file_name || '').replace(/\.pdf$/i, '')
  const debuggerPort = 9342
  const edge = spawn(edgePath, [
    `--remote-debugging-port=${debuggerPort}`,
    `--user-data-dir=${profilePath}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
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
    await waitFor(cdp, `location.origin === ${JSON.stringify(new URL(frontendUrl).origin)}`, '前端打开')
    await evaluate(
      cdp,
      `localStorage.setItem('xk_reader_auth_token', ${JSON.stringify(token)}); location.reload(); true`,
    )
    try {
      await waitFor(
        cdp,
        'document.body?.innerText.includes("XK Reader Session")',
        '文献首页',
      )
    } catch (error) {
      const debug = await evaluate(cdp, `JSON.stringify({
        location: location.href,
        body: document.body?.innerText.slice(0, 1800) || '',
        token: Boolean(localStorage.getItem('xk_reader_auth_token')),
        tabs: [...document.querySelectorAll('.doc-tab')].map((item) => item.textContent.trim()),
      })`)
      throw new Error(`${error.message}：${debug}`)
    }
    const libraryOpened = await evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll('button.home-sidebar__item')]
        .find((item) => item.textContent.trim() === '我的文献')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!libraryOpened) throw new Error('找不到“我的文献”入口')
    await waitFor(
      cdp,
      'document.querySelector(".home-sidebar__item.is-active")?.textContent.trim() === "我的文献"',
      '切换到我的文献',
    )
    await waitFor(
      cdp,
      'document.querySelectorAll(".home-category-paper").length > 0',
      '我的文献表格',
    )
    await clickPaperOnHome(cdp, firstLabel)
    try {
      await waitFor(
        cdp,
        'Boolean(document.querySelector(".reader-session.is-active .embedpdf-page img"))',
        '第一篇 PDFium 页面',
      )
    } catch (error) {
      const debug = await evaluate(cdp, `JSON.stringify((() => {
        const session = document.querySelector('.reader-session.is-active')
        return {
          activePaper: document.querySelector('.doc-tab.is-active')?.textContent.trim() || '',
          documentId: session?.querySelector('[data-embedpdf-document-id]')?.getAttribute('data-embedpdf-document-id') || '',
          state: session?.querySelector('.embedpdf-state')?.textContent.trim() || '',
          pageImages: session?.querySelectorAll('.embedpdf-page img').length || 0,
          pageCanvases: session?.querySelectorAll('.embedpdf-page canvas').length || 0,
          text: session?.innerText.slice(0, 900) || '',
        }
      })())`)
      throw new Error(`${error.message}：${debug}`)
    }
    await evaluate(cdp, `(() => {
      const shell = document.querySelector('.reader-session.is-active .embedpdf-reader-shell')
      if (!shell) return false
      shell.dataset.sessionSmokeMarker = 'first-reader'
      return true
    })()`)

    const navigationOpened = await evaluate(cdp, `(() => {
      const active = document.querySelector('.reader-session.is-active')
      const button = [...active.querySelectorAll('button')]
        .find((item) => item.getAttribute('aria-label') === '显示阅读导航')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!navigationOpened) throw new Error('第一篇文献无法打开阅读导航')
    await waitFor(
      cdp,
      'Boolean(document.querySelector(".reader-session.is-active button[aria-label=\\"跳转到第 3 页\\"]"))',
      '第三页缩略图',
    )
    await evaluate(
      cdp,
      'document.querySelector(".reader-session.is-active button[aria-label=\\"跳转到第 3 页\\"]").click()',
    )
    await waitFor(
      cdp,
      `[...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
        .some((item) => item.textContent.trim().startsWith('3 /'))`,
      '第一篇跳转第三页',
    )
    try {
      await waitFor(
        cdp,
        `JSON.parse(localStorage.getItem('xk_reader_sessions_v1') || '{}')
          ?.sessions?.[${JSON.stringify(String(firstPaper.id))}]?.pageNumber === 3`,
        '第一篇页码保存',
      )
    } catch (error) {
      const debug = await evaluate(cdp, `JSON.stringify({
        paperId: ${JSON.stringify(String(firstPaper.id))},
        sessions: JSON.parse(localStorage.getItem('xk_reader_sessions_v1') || '{}')?.sessions || {},
        indicators: [...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
          .map((item) => item.textContent.trim()),
        activeDocument: document.querySelector('.reader-session.is-active [data-embedpdf-document-id]')
          ?.getAttribute('data-embedpdf-document-id') || '',
      })`)
      throw new Error(`${error.message}：${debug}`)
    }

    const insightCollapsed = await evaluate(cdp, `(() => {
      const button = document.querySelector('button[aria-label="隐藏即时理解面板"]')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!insightCollapsed) throw new Error('找不到“隐藏即时理解面板”按钮')
    await waitFor(
      cdp,
      'Boolean(document.querySelector("button[aria-label=\\"展开即时理解面板\\"]"))',
      '隐藏即时理解面板',
    )
    const insightKeepAlive = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const shell = document.querySelector('[data-session-smoke-marker="first-reader"]')
      return {
        sameShell: Boolean(shell?.isConnected),
        renderedImages: shell?.querySelectorAll('.embedpdf-page img').length || 0,
      }
    })())`))
    if (!insightKeepAlive.sameShell || insightKeepAlive.renderedImages === 0) {
      throw new Error(`隐藏即时理解面板导致阅读器重建或空白：${JSON.stringify(insightKeepAlive)}`)
    }
    await evaluate(
      cdp,
      'document.querySelector("button[aria-label=\\"展开即时理解面板\\"]").click()',
    )
    await waitFor(
      cdp,
      'Boolean(document.querySelector("button[aria-label=\\"隐藏即时理解面板\\"]"))',
      '展开即时理解面板',
    )

    await clickHome(cdp)
    await waitFor(cdp, 'Boolean(document.querySelector(".workspace-view--home.is-active"))', '返回首页')
    const homeKeepAlive = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const shell = document.querySelector('[data-session-smoke-marker="first-reader"]')
      const session = shell?.closest('.reader-session')
      return {
        sameShell: Boolean(shell?.isConnected),
        sessionHidden: session?.classList.contains('is-hidden') || false,
        renderedImages: session?.querySelectorAll('.embedpdf-page img').length || 0,
      }
    })())`))
    if (!homeKeepAlive.sameShell || !homeKeepAlive.sessionHidden || homeKeepAlive.renderedImages === 0) {
      throw new Error(`首页切换没有保活第一篇阅读器：${JSON.stringify(homeKeepAlive)}`)
    }

    await clickPaperOnHome(cdp, secondLabel)
    await waitFor(
      cdp,
      'document.querySelectorAll(".reader-session").length === 2'
        + ' && Boolean(document.querySelector(".reader-session.is-active .embedpdf-page img"))',
      '第二篇 PDFium 页面',
    )
    const backgroundReset = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
      const firstSession = document.querySelector('[data-session-smoke-marker="first-reader"]')?.closest('.reader-session')
      const candidates = firstSession
        ? [...firstSession.querySelectorAll('*')].filter((element) => (
          element.scrollHeight > element.clientHeight && element.scrollHeight > 200
        ))
        : []
      const viewport = candidates.sort((left, right) => right.scrollHeight - left.scrollHeight)[0]
      if (!viewport) return { applied: false }
      viewport.scrollTop = 0
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
      return { applied: true, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
    })())`))
    if (!backgroundReset.applied) {
      throw new Error(`无法模拟后台阅读器的视口重置：${JSON.stringify(backgroundReset)}`)
    }
    await clickDocumentTab(cdp, firstLabel)
    await waitFor(
      cdp,
      'Boolean(document.querySelector(".reader-session.is-active [data-session-smoke-marker=\\"first-reader\\"]"))',
      '第一篇阅读器原实例恢复',
    )
    await waitFor(
      cdp,
      `[...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
        .some((item) => item.textContent.trim().startsWith('3 /'))`,
      '后台视口重置后恢复第三页',
    )
    const tabSwitch = JSON.parse(await evaluate(cdp, `JSON.stringify((() => ({
      sessionCount: document.querySelectorAll('.reader-session').length,
      firstReaderSame: Boolean(
        document.querySelector('.reader-session.is-active [data-session-smoke-marker="first-reader"]')
      ),
      pageIndicator: [...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
        .map((item) => item.textContent.trim())
        .find((text) => text.includes('/')) || '',
    }))())`))
    if (!tabSwitch.firstReaderSame || !tabSwitch.pageIndicator.startsWith('3 /')) {
      throw new Error(`文献标签切换重新创建或丢失阅读位置：${JSON.stringify(tabSwitch)}`)
    }
    const firstSessionAfterSwitch = await evaluate(
      cdp,
      `JSON.parse(localStorage.getItem('xk_reader_sessions_v1') || '{}')
        ?.sessions?.[${JSON.stringify(String(firstPaper.id))}]?.pageNumber || 0`,
    )
    if (firstSessionAfterSwitch !== 3) {
      throw new Error(`切换到另一篇时覆盖了第一篇阅读位置：${JSON.stringify({
        paperId: firstPaper.id,
        firstSessionAfterSwitch,
      })}`)
    }

    await closeDocumentTab(cdp, firstLabel)
    await waitFor(cdp, 'document.querySelectorAll(".reader-session").length === 1', '关闭第一篇标签')
    await clickHome(cdp)
    await waitFor(cdp, 'Boolean(document.querySelector(".workspace-view--home.is-active"))', '关闭后返回首页')
    await clickPaperOnHome(cdp, firstLabel)
    await waitFor(
      cdp,
      'document.querySelectorAll(".reader-session").length === 2'
        + ' && Boolean(document.querySelector(".reader-session.is-active .embedpdf-page img"))',
      '重新打开第一篇',
    )
    try {
      await waitFor(
        cdp,
        `[...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
          .some((item) => item.textContent.trim().startsWith('3 /'))`,
        '关闭后恢复第三页',
      )

      // The first successful page report can precede PDFium's final layout in
      // the desktop shell. Reproduce that late layout reset on the newly
      // created reader, then require the persisted page again instead of only
      // trusting the toolbar's initial value.
      const deferredReopenReset = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
        const session = document.querySelector('.reader-session.is-active')
        const viewport = session
          ? [...session.querySelectorAll('*')]
              .filter((element) => element.scrollHeight > element.clientHeight && element.scrollHeight > 200)
              .sort((left, right) => right.scrollHeight - left.scrollHeight)[0]
          : null
        if (!viewport) return { applied: false }
        viewport.scrollTop = 0
        viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
        return { applied: true, scrollTop: viewport.scrollTop }
      })())`))
      if (!deferredReopenReset.applied) {
        throw new Error(`重新打开后的 PDFium 视口不可滚动：${JSON.stringify(deferredReopenReset)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 260))
      await waitFor(
        cdp,
        `[...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
          .some((item) => item.textContent.trim().startsWith('3 /'))`,
        '重新打开后的延迟布局重置恢复第三页',
      )
    } catch (error) {
      const debug = await evaluate(cdp, `JSON.stringify({
        firstPaperId: ${JSON.stringify(String(firstPaper.id))},
        secondPaperId: ${JSON.stringify(String(secondPaper.id))},
        indicators: [...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
          .map((item) => item.textContent.trim()),
        sessions: JSON.parse(localStorage.getItem('xk_reader_sessions_v1') || '{}')?.sessions || {},
        reader: document.querySelector('.reader-session.is-active [data-embedpdf-document-id]')
          ?.getAttribute('data-embedpdf-document-id') || '',
      })`)
      throw new Error(`${error.message}：${debug}`)
    }
    const reopened = JSON.parse(await evaluate(cdp, `JSON.stringify((() => ({
      pageIndicator: [...document.querySelectorAll('.reader-session.is-active .toolbar-indicator')]
        .map((item) => item.textContent.trim())
        .find((text) => text.includes('/')) || '',
      savedPage: JSON.parse(localStorage.getItem('xk_reader_sessions_v1') || '{}')
        ?.sessions?.[${JSON.stringify(String(firstPaper.id))}]?.pageNumber || 0,
      recreatedAfterClose: !document.querySelector(
        '.reader-session.is-active [data-session-smoke-marker="first-reader"]'
      ),
    }))())`))
    return { insightKeepAlive, homeKeepAlive, tabSwitch, reopened }
  } finally {
    cdp?.close()
    edge.kill()
  }
}

const token = getLocalToken()
const suffix = Date.now()
const firstPaper = await uploadTemporaryPaper(
  token,
  `XK Reader Session A ${suffix}`,
  `xk-reader-session-a-${suffix}`,
)
const secondPaper = await uploadTemporaryPaper(
  token,
  `XK Reader Session B ${suffix}`,
  `xk-reader-session-b-${suffix}`,
)
try {
  const result = await runBrowser(token, firstPaper, secondPaper)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await Promise.all([
    removeTemporaryPaper(token, firstPaper.id),
    removeTemporaryPaper(token, secondPaper.id),
  ])
}
