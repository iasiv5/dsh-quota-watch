# Capsule embed protocol (guest side)

The capsule is this plugin's only guaranteed surface and lives — together with the panel — in one body-level open shadow host (ADR 0001). The same owner's sibling plugin `dsh-stock-kanban` will merge its floating capsule into a "capsule group" inside its own float shell whenever both are installed. Investigation on 2026-11-09 established the hard facts: this plugin exposes no external hide/embed API today; hiding the float host kills the panel with it (manual redemption loses its only entry); hiding only the capsule element fights the render loop (the `hidden` state is rewritten every poll); plugin→plugin `peerDependencies` are ignored by both the DSH boot check and dshm's precheck; and `dsh.client.external` is a hard edge that breaks the consumer when this plugin is absent. A cooperative window-event protocol is the only robust channel — and both repositories share one owner, so the cost of the guest-side release is one routine npm publish.

**Status**: accepted (2026-11-09 design consensus; implementation scheduled behind dsh-stock-kanban's vanilla rewrite, as its "Plan B"; normative spec: `dsh-stock-kanban/docs/interop/capsule-embed-protocol.md` — single source of truth)

## Decision

- Implement the **guest side of the Capsule Embed Protocol (CEP v1)** on window-level namespaced CustomEvents (`dsh-quota-watch:*`, composed): answer capability probes; while embedded, hide the capsule **pill only** (float host and panel stay fully functional), open the panel anchored to a host-supplied rect on `open-panel`, pause this plugin's own **background** client polling chain (poll-pause), and self-restore (unhide + resume polling) on heartbeat timeout or `embed-disengage`.
- **No manifest coupling in either direction**: no peer dependency on the host plugin, no `dsh.client.external` edge toward it; absence of the host degrades exactly to today's standalone behaviour.
- The sidebar card and all routes are unaffected; the `GET api/dsh-quota-watch/overview` route becomes the host's data source for its quota pill segment (it already feeds the idle watcher, ADR 0006).

## Considered options

- **Invasive host-side CSS hide** (`[data-dsh-quota-watch-float] { display:none !important }`) — rejected: kills the panel and manual redemption with it; the attribute name is this plugin's private contract; version-fragile.
- **Passive DOM dataset broadcast only** — rejected as primary: no two-way negotiation; kept as a possible supplement.
- **localStorage flag protocol** — rejected: keys-as-contract, cross-tab semantics, entangled with this plugin's own prefs keys.

## Consequences

- A small release of this plugin is required before merging works; old versions simply coexist with the host's capsule (CEP degradation matrix) — no breakage window.
- Embedded state must never orphan: a 15 s heartbeat timeout restores the pill and polling even if the host disappears without disengage (disabled, crashed, HMR). The inverse holds too (0.1.39): a heartbeat arriving while standalone re-enters embedded directly — a standalone guest can only receive beats from a host that still considers the merge active, so the beat doubles as a re-engage signal and the split-brain state (host engaged / guest standalone) can no longer persist.
- Polling pauses only while embedded **with no guest data surface visible** (0.1.41): an open panel/pop or a visible sidebar card keeps this plugin's own chain running at its normal cadence, so opened cards never show a pre-merge snapshot; with all surfaces hidden, the host's 30 s overview polls keep the idle watcher fed and quota observations stay fresh with half the requests.
