import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncBatch,
  createDeleteOperation,
  createUpsertOperation,
  deriveSyncStatus,
  mergePendingOperation,
  normalizeServerDocument,
  replayPendingOperations,
  PDF_ANNOTATION_SYNC_STATUS,
} from './pdfAnnotationSyncModel.js'

const annotation = {
  uid: 'ann-1',
  pageIndex: 2,
  annotationType: 'highlight',
  payload: { color: '#facc15' },
}

test('normalizes server revision and annotation versions', () => {
  const document = normalizeServerDocument({
    schema_version: 'embedpdf-v1',
    revision: 4,
    annotations: [{ uid: 'ann-1', version: 3 }],
  })

  assert.equal(document.revision, 4)
  assert.equal(document.versions.get('ann-1'), 3)
})

test('coalesces rapid updates while preserving the first server version', () => {
  const first = createUpsertOperation({ ownerKey: 'user-7', paperId: 12, annotation, baseVersion: 5, now: 1 })
  const moved = createUpsertOperation({
    ownerKey: 'user-7',
    paperId: 12,
    annotation: { ...annotation, payload: { color: '#22c55e', rect: [1, 2, 3, 4] } },
    baseVersion: 6,
    now: 2,
  })
  const merged = mergePendingOperation(first, moved)

  assert.equal(merged.baseVersion, 5)
  assert.equal(merged.payload.color, '#22c55e')
})

test('drops a never-synced create that is deleted before upload', () => {
  const created = createUpsertOperation({ ownerKey: 'user-7', paperId: 12, annotation, now: 1 })
  const removed = createDeleteOperation({ ownerKey: 'user-7', paperId: 12, uid: annotation.uid, now: 2 })

  assert.equal(mergePendingOperation(created, removed), null)
})

test('builds the backend snake-case batch contract', () => {
  const upsert = createUpsertOperation({ ownerKey: 'user-7', paperId: 12, annotation, baseVersion: 2, now: 1 })
  const remove = createDeleteOperation({ ownerKey: 'user-7', paperId: 12, uid: 'ann-2', baseVersion: 4, now: 2 })
  const batch = buildSyncBatch(8, [remove, upsert])

  assert.equal(batch.payload.base_revision, 8)
  assert.deepEqual(batch.payload.upserts[0], {
    uid: 'ann-1',
    page_index: 2,
    annotation_type: 'highlight',
    payload: { color: '#facc15' },
    base_version: 2,
  })
  assert.deepEqual(batch.payload.deletes[0], { uid: 'ann-2', base_version: 4 })
})

test('replays offline updates and deletes over the cached server snapshot', () => {
  const operations = [
    createDeleteOperation({ ownerKey: 'user-7', paperId: 12, uid: 'old', baseVersion: 2, now: 1 }),
    createUpsertOperation({ ownerKey: 'user-7', paperId: 12, annotation, baseVersion: 0, now: 2 }),
  ]
  const annotations = replayPendingOperations([
    { uid: 'old', payload: { id: 'old' }, version: 2 },
  ], operations)

  assert.deepEqual(annotations.map((item) => item.uid), ['ann-1'])
  assert.equal(annotations[0].payload.color, '#facc15')
})

test('sync status exposes offline and conflict states instead of hiding failures', () => {
  assert.equal(
    deriveSyncStatus({ pendingCount: 2, isSyncing: false, isOnline: false }),
    PDF_ANNOTATION_SYNC_STATUS.OFFLINE,
  )
  assert.equal(
    deriveSyncStatus({ pendingCount: 0, isSyncing: false, isOnline: true, conflicts: [{ uid: 'ann-1' }] }),
    PDF_ANNOTATION_SYNC_STATUS.CONFLICT,
  )
})
