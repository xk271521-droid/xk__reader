import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Compass,
  Database,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  buildLiteratureSearchUrl,
  canPrefillLiteratureQuery,
  getLiteratureEngineById,
  literatureSearchEngines,
} from '@/data/literatureSearchEngines'
import { isDesktopShell } from '../../utils/desktopShell'
import { LiteratureEngineSidebar } from './LiteratureEngineSidebar'
import '../../styles/literature-desktop.css'

function getAccessLabel(accessType) {
  if (accessType === 'free') return '开放获取'
  if (accessType === 'mixed') return '混合访问'
  if (accessType === 'subscription') return '订阅访问'
  return '受限入口'
}

function PreviewCard({ engine }) {
  if (engine.previewImage) {
    return (
      <div className="literature-preview-card literature-preview-card--image">
        <img src={engine.previewImage} alt={`${engine.name} 首页预览`} />
      </div>
    )
  }

  return (
    <div
      className="literature-preview-card literature-preview-card--fallback"
      style={{ '--engine-color': engine.color }}
    >
      <div className="literature-preview-card__glow" />
      <div className="literature-preview-card__window">
        <div className="literature-preview-card__window-bar">
          <span />
          <span />
          <span />
        </div>
        <div className="literature-preview-card__window-body">
          <Badge
            variant="outline"
            className="literature-panel-badge literature-panel-badge--engine"
            style={{ '--engine-color': engine.color }}
          >
            {engine.shortName}
          </Badge>
          <strong>{engine.previewImageFallbackMode?.title || engine.name}</strong>
          <p>{engine.previewImageFallbackMode?.subtitle || engine.coverage}</p>
        </div>
      </div>
    </div>
  )
}

