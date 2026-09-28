import { credentialKey, credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { buildCopilotProbe, buildGlmProbe, parseCopilotUser, parseGlmPlan } from './core/adapters.mjs'
import {
  DEFAULT_POLL_INTERVAL_SEC,
  MAX_POLL_INTERVAL_SEC,
  MIN_POLL_INTERVAL_SEC,
  PROBE_TIMEOUT_MS,
  PROVIDER_IDS,
  ROUTES,
} from './shared.mjs'
import { isPairedOrLoopbackAllowed, isSameOriginRequest } from './access.mjs'

export const name = 'quota-watch'
export const inject = ['webServer', 'settings', 'credentials']

const COPILOT_CREDENTIAL_KEY = credentialKey('llm-pi-ai', PROVIDER_IDS.copilot)
const GLM_PROVIDER_IDS = [
  PROVIDER_IDS.glmDomestic,
  PROVIDER_IDS.glmInternational,
  PROVIDER_IDS.glmInternationalLegacy,
]

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function readPiAiProviders(ctx) {
  try {
    const descriptions = ctx.settings?.describe?.()
    if (!Array.isArray(descriptions)) return {}
    const section = descriptions.find((entry) => entry?.ns === 'llm-pi-ai')
    const value = section?.value ?? section?.user
    return asRecord(value?.providers) ?? {}
  } catch {
    return {}
  }
}

function configuredGlmProvider(ctx) {
  const providers = readPiAiProviders(ctx)
  return GLM_PROVIDER_IDS.find((provider) => asRecord(providers[provider]) !== undefined)
}

/** Resolve the current GLM key reference anew for each probe. */
export async function resolveGlmCredential(ctx, provider) {
  const profile = asRecord(readPiAiProviders(ctx)[provider])
  const apiKeyEnv = profile?.apiKeyEnv
  if (typeof apiKeyEnv !== 'string' || !isCredentialRefName(apiKeyEnv)) return undefined
  try {
    const resolved = await ctx.credentials.resolve(credentialRef(apiKeyEnv))
    return typeof resolved?.value === 'string' && resolved.value !== '' ? resolved.value : undefined
  } catch {
    return undefined
  }
}

/** Read only the original GitHub OAuth token needed by /copilot_internal/user. */
export async function resolveCopilotOAuthToken(ctx) {
  try {
    const record = await ctx.credentials.readRecord(COPILOT_CREDENTIAL_KEY)
    if (record?.kind !== 'grant') return undefined
    const payload = asRecord(record.payload)
    if (payload?.type !== 'oauth') return undefined
    return typeof payload.refresh === 'string' && payload.refresh !== '' ? payload.refresh : undefined
  } catch {
    return undefined
  }
}

function resolvePollInterval(value) {
  const parsed = Number(value)
  const seconds = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_POLL_INTERVAL_SEC
  return Math.max(MIN_POLL_INTERVAL_SEC, Math.min(MAX_POLL_INTERVAL_SEC, seconds))
}

function initialProvider(key, displayName) {
  return { key, displayName, status: 'loading', credential: 'unknown' }
}

function safeProbeError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return '请求超时'
  if (Number.isInteger(error?.status)) return `HTTP ${error.status}`
  if (error?.code === 'UNRECOGNIZED_RESPONSE') return '服务商响应格式无法识别'
  return '探测失败'
}

function responseJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

function methodAllowed(req, res, method) {
  if (req.method === method) return true
  responseJson(res, 405, { ok: false, error: 'method not allowed' })
  return false
}

function requestAllowed(ctx, req, res) {
  if (isPairedOrLoopbackAllowed(ctx, req) && isSameOriginRequest(req)) return true
  responseJson(res, 403, { ok: false, error: 'forbidden' })
  return false
}

