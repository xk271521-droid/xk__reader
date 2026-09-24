import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Link2, PanelRightOpen, RefreshCw } from 'lucide-react'
import { EmbedPdfViewport } from './embedpdf/EmbedPdfViewport'
import {
  downloadFullTranslation,
  getFullTranslationFileUrl,
  getPaperFileUrl,
} from '../../services/paperReaderApi'
import {
  getScrollProgress,
  getSyncedScrollTop,
} from './fullTranslationSync'
import './FullTranslationReader.css'

function scheduleSyncFrame(callback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return setTimeout(callback, 0)
}

function cancelSyncFrame(frameId) {
  if (frameId === null || frameId === undefined) return
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId)
  } else {
    clearTimeout(frameId)
  }
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function translationStatusLabel(translation) {
  if (translation?.status === 'running' && translation?.artifact_ready) return '正在重新翻译，当前仍可阅读上一版'
  if (translation?.status === 'running') return '正在生成译文 PDF'
  if (translation?.error_message) return `已保存的译文 · ${translation.error_message}`
  return `译文 PDF · 第 ${Math.max(1, Number(translation?.generation_version) || 1)} 版`
}

export function FullTranslationReader({
  paperId,
  fileName,
  translation,
  uiFontScale,
  onRegenerate,
  onBack,
}) {
  const [linked, setLinked] = useState(true)
  const [isTranslationOnly, setIsTranslationOnly] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const originControllerRef = useRef(null)
  const translationControllerRef = useRef(null)
  const latestViewerStateRef = useRef({ origin: null, translation: null })
  const syncFrameRef = useRef(null)
  const syncGuardRef = useRef(null)

  useEffect(() => () => {
    cancelSyncFrame(syncFrameRef.current)
  }, [])

  function syncPage(from, state) {
    latestViewerStateRef.current[from] = state
    if (!linked) return
    const guard = syncGuardRef.current
    const now = performance.now()
    const currentProgress = getScrollProgress(state)
    if (guard?.target === from) {
      const progressReached = currentProgress !== null
        && Math.abs(currentProgress - guard.progress) < 0.012
      if (progressReached) {
        syncGuardRef.current = null
        return
      }
      if (now < guard.expiresAt) {
        return
      }
      syncGuardRef.current = null
    }
    cancelSyncFrame(syncFrameRef.current)
    syncFrameRef.current = scheduleSyncFrame(() => {
      syncFrameRef.current = null
      const sourceState = latestViewerStateRef.current[from] || state
      const target = from === 'origin' ? 'translation' : 'origin'
      const targetController = target === 'translation'
        ? translationControllerRef.current
        : originControllerRef.current
      if (!targetController) return

      const targetState = latestViewerStateRef.current[target]
      const sourceProgress = getScrollProgress(sourceState)
      const targetScrollTop = getSyncedScrollTop(sourceState, targetState)
      if (targetScrollTop !== null && targetController.scrollToOffset) {
        syncGuardRef.current = {
          target,
          progress: sourceProgress,
          expiresAt: performance.now() + 180,
        }
        targetController.scrollToOffset({
          x: 0,
          y: targetScrollTop,
          behavior: 'instant',
        })
        return
      }

      const pageNumber = Number(sourceState?.pageNumber) || 1
      if (!targetController.scrollToPage) return
      syncGuardRef.current = {
        target,
        progress: sourceProgress ?? 0,
        expiresAt: performance.now() + 180,
      }
      targetController.scrollToPage(pageNumber)
    })
  }

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    try {
      const result = await downloadFullTranslation(paperId, `${fileName || 'translation'}-zh.pdf`)
      triggerBlobDownload(result.blob, result.fileName)
    } catch (error) {
      window.alert(error?.message || '下载译文 PDF 失败，请稍后重试。')
    } finally {
      setDownloading(false)
    }
  }

  const version = Math.max(1, Number(translation?.generation_version) || 1)
  const translatedFileUrl = getFullTranslationFileUrl(paperId)

  return (
    <section className="full-translation-view full-translation-view--pdf" style={{ '--ui-reader-scale': uiFontScale }}>
      <header className="full-translation-toolbar">
        <button type="button" className="full-translation-action" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>返回原文阅读</span>
        </button>
        <div className="full-translation-title">
          <strong title={fileName}>{fileName || '全文翻译'}</strong>
          <span>{translationStatusLabel(translation)}</span>
        </div>
        <div className="full-translation-controls">
          {!isTranslationOnly ? (
            <button
              type="button"
              className={`full-translation-action${linked ? ' is-active' : ''}`}
              onClick={() => setLinked((value) => !value)}
              title="按页同步左右两侧阅读进度"
            >
              <Link2 size={15} />
              <span>{linked ? '双屏联动' : '独立滚动'}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`full-translation-action${isTranslationOnly ? ' is-active' : ''}`}
            onClick={() => setIsTranslationOnly((value) => !value)}
            title={isTranslationOnly ? '恢复原文与译文对照阅读' : '仅查看译文 PDF'}
          >
            <PanelRightOpen size={15} />
            <span>{isTranslationOnly ? '返回双屏' : '只看译文'}</span>
          </button>
          <button
            type="button"
            className="full-translation-action"
            disabled={translation?.status === 'running'}
            onClick={onRegenerate}
            title="仅在你确认后才会重新调用翻译服务；旧译文会保留到新版本成功生成。"
          >
            <RefreshCw size={15} />
            <span>重新翻译</span>
          </button>
          <button type="button" className="full-translation-action" disabled={downloading} onClick={handleDownload}>
            <Download size={15} />
            <span>{downloading ? '下载中…' : '下载译文 PDF'}</span>
          </button>
        </div>
      </header>

      <div className={`full-translation-pdf-split${isTranslationOnly ? ' is-translation-only' : ''}`}>
        {!isTranslationOnly ? (
          <section className="full-translation-pdf-pane">
            <div className="full-translation-pdf-pane__label">原文 PDF</div>
            <EmbedPdfViewport
              currentPaperId={paperId}
              documentUrl={getPaperFileUrl(paperId)}
              documentName={fileName || `paper-${paperId}.pdf`}
              externalDocumentId={`xk-full-origin-${paperId}`}
              readOnly
              onControllerReady={(controller) => { originControllerRef.current = controller }}
              onViewerStateChange={(state) => syncPage('origin', state)}
            />
          </section>
        ) : null}
        <section className="full-translation-pdf-pane full-translation-pdf-pane--translated">
          <div className="full-translation-pdf-pane__label">中文译文 PDF · 第 {version} 版</div>
          <EmbedPdfViewport
            currentPaperId={paperId}
            documentUrl={translatedFileUrl}
            documentName={`${fileName || `paper-${paperId}`}-zh.pdf`}
            externalDocumentId={`xk-full-translation-${paperId}-v${version}`}
            readOnly
            onControllerReady={(controller) => { translationControllerRef.current = controller }}
            onViewerStateChange={(state) => syncPage('translation', state)}
          />
        </section>
      </div>
    </section>
  )
}
