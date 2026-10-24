# DSH Quota Watch

This context names the provider-reported plan allowances monitored for a personal DSH setup, keeping those facts distinct from token usage observed in DSH sessions. It also names the UI surfaces through which those observations are presented.

## Language

**Provider-reported quota**: A provider's own report of consumption or remaining allowance for an account. It is distinct from token totals inferred from DSH session events.
_Avoid_: Session usage, token ledger

**Quota window**: A provider-defined period or allowance bucket, such as a rolling five-hour window, a week, or a month, with an optional reset time.
_Avoid_: Billing period (unless the provider specifically defines a calendar billing period)

**Quota observation**: A point-in-time reading of a provider-reported quota. It is not a continuous event stream and may lag the provider's underlying accounting.
_Avoid_: Real-time usage (when implying per-request precision)

**Stale provider observation**: A previously successful quota or usage reading retained after a subsequent attempt to refresh that same reading failed. Showing the last successful reading between scheduled polls is ordinary caching, not this failure state.
_Avoid_: Cached reading (as a synonym for stale), live data

**Idle polling pause**: The host-side suspension of scheduled quota probes after a quiet period with no request to any plugin route (default: two poll intervals). The first client request resumes probing immediately: it is answered from the last cached quota observation while a fresh round runs in the background. A pause is not a failed refresh and never marks an observation stale.
_Avoid_: Sleep mode, offline mode, background refresh (implies probing continues)

**GitHub AI Credits**: GitHub's current Copilot usage-billing unit, distinct from the legacy Premium Requests allowance. Credits are accounted for by the relevant billing entity; an organization-managed seat does not by itself create an individually reserved balance.
_Avoid_: Premium requests (as a synonym for AI Credits), seat balance (unless separately defined)

**Copilot AI credit usage**: Credits attributed as consumed by a person during a billing period. This is a usage measure and does not alone show how much remains in an organization's shared pool.
_Avoid_: Credit balance, quota remaining

**Copilot remaining quota**: A finite amount the provider reports as available in a user's active Copilot quota view. For organization-managed seats, this view is not necessarily the remaining credits in the organization's shared billing pool.
_Avoid_: Organization-wide balance

**Copilot AI credit balance**: Unspent credits at the applicable personal or organizational billing entity. For an organization-managed seat, a per-user balance cannot be inferred from that person's consumption alone.
_Avoid_: Per-user remaining balance (for pooled organizational credits)

**Used percentage**: The share of a quota window that a provider reports as consumed, or the arithmetic inversion (100 − value) of a provider-reported remaining percentage when a view normalizes both providers to used. An inverted value is anchored to a single provider-reported number, never combined with other fields.
_Avoid_: Presenting an inverted value as provider-reported used; deriving used from entitlement minus a separately reported consumed amount

**Provider usage statistic**: Token totals and call counts that a provider's monitor API reports for a stated query interval, such as the host-local calendar day ("today"). It is a consumption measure over an interval, distinct from quota windows and from anything inferred from DSH session events.
_Avoid_: Calling it a quota; session usage; treating the interval as a rolling window unless it is one

**Reset card**: An expiring, provider-granted entitlement that can be redeemed once to clear an eligible quota window; a weekly reset card also clears the five-hour window. It is not the quota window or its remaining percentage.
_Avoid_: Quota balance, free refresh

**Card redemption**: The irreversible consumption of one reset card, distinct from querying a card count or refreshing a quota observation. In the current capability set it happens only through the explicitly confirmed manual flow; the retired automatic policy is kept as a historical term below.
_Avoid_: Refresh, re-probe
**Automatic card use (retired)**: A formerly separately authorized policy that redeemed a reset card when a fresh quota observation met the chosen window's trigger. Retired by ADR 0004: no live code path can authorize or execute it, and the term survives only for reading historical decisions and the legacy settings file that the startup retirement forces off.
_Avoid_: Describing it as an active capability; automatic refresh

**Manual outcome journal**: The host-side single-entry record of one manual card redemption, durably written before the irreversible POST and kept until the user verifies an unknown outcome or acknowledges a known one. It carries only an opaque attempt id, card type, start time and status — never credentials or provider card ids.
_Avoid_: Log file (implies diagnostics), retry queue

**Manual redemption flow**: The client-side sequence that carries one card redemption from the explicit confirmation on a reset-card row, through the single irreversible spend request, to outcome presentation and delivery confirmation (receipt or acknowledge). Its data inputs are the host snapshot's reset and manual-outcome slices; a pending outcome keeps the capsule present as a warning entry until the journal record clears.
_Avoid_: reset flow (the implementation's internal vocabulary), automatic card use (retired), refresh

### UI surfaces

**Capsule**:
The persistent, draggable floating pill — the plugin's only guaranteed surface — that renders each provider's used percentage in one line. It mounts at the top level of the page (never inside host-managed containers), opens the panel on click, and is the plugin's primary entry point; it has no context menu (its actions live in the panel footer).
_Avoid_: floating ball, ball, floating window, FAB, widget, mini mode, context menu

**Free-floating position memory**:
The capsule's position persistence behavior where user-placed coordinates {x, y} are remembered across sessions, with the element's measured geometry kept clamped inside viewport boundaries and safe-area margins.
_Avoid_: edge docking (retired), magnetic snap, peek, unconstrained coordinates


**Panel**:
The floating surface opened from the capsule or a card row, containing the quota overview and per-provider detail views; it is not a separate navigable page.
_Avoid_: page, popup, pop (implementation class name only), modal, context menu

**Sidebar card (card)**:
The opportunistic entry rendered in the DSH web sidebar footer when that mount point exists; it is silently absent when the point does not (collapsed sidebar, desktop profile).
_Avoid_: rail trigger (retired), sidebar widget
