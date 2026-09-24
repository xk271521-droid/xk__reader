export const PDF_ANNOTATION_SCHEMA_VERSION = 'embedpdf-v1'

export const PDF_ANNOTATION_SYNC_STATUS = Object.freeze({
  SAVED: 'saved',
  SAVING: 'saving',
  OFFLINE: 'offline',
  ERROR: 'error',
  CONFLICT: 'conflict',
})

function operationKey(operation) {
  return `${operation.ownerKey}:${operation.paperId}:${operation.uid}`
}

export function normalizeServerDocument(payload) {
  const annotations = Array.isArray(payload?.annotations) ? payload.annotations : []
  return {
    schemaVersion: payload?.schema_version || PDF_ANNOTATION_SCHEMA_VERSION,
    revision: Math.max(0, Number(payload?.revision) || 0),
    annotations,
    versions: new Map(annotations.map((item) => [item.uid, Math.max(0, Number(item.version) || 0)])),
    conflicts: Array.isArray(payload?.conflicts) ? payload.conflicts : [],
    appliedUids: Array.isArray(payload?.applied_uids) ? payload.applied_uids : [],
    requiresRefresh: Boolean(payload?.requires_refresh),
  }
}

export function createUpsertOperation({ ownerKey, paperId, annotation, baseVersion = 0, now = Date.now() }) {
  return {
    id: operationKey({ ownerKey, paperId, uid: annotation.uid }),
    ownerKey,
    paperId: Number(paperId),
    uid: annotation.uid,
    kind: 'upsert',
    pageIndex: annotation.pageIndex,
    annotationType: annotation.annotationType,
    payload: annotation.payload,
    baseVersion: Math.max(0, Number(baseVersion) || 0),
    updatedAt: now,
  }
}

export function createDeleteOperation({ ownerKey, paperId, uid, baseVersion = 0, now = Date.now() }) {
  return {
    id: operationKey({ ownerKey, paperId, uid }),
    ownerKey,
    paperId: Number(paperId),
    uid,
    kind: 'delete',
    baseVersion: Math.max(0, Number(baseVersion) || 0),
    updatedAt: now,
  }
}

/**
 * Coalesce rapid annotation changes by stable UID. Keeping the first known
 * server version is essential: a drag can emit dozens of updates before the
 * first sync response, but all of them still edit the same server version.
 */
export function mergePendingOperation(previous, incoming) {
  if (!previous) return incoming
  if (previous.id !== incoming.id) return incoming

  // A never-synced create followed by delete has no server-side effect.
  if (previous.kind === 'upsert' && previous.baseVersion === 0 && incoming.kind === 'delete') {
    return null
  }

  return {
    ...incoming,
    baseVersion: previous.baseVersion,
    updatedAt: Math.max(previous.updatedAt || 0, incoming.updatedAt || 0),
  }
}

export function buildSyncBatch(revision, operations, limit = 500) {
  const selected = [...operations]
    .sort((left, right) => (left.updatedAt || 0) - (right.updatedAt || 0))
    .slice(0, limit)

  const upserts = []
  const deletes = []

  for (const operation of selected) {
    if (operation.kind === 'delete') {
      deletes.push({ uid: operation.uid, base_version: operation.baseVersion })
      continue
    }

    upserts.push({
      uid: operation.uid,
      page_index: operation.pageIndex,
      annotation_type: operation.annotationType,
      payload: operation.payload,
      base_version: operation.baseVersion,
    })
  }

  return {
    operationIds: selected.map((item) => item.id),
    payload: {
      base_revision: Math.max(0, Number(revision) || 0),
      upserts,
      deletes,
    },
  }
}

export function replayPendingOperations(annotations, operations) {
  const byUid = new Map((annotations || []).map((item) => [item.uid, item]))
  for (const operation of operations || []) {
    if (operation.kind === 'delete') {
      byUid.delete(operation.uid)
      continue
    }
    byUid.set(operation.uid, {
      uid: operation.uid,
      page_index: operation.pageIndex,
      annotation_type: operation.annotationType,
      payload: operation.payload,
      version: operation.baseVersion,
    })
  }
  return [...byUid.values()]
}

export function deriveSyncStatus({ pendingCount, isSyncing, isOnline, error, conflicts }) {
  if (Array.isArray(conflicts) && conflicts.length > 0) return PDF_ANNOTATION_SYNC_STATUS.CONFLICT
  if (!isOnline && pendingCount > 0) return PDF_ANNOTATION_SYNC_STATUS.OFFLINE
  if (error) return PDF_ANNOTATION_SYNC_STATUS.ERROR
  if (isSyncing || pendingCount > 0) return PDF_ANNOTATION_SYNC_STATUS.SAVING
  return PDF_ANNOTATION_SYNC_STATUS.SAVED
}
