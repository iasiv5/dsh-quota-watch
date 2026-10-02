// DOM-free drag state machine for @iasiv5/dsh-quota-watch.
// Point/rect values come from the caller; nothing here touches the DOM, so the
// math stays unit-testable under jsdom.

import { clampPoint } from './prefs.mjs'

export const DRAG_SLOP_MOUSE = 6
export const DRAG_SLOP_TOUCH = 10

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

/** Live clamp for the pill top-left while the gesture is active or upon release. */
export function clampFrame(point, grab, size, viewport, insets) {
  return clampPoint(pillTopLeft(point, grab), viewport, size, insets)
}

/** Computed-style padding value ("20px" | "" | "auto") → numeric inset or 0. */
export function parseInset(computedValue) {
  const value = Number.parseFloat(computedValue)
  return Number.isFinite(value) ? value : 0
}
