import { mergePendingOperation } from './pdfAnnotationSyncModel.js'

const DATABASE_NAME = 'xk-reader-pdf-annotations'
const DATABASE_VERSION = 1
const OPERATIONS_STORE = 'operations'
const DOCUMENTS_STORE = 'documents'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

function documentKey(ownerKey, paperId) {
  return `${ownerKey}:${paperId}`
}

function openDatabase(indexedDBImpl) {
  if (!indexedDBImpl) return Promise.reject(new Error('IndexedDB is unavailable'))

  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error || new Error('Unable to open annotation queue'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
        const store = database.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' })
        store.createIndex('documentKey', 'documentKey', { unique: false })
      }
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

export function createPdfAnnotationQueue(indexedDBImpl = globalThis.indexedDB) {
  let databasePromise = null

  function getDatabase() {
    databasePromise ||= openDatabase(indexedDBImpl)
    return databasePromise
  }

  return {
    async list(ownerKey, paperId) {
      const database = await getDatabase()
      const transaction = database.transaction(OPERATIONS_STORE, 'readonly')
      const done = transactionDone(transaction)
      const index = transaction.objectStore(OPERATIONS_STORE).index('documentKey')
      const items = await requestResult(index.getAll(documentKey(ownerKey, paperId)))
      await done
      return items.sort((left, right) => (left.updatedAt || 0) - (right.updatedAt || 0))
    },

    async put(operation) {
      const database = await getDatabase()
      const transaction = database.transaction(OPERATIONS_STORE, 'readwrite')
      const done = transactionDone(transaction)
      const store = transaction.objectStore(OPERATIONS_STORE)
      const existing = await requestResult(store.get(operation.id))
      const merged = mergePendingOperation(existing, operation)
      if (merged) {
        store.put({ ...merged, documentKey: documentKey(merged.ownerKey, merged.paperId) })
      } else {
        store.delete(operation.id)
      }
      await done
      return merged
    },

    async acknowledge(ownerKey, paperId, sentOperations, versions) {
      if (!sentOperations.length) return
      const database = await getDatabase()
      const transaction = database.transaction(OPERATIONS_STORE, 'readwrite')
      const done = transactionDone(transaction)
      const store = transaction.objectStore(OPERATIONS_STORE)
      const currentItems = await requestResult(
        store.index('documentKey').getAll(documentKey(ownerKey, paperId)),
      )
      const sentById = new Map(sentOperations.map((item) => [item.id, item]))

      for (const current of currentItems) {
        const sent = sentById.get(current.id)
        if (!sent) continue
        if ((current.updatedAt || 0) <= (sent.updatedAt || 0)) {
          store.delete(current.id)
          continue
        }

        // A newer local edit arrived while this request was in flight. Keep it,
        // but rebase it onto the version acknowledged by the server.
        const serverVersion = versions.get(current.uid)
        if (serverVersion != null) {
          store.put({ ...current, baseVersion: serverVersion })
        }
      }
      await done
    },

    async getDocument(ownerKey, paperId) {
      const database = await getDatabase()
      const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(DOCUMENTS_STORE).get(documentKey(ownerKey, paperId)),
      )
      await done
      return value || {
        id: documentKey(ownerKey, paperId),
        ownerKey,
        paperId: Number(paperId),
        revision: 0,
        annotations: [],
      }
    },

    async setDocument(ownerKey, paperId, state) {
      const database = await getDatabase()
      const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
      const done = transactionDone(transaction)
      transaction.objectStore(DOCUMENTS_STORE).put({
        id: documentKey(ownerKey, paperId),
        ownerKey,
        paperId: Number(paperId),
        revision: Math.max(0, Number(state.revision) || 0),
        schemaVersion: state.schemaVersion || 'embedpdf-v1',
        annotations: Array.isArray(state.annotations) ? state.annotations : [],
        updatedAt: Date.now(),
      })
      await done
    },
  }
}
