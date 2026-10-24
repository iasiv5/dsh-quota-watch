import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createResetCards } from '../src/client/reset-cards.mjs'
import { COPY } from '../src/client.mjs'
import { CLIENT_ROUTES } from '../src/shared.mjs'

/**
 * Direct tests for the reset-cards internal seam (ADR 0007): the Manual
 * redemption flow module. DOM assertions are ported verbatim from the
 * integration tests in tests/client.test.mjs that drove the same surfaces
 * through mountQuotaCard; the harness here plays the host — it re-renders
 * renderSection into a container on onDirty and swaps the snapshot on
 * refresh, exactly like renderAll/poll do in the mounted app.
 */

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

const DEFAULT_RESET = { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } }

function flowHarness(options = {}) {
  const {
    locale = 'zh-CN',
    reset = DEFAULT_RESET,
    use,
    receipt = 'ok',
    acknowledge = 'ok',
    overviewExtra,
    outcomeNoticeMs = 5_000,
  } = options
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://dsh.example/',
    pretendToBeVisual: true,
  })
  if (locale) {
    Object.defineProperty(window.navigator, 'language', { value: locale, configurable: true })
  }
  const localeKey = locale ? (String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en') : 'zh'
  const state = { useCalls: 0, receiptCalls: [], ackCalls: [], refreshes: 0, spent: false, cleared: false, recovered: false }
  const requests = []
  const payloadFor = () => {
    const resetSlice = state.spent ? { status: 'ready', cards: { fiveHour: [], week: [] } } : reset
    const extra = typeof overviewExtra === 'function' ? overviewExtra(state) : (overviewExtra ?? {})
    return {
      updatedAt: Date.parse('2026-10-01T12:00:00.000Z'),
      providers: [],
      ...(resetSlice == null ? {} : { reset: resetSlice }),
      ...extra,
    }
  }
  const fetchImpl = async (path, init = {}) => {
    const target = String(path)
    requests.push({ path: target, method: init?.method ?? 'GET', body: init?.body })
    if (target.endsWith('/reset-cards/use')) {
      state.useCalls += 1
      if (use === 'transport-lost') throw new Error('connection lost')
      state.spent = true
      return response(use ?? { ok: true, attemptId: 'att-x' })
    }
    if (target.endsWith('/reset-cards/receipt')) {
      state.receiptCalls.push(String(init?.body ?? ''))
      return receipt === 'fail' ? response({ ok: false }, 503) : response({ ok: true })
    }
    if (target.endsWith('/reset-cards/acknowledge')) {
      state.ackCalls.push(String(init?.body ?? ''))
      return acknowledge === 'fail' ? response({ ok: false, error: 'verify-failed', message: '核实失败' }, 502) : response({ ok: true })
    }
    return response(payloadFor())
  }
  const sectionHost = window.document.createElement('div')
  const outcomeHost = window.document.createElement('div')
  window.document.body.append(sectionHost, outcomeHost)
  let current = payloadFor()
  const flow = createResetCards({
    doc: window.document,
    win: window,
    fetchImpl,
    copy: () => COPY[localeKey],
    routes: CLIENT_ROUTES,
    refresh: async () => { state.refreshes += 1; current = payloadFor(); render() },
    onDirty: () => { render() },
    outcomeNoticeMs,
  })
  const render = () => {
    sectionHost.replaceChildren(flow.renderSection(current))
    outcomeHost.replaceChildren()
    const block = flow.renderOutcomeBlock(current)
    if (block !== null) outcomeHost.append(block)
  }
  render()
  return {
    window, flow, state, requests, render,
    sectionHost, outcomeHost,
    text: () => sectionHost.textContent,
    outcomeBlock: () => outcomeHost.querySelector('[data-dsh-quota-watch-outcome]'),
    sync: () => { current = payloadFor(); render() },
  }
}

async function clickUse(h) {
  h.sectionHost.querySelector('.dqw-reset-use').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  await turn()
  return h.sectionHost.querySelector('.dqw-reset-confirm')
}

async function confirmSpend(h) {
  const box = await clickUse(h)
  box.querySelector('.dqw-reset-btn.is-primary').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  for (let hop = 0; hop < 5; hop += 1) await turn()
}

