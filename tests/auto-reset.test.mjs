/**
 * Service-level regression tests.
 *
 * These exist because a config-key mismatch in the auto-reset path threw inside a
 * poll-timer callback and took the whole DSH host process down. Unit tests on the
 * pure helpers could not catch it — the defect lived in the wiring — so this file
 * builds a real service with a stubbed transport and drives it.
 *
 * A stub for `@deepseek-ai/dsh-credentials` lives in node_modules so `src/host.mjs`
 * is importable without a DSH installation.
 *   node --test test/service.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAutoResetSettings, writeAutoResetSettings, resolveAutoResetSettingsPath } from '../src/host.mjs'
import { createIsolatedQuotaService } from './support/isolated-service.mjs'
import { normalizeAutoResetConfig, autoResetConfigFor, AUTO_RESET_DEFAULT_THRESHOLD } from '../src/core/reset.mjs'

const WEEK_AT_95 = {
  success: true,
  data: {
    level: 'pro',
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, currentValue: 10, usage: 100, percentage: 10 },
      { type: 'CREDIT_LIMIT', unit: 6, currentValue: 95, usage: 100, percentage: 95 },
    ],
  },
}
const WEEK_AT_10 = {
  success: true,
  data: {
    level: 'pro',
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, currentValue: 10, usage: 100, percentage: 10 },
      { type: 'CREDIT_LIMIT', unit: 6, currentValue: 10, usage: 100, percentage: 10 },
    ],
  },
}
const USAGE = { success: true, data: { totalUsage: { totalTokensUsage: 10, totalModelCallCount: 2 } } }
const LIST = {
  success: true,
  data: {
    weekResets: [{ recordId: 9001, grantType: 'DIRECT', expireTime: '2026-12-01 00:00:00', available: true }],
    fiveHourResets: [{ recordId: 8001, grantType: 'DIRECT', expireTime: '2026-12-01 00:00:00', available: true }],
  },
}
const USE_OK = { code: 200, success: true, msg: '操作成功' }

/** A transport stub that records every request and answers by URL. */
function stubFetch(options = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, method: init?.method ?? 'GET', body: init?.body })
    const pick = (value) => ({ ok: true, status: 200, json: async () => value })
    if (target.includes('/api/monitor/usage/quota/limit')) return pick(options.plan ?? WEEK_AT_95)
    if (target.includes('/api/monitor/usage/model-usage')) return pick(USAGE)
    if (target.includes('/customer-package-reset/use')) return pick(USE_OK)
    if (target.includes('/customer-package-reset/list')) return pick(options.cards ?? LIST)
    return { ok: false, status: 404, json: async () => ({}) }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

function stubCtx(logs = []) {
  return {
    logger: { info: (line) => logs.push(line), warn: (line) => logs.push(line) },
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'zai-coding-cn': { apiKeyEnv: 'ZAI_API_KEY' } } } }],
    },
    credentials: {
      resolve: async () => ({ value: 'sk-test' }),
      readRecord: async () => undefined,
    },
    webServer: { register: () => () => {} },
  }
}

test('overview exposes auto-reset state for BOTH windows without throwing', () => {
  // Directly covers the crash: reading the view resolved config by the plan-window
  // key ('5h'), which does not exist in the config namespace ('fiveHour').
  const service = createIsolatedQuotaService(stubCtx(), {
    fetchImpl: stubFetch(),
    legacyAutoSettingsPath: tempSettingsPath().path,
    autoReset: { fiveHour: { enabled: true, threshold: 70 }, week: { enabled: false, threshold: 90 } },
  })
  const view = service.overview()
  assert.equal(view.autoReset.fiveHour.enabled, true)
  assert.equal(view.autoReset.fiveHour.threshold, 70)
  assert.equal(view.autoReset.fiveHour.armed, true)
  assert.equal(view.autoReset.week.enabled, false)
  assert.equal(view.autoReset.week.threshold, 90)
  service.stop()
})

test('a full poll round with auto-reset enabled never rejects', async () => {
  const logs = []
  const service = createIsolatedQuotaService(stubCtx(logs), {
    fetchImpl: stubFetch(),
    legacyAutoSettingsPath: tempSettingsPath().path,
    autoReset: { fiveHour: { enabled: true }, week: { enabled: true } },
  })
  // The crash surfaced here: refresh() awaits maybeAutoReset() on the poll timer,
  // so a throw becomes an unhandled rejection that kills the host.
  await service.refresh()
  const view = service.overview()
  assert.equal(view.providers.find((p) => p.key === 'glm').status, 'ready')
  service.stop()
})

