const preloadedSections = new Set()

export const HOME_SECTION_COMPONENT_LOADERS = {
  'literature-search': () =>
    import('./LiteratureSearchPage').then((module) => module.LiteratureSearchPage),
  'paper-format': () => import('./PaperFormatPage').then((module) => module.PaperFormatPage),
  insights: () =>
    import('./ReadingInsightSection').then((module) => module.ReadingInsightSection),
}

export function loadHomeSectionComponent(sectionId, loaders = HOME_SECTION_COMPONENT_LOADERS) {
  const loader = loaders[sectionId]
  return typeof loader === 'function' ? loader() : null
}

export function preloadHomeSection(
  sectionId,
  { loaders = HOME_SECTION_COMPONENT_LOADERS, cache = preloadedSections } = {},
) {
  const loader = loaders[sectionId]
  if (typeof loader !== 'function' || cache.has(sectionId)) {
    return null
  }

  cache.add(sectionId)
  try {
    const result = loader()
    if (result && typeof result.catch === 'function') {
      result.catch(() => cache.delete(sectionId))
    }
    return result
  } catch (error) {
    cache.delete(sectionId)
    throw error
  }
}
