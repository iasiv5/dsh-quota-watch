import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  classifyProbeError,
  makeOverviewRoute,
  makeRefreshRoute,
  makeResetAcknowledgeRoute,
  makeResetReceiptRoute,
  makeRetiredAutoResetRoute,
  resolveAutoResetSettingsPath,
  resolveManualOutcomePath,
} from '../src/host.mjs'
import { CLIENT_ROUTES, ROUTES } from '../src/shared.mjs'
import { createIsolatedQuotaService } from './support/isolated-service.mjs'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const glmBody = JSON.parse(await readFile(resolve(fixtureDir, 'glm-plan-response.json'), 'utf8'))
const glmUsageBody = JSON.parse(await readFile(resolve(fixtureDir, 'glm-model-usage-response.json'), 'utf8'))
const copilotBody = JSON.parse(await readFile(resolve(fixtureDir, 'copilot-user-response.json'), 'utf8'))

function providerBody(url) {
  if (url.includes('model-usage')) return glmUsageBody
  if (url.includes('bigmodel.cn')) return glmBody
  return copilotBody
}

function makeContext({ glmKey = 'synthetic-glm-key', githubOAuth = 'synthetic-github-oauth', logger } = {}) {
  return {
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', value: { providers: {
        'zai-coding-cn': { apiKeyEnv: 'GLM_TEST_KEY' },
      } } }],
    },
    credentials: {
      resolve: async (ref) => String(ref) === 'GLM_TEST_KEY' ? { value: glmKey } : undefined,
      readRecord: async () => ({ kind: 'grant', payload: {
        type: 'oauth', refresh: githubOAuth, access: 'synthetic-short-lived-copilot-token',
      } }),
    },
    ...(logger ? { logger } : {}),
  }
}

test('one refresh probes both providers with current secrets and returns only normalized data', async () => {
  const seen = []
  const context = makeContext()
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()) })
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl, now: () => 1_800_000_000_000 })

  await service.refresh()
  const overview = service.overview()
  const glm = overview.providers.find((provider) => provider.key === 'glm')
  const copilot = overview.providers.find((provider) => provider.key === 'copilot')

  assert.equal(glm.status, 'ready')
  assert.equal(glm.plan.windows.length, 4)
  assert.equal(glm.usage.status, 'ready')
  assert.equal(glm.usage.totalTokens, 8300000)
  assert.equal(glm.usage.totalCalls, 152)
  assert.equal(glm.usage.models.length, 2)
  assert.equal(copilot.status, 'ready')
  assert.equal(copilot.quota.remaining, 7600)
  assert.equal(seen.length, 4, 'plan, usage, Copilot and initial reset-card list')
  assert.equal(seen.filter((request) => request.url.includes('/customer-package-reset/list')).length, 1)
  assert.ok(seen.find((request) => request.url.includes('model-usage')).url.includes('startTime='))
  assert.equal(seen.find((request) => request.url.includes('bigmodel.cn') && !request.url.includes('model-usage')).headers.authorization, 'synthetic-glm-key')
  assert.equal(seen.find((request) => request.url.includes('api.github.com')).headers.authorization, 'Bearer synthetic-github-oauth')
  assert.equal(JSON.stringify(overview).includes('synthetic-glm-key'), false)
  assert.equal(JSON.stringify(overview).includes('synthetic-github-oauth'), false)
  assert.equal(JSON.stringify(overview).includes('synthetic-short-lived-copilot-token'), false)
})

test('later refresh resolves rotated credentials instead of reusing old values', async () => {
  let glmKey = 'synthetic-glm-old'
  let githubOAuth = 'synthetic-github-old'
  const seen = []
  const context = makeContext({ glmKey, githubOAuth })
  context.credentials.resolve = async () => ({ value: glmKey })
  context.credentials.readRecord = async () => ({ kind: 'grant', payload: { type: 'oauth', refresh: githubOAuth, access: 'synthetic-access' } })
  const fetchImpl = async (url, init) => {
    seen.push({ url, authorization: new Headers(init.headers).get('authorization') })
    return new Response(JSON.stringify(providerBody(url)), { status: 200 })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl })

  await service.refresh()
  glmKey = 'synthetic-glm-rotated'
  githubOAuth = 'synthetic-github-rotated'
  await service.refresh()

  const bigmodelRequests = seen.filter((request) => request.url.includes('bigmodel.cn')
    && !request.url.includes('/customer-package-reset/'))
  assert.equal(bigmodelRequests.length, 4)
  assert.equal(bigmodelRequests.at(-1).authorization, 'synthetic-glm-rotated')
  assert.equal(bigmodelRequests.at(-2).authorization, 'synthetic-glm-rotated')
  assert.equal(seen.filter((request) => request.url.includes('api.github.com')).at(-1).authorization, 'Bearer synthetic-github-rotated')
})

