import { useEffect, useRef, useState } from 'react'
import { Brain, Copy, LogIn, LogOut, Settings2, UserRound } from 'lucide-react'
import { AiConfigPage } from '../components/account/AiConfigPage'
import { UserCenterPage } from '../components/account/UserCenterPage'
import { HomePage } from '../components/home/HomePage'
import { StatusPanel } from '../components/layout/StatusPanel'
import { UtilityRail } from '../components/layout/UtilityRail'
import { PaperReader } from '../components/reader/PaperReader'
import { SelectionInsightPanel } from '../components/reader/SelectionInsightPanel'
import { SideWorkspacePanel } from '../components/reader/SideWorkspacePanel'
import Login from '../log/Login.jsx'
import { useBackendStatus } from '../hooks/useBackendStatus'
import { usePdfReader } from '../hooks/usePdfReader'
import { useAnnotations } from '../hooks/useAnnotations'
import { usePdfSearch } from '../hooks/usePdfSearch'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { useSelectionInsight } from '../hooks/useSelectionInsight'
import {
  clearStoredAuthToken,
  fetchCurrentUser,
  getStoredAuthToken,
  storeAuthToken,
  uploadAvatar,
  updateCurrentUser,
} from '../services/authApi'
import { getPaperFileUrl } from '../services/paperReaderApi'
import 'pdfjs-dist/web/pdf_viewer.css'
import '../styles/app.css'

