/**
 * Offline unit tests for the reset-card core.
 * Fixtures are the shapes observed from the live upstream, including the exact
 * request contract verified against open-source implementations.
 *   node --test test/reset.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildResetListSpec,
  buildResetUseSpec,
  normalizeResetType,
  parseResetCards,
  parseResetExpiryTime,
  parseResetUseResult,
  pickResetCard,
  publicResetCards,
  resetWindow,
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

test('the shared expiry parser reads bare stamps as Beijing and keeps explicit zones', () => {
  assert.equal(parseResetExpiryTime('2026-11-02 00:30:00'), Date.parse('2026-11-02T00:30:00+08:00'),
    'a bare wall-clock stamp reads as Beijing time (+08:00)')
  assert.equal(parseResetExpiryTime('2026-11-01 15:00:00Z'), Date.parse('2026-11-01T15:00:00Z'),
    'an explicit Z stamp keeps the upstream interpretation')
  assert.equal(parseResetExpiryTime('2026-11-01 15:00:00+02:00'), Date.parse('2026-11-01T15:00:00+02:00'),
    'an explicit offset is never double-appended')
  assert.equal(parseResetExpiryTime('garbage'), undefined)
  assert.equal(parseResetExpiryTime(''), undefined)
  assert.equal(parseResetExpiryTime(undefined), undefined)
})

test('a Z-stamped card that is truly earlier wins over a later Beijing stamp', () => {
  // '2026-11-02 00:30:00' reads as 2026-11-01T16:30Z; the Z card is 15:00Z —
  // so the Z card is the real earliest despite its later local date.
  const cards = {
    week: [
      { recordId: 2, expireTime: '2026-11-02 00:30:00' },
      { recordId: 1, expireTime: '2026-11-01 15:00:00Z' },
    ],
    fiveHour: [],
  }
  assert.equal(pickResetCard(cards, 'WEEK').card.recordId, 1,
    'the same instant comparison drives host card picking')
})

test('an unparseable expiry sorts last instead of blocking the pick', () => {
  const cards = {
    week: [
      { recordId: 3, expireTime: 'not-a-date' },
      { recordId: 4, expireTime: '2026-11-01 09:00:00' },
    ],
    fiveHour: [],
  }
  assert.equal(pickResetCard(cards, 'WEEK').card.recordId, 4)
  // An all-invalid pool still yields a card (they all rank last together).
  const broken = { week: [{ recordId: 5, expireTime: 'nope' }], fiveHour: [] }
  assert.equal(pickResetCard(broken, 'WEEK').card.recordId, 5)
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