test('classifyProbeError maps probe failures to kinds and messages', () => {
  assert.deepEqual(classifyProbeError(Object.assign(new Error(), { name: 'TimeoutError' })), { message: '请求超时', kind: 'network' })
  assert.deepEqual(classifyProbeError(Object.assign(new Error(), { name: 'AbortError' })), { message: '请求超时', kind: 'network' })
  assert.deepEqual(classifyProbeError(Object.assign(new Error(), { status: 401 })), { message: 'HTTP 401', kind: 'auth' })
  assert.deepEqual(classifyProbeError(Object.assign(new Error(), { status: 403 })), { message: 'HTTP 403', kind: 'auth' })
  assert.deepEqual(classifyProbeError(Object.assign(new Error(), { status: 503 })), { message: 'HTTP 503', kind: 'server' })
  assert.deepEqual(classifyProbeError(Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })), { message: '服务商响应格式无法识别', kind: 'parse' })
  assert.deepEqual(
    classifyProbeError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })),
    { message: '探测失败 (ECONNRESET)', kind: 'network' },
  )
  assert.deepEqual(classifyProbeError(new Error('boom')), { message: '探测失败', kind: 'network' })
})

test('auth failures expose errorKind in the overview snapshot', async () => {
  const context = makeContext()
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) return new Response('unauthorized', { status: 401 })
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl })
  await service.refresh()

  const copilot = service.overview().providers.find((provider) => provider.key === 'copilot')
  assert.equal(copilot.status, 'error', 'first-round failure has no last-good to fall back on')
  assert.equal(copilot.error, 'HTTP 401')
  assert.equal(copilot.errorKind, 'auth')
})

test('probe failures retain last-good quota and report stale status without clearing values', async () => {
  let failing = false
  const context = makeContext()
  const fetchImpl = async (url) => {
    if (failing) return new Response('{}', { status: 503 })
    return new Response(JSON.stringify(providerBody(url)), { status: 200 })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl })
  await service.refresh()
  failing = true
  await service.refresh()

  const overview = service.overview()
  const glm = overview.providers.find((provider) => provider.key === 'glm')
  const copilot = overview.providers.find((provider) => provider.key === 'copilot')
  assert.equal(glm.status, 'stale')
  assert.equal(glm.plan.windows.length, 4)
  assert.equal(copilot.status, 'stale')
  assert.equal(copilot.quota.remaining, 7600)
  assert.equal(glm.error, 'HTTP 503')
  assert.equal(glm.errorKind, 'server')
  assert.equal(copilot.error, 'HTTP 503')
  assert.equal(copilot.errorKind, 'server')
})

test('usage probe failure keeps the plan ready and degrades only the usage block', async () => {
  let usageFailing = false
  const context = makeContext()
  const fetchImpl = async (url) => {
    if (usageFailing && url.includes('model-usage')) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify(providerBody(url)), { status: 200 })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl })
  await service.refresh()
  usageFailing = true
  await service.refresh()

  const glm = service.overview().providers.find((provider) => provider.key === 'glm')
  assert.equal(glm.status, 'ready')
  assert.equal(glm.plan.windows.length, 4)
  assert.equal(glm.usage.status, 'stale')
  assert.equal(glm.usage.totalTokens, 8300000)
  assert.ok(glm.usage.error)
  assert.ok(glm.error === undefined)
})

test('usage probe failure without last-good data reports an error block, not a ready usage', async () => {
  const context = makeContext()
  const fetchImpl = async (url) => new Response(
    JSON.stringify(url.includes('model-usage') ? { success: false } : providerBody(url)),
    { status: 200 },
  )
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl })
  await service.refresh()

  const glm = service.overview().providers.find((provider) => provider.key === 'glm')
  assert.equal(glm.status, 'ready')
  assert.equal(glm.plan.windows.length, 4)
  assert.equal(glm.usage.status, 'error')
  assert.equal(glm.usage.totalTokens, undefined)
  assert.equal(glm.usage.error, '服务商响应格式无法识别', 'a 200 with an unparseable body is a parse failure, not a server failure')
  assert.equal(glm.usage.errorKind, 'parse')
})

test('missing credentials are reported without making provider requests', async () => {
  const context = {
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }] },
    credentials: { resolve: async () => undefined, readRecord: async () => undefined },
  }
  let calls = 0
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl: async () => { calls += 1; throw new Error('unexpected fetch') } })
  await service.refresh()

  assert.equal(calls, 0)
  assert.equal(service.overview().providers.find((provider) => provider.key === 'glm').status, 'missing')
  assert.equal(service.overview().providers.find((provider) => provider.key === 'copilot').status, 'missing')
})

function recordingLogger() {
  const logs = { warn: [], info: [] }
  return { logs, logger: { warn: (line) => logs.warn.push(line), info: (line) => logs.info.push(line) } }
}

