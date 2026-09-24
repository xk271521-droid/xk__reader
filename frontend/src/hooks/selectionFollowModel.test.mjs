import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampSelectionFollowPanelPosition,
  getSelectionFollowPanelPosition,
  resolveSelectionFollowAnchor,
} from './selectionFollowModel.js'

test('resolveSelectionFollowAnchor recomputes legacy reader geometry from the page element', () => {
  const anchor = resolveSelectionFollowAnchor({
    anchorElement: {
      getBoundingClientRect: () => ({ left: 100, top: 80, width: 600, height: 840 }),
    },
    rects: [{ left: 0.25, top: 0.5, width: 0.2, height: 0.03 }],
  })

  assert.deepEqual(anchor, { left: 250, top: 500, width: 120, height: 25.2 })
})

test('resolveSelectionFollowAnchor uses the PDFium selection wrapper when geometry is in PDF units', () => {
  const anchor = resolveSelectionFollowAnchor({
    anchorElement: {
      getBoundingClientRect: () => ({ left: 220, top: 360, width: 144, height: 22 }),
    },
    anchorRect: { origin: { x: 72, y: 144 }, size: { width: 90, height: 12 } },
  })

  assert.deepEqual(anchor, { left: 220, top: 360, width: 144, height: 22 })
})

test('resolveSelectionFollowAnchor falls back to the captured client rect after the menu unmounts', () => {
  const anchor = resolveSelectionFollowAnchor({
    anchorElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    },
    anchorClientRect: { left: 320, top: 180, width: 96, height: 20 },
  })

  assert.deepEqual(anchor, { left: 320, top: 180, width: 96, height: 20 })
})

test('getSelectionFollowPanelPosition prefers a below-selection placement and keeps the panel on screen', () => {
  const position = getSelectionFollowPanelPosition(
    { left: 8, top: 40, width: 30, height: 18 },
    { width: 304, height: 164 },
    { width: 360, height: 800 },
  )

  assert.deepEqual(position, { left: 164, top: 68, placement: 'below' })
})

test('getSelectionFollowPanelPosition moves above the selection when below space is unavailable', () => {
  const position = getSelectionFollowPanelPosition(
    { left: 420, top: 520, width: 80, height: 20 },
    { width: 304, height: 164 },
    { width: 900, height: 700 },
  )

  assert.deepEqual(position, { left: 460, top: 510, placement: 'above' })
})

test('clampSelectionFollowPanelPosition keeps a dragged panel inside the reader bounds', () => {
  const position = clampSelectionFollowPanelPosition(
    { left: 4, top: 690 },
    { width: 304, height: 164 },
    { left: 40, top: 80, right: 840, bottom: 720 },
  )

  assert.deepEqual(position, { left: 40, top: 556 })
})
