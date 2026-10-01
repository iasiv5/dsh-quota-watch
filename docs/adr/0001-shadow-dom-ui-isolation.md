# Shadow DOM isolation for all quota-watch UI surfaces

All plugin UI (ball, capsule, panel, sidebar card) renders inside an open shadow root instead of appending page-level `<style>` tags to the host document. External actors in the user's browser (style-stripping extensions; recorded as know-how 017) repeatedly killed the single page-level style tag behind the sidebar card, and 0.0.18's adoptedStyleSheets mirror + per-render self-heal only treats the symptom — permanently visible floating UI would stay exposed to the same class of interference.

**Status**: accepted (2026-10-01)

## Considered options

- **Keep global style tags + 0.0.18 self-heal** — rejected: the bug class survives, and every new surface re-exposes it.
- **Shadow root with blanket `all:initial`** (the dsh-todo-float-ball pattern) — rejected: `all:initial` resets the inherited text properties (`font`, `color`, `line-height`) that quota-watch UI deliberately inherits from the DSH app via `font: inherit`, breaking visual integration with every theme. (Custom properties are *not* reset by `all`, so `--dsw-alias-*` inheritance survives either way; a targeted host reset preserves everything we actually inherit.)
- **Closed shadow root** — rejected: 017-style forensics and jsdom tests rely on DOM inspection.

## Consequences

- The shadow host gets an explicit minimal reset instead of `all:initial`; inherited properties the UI relies on (`font: inherit`, theme colors) keep flowing through the boundary, and every `--dsw-alias-*` variable keeps a hardcoded fallback.
- Document-level style machinery (style tag creation, `ensureStyleAlive`, adoptedStyleSheets mirroring on `document`) is retired; stylesheet content lives inside the shadow root where external actors cannot reach it.
- Tests and forensic probes must query through `shadowRoot`, not `document`.
- know-how 017's remedy section and its upgrade check (`grep ensureStyleAlive`) must be rewritten when 0.1.0 ships.