test('the card section renders four states purely from snapshot.reset', async () => {
  // No wallet snapshot yet → 查询中, no buttons. (null = the reset slice is
  // absent; undefined would fall back to the harness default.)
  {
    const h = flowHarness({ reset: null })
    assert.match(h.text(), /查询中/)
    assert.equal(h.sectionHost.querySelectorAll('.dqw-reset-use').length, 0)
    h.window.close()
  }
  // ready non-empty → only non-zero card types render.
  {
    const h = flowHarness({ reset: { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } } })
    const rows = [...h.sectionHost.querySelectorAll('.dqw-reset-row')]
    assert.equal(rows.length, 1, 'only the non-zero card type renders a row')
    assert.match(rows[0].textContent, /5 小时重置卡/)
    assert.equal(h.sectionHost.querySelectorAll('.dqw-reset-use').length, 1)
    // The spend control is a real, enabled <button> — focusable by construction.
    const button = h.sectionHost.querySelector('.dqw-reset-use')
    assert.equal(button.type, 'button')
    assert.equal(button.textContent, '重置')
    assert.equal(button.disabled, false)
    h.window.close()
  }
  // error → 查询失败 with the reason and no spend buttons.
  {
    const h = flowHarness({ reset: { status: 'error', error: 'HTTP 503' } })
    assert.match(h.text(), /查询失败/)
    assert.match(h.text(), /HTTP 503/)
    assert.equal(h.sectionHost.querySelector('.dqw-reset-row'), null)
    assert.equal(h.sectionHost.querySelectorAll('.dqw-reset-use').length, 0, 'an error state renders no spend buttons')
    h.window.close()
  }
  // Same in English.
  {
    const h = flowHarness({ locale: 'en-US', reset: { status: 'error', error: 'HTTP 503' } })
    assert.match(h.text(), /Query failed/)
    h.window.close()
  }
})

test('the earliest expiry label, its focusable detail and host picking share one time source', async () => {
  const h = flowHarness({
    reset: { status: 'ready', cards: { week: [
      { recordId: 2, expireTime: '2026-11-02 00:30:00' },
      { recordId: 1, expireTime: '2026-11-01 15:00:00Z' },
    ], fiveHour: [] } },
  })
  const expiry = h.sectionHost.querySelector('.dqw-reset-expiry')
  assert.equal(expiry.textContent, '11/01 前有效', 'the visible label shows the truly earlier (Z) card')
  assert.equal(expiry.getAttribute('tabindex'), '0', 'the full-value detail is keyboard reachable')
  const accessible = `${expiry.getAttribute('aria-label') ?? ''} ${expiry.title ?? ''}`
  assert.match(accessible, /2026-11-01 15:00:00Z/, 'the full original stamp is exposed')
  assert.match(accessible, /北京时间/, 'the Beijing reading is stated as an assumption')
  assert.doesNotMatch(accessible, /官方已/, 'it never claims official confirmation')
  h.window.close()
})

test('English empty reset section collapses to one row and keeps its separator', async () => {
  const h = flowHarness({ locale: 'en-US', reset: { status: 'ready', cards: { fiveHour: [], week: [] } } })
  assert.equal(h.sectionHost.querySelector('.dqw-reset-collapsed .dqw-reset-title').textContent, 'Quota reset cards · none')
  assert.equal(h.sectionHost.querySelector('.dqw-reset-reload'), null)
  assert.equal(h.sectionHost.querySelector('.dqw-reset-lines'), null)
  assert.ok(h.sectionHost.querySelector('.dqw-reset'), 'the same wrapper keeps the dashed divider')
  h.window.close()
})

test('clearPending clears exactly one uncommitted confirmation and reports whether it did', async () => {
  const h = flowHarness()
  const box = await clickUse(h)
  assert.ok(box, 'the inline confirm appears')
  assert.equal(h.flow.clearPending(), true, 'a pending confirmation is cleared and reported')
  h.render()
  assert.equal(h.sectionHost.querySelector('.dqw-reset-confirm'), null, 'nothing resurrects the old confirm')
  assert.equal(h.flow.clearPending(), false, 'nothing pending reports false without side effects')
  h.window.close()
})