test('probe state transitions are logged once per real transition with kind-aware detail', async () => {
  const { logs, logger } = recordingLogger()
  const mirror = { warn: [], info: [] }
  const context = makeContext({ logger })
  let usageFailing = false
  let failing = false
  const fetchImpl = async (url) => {
    if (failing) return new Response('{}', { status: url.includes('api.github.com') ? 401 : 503 })
    if (usageFailing && url.includes('model-usage')) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createIsolatedQuotaService(context, {
    fetchImpl,
    logMirror: { warn: (line) => mirror.warn.push(line), info: (line) => mirror.info.push(line) },
  })
  await service.refresh()
  assert.ok(logs.info.some((line) => line.includes('quota-watch: glm loading→ready')), logs.info)
  assert.ok(logs.info.some((line) => line.includes('quota-watch: glm-usage loading→ready')), logs.info)
  assert.ok(logs.info.some((line) => line.includes('quota-watch: copilot loading→ready')), logs.info)
  assert.equal(logs.warn.length, 0)

  usageFailing = true
  await service.refresh()
  assert.ok(logs.warn.some((line) => line.includes('quota-watch: glm-usage ready→stale (HTTP 500)')), logs.warn)

  usageFailing = false
  await service.refresh()
  assert.ok(logs.info.some((line) => line.includes('quota-watch: glm-usage stale→ready')), logs.info)

  failing = true
  await service.refresh()
  assert.ok(logs.warn.some((line) => line.includes('quota-watch: glm ready→stale (HTTP 503)')), logs.warn)
  assert.ok(logs.warn.some((line) => line.includes('quota-watch: copilot ready→stale (HTTP 401)')), logs.warn)

  failing = false
  await service.refresh()
  assert.ok(logs.info.some((line) => line.includes('quota-watch: glm stale→ready')), logs.info)
  assert.ok(logs.info.some((line) => line.includes('quota-watch: copilot stale→ready')), logs.info)

  const warnCount = logs.warn.length
  const infoCount = logs.info.length
  await service.refresh()
  assert.equal(logs.warn.length, warnCount, 'steady-state rounds emit no warnings')
  assert.equal(logs.info.length, infoCount, 'steady-state rounds emit no infos')
  assert.deepEqual(mirror.warn, logs.warn, 'console mirror receives every warning verbatim')
  assert.deepEqual(mirror.info, logs.info, 'console mirror receives every info verbatim')
})

test('missing credentials log an informational transition without probing', async () => {
  const { logs, logger } = recordingLogger()
  const context = makeContext({ glmKey: '', githubOAuth: '', logger })
  let calls = 0
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl: async () => { calls += 1; throw new Error('unexpected fetch') } })
  await service.refresh()

  assert.equal(calls, 0)
  assert.ok(logs.info.some((line) => line.includes('quota-watch: glm loading→missing')), logs.info)
  assert.ok(logs.info.some((line) => line.includes('quota-watch: copilot loading→missing')), logs.info)
  assert.equal(logs.warn.length, 0, 'missing credentials are not a degradation')
})

function fakeResponse() {
  return {
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body },
  }
}

function pairedRequest({ method = 'GET', origin = 'https://dsh.example' } = {}) {
  return {
    method,
    socket: { remoteAddress: '198.51.100.24' },
    headers: { host: 'dsh.example', origin, cookie: 'paired=1' },
  }
}

