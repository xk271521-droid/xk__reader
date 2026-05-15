import { useMemo, useState } from 'react'
import { BookOpenText, Compass, Database, Globe, Search, Sparkles } from 'lucide-react'
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
import { LiteratureEngineSidebar } from './LiteratureEngineSidebar'

function getAccessLabel(accessType) {
  if (accessType === 'free') return '开放获取'
  if (accessType === 'mixed') return '混合访问'
  if (accessType === 'subscription') return '订阅型'
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

export function LiteratureSearchPage() {
  const [query, setQuery] = useState('')
  const [activeEngineId, setActiveEngineId] = useState(literatureSearchEngines[0]?.id || '')

  const activeEngine = getLiteratureEngineById(activeEngineId)
  const supportsPrefill = canPrefillLiteratureQuery(activeEngine)
  const heroAccent = {
    '--engine-color': activeEngine.color,
  }

  const helperCards = useMemo(() => ([
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
  ]), [activeEngine.bestFor, activeEngine.coverage])

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

                <div className="literature-search-meta literature-search-meta--single">
                  <div className="literature-search-tip">
                    <Sparkles />
                    <span>
                      {supportsPrefill
                        ? '当前站点支持把关键词直接带过去。'
                        : '当前站点更适合先打开首页，再在站内继续细分筛选。'}
                    </span>
                  </div>
                </div>
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
                        <Badge variant="outline" className="literature-panel-badge">{item.label}</Badge>
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
                <Badge variant="outline" className="literature-panel-badge">当前站点</Badge>
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
