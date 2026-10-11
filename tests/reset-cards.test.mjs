/**
 * Offline unit tests for the reset-card core.
 * Fixtures are the shapes observed from the live upstream, including the exact
 * request contract verified against open-source implementations.
 *   node --test test/reset.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_RESET_DEFAULT_THRESHOLD,
  autoResetConfigFor,
  buildResetListSpec,
  buildResetUseSpec,
  evaluateAutoReset,
  normalizeAutoResetConfig,
  normalizeResetType,
  parseResetCards,
  parseResetUseResult,
  pickResetCard,
  publicResetCards,
  resetWindow,
  windowKeyForResetType,
  RESET_TYPES,
} from '../src/core/reset.mjs'

const LIVE_LIST = {
  code: 200,
  msg: '操作成功',
  success: true,
  data: {
    customerId: 30201780215984827,
    targetType: 'PERSONAL',
    organizationId: null,
    projectId: null,
    lastFiveHourResetTime: '2026-10-06 20:17:33',
    lastWeekResetTime: '2026-10-05 13:39:18',
    fiveHourResets: [
      { recordId: 1148647, grantType: 'DIRECT', expireTime: '2026-10-28 11:20:16', available: true },
      { recordId: 1148649, grantType: 'DIRECT', expireTime: '2026-10-28 11:20:16', available: true },
      { recordId: 1594747, grantType: 'DIRECT', expireTime: '2026-09-30 23:57:03', available: false },
    ],
    weekResets: [
      { recordId: 1148642, grantType: 'DIRECT', expireTime: '2026-10-28 11:20:16', available: true },
      { recordId: 1148645, grantType: 'DIRECT', expireTime: '2026-11-01 09:00:00', available: true },
    ],
  },
}

test('normalizeResetType accepts the wire values and human spellings', () => {
  assert.equal(normalizeResetType('WEEK'), RESET_TYPES.week)
  assert.equal(normalizeResetType('weekly'), RESET_TYPES.week)
  assert.equal(normalizeResetType('five_hour'), RESET_TYPES.fiveHour)
  assert.equal(normalizeResetType('five-hour'), RESET_TYPES.fiveHour)
  assert.equal(normalizeResetType('5h'), RESET_TYPES.fiveHour)
  assert.equal(normalizeResetType('MONTH'), undefined)
  assert.equal(normalizeResetType(''), undefined)
  assert.equal(normalizeResetType(undefined), undefined)
})

test('windowKeyForResetType maps wire types onto plan window keys', () => {
  assert.equal(windowKeyForResetType('WEEK'), 'week')
  assert.equal(windowKeyForResetType('FIVE_HOUR'), '5h')
  assert.equal(windowKeyForResetType('MONTH'), undefined)
})

test('resetWindow: only the weekly card also clears the 5h window', () => {
  assert.deepEqual(resetWindow('WEEK'), { window: 'week', alsoClears: '5h' })
  assert.deepEqual(resetWindow('FIVE_HOUR'), { window: '5h', alsoClears: undefined })
  assert.equal(resetWindow('MONTH'), undefined)
})

test('list spec targets the domestic host with the raw key and PERSONAL scope', () => {
  const spec = buildResetListSpec({ apiKey: 'sk-test' })
  assert.equal(spec.url, 'https://open.bigmodel.cn/api/biz/customer-package-reset/list?targetType=PERSONAL')
  assert.equal(spec.headers.authorization, 'sk-test')
  assert.equal(buildResetListSpec({ apiKey: '' }), undefined)
})

test('use spec matches the verified upstream body contract', () => {
  const spec = buildResetUseSpec({
    apiKey: 'sk-test',
    resetType: 'weekly',
    recordId: 1148642,
    grantType: 'DIRECT',
    requestId: '0dcf0f39-1f6f-4d1e-9a4b-1f0f9f4b2f11',
  })
  assert.equal(spec.url, 'https://open.bigmodel.cn/api/biz/customer-package-reset/use')
  assert.equal(spec.headers['content-type'], 'application/json')
  const body = JSON.parse(spec.body)
  assert.deepEqual(body, {
    targetType: 'PERSONAL',
    resetType: 'WEEK',
    recordId: 1148642,
    requestId: '0dcf0f39-1f6f-4d1e-9a4b-1f0f9f4b2f11',
    grantType: 'DIRECT',
  })
  assert.equal(typeof body.recordId, 'number')
})

test('use spec refuses anything it cannot express safely', () => {
  const base = { apiKey: 'sk-test', resetType: 'WEEK', recordId: 1, requestId: 'x' }
  assert.equal(buildResetUseSpec({ ...base, apiKey: undefined }), undefined)
  assert.equal(buildResetUseSpec({ ...base, resetType: 'MONTH' }), undefined)
  assert.equal(buildResetUseSpec({ ...base, recordId: 0 }), undefined)
  assert.equal(buildResetUseSpec({ ...base, recordId: -3 }), undefined)
  assert.equal(buildResetUseSpec({ ...base, recordId: 1.5 }), undefined)
  assert.equal(buildResetUseSpec({ ...base, requestId: undefined }), undefined)
})

test('parseResetCards keeps only available cards and preserves the totals', () => {
  const cards = parseResetCards(200, LIVE_LIST)
  assert.equal(cards.week.length, 2)
  assert.equal(cards.fiveHour.length, 2)
  assert.equal(cards.weekTotal, 2)
  assert.equal(cards.fiveHourTotal, 3)
  assert.equal(cards.lastWeekResetTime, '2026-10-05 13:39:18')
  assert.ok(cards.fiveHour.every((card) => card.recordId !== 1594747))
})

test('parseResetCards rejects an unrecognized envelope instead of reporting zero', () => {
  assert.equal(parseResetCards(200, { success: false, code: 500 }), undefined)
  assert.equal(parseResetCards(401, LIVE_LIST), undefined)
  assert.equal(parseResetCards(200, { success: true }), undefined)
  assert.equal(parseResetCards(200, { success: true, data: { weekResets: null, fiveHourResets: null } }), undefined)
  assert.equal(parseResetCards(200, '<html>login</html>'), undefined)
  const partial = parseResetCards(200, { success: true, data: { weekResets: [] } })
  assert.deepEqual(partial.week, [])
  assert.deepEqual(partial.fiveHour, [])
})

test('parseResetCards drops records without a usable id', () => {
  const cards = parseResetCards(200, {
    success: true,
    data: {
      weekResets: [
        { recordId: '77', expireTime: '2026-10-01 00:00:00', available: true },
        { grantType: 'G', expireTime: '2026-10-01 00:00:00', available: true },
        { recordId: 0, available: true },
      ],
      fiveHourResets: [],
    },
  })
  assert.equal(cards.week.length, 1)
  assert.equal(cards.week[0].recordId, 77)
})

test('parseResetUseResult separates transport failure from business refusal', () => {
  assert.deepEqual(parseResetUseResult(200, { code: 200, success: true, msg: '操作成功' }), {
    ok: true, message: '操作成功', status: 200,
  })
  const refused = parseResetUseResult(200, { code: 500, success: false, msg: '指定的重置次数不可用，请刷新后重试' })
  assert.equal(refused.ok, false)
  assert.match(refused.message, /不可用/)
  const unauthorized = parseResetUseResult(401, {})
  assert.equal(unauthorized.ok, false)
  assert.match(unauthorized.message, /HTTP 401/)
})

test('pickResetCard defaults to the earliest-expiring card', () => {
  const cards = parseResetCards(200, LIVE_LIST)
  assert.equal(pickResetCard(cards, 'WEEK').card.recordId, 1148642)
  assert.equal(pickResetCard(cards, 'FIVE_HOUR').card.recordId, 1148647)
})

test('pickResetCard honours an explicit id and refuses a bad one', () => {
  const cards = parseResetCards(200, LIVE_LIST)
  assert.equal(pickResetCard(cards, 'WEEK', 1148645).card.recordId, 1148645)
  assert.equal(pickResetCard(cards, 'WEEK', 1148647).error, 'card-not-available')
  assert.equal(pickResetCard(cards, 'FIVE_HOUR', 1594747).error, 'card-not-available')
  assert.equal(pickResetCard(cards, 'WEEK', 999999999).error, 'card-not-available')
  assert.equal(pickResetCard(cards, 'MONTH').error, 'invalid-type')
})

test('pickResetCard reports exhaustion rather than throwing', () => {
  const empty = parseResetCards(200, { success: true, data: { weekResets: [], fiveHourResets: [] } })
  assert.equal(pickResetCard(empty, 'WEEK').error, 'no-card')
  assert.equal(pickResetCard(empty, 'FIVE_HOUR').error, 'no-card')
  assert.equal(pickResetCard(undefined, 'WEEK').error, 'no-cards')
})

test('publicResetCards exposes only browser-safe fields', () => {
  const view = publicResetCards(parseResetCards(200, LIVE_LIST))
  assert.deepEqual(Object.keys(view).sort(), [
    'fiveHour', 'fiveHourTotal', 'lastFiveHourResetTime', 'lastWeekResetTime', 'week', 'weekTotal',
  ])
  const serialized = JSON.stringify(view)
  assert.ok(!serialized.includes('30201780215984827'))
  assert.ok(!serialized.includes('organizationId'))
  assert.deepEqual(Object.keys(view.week[0]).sort(), ['expireTime', 'grantType', 'recordId'])
})

// --- auto reset -------------------------------------------------------------

test('normalizeAutoResetConfig defaults both windows to disabled at 99.9%', () => {
  const config = normalizeAutoResetConfig(undefined)
  assert.deepEqual(config.fiveHour, { enabled: false, threshold: 99.9 })
  assert.deepEqual(config.week, { enabled: false, threshold: 99.9 })
  assert.deepEqual(normalizeAutoResetConfig('garbage').week.enabled, false)
  assert.deepEqual(normalizeAutoResetConfig(42).fiveHour.enabled, false)
})

test('normalizeAutoResetConfig clamps thresholds and reads the enabled flag', () => {
  const config = normalizeAutoResetConfig({
    fiveHour: { enabled: true, threshold: 70 },
    week: { enabled: 'yes', threshold: 999 },
  })
  assert.deepEqual(config.fiveHour, { enabled: true, threshold: 70 })
  // A non-boolean enabled is not true; the threshold is clamped to the max.
  assert.equal(config.week.enabled, false)
  assert.equal(config.week.threshold, 99.9)
  // Below-minimum thresholds clamp up, so a typo can never fire instantly.
  assert.equal(normalizeAutoResetConfig({ week: { enabled: true, threshold: 5 } }).week.threshold, 50)
})

test('a 99.9 threshold survives normalization instead of rounding to 100', () => {
  // Rounding here would produce 100 — a value usage can never reach, silently
  // disabling the window it was configured to protect.
  const config = normalizeAutoResetConfig({
    fiveHour: { enabled: true, threshold: 99.9 },
    week: { enabled: true, threshold: 99.94 },
  })
  assert.equal(config.fiveHour.threshold, 99.9)
  assert.equal(config.week.threshold, 99.9, 'kept to one decimal')
  assert.ok(config.fiveHour.threshold < 100)
  // And the guard must actually fire at 99.9, not only above it.
  assert.equal(evaluateAutoReset({
    enabled: true, threshold: config.fiveHour.threshold, used: 99.9, armed: true, now: 1,
  }).spend, true)
  assert.equal(evaluateAutoReset({
    enabled: true, threshold: config.fiveHour.threshold, used: 99.8, armed: true, now: 1,
  }).spend, false)
})

test('autoResetConfigFor bridges window keys to config keys (the crash regression)', () => {
  // The host reads config by plan-window key ('5h'/'week') while the config
  // namespace is 'fiveHour'/'week'. Indexing directly returned undefined and threw
  // inside the poll timer, which killed the whole desktop host process.
  const config = normalizeAutoResetConfig({ fiveHour: { enabled: true, threshold: 60 } })
  assert.equal(autoResetConfigFor(config, '5h').enabled, true)
  assert.equal(autoResetConfigFor(config, '5h').threshold, 60)
  assert.equal(autoResetConfigFor(config, 'week').enabled, false)
  // An unknown or missing key must degrade to a disabled entry, never undefined.
  for (const key of ['month', 'mcp', undefined, '', 'FIVE_HOUR']) {
    const entry = autoResetConfigFor(config, key)
    assert.equal(entry.enabled, false, `key ${String(key)} must read as disabled`)
    assert.equal(entry.threshold, AUTO_RESET_DEFAULT_THRESHOLD)
  }
  assert.equal(autoResetConfigFor(undefined, '5h').enabled, false)
  assert.equal(autoResetConfigFor(null, 'week').threshold, AUTO_RESET_DEFAULT_THRESHOLD)
})

test('evaluateAutoReset spends only when enabled, armed and over the threshold', () => {
  const base = { enabled: true, threshold: 90, armed: true, now: 1_000_000 }
  assert.equal(evaluateAutoReset({ ...base, used: 91 }).spend, true)
  assert.equal(evaluateAutoReset({ ...base, used: 90 }).spend, true, 'exactly at threshold fires')
  assert.equal(evaluateAutoReset({ ...base, used: 89.9 }).spend, false)
})

test('evaluateAutoReset guards: disabled, no data, disarmed, backoff', () => {
  const base = { threshold: 90, armed: true, now: 1_000_000 }
  assert.equal(evaluateAutoReset({ ...base, enabled: false, used: 95 }).reason, 'disabled')
  assert.equal(evaluateAutoReset({ ...base, enabled: true, used: undefined }).reason, 'no-data')
  assert.equal(evaluateAutoReset({ ...base, enabled: true, used: 95, armed: false }).reason, 'already-spent')
  const withBackoff = evaluateAutoReset({
    ...base, enabled: true, used: 95, lastAttemptAt: 1_000_000 - 5 * 60_000,
  })
  assert.equal(withBackoff.spend, false)
  assert.equal(withBackoff.reason, 'backoff')
  assert.equal(evaluateAutoReset({
    ...base, enabled: true, used: 95, lastAttemptAt: 1_000_000 - 11 * 60_000,
  }).spend, true)
})

test('evaluateAutoReset re-arms when usage drops back below the threshold', () => {
  const result = evaluateAutoReset({ enabled: true, threshold: 90, used: 10, armed: false, now: 1 })
  assert.equal(result.spend, false)
  assert.equal(result.rearm, true)
  assert.equal(evaluateAutoReset({ enabled: true, threshold: 90, used: 95, armed: false, now: 1 }).rearm, undefined)
})