/** A request with a JSON body chunk stream, for handlers that read bodies. */
function postJsonRequest(base, body) {
  const chunks = [Buffer.from(JSON.stringify(body))]
  return {
    ...base,
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

test('overview route requires paired access and returns no-store JSON', () => {
  const ctx = { remoteWebUiPairing: { isPairedDevice: (request) => request.headers.cookie === 'paired=1' } }
  const service = { overview: () => ({ providers: [], updatedAt: 1 }) }
  const route = makeOverviewRoute(ctx, service)
  const allowed = fakeResponse()
  route.handler(pairedRequest(), allowed)
  assert.equal(allowed.statusCode, 200)
  assert.equal(allowed.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(allowed.body), { providers: [], updatedAt: 1 })

  const denied = fakeResponse()
  route.handler({ ...pairedRequest(), headers: { host: 'dsh.example', origin: 'https://dsh.example' } }, denied)
  assert.equal(denied.statusCode, 403)
})

test('cross-site routes are rejected and refresh is POST-only', async () => {
  const ctx = { remoteWebUiPairing: { isPairedDevice: () => true } }
  const forceFlags = []
  const service = { overview: () => ({ providers: [] }), refresh: async (force) => { forceFlags.push(force) } }
  const route = makeRefreshRoute(ctx, service)
  const crossSite = fakeResponse()
  await route.handler(pairedRequest({ method: 'POST', origin: 'https://attacker.example' }), crossSite)
  assert.equal(crossSite.statusCode, 403)

  const wrongMethod = fakeResponse()
  await route.handler(pairedRequest({ method: 'GET' }), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)

  const allowed = fakeResponse()
  await route.handler(pairedRequest({ method: 'POST' }), allowed)
  assert.equal(allowed.statusCode, 200)
  assert.deepEqual(JSON.parse(allowed.body), { providers: [] })
  assert.deepEqual(forceFlags, [true], 'the one manual refresh control forces a fresh wallet list')
})

test('loopback access requires a loopback socket and ignores forwarded address headers', () => {
  const route = makeOverviewRoute({}, { overview: () => ({ providers: [] }) })
  const loopback = fakeResponse()
  route.handler({
    method: 'GET',
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
  }, loopback)
  assert.equal(loopback.statusCode, 200)

  const spoofed = fakeResponse()
  route.handler({
    method: 'GET',
    socket: { remoteAddress: '198.51.100.24' },
    headers: { host: 'dsh.example', origin: 'https://dsh.example', 'x-forwarded-for': '127.0.0.1' },
  }, spoofed)
  assert.equal(spoofed.statusCode, 403)
})

test('cold retries back off exponentially and cap at the normal cadence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  let attempts = 0
  const context = makeContext()
  const fetchImpl = async (url) => {
    // This test counts quota/Copilot probes, not the independent card poll.
    if (!String(url).includes('/customer-package-reset/list')) attempts += 1
    throw new Error('still down')
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl, now: () => 1_800_000_000_000, pollIntervalSec: 60, coldRetryMs: 5_000 })
  try {
    service.start()
    t.mock.timers.tick(0)
    await flush()
    assert.equal(attempts, 2, 'start() probes both providers immediately')
    // Each retryable round doubles the armed delay (capped at the normal cadence).
    // A tick shorter than the armed delay must fire nothing — that no-fire check is
    // what actually discriminates backoff from the legacy constant short interval,
    // because a completed round re-arms its timer only after the flush, so any tick
    // >= the armed delay fires exactly one round under either implementation.
    const steps = [
      [4_000, 2, 'first backoff stage is 5s: 4s must not fire'],
      [1_000, 4, null],
      [9_000, 4, 'second backoff stage is 10s: 9s must not fire'],
      [1_000, 6, null],
      [19_000, 6, 'third backoff stage is 20s: 19s must not fire'],
      [1_000, 8, null],
      [39_000, 8, 'fourth backoff stage is 40s: 39s must not fire'],
      [1_000, 10, null],
      [59_000, 10, 'fifth backoff stage is capped at 60s: 59s must not fire'],
      [1_000, 12, null],
      [59_000, 12, 'the cap holds: 59s must not fire'],
      [1_000, 14, null],
    ]
    for (const [tickMs, expected, message] of steps) {
      t.mock.timers.tick(tickMs)
      await flush()
      assert.equal(attempts, expected, message ?? `tick(${tickMs}) fires the due retryable round`)
    }
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

test('cold retry backoff resets after a successful round and restarts from the short interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  let glmAttempts = 0
  let copilotAttempts = 0
  let glmWorks = false
  let glmKey = 'synthetic-glm-key'
  const context = makeContext()
  context.credentials.resolve = async () => glmKey ? { value: glmKey } : undefined
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) {
      copilotAttempts += 1
      return new Response('unauthorized', { status: 401 })
    }
    if (url.includes('/customer-package-reset/list')) return new Response('unavailable', { status: 503 })
    glmAttempts += 1
    if (!glmWorks) throw new Error('glm down')
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl, now: () => 1_800_000_000_000, pollIntervalSec: 60, coldRetryMs: 5_000 })
  try {
    service.start()
    t.mock.timers.tick(0)
    await flush()
    assert.equal(glmAttempts, 1)
    assert.equal(copilotAttempts, 1)
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(glmAttempts, 2, 'round 2 fires at the short interval')
    assert.equal(copilotAttempts, 2)
    glmWorks = true
    t.mock.timers.tick(10_000)
    await flush()
    assert.equal(glmAttempts, 4, 'the recovering round probes glm plan + usage')
    assert.equal(copilotAttempts, 3)
    assert.equal(service.overview().providers.find((provider) => provider.key === 'glm').status, 'ready')
    glmKey = ''
    t.mock.timers.tick(60_000)
    await flush()
    assert.equal(glmAttempts, 4, 'a missing credential probes nothing')
    assert.equal(copilotAttempts, 4)
    assert.equal(service.overview().providers.find((provider) => provider.key === 'glm').status, 'missing')
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(copilotAttempts, 5, 'the retryable delay restarted from the short interval after the reset (a missing reset would wait >=20s)')
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

test('cold start probes immediately, retries fast while failing, and warms to the normal cadence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  // A completed refresh() is several awaits deep; setImmediate is NOT mocked,
  // so a few immediate hops flush the probe chain before assertions.
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  let attempts = 0
  const context = makeContext()
  const fetchImpl = async (url) => {
    if (url.includes('/customer-package-reset/list')) return new Response('unavailable', { status: 503 })
    attempts += 1
    if (attempts <= 4) throw new Error('network not ready yet')
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl, now: () => 1_800_000_000_000, pollIntervalSec: 60, coldRetryMs: 5_000 })
  try {
    service.start()
    t.mock.timers.tick(0)
    await flush()
    assert.equal(attempts, 2, 'start() probes both providers immediately (no legacy 2s padding)')
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(attempts, 4, 'a failed cold round re-probes at the short cold interval')
    t.mock.timers.tick(10_000)
    await flush()
    assert.equal(attempts, 7, 'the recovering round succeeds (glm plan + glm usage + copilot); its tick doubled with the backoff')
    const overview = service.overview()
    assert.equal(overview.providers.find((provider) => provider.key === 'glm').status, 'ready')
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(attempts, 7, 'a warm service ignores the cold interval')
    t.mock.timers.tick(60_000)
    await flush()
    assert.equal(attempts, 10, 'a warm service probes on the normal cadence (3 hops per round)')
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

test('without credentials the cold interval never engages (no high-frequency probing)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  let attempts = 0
  const context = makeContext({ glmKey: '', githubOAuth: '' })
  const fetchImpl = async (url) => {
    attempts += 1
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createIsolatedQuotaService(context, { logMirror: () => {}, fetchImpl, now: () => 1_800_000_000_000, pollIntervalSec: 60, coldRetryMs: 5_000 })
  try {
    service.start()
    t.mock.timers.tick(0)
    await flush()
    assert.equal(attempts, 0, 'missing credentials probe nothing')
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(attempts, 0, 'all-missing providers do not trigger the cold fast retry')
    t.mock.timers.tick(60_000)
    await flush()
    assert.equal(attempts, 0, 'the normal cadence re-checks credentials without network calls')
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

// --- Task 7: continuous usage-failure timing ---------------------------------

const USAGE_FAIL_STALE_MS = 5 * 60_000

/** A usage-focused service stub with an injectable clock and togglable failures. */
function usageTimingService(t) {
  let clock = 1_700_000_000_000
  const state = {
    planFails: false,
    usageFails: false,
  }
  const calls = []
  const fetchImpl = async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('model-usage')) {
      if (state.usageFails) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(syntheticUsage), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('/api/monitor/usage/quota/limit')) {
      if (state.planFails) return new Response('{}', { status: 503 })
      return new Response(JSON.stringify(highUsagePlan), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('/customer-package-reset/list')) {
      return new Response(JSON.stringify(syntheticCards), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('api.github.com')) return new Response('unauthorized', { status: 401 })
    return new Response('{}', { status: 404 })
  }
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  t.after(() => service.stop())
  return {
    service,
    calls,
    state,
    tick: (ms) => { clock += ms },
    glmUsage: () => service.overview().providers.find((provider) => provider.key === 'glm').usage,
  }
}

test('failureSince stamps the first real failure and stays constant across consecutive failures', async (t) => {
  const harness = usageTimingService(t)
  await harness.service.refresh()
  assert.equal(harness.glmUsage().status, 'ready')
  assert.equal(harness.glmUsage().failureSince, undefined)

  harness.state.usageFails = true
  await harness.service.refresh()
  const firstFailureAt = harness.glmUsage().failureSince
  assert.equal(harness.glmUsage().status, 'stale')
  assert.equal(typeof firstFailureAt, 'number')

  harness.tick(60_000)
  await harness.service.refresh()
  assert.equal(harness.glmUsage().status, 'stale', 'still failing')
  assert.equal(harness.glmUsage().failureSince, firstFailureAt, 'a continuous episode keeps its first stamp')
})

test('an overview read alone flips staleTooLong after five minutes of continuous failure', async (t) => {
  const harness = usageTimingService(t)
  await harness.service.refresh()
  harness.state.usageFails = true
  await harness.service.refresh()
  assert.equal(harness.glmUsage().staleTooLong, undefined, 'a fresh failure is not yet "too long"')

  harness.tick(USAGE_FAIL_STALE_MS)
  const callsBefore = harness.calls.length
  const usage = harness.glmUsage()
  assert.equal(usage.staleTooLong, true, 'the host clock projects the degradation without a new probe')
  assert.equal(harness.calls.length, callsBefore, 'no extra upstream request is needed')
  assert.equal(typeof usage.totalTokens, 'number', 'the snapshot still carries the last-good values; the client decides what to show')
})

test('a successful usage probe clears both failure fields', async (t) => {
  const harness = usageTimingService(t)
  await harness.service.refresh()
  harness.state.usageFails = true
  await harness.service.refresh()
  assert.equal(harness.glmUsage().status, 'stale')

  harness.tick(USAGE_FAIL_STALE_MS + 1)
  harness.state.usageFails = false
  await harness.service.refresh()
  const usage = harness.glmUsage()
  assert.equal(usage.status, 'ready')
  assert.equal(usage.failureSince, undefined)
  assert.equal(usage.staleTooLong, undefined)
})

test('waiting without a real failure never produces a failure episode', async (t) => {
  const harness = usageTimingService(t)
  await harness.service.refresh()
  harness.tick(10 * USAGE_FAIL_STALE_MS)
  await harness.service.refresh()
  const usage = harness.glmUsage()
  assert.equal(usage.status, 'ready')
  assert.equal(usage.failureSince, undefined)
  assert.equal(usage.staleTooLong, undefined)
})

test('a first failure without last-good values reports error and starts the episode', async (t) => {
  const harness = usageTimingService(t)
  harness.state.usageFails = true
  await harness.service.refresh()
  const usage = harness.glmUsage()
  assert.equal(usage.status, 'error')
  assert.equal(typeof usage.failureSince, 'number', 'even an error episode is timestamped')
  assert.equal(usage.totalTokens, undefined)

  harness.tick(USAGE_FAIL_STALE_MS)
  assert.equal(harness.glmUsage().staleTooLong, true)
})

// --- Task 6: the automatic strategy is fully retired -------------------------

test('the wallet poll stays read-only on its ten-minute gate; force bypasses it', async (t) => {
  let clock = 1_700_000_000_000
  let failList = false
  const healthy = recordingFetch()
  const fetchImpl = (url, init) => {
    if (failList && String(url).includes('/customer-package-reset/list')) {
      return Promise.resolve(new Response('{}', { status: 503 }))
    }
    return healthy(url, init)
  }
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  const listCount = () => healthy.calls.filter((call) => call.url.includes('/customer-package-reset/list')).length
  try {
    await service.refresh()
    assert.equal(listCount(), 1, 'the first poll learns the wallet read-only')
    assert.equal(service.overview().reset.status, 'ready')
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
    clock += 60_000
    await service.refresh()
    assert.equal(listCount(), 2, 'failed listing still starts a quiet period')
    failList = false
    clock += 9 * 60_000
    await service.refresh()
    assert.equal(listCount(), 3, 'the wallet recovers at the next due round')
    assert.equal(spendCalls(healthy).length, 0, 'no poll path ever spends')
  } finally { service.stop() }
})

test('the overview snapshot carries no automatic-strategy state', async () => {
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl })
  try {
    await service.refresh()
    const overview = service.overview()
    assert.equal('autoReset' in overview, false)
    assert.equal(overview.autoReset, undefined)
  } finally { service.stop() }
})

test('the retired auto-reset endpoint is a 410 tombstone without any side effect', async (t) => {
  const settingsPath = tempLegacySettings(t, {
    autoReset: { fiveHour: { enabled: true, threshold: 90 }, week: { enabled: true, threshold: 90 } },
  })
  const before = readFileSync(settingsPath, 'utf8')
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, legacyAutoSettingsPath: settingsPath })
  try {
    const route = makeRetiredAutoResetRoute({ remoteWebUiPairing: { isPairedDevice: () => true } })
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, '/api/dsh-quota-watch/auto-reset')

    const wrongMethod = fakeResponse()
    await route.handler(pairedRequest({ method: 'GET' }), wrongMethod)
    assert.equal(wrongMethod.statusCode, 405)

    const crossSite = fakeResponse()
    await route.handler(pairedRequest({ method: 'POST', origin: 'https://attacker.example' }), crossSite)
    assert.equal(crossSite.statusCode, 403)

    // A paired POST carrying a full re-authorization body: 410, the body is
    // never read, nothing is written, nothing is consumed.
    const tombstone = fakeResponse()
    await route.handler(postJsonRequest(pairedRequest({ method: 'POST' }), {
      fiveHour: { enabled: true }, week: { enabled: true },
    }), tombstone)
    assert.equal(tombstone.statusCode, 410)
    assert.equal(JSON.parse(tombstone.body).error, 'retired')
    assert.equal(readFileSync(settingsPath, 'utf8'), before, 'the saved switches file is untouched')
    assert.equal(spendCalls(fetchImpl).length, 0, 'no card POST anywhere')
  } finally { service.stop() }
})

test('legacy settings and manual outcome path resolvers honour DSH_HOME and default to ~/.dsh', () => {
  for (const [resolver, file] of [
    [resolveAutoResetSettingsPath, 'settings.json'],
    [resolveManualOutcomePath, 'manual-outcome.json'],
  ]) {
    const escaped = file.replaceAll('.', '\\.')
    assert.equal(resolver({ DSH_HOME: 'D:\\custom' }).replaceAll('\\', '/'), `D:/custom/glm-quota-reset/${file}`)
    assert.match(resolver({}).replaceAll('\\', '/'), new RegExp(`/\\.dsh/glm-quota-reset/${escaped}$`))
    assert.match(resolver({ DSH_HOME: '   ' }).replaceAll('\\', '/'), new RegExp(`/\\.dsh/glm-quota-reset/${escaped}$`))
  }
})

// --- Task 5: protected acknowledgement routes --------------------------------

test('acknowledge and receipt routes live under the reset-cards namespace as exact routes', () => {
  assert.equal(ROUTES.resetAcknowledge, '/api/dsh-quota-watch/reset-cards/acknowledge')
  assert.equal(ROUTES.resetReceipt, '/api/dsh-quota-watch/reset-cards/receipt')
  assert.equal(CLIENT_ROUTES.resetAcknowledge, 'api/dsh-quota-watch/reset-cards/acknowledge')
  assert.equal(CLIENT_ROUTES.resetReceipt, 'api/dsh-quota-watch/reset-cards/receipt')
  const ctx = { remoteWebUiPairing: { isPairedDevice: () => true } }
  const service = {
    acknowledgeManualOutcome: async () => ({ ok: true }),
    acknowledgeKnownReceipt: () => ({ ok: true }),
  }
  for (const [factory, path] of [
    [makeResetAcknowledgeRoute, ROUTES.resetAcknowledge],
    [makeResetReceiptRoute, ROUTES.resetReceipt],
  ]) {
    const route = factory(ctx, service)
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, path)
  }
})

