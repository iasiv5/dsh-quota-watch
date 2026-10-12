import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createIsolatedQuotaService } from './support/isolated-service.mjs'
import { makeResetAcknowledgeRoute, makeResetReceiptRoute } from '../src/host.mjs'

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
function makeService(t, { use = USE_OK, plan, list, onUse, onList, manualOutcomePath, providerId = 'zai-coding-cn' } = {}) {
  const calls = []
  // Mutable per-test transport state so a scenario can break an endpoint only
  // AFTER the spend (e.g. the acknowledgement's fresh recheck must fail).
  const state = { use, plan, list }
  const fetchImpl = async (url) => {
    const target = String(url)
    calls.push(target)
    const respond = (answer) => new Response(
      typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body),
      { status: answer.status, headers: { 'content-type': 'application/json' } },
    )
    if (target.includes('/customer-package-reset/use')) {
      if (onUse) await onUse()
      const answer = state.use
      if (answer === 'reject') throw new Error('connection ended after request was sent')
      if (answer === 'nonjson') return respond({ status: 200, body: 'OK' })
      if (answer === 'unclear') return respond({ status: 200, body: { code: 200, msg: 'no flag' } })
      return respond(answer)
    }
    if (target.includes('/customer-package-reset/list')) {
      if (onList) await onList()
      return state.list === 'fail' ? new Response('{}', { status: 503 }) : respond({ status: 200, body: CARDS })
    }
    if (target.includes('/api/monitor/usage/quota/limit')) {
      return state.plan === 'fail' ? new Response('{}', { status: 503 }) : respond({ status: 200, body: PLAN })
    }
    if (target.includes('model-usage')) return respond({ status: 200, body: USAGE })
    if (target.includes('api.github.com')) return new Response('unauthorized', { status: 401 })
    return new Response('{}', { status: 404 })
  }
  const service = createIsolatedQuotaService(
    {
      logger: { info: () => {}, warn: () => {} },
      settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { [providerId]: { apiKeyEnv: 'GLM_TEST_KEY' } } } }] },
      credentials: { resolve: async () => ({ value: 'synthetic-glm-key' }), readRecord: async () => undefined },
    },
    { logMirror: () => {}, fetchImpl, ...(manualOutcomePath !== undefined ? { manualOutcomePath } : {}) },
  )
  t.after(() => service.stop())
  return { service, calls, state }
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

// --- Task 5: protected acknowledgement routes --------------------------------

function fakeResponse() {
  return {
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body },
  }
}

function postRequest({ origin = 'https://dsh.example', body = {} } = {}) {
  const chunks = [Buffer.from(JSON.stringify(body))]
  return {
    method: 'POST',
    socket: { remoteAddress: '198.51.100.24' },
    headers: { host: 'dsh.example', origin, cookie: 'paired=1' },
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next: async () => (index < chunks.length
          ? { value: chunks[index++], done: false }
          : { value: undefined, done: true }),
      }
    },
  }
}

function getRequest(origin = 'https://dsh.example') {
  return { method: 'GET', socket: { remoteAddress: '198.51.100.24' }, headers: { host: 'dsh.example', origin, cookie: 'paired=1' } }
}

function routeCtx() {
  return { remoteWebUiPairing: { isPairedDevice: () => true } }
}

async function invoke(route, req) {
  const res = fakeResponse()
  await route.handler(req, res)
  return { status: res.statusCode, body: JSON.parse(res.body ?? '{}') }
}

test('acknowledge and receipt routes are POST-only, exact and same-origin paired', async (t) => {
  const { service } = makeService(t)
  const ctx = routeCtx()
  for (const factory of [makeResetAcknowledgeRoute, makeResetReceiptRoute]) {
    const route = factory(ctx, service)
    assert.equal(route.kind, 'exact')
    assert.ok(route.path.startsWith('/api/dsh-quota-watch/reset-cards/'))
    assert.equal((await invoke(route, getRequest())).status, 405, 'GET never reaches an acknowledgement')
    assert.equal((await invoke(route, postRequest({ origin: 'https://attacker.example', body: { attemptId: 'x' } }))).status, 403)
  }
})

