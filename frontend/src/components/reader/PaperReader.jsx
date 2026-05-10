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
  activeEraserMode,
  onEraserModeChange,
  inkOptions,
  onInkOptionsChange,
  onSelect,
  onThumbnailPageClick,
  onWheelZoom,
  matches,
  noteFocus,
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
  inkAnnotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onEraseAnnotationRange,
  onCreateInkAnnotation,
  onDeleteInkAnnotation,
  onInsertSelectionNote,
  onAskAI,
  onScreenshotTranslate,
  onScreenshotAskAI,
  onScreenshotInsertNote,
  onDownload,
  fullTranslateActive,
  fullTranslateStatus,
  fullTranslateProgress,
  fullTranslateParseMode,
  onFullTranslateParseModeChange,
  onFullTranslate,
}) {
  return (
    <section className="reader-frame">
      <PdfToolbar
        fileName={pdfReader.fileName}
        activeTool={activeTool}
        isThumbnailsOpen={isThumbnailsOpen}
        onToolChange={onToolChange}
        activeEraserMode={activeEraserMode}
        onEraserModeChange={onEraserModeChange}
        inkOptions={inkOptions}
        onInkOptionsChange={onInkOptionsChange}
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
        onDownload={onDownload}
        fullTranslateActive={fullTranslateActive}
        fullTranslateStatus={fullTranslateStatus}
        fullTranslateProgress={fullTranslateProgress}
        fullTranslateParseMode={fullTranslateParseMode}
        onFullTranslateParseModeChange={onFullTranslateParseModeChange}
        onFullTranslate={onFullTranslate}
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
          matchIndex={matchIndex}
          noteFocus={noteFocus}
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
          inkAnnotations={inkAnnotations}
          inkOptions={inkOptions}
          onCreateAnnotation={onCreateAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
          onEraseAnnotationRange={onEraseAnnotationRange}
          onCreateInkAnnotation={onCreateInkAnnotation}
          onDeleteInkAnnotation={onDeleteInkAnnotation}
          onInsertSelectionNote={onInsertSelectionNote}
          onAskAI={onAskAI}
          onScreenshotTranslate={onScreenshotTranslate}
          onScreenshotAskAI={onScreenshotAskAI}
          onScreenshotInsertNote={onScreenshotInsertNote}
        />
      </div>
    </section>
  )
}
