import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown, ChevronUp, MapPin, Pencil, Trash2 } from 'lucide-react'
import {
  DEFAULT_SHAPE_OPTIONS,
  getLocalArrowEndpoints,
  getShapeColor,
  getShapeDisplayBox,
  getShapeFontSize,
  getShapeStrokeWidth,
  isTextAnnotationCollapsed,
} from './shapeAnnotationModel'

function stopEvent(event) {
  event.preventDefault()
  event.stopPropagation()
}

function ShapeActionButtons({
  annotation,
  collapsed = false,
  className = '',
  style = undefined,
  onToggleCollapse,
  onEdit,
  onDelete,
}) {
  return (
    <div
      className={`pdf-shape-annotation__actions${className ? ` ${className}` : ''}`}
      style={style}
      onPointerDown={stopEvent}
    >
      {annotation.type === 'text' ? (
        <>
          <button
            type="button"
            className="pdf-shape-annotation__action"
            title={collapsed ? 'Expand' : 'Collapse'}
            onPointerDown={stopEvent}
            onClick={(event) => {
              stopEvent(event)
              onToggleCollapse?.(annotation.id, !collapsed)
            }}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            type="button"
            className="pdf-shape-annotation__action"
            title="Edit"
            onPointerDown={stopEvent}
            onClick={(event) => {
              stopEvent(event)
              onEdit?.(annotation.id)
            }}
          >
            <Pencil size={12} />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="pdf-shape-annotation__action"
        title="Delete"
        onPointerDown={stopEvent}
        onClick={(event) => {
          stopEvent(event)
          onDelete?.(annotation.id)
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function ShapeHandles({ annotation, collapsed = false, onHandlePointerDown }) {
  if (annotation.type === 'text' && collapsed) return null

  if (annotation.type === 'arrow') {
    const { startX, startY, endX, endY } = getLocalArrowEndpoints(annotation)
    return (
      <>
        <span
          className="pdf-shape-annotation__handle pdf-shape-annotation__handle--point"
          style={{ left: `${startX * 100}%`, top: `${startY * 100}%` }}
          onPointerDown={(event) => onHandlePointerDown?.(event, annotation.id, 'arrow-start')}
        />
        <span
          className="pdf-shape-annotation__handle pdf-shape-annotation__handle--point"
          style={{ left: `${endX * 100}%`, top: `${endY * 100}%` }}
          onPointerDown={(event) => onHandlePointerDown?.(event, annotation.id, 'arrow-end')}
        />
      </>
    )
  }

  return (
    <span
      className="pdf-shape-annotation__handle pdf-shape-annotation__handle--se"
      onPointerDown={(event) => onHandlePointerDown?.(event, annotation.id, 'resize-se')}
    />
  )
}

function renderShapeBody(annotation) {
  const color = getShapeColor(annotation)
  const strokeWidth = getShapeStrokeWidth(annotation)
  const fontSize = getShapeFontSize(annotation)
  const collapsed = isTextAnnotationCollapsed(annotation)

  if (annotation.type === 'arrow') {
    const { startX, startY, endX, endY } = getLocalArrowEndpoints(annotation)
    const viewBoxWidth = Math.max(Number(annotation?.width) || 0.0001, 0.0001)
    const viewBoxHeight = Math.max(Number(annotation?.height) || 0.0001, 0.0001)
    return (
      <svg
        className="pdf-shape-annotation__svg"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
      >
        <defs>
          <marker
            id={`pdf-shape-arrow-${annotation.id}`}
            viewBox="0 0 10 10"
            markerWidth="8"
            markerHeight="8"
            refX="8.6"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0.8 1.1 L 9.2 5 L 0.8 8.9 L 3.1 5 z" fill={color} />
          </marker>
        </defs>
        <line
          x1={startX * viewBoxWidth}
          y1={startY * viewBoxHeight}
          x2={endX * viewBoxWidth}
          y2={endY * viewBoxHeight}
          stroke={color}
          strokeWidth={Math.max(2, strokeWidth)}
          strokeLinecap="round"
          strokeLinejoin="round"
          markerEnd={`url(#pdf-shape-arrow-${annotation.id})`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }

  if (annotation.type === 'rect') {
    return (
      <div
        className="pdf-shape-annotation__rect"
        style={{
          borderColor: color,
          borderWidth: `${strokeWidth}px`,
          backgroundColor: `${color}14`,
        }}
      />
    )
  }

  if (annotation.type === 'circle') {
    return (
      <div
        className="pdf-shape-annotation__circle"
        style={{
          borderColor: color,
          borderWidth: `${strokeWidth}px`,
          backgroundColor: `${color}12`,
        }}
      />
    )
  }

  if (annotation.type === 'pin') {
    return (
      <div
        className="pdf-shape-annotation__pin"
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: color,
          fontSize: `${fontSize}px`,
        }}
      >
        {annotation.content || annotation.extra?.number || '#'}
      </div>
    )
  }

  if (collapsed) {
    return (
      <div
        className="pdf-shape-annotation__text-chip pdf-shape-annotation__text-chip--pin"
        style={{
          width: '100%',
          height: '100%',
          color: '#ffffff',
          backgroundColor: color,
          boxShadow: `0 12px 24px ${color}45`,
        }}
        title={annotation.content || 'Text annotation'}
      >
        <MapPin size={Math.max(13, fontSize - 1)} strokeWidth={2.15} />
      </div>
    )
  }

  return (
    <div
      className="pdf-shape-annotation__text"
      style={{
        color,
        fontSize: `${fontSize}px`,
        borderColor: `${color}50`,
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
      }}
    >
      {annotation.content || 'Text annotation'}
    </div>
  )
}

export function ShapeAnnotationLayer({
  annotations = [],
  selectedShapeId = null,
  previewShape = null,
  textEditor = null,
  onShapePointerDown,
  onShapeDoubleClick,
  onShapeHandlePointerDown,
  onShapeDelete,
  onShapeEdit,
  onShapeToggleCollapse,
  onTextEditorChange,
  onTextEditorCommit,
  onTextEditorCancel,
}) {
  const items = previewShape ? [...annotations, previewShape] : annotations
  const editorStyle = textEditor?.style || DEFAULT_SHAPE_OPTIONS
  const textEditorRef = useRef(null)
  const editingAnnotation = useMemo(
    () => (textEditor?.annotationId != null
      ? annotations.find((annotation) => annotation.id === textEditor.annotationId) || null
      : null),
    [annotations, textEditor?.annotationId],
  )
  const editingCollapsed = isTextAnnotationCollapsed(editingAnnotation)

  useEffect(() => {
    const element = textEditorRef.current
    if (!element || !textEditor) return
    element.focus()
    const textLength = element.value.length
    element.setSelectionRange(textLength, textLength)
  }, [
    textEditor?.annotationId,
    textEditor?.pageNumber,
    textEditor?.x,
    textEditor?.y,
    textEditor?.width,
    textEditor?.height,
  ])

  return (
    <div className="pdf-shape-annotation-layer">
      {items.map((annotation) => {
        const isSelected = annotation.id === selectedShapeId
        const isPreview = Boolean(annotation.isPreview)
        const collapsed = isTextAnnotationCollapsed(annotation)
        const displayBox = getShapeDisplayBox(annotation)
        const isEditingCurrentText = textEditor?.annotationId != null && textEditor.annotationId === annotation.id

        return (
          <div
            key={annotation.id}
            className={`pdf-shape-annotation pdf-shape-annotation--${annotation.type}${
              isSelected ? ' is-selected' : ''
            }${isPreview ? ' is-preview' : ''}${collapsed ? ' is-collapsed' : ''}`}
            style={{
              left: `${displayBox.x * 100}%`,
              top: `${displayBox.y * 100}%`,
              width: `${displayBox.width * 100}%`,
              height: `${displayBox.height * 100}%`,
            }}
            onPointerDown={isPreview ? undefined : (event) => onShapePointerDown?.(event, annotation.id)}
            onDoubleClick={isPreview ? undefined : (event) => onShapeDoubleClick?.(event, annotation.id)}
          >
            {renderShapeBody(annotation)}
            {isSelected && !isPreview && !isEditingCurrentText ? (
              <>
                <ShapeActionButtons
                  annotation={annotation}
                  collapsed={collapsed}
                  onToggleCollapse={onShapeToggleCollapse}
                  onEdit={onShapeEdit}
                  onDelete={onShapeDelete}
                />
                <ShapeHandles
                  annotation={annotation}
                  collapsed={collapsed}
                  onHandlePointerDown={onShapeHandlePointerDown}
                />
              </>
            ) : null}
          </div>
        )
      })}

      {textEditor ? (
        <>
          <textarea
            ref={textEditorRef}
            className="pdf-shape-text-editor"
            style={{
              left: `${textEditor.x * 100}%`,
              top: `${textEditor.y * 100}%`,
              width: `${textEditor.width * 100}%`,
              height: `${textEditor.height * 100}%`,
              color: editorStyle.color || DEFAULT_SHAPE_OPTIONS.color,
              fontSize: `${editorStyle.fontSize || DEFAULT_SHAPE_OPTIONS.fontSize}px`,
            }}
            value={textEditor.content}
            placeholder="输入标注内容"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onTextEditorChange?.(event.target.value)}
            onBlur={(event) => onTextEditorCommit?.(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onTextEditorCancel?.()
              }
            }}
          />
          {editingAnnotation ? (
            <ShapeActionButtons
              annotation={editingAnnotation}
              collapsed={editingCollapsed}
              className="pdf-shape-text-editor__actions"
              style={{
                left: `${Math.min(100, (textEditor.x + textEditor.width) * 100)}%`,
                top: `${Math.max(0, textEditor.y * 100)}%`,
              }}
              onToggleCollapse={onShapeToggleCollapse}
              onEdit={onShapeEdit}
              onDelete={onShapeDelete}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