test('an unknown outcome clears only after a fresh domestic plan and wallet recheck', async (t) => {
  // A failing plan probe keeps the record locked.
  const blindPlanPath = tempOutcomePath(t)
  const failing = makeService(t, { use: 'reject', manualOutcomePath: blindPlanPath })
  const spentWhileBlind = await failing.service.useResetCard({ resetType: 'WEEK' })
  assert.equal(spentWhileBlind.error, 'request-unknown')
  failing.state.plan = 'fail' // the fresh recheck cannot read the plan
  const acknowledgeBlind = makeResetAcknowledgeRoute(routeCtx(), failing.service)
  const blind = await invoke(acknowledgeBlind, postRequest({ body: { attemptId: spentWhileBlind.attemptId } }))
  assert.equal(blind.status, 502)
  assert.equal(blind.body.error, 'verify-failed')
  assert.equal(failing.service.overview().manualOutcome.status, 'unknown', 'a failed recheck keeps the lock')
  failing.service.stop()

  // A failing wallet list keeps the record locked too.
  const blindListPath = tempOutcomePath(t)
  const failingList = makeService(t, { use: 'reject', manualOutcomePath: blindListPath })
  const spentWhileListBlind = await failingList.service.useResetCard({ resetType: 'WEEK' })
  assert.equal(spentWhileListBlind.error, 'request-unknown')
  failingList.state.list = 'fail' // the fresh recheck cannot read the wallet
  const acknowledgeList = makeResetAcknowledgeRoute(routeCtx(), failingList.service)
  const listBlind = await invoke(acknowledgeList, postRequest({ body: { attemptId: spentWhileListBlind.attemptId } }))
  assert.equal(listBlind.status, 502)
  assert.equal(failingList.service.overview().manualOutcome.status, 'unknown')
  failingList.service.stop()

  // Fresh plan + wallet answers let the user clear the unknown.
  const clearablePath = tempOutcomePath(t)
  const { service } = makeService(t, { use: 'reject', manualOutcomePath: clearablePath })
  const spent = await service.useResetCard({ resetType: 'WEEK' })
  const acknowledge = makeResetAcknowledgeRoute(routeCtx(), service)
  const mismatch = await invoke(acknowledge, postRequest({ body: { attemptId: 'wrong-id' } }))
  assert.equal(mismatch.status, 409, 'a stale attempt id can never clear the current record')
  const settled = await invoke(acknowledge, postRequest({ body: { attemptId: spent.attemptId } }))
  assert.equal(settled.status, 200)
  assert.equal(settled.body.ok, true)
  assert.equal(service.overview().manualOutcome, undefined, 'the acknowledged record is gone')
  service.stop()

  // The wallet is spendable again afterwards.
  const again = makeService(t, { manualOutcomePath: clearablePath })
  assert.equal((await again.service.useResetCard({ resetType: 'FIVE_HOUR' })).ok, true)
  assert.equal(useCalls(again.calls).length, 1)
})

test('a known receipt clears only through the receipt route with the same attemptId', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  const { service } = makeService(t, { use: USE_REFUSED, manualOutcomePath })
  const spent = await service.useResetCard({ resetType: 'WEEK' })
  assert.equal(spent.error, 'rejected')
  const attemptId = spent.attemptId

  const cross = await invoke(
    makeResetAcknowledgeRoute(routeCtx(), service),
    postRequest({ body: { attemptId } }),
  )
  assert.equal(cross.status, 409, 'a known receipt cannot be verified away as if it were unknown')
  assert.equal(service.overview().manualOutcome.status, 'known-refused')

  const receipt = makeResetReceiptRoute(routeCtx(), service)
  assert.equal((await invoke(receipt, postRequest({ body: { attemptId: 'wrong-id' } }))).status, 409)
  assert.equal(service.overview().manualOutcome.status, 'known-refused', 'still locked after a wrong id')

  const settled = await invoke(receipt, postRequest({ body: { attemptId } }))
  assert.equal(settled.status, 200)
  assert.equal(settled.body.ok, true)
  assert.equal(service.overview().manualOutcome, undefined)
  service.stop()

  const again = makeService(t, { manualOutcomePath })
  assert.equal((await again.service.useResetCard({ resetType: 'FIVE_HOUR' })).ok, true)
})

test('a lost host→browser use response leaves a receipt the next session can settle', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  const first = makeService(t, { manualOutcomePath })
  const spent = await first.service.useResetCard({ resetType: 'WEEK' })
  assert.equal(spent.ok, true)
  // ...but the browser never received that response.

  const second = makeService(t, { manualOutcomePath })
  const overview = second.service.overview()
  assert.equal(overview.manualOutcome.status, 'known-success')
  assert.equal(overview.manualOutcome.attemptId, spent.attemptId)
  const locked = await second.service.useResetCard({ resetType: 'FIVE_HOUR' })
  assert.equal(locked.error, 'manual-outcome-unresolved')
  assert.equal(useCalls(second.calls).length, 0, 'the unconfirmed receipt blocks new spending')

  const settle = await invoke(
    makeResetReceiptRoute(routeCtx(), second.service),
    postRequest({ body: { attemptId: spent.attemptId } }),
  )
  assert.equal(settle.status, 200)
  assert.equal(second.service.overview().manualOutcome, undefined)
  second.service.stop()

  const third = makeService(t, { manualOutcomePath })
  assert.equal((await third.service.useResetCard({ resetType: 'FIVE_HOUR' })).ok, true)
})