test('an enabled window over its threshold spends exactly one card and disarms', async () => {
  const logs = []
  const fetchImpl = stubFetch()
  const service = createIsolatedQuotaService(stubCtx(logs), {
    fetchImpl,
    legacyAutoSettingsPath: tempSettingsPath().path,
    autoReset: { fiveHour: { enabled: false }, week: { enabled: true, threshold: 90 } },
  })
  await service.refresh()

  const useCalls = fetchImpl.calls.filter((c) => c.url.includes('/customer-package-reset/use'))
  assert.equal(useCalls.length, 1, 'exactly one card is spent per episode')
  const body = JSON.parse(useCalls[0].body)
  assert.equal(body.resetType, 'WEEK')
  assert.equal(body.recordId, 9001)
  assert.match(body.requestId, /^[0-9a-f-]{36}$/)

  const view = service.overview()
  assert.equal(view.autoReset.week.armed, false, 'disarmed after spending')
  assert.equal(view.autoReset.lastEvent.kind, 'auto')
  assert.equal(view.autoReset.lastEvent.window, 'week')
  assert.ok(logs.some((line) => line.includes('auto-reset spent')), 'the spend is logged')
  service.stop()
})

test('a second poll in the same episode does NOT spend again', async () => {
  const fetchImpl = stubFetch()
  const service = createIsolatedQuotaService(stubCtx(), {
    fetchImpl,
    legacyAutoSettingsPath: tempSettingsPath().path,
    autoReset: { fiveHour: { enabled: false }, week: { enabled: true, threshold: 90 } },
  })
  await service.refresh()
  await service.refresh()
  await service.refresh()
  const useCalls = fetchImpl.calls.filter((c) => c.url.includes('/customer-package-reset/use'))
  assert.equal(useCalls.length, 1, 'usage stayed over the threshold, so it must stay disarmed')
  service.stop()
})

test('a later episode re-arms once usage falls back below the threshold', async () => {
  const calls = []
  let plan = WEEK_AT_95
  // A controllable clock: the failed-attempt backoff is 10 minutes, so the second
  // episode has to be a later instant or the guard correctly refuses to spend.
  let clock = 1_000_000
  const fetchImpl = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, method: init?.method ?? 'GET', body: init?.body })
    const pick = (value) => ({ ok: true, status: 200, json: async () => value })
    if (target.includes('/api/monitor/usage/quota/limit')) return pick(plan)
    if (target.includes('/api/monitor/usage/model-usage')) return pick(USAGE)
    if (target.includes('/customer-package-reset/use')) return pick(USE_OK)
    if (target.includes('/customer-package-reset/list')) return pick(LIST)
    return { ok: false, status: 404, json: async () => ({}) }
  }

  const service = createIsolatedQuotaService(stubCtx(), {
    fetchImpl,
    now: () => clock,
    legacyAutoSettingsPath: tempSettingsPath().path,
    autoReset: { fiveHour: { enabled: false }, week: { enabled: true, threshold: 90 } },
  })
  await service.refresh()
  assert.equal(service.overview().autoReset.week.armed, false, 'spent once, then disarmed')

  plan = WEEK_AT_10 // the reset landed: usage is low again
  await service.refresh()
  assert.equal(service.overview().autoReset.week.armed, true, 'below-threshold re-arms')

  plan = WEEK_AT_95 // a new episode, well past the backoff window
  clock += 60 * 60_000
  await service.refresh()
  const useCalls = calls.filter((c) => c.url.includes('/customer-package-reset/use'))
  assert.equal(useCalls.length, 2, 'the new episode spends again')
  service.stop()
})

