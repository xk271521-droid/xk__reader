import { PdfToolbar } from './PdfToolbar'
import { PdfViewport } from './PdfViewport'
import { SelectionInsightPanel } from './SelectionInsightPanel'

export function PaperReader({
  pdfReader,
  readerRef,
  selectionCard,
  activeTool,
  insightPanelWidth,
  onToolChange,
  onInsightResizeStart,
  onSelect,
}) {
  return (
    <section className="reader-frame">
      <PdfToolbar
        fileName={pdfReader.fileName}
        activeTool={activeTool}
        onToolChange={onToolChange}
        onZoomIn={pdfReader.zoomIn}
        onZoomOut={pdfReader.zoomOut}
        pageNumber={pdfReader.pageNumber}
        scale={pdfReader.scale}
        totalPages={pdfReader.totalPages}
      />

      <div className="reader-body has-insight">
        <PdfViewport
          activeTool={activeTool}
          error={pdfReader.error}
          isLoading={pdfReader.isLoading}
          pageMetrics={pdfReader.pageMetrics}
          pageNumbers={pdfReader.pageNumbers}
          pageNumber={pdfReader.pageNumber}
          pdfDocument={pdfReader.pdfDocument}
          readerRef={readerRef}
          scale={pdfReader.scale}
          onFitToWidth={pdfReader.fitToWidth}
          onSelect={onSelect}
          onVisiblePageChange={pdfReader.setCurrentPage}
        />

        <div
          aria-label="调整即时理解面板宽度"
          aria-orientation="vertical"
          className="reader-resizer"
          onPointerDown={onInsightResizeStart}
          role="separator"
        />

        <SelectionInsightPanel selectionCard={selectionCard} width={insightPanelWidth} />
      </div>
    </section>
  )
}