export function createQuotaService(ctx, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const pollIntervalSec = resolvePollInterval(options.pollIntervalSec)
  const providers = new Map([
    ['glm', initialProvider('glm', 'GLM Coding Plan')],
    ['copilot', initialProvider('copilot', 'GitHub Copilot')],
  ])
  let updatedAt
  let pollPromise
  let timer
  let disposed = false

  function view() {
    return {
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      providers: ['glm', 'copilot'].map((key) => {
        const provider = providers.get(key)
        return {
          key: provider.key,
          displayName: provider.displayName,
          status: provider.status,
          credential: provider.credential,
          ...(provider.updatedAt !== undefined ? { updatedAt: provider.updatedAt } : {}),
          ...(provider.checkedAt !== undefined ? { checkedAt: provider.checkedAt } : {}),
          ...(provider.error !== undefined ? { error: provider.error } : {}),
          ...(provider.plan !== undefined ? { plan: provider.plan } : {}),
          ...(provider.quota !== undefined ? { quota: provider.quota } : {}),
        }
      }),
    }
  }

  function markMissing(key, displayName) {
    providers.set(key, {
      key,
      displayName,
      status: 'missing',
      credential: 'none',
      checkedAt: now(),
    })
  }

  function markSuccess(key, displayName, payload) {
    const at = now()
    providers.set(key, {
      key,
      displayName,
      status: 'ready',
      credential: 'configured',
      updatedAt: at,
      checkedAt: at,
      ...payload,
    })
  }

  function markFailure(key, displayName, error) {
    const previous = providers.get(key)
    const checkedAt = now()
    const hasLastGood = previous?.status === 'ready' || previous?.status === 'stale'
    providers.set(key, {
      ...(hasLastGood ? previous : { key, displayName, credential: 'configured' }),
      status: hasLastGood ? 'stale' : 'error',
      checkedAt,
      error: safeProbeError(error),
    })
  }

  async function fetchBody(spec) {
    const headers = new Headers(spec.headers)
    headers.set('accept-encoding', 'identity')
    const response = await fetchImpl(spec.url, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = new Error()
      error.status = response.status
      throw error
    }
    return { status: response.status, body }
  }

  async function probeGlm() {
    const provider = configuredGlmProvider(ctx)
    if (provider === undefined) {
      markMissing('glm', 'GLM Coding Plan')
      return
    }
    const apiKey = await resolveGlmCredential(ctx, provider)
    if (apiKey === undefined) {
      markMissing('glm', 'GLM Coding Plan')
      return
    }
    try {
      const spec = buildGlmProbe({ provider, apiKey })
      if (spec === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const { status, body } = await fetchBody(spec)
      const plan = parseGlmPlan(status, body)
      if (plan === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      markSuccess('glm', 'GLM Coding Plan', { plan })
    } catch (error) {
      markFailure('glm', 'GLM Coding Plan', error)
    }
  }

  async function probeCopilot() {
    const githubOAuthToken = await resolveCopilotOAuthToken(ctx)
    if (githubOAuthToken === undefined) {
      markMissing('copilot', 'GitHub Copilot')
      return
    }
    try {
      const spec = buildCopilotProbe({ githubOAuthToken })
      if (spec === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const { status, body } = await fetchBody(spec)
      const quota = parseCopilotUser(status, body)
      if (quota === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      markSuccess('copilot', 'GitHub Copilot', { quota })
    } catch (error) {
      markFailure('copilot', 'GitHub Copilot', error)
    }
  }

  function refresh() {
    if (pollPromise !== undefined) return pollPromise
    if (disposed) return Promise.resolve(view())
    pollPromise = Promise.all([probeGlm(), probeCopilot()])
      .then(() => {
        updatedAt = now()
        return view()
      })
      .finally(() => { pollPromise = undefined })
    return pollPromise
  }

  function schedule(delayMs) {
    if (disposed) return
    timer = setTimeout(async () => {
      timer = undefined
      await refresh()
      schedule(pollIntervalSec * 1000)
    }, delayMs)
    timer.unref?.()
  }

  return {
    overview: view,
    refresh,
    start() {
      if (disposed || timer !== undefined) return
      schedule(2_000)
    },
    stop() {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
    pollIntervalSec,
  }
}

export function makeOverviewRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.overview,
    handler: (req, res) => {
      if (!requestAllowed(ctx, req, res) || !methodAllowed(req, res, 'GET')) return
      responseJson(res, 200, service.overview())
    },
  }
}

export function makeRefreshRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.refresh,
    handler: async (req, res) => {
      if (!requestAllowed(ctx, req, res) || !methodAllowed(req, res, 'POST')) return
      try {
        await service.refresh()
        responseJson(res, 200, service.overview())
      } catch {
        responseJson(res, 500, { ok: false, error: 'refresh failed' })
      }
    },
  }
}

export function apply(ctx, config = {}) {
  const service = createQuotaService(ctx, { pollIntervalSec: config.pollIntervalSec })
  const disposers = [
    ctx.webServer.register(makeOverviewRoute(ctx, service)),
    ctx.webServer.register(makeRefreshRoute(ctx, service)),
  ]
  service.start()
  ctx.effect(() => () => {
    service.stop()
    for (const dispose of disposers) {
      try { dispose() } catch { /* Route fiber may already be down. */ }
    }
  }, 'dsh-quota-watch: runtime')
}
