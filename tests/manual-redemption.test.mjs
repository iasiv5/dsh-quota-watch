import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createIsolatedQuotaService } from './support/isolated-service.mjs'

/**
 * Task 4: the manual reset-card spend must durably journal BEFORE its
 * irreversible POST, persist known outcomes as receipts that survive a lost
 * host→browser response, persist ambiguous outcomes as unknown, and keep new
 * manual consumption locked until an acknowledgement clears the record.
 *
 * Every service is built through the isolated helper and only ever speaks to
 * the synthetic transport below — never a real upstream, never a real card.
 */

const PLAN = {
  success: true,
  data: {
    level: 'pro',
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, currentValue: 10, usage: 100, percentage: 10 },
      { type: 'CREDIT_LIMIT', unit: 6, currentValue: 10, usage: 100, percentage: 10 },
    ],
  },
}
const USAGE = { success: true, data: { totalUsage: { totalTokensUsage: 5, totalModelCallCount: 1 } } }
const CARDS = {
  success: true,
  data: {
    weekResets: [{ recordId: 9001, grantType: 'DIRECT', expireTime: '2026-12-01 00:00:00', available: true }],
    fiveHourResets: [{ recordId: 8001, grantType: 'DIRECT', expireTime: '2026-12-01 00:00:00', available: true }],
  },
}
const USE_OK = { status: 200, body: { code: 200, success: true, msg: '操作成功' } }
const USE_REFUSED = { status: 200, body: { code: 500, success: false, msg: '指定的重置次数不可用' } }

function tempOutcomePath(t) {
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-manual-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return join(home, 'glm-quota-reset', 'manual-outcome.json')
}

/**
 * Build an isolated service on a synthetic transport.
 * `use` controls the /customer-package-reset/use answer:
 *   a {status,body} pair, or the strings 'reject' (transport failure),
 *   'nonjson' (HTTP 200 unparseable), 'unclear' (200 without a usable success flag).
 * `onUse` runs when the POST is actually sent (before its answer is produced).
 */
function makeService(t, { use = USE_OK, onUse, manualOutcomePath } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    const target = String(url)
    calls.push(target)
    const respond = (answer) => new Response(
      typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body),
      { status: answer.status, headers: { 'content-type': 'application/json' } },
    )
    if (target.includes('/customer-package-reset/use')) {
      if (onUse) await onUse()
      if (use === 'reject') throw new Error('connection ended after request was sent')
      if (use === 'nonjson') return respond({ status: 200, body: 'OK' })
      if (use === 'unclear') return respond({ status: 200, body: { code: 200, msg: 'no flag' } })
      return respond(use)
    }
    if (target.includes('/customer-package-reset/list')) return respond({ status: 200, body: CARDS })
    if (target.includes('/api/monitor/usage/quota/limit')) return respond({ status: 200, body: PLAN })
    if (target.includes('model-usage')) return respond({ status: 200, body: USAGE })
    if (target.includes('api.github.com')) return new Response('unauthorized', { status: 401 })
    return new Response('{}', { status: 404 })
  }
  const service = createIsolatedQuotaService(
    {
      logger: { info: () => {}, warn: () => {} },
      settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'zai-coding-cn': { apiKeyEnv: 'GLM_TEST_KEY' } } } }] },
      credentials: { resolve: async () => ({ value: 'synthetic-glm-key' }), readRecord: async () => undefined },
    },
    { logMirror: () => {}, fetchImpl, ...(manualOutcomePath !== undefined ? { manualOutcomePath } : {}) },
  )
  t.after(() => service.stop())
  return { service, calls }
}

function diskRecord(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const useCalls = (calls) => calls.filter((url) => url.includes('/customer-package-reset/use'))

test('a manual spend journals in-flight before the POST and keeps a known receipt after answering', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  let diskStatusAtUse
  const { service, calls } = makeService(t, {
    manualOutcomePath,
    onUse: () => { diskStatusAtUse = diskRecord(manualOutcomePath).status },
  })

  const result = await service.useResetCard({ resetType: 'WEEK' })

  assert.equal(result.ok, true)
  assert.equal(typeof result.attemptId, 'string')
  assert.ok(result.attemptId.length > 0)
  assert.equal(diskStatusAtUse, 'in-flight', 'the write-ahead record is durable when the POST is sent')
  assert.equal(useCalls(calls).length, 1)

  // The known outcome stays as a receipt after the browser response: only the
  // browser's delivery confirmation may clear it.
  assert.equal(diskRecord(manualOutcomePath).status, 'known-success')
  const overview = service.overview()
  assert.equal(overview.manualOutcome.attemptId, result.attemptId)
  assert.equal(overview.manualOutcome.status, 'known-success')

  // Projections stay credential-free.
  const flat = JSON.stringify(overview) + JSON.stringify(result)
  assert.equal(flat.includes('synthetic-glm-key'), false)
})

test('a failed journal write sends no POST at all', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-manual-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const blocker = join(home, 'blocker')
  writeFileSync(blocker, 'a plain file blocks the journal directory')

  const { service, calls } = makeService(t, { manualOutcomePath: join(blocker, 'manual-outcome.json') })

  const result = await service.useResetCard({ resetType: 'WEEK' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'storage-unavailable')
  assert.equal(useCalls(calls).length, 0, 'no durable in-flight record, no irreversible POST')
  assert.equal(service.overview().manualOutcomeError, 'storage-unavailable')
})

