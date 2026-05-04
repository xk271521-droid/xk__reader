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
  const { annotations, loading: annLoading, createAnnotation, deleteAnnotation } = useAnnotations(
    activeView !== 'home' ? Number(activeView) : null
  )
  const activeFileUrl = activeView !== 'home' ? getPaperFileUrl(Number(activeView)) : null
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

  function handleLogout() {
    clearStoredAuthToken()
    localStorage.removeItem('xk_read_recent')
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
                      closePaper(paper.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        closePaper(paper.id)
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
            totalMatches={pdfSearch.totalMatches}
            onSearchPrev={pdfSearch.onSearchPrev}
            onSearchNext={pdfSearch.onSearchNext}
            currentPaperId={activeView !== 'home' ? Number(activeView) : null}
            annotations={annotations}
            onCreateAnnotation={createAnnotation}
            onDeleteAnnotation={deleteAnnotation}
            onAskAI={function () { if (selectionCard.text) { setActiveWorkspacePanel("ask"); setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = selectionCard.text; return n }) } }}
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
            selectionCard={selectionCard}
            width={workspacePanel.width}
            chatMessages={chatMessages[activeView] || []}
            chatInput={chatInput[activeView] || ''}
            chatAsking={chatAsking[activeView] || false}
            providerLabel={providerLabel}
            onChatInputChange={function (v) { setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = v; return n }) }}
            onChatSubmit={async function (q) {
              if (!q || !q.trim()) return
              var msg = chatMessages[activeView] || []
              msg = msg.concat([{ role: 'user', text: q }])
              setChatMessages(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = msg; return n })
              setChatInput(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = ''; return n })
              setChatAsking(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = true; return n })
              try {
                var resp = await fetch('/api/ask', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getStoredAuthToken() || '') },
                  body: JSON.stringify({ question: q, selected_text: selectionCard.text || '', paper_title: metadata.title || fileName || '', summary: activePaperSummary || '', provider_id: null })
                })
                var d = await resp.json()
                var ans = d.answer || ''
                setChatMessages(function (p) {
                  var n = {}; for (var k in p) n[k] = p[k]
                  n[activeView] = msg.concat([{ role: 'ai', text: ans }])
                  return n
                })
              } catch (_) {}
              setChatAsking(function (p) { var n = {}; for (var k in p) n[k] = p[k]; n[activeView] = false; return n })
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
