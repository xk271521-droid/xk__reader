import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getLiteratureEngineById, groupLiteratureEngines } from '@/data/literatureSearchEngines'

function getAccessLabel(accessType) {
  if (accessType === 'free') return '开放'
  if (accessType === 'mixed') return '混合'
  if (accessType === 'subscription') return '订阅'
  return '受限'
}

export function LiteratureEngineSidebar({ activeEngineId, onSelect }) {
  const groupedEntries = useMemo(() => Array.from(groupLiteratureEngines().entries()), [])
  const activeEngine = getLiteratureEngineById(activeEngineId)
  const activeGroup = activeEngine?.resourceType || groupedEntries[0]?.[0] || ''
  const [openGroups, setOpenGroups] = useState({})

  useEffect(() => {
    setOpenGroups((current) => {
      if (current[activeGroup]) return current
      return { [activeGroup]: true }
    })
  }, [activeGroup])

  return (
    <aside className="literature-sidebar">
      <div className="literature-sidebar__intro">
        <span className="literature-sidebar__eyebrow">Literature Search</span>
        <h2>按资源类型切换学术站点</h2>
      </div>

      <ScrollArea className="literature-sidebar__scroll">
        <div className="literature-groups">
          {groupedEntries.map(([groupName, engines]) => {
            const isOpen = Boolean(openGroups[groupName])
            return (
              <section key={groupName} className="literature-group">
                <button
                  type="button"
                  className={`literature-group__header${isOpen ? ' is-open' : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenGroups((current) => ({
                      ...current,
                      [groupName]: !current[groupName],
                    }))
                  }}
                >
                  <div className="literature-group__title">
                    <span>{groupName}</span>
                    <small>{engines.length} 个站点</small>
                  </div>
                  <ChevronDown />
                </button>

                {isOpen ? (
                  <div className="literature-group__items">
                    {engines.map((engine) => {
                      const isActive = engine.id === activeEngineId
                      return (
                        <button
                          key={engine.id}
                          type="button"
                          className={`literature-engine-item${isActive ? ' is-active' : ''}`}
                          onClick={() => onSelect(engine.id)}
                        >
                          <div className="literature-engine-item__copy">
                            <div className="literature-engine-item__topline">
                              <strong>{engine.name}</strong>
                              <span className="literature-engine-item__access">
                                {getAccessLabel(engine.accessType)}
                              </span>
                            </div>
                            <span title={engine.coverage}>{engine.coverage}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
