# DSH Quota Watch

This context names the provider-reported plan allowances monitored for a personal DSH setup, keeping those facts distinct from token usage observed in DSH sessions.

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
