# DSH Quota Watch

This context names the provider-reported plan allowances monitored for a personal DSH setup, keeping those facts distinct from token usage observed in DSH sessions. It also names the UI surfaces through which those observations are presented.

## Language

**Provider-reported quota**: A provider's own report of consumption or remaining allowance for an account. It is distinct from token totals inferred from DSH session events.
_Avoid_: Session usage, token ledger

**Quota window**: A provider-defined period or allowance bucket, such as a rolling five-hour window, a week, or a month, with an optional reset time.
_Avoid_: Billing period (unless the provider specifically defines a calendar billing period)

**Quota observation**: A point-in-time reading of a provider-reported quota. It is not a continuous event stream and may lag the provider's underlying accounting.
_Avoid_: Real-time usage (when implying per-request precision)

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

**Reset-card availability**: A provider observation of currently usable reset cards. A successful empty result means none are available; a failed query means availability is unknown, not zero.
_Avoid_: Treating a failed query as no cards, quota balance

**Card redemption**: The irreversible consumption of one reset card, distinct from querying a card count or refreshing a quota observation.
_Avoid_: Refresh, re-probe

**Uncertain redemption**: A card-use request whose outcome cannot be confirmed; the card may already have been consumed. Affected quota windows remain protected from another redemption until the outcome is reconciled by the user.
_Avoid_: Confirmed failure, safe-to-retry timeout

**Automatic card use**: A separately authorized policy that redeems a reset card when a fresh quota observation meets the chosen window's trigger. Merely expanding the automatic-use controls is not that authorization.
_Avoid_: Automatic refresh, auto-visible controls

**Awaiting reset card**: A non-error automatic-use outcome when an authorized quota window has reached its trigger but no eligible reset card is available. No card is consumed; the authorization remains in place.
_Avoid_: Automatic redemption failure, completed redemption

**Automatic-use window state**: The current readiness or outcome of automatic card use for one quota window, independent of the other window and distinct from a historical event.
_Avoid_: One global last event as the state of both windows

**Automatic-use settings**: A disclosure of the independent per-window authorizations for automatic card use. Opening or closing it neither authorizes nor redeems a card.
_Avoid_: Master auto-use switch, auto-use enabled (when referring to the disclosure)

### UI surfaces

**Capsule**:
The persistent, draggable floating pill — the plugin's only guaranteed surface — that renders each provider's used percentage in one line and opens the panel. It is the plugin's primary entry point, distinct from the optional sidebar card.
_Avoid_: floating ball, ball, floating window, FAB, widget, mini mode, context menu

**Free-floating position memory**:
The capsule's position persistence behavior where user-placed coordinates {x, y} are remembered across sessions, with the element's measured geometry kept clamped inside viewport boundaries and safe-area margins.
_Avoid_: edge docking (retired), magnetic snap, peek, unconstrained coordinates

**Panel**:
The floating surface opened from the capsule or a card row; it presents the quota overview and per-provider details. It is distinct from the persistent capsule and the optional sidebar card.
_Avoid_: popup, pop (implementation class name only), modal, context menu

**Sidebar card (card)**:
The opportunistic entry rendered in the DSH web sidebar footer when that mount point exists; it is silently absent when the point does not (collapsed sidebar, desktop profile).
_Avoid_: rail trigger (retired), sidebar widget