// --- Task 3: the retired automatic spending path -----------------------------

/** Synthetic GLM plan with BOTH windows at 95% — far past any auto threshold. */
const highUsagePlan = {
  success: true,
  data: {
    level: 'pro',
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, currentValue: 95, usage: 100, percentage: 95 },
      { type: 'CREDIT_LIMIT', unit: 6, currentValue: 95, usage: 100, percentage: 95 },
    ],
  },
}
const syntheticUsage = { success: true, data: { totalUsage: { totalTokensUsage: 10, totalModelCallCount: 2 } } }
const syntheticCards = {
  success: true,
  data: {
    weekResets: [{ recordId: 9001, grantType: 'DIRECT', expireTime: '2026-12-01 00:00:00', available: true }],
    fiveHourResets: [{ recordId: 8001, grantType: 'DIRECT', expireTime: '2026-12-01 00:00:00', available: true }],
  },
}

/** Transport stub answering the full probe surface, recording every request. */
function recordingFetch({ plan = highUsagePlan } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, method: init?.method ?? 'GET', body: init?.body })
    const pick = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
    if (target.includes('/api/monitor/usage/quota/limit')) return pick(plan)
    if (target.includes('model-usage')) return pick(syntheticUsage)
    if (target.includes('api.github.com')) return pick(copilotBody)
    if (target.includes('/customer-package-reset/list')) return pick(syntheticCards)
    return new Response('{}', { status: 404 })
  }
  fetchImpl.calls = calls
  return fetchImpl
}