function DesktopLiteratureBrowser() {
  const defaultEngine = literatureSearchEngines.find((engine) => engine.id === 'cnki') || literatureSearchEngines[0]
  const [activeEngineId, setActiveEngineId] = useState(defaultEngine?.id || '')
  const [query, setQuery] = useState('')
  const [currentUrl, setCurrentUrl] = useState(defaultEngine?.homepageUrl || 'about:blank')
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const webviewRef = useRef(null)

  const activeEngine = getLiteratureEngineById(activeEngineId)

  function updateNavigationState(webview = webviewRef.current) {
    setCanGoBack(Boolean(webview?.canGoBack?.()))
    setCanGoForward(Boolean(webview?.canGoForward?.()))
  }

  function loadUrl(url) {
    if (!url) return
    setCurrentUrl(url)
    if (webviewRef.current?.loadURL) {
      webviewRef.current.loadURL(url)
    }
  }

  function handleEngineSelect(engine) {
    setActiveEngineId(engine.id)
    setQuery('')
    loadUrl(engine.homepageUrl)
  }

  function handleSearch(event) {
    event.preventDefault()
    loadUrl(buildLiteratureSearchUrl(activeEngine, query))
  }

  function handleGoBack() {
    if (webviewRef.current?.canGoBack?.()) {
      webviewRef.current.goBack()
    }
  }

  function handleGoForward() {
    if (webviewRef.current?.canGoForward?.()) {
      webviewRef.current.goForward()
    }
  }

  function handleReload() {
    webviewRef.current?.reload?.()
  }

  function handleWebviewRef(node) {
    if (!node || webviewRef.current === node) return
    webviewRef.current = node

    node.addEventListener('did-start-loading', () => setIsLoading(true))
    node.addEventListener('did-stop-loading', () => {
      setIsLoading(false)
      updateNavigationState(node)
    })
    node.addEventListener('did-navigate', (event) => {
      setCurrentUrl(event.url || node.getURL?.() || currentUrl)
      updateNavigationState(node)
    })
    node.addEventListener('did-navigate-in-page', (event) => {
      setCurrentUrl(event.url || node.getURL?.() || currentUrl)
      updateNavigationState(node)
    })
  }

  return (
    <section className="literature-shell literature-shell--desktop-browser">
      <aside className="literature-desktop-sidebar">
        <button type="button" className="literature-desktop-add-engine">
          <Plus />
          <span>添加搜索引擎</span>
        </button>

        <div className="literature-desktop-engine-list">
          {literatureSearchEngines.map((engine) => (
            <button
              key={engine.id}
              type="button"
              className={engine.id === activeEngineId ? 'is-active' : ''}
              onClick={() => handleEngineSelect(engine)}
            >
              <span>{engine.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="literature-browser-main">
        <div className="literature-browser-toolbar">
          <div className="literature-browser-nav">
            <button type="button" disabled={!canGoBack} onClick={handleGoBack} aria-label="后退">
              <ArrowLeft />
            </button>
            <button type="button" disabled={!canGoForward} onClick={handleGoForward} aria-label="前进">
              <ArrowRight />
            </button>
            <button type="button" onClick={handleReload} aria-label="刷新">
              <RefreshCw className={isLoading ? 'is-loading' : ''} />
            </button>
          </div>

          <form className="literature-browser-search" onSubmit={handleSearch}>
            <strong>{activeEngine.name}</strong>
            <label>
              <Search />
              <input
                type="search"
                value={query}
                placeholder="输入主题、作者、关键词"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit">检索</button>
          </form>
        </div>

        <div className="literature-browser-frame">
          <webview
            ref={handleWebviewRef}
            className="literature-browser-webview"
            src={currentUrl}
            partition="persist:xk-literature-browser"
          />
        </div>
      </main>
    </section>
  )
}

function WebLiteratureSearchPage() {
  const [query, setQuery] = useState('')
  const [activeEngineId, setActiveEngineId] = useState(literatureSearchEngines[0]?.id || '')

  const activeEngine = getLiteratureEngineById(activeEngineId)
  const supportsPrefill = canPrefillLiteratureQuery(activeEngine)
  const heroAccent = {
    '--engine-color': activeEngine.color,
  }

  const helperCards = useMemo(
    () => [
      {
        label: '适合查什么',
        value: activeEngine.bestFor,
        icon: BookOpenText,
      },
      {
        label: '覆盖范围',
        value: activeEngine.coverage,
        icon: Database,
      },
    ],
    [activeEngine.bestFor, activeEngine.coverage],
  )

  function handleSubmit(event) {
    event.preventDefault()
    const url = buildLiteratureSearchUrl(activeEngine, query)
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="literature-shell">
      <LiteratureEngineSidebar
        activeEngineId={activeEngineId}
        onSelect={setActiveEngineId}
      />

      <div className="literature-main literature-main--single">
        <div className="literature-workbench">
          <div className="literature-workbench__primary">
            <header className="literature-hero literature-hero--single" style={heroAccent}>
              <div className="literature-hero__copy">
                <div className="literature-hero__meta">
                  <Badge
                    variant="outline"
                    className="literature-panel-badge literature-panel-badge--engine"
                    style={{ '--engine-color': activeEngine.color }}
                  >
                    {activeEngine.shortName}
                  </Badge>
                  <span>{activeEngine.coverage}</span>
                </div>
                <h1>{activeEngine.name}</h1>
                <p>{activeEngine.description}</p>
              </div>

              <div className="literature-hero__aside">
                <div className="literature-hero__orbit">
                  <span>{activeEngine.shortName}</span>
                </div>
              </div>
            </header>

            <Card className="literature-search-panel literature-search-panel--single">
              <CardContent className="px-0 py-0">
                <form className="literature-search-form literature-search-form--single" onSubmit={handleSubmit}>
                  <label className="literature-search-input">
                    <Search />
                    <Input
                      type="search"
                      value={query}
                      placeholder="输入主题、作者、疾病、技术路线或核心术语"
                      className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>

                  <Button type="submit" size="lg">
                    <Globe />
                    <span>{supportsPrefill ? `去 ${activeEngine.name} 检索` : `打开 ${activeEngine.name}`}</span>
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="literature-helper-grid">
              {helperCards.map((item) => {
                const Icon = item.icon
                return (
                  <Card key={item.label} className="literature-helper-card">
                    <CardHeader>
                      <div className="literature-helper-card__label">
                        <Icon />
                        <Badge variant="outline" className="literature-panel-badge">
                          {item.label}
                        </Badge>
                      </div>
                      <CardTitle>{item.value}</CardTitle>
                    </CardHeader>
                  </Card>
                )
              })}
            </div>

            <Card className="literature-preview-panel literature-preview-panel--main">
              <CardHeader>
                <Badge variant="outline" className="literature-panel-badge">首页预览</Badge>
                <CardTitle>{activeEngine.name}</CardTitle>
                <CardDescription>用于快速建立站点界面和资源类型的直觉。</CardDescription>
              </CardHeader>
              <CardContent className="literature-preview-panel__content">
                <PreviewCard engine={activeEngine} />
              </CardContent>
            </Card>
          </div>

          <aside className="literature-workbench__rail">
            <Card className="literature-info-card literature-info-card--compact">
              <CardHeader>
                <CardTitle>{activeEngine.name}</CardTitle>
                <CardDescription>{activeEngine.description}</CardDescription>
              </CardHeader>
              <CardContent className="literature-info-card__content">
                <div className="literature-info-card__facts">
                  <div className="literature-info-card__fact">
                    <span>资源类型</span>
                    <strong>{activeEngine.resourceType}</strong>
                  </div>
                  <div className="literature-info-card__fact">
                    <span>访问属性</span>
                    <strong>{getAccessLabel(activeEngine.accessType)}</strong>
                  </div>
                  <div className="literature-info-card__fact">
                    <span>全文可得性</span>
                    <strong>{activeEngine.fullTextAvailability}</strong>
                  </div>
                </div>

                <div className="literature-info-card__cluster">
                  <div className="literature-info-card__cluster-head">
                    <Compass />
                    <span>推荐检索词类型</span>
                  </div>
                  <div className="literature-info-card__tags">
                    {activeEngine.queryHints.map((hint) => (
                      <span key={hint}>{hint}</span>
                    ))}
                  </div>
                </div>

                <div className="literature-info-card__cluster">
                  <div className="literature-info-card__cluster-head">
                    <BookOpenText />
                    <span>适用学科</span>
                  </div>
                  <div className="literature-info-card__tags">
                    {activeEngine.disciplines.map((discipline) => (
                      <span key={discipline}>{discipline}</span>
                    ))}
                  </div>
                </div>

                <div className="literature-info-card__cluster">
                  <div className="literature-info-card__cluster-head">
                    <Sparkles />
                    <span>站点提示</span>
                  </div>
                  <div className="literature-info-card__tags">
                    {activeEngine.tips.map((tip) => (
                      <span key={tip}>{tip}</span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </section>
  )
}

export function LiteratureSearchPage() {
  return isDesktopShell() ? <DesktopLiteratureBrowser /> : <WebLiteratureSearchPage />
}
