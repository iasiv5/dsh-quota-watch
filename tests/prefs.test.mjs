import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FLOAT_DOCK_KEY,
  FLOAT_GEOMETRY_KEY,
  SURFACE_FLAGS_KEY,
  clampPoint,
  loadFloatDock,
  saveFloatDock,
  loadFloatGeometry,
  saveFloatGeometry,
  loadSurfaceFlags,
  saveSurfaceFlags,
} from '../src/client/prefs.mjs'

function storageStub(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  }
}

test('clampPoint keeps the point inside the viewport with an 8px margin', () => {
  const clamped = clampPoint({ x: -5, y: 9999 }, { width: 800, height: 600 })
  assert.equal(clamped.x, 8)
  assert.equal(clamped.y, 592)
  assert.deepEqual(clampPoint({ x: 400, y: 300 }, { width: 800, height: 600 }), { x: 400, y: 300 })
})

test('clampPoint shrinks the upper bound by the element size', () => {
  const clamped = clampPoint({ x: 9999, y: 9999 }, { width: 800, height: 600 }, 38)
  assert.equal(clamped.x, 800 - 8 - 38)
  assert.equal(clamped.y, 600 - 8 - 38)
  const tiny = clampPoint({ x: 50, y: 50 }, { width: 10, height: 10 }, 38)
  assert.equal(tiny.x, 8)
  assert.equal(tiny.y, 8)
})

test('loadFloatGeometry returns null for missing or corrupt JSON and round-trips valid values', () => {
  const storage = storageStub()
  assert.equal(loadFloatGeometry(storage), null)
  storage.setItem(FLOAT_GEOMETRY_KEY, '{')
  assert.equal(loadFloatGeometry(storage), null)
  saveFloatGeometry(storage, { x: 12, y: 34 })
  assert.deepEqual(loadFloatGeometry(storage), { x: 12, y: 34 })
})

test('loadFloatGeometry rejects non-finite coordinates', () => {
  const storage = storageStub({ [FLOAT_GEOMETRY_KEY]: '{"x":"a","y":1}' })
  assert.equal(loadFloatGeometry(storage), null)
  storage.setItem(FLOAT_GEOMETRY_KEY, '{"x":1}')
  assert.equal(loadFloatGeometry(storage), null)
})

test('surface flags default to card hidden (capsule-first) and survive corruption', () => {
  const storage = storageStub()
  assert.deepEqual(loadSurfaceFlags(storage), { cardHidden: true })
  storage.setItem(SURFACE_FLAGS_KEY, 'not-json')
  assert.deepEqual(loadSurfaceFlags(storage), { cardHidden: true })
  saveSurfaceFlags(storage, { cardHidden: false })
  assert.deepEqual(loadSurfaceFlags(storage), { cardHidden: false })
})

// --- float-dock API (0.1.11 capsule-polish, Task 2) ---

test('loadFloatDock returns null for missing/corrupt/invalid values and round-trips valid ones', () => {
  const storage = storageStub()
  assert.equal(loadFloatDock(storage), null)
  storage.setItem(FLOAT_DOCK_KEY, '')
  assert.equal(loadFloatDock(storage), null)
  storage.setItem(FLOAT_DOCK_KEY, '{')
  assert.equal(loadFloatDock(storage), null)
  storage.setItem(FLOAT_DOCK_KEY, '{"edge":"top","offsetY":1}')
  assert.equal(loadFloatDock(storage), null)
  storage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":"a"}')
  assert.equal(loadFloatDock(storage), null)
  storage.setItem(FLOAT_DOCK_KEY, '{"edge":"right"}')
  assert.equal(loadFloatDock(storage), null)
  storage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  assert.deepEqual(loadFloatDock(storage), { edge: 'left', offsetY: 80 })
  storage.setItem(FLOAT_DOCK_KEY, '{"edge":"right","offsetY":120.5}')
  assert.deepEqual(loadFloatDock(storage), { edge: 'right', offsetY: 120.5 })
})

test('saveFloatDock rejects invalid docks with TypeError and persists valid ones', () => {
  const storage = storageStub()
  assert.throws(() => saveFloatDock(storage, { edge: 'top', offsetY: 0 }), TypeError)
  assert.throws(() => saveFloatDock(storage, { edge: 'left', offsetY: NaN }), TypeError)
  assert.throws(() => saveFloatDock(storage, { edge: 'left', offsetY: 'a' }), TypeError)
  assert.throws(() => saveFloatDock(storage, null), TypeError)
  saveFloatDock(storage, { edge: 'left', offsetY: 42 })
  assert.equal(storage.getItem(FLOAT_DOCK_KEY), '{"edge":"left","offsetY":42}')
})

test('clampPoint accepts a {width,height} element size', () => {
  const clamped = clampPoint({ x: -5, y: 9999 }, { width: 800, height: 600 }, { width: 120, height: 26 })
  assert.equal(clamped.x, 8)
  assert.ok(clamped.y <= 600 - 8 - 26, `y clamped to height-8-26 band, got ${clamped.y}`)
  assert.equal(clamped.y, 566)
})

test('clampPoint honors safe-area insets', () => {
  const clamped = clampPoint(
    { x: 0, y: 0 },
    { width: 800, height: 600 },
    { width: 120, height: 26 },
    { left: 20, right: 0, top: 10, bottom: 0 },
  )
  assert.equal(clamped.x, 28)
  assert.equal(clamped.y, 18)
})
