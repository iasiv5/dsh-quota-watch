import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAG_SLOP_MOUSE,
  DRAG_SLOP_TOUCH,
  LONG_PRESS_MS,
  clampFrame,
  dragSlop,
  grabOffset,
  parseInset,
} from '../src/client/drag.mjs'

const ZERO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 }

test('drag constants follow the platform conventions', () => {
  assert.equal(DRAG_SLOP_MOUSE, 6)
  assert.equal(DRAG_SLOP_TOUCH, 10)
  assert.equal(LONG_PRESS_MS, 500)
})

test('dragSlop grades by pointer type with a mouse default', () => {
  assert.equal(dragSlop('touch'), DRAG_SLOP_TOUCH)
  assert.equal(dragSlop('pen'), DRAG_SLOP_TOUCH)
  assert.equal(dragSlop('mouse'), DRAG_SLOP_MOUSE)
  assert.equal(dragSlop(undefined), DRAG_SLOP_MOUSE)
})

test('grabOffset keeps the grab point under the cursor', () => {
  const rect = { left: 80, top: 40, right: 200, bottom: 66, width: 120, height: 26 }
  assert.deepEqual(grabOffset({ x: 100, y: 50 }, rect), { dx: 20, dy: 10 })
})

test('clampFrame clamps the pill top-left during the gesture and on release', () => {
  const point = { x: -50, y: 9999 }
  const grab = { dx: 20, dy: 10 }
  const size = { width: 120, height: 26 }
  assert.deepEqual(clampFrame(point, grab, size, { width: 800, height: 600 }, ZERO_INSETS), { x: 8, y: 566 })
  // Normal in-bounds point maintains exact position offset
  assert.deepEqual(clampFrame({ x: 300, y: 200 }, { dx: 50, dy: 10 }, size, { width: 800, height: 600 }, ZERO_INSETS), { x: 250, y: 190 })
})

test('parseInset normalizes computed safe-area values to numbers', () => {
  assert.equal(parseInset('20px'), 20)
  assert.equal(parseInset(''), 0)
  assert.equal(parseInset('auto'), 0)
  assert.equal(parseInset(undefined), 0)
})
