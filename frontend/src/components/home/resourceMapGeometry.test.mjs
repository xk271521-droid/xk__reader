import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildResourceBranchPath,
  getResourceBranchOrigin,
} from './resourceMapGeometry.js'

test('computes the branch origin from the paper row bottom divider midpoint', () => {
  const origin = getResourceBranchOrigin({
    rowLeft: 100,
    rowWidth: 800,
    contentBottom: 226,
    mapLeft: 110,
    mapTop: 250,
    mapWidth: 780,
    mapHeight: 300,
  })

  assert.equal(origin.x_pct, 50)
  assert.equal(origin.y_pct, -8)
})

test('builds branch paths from the measured paper row origin to the leaf center', () => {
  const path = buildResourceBranchPath(
    { x_pct: 70, y_pct: 40 },
    0,
    5,
    { x_pct: 50, y_pct: -8 },
  )

  assert.match(path, /^M 50 -8 C /)
  assert.match(path, /70 40$/)
})
