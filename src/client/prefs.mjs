// Float-shell preferences for @iasiv5/dsh-quota-watch.
// Pure logic: no DOM. `storage` is a localStorage-like object (getItem/setItem).

export const FLOAT_GEOMETRY_KEY = 'dsh-quota-watch:float-geometry'
export const FLOAT_DOCK_KEY = 'dsh-quota-watch:float-dock'
export const SURFACE_FLAGS_KEY = 'dsh-quota-watch:surface-flags'

export const MARGIN = 8

const ZERO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 }

function normalizeSize(size) {
  if (typeof size === 'number') return { width: size, height: size }
  const width = typeof size?.width === 'number' ? size.width : 0
  const height = typeof size?.height === 'number' ? size.height : 0
  return { width, height }
}

export function clampPoint(point, viewport, size = 0, insets = ZERO_INSETS) {
  const { width, height } = normalizeSize(size)
  const insetLeft = Number.isFinite(insets?.left) ? insets.left : 0
  const insetRight = Number.isFinite(insets?.right) ? insets.right : 0
  const insetTop = Number.isFinite(insets?.top) ? insets.top : 0
  const insetBottom = Number.isFinite(insets?.bottom) ? insets.bottom : 0
  const minX = MARGIN + insetLeft
  const minY = MARGIN + insetTop
  const maxX = Math.max(minX, viewport.width - insetRight - MARGIN - width)
  const maxY = Math.max(minY, viewport.height - insetBottom - MARGIN - height)
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

const DOCK_EDGES = new Set(['left', 'right'])

export function loadFloatDock(storage) {
  try {
    const raw = storage.getItem(FLOAT_DOCK_KEY)
    if (typeof raw !== 'string' || raw === '') return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !DOCK_EDGES.has(parsed.edge) ||
      !Number.isFinite(parsed.offsetY)
    ) {
      return null
    }
    return { edge: parsed.edge, offsetY: parsed.offsetY }
  } catch {
    return null
  }
}

export function saveFloatDock(storage, dock) {
  if (
    typeof dock !== 'object' ||
    dock === null ||
    !DOCK_EDGES.has(dock.edge) ||
    !Number.isFinite(dock.offsetY)
  ) {
    throw new TypeError(`invalid float dock: ${JSON.stringify(dock)}`)
  }
  try {
    storage.setItem(FLOAT_DOCK_KEY, JSON.stringify({ edge: dock.edge, offsetY: dock.offsetY }))
  } catch {
    /* storage unavailable; dock stays session-only */
  }
}

export function loadSurfaceFlags(storage) {
  try {
    const raw = storage.getItem(SURFACE_FLAGS_KEY)
    // The sidebar card is opt-in: the floating capsule is the default surface.
    if (typeof raw !== 'string' || raw === '') return { cardHidden: true }
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.cardHidden !== 'boolean') {
      return { cardHidden: true }
    }
    return { cardHidden: parsed.cardHidden }
  } catch {
    return { cardHidden: true }
  }
}

export function saveSurfaceFlags(storage, flags) {
  try {
    storage.setItem(SURFACE_FLAGS_KEY, JSON.stringify({ cardHidden: Boolean(flags?.cardHidden) }))
  } catch {
    /* storage unavailable; flags stay session-only */
  }
}