test('a failed spend is recorded and backed off, never thrown', async () => {
  const fetchImpl = async (url, init) => {
    const target = String(url)
    if (target.includes('/api/monitor/usage/quota/limit')) return { ok: true, status: 200, json: async () => WEEK_AT_95 }
    if (target.includes('/api/monitor/usage/model-usage')) return { ok: true, status: 200, json: async () => USAGE }
    if (target.includes('/customer-package-reset/use')) {
      return { ok: true, status: 200, json: async () => ({ code: 500, success: false, msg: '指定的重置次数不可用' }) }
    }
    if (target.includes('/customer-package-reset/list')) return { ok: true, status: 200, json: async () => LIST }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  fetchImpl.calls = []
  const service = createIsolatedQuotaService(stubCtx(), {
    fetchImpl,
    legacyAutoSettingsPath: tempSettingsPath().path,
    autoReset: { fiveHour: { enabled: false }, week: { enabled: true, threshold: 90 } },
  })
  await service.refresh()
  await service.refresh()
  const view = service.overview()
  assert.equal(view.autoReset.lastEvent.kind, 'auto-failed')
  assert.match(view.autoReset.lastEvent.message, /不可用/)
  service.stop()
})

test('auto-reset disabled by default lists cards but never spends them', async () => {
  const fetchImpl = stubFetch()
  const service = createIsolatedQuotaService(stubCtx(), { fetchImpl, legacyAutoSettingsPath: tempSettingsPath().path })
  await service.refresh()
  const resetCalls = fetchImpl.calls.filter((c) => c.url.includes('customer-package-reset'))
  assert.deepEqual(resetCalls.map((call) => call.url.includes('/list') ? 'list' : 'use'), ['list'],
    'wallet visibility needs a read on the first poll, but default-off forbids any write')
  assert.equal(service.overview().autoReset.week.enabled, false)
  service.stop()
})

test('wallet probe rides the host poll on a ten-minute gate; force bypasses and failures back off', async () => {
  let clock = 1_000_000
  let failList = false
  const healthy = stubFetch({ plan: WEEK_AT_10 })
  const fetchImpl = (url, init) => {
    if (failList && String(url).includes('/customer-package-reset/list')) {
      return Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
    }
    return healthy(url, init)
  }
  const service = createIsolatedQuotaService(stubCtx(), {
    fetchImpl, now: () => clock, legacyAutoSettingsPath: tempSettingsPath().path,
  })
  const listCount = () => healthy.calls.filter((call) => call.url.includes('/customer-package-reset/list')).length
  try {
    await service.refresh()
    assert.equal(listCount(), 1, 'first poll learns the wallet even with auto-spend disabled')
    assert.equal(service.overview().reset.status, 'ready')
    assert.equal(service.overview().reset.cards.week.length, 1)
    clock += 9 * 60_000
    await service.refresh()
    assert.equal(listCount(), 1, 'the 60-second quota poll does not imply a card-list request')
    await service.refresh(true)
    assert.equal(listCount(), 2, '立即刷新 bypasses the wallet gate')
    clock += 9 * 60_000
    await service.refresh()
    assert.equal(listCount(), 2, 'the forced check resets the ten-minute clock')
    clock += 60_000
    failList = true
    await service.refresh()
    assert.equal(service.overview().reset.status, 'error', 'wallet failure stays separate from ready GLM quota')
    assert.equal(service.overview().providers.find((provider) => provider.key === 'glm').status, 'ready')
    clock += 60_000
    await service.refresh()
    assert.equal(listCount(), 2, 'failed listing still starts a quiet period')
    failList = false
    clock += 9 * 60_000
    await service.refresh()
    assert.equal(listCount(), 3, 'the wallet recovers at the next due round')
  } finally { service.stop() }
})

test('autoResetConfigFor maps window keys and degrades to disabled', () => {
  const config = normalizeAutoResetConfig({ fiveHour: { enabled: true, threshold: 60 } })
  assert.equal(autoResetConfigFor(config, '5h').threshold, 60)
  assert.equal(autoResetConfigFor(config, '5h').enabled, true)
  // The exact mistake that crashed the host: an unknown key must not be undefined.
  const fallback = autoResetConfigFor(config, 'month')
  assert.equal(fallback.enabled, false)
  assert.equal(fallback.threshold, AUTO_RESET_DEFAULT_THRESHOLD)
  assert.equal(autoResetConfigFor(undefined, '5h').enabled, false)
})

// --- panel switches ---------------------------------------------------------

function tempSettingsPath() {
  const dir = mkdtempSync(join(tmpdir(), 'glm-quota-reset-'))
  return { dir, path: join(dir, 'settings.json') }
}

test('a fresh install reports the profile config as the switch source', () => {
  const { dir, path } = tempSettingsPath()
  try {
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl: stubFetch(),
      legacyAutoSettingsPath: path,
      autoReset: { week: { enabled: true, threshold: 80 } },
    })
    const view = service.overview().autoReset
    assert.equal(view.source, 'config', 'nothing saved yet, so the profile value is in force')
    assert.equal(view.week.enabled, true)
    assert.equal(view.week.threshold, 80)
    assert.equal(view.fiveHour.enabled, false)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('updateAutoResetConfig persists, and a new service reads the saved switches back', () => {
  const { dir, path } = tempSettingsPath()
  try {
    const first = createIsolatedQuotaService(stubCtx(), { fetchImpl: stubFetch(), legacyAutoSettingsPath: path })
    const result = first.updateAutoResetConfig({
      fiveHour: { enabled: false, threshold: 90 },
      week: { enabled: true, threshold: 92 },
    })
    assert.equal(result.ok, true)
    assert.equal(result.autoReset.source, 'saved')
    assert.equal(result.autoReset.week.enabled, true)
    first.stop()

    // The file is the durable control surface: a restart must come back armed.
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.autoReset.week.enabled, true)
    assert.equal(onDisk.autoReset.week.threshold, 92)
    assert.deepEqual(readdirSync(dir), ['settings.json'], 'atomic replacement leaves no temp file')

    const second = createIsolatedQuotaService(stubCtx(), { fetchImpl: stubFetch(), legacyAutoSettingsPath: path })
    const view = second.overview().autoReset
    assert.equal(view.source, 'saved')
    assert.equal(view.week.enabled, true)
    assert.equal(view.week.threshold, 92)
    assert.equal(view.fiveHour.enabled, false)
    second.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('saved settings override profile config; corrupt settings fail closed instead of reviving profile auto-use', () => {
  const { dir, path } = tempSettingsPath()
  try {
    writeAutoResetSettings(path, { fiveHour: { enabled: true, threshold: 55 }, week: { enabled: false, threshold: 90 } })
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl: stubFetch(),
      legacyAutoSettingsPath: path,
      autoReset: { fiveHour: { enabled: false, threshold: 90 } },
    })
    assert.equal(service.overview().autoReset.fiveHour.enabled, true, 'saved wins over the profile config')
    assert.equal(service.overview().autoReset.fiveHour.threshold, 55)
    service.stop()

    // A truncated/corrupt file must never restore an enabled profile default.
    writeFileSync(path, '{ this is not json', 'utf8')
    assert.equal(readAutoResetSettings(path).week.enabled, false)
    const recovered = createIsolatedQuotaService(stubCtx(), {
      fetchImpl: stubFetch(),
      legacyAutoSettingsPath: path,
      autoReset: { week: { enabled: true, threshold: 90 } },
    })
    assert.equal(recovered.overview().autoReset.week.enabled, false)
    recovered.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('enabling a window re-arms it and clears its backoff', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    let clock = 1_000_000
    const fetchImpl = stubFetch()
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl,
      now: () => clock,
      legacyAutoSettingsPath: path,
      autoReset: { fiveHour: { enabled: false }, week: { enabled: true, threshold: 90 } },
    })
    // Spend once so the window is disarmed and inside its backoff.
    await service.refresh()
    assert.equal(service.overview().autoReset.week.armed, false)
    assert.ok(service.overview().autoReset.week.lastAttemptAt !== undefined)

    // Off then immediately on: the guards must reset, or the switch would look
    // enabled while doing nothing until the next threshold crossing.
    service.updateAutoResetConfig({ fiveHour: { enabled: false }, week: { enabled: false } })
    service.updateAutoResetConfig({ fiveHour: { enabled: false }, week: { enabled: true } })
    const view = service.overview().autoReset
    assert.equal(view.week.armed, true)
    assert.equal(view.week.lastAttemptAt, undefined)
    clock += 1
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a write failure is reported instead of silently pretending success', () => {
  const { dir, path } = tempSettingsPath()
  try {
    // A directory where the file should be makes the write fail deterministically.
    mkdirSync(path, { recursive: true })
    const service = createIsolatedQuotaService(stubCtx(), { fetchImpl: stubFetch(), legacyAutoSettingsPath: path })
    const result = service.updateAutoResetConfig({ fiveHour: { enabled: true }, week: { enabled: false } })
    assert.equal(result.ok, true, 'the switch still applies to this process')
    assert.equal(result.autoReset.fiveHour.enabled, true)
    assert.equal(typeof result.autoReset.persistError, 'string', 'but the failure is surfaced')
    assert.equal(service.overview().autoReset.persistError !== undefined, true)
    assert.deepEqual(readdirSync(dir), ['settings.json'], 'failed rename cleans the temp file')
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('international GLM hides domestic entitlement and rejects direct reset calls', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    const ctx = stubCtx()
    ctx.settings.describe = () => [{ ns: 'llm-pi-ai', value: { providers: { zai: { apiKeyEnv: 'ZAI_API_KEY' } } } }]
    const fetchImpl = stubFetch()
    const service = createIsolatedQuotaService(ctx, { fetchImpl, legacyAutoSettingsPath: path })
    await service.refresh()
    assert.equal(service.overview().providers.find((item) => item.key === 'glm').providerId, 'zai')
    assert.equal((await service.listResetCards()).error, 'unsupported-provider')
    assert.equal((await service.useResetCard({ resetType: 'WEEK' })).error, 'unsupported-provider')
    assert.equal(fetchImpl.calls.filter((call) => call.url.includes('customer-package-reset')).length, 0)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('stale quota plans never trigger an auto-spend, even with a live reset endpoint', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    let failQuota = false
    const healthy = stubFetch({ plan: WEEK_AT_95 })
    const fetchImpl = (url, init) => failQuota && String(url).includes('/api/monitor/usage/quota/limit')
      ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
      : healthy(url, init)
    const service = createIsolatedQuotaService(stubCtx(), { fetchImpl, legacyAutoSettingsPath: path })
    await service.refresh() // A real high-usage snapshot, but auto-use was off.
    service.updateAutoResetConfig({ fiveHour: { enabled: false }, week: { enabled: true, threshold: 90 } })
    failQuota = true
    await service.refresh()
    assert.equal(service.overview().providers.find((item) => item.key === 'glm').status, 'stale')
    assert.equal(healthy.calls.filter((call) => call.url.includes('customer-package-reset/use')).length, 0)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('simultaneous high week and 5h usage spends a weekly card only', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    const bothHigh = structuredClone(WEEK_AT_95)
    bothHigh.data.limits[0].currentValue = 95
    const fetchImpl = stubFetch({ plan: bothHigh })
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl, legacyAutoSettingsPath: path,
      autoReset: { fiveHour: { enabled: true, threshold: 90 }, week: { enabled: true, threshold: 90 } },
    })
    await service.refresh()
    const uses = fetchImpl.calls.filter((call) => call.url.includes('customer-package-reset/use'))
    assert.equal(uses.length, 1)
    assert.equal(JSON.parse(uses[0].body).resetType, 'WEEK')
    assert.equal(service.overview().autoReset.fiveHour.armed, false)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('manual spend waits for an in-flight background wallet read before using a live card', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    const healthy = stubFetch({ plan: WEEK_AT_10 })
    let releaseList, listStarted
    const gate = new Promise((resolve) => { releaseList = resolve })
    const entered = new Promise((resolve) => { listStarted = resolve })
    let firstList = true
    const fetchImpl = async (url, init) => {
      if (firstList && String(url).includes('/customer-package-reset/list')) {
        firstList = false
        listStarted()
        await gate
      }
      return healthy(url, init)
    }
    const service = createIsolatedQuotaService(stubCtx(), { fetchImpl, legacyAutoSettingsPath: path })
    const poll = service.refresh()
    await entered
    const manual = service.useResetCard({ resetType: 'WEEK' })
    await Promise.resolve()
    assert.equal(healthy.calls.filter((call) => call.url.includes('/customer-package-reset/use')).length, 0,
      'a spend never overtakes the background read')
    releaseList()
    assert.equal((await manual).ok, true)
    await poll
    assert.equal(healthy.calls.filter((call) => call.url.includes('/customer-package-reset/use')).length, 1)
    assert.ok(healthy.calls.filter((call) => call.url.includes('/customer-package-reset/list')).length >= 3,
      'spending still re-lists immediately before use and once afterwards')
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a manual spend in flight rejects a simultaneous second manual spend', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    const healthy = stubFetch({ plan: WEEK_AT_95 })
    let releaseList, listStarted
    const gate = new Promise((resolve) => { releaseList = resolve })
    const entered = new Promise((resolve) => { listStarted = resolve })
    let firstList = true
    const fetchImpl = async (url, init) => {
      if (firstList && String(url).includes('/customer-package-reset/list')) {
        firstList = false
        listStarted()
        await gate
      }
      return healthy(url, init)
    }
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl, legacyAutoSettingsPath: path,
    })
    // The spend's own pre-POST re-list is the gated request: the second manual
    // call must see resetSpendInFlight and refuse, never queue a second POST.
    const first = service.useResetCard({ resetType: 'WEEK' })
    await entered
    assert.equal((await service.useResetCard({ resetType: 'WEEK' })).error, 'busy')
    releaseList()
    assert.equal((await first).ok, true)
    await service.refresh()
    assert.equal(healthy.calls.filter((call) => call.url.includes('customer-package-reset/use')).length, 1)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('manual list in flight blocks automatic spending and disarms on success', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    const healthy = stubFetch({ plan: WEEK_AT_95 })
    let releaseList, listStarted
    const gate = new Promise((resolve) => { releaseList = resolve })
    const entered = new Promise((resolve) => { listStarted = resolve })
    let firstList = true
    const fetchImpl = async (url, init) => {
      if (firstList && String(url).includes('/customer-package-reset/list')) {
        firstList = false
        listStarted()
        await gate
      }
      return healthy(url, init)
    }
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl, legacyAutoSettingsPath: path, autoReset: { week: { enabled: true, threshold: 90 } },
    })
    const manual = service.useResetCard({ resetType: 'WEEK' })
    await entered
    await service.refresh()
    releaseList()
    assert.equal((await manual).ok, true)
    await service.refresh()
    assert.equal(healthy.calls.filter((call) => call.url.includes('customer-package-reset/use')).length, 1)
    assert.equal(service.overview().autoReset.week.armed, false)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a switch-off during the automatic list revalidates and sends no spend POST', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    const healthy = stubFetch({ plan: WEEK_AT_95 })
    let releaseList, listStarted
    const gate = new Promise((resolve) => { releaseList = resolve })
    const entered = new Promise((resolve) => { listStarted = resolve })
    let firstList = true
    const fetchImpl = async (url, init) => {
      if (firstList && String(url).includes('/customer-package-reset/list')) {
        firstList = false
        listStarted()
        await gate
      }
      return healthy(url, init)
    }
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl, legacyAutoSettingsPath: path, autoReset: { week: { enabled: true, threshold: 90 } },
    })
    const poll = service.refresh()
    await entered
    service.updateAutoResetConfig({ fiveHour: { enabled: false }, week: { enabled: false } })
    releaseList()
    await poll
    assert.equal(healthy.calls.filter((call) => call.url.includes('customer-package-reset/use')).length, 0)
    assert.equal(service.overview().autoReset.lastEvent, undefined, 'an intentional skip is not a failed spend')
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('failed card listing respects the 10-minute auto retry backoff', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    let clock = 1_000_000
    const healthy = stubFetch({ plan: WEEK_AT_95 })
    let listAttempts = 0
    const fetchImpl = (url, init) => {
      if (String(url).includes('/customer-package-reset/list')) {
        listAttempts += 1
        return Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
      }
      return healthy(url, init)
    }
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl, now: () => clock, legacyAutoSettingsPath: path,
      autoReset: { week: { enabled: true, threshold: 90 } },
    })
    await service.refresh()
    await service.refresh()
    assert.equal(listAttempts, 1)
    clock += 11 * 60_000
    await service.refresh()
    assert.equal(listAttempts, 2)
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('ambiguous POST result disarms auto-use instead of retrying after backoff', async () => {
  const { dir, path } = tempSettingsPath()
  try {
    let clock = 1_000_000
    const healthy = stubFetch({ plan: WEEK_AT_95 })
    let useAttempts = 0
    const fetchImpl = (url, init) => {
      if (String(url).includes('/customer-package-reset/use')) {
        useAttempts += 1
        return Promise.reject(new Error('connection ended after request was sent'))
      }
      return healthy(url, init)
    }
    const service = createIsolatedQuotaService(stubCtx(), {
      fetchImpl, now: () => clock, legacyAutoSettingsPath: path,
      autoReset: { week: { enabled: true, threshold: 90 } },
    })
    await service.refresh()
    assert.equal(useAttempts, 1)
    assert.equal(service.overview().autoReset.week.armed, false)
    assert.match(service.overview().autoReset.lastEvent.message, /结果未知/)
    clock += 11 * 60_000
    await service.refresh()
    assert.equal(useAttempts, 1, 'no automatic retry even after the usual backoff')
    service.stop()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('resolveAutoResetSettingsPath honours DSH_HOME and defaults to ~/.dsh', () => {
  assert.equal(
    resolveAutoResetSettingsPath({ DSH_HOME: 'D:\\custom' }).replaceAll('\\', '/'),
    'D:/custom/glm-quota-reset/settings.json',
  )
  assert.match(resolveAutoResetSettingsPath({}).replaceAll('\\', '/'), /\/\.dsh\/glm-quota-reset\/settings\.json$/)
  assert.match(resolveAutoResetSettingsPath({ DSH_HOME: '   ' }).replaceAll('\\', '/'), /\/\.dsh\/glm-quota-reset\/settings\.json$/)
})
