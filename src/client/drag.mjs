// DOM-free drag state machine for @iasiv5/dsh-quota-watch (ADR 0002).
// Point/rect values come from the caller; nothing here touches the DOM, so the
// math stays unit-testable under jsdom.

import { MARGIN, clampPoint } from './prefs.mjs'

export const DRAG_SLOP_MOUSE = 6
export const DRAG_SLOP_TOUCH = 10
export const LONG_PRESS_MS = 500

/** Touch/pen gestures get the larger slop so taps win over drags. */
export function dragSlop(pointerType) {
  return pointerType === 'touch' || pointerType === 'pen' ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE
}

/** Offset between the pointer and the pill's top-left at grab time. */
export function grabOffset(point, rect) {
  return { dx: point.x - rect.left, dy: point.y - rect.top }
}

function pillTopLeft(point, grab) {
  return { x: point.x - grab.dx, y: point.y - grab.dy }
}

/** Live clamp for the pill top-left while the gesture is active. */
export function clampFrame(point, grab, size, viewport, insets) {
  return clampPoint(pillTopLeft(point, grab), viewport, size, insets)
}

/** Rest dock for a release: nearest horizontal edge by pill center, vertical offset clamped. */
export function releaseDock(point, grab, size, viewport, insets) {
  const topLeft = pillTopLeft(point, grab)
  const centerX = topLeft.x + size.width / 2
  const edge = centerX < viewport.width / 2 ? 'left' : 'right'
  return { edge, offsetY: clampPoint(topLeft, viewport, size, insets).y }
}

/** Resting x for a docked pill: always derived, never stored. */
export function dockX(edge, width, viewport, insets) {
  const insetLeft = Number.isFinite(insets?.left) ? insets.left : 0
  const insetRight = Number.isFinite(insets?.right) ? insets.right : 0
  return edge === 'left' ? MARGIN + insetLeft : viewport.width - insetRight - MARGIN - width
}

/** Computed-style padding value ("20px" | "" | "auto") → numeric inset or 0. */
export function parseInset(computedValue) {
  const value = Number.parseFloat(computedValue)
  return Number.isFinite(value) ? value : 0
}
