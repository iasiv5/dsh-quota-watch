/**
 * The Manual redemption flow (GLOSSARY.md): the client-side cluster that
 * renders the domestic reset-card section and carries one card redemption
 * from the explicit confirmation on a reset-card row, through the single
 * irreversible spend request, to outcome presentation and delivery
 * confirmation (receipt or acknowledge).
 *
 * Internal seam of mountQuotaCard (ADR 0007): the external mountQuotaCard
 * interface is frozen; this module is wired only by src/client.mjs and is
 * tested directly by tests/client-reset-cards.test.mjs. The pure helpers
 * below (localeFor, formatNumber, text, earliestExpiry*) are private copies
 * of the ones in src/client.mjs — importing them back would create a cycle,
 * and the frozen createResetCards signature has no room for extra accessor
 * parameters. Behaviour must stay byte-identical to the originals.
 */
import { parseResetExpiryTime } from '../core/reset.mjs'

function localeFor(win) {
  const host = String(win?.document?.documentElement?.lang ?? '').trim()
  if (host !== '') return host.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return String(win?.navigator?.language ?? 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function formatNumber(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(value)
}

function text(doc, tag, className, value) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  node.textContent = String(value ?? '')
  return node
}

/** The earliest-expiring card by the SHARED parser (host picking uses the same
 * one, so display and selection can never disagree). */
function earliestExpiryCard(cards) {
  let best
  for (const card of Array.isArray(cards) ? cards : []) {
    const parsed = parseResetExpiryTime(card?.expireTime)
    if (parsed === undefined) continue
    if (best === undefined || parsed < best.parsed) best = { card, parsed }
  }
  return best
}

/** The earliest expiry among available cards as MM/DD — the card a default spend picks. */
function earliestExpiryLabel(cards) {
  const best = earliestExpiryCard(cards)
  if (best === undefined) return undefined
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
  }).formatToParts(new Date(best.parsed))
  const part = (type) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('month')}/${part('day')}`
}

/**
 * Client timeout for the reset flow. It is far longer than a poll: the host chains
 * list → use → list → quota probe, and a slow upstream leg must not make the browser
 * abandon a request whose card may already have been consumed.
 */
const RESET_FETCH_TIMEOUT_MS = 60_000

/**
 * The reset endpoints always answer with a JSON envelope — including business
 * refusals, which arrive non-2xx. So the parsed payload wins over the status code;
 * only a non-JSON response becomes a transport error.
 */
async function fetchResetEnvelope(fetchImpl, path, body) {
  const response = await fetchImpl(path, {
    ...(body !== undefined
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(RESET_FETCH_TIMEOUT_MS),
  })
  const payload = await response.json().catch(() => undefined)
  if (payload === undefined || typeof payload !== 'object' || payload === null) {
    throw new Error(`HTTP ${response.status}`)
  }
  return payload
}

export function createResetCards({
  doc,
  win,
  fetchImpl,
  copy: copyAccessor,
  routes,
  refresh,
  onDirty,
  outcomeNoticeMs = 5_000,
} = {}) {
  let resetPending        // reset type awaiting confirmation, or undefined
  let resetBusy           // reset type currently being spent, or undefined
  let resetNotice         // { kind: 'ok' | 'error' | 'unknown', message, attemptId?, known? }
  let outcomeBusy = false // an acknowledge/receipt request is in flight
  let outcomeNoticeTimer  // the ~5s success-notice timer (Q16)
  let lastSnapshot        // the newest snapshot handed to a render call
  let disposed = false

  /** True while the host journal is unreadable or any outcome record is
   * unresolved: manual spending is locked at the UI, in the click handlers and
   * in the send path itself (the host refuses regardless — defense in depth). */
  function manualLocked() {
    return lastSnapshot?.manualOutcome !== undefined || lastSnapshot?.manualOutcomeError !== undefined
  }

  /**
   * Spend one card.
   * The confirmation is cleared first so a double click cannot fire twice, and the
   * button stays disabled for the whole round trip — the host may already have spent
   * the card even if this request later fails. A KNOWN answer is shown and then
   * auto-confirmed via the receipt route; an ambiguous one is NEVER presented as a
   * failure — the persistent snapshot warning takes over instead.
   */
  async function spendResetCard(resetType) {
    if (resetBusy !== undefined || disposed || manualLocked()) return
    resetBusy = resetType
    resetPending = undefined
    resetNotice = undefined
    onDirty()
    let outcome
    try {
      outcome = await fetchResetEnvelope(fetchImpl, routes.resetUse, { resetType })
    } catch {
      // Transport-level loss: the POST may or may not have consumed a card.
      outcome = { ok: false, error: 'request-unknown' }
    } finally {
      resetBusy = undefined
    }
    const copy = copyAccessor()
    if (outcome.ok === true) {
      resetNotice = { kind: 'ok', message: copy.resetCards.succeeded, attemptId: outcome.attemptId, known: true }
    } else if (outcome.error === 'rejected') {
      resetNotice = { kind: 'error', message: outcome.message ?? copy.resetCards.failed, attemptId: outcome.attemptId, known: true }
    } else if (outcome.error === 'request-unknown') {
      resetNotice = { kind: 'unknown', message: copy.resetCards.unconfirmed }
    } else if (outcome.error === 'storage-unavailable') {
      resetNotice = { kind: 'error', message: copy.resetCards.storageUnavailable }
    } else {
      resetNotice = { kind: 'error', message: outcome.message ?? copy.resetCards.failed }
    }
    // The authoritative wallet + outcome record arrive via the overview snapshot.
    if (!disposed) await refresh()
    if (!disposed) onDirty()
    // A known outcome was displayed: confirm delivery so the host receipt can
    // clear. A failed confirmation keeps the persistent receipt and the lock.
    if (!disposed && resetNotice?.known === true && typeof resetNotice.attemptId === 'string') {
      await acknowledgeOutcome(routes.resetReceipt, resetNotice.attemptId)
    }
    // Q16: a confirmed SUCCESS lingers only about five seconds — the wallet
    // already returned to the latest inventory, and the notice follows.
    // Refusals and the persistent outcome warning stay until the user acts.
    if (!disposed && resetNotice?.kind === 'ok') {
      const notice = resetNotice
      // Clear any previous handle first and let the callback retire only its
      // own id, so overlapping spends never leak a live timer past dispose.
      if (outcomeNoticeTimer !== undefined) win.clearTimeout(outcomeNoticeTimer)
      const timerId = win.setTimeout(() => {
        if (outcomeNoticeTimer === timerId) outcomeNoticeTimer = undefined
        if (!disposed && resetNotice === notice) {
          resetNotice = undefined
          onDirty()
        }
      }, Math.max(0, outcomeNoticeMs))
      outcomeNoticeTimer = timerId
    }
  }

  /**
   * Confirm delivery of a known receipt, or submit a user-verified unknown.
   * A failure keeps the host record and the spend lock; the snapshot stays the
   * single authority for what the user still has to acknowledge.
   */
  async function acknowledgeOutcome(route, attemptId) {
    if (outcomeBusy || disposed || typeof attemptId !== 'string' || attemptId === '') return
    outcomeBusy = true
    onDirty()
    try {
      await fetchResetEnvelope(fetchImpl, route, { attemptId })
    } catch { /* kept locked; the snapshot still carries the outcome */ }
    outcomeBusy = false
    if (!disposed) await refresh()
    if (!disposed) onDirty()
  }

  /**
   * The persistent manual-outcome block: unknown → bilingual warning + verify
   * button; known → the real outcome + acknowledge button; unreadable storage
   * → manual use unavailable with no action. Rendered in the card section AND
   * the overview, and it keeps the capsule alive even with zero providers.
   */
  function renderManualOutcomeBlock() {
    const copy = copyAccessor()
    const block = doc.createElement('div')
    block.dataset.dshQuotaWatchOutcome = ''
    if (lastSnapshot?.manualOutcomeError === 'storage-unavailable') {
      block.className = 'dqw-reset-notice is-error'
      block.textContent = copy.resetCards.storageUnavailable
      return block
    }
    const outcome = lastSnapshot?.manualOutcome
    if (outcome === undefined) return null
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'dqw-reset-btn'
    button.disabled = outcomeBusy
    if (outcome.status === 'unknown') {
      block.className = 'dqw-reset-confirm'
      block.append(
        text(doc, 'div', 'dqw-reset-confirm-title', copy.resetCards.outcomeUnknownTitle),
        text(doc, 'div', 'dqw-reset-confirm-body', copy.resetCards.outcomeUnknownBody),
      )
      button.textContent = copy.resetCards.verifyButton
      button.addEventListener('click', () => { void acknowledgeOutcome(routes.resetAcknowledge, outcome.attemptId) })
    } else {
      const knownSuccess = outcome.status === 'known-success'
      block.className = knownSuccess ? 'dqw-reset-notice is-ok' : 'dqw-reset-notice is-error'
      block.append(text(doc, 'div', '', knownSuccess ? copy.resetCards.knownSuccessTitle : copy.resetCards.knownRefusedTitle))
      button.textContent = copy.resetCards.acknowledgeButton
      button.addEventListener('click', () => { void acknowledgeOutcome(routes.resetReceipt, outcome.attemptId) })
    }
    block.append(button)
    return block
  }

  /** Render aligned columns: card name · earliest expiry | count | action. */
  function renderResetRow(type, model) {
    const copy = copyAccessor()
    const locale = localeFor(win)
    const row = doc.createElement('div')
    row.className = 'dqw-reset-row'
    const expiry = earliestExpiryLabel(model)
    const expiryLabel = expiry !== undefined ? copy.resetCards.expiry.replace('{date}', expiry) : '—'
    row.append(text(doc, 'span', 'dqw-reset-kind', type === 'WEEK' ? copy.resetCards.week : copy.resetCards.fiveHour))
    row.append(text(doc, 'span', 'dqw-reset-mid', '·'))
    const expiryNode = text(doc, 'span', 'dqw-reset-expiry', expiryLabel)
    // Keyboard-reachable detail: the full original stamp of the earliest card
    // plus the Beijing-reading assumption — stated as an assumption, never as
    // an officially confirmed upstream contract.
    const earliest = earliestExpiryCard(model)
    if (earliest !== undefined) {
      const detail = `${expiryLabel} · ${earliest.card.expireTime} · ${copy.resetCards.expiryAssumed}`
      expiryNode.tabIndex = 0
      expiryNode.setAttribute('aria-label', detail)
      expiryNode.title = detail
    }
    row.append(expiryNode)
    const count = model.length
    row.append(text(doc, 'span', `dqw-reset-count${count === 0 ? ' is-empty' : ''}`, count === 0
      ? copy.resetCards.none
      : copy.resetCards.count.replace('{count}', formatNumber(count, locale))))
    // Nothing to spend and nothing in flight: no button at all — a disabled
    // 「重置」 on a zero row is noise when the count already says 无可用.
    if (count === 0 && resetBusy !== type) {
      row.append(text(doc, 'span', 'dqw-reset-placeholder', ''))
      return row
    }
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'dqw-reset-use'
    button.textContent = resetPending === type ? copy.resetCards.cancel : copy.resetCards.use
    // While this window's request is in flight the card may already be spent, so the
    // button is fully disabled (not just click-guarded) for the whole round trip.
    // An unreadable journal or any unresolved outcome record locks it just as hard.
    if (resetBusy === type) {
      button.textContent = copy.resetCards.working
      button.disabled = true
    } else {
      button.disabled = resetBusy !== undefined || manualLocked()
    }
    button.addEventListener('click', () => {
      if (resetBusy !== undefined || manualLocked()) return
      resetPending = resetPending === type ? undefined : type
      resetNotice = undefined
      onDirty()
    })
    row.append(button)
    return row
  }

  /**
   * The domestic reset section: a fixed dashed divider + title driving four
   * states purely from the latest host snapshot — no wallet snapshot yet
   * (查询中), ready-empty (无可用), error (查询失败, no buttons) and
   * ready-available (non-zero types only). There is no second data source.
   */
  function renderResetSection() {
    const copy = copyAccessor()
    const section = doc.createElement('div')
    section.className = 'dqw-reset'
    const reset = lastSnapshot?.reset
    if (reset === undefined || reset.status === 'loading') {
      const head = doc.createElement('div')
      head.className = 'dqw-reset-head'
      head.append(text(doc, 'span', 'dqw-reset-title', copy.resetCards.section))
      section.append(head, text(doc, 'p', 'dqw-muted', copy.resetCards.querying))
      appendOutcomeBlock(section)
      return section
    }
    if (reset.status === 'error') {
      const head = doc.createElement('div')
      head.className = 'dqw-reset-head'
      head.append(text(doc, 'span', 'dqw-reset-title', copy.resetCards.section))
      const reason = reset.error ? `: ${reset.error}` : ''
      section.append(head, text(doc, 'p', 'dqw-muted', `${copy.failed}${reason}`))
      appendOutcomeBlock(section)
      return section
    }
    const cards = reset.cards
    const week = Array.isArray(cards?.week) ? cards.week : []
    const fiveHour = Array.isArray(cards?.fiveHour) ? cards.fiveHour : []
    if (week.length === 0 && fiveHour.length === 0 && resetPending === undefined
      && resetBusy === undefined && resetNotice === undefined) {
      const row = doc.createElement('div')
      row.className = 'dqw-reset-collapsed'
      row.append(text(doc, 'span', 'dqw-reset-title', `${copy.resetCards.section} · ${copy.resetCards.none}`))
      section.append(row)
      appendOutcomeBlock(section)
      return section
    }
    const head = doc.createElement('div')
    head.className = 'dqw-reset-head'
    head.append(text(doc, 'span', 'dqw-reset-title', copy.resetCards.section))
    section.append(head)

    const rows = doc.createElement('div')
    rows.className = 'dqw-reset-lines'
    // Only non-zero card types render a row: a zero row would read as an
    // actionable "0 left" line where the collapsed state already said 无可用.
    if (fiveHour.length > 0) rows.append(renderResetRow('FIVE_HOUR', fiveHour))
    if (week.length > 0) rows.append(renderResetRow('WEEK', week))
    if (rows.childElementCount > 0) section.append(rows)

    if (resetPending !== undefined) {
      const box = doc.createElement('div')
      box.className = 'dqw-reset-confirm'
      box.append(text(doc, 'div', 'dqw-reset-confirm-title', copy.resetCards.confirmTitle))
      box.append(text(doc, 'div', 'dqw-reset-confirm-body', resetPending === 'WEEK'
        ? copy.resetCards.confirmWeek
        : copy.resetCards.confirmFiveHour))
      box.append(text(doc, 'div', 'dqw-reset-confirm-warn', copy.resetCards.confirmIrreversible))
      const actions = doc.createElement('div')
      actions.className = 'dqw-reset-confirm-actions'
      const cancel = doc.createElement('button')
      cancel.type = 'button'
      cancel.className = 'dqw-reset-btn'
      cancel.textContent = copy.resetCards.cancel
      cancel.addEventListener('click', () => { resetPending = undefined; onDirty() })
      const confirm = doc.createElement('button')
      confirm.type = 'button'
      confirm.className = 'dqw-reset-btn is-primary'
      confirm.textContent = copy.resetCards.ok
      // Disabled while a spend is in flight or the manual flow is locked by an
      // unresolved outcome / unreadable journal: double clicks cannot queue a
      // second irreversible POST.
      confirm.disabled = resetBusy !== undefined || manualLocked()
      confirm.addEventListener('click', () => { spendResetCard(resetPending) })
      actions.append(cancel, confirm)
      box.append(actions)
      section.append(box)
    }

    if (resetNotice !== undefined) {
      section.append(text(doc, 'div', `dqw-reset-notice is-${resetNotice.kind}`, resetNotice.message))
    }
    appendOutcomeBlock(section)
    return section
  }

  const appendOutcomeBlock = (container) => {
    const block = renderManualOutcomeBlock()
    if (block !== null) container.append(block)
  }

  return {
    /** Render the domestic reset-card section for the GLM detail view. */
    renderSection(snapshot) {
      lastSnapshot = snapshot
      return renderResetSection()
    },
    /** Render the persistent outcome block for the overview panel (null when absent). */
    renderOutcomeBlock(snapshot) {
      lastSnapshot = snapshot
      return renderManualOutcomeBlock()
    },
    /** Clear an uncommitted confirmation; true iff one was actually cleared. */
    clearPending() {
      if (resetPending === undefined) return false
      resetPending = undefined
      return true
    },
    /** Stop the flow: retire the notice timer and freeze every in-flight guard. */
    dispose() {
      disposed = true
      if (outcomeNoticeTimer !== undefined) win.clearTimeout(outcomeNoticeTimer)
      outcomeNoticeTimer = undefined
    },
  }
}
