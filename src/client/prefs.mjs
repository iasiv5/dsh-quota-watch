// Float-shell preferences for @iasiv5/dsh-quota-watch.
// Pure logic: no DOM. `storage` is a localStorage-like object (getItem/setItem).

export const FLOAT_GEOMETRY_KEY = 'dsh-quota-watch:float-geometry'
export const SURFACE_FLAGS_KEY = 'dsh-quota-watch:surface-flags'

const MARGIN = 8

export function clampPoint(point, viewport, size = 0) {
  const minX = MARGIN
  const minY = MARGIN
  const maxX = Math.max(MARGIN, viewport.width - MARGIN - size)
  const maxY = Math.max(MARGIN, viewport.height - MARGIN - size)
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  }
}

export function loadFloatGeometry(storage) {
  try {
    const raw = storage.getItem(FLOAT_GEOMETRY_KEY)
    if (typeof raw !== 'string' || raw === '') return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return null
    }
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

export function saveFloatGeometry(storage, point) {
  try {
    storage.setItem(FLOAT_GEOMETRY_KEY, JSON.stringify({ x: point.x, y: point.y }))
  } catch {
    /* storage unavailable; geometry stays session-only */
  }
}

export function loadSurfaceFlags(storage) {
  try {
    const raw = storage.getItem(SURFACE_FLAGS_KEY)
    if (typeof raw !== 'string' || raw === '') return { cardHidden: false }
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.cardHidden !== 'boolean') {
      return { cardHidden: false }
    }
    return { cardHidden: parsed.cardHidden }
  } catch {
    return { cardHidden: false }
  }
}

export function saveSurfaceFlags(storage, flags) {
  try {
    storage.setItem(SURFACE_FLAGS_KEY, JSON.stringify({ cardHidden: Boolean(flags?.cardHidden) }))
  } catch {
    /* storage unavailable; flags stay session-only */
  }
}