function App() {
  const readerRef = useRef(null)
  const userMenuRef = useRef(null)
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState('')
  const [activeTool, setActiveTool] = useState('select')
  const [isThumbnailsOpen, setIsThumbnailsOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [isAuthViewOpen, setIsAuthViewOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [accountSection, setAccountSection] = useState('')
  const [chatMessages, setChatMessages] = useState({})
  const [chatInput, setChatInput] = useState({})
  const [chatAsking, setChatAsking] = useState({})
  const [notesByPaper, setNotesByPaper] = useState({})
  const [providerLabel, setProviderLabel] = useState('')
  const serverStatus = useBackendStatus()

  // Get active AI provider name
  useEffect(function () {
    fetch('/api/providers', { headers: getStoredAuthToken() ? { Authorization: 'Bearer ' + getStoredAuthToken() } : {} })
      .then(function (r) { return r.json() })
      .then(function (d) {
        var a = (d && d.providers || []).find(function (p) { return p.is_active })
        if (a) setProviderLabel(a.label + ' / ' + a.model)
      })
      .catch(function () {})
  }, [currentUser])

  const pdfSearch = usePdfSearch(readerRef)

  const {
    activeView,
    assignPaperToFolder,
    cancelImportConflict,
    closePaper,
    createFolder,
    deletePaper,
    deleteFolder,
    error,
    fileInputRef,
    fileName,
    fitToWidth,
    folders,
    goHome,
    handleFileChange,
    importConflict,
    isImporting,
    isLoading,
    metadata,
    openFilePicker,
    openTabs,
    pageMetrics,
    pageNumber,
    pageNumbers,
    pdfDocument,
    recentPapers,
    readingStats,
    recentReadings,
    renameFolder,
    resolveImportConflict,
    scale,
    setCurrentPage,
    switchToPaper,
    totalPages,
    uncategorizedFolderId,
    zoomIn,
    zoomOut,
    zoomBy,
    activePaperSummary,
  } = usePdfReader({ currentUser })
  const activePaperId = activeView !== 'home' ? Number(activeView) : null
  const {
    annotations,
    loading: annLoading,
    createAnnotation,
    deleteAnnotation,
    eraseAnnotationRange,
    restoreAnnotations,
  } = useAnnotations(activePaperId)
  const [annotationUndoStacks, setAnnotationUndoStacks] = useState({})
  const eraseUndoSessionsRef = useRef(new Set())
  const activeFileUrl = activePaperId ? getPaperFileUrl(activePaperId) : null
  useEffect(() => {
    if (activeTool !== 'download' || !activeFileUrl) return
    const a = document.createElement('a')
    a.href = activeFileUrl
    a.download = fileName || 'paper.pdf'
    a.click()
    setActiveTool('select')
  }, [activeTool, activeFileUrl, fileName])

  const thumbnailPanel = useResizableWidth({
    initialWidth: 300,
    minWidth: 160,
    maxWidth: 420,
  })
  const insightPanel = useResizableWidth({
    initialWidth: 300,
    minWidth: 180,
    maxWidth: 460,
  })
  const workspacePanel = useResizableWidth({
    initialWidth: 380,
    minWidth: 300,
    maxWidth: 620,
  })

  const { selectionCard, handleSelection, dismissSelectionCard, setDomain, aiEnabled, toggleAI } = useSelectionInsight({
    readerRef,
    paperTitle: metadata.title || fileName,
    paperSummary: activePaperSummary,
  })

  useEffect(() => {
    let cancelled = false
    const token = getStoredAuthToken()

    if (!token) {
      return undefined
    }

    async function restoreSession() {
      try {
        const user = await fetchCurrentUser(token)
        if (!cancelled) {
          setCurrentUser(user)
        }
      } catch {
        clearStoredAuthToken()
        if (!cancelled) {
          setCurrentUser(null)
        }
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  // Toolbar button ripple effect
  useEffect(() => {
    function handleRipple(event) {
      const btn = event.target.closest('.toolbar-icon-button, .toolbar-tool')
      if (!btn) return

      const ripple = document.createElement('span')
      ripple.className = 'ripple-effect'
      const rect = btn.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`
      ripple.style.width = `${size}px`
      ripple.style.height = `${size}px`
      btn.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove())
    }

    document.addEventListener('click', handleRipple)
    return () => document.removeEventListener('click', handleRipple)
  }, [])

  useEffect(() => {
    if (!isUserMenuOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isUserMenuOpen])

  const isHomeView = activeView === 'home'
  const isReaderView = activeView !== 'home'
  const isAccountView = Boolean(accountSection)
  const userInitials = (currentUser?.nickname || 'xk').slice(0, 2).toLowerCase()
  const paperReaderState = {
    error,
    fileName,
    fitToWidth,
    isLoading,
    metadata,
    pageMetrics,
    pageNumber,
    pageNumbers,
    pdfDocument,
    scale,
    setCurrentPage,
    totalPages,
    zoomIn,
    zoomOut,
  }
  const canUndoAnnotation = activePaperId
    ? (annotationUndoStacks[activePaperId]?.length || 0) > 0
    : false
  const activeNoteText = activePaperId ? (notesByPaper[activePaperId] || '') : ''

  function snapshotAnnotations(items) {
    return (items || []).map((annotation) => ({
      page_number: annotation.page_number,
      start_char: annotation.start_char,
      end_char: annotation.end_char,
      quote_text: annotation.quote_text,
      rects: annotation.rects || [],
      type: annotation.type,
      color: annotation.color || null,
      source: annotation.source || 'native',
      geometry_version: annotation.geometry_version || 'v1',
    }))
  }

  function pushAnnotationUndo(paperId, snapshot) {
    if (!paperId) return
    setAnnotationUndoStacks((prev) => {
      const stack = prev[paperId] || []
      return {
        ...prev,
        [paperId]: [...stack, snapshot].slice(-80),
      }
    })
  }

  function clearAnnotationUndo(paperId) {
    if (!paperId) return
    setAnnotationUndoStacks((prev) => {
      const next = { ...prev }
      delete next[paperId]
      return next
    })
    for (const sessionKey of Array.from(eraseUndoSessionsRef.current)) {
      if (sessionKey.startsWith(`${paperId}:`)) {
        eraseUndoSessionsRef.current.delete(sessionKey)
      }
    }
  }

  function appendNoteBlock(blockText) {
    if (!activePaperId || !blockText) return
    setNotesByPaper((previous) => {
      const current = previous[activePaperId] || ''
      const separator = current.trim() ? '\n\n' : ''
      return {
        ...previous,
        [activePaperId]: `${current}${separator}${blockText}`.trim(),
      }
    })
  }

  function handleScreenshotTranslate(selectionPayload) {
    if (!selectionPayload?.text) return
    handleSelection(selectionPayload)
  }

  function handleAskAIText(text) {
    if (!text) return
    setActiveWorkspacePanel('ask')
    setChatInput(function (previous) {
      var next = {}
      for (var key in previous) next[key] = previous[key]
      next[activeView] = text
      return next
    })
  }

  function handleInsertScreenshotNote(payload) {
    if (!activePaperId || !payload?.text) return
    setActiveWorkspacePanel('notes')
    const pageLabel = payload.pageNumber ? `p.${payload.pageNumber}` : 'p.?'
    appendNoteBlock(`[截图笔记 ${pageLabel}]\n原文片段：\n${payload.text}`)
  }

  async function handleCreateAnnotation(payload) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await createAnnotation(payload)
    if (result) pushAnnotationUndo(activePaperId, before)
    return result
  }

  async function handleDeleteAnnotation(annotationId) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await deleteAnnotation(annotationId)
    if (result) pushAnnotationUndo(activePaperId, before)
    return result
  }

  async function handleEraseAnnotationRange(payload) {
    if (!activePaperId) return null
    const before = snapshotAnnotations(annotations)
    const result = await eraseAnnotationRange(payload)
    if (!result) return null

    const sessionKey = payload?.eraseSessionId
      ? `${activePaperId}:${payload.eraseSessionId}`
      : ''
    if (!sessionKey || !eraseUndoSessionsRef.current.has(sessionKey)) {
      pushAnnotationUndo(activePaperId, before)
      if (sessionKey) eraseUndoSessionsRef.current.add(sessionKey)
    }
    return result
  }

  async function handleUndoAnnotation() {
    if (!activePaperId) return
    const stack = annotationUndoStacks[activePaperId] || []
    const previous = stack[stack.length - 1]
    if (!previous) return

    const result = await restoreAnnotations(previous)
    if (!result) return

    setAnnotationUndoStacks((prev) => ({
      ...prev,
      [activePaperId]: (prev[activePaperId] || []).slice(0, -1),
    }))
  }

  function handleClosePaper(paperId) {
    clearAnnotationUndo(paperId)
    closePaper(paperId)
  }

  function handleLogout() {
    clearStoredAuthToken()
    localStorage.removeItem('xk_read_recent')
    setAnnotationUndoStacks({})
    eraseUndoSessionsRef.current.clear()
    setCurrentUser(null)
    setIsUserMenuOpen(false)
    setAccountSection('')
    goHome()
  }

  function openAccountSection(section) {
    setAccountSection(section)
    setIsUserMenuOpen(false)
  }

  function handleCopyUid() {
    if (!currentUser?.uid || !navigator.clipboard) {
      return
    }

    navigator.clipboard.writeText(currentUser.uid).catch(() => {})
  }

  async function handleSaveProfile(payload) {
    const user = await updateCurrentUser(payload)
    setCurrentUser(user)
    return user
  }

  async function handleUploadAvatar(file) {
    const user = await uploadAvatar(file)
    setCurrentUser(user)
    return user
  }

  return (
    <div
      className={`app-shell${isAuthViewOpen ? ' app-shell--auth' : ''}${
        !isAuthViewOpen && isAccountView ? ' app-shell--account' : ''
      }`}
    >
      <input
        ref={fileInputRef}
        accept="application/pdf"
        className="hidden-input"
        multiple
        onChange={handleFileChange}
        type="file"
      />

      {!isAuthViewOpen && !isAccountView ? (
        <header className="topbar">
          <div className="brand-tabs">
            <div className="brand-mark">xk</div>
            <strong>xk阅读</strong>
            <div className="topbar-tabs">
              <button
                type="button"
                className={`doc-tab doc-tab--home${isHomeView ? ' is-active' : ''}`}
                onClick={() => {
                  setAccountSection('')
                  goHome()
                }}
              >
                首页
              </button>

              {openTabs.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  className={`doc-tab${activeView === paper.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setAccountSection('')
                    switchToPaper(paper.id)
                  }}
                >
                  <span className="doc-tab__label">{paper.fileName.replace(/\.pdf$/i, '')}</span>
                  <span
                    aria-label={`关闭 ${paper.fileName}`}
                    className="doc-tab__close"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleClosePaper(paper.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        handleClosePaper(paper.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-meta">
            <StatusPanel label={serverStatus} />
            <button type="button" className="topbar-action">
              通知
            </button>
            <button type="button" className="topbar-action">
              客服
            </button>

            {currentUser ? (
              <div
                ref={userMenuRef}
                className="topbar-user-wrap"
                onMouseEnter={() => setIsUserMenuOpen(true)}
              >
                <button
                  type="button"
                  className="topbar-user"
                  aria-expanded={isUserMenuOpen}
                  onClick={() => setIsUserMenuOpen((value) => !value)}
                >
                  <span className="topbar-user__avatar">
                    {currentUser.avatar_url ? (
                      <img src={currentUser.avatar_url} alt={currentUser.nickname} />
                    ) : (
                      userInitials
                    )}
                  </span>
                  <span className="topbar-user__name">{currentUser.nickname}</span>
                </button>

                {isUserMenuOpen ? (
                  <div className="user-menu">
                    <div className="user-menu__header">
                      <div className="user-menu__avatar">
                        {currentUser.avatar_url ? (
                          <img src={currentUser.avatar_url} alt={currentUser.nickname} />
                        ) : (
                          userInitials
                        )}
                      </div>
                      <div className="user-menu__identity">
                        <strong>{currentUser.nickname}</strong>
                        <div className="user-menu__uid-inline">
                          <span>{`uid: ${currentUser.uid}`}</span>
                          <button type="button" onClick={handleCopyUid} aria-label="复制 UID">
                            <Copy />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="user-menu__actions">
                      <button type="button" onClick={() => openAccountSection('profile')}>
                        <UserRound />
                        <span>个人中心</span>
                      </button>
                      <button type="button" onClick={() => openAccountSection('settings')}>
                        <Settings2 />
                        <span>系统设置</span>
                      </button>
                      <button type="button" onClick={() => openAccountSection('ai-config')}>
                        <Brain />
                        <span>AI 配置</span>
                      </button>
                      <button type="button" className="is-danger" onClick={handleLogout}>
                        <LogOut />
                        <span>退出登录</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="topbar-action topbar-action--login"
                onClick={() => {
                  setAuthMode('login')
                  setIsAuthViewOpen(true)
                }}
              >
                <LogIn />
                <span>登录</span>
              </button>
            )}
          </div>
        </header>
      ) : null}

      <main className="workspace">
        {isAuthViewOpen ? (
          <div className="workspace-view workspace-view--auth is-active">
            <Login
              key={authMode}
              initialMode={authMode}
              onAuthSuccess={(authPayload) => {
                storeAuthToken(authPayload.access_token)
                setCurrentUser(authPayload.user)
                setIsAuthViewOpen(false)
              }}
            />
          </div>
        ) : null}

        <div
          className={`workspace-view workspace-view--home${
            !isAuthViewOpen && !isAccountView && isHomeView ? ' is-active' : ' is-hidden'
          }`}
        >
          <HomePage
            folders={folders}
            importConflict={importConflict}
            isImporting={isImporting}
            onCancelImportConflict={cancelImportConflict}
            onCreateFolder={createFolder}
            onDeleteFolder={deleteFolder}
            onDeletePaper={deletePaper}
            onMovePaper={assignPaperToFolder}
            onOpenFilePicker={openFilePicker}
            onOpenPaper={switchToPaper}
            onRenameFolder={renameFolder}
            onResolveImportConflict={resolveImportConflict}
            recentPapers={recentPapers}
            recentReadings={recentReadings}
            readingStats={readingStats}
            uncategorizedFolderId={uncategorizedFolderId}
          />
        </div>

        <div
          className={`workspace-view workspace-view--reader${
            !isAuthViewOpen && !isAccountView && isReaderView ? ' is-active' : ' is-hidden'
          }`}
        >
          <PaperReader
            pdfReader={paperReaderState}
            readerRef={readerRef}
            activeTool={activeTool}
            isThumbnailsOpen={isThumbnailsOpen}
            thumbnailWidth={thumbnailPanel.width}
            onThumbnailResizeStart={thumbnailPanel.startResizeLeft}
            onToggleThumbnails={() => setIsThumbnailsOpen((v) => !v)}
            onToolChange={setActiveTool}
            onSelect={handleSelection}
            onThumbnailPageClick={(pageNum) => {
              setCurrentPage(pageNum)
              const el = readerRef.current?.querySelector(`[data-page-number="${pageNum}"]`)
              if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' })
            }}
            onWheelZoom={zoomBy}
            searchTerm={pdfSearch.searchTerm}
            onSearchChange={pdfSearch.onSearchChange}
            matchIndex={pdfSearch.matchIndex}
            matches={pdfSearch.matches}
            onSearchExecute={pdfSearch.performSearch}
            totalMatches={pdfSearch.totalMatches}
            onSearchPrev={pdfSearch.onSearchPrev}
            onSearchNext={pdfSearch.onSearchNext}
            canUndoAnnotation={canUndoAnnotation}
            onUndoAnnotation={handleUndoAnnotation}
            currentPaperId={activePaperId}
            annotations={annotations}
            onCreateAnnotation={handleCreateAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            onEraseAnnotationRange={handleEraseAnnotationRange}
            onAskAI={function () { if (selectionCard.text) { setActiveWorkspacePanel("ask"); setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = selectionCard.text; return n }) } }}
            onScreenshotTranslate={handleScreenshotTranslate}
            onScreenshotAskAI={handleAskAIText}
            onScreenshotInsertNote={handleInsertScreenshotNote}
          />

          <div
            aria-label="调整即时理解面板宽度"
            aria-orientation="vertical"
            className="workspace-resizer"
            onPointerDown={insightPanel.startResize}
            role="separator"
          />

          <SelectionInsightPanel
            domain={selectionCard.domain}
            onDomainChange={setDomain}
            selectionCard={selectionCard}
            width={insightPanel.width}
            aiEnabled={aiEnabled}
            onToggleAI={toggleAI}
          />

          {activeWorkspacePanel ? (
            <div
              aria-label="调整工作面板宽度"
              aria-orientation="vertical"
              className="workspace-resizer"
              onPointerDown={workspacePanel.startResize}
              role="separator"
            />
          ) : null}

          <SideWorkspacePanel
            activePanel={activeWorkspacePanel}
            fileName={fileName}
            metadata={metadata}
            currentUser={currentUser}
            selectionCard={selectionCard}
            width={workspacePanel.width}
            chatMessages={chatMessages[activeView] || []}
            chatInput={chatInput[activeView] || ''}
            chatAsking={chatAsking[activeView] || false}
            providerLabel={providerLabel}
            noteText={activeNoteText}
            onNoteChange={function (value) {
              if (!activePaperId) return
              setNotesByPaper(function (previous) {
                var next = {}
                for (var key in previous) next[key] = previous[key]
                next[activePaperId] = value
                return next
              })
            }}
            onChatInputChange={function (v) { setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = v; return n }) }}
            onChatSubmit={async function (q) {
              if (!q || !q.trim()) return
              var chatView = activeView
              var baseMessages = chatMessages[chatView] || []
              var streamingAi = { role: 'ai', text: '' }
              var msg = baseMessages.concat([{ role: 'user', text: q }, streamingAi])
              setChatMessages(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[chatView] = msg; return n })
              setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[chatView] = ''; return n })
              setChatAsking(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[chatView] = true; return n })
              try {
                var resp = await fetch('/api/ask-stream', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getStoredAuthToken() || '') },
                  body: JSON.stringify({ question: q, selected_text: selectionCard.text || '', paper_title: metadata.title || fileName || '', summary: activePaperSummary || '', provider_id: null })
                })
                if (resp.ok && resp.body) {
                  var reader = resp.body.getReader()
                  var decoder = new TextDecoder()
                  var buffer = ''
                  var aiText = ''
                  while (true) {
                    var chunk = await reader.read()
                    if (chunk.done) break
                    buffer += decoder.decode(chunk.value, { stream: true })
                    var parts = buffer.split('\n')
                    buffer = parts.pop() || ''
                    for (var i = 0; i < parts.length; i += 1) {
                      var line = parts[i]
                      if (!line.startsWith('data: ')) continue
                      aiText += line.slice(6)
                      setChatMessages(function (p) {
                        var n = {}; for (var k in p) n[k] = p[k]
                        n[chatView] = (n[chatView] || []).map(function (entry, idx, arr) {
                          if (idx === arr.length - 1 && entry.role === 'ai') return { role: 'ai', text: aiText }
                          return entry
                        })
                        return n
                      })
                      await new Promise(function (resolve) { setTimeout(resolve, 0) })
                    }
                  }
                  if (!aiText.trim()) {
                    setChatMessages(function (p) {
                      var n = {}; for (var k in p) n[k] = p[k]
                      n[chatView] = (n[chatView] || []).map(function (entry, idx, arr) {
                        if (idx === arr.length - 1 && entry.role === 'ai') return { role: 'ai', text: 'AI 暂时没有返回内容。' }
                        return entry
                      })
                      return n
                    })
                  }
                } else {
                  throw new Error('stream failed')
                }
              } catch (_) {}
              setChatAsking(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[chatView] = false; return n })
            }}
            onAskFromSelection={function (text) {
              setActiveWorkspacePanel('ask')
              setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = text; return n })
            }}
          />

          <UtilityRail activeItem={activeWorkspacePanel} onSelect={setActiveWorkspacePanel} />
        </div>

        <div
          className={`workspace-view workspace-view--account${
            !isAuthViewOpen && isAccountView ? ' is-active' : ' is-hidden'
          }`}
        >
          {accountSection === 'ai-config' ? (
            <AiConfigPage onBack={() => setAccountSection('')} />
          ) : (
            <UserCenterPage
            key={[
              accountSection || 'profile',
              currentUser?.uid || 'guest',
              currentUser?.nickname || '',
              currentUser?.education || '',
              currentUser?.occupation || '',
              currentUser?.organization || '',
              currentUser?.discipline || '',
              currentUser?.avatar_url || '',
            ].join(':')}
            activeSection={accountSection || 'profile'}
            currentUser={currentUser}
            onBack={() => setAccountSection('')}
            onSaveProfile={handleSaveProfile}
            onSectionChange={setAccountSection}
            onUploadAvatar={handleUploadAvatar}
          />
          )}
        </div>
      </main>
    </div>
  )
}

export default App
