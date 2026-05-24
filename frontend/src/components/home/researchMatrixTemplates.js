export const RESEARCH_MATRIX_TEMPLATES = [
  {
    id: 'review_draft',
    label: '综述草稿',
    description: '默认流程，先做矩阵，再生成导读、大纲和分节草稿。',
    titlePrefix: '综述草稿',
    groupingMode: 'topic_first',
    includeReproduction: true,
  },
  {
    id: 'method_compare',
    label: '方法对比',
    description: '优先按算法路线、数据集和评价指标组织。',
    titlePrefix: '方法对比',
    groupingMode: 'method_first',
    includeReproduction: true,
  },
  {
    id: 'experiment_results',
    label: '实验结果',
    description: '突出性能结论、消融实验和可复现实验条件。',
    titlePrefix: '实验结果矩阵',
    groupingMode: 'method_first',
    includeReproduction: true,
  },
  {
    id: 'innovation_limits',
    label: '创新与局限',
    description: '集中比较创新点、边界条件、局限性和风险。',
    titlePrefix: '创新与局限矩阵',
    groupingMode: 'topic_first',
    includeReproduction: false,
  },
]

export function getResearchMatrixTemplate(templateId) {
  return RESEARCH_MATRIX_TEMPLATES.find((template) => template.id === templateId) || RESEARCH_MATRIX_TEMPLATES[0]
}

export function buildResearchMatrixCreatePayload({
  paperIds = [],
  templateId = 'review_draft',
  title = '',
} = {}) {
  const template = getResearchMatrixTemplate(templateId)
  const normalizedTitle = String(title || '').trim()
  return {
    title: normalizedTitle || `${template.titlePrefix} · ${paperIds.length} 篇`,
    paper_ids: paperIds,
    include_reproduction: template.includeReproduction,
    grouping_mode: template.groupingMode,
  }
}
