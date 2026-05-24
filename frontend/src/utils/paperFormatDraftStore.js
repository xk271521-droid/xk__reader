const DB_NAME = 'paper-format-recent-drafts'
const STORE_NAME = 'drafts'
const DB_VERSION = 1
const MAX_DRAFTS = 3

function openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error || new Error('open indexeddb failed'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function runTransaction(mode, handler) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)
        let result
        transaction.oncomplete = () => {
          db.close()
          resolve(result)
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error || new Error('indexeddb transaction failed'))
        }
        transaction.onabort = () => {
          db.close()
          reject(transaction.error || new Error('indexeddb transaction aborted'))
        }
        result = handler(store)
      }),
  )
}

export async function listRecentPaperFormatDrafts() {
  if (typeof window === 'undefined' || !window.indexedDB) return []
  return runTransaction('readonly', (store) => {
    const request = store.getAll()
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error || new Error('load recent drafts failed'))
      request.onsuccess = () => {
        const records = Array.isArray(request.result) ? request.result : []
        resolve(
          records
            .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
            .slice(0, MAX_DRAFTS),
        )
      }
    })
  })
}

export async function saveRecentPaperFormatDraft(record) {
  if (typeof window === 'undefined' || !window.indexedDB) return []
  const nextRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: String(record?.fileName || 'normalized-paper.docx'),
    sourceName: String(record?.sourceName || ''),
    size: Number(record?.size || 0),
    savedAt: Number(record?.savedAt || Date.now()),
    blob: record?.blob || null,
  }

  if (!(nextRecord.blob instanceof Blob)) {
    return listRecentPaperFormatDrafts()
  }

  return runTransaction('readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const getAllRequest = store.getAll()
      getAllRequest.onerror = () => reject(getAllRequest.error || new Error('read drafts failed'))
      getAllRequest.onsuccess = () => {
        const existing = Array.isArray(getAllRequest.result) ? getAllRequest.result : []
        const sorted = existing.sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
        const overflow = sorted.slice(MAX_DRAFTS - 1)

        const putRequest = store.put(nextRecord)
        putRequest.onerror = () => reject(putRequest.error || new Error('save draft failed'))
        putRequest.onsuccess = () => {
          overflow.forEach((item) => {
            if (item?.id) store.delete(item.id)
          })
          resolve(
            [nextRecord, ...sorted.slice(0, MAX_DRAFTS - 1)].sort(
              (a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0),
            ),
          )
        }
      }
    })
  })
}

export async function deleteRecentPaperFormatDraft(id) {
  if (typeof window === 'undefined' || !window.indexedDB || !id) return []
  return runTransaction('readwrite', (store) => {
    const request = store.delete(id)
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error || new Error('delete draft failed'))
      request.onsuccess = async () => {
        try {
          resolve(await listRecentPaperFormatDrafts())
        } catch (error) {
          reject(error)
        }
      }
    })
  })
}
