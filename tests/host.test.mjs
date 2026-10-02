import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createQuotaService, makeOverviewRoute, makeRefreshRoute } from '../src/host.mjs'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const glmBody = JSON.parse(await readFile(resolve(fixtureDir, 'glm-plan-response.json'), 'utf8'))
const glmUsageBody = JSON.parse(await readFile(resolve(fixtureDir, 'glm-model-usage-response.json'), 'utf8'))
const copilotBody = JSON.parse(await readFile(resolve(fixtureDir, 'copilot-user-response.json'), 'utf8'))

function providerBody(url) {
  if (url.includes('model-usage')) return glmUsageBody
  if (url.includes('bigmodel.cn')) return glmBody
  return copilotBody
}

function makeContext({ glmKey = 'synthetic-glm-key', githubOAuth = 'synthetic-github-oauth' } = {}) {
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
  }
}

test('one refresh probes both providers with current secrets and returns only normalized data', async () => {
  const seen = []
  const context = makeContext()
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()) })
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createQuotaService(context, { fetchImpl, now: () => 1_800_000_000_000 })

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
  assert.equal(seen.length, 3)
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
  const service = createQuotaService(context, { fetchImpl })

  await service.refresh()
  glmKey = 'synthetic-glm-rotated'
  githubOAuth = 'synthetic-github-rotated'
  await service.refresh()

  const bigmodelRequests = seen.filter((request) => request.url.includes('bigmodel.cn'))
  assert.equal(bigmodelRequests.length, 4)
  assert.equal(bigmodelRequests.at(-1).authorization, 'synthetic-glm-rotated')
  assert.equal(bigmodelRequests.at(-2).authorization, 'synthetic-glm-rotated')
  assert.equal(seen.filter((request) => request.url.includes('api.github.com')).at(-1).authorization, 'Bearer synthetic-github-rotated')
})

test('probe failures retain last-good quota and report stale status without clearing values', async () => {
  let failing = false
  const context = makeContext()
  const fetchImpl = async (url) => {
    if (failing) return new Response('{}', { status: 503 })
    return new Response(JSON.stringify(providerBody(url)), { status: 200 })
  }
  const service = createQuotaService(context, { fetchImpl })
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
  assert.ok(glm.error)
  assert.ok(copilot.error)
})

test('usage probe failure keeps the plan ready and degrades only the usage block', async () => {
  let usageFailing = false
  const context = makeContext()
  const fetchImpl = async (url) => {
    if (usageFailing && url.includes('model-usage')) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify(providerBody(url)), { status: 200 })
  }
  const service = createQuotaService(context, { fetchImpl })
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
  const service = createQuotaService(context, { fetchImpl })
  await service.refresh()

  const glm = service.overview().providers.find((provider) => provider.key === 'glm')
  assert.equal(glm.status, 'ready')
  assert.equal(glm.plan.windows.length, 4)
  assert.equal(glm.usage.status, 'error')
  assert.equal(glm.usage.totalTokens, undefined)
  assert.ok(glm.usage.error)
})

test('missing credentials are reported without making provider requests', async () => {
  const context = {
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }] },
    credentials: { resolve: async () => undefined, readRecord: async () => undefined },
  }
  let calls = 0
  const service = createQuotaService(context, { fetchImpl: async () => { calls += 1; throw new Error('unexpected fetch') } })
  await service.refresh()

  assert.equal(calls, 0)
  assert.equal(service.overview().providers.find((provider) => provider.key === 'glm').status, 'missing')
  assert.equal(service.overview().providers.find((provider) => provider.key === 'copilot').status, 'missing')
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
  const service = { overview: () => ({ providers: [] }), refresh: async () => ({ providers: [] }) }
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
    attempts += 1
    if (attempts <= 4) throw new Error('network not ready yet')
    return new Response(JSON.stringify(providerBody(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const service = createQuotaService(context, { fetchImpl, now: () => 1_800_000_000_000, pollIntervalSec: 60, coldRetryMs: 5_000 })
  try {
    service.start()
    t.mock.timers.tick(0)
    await flush()
    assert.equal(attempts, 2, 'start() probes both providers immediately (no legacy 2s padding)')
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(attempts, 4, 'a failed cold round re-probes at the short cold interval')
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(attempts, 7, 'the recovering round succeeds (glm plan + glm usage + copilot)')
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
  const service = createQuotaService(context, { fetchImpl, now: () => 1_800_000_000_000, pollIntervalSec: 60, coldRetryMs: 5_000 })
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