test('the confirm box names the card type, both affected windows and irreversibility', async () => {
  {
    const h = flowHarness({ reset: { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } } })
    const box = await clickUse(h)
    assert.ok(box)
    assert.match(box.textContent, /5 小时/)
    assert.match(box.textContent, /无法撤销/)
    h.window.close()
  }
  {
    const h = flowHarness({ reset: { status: 'ready', cards: { fiveHour: [], week: [{ recordId: 8, expireTime: '2026-12-01 09:00:00' }] } } })
    const box = await clickUse(h)
    assert.ok(box)
    assert.match(box.textContent, /每周重置卡|每周额度/)
    assert.match(box.textContent, /5 小时额度/, 'a weekly card names the 5h window it also clears')
    assert.match(box.textContent, /无法撤销/)
    h.window.close()
  }
})

test('a known success answer shows the result and auto-confirms delivery once', async () => {
  const h = flowHarness({ use: { ok: true, message: '操作成功', attemptId: 'att-1' }, receipt: 'ok' })
  await confirmSpend(h)
  assert.match(h.text(), /已重置/)
  const receiptPosts = h.requests.filter((row) => row.path.endsWith('/reset-cards/receipt'))
  assert.equal(receiptPosts.length, 1, 'exactly one delivery confirmation')
  assert.match(receiptPosts[0].body ?? '', /att-1/, 'the receipt carries the same attemptId')
  assert.equal(h.state.useCalls, 1, "no retry behind the user's back")
})

test('a known refusal shows the upstream message and confirms delivery too', async () => {
  const h = flowHarness({ use: { ok: false, error: 'rejected', message: '指定的重置次数不可用', attemptId: 'att-2' }, receipt: 'ok' })
  await confirmSpend(h)
  assert.match(h.text(), /不可用/, 'the definite refusal is shown verbatim')
  const receiptPosts = h.requests.filter((row) => row.path.endsWith('/reset-cards/receipt'))
  assert.equal(receiptPosts.length, 1)
  assert.match(receiptPosts[0].body ?? '', /att-2/)
})

test('a lost use answer never claims failure; the snapshot receipt persists until acknowledged', async () => {
  const h = flowHarness({
    use: 'transport-lost',
    receipt: 'ok',
    overviewExtra: (state) => (state.useCalls > 0 && state.receiptCalls.length === 0
      ? { manualOutcome: { attemptId: 'att-3', resetType: 'WEEK', startedAt: 1, status: 'known-success' } }
      : {}),
  })
  await confirmSpend(h)
  assert.match(h.text(), /结果未确认/, 'an ambiguous transport loss is never a "failure"')
  assert.equal(h.state.useCalls, 1, 'no blind retry')

  const block = h.outcomeBlock()
  assert.ok(block, 'the persistent receipt block renders from the snapshot alone')
  assert.match(block.textContent, /已确认成功/)
  block.querySelector('button').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  for (let hop = 0; hop < 6; hop += 1) await turn()
  const receiptPosts = h.requests.filter((row) => row.path.endsWith('/reset-cards/receipt'))
  assert.equal(receiptPosts.length, 1)
  assert.match(receiptPosts[0].body ?? '', /att-3/)
  assert.equal(h.outcomeBlock(), null, 'the acknowledged receipt clears from the snapshot')
})

test('the unknown warning also reads in English', async () => {
  const h = flowHarness({
    locale: 'en-US',
    overviewExtra: { manualOutcome: { attemptId: 'att-en', resetType: 'WEEK', startedAt: 1, status: 'unknown' } },
  })
  const block = h.outcomeBlock()
  assert.ok(block)
  assert.match(block.textContent, /may have been spent/i)
  assert.match(block.textContent, /I verified it/)
})

test('an unreadable outcome journal shows manual use as unavailable and offers no button', async () => {
  const h = flowHarness({
    reset: { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } },
    overviewExtra: { manualOutcomeError: 'storage-unavailable' },
  })
  assert.match(h.text(), /手动用卡暂不可用/)
  assert.equal(h.outcomeBlock()?.querySelector('button') ?? null, null, 'a broken journal offers no acknowledge/verify action')
  assert.equal(h.requests.some((row) => row.path.endsWith('/reset-cards/use')), false)
})

