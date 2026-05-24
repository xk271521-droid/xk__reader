import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildImportProgress,
  createDuplicateImportConflict,
  createImportFailureConflict,
  resolveImportTargetFolderId,
} from './importWorkflowModel.js'

test('resolves import target folder before checking duplicates', () => {
  assert.equal(resolveImportTargetFolderId('', 'uncategorized'), 'uncategorized')
  assert.equal(resolveImportTargetFolderId('folder-2', 'uncategorized'), 'folder-2')
})

test('builds an actionable same-file duplicate conflict', () => {
  const conflict = createDuplicateImportConflict({
    fileName: 'cnn-study.pdf',
    existingPaper: { id: 'paper-1', folderId: 'source-folder' },
    sourceFolderName: '深度学习',
    targetFolderId: 'target-folder',
    shouldActivate: false,
  })

  assert.equal(conflict.conflictType, 'same_file')
  assert.equal(conflict.existingPaper.id, 'paper-1')
  assert.equal(conflict.targetFolderId, 'target-folder')
  assert.equal(conflict.shouldActivate, false)
  assert.match(conflict.message, /cnn-study\.pdf/)
  assert.match(conflict.message, /深度学习/)
})

test('keeps retry payload when an import fails', () => {
  const file = { name: 'broken.pdf' }
  const conflict = createImportFailureConflict({
    file,
    targetFolderId: 'target-folder',
    shouldActivate: true,
    failedPaperId: 'paper-temp',
    error: new Error('network down'),
  })

  assert.equal(conflict.conflictType, 'failed_import')
  assert.equal(conflict.file, file)
  assert.equal(conflict.targetFolderId, 'target-folder')
  assert.equal(conflict.shouldActivate, true)
  assert.equal(conflict.failedPaperId, 'paper-temp')
  assert.match(conflict.message, /broken\.pdf/)
  assert.match(conflict.message, /network down/)
})

test('describes active import progress with file names and counts', () => {
  assert.deepEqual(buildImportProgress([]), {
    isImporting: false,
    pendingCount: 0,
    fileName: '',
    message: '',
  })

  assert.deepEqual(buildImportProgress([{ fileName: 'one.pdf' }]), {
    isImporting: true,
    pendingCount: 1,
    fileName: 'one.pdf',
    message: '正在导入「one.pdf」...',
  })

  assert.deepEqual(
    buildImportProgress([{ fileName: 'one.pdf' }, { fileName: 'two.pdf' }]),
    {
      isImporting: true,
      pendingCount: 2,
      fileName: 'two.pdf',
      message: '正在导入 2 篇文献，当前处理「two.pdf」...',
    },
  )
})