test('a corrupt journal locks manual spending instead of trusting "no record"', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  mkdirSync(dirname(manualOutcomePath), { recursive: true })
  writeFileSync(manualOutcomePath, '{"autoReset": broken')

  const { service, calls } = makeService(t, { manualOutcomePath })
  const result = await service.useResetCard({ resetType: 'WEEK' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'storage-unavailable')
  assert.equal(useCalls(calls).length, 0)
})

test('ambiguous upstream outcomes persist unknown and keep the spend locked across a restart', async (t) => {
  for (const use of ['reject', { status: 500, body: {} }, 'nonjson', 'unclear']) {
    const manualOutcomePath = tempOutcomePath(t)
    const { service, calls } = makeService(t, { use, manualOutcomePath })

    const result = await service.useResetCard({ resetType: 'FIVE_HOUR' })
    assert.equal(result.ok, false, String(use))
    assert.equal(result.error, 'request-unknown', String(use))
    assert.equal(typeof result.attemptId, 'string', String(use))
    assert.equal(diskRecord(manualOutcomePath).status, 'unknown', String(use))
    assert.equal(service.overview().manualOutcome.status, 'unknown', String(use))
    service.stop()

    // Restart on the same storage: the unknown outcome survives and a new
    // manual consumption stays blocked.
    const restarted = makeService(t, { use: USE_OK, manualOutcomePath })
    const second = await restarted.service.useResetCard({ resetType: 'FIVE_HOUR' })
    assert.equal(second.ok, false, String(use))
    assert.equal(second.error, 'manual-outcome-unresolved', String(use))
    assert.equal(useCalls(restarted.calls).length, 0, `no new spend while unknown: ${use}`)
    restarted.service.stop()
  }
})

test('an explicit upstream refusal persists a known-refused receipt and survives a restart', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  const { service, calls } = makeService(t, { use: USE_REFUSED, manualOutcomePath })

  const result = await service.useResetCard({ resetType: 'WEEK' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'rejected')
  assert.equal(result.attemptId, diskRecord(manualOutcomePath).attemptId)
  assert.equal(diskRecord(manualOutcomePath).status, 'known-refused')
  service.stop()

  const restarted = makeService(t, { use: USE_OK, manualOutcomePath })
  assert.equal(restarted.service.overview().manualOutcome.status, 'known-refused')
  const second = await restarted.service.useResetCard({ resetType: 'WEEK' })
  assert.equal(second.error, 'manual-outcome-unresolved', 'an unconfirmed receipt still locks the wallet')
  assert.equal(useCalls(restarted.calls).length, 0)
  restarted.service.stop()
})

test('a known receipt write failure keeps the disk in-flight and the wallet locked', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  mkdirSync(dirname(manualOutcomePath), { recursive: true })
  const journalDir = dirname(manualOutcomePath)

  const { service, calls } = makeService(t, {
    manualOutcomePath,
    onUse: () => { chmodSync(journalDir, 0o500) }, // the receipt replace must fail
  })
  try {
    const result = await service.useResetCard({ resetType: 'WEEK' })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'request-unknown', 'an unpersistable outcome must not be presented as certain success')
    assert.equal(diskRecord(manualOutcomePath).status, 'in-flight', 'the write-ahead record is preserved')
    assert.equal(useCalls(calls).length, 1, 'the POST itself did go out — the outcome is simply not provable')

    const overview = service.overview()
    assert.equal(overview.manualOutcome.status, 'unknown')
    const second = await service.useResetCard({ resetType: 'WEEK' })
    assert.equal(second.error, 'manual-outcome-unresolved', 'the wallet stays locked')
    assert.equal(useCalls(calls).length, 1, 'and no second POST happens')
  } finally {
    chmodSync(journalDir, 0o700)
  }
})

test('a crash-leftover in-flight record presents as unknown and blocks new spending after restart', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  mkdirSync(dirname(manualOutcomePath), { recursive: true })
  writeFileSync(manualOutcomePath, `${JSON.stringify({
    version: 1, attemptId: 'crashed-attempt', resetType: 'WEEK', startedAt: 1234, status: 'in-flight',
  }, null, 2)}\n`)

  const { service, calls } = makeService(t, { manualOutcomePath })
  const overview = service.overview()
  assert.equal(overview.manualOutcome.attemptId, 'crashed-attempt')
  assert.equal(overview.manualOutcome.status, 'unknown', 'disk in-flight after restart is an unknown outcome')

  const result = await service.useResetCard({ resetType: 'WEEK' })
  assert.equal(result.error, 'manual-outcome-unresolved')
  assert.equal(useCalls(calls).length, 0)
})

test('two concurrent manual requests produce at most one spend', async (t) => {
  const { service, calls } = makeService(t)
  const [first, second] = await Promise.all([
    service.useResetCard({ resetType: 'WEEK' }),
    service.useResetCard({ resetType: 'WEEK' }),
  ])
  const outcomes = [first, second].map((row) => (row.ok === true ? 'spent' : row.error)).sort()
  assert.deepEqual(outcomes, ['busy', 'spent'])
  assert.equal(useCalls(calls).length, 1)
})
