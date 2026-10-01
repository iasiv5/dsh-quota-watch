import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FLOAT_GEOMETRY_KEY,
  FLOAT_MODE_KEY,
  SURFACE_FLAGS_KEY,
  clampPoint,
  loadFloatGeometry,
  saveFloatGeometry,
  loadFloatMode,
  saveFloatMode,
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

test('loadFloatMode falls back to ball and rejects invalid saves', () => {
  const storage = storageStub()
  assert.equal(loadFloatMode(storage), 'ball')
  storage.setItem(FLOAT_MODE_KEY, 'capsule')
  assert.equal(loadFloatMode(storage), 'capsule')
  storage.setItem(FLOAT_MODE_KEY, 'crap')
  assert.equal(loadFloatMode(storage), 'ball')
  assert.throws(() => saveFloatMode(storage, 'nope'), TypeError)
  saveFloatMode(storage, 'capsule')
  assert.equal(loadFloatMode(storage), 'capsule')
})

test('surface flags default to card visible and survive corruption', () => {
  const storage = storageStub()
  assert.deepEqual(loadSurfaceFlags(storage), { cardHidden: false })
  storage.setItem(SURFACE_FLAGS_KEY, 'not-json')
  assert.deepEqual(loadSurfaceFlags(storage), { cardHidden: false })
  saveSurfaceFlags(storage, { cardHidden: true })
  assert.deepEqual(loadSurfaceFlags(storage), { cardHidden: true })
})