test('an in-flight POST cannot be acknowledged through either route', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  let releaseUse
  const gate = new Promise((resolve) => { releaseUse = resolve })
  const { service } = makeService(t, { manualOutcomePath, onUse: () => gate })

  const pending = service.useResetCard({ resetType: 'WEEK' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(diskRecord(manualOutcomePath).status, 'in-flight')
  const attemptId = diskRecord(manualOutcomePath).attemptId

  const acknowledge = await invoke(
    makeResetAcknowledgeRoute(routeCtx(), service),
    postRequest({ body: { attemptId } }),
  )
  const receipt = await invoke(
    makeResetReceiptRoute(routeCtx(), service),
    postRequest({ body: { attemptId } }),
  )
  assert.equal(acknowledge.status, 409)
  assert.equal(receipt.status, 409)
  assert.equal(diskRecord(manualOutcomePath).status, 'in-flight', 'the live attempt stays untouched')

  releaseUse()
  assert.equal((await pending).ok, true)
})

test('an acknowledgement against an international provider reports the real reason and stays locked', async (t) => {
  const manualOutcomePath = tempOutcomePath(t)
  const first = makeService(t, { use: 'reject', manualOutcomePath })
  const spent = await first.service.useResetCard({ resetType: 'WEEK' })
  assert.equal(spent.error, 'request-unknown')
  first.service.stop()

  // The provider switches to the international route: the fresh recheck must
  // fail with the truthful reason, not a generic wallet error, and keep the lock.
  const switched = makeService(t, { providerId: 'zai', manualOutcomePath })
  const ack = makeResetAcknowledgeRoute(routeCtx(), switched.service)
  const result = await invoke(ack, postRequest({ body: { attemptId: spent.attemptId } }))
  assert.equal(result.status, 502)
  assert.equal(result.body.error, 'verify-failed')
  assert.match(result.body.message, /仅支持国内站/, 'the real cause is surfaced')
  assert.equal(switched.service.overview().manualOutcome.status, 'unknown', 'the record stays locked')
})

// --- Task 6: manual/wallet cases migrated from the retired auto-reset file ---

test('a manual spend waits for an in-flight background wallet read before using a live card', async (t) => {
  let releaseList, listStarted
  const gate = new Promise((resolve) => { releaseList = resolve })
  const entered = new Promise((resolve) => { listStarted = resolve })
  let firstList = true
  const { service, calls } = makeService(t, {
    onList: () => {
      if (firstList) {
        firstList = false
        listStarted()
        return gate
      }
      return undefined
    },
  })

  const poll = service.refresh()
  await entered
  const manual = service.useResetCard({ resetType: 'WEEK' })
  await Promise.resolve()
  assert.equal(useCalls(calls).length, 0, 'a spend never overtakes the background read')
  releaseList()
  assert.equal((await manual).ok, true)
  await poll
  assert.equal(useCalls(calls).length, 1)
  assert.ok(calls.filter((url) => url.includes('/customer-package-reset/list')).length >= 3,
    'spending still re-lists immediately before use and once afterwards')
})

test('a manual spend in flight rejects a simultaneous second manual spend', async (t) => {
  let releaseList, listStarted
  const gate = new Promise((resolve) => { releaseList = resolve })
  const entered = new Promise((resolve) => { listStarted = resolve })
  let firstList = true
  const { service, calls } = makeService(t, {
    onList: () => {
      if (firstList) {
        firstList = false
        listStarted()
        return gate
      }
      return undefined
    },
  })

  // The spend's own pre-POST re-list is the gated request: the second manual
  // call must see resetSpendInFlight and refuse, never queue a second POST.
  const first = service.useResetCard({ resetType: 'WEEK' })
  await entered
  assert.equal((await service.useResetCard({ resetType: 'WEEK' })).error, 'busy')
  releaseList()
  assert.equal((await first).ok, true)
  await service.refresh()
  assert.equal(useCalls(calls).length, 1)
})

test('an international GLM provider never sees the domestic reset endpoints', async (t) => {
  const { service, calls } = makeService(t, { providerId: 'zai' })
  await service.refresh()
  assert.equal(service.overview().providers.find((item) => item.key === 'glm').providerId, 'zai')
  assert.equal((await service.listResetCards()).error, 'unsupported-provider')
  assert.equal((await service.useResetCard({ resetType: 'WEEK' })).error, 'unsupported-provider')
  assert.equal(calls.filter((url) => url.includes('customer-package-reset')).length, 0,
    'the reset-card API stays domestic-only, even via direct HTTP')
})
