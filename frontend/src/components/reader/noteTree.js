function makeTempId(prefix) {
  return `tmp:${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

function normalizeNodes(notebook) {
  return Array.isArray(notebook?.nodes) ? notebook.nodes : []
}

function getNodeBlocks(node) {
  return Array.isArray(node?.blocks) ? node.blocks : []
}

function sortByOrder(items) {
  return [...(items || [])].sort((left, right) => {
    const byOrder = (left.sort_order || 0) - (right.sort_order || 0)
    if (byOrder !== 0) return byOrder
    return String(left.id).localeCompare(String(right.id))
  })
}

const NOTEBOOK_TEMPLATE_LIBRARY = [
  {
    id: 'default',
    title: '默认模板笔记',
    description: '按基本信息、核心内容、研究意义和课题关联逐层拆解。',
    accent: '#f97316',
    nodes: [
      { title: '文献基本信息', colorIndex: 0, children: ['研究类型'] },
      {
        title: '文献基本内容',
        colorIndex: 1,
        children: ['研究背景', '研究目的', '研究方法', '研究思路（技术路线）', '研究结果'],
      },
      { title: '文献意义', colorIndex: 2, children: ['已解决的问题', '未解决的问题'] },
      { title: '对自己课题的意义', colorIndex: 3, children: ['可借鉴的内容', '注意事项'] },
    ],
  },
  {
    id: 'review_writing',
    title: '综述写作',
    description: '按写作方向、选题依据、发展脉络与趋势预测来组织综述框架。',
    accent: '#ea580c',
    nodes: [
      { title: '写作方向', colorIndex: 0, children: ['关键词', '标题拟定'] },
      {
        title: '选题依据',
        colorIndex: 1,
        blocks: ['本研究的观点有哪些可以借鉴'],
        children: ['研究结果', '研究局限性'],
      },
      {
        title: '发展脉络',
        colorIndex: 2,
        blocks: ['已有的研究、观点、方法等按类型总结'],
        children: ['方向/观点/研究1', '方向/观点/研究2', '方向/观点/研究3'],
      },
      {
        title: '现状分析',
        colorIndex: 3,
        children: ['已成熟的方向/观点/研究', '有前景的方向/观点/研究'],
      },
      { title: '趋向预测', colorIndex: 5, children: ['未来的研究方向'] },
    ],
  },
  {
    id: 'experiment_design',
    title: '实验设计',
    description: '按实验方法、实验条件、实验步骤与自有方案设计展开整理。',
    accent: '#16a34a',
    nodes: [
      {
        title: '本研究的实验方法',
        colorIndex: 4,
        blocks: ['对整个实验流程进行梳理'],
        children: [
          { title: '可借鉴之处', children: ['实验的创新性'] },
          { title: '待完善之处', children: ['实验的局限性'] },
        ],
      },
      {
        title: '本研究的实验条件',
        colorIndex: 4,
        blocks: ['温度、湿度、时间、剂量、催化剂……'],
        children: ['可参考的条件', '可改进的条件'],
      },
      {
        title: '本研究的实验步骤',
        colorIndex: 4,
        children: [
          { title: '可重复的步骤', children: ['原有实验流程'] },
          { title: '可调整的步骤', children: ['改变实验流程'] },
        ],
      },
      {
        title: '自己实验方案设计',
        colorIndex: 4,
        blocks: ['从该研究中获得的实验思路'],
        children: ['实验方法', '实验材料', '实验条件', '实验步骤'],
      },
    ],
  },
  {
    id: 'clinical_research',
    title: '临床研究',
    description: '先按常见临床研究框架整理问题、对象、设计、指标与临床意义。',
    accent: '#0f766e',
    nodes: [
      { title: '研究问题', colorIndex: 0, children: ['研究背景', '研究目的', '研究假设'] },
      {
        title: '研究对象',
        colorIndex: 1,
        blocks: ['纳入标准、排除标准、样本来源、人群特征'],
        children: ['纳入标准', '排除标准', '样本量与分组'],
      },
      {
        title: '研究设计',
        colorIndex: 2,
        blocks: ['研究类型、干预/暴露、对照方式、随访方案'],
        children: ['干预/暴露因素', '对照设置', '随访流程'],
      },
      { title: '观察指标', colorIndex: 3, children: ['主要结局指标', '次要结局指标', '安全性指标'] },
      { title: '结果与转化', colorIndex: 5, children: ['统计结果', '临床意义', '局限与改进'] },
    ],
  },
  {
    id: 'critical_reading',
    title: '批判性文献阅读',
    description: '适合边读边质疑，围绕假设、方法、结果和替代解释做批判性拆解。',
    accent: '#dc2626',
    nodes: [
      {
        title: '基本信息',
        colorIndex: 0,
        children: ['文首标题', '关键词', '发表年份', '会议/期刊名'],
      },
      {
        title: '研究背景',
        colorIndex: 1,
        children: [
          '研究目的',
          '研究假设',
          {
            title: '我的思考',
            blocks: ['如果我设计实验来验证这个假设，我会怎么做?'],
          },
        ],
      },
      {
        title: '研究方法',
        colorIndex: 2,
        children: [
          {
            title: '作者的研究方法',
            children: [
              '研究对象',
              '研究变量',
              {
                title: '实验过程',
                blocks: ['作者所描述的试剂、仪器或材料以及实验程序是什么样的？'],
              },
            ],
          },
          {
            title: '我的思考：我对作者的研究问题提出的研究方法是？',
            children: [
              '研究对象',
              '研究变量',
              {
                title: '实验过程',
                blocks: ['试剂、仪器或材料以及实验程序是什么样的？'],
              },
            ],
          },
          '我提出的方法优于作者的吗？',
        ],
      },
      {
        title: '研究结果',
        colorIndex: 3,
        children: [
          '本研究的结果是什么，作者如何解释研究结果？',
          '作者的方法是否检验了研究假设？',
          '我的思考：我能对这些结果给出另外的解释吗？',
        ],
      },
    ],
  },
  {
    id: 'paper_reproduction',
    title: '论文复现',
    description: '适合跟着论文复现实验，系统记录环境、步骤、偏差和结论。',
    accent: '#2563eb',
    nodes: [
      {
        title: '复现目标',
        colorIndex: 0,
        children: ['原论文任务', '核心指标', '成功标准'],
      },
      {
        title: '环境与资源',
        colorIndex: 1,
        blocks: ['代码仓库、依赖版本、硬件配置、数据下载地址'],
        children: ['运行环境', '数据与预处理', '模型/参数配置'],
      },
      {
        title: '复现流程',
        colorIndex: 2,
        children: [
          { title: '按作者流程执行', children: ['训练步骤', '评估步骤', '可视化/导出'] },
          { title: '我自己的调整', children: ['替代实现', '调参记录', '排错记录'] },
        ],
      },
      {
        title: '结果对齐',
        colorIndex: 3,
        children: ['论文结果', '复现结果', '偏差原因分析'],
      },
      {
        title: '输出结论',
        colorIndex: 5,
        children: ['是否复现成功', '可复用经验', '后续优化方向'],
      },
    ],
  },
  {
    id: 'related_work_compare',
    title: 'Related Work 对比',
    description: '适合整理多篇相关工作，快速比较问题、方法路线和写作落点。',
    accent: '#7c3aed',
    nodes: [
      {
        title: '研究问题',
        colorIndex: 0,
        children: ['目标任务', '应用场景', '评价标准'],
      },
      {
        title: '代表论文池',
        colorIndex: 1,
        blocks: ['先列出 3-5 篇最有代表性的工作'],
        children: ['论文A', '论文B', '论文C'],
      },
      {
        title: '方法路线对比',
        colorIndex: 2,
        children: [
          { title: '共同点', children: ['任务设定', '数据/实验习惯'] },
          { title: '差异点', children: ['模型设计', '训练策略', '创新重点'] },
        ],
      },
      {
        title: '优缺点总结',
        colorIndex: 3,
        children: ['各自优势', '主要局限', '还没解决的问题'],
      },
      {
        title: '写作落点',
        colorIndex: 5,
        children: ['如何分组描述', '我的研究该接在哪里', '可直接写进 related work 的句子'],
      },
    ],
  },
  {
    id: 'proposal_research',
    title: '开题调研',
    description: '适合做开题前调研，围绕空白、可行性、方案和风险组织笔记。',
    accent: '#f59e0b',
    nodes: [
      {
        title: '选题缘由',
        colorIndex: 0,
        children: ['实际问题/应用价值', '学术背景', '为什么值得做'],
      },
      {
        title: '研究空白',
        colorIndex: 1,
        blocks: ['现有工作做到哪里了，真正没解决的点是什么'],
        children: ['已有方案不足', '争议点', '潜在突破口'],
      },
      {
        title: '研究方案',
        colorIndex: 2,
        children: ['核心假设', '技术路线', '实验/验证思路'],
      },
      {
        title: '可行性评估',
        colorIndex: 3,
        children: ['数据/资源条件', '时间成本', '已有基础'],
      },
      {
        title: '风险与计划',
        colorIndex: 5,
        children: ['主要风险', '备选方案', '阶段安排'],
      },
    ],
  },
  {
    id: 'figure_deep_read',
    title: '图表精读',
    description: '适合拆解论文中的关键图表，单独记录每张图/表在证明什么。',
    accent: '#0ea5e9',
    nodes: [
      {
        title: '图表定位',
        colorIndex: 0,
        children: ['图/表编号', '对应章节', '作者想证明什么'],
      },
      {
        title: '关键信息提取',
        colorIndex: 1,
        children: ['坐标/变量含义', '最重要趋势', '异常点/极值'],
      },
      {
        title: '结果解释',
        colorIndex: 2,
        blocks: ['这张图支持了作者的哪个结论？'],
        children: ['作者解释', '我自己的解释', '是否还有别的解释'],
      },
      {
        title: '图表质量判断',
        colorIndex: 3,
        children: ['设计是否清晰', '是否可能误导', '还缺什么对比'],
      },
      {
        title: '写作与引用',
        colorIndex: 5,
        children: ['可直接引用的结论', '适合放进我论文的哪一节', '可复用的画图方式'],
      },
    ],
  },
  {
    id: 'writing_citation',
    title: '写作摘引',
    description: '适合积累论文写作素材，把原句、改写、页码和落点统一整理。',
    accent: '#14b8a6',
    nodes: [
      {
        title: '原文摘录',
        colorIndex: 0,
        children: ['关键原句', '关键词表达', '术语定义'],
      },
      {
        title: '改写整理',
        colorIndex: 1,
        blocks: ['把原句转成自己的叙述方式，避免机械搬运'],
        children: ['一句话总结', '扩写版本', '可用于综述的表达'],
      },
      {
        title: '引用定位',
        colorIndex: 2,
        children: ['页码/段落', '适用章节', '是否需要补其他来源'],
      },
      {
        title: '写作用途',
        colorIndex: 3,
        children: ['可写进引言', '可写进 related work', '可写进讨论/结论'],
      },
      {
        title: '注意事项',
        colorIndex: 5,
        children: ['避免误引', '避免断章取义', '需要回看原文的点'],
      },
    ],
  },
]

const NOTEBOOK_TEMPLATE_MAP = new Map(
  NOTEBOOK_TEMPLATE_LIBRARY.map((template) => [template.id, template]),
)

function getTemplateRootNodes(template) {
  return Array.isArray(template?.nodes) ? template.nodes : []
}

function countTemplateNodes(items = []) {
  return (Array.isArray(items) ? items : []).reduce((count, item) => {
    const templateItem = typeof item === 'string' ? { children: [] } : (item || {})
    return count + 1 + countTemplateNodes(templateItem.children)
  }, 0)
}

function getTemplatePreviewSections(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const templateItem = typeof item === 'string' ? { title: item } : (item || {})
    return {
      title: templateItem.title || `模板分区 ${index + 1}`,
      colorIndex: templateItem.colorIndex ?? index,
      hint: Array.isArray(templateItem.blocks) && templateItem.blocks.length
        ? String(templateItem.blocks[0] || '')
        : '',
      children: (Array.isArray(templateItem.children) ? templateItem.children : []).slice(0, 4).map((child) => {
        const childItem = typeof child === 'string' ? { title: child } : (child || {})
        return {
          title: childItem.title || '',
          children: (Array.isArray(childItem.children) ? childItem.children : [])
            .slice(0, 3)
            .map((grandchild) => (typeof grandchild === 'string' ? grandchild : grandchild?.title))
            .filter(Boolean),
        }
      }),
    }
  })
}

function normalizeTemplateDefinition(template) {
  const nodes = getTemplateRootNodes(template)
  return {
    id: String(template?.id || `custom:${Date.now()}`),
    title: String(template?.title || '未命名模板'),
    description: String(template?.description || ''),
    accent: String(template?.accent || '#64748b'),
    nodes,
  }
}

export function createTemplateDescriptor(template) {
  const normalized = normalizeTemplateDefinition(template)
  return {
    ...normalized,
    sectionCount: normalized.nodes.length,
    nodeCount: countTemplateNodes(normalized.nodes),
    sectionTitles: normalized.nodes.map((section) => section.title),
    previewSections: getTemplatePreviewSections(normalized.nodes),
  }
}

export const NOTEBOOK_TEMPLATES = NOTEBOOK_TEMPLATE_LIBRARY.map((template) => (
  createTemplateDescriptor(template)
))

export function createNodeDraft({
  parentId = null,
  level = 1,
  title = '新标题',
  colorIndex = 0,
  sortOrder = 0,
} = {}) {
  return {
    id: makeTempId('node'),
    parent_id: parentId,
    level,
    title,
    color_index: colorIndex,
    sort_order: sortOrder,
    collapsed: false,
    blocks: [],
  }
}

export function createTextBlockDraft(sortOrder = 0, content = '') {
  return {
    id: makeTempId('block'),
    type: 'text',
    content,
    image_url: null,
    page_number: null,
    start_char: null,
    end_char: null,
    context_before: '',
    context_after: '',
    sort_order: sortOrder,
  }
}

export function createQuoteBlockDraft(payload = {}, sortOrder = 0) {
  return {
    id: makeTempId('block'),
    type: 'quote',
    content: payload.text || '',
    image_url: null,
    page_number: payload.pageNumber || null,
    start_char: payload.startChar ?? null,
    end_char: payload.endChar ?? null,
    context_before: payload.contextBefore || '',
    context_after: payload.contextAfter || '',
    sort_order: sortOrder,
  }
}

export function createImageBlockDraft(payload = {}, sortOrder = 0) {
  return {
    id: makeTempId('block'),
    type: 'image',
    content: payload.text || '',
    image_url: payload.imageUrl || null,
    page_number: payload.pageNumber || null,
    start_char: payload.startChar ?? null,
    end_char: payload.endChar ?? null,
    context_before: payload.contextBefore || '',
    context_after: payload.contextAfter || '',
    sort_order: sortOrder,
  }
}

function buildTemplateNodeBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).map((block, index) => (
    createTextBlockDraft(index, typeof block === 'string' ? block : String(block?.content || ''))
  ))
}

function buildNotebookTemplateNodes(items = [], options = {}) {
  const {
    parentId = null,
    level = 1,
    inheritedColorIndex = 0,
  } = options

  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const templateItem = typeof item === 'string' ? { title: item } : (item || {})
    const colorIndex = level === 1
      ? templateItem.colorIndex ?? index
      : templateItem.colorIndex ?? inheritedColorIndex
    const node = createNodeDraft({
      parentId,
      level,
      title: templateItem.title || `${level}级标题 ${index + 1}`,
      colorIndex,
      sortOrder: index,
    })
    node.blocks = buildTemplateNodeBlocks(templateItem.blocks)

    if (!Array.isArray(templateItem.children) || level >= 3) {
      return [node]
    }

    return [
      node,
      ...buildNotebookTemplateNodes(templateItem.children, {
        parentId: node.id,
        level: level + 1,
        inheritedColorIndex: colorIndex,
      }),
    ]
  })
}

function buildTemplateItemsFromTree(treeNodes = []) {
  return sortByOrder(treeNodes).map((node) => ({
    title: node.title || '',
    colorIndex: Number(node.color_index) || 0,
    blocks: sortByOrder(getNodeBlocks(node))
      .map((block) => String(block?.content || '').trim())
      .filter(Boolean),
    children: buildTemplateItemsFromTree(node.children || []),
  }))
}

export function createTemplateFromNotebook(notebook, overrides = {}) {
  const title = String(overrides.title || notebook?.title || '自建模板').trim() || '自建模板'
  const recursiveNodes = buildNodeChildren(normalizeNodes(notebook), null)
  return createTemplateDescriptor({
    id: overrides.id || `custom:${Date.now()}`,
    title,
    description: overrides.description || `来自笔记本“${title}”的自建模板`,
    accent: overrides.accent || '#8b5cf6',
    nodes: buildTemplateItemsFromTree(recursiveNodes),
  })
}

export function createNotebookFromTemplate(templateType = 'blank', sortOrder = 0) {
  if (templateType === 'blank') {
    return {
      id: makeTempId('notebook'),
      title: '新笔记本',
      template_type: 'blank',
      sort_order: sortOrder,
      collapsed: true,
      nodes: [],
    }
  }

  const template = typeof templateType === 'string'
    ? (NOTEBOOK_TEMPLATE_MAP.get(templateType) || NOTEBOOK_TEMPLATE_MAP.get('default'))
    : normalizeTemplateDefinition(templateType)
  return {
    id: makeTempId('notebook'),
    title: template.title,
    template_type: template.id,
    sort_order: sortOrder,
    collapsed: true,
    nodes: buildNotebookTemplateNodes(getTemplateRootNodes(template)),
  }
}

export function createDefaultNotebook(sortOrder = 0) {
  return createNotebookFromTemplate('default', sortOrder)
}

export function createBlankNotebook(sortOrder = 0) {
  return createNotebookFromTemplate('blank', sortOrder)
}

export function buildNodeChildren(nodes, parentId = null) {
  return sortByOrder(nodes)
    .filter((node) => node.parent_id === parentId)
    .map((node) => ({
      ...node,
      blocks: sortByOrder(getNodeBlocks(node)),
      children: buildNodeChildren(nodes, node.id),
    }))
}

export function updateNotebookById(notebooks, notebookId, updater) {
  return (notebooks || []).map((notebook) => (
    notebook.id === notebookId ? updater(notebook) : notebook
  ))
}

export function toggleNotebookCollapsed(notebooks, notebookId) {
  return (notebooks || []).map((notebook) => (
    notebook.id === notebookId ? { ...notebook, collapsed: !notebook.collapsed } : notebook
  ))
}

export function updateNotebookTitle(notebooks, notebookId, title) {
  return (notebooks || []).map((notebook) => (
    notebook.id === notebookId ? { ...notebook, title } : notebook
  ))
}

export function deleteNotebook(notebooks, notebookId) {
  return (notebooks || [])
    .filter((notebook) => notebook.id !== notebookId)
    .map((notebook, index) => ({ ...notebook, sort_order: index }))
}

export function addRootNode(notebook, colorIndex = 0) {
  const nodes = normalizeNodes(notebook)
  const rootNodes = nodes.filter((node) => node.level === 1)
  return {
    ...notebook,
    collapsed: false,
    nodes: [
      ...nodes,
      createNodeDraft({
        parentId: null,
        level: 1,
        title: '新一级标题',
        colorIndex,
        sortOrder: rootNodes.length,
      }),
    ],
  }
}

export function addChildNode(notebook, nodeId) {
  const nodes = normalizeNodes(notebook)
  const target = nodes.find((node) => node.id === nodeId)
  if (!target || target.level >= 3) return notebook
  const siblingCount = nodes.filter((node) => node.parent_id === nodeId).length
  return {
    ...notebook,
    nodes: [
      ...nodes,
      createNodeDraft({
        parentId: nodeId,
        level: target.level + 1,
        title: `新${target.level + 1}级标题`,
        colorIndex: target.color_index,
        sortOrder: siblingCount,
      }),
    ],
  }
}

export function updateNodeTitle(notebook, nodeId, title) {
  return {
    ...notebook,
    nodes: normalizeNodes(notebook).map((node) => (node.id === nodeId ? { ...node, title } : node)),
  }
}

export function toggleNodeCollapsed(notebook, nodeId) {
  return {
    ...notebook,
    nodes: normalizeNodes(notebook).map((node) => (node.id === nodeId ? { ...node, collapsed: !node.collapsed } : node)),
  }
}

export function deleteNode(notebook, nodeId) {
  const nodes = normalizeNodes(notebook)
  const removeIds = new Set([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parent_id && removeIds.has(node.parent_id) && !removeIds.has(node.id)) {
        removeIds.add(node.id)
        changed = true
      }
    }
  }

  return {
    ...notebook,
    nodes: nodes.filter((node) => !removeIds.has(node.id)),
  }
}

export function addTextBlock(notebook, nodeId, afterBlockId = null) {
  return insertBlockByCursor(notebook, { nodeId, blockId: afterBlockId }, createTextBlockDraft())
}

export function updateBlockContent(notebook, nodeId, blockId, content) {
  return {
    ...notebook,
    nodes: normalizeNodes(notebook).map((node) => {
      if (node.id !== nodeId) return node
      return {
        ...node,
        blocks: getNodeBlocks(node).map((block) => (
          block.id === blockId ? { ...block, content } : block
        )),
      }
    }),
  }
}

export function deleteBlock(notebook, nodeId, blockId) {
  return {
    ...notebook,
    nodes: normalizeNodes(notebook).map((node) => {
      if (node.id !== nodeId) return node
      return {
        ...node,
        blocks: getNodeBlocks(node)
          .filter((block) => block.id !== blockId)
          .map((block, index) => ({ ...block, sort_order: index })),
      }
    }),
  }
}

export function insertBlockByCursor(notebook, cursor, block) {
  if (!cursor?.nodeId) return notebook
  const blockId = cursor.blockId || null
  return {
    ...notebook,
    collapsed: false,
    nodes: normalizeNodes(notebook).map((node) => {
      if (node.id !== cursor.nodeId) return node
      const blocks = sortByOrder(getNodeBlocks(node))
      const anchorIndex = blockId ? blocks.findIndex((item) => item.id === blockId) : -1
      const insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : blocks.length
      const nextBlocks = [...blocks]
      nextBlocks.splice(insertIndex, 0, {
        ...block,
        sort_order: insertIndex,
      })
      return {
        ...node,
        collapsed: false,
        blocks: nextBlocks.map((item, index) => ({ ...item, sort_order: index })),
      }
    }),
  }
}

export function findDefaultInsertTarget(notebooks) {
  const firstNotebook = (notebooks || [])[0]
  if (!firstNotebook) return null
  const nodes = normalizeNodes(firstNotebook)
  const rootNodes = sortByOrder(nodes.filter((node) => node.level === 1))
  const node = rootNodes[rootNodes.length - 1] || nodes[0]
  if (!node) return { notebookId: firstNotebook.id, nodeId: null, blockId: null }
  return { notebookId: firstNotebook.id, nodeId: node.id, blockId: null }
}

export function ensureInsertTarget(notebooks, target) {
  let nextNotebooks = [...(notebooks || [])]
  let nextTarget = target?.notebookId ? target : null

  if (nextTarget) {
    const notebook = nextNotebooks.find((item) => item.id === nextTarget.notebookId)
    const node = notebook?.nodes?.find((item) => item.id === nextTarget.nodeId)
    if (notebook && node) return { notebooks: nextNotebooks, target: nextTarget }
  }

  if (nextNotebooks.length === 0) {
    nextNotebooks = [createBlankNotebook(0)]
  }

  const notebook = nextNotebooks.find((item) => !item.collapsed) || nextNotebooks[0]
  let node = sortByOrder(normalizeNodes(notebook).filter((item) => item.level === 1)).at(-1)

  if (!node) {
    const updatedNotebook = addRootNode(notebook, 0)
    nextNotebooks = updateNotebookById(nextNotebooks, notebook.id, () => updatedNotebook)
    node = sortByOrder(updatedNotebook.nodes.filter((item) => item.level === 1)).at(-1)
  }

  nextTarget = { notebookId: notebook.id, nodeId: node.id, blockId: null }
  return { notebooks: nextNotebooks, target: nextTarget }
}

export function insertBlockIntoNotebooks(notebooks, target, block) {
  const prepared = ensureInsertTarget(notebooks, target)
  return {
    target: prepared.target,
    notebooks: updateNotebookById(prepared.notebooks, prepared.target.notebookId, (notebook) =>
      insertBlockByCursor(notebook, prepared.target, block),
    ),
  }
}
