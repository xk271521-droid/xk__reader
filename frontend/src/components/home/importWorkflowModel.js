export function resolveImportTargetFolderId(folderId = '', fallbackFolderId = '') {
  return folderId || fallbackFolderId || ''
}

export function createDuplicateImportConflict({
  fileName = '',
  existingPaper,
  sourceFolderName = '未分类',
  targetFolderId = '',
  shouldActivate = true,
} = {}) {
  return {
    conflictType: 'same_file',
    existingPaper,
    targetFolderId,
    shouldActivate,
    message: `「${fileName || '这篇文献'}」已在「${sourceFolderName || '未分类'}」中，不会重复导入。可以直接打开已有文献。`,
  }
}

export function createImportFailureConflict({
  file,
  targetFolderId = '',
  shouldActivate = true,
  failedPaperId = '',
  error = null,
} = {}) {
  const fileName = file?.name || '这篇文献'
  const reason = error instanceof Error && error.message
    ? error.message
    : (typeof error === 'string' && error ? error : '请确认文件没有损坏，或稍后重试')

  return {
    conflictType: 'failed_import',
    file,
    targetFolderId,
    shouldActivate,
    failedPaperId,
    message: `「${fileName}」导入失败：${reason}`,
  }
}

export function buildImportProgress(pendingPapers = []) {
  const papers = pendingPapers.filter(Boolean)
  if (!papers.length) {
    return {
      isImporting: false,
      pendingCount: 0,
      fileName: '',
      message: '',
    }
  }

  const currentPaper = papers[papers.length - 1]
  const fileName = currentPaper.fileName || '当前文献'
  const pendingCount = papers.length

  return {
    isImporting: true,
    pendingCount,
    fileName,
    message: pendingCount === 1
      ? `正在导入「${fileName}」...`
      : `正在导入 ${pendingCount} 篇文献，当前处理「${fileName}」...`,
  }
}
