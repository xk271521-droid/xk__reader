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

export function createDefaultNotebook(sortOrder = 0) {
  const root1 = createNodeDraft({ level: 1, title: '文献基本信息', colorIndex: 0, sortOrder: 0 })
  const root2 = createNodeDraft({ level: 1, title: '文献基本内容', colorIndex: 1, sortOrder: 1 })
  const root3 = createNodeDraft({ level: 1, title: '文献意义', colorIndex: 2, sortOrder: 2 })
  const root4 = createNodeDraft({ level: 1, title: '对自己课题的意义', colorIndex: 3, sortOrder: 3 })

  return {
    id: makeTempId('notebook'),
    title: '默认模板笔记',
    template_type: 'default',
    sort_order: sortOrder,
    collapsed: true,
    nodes: [
      root1,
      root2,
      root3,
      root4,
      createNodeDraft({ parentId: root1.id, level: 2, title: '研究类型', colorIndex: 0, sortOrder: 0 }),
      createNodeDraft({ parentId: root2.id, level: 2, title: '研究背景', colorIndex: 1, sortOrder: 0 }),
      createNodeDraft({ parentId: root2.id, level: 2, title: '研究目的', colorIndex: 1, sortOrder: 1 }),
      createNodeDraft({ parentId: root2.id, level: 2, title: '研究方法', colorIndex: 1, sortOrder: 2 }),
      createNodeDraft({ parentId: root2.id, level: 2, title: '研究思路（技术路线）', colorIndex: 1, sortOrder: 3 }),
      createNodeDraft({ parentId: root2.id, level: 2, title: '研究结果', colorIndex: 1, sortOrder: 4 }),
      createNodeDraft({ parentId: root3.id, level: 2, title: '已解决的问题', colorIndex: 2, sortOrder: 0 }),
      createNodeDraft({ parentId: root3.id, level: 2, title: '未解决的问题', colorIndex: 2, sortOrder: 1 }),
      createNodeDraft({ parentId: root4.id, level: 2, title: '可借鉴的内容', colorIndex: 3, sortOrder: 0 }),
      createNodeDraft({ parentId: root4.id, level: 2, title: '注意事项', colorIndex: 3, sortOrder: 1 }),
    ],
  }
}

export function createBlankNotebook(sortOrder = 0) {
  return {
    id: makeTempId('notebook'),
    title: '新笔记本',
    template_type: 'blank',
    sort_order: sortOrder,
    collapsed: true,
    nodes: [],
  }
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