test('a confirmed success notice clears after the configured delay; refusals persist', async () => {
  // The notice window is injected wide (150ms) on purpose: Windows timer
  // granularity (~15ms per setTimeout(0) turn) can alias away an entire
  // 30ms window between two poll samples — the same mechanism that makes
  // the integration twin flaky on this machine. Widening the window does
  // not weaken any assertion: shown → clears after the configured delay →
  // refusal persists are all still asserted verbatim.
  const h = flowHarness({ use: { ok: true, message: '操作成功', attemptId: 'att-5' }, receipt: 'ok', outcomeNoticeMs: 150 })
  await confirmSpend(h)
  let visible = false
  let deadline = Date.now() + 2_000
  while (!visible && Date.now() < deadline) {
    visible = /已重置/.test(h.text())
    if (!visible) await turn()
  }
  assert.ok(visible, 'the success notice is shown after the spend')
  let cleared = false
  deadline = Date.now() + 5_000
  while (!cleared && Date.now() < deadline) {
    await turn()
    cleared = !/已重置/.test(h.text())
  }
  assert.ok(cleared, 'the success notice returns to the latest inventory after the configured notice window')

  const refused = flowHarness({ use: { ok: false, error: 'rejected', message: '指定的重置次数不可用', attemptId: 'att-6' }, receipt: 'ok', outcomeNoticeMs: 150 })
  await confirmSpend(refused)
  deadline = Date.now() + 2_000
  while (Date.now() < deadline) await turn()
  assert.match(refused.text(), /不可用/, 'a refusal stays until the user acts')
  refused.window.close()
})

test('after a manual spend the wallet comes from the refresh snapshot, not a second list', async () => {
  const h = flowHarness({ use: { ok: true, message: '操作成功', attemptId: 'synthetic-attempt' } })
  assert.match(h.text(), /11\/01/)
  await confirmSpend(h)
  assert.match(h.text(), /已重置/)
  assert.equal(h.requests.some((row) => row.method === 'GET'), false,
    'the module never issues its own card-list or overview GET')
  assert.ok(h.state.refreshes >= 1, 'the authoritative overview is re-read after the spend')
  assert.doesNotMatch(h.text(), /11\/01/, 'the spent card disappears via the refreshed snapshot')
})

test('double-confirming fires exactly one spend POST and the result still lands', async () => {
  const h = flowHarness({ use: { ok: true, message: '操作成功', attemptId: 'att-dc' }, receipt: 'ok' })
  const box = await clickUse(h)
  const confirmBtn = box.querySelector('.dqw-reset-btn.is-primary')
  confirmBtn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  confirmBtn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  for (let hop = 0; hop < 8; hop += 1) await turn()
  assert.equal(h.state.useCalls, 1, 'exactly one irreversible POST')
  assert.match(h.text(), /已重置/, 'the result still lands')
  assert.equal(h.state.receiptCalls.length, 1, 'the delivery confirmation fires once')
})

test('an unresolved outcome or unreadable journal locks the spend controls inside the module', async () => {
  for (const extra of [
    { manualOutcomeError: 'storage-unavailable' },
    { manualOutcome: { attemptId: 'att-lock', resetType: 'WEEK', startedAt: 1, status: 'unknown' } },
  ]) {
    const h = flowHarness({
      reset: { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } },
      overviewExtra: extra,
    })
    const use = h.sectionHost.querySelector('.dqw-reset-use')
    assert.ok(use, String(JSON.stringify(extra)))
    assert.equal(use.disabled, true, `the spend button is locked: ${JSON.stringify(extra)}`)
    use.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    await turn()
    // NB: an unknown outcome block itself renders with the .dqw-reset-confirm
    // class, so the absence of that selector is NOT a lock signal here.
    assert.equal(h.requests.some((row) => row.path.endsWith('/reset-cards/use')), false, 'a locked flow never sends a POST')
    h.window.close()
  }
})
