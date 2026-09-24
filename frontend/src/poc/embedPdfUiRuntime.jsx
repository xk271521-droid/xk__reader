import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EmbedPdfViewport } from '../components/reader/embedpdf/EmbedPdfViewport'
import '../styles/app.css'

const originalFetch = window.fetch.bind(window)

// This harness exercises the production viewer without touching a real account
// or database. Only its synthetic paper endpoints are intercepted.
window.fetch = async (input, init = {}) => {
  const rawUrl = typeof input === 'string' ? input : input?.url || ''
  const url = new URL(rawUrl, window.location.origin)
  if (url.pathname === '/api/papers/1/file') {
    return originalFetch('/poc/sthelar-selection-test.pdf', init)
  }
  if (url.pathname === '/api/papers/1/pdf-annotations') {
    return new Response(JSON.stringify({
      schema_version: 'embedpdf-v1',
      revision: 0,
      annotations: [],
      conflicts: [],
      applied_uids: [],
      requires_refresh: false,
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (url.pathname === '/api/papers/1/pdf-annotations/sync') {
    const body = JSON.parse(init.body || '{}')
    const annotations = (body.upserts || []).map((item) => ({
      uid: item.uid,
      page_index: item.page_index,
      annotation_type: item.annotation_type,
      payload: item.payload,
      version: 1,
    }))
    return new Response(JSON.stringify({
      schema_version: 'embedpdf-v1',
      revision: annotations.length ? 1 : 0,
      annotations,
      conflicts: [],
      applied_uids: annotations.map((item) => item.uid),
      requires_refresh: false,
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  return originalFetch(input, init)
}

function RuntimeHarness() {
  const [thumbnailHost, setThumbnailHost] = useState(null)
  const [state, setState] = useState({})
  const [selectionText, setSelectionText] = useState('')
  const handleSelect = useCallback((selection) => {
    setSelectionText(selection?.text || '')
  }, [])

  return (
    <main className="embedpdf-poc-shell">
      <header>
        <strong>PDFium 阅读器真实组件自检</strong>
        <span data-poc-status>{state.totalPages ? `已就绪 · ${state.totalPages} 页` : '正在加载…'}</span>
        <output data-poc-selection hidden>{selectionText}</output>
      </header>
      <section>
        <aside ref={setThumbnailHost} className="thumbnail-panel embedpdf-thumbnail-panel" />
        <div className="embedpdf-poc-viewer">
          <EmbedPdfViewport
            activeTool="select"
            annotationOwnerKey="poc-user"
            currentPaperId="1"
            inkOptions={{ color: '#15803D', opacity: 0.85, strokeWidth: 6 }}
            shapeOptions={{ color: '#2563EB', strokeWidth: 2, fontSize: 16 }}
            thumbnailHost={thumbnailHost}
            onSelect={handleSelect}
            onViewerStateChange={setState}
          />
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<RuntimeHarness />)
