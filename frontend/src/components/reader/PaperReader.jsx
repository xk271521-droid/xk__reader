import { PageThumbnails } from './PageThumbnails'
import { PdfToolbar } from './PdfToolbar'
import { PdfViewport } from './PdfViewport'

export function PaperReader({
  pdfReader,
  readerRef,
  activeTool,
  isThumbnailsOpen,
  thumbnailWidth,
  onThumbnailResizeStart,
  onToggleThumbnails,
  onToolChange,
  onSelect,
  onThumbnailPageClick,
  onWheelZoom,
  matches,
  onSearchExecute,
  searchTerm,
  onSearchChange,
  matchIndex,
  totalMatches,
  onSearchPrev,
  onSearchNext,
  canUndoAnnotation,
  onUndoAnnotation,
  currentPaperId,
  annotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onEraseAnnotationRange,
  onAskAI,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
}) {
  return (
    <section className="reader-frame">
      <PdfToolbar
        fileName={pdfReader.fileName}
        activeTool={activeTool}
        isThumbnailsOpen={isThumbnailsOpen}
        onToolChange={onToolChange}
        onToggleThumbnails={onToggleThumbnails}
        onZoomIn={pdfReader.zoomIn}
        onZoomOut={pdfReader.zoomOut}
        pageNumber={pdfReader.pageNumber}
        scale={pdfReader.scale}
        totalPages={pdfReader.totalPages}
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        matchIndex={matchIndex}
        totalMatches={totalMatches}
        onSearchPrev={onSearchPrev}
        onSearchNext={onSearchNext}
        canUndo={canUndoAnnotation}
        onUndo={onUndoAnnotation}
      />

      <div className={`reader-body${isThumbnailsOpen ? ' has-thumbnails' : ''}`}>
        <div className="thumbnails-slide" style={{ width: isThumbnailsOpen ? thumbnailWidth : 0 }}>
          <PageThumbnails
            currentPage={pdfReader.pageNumber}
            pageMetrics={pdfReader.pageMetrics}
            pageNumbers={pdfReader.pageNumbers}
            pdfDocument={pdfReader.pdfDocument}
            width={thumbnailWidth}
            onPageClick={onThumbnailPageClick}
          />

          <div
            aria-label="调整缩略图面板宽度"
            aria-orientation="vertical"
            className="reader-resizer reader-resizer--left"
            onPointerDown={onThumbnailResizeStart}
            role="separator"
          />
        </div>

        <PdfViewport
          activeTool={activeTool}
          error={pdfReader.error}
          isLoading={pdfReader.isLoading}
          matches={matches}
          pageMetrics={pdfReader.pageMetrics}
          pageNumbers={pdfReader.pageNumbers}
          pageNumber={pdfReader.pageNumber}
          pdfDocument={pdfReader.pdfDocument}
          readerRef={readerRef}
          scale={pdfReader.scale}
          onFitToWidth={pdfReader.fitToWidth}
          onSelect={onSelect}
          onSearchExecute={onSearchExecute}
          onVisiblePageChange={pdfReader.setCurrentPage}
          onWheelZoom={onWheelZoom}
          currentPaperId={currentPaperId}
          annotations={annotations}
          onCreateAnnotation={onCreateAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
          onEraseAnnotationRange={onEraseAnnotationRange}
          onAskAI={onAskAI}
          onScreenshotTranslate={onScreenshotTranslate}
          onScreenshotAskAI={onScreenshotAskAI}
          onScreenshotInsertNote={onScreenshotInsertNote}
        />
      </div>
    </section>
  )
}
