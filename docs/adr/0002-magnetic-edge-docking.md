# Magnetic edge docking with edge+offset position memory

The capsule's rest position was stored as free `{x, y}` coordinates validated against a fixed 38px box — the retired round ball's diameter. The capsule is actually ~26px tall and content-wide (~120–150px), so the default placement and right-edge clamping pushed a large part of the pill off-screen. Free coordinates also degrade poorly whenever the viewport changes (Electron window resize, phone rotation): the saved point means nothing on a different screen shape. The drag itself pinned the host's top-left corner to the pointer (a visible jump at grab time) and wrote `left/top` on every `pointermove`, paying layout per frame. Mobile browsers add hard constraints: touch panning steals the gesture without `touch-action: none`, `pointercancel` goes unhandled (stuck drag state), iOS Safari never fires `contextmenu` (the menu is unreachable), and a 26px pill is under every touch-target guideline.

**Status**: accepted (2026-10-02)

## Decision

- **Position memory becomes `{edge: 'left' | 'right', offsetY}` under a new storage key** (`dsh-quota-watch:float-dock`). The horizontal coordinate is always derived at render time from the docked edge and the *measured* width, so width changes and rotation self-correct. Stored `float-geometry` values are ignored, not migrated: any conversion is lossy exactly when the viewport changed — the case docking exists to handle. The one-time cost is a jump to the default right-bottom dock after upgrade.
- **Docking is left/right only, fully visible** with the clamp margin (8px). The capsule is an information surface; chat-heads-style half-hidden "peek" docking hides the data it exists to show.
- **Drag pipeline**: preserve the grab offset, apply movement via `transform` during the gesture (rAF-batched, live-clamped with the measured rect), and commit `left/top` + persist the dock only on release. Snap-to-edge plays a short transform transition, suppressed under `prefers-reduced-motion`.
- **Touch protocol**: `touch-action: none` on the pill; `pointercancel` aborts the drag cleanly; drag slop is graded (6px mouse, 10px touch); a 500ms long-press opens the context menu (compensating for iOS's missing `contextmenu`); the hit area is padded to ≥44px while the visual pill stays 26px.

## Considered options

- **Keep x,y + convert to dock on load** — rejected: the conversion is guesswork across viewport changes; new key + no migration is honest and simpler.
- **Keep x,y, only clamp with the measured size** — rejected: fixes the off-screen bug but keeps the rotation/resize degradation and the top-left-pin drag feel.
- **Fling / velocity release physics** — rejected: marginal value for a monitoring HUD, and the physics are not meaningfully testable under jsdom.
- **Peek docking (partially off-screen rest)** — rejected: hides the percentages.

## Consequences

- `prefs.mjs`'s float-geometry helpers are retired in favor of dock load/save and an insets-aware `clampPoint`; safe-area insets enter the clamp via a computed-style probe.
- Drag and dock math live in a DOM-free module (`src/client/drag.mjs`) so the state machine stays unit-testable — same discipline as `prefs.mjs`.
- The resize handler re-derives the horizontal position from the stored edge instead of clamping raw coordinates.
- know-how and release checks are unaffected: no engine-floor change, and ADR 0001's shadow-DOM criteria (`attachShadow` ≥ 1) still hold.