function tempLegacySettings(t, document) {
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-host-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const settingsPath = join(home, 'glm-quota-reset', 'settings.json')
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify(document, null, 2)}\n`)
  return settingsPath
}

const spendCalls = (fetchImpl) => fetchImpl.calls.filter((call) => call.url.includes('/customer-package-reset/use'))

test('a saved legacy wallet with both switches enabled never spends a card in the new host', async (t) => {
  const settingsPath = tempLegacySettings(t, {
    autoReset: { fiveHour: { enabled: true, threshold: 50 }, week: { enabled: true, threshold: 50 } },
  })
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), {
    logMirror: () => {}, fetchImpl, legacyAutoSettingsPath: settingsPath,
  })
  try {
    await service.refresh()
    await service.refresh()
    await service.refresh()
    assert.equal(service.overview().providers.find((provider) => provider.key === 'glm').status, 'ready')
    assert.equal(spendCalls(fetchImpl).length, 0,
      'the retired feature cannot spend a card no matter what the saved file says')
  } finally { service.stop() }
})

test('start() forces the saved legacy switches off before the first poll and reports success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  const settingsPath = tempLegacySettings(t, {
    autoReset: { fiveHour: { enabled: true }, week: { enabled: true, threshold: 90 } },
  })
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), {
    logMirror: () => {}, fetchImpl, legacyAutoSettingsPath: settingsPath,
  })
  try {
    service.start()
    assert.deepEqual(service.legacyAutoRetirement(), { ok: true }, 'the retirement outcome is observable')
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf8'))
    assert.equal(onDisk.autoReset.fiveHour.enabled, false, 'the saved file is overwritten all-off before polling')
    assert.equal(onDisk.autoReset.week.enabled, false)

    t.mock.timers.tick(0)
    await flush()
    assert.ok(fetchImpl.calls.length > 0, 'the first poll still runs after the migration')
    assert.equal(spendCalls(fetchImpl).length, 0, 'and it never spends')
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

test('a failed legacy-settings write reports rollback risk without blocking the new host', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-host-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const blocker = join(home, 'blocker')
  writeFileSync(blocker, 'a plain file blocks the settings directory')
  const settingsPath = join(blocker, 'settings.json')

  const { logs, logger } = recordingLogger()
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext({ logger }), {
    fetchImpl, legacyAutoSettingsPath: settingsPath,
  })
  try {
    service.start()
    const retirement = service.legacyAutoRetirement()
    assert.equal(retirement.ok, false, 'the failed overwrite is observable')
    assert.equal(typeof retirement.error, 'string')
    assert.ok(
      logs.warn.some((line) => line.includes('legacy auto-reset settings') && line.includes(retirement.error)),
      logs.warn,
    )

    t.mock.timers.tick(0)
    await flush()
    assert.ok(fetchImpl.calls.length > 0, 'the new host still probes: the write failure only reports rollback risk')
    assert.equal(spendCalls(fetchImpl).length, 0, 'and it still has no automatic spending path')
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

// --- Idle polling pause --------------------------------------------------------

test('scheduled rounds skip every probe once no client has been seen for two intervals', async () => {
  let clock = 1_800_000_000_000
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  try {
    service.noteClientSeen()
    await service.refresh()
    assert.equal(fetchImpl.calls.length, 4, 'plan, usage, Copilot and the initial card list')
    clock += 60_000
    await service.refresh()
    assert.equal(fetchImpl.calls.length, 7, 'one interval past the stamp is still not idle (card list gated)')
    clock += 60_000
    const skipped = await service.refresh()
    assert.equal(fetchImpl.calls.length, 7, 'an idle round probes nothing upstream')
    assert.equal(skipped.providers.length, 2, 'an idle round still serves the cached view')
  } finally { service.stop() }
})

test('the first client request after a pause resumes with stale-while-revalidate', async () => {
  let clock = 1_800_000_000_000
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  try {
    service.noteClientSeen()
    await service.refresh()
    const before = service.overview().updatedAt
    clock += 120_000
    await service.refresh() // engages the pause
    clock += 3_600_000 // a long night passes
    assert.equal(service.overview().updatedAt, before, 'the cached observation survives the pause unchanged')
    const kick = service.noteClientSeen()
    assert.notEqual(kick, undefined, 'a stale snapshot kicks a background round')
    await kick
    assert.ok(service.overview().updatedAt > before, 'the kicked round refreshes the snapshot')
    assert.equal(fetchImpl.calls.length, 8, 'plan, usage, Copilot and a no-longer-gated card list ran again')
    assert.equal(service.noteClientSeen(), undefined, 'fresh data does not kick another round')
    assert.equal(fetchImpl.calls.length, 8)
  } finally { service.stop() }
})

test('a forced refresh ignores the idle pause', async () => {
  let clock = 1_800_000_000_000
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  try {
    service.noteClientSeen()
    await service.refresh()
    clock += 120_000
    await service.refresh(true) // the manual 立即刷新 path
    assert.equal(fetchImpl.calls.length, 8, 'the forced round probes and re-lists cards despite the pause')
  } finally { service.stop() }
})

test('boot counts as watched: start() always runs the initial round', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl })
  const flush = async () => {
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  try {
    service.start()
    t.mock.timers.tick(0)
    await flush()
    assert.equal(fetchImpl.calls.length, 4, 'the initial round probes without any client request')
  } finally {
    service.stop()
    t.mock.timers.reset()
  }
})

test('idle pause and resume log exactly one line per transition', async () => {
  let clock = 1_800_000_000_000
  const logs = { info: [], warn: [] }
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), {
    logMirror: { info: (line) => logs.info.push(line), warn: (line) => logs.warn.push(line) },
    fetchImpl,
    now: () => clock,
  })
  try {
    service.noteClientSeen()
    await service.refresh()
    clock += 120_000
    await service.refresh()
    await service.refresh()
    assert.equal(logs.info.filter((line) => line.includes('poll paused')).length, 1, 'one pause line per entry')
    service.noteClientSeen()
    clock += 120_000
    await service.refresh()
    assert.equal(logs.info.filter((line) => line.includes('poll resumed')).length, 1)
    assert.equal(logs.info.filter((line) => line.includes('poll paused')).length, 2)
  } finally { service.stop() }
})

test('manual card listing still answers while idle — the pause gates only scheduled rounds', async () => {
  let clock = 1_800_000_000_000
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  try {
    service.noteClientSeen()
    await service.refresh()
    clock += 120_000
    await service.refresh() // engages the pause
    const listed = await service.listResetCards()
    assert.equal(listed.ok, true)
    assert.equal(
      fetchImpl.calls.filter((call) => call.url.includes('/customer-package-reset/list')).length,
      2,
      'an explicit list re-reads upstream regardless of the pause',
    )
  } finally { service.stop() }
})

test('the overview route stamps the watcher and answers from cache without waiting', async () => {
  let clock = 1_800_000_000_000
  const fetchImpl = recordingFetch()
  const service = createIsolatedQuotaService(makeContext(), { logMirror: () => {}, fetchImpl, now: () => clock })
  try {
    service.noteClientSeen()
    await service.refresh()
    clock += 3_600_000
    await service.refresh() // engages the pause
    const route = makeOverviewRoute({ remoteWebUiPairing: { isPairedDevice: () => true } }, service)
    const res = fakeResponse()
    await route.handler(pairedRequest({ method: 'GET' }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.body).providers.length, 2, 'answered synchronously from the cached view')
    for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(service.noteClientSeen(), undefined, 'the kicked round has already refreshed the snapshot')
  } finally { service.stop() }
})
