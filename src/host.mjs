import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { credentialKey, credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { buildCopilotProbe, buildGlmProbe, buildGlmUsageProbe, parseCopilotUser, parseGlmPlan, parseGlmUsage, usageDayWindow } from './core/adapters.mjs'
import {
  buildResetListSpec,
  buildResetUseSpec,
  normalizeResetType,
  parseResetCards,
  parseResetUseResult,
  pickResetCard,
  publicResetCards,
  resetWindow,
  RESET_TIMEOUT_MS,
} from './core/reset.mjs'
import { retireLegacyAutoResetSettings } from './core/legacy-auto-settings.mjs'
import { createManualOutcomeJournal } from './core/manual-outcome.mjs'
import {
  DEFAULT_POLL_INTERVAL_SEC,
  IDLE_AFTER_POLL_INTERVALS,
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
/** How long a continuous GLM usage failure may keep showing old numbers before the client must degrade. */
const GLM_USAGE_FAILURE_STALE_MS = 5 * 60_000
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

/** Classify a probe failure into a user-facing message and a stable kind for the client. */
export function classifyProbeError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { message: '请求超时', kind: 'network' }
  if (Number.isInteger(error?.status)) {
    if (error.status === 401 || error.status === 403) return { message: `HTTP ${error.status}`, kind: 'auth' }
    return { message: `HTTP ${error.status}`, kind: 'server' }
  }
  if (error?.code === 'UNRECOGNIZED_RESPONSE') return { message: '服务商响应格式无法识别', kind: 'parse' }
  const causeCode = String(error?.cause?.code ?? '')
  if (/^[A-Z0-9_]{3,60}$/.test(causeCode)) return { message: `探测失败 (${causeCode})`, kind: 'network' }
  return { message: '探测失败', kind: 'network' }
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

/** The access fence plus the idle-pause watcher stamp: any allowed request
 * proves a browser is watching, so it feeds lastClientSeenAt. The call is
 * defensive because route tests may pass minimal service doubles. */
function requestAllowedAndSeen(ctx, req, res, service) {
  if (!requestAllowed(ctx, req, res)) return false
  service?.noteClientSeen?.()
  return true
}

/**
 * Where the legacy automatic-use switches persisted. The start()-time one-shot
 * retirement keeps this file overwritten all-off, so a rollback to an old
 * package cannot silently revive the authorization.
 */
export function resolveAutoResetSettingsPath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'glm-quota-reset', 'settings.json')
}

/** Where the single-entry manual-outcome journal lives (no credentials inside). */
export function resolveManualOutcomePath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'glm-quota-reset', 'manual-outcome.json')
}

export function createQuotaService(ctx, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const pollIntervalSec = resolvePollInterval(options.pollIntervalSec)
  // The legacy switches file is only ever touched by the one-shot start()-time
  // retirement below; the poll itself is read-only. Tests must inject an
  // isolated path so the retirement can never write the real $DSH_HOME.
  const settingsPath = options.legacyAutoSettingsPath ?? resolveAutoResetSettingsPath()
  const manualOutcomePath = options.manualOutcomePath ?? resolveManualOutcomePath()
  // Single-entry write-ahead journal for one manual card attempt; every state
  // transition is durable before anyone is told anything.
  const manualJournal = createManualOutcomeJournal(manualOutcomePath)
  const providers = new Map([
    ['glm', initialProvider('glm', 'GLM Coding Plan')],
    ['copilot', initialProvider('copilot', 'GitHub Copilot')],
  ])
  let updatedAt
  let pollPromise
  let timer
  let disposed = false
  let coldAttempts = 0
  let legacyRetirement

  // --- Idle polling pause -----------------------------------------------------
  // The scheduled poll serves browsers only. Once idleAfterMs passes with no
  // request to any plugin route (every allowed route hit stamps
  // lastClientSeenAt), timer fires skip the round entirely; the next client
  // request resumes with a stale-while-revalidate kick. start() stamps once so
  // the boot round always runs (the first client GET then meets data, not
  // 'loading'). An undefined stamp (service built but never started, as in
  // tests) never counts as idle, so direct refresh() calls behave as before.
  const idleAfterMs = options.idleAfterMs ?? pollIntervalSec * 1000 * IDLE_AFTER_POLL_INTERVALS
  let lastClientSeenAt
  let idleActive = false
  const idleNow = () => lastClientSeenAt !== undefined && now() - lastClientSeenAt >= idleAfterMs
  const snapshotStale = () => updatedAt === undefined || now() - updatedAt >= pollIntervalSec * 1000

  /** The usage slice a browser may see: old values survive only while the failure episode is short. */
  function usageView(usage) {
    if (usage === undefined) return undefined
    const tooLong = usage.status !== 'ready'
      && typeof usage.failureSince === 'number'
      && now() - usage.failureSince >= GLM_USAGE_FAILURE_STALE_MS
    return tooLong ? { ...usage, staleTooLong: true } : usage
  }

  function view() {
    return {
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(resetState !== undefined ? { reset: resetView() } : {}),
      ...manualOutcomeView(),
      providers: ['glm', 'copilot'].map((key) => {
        const provider = providers.get(key)
        return {
          key: provider.key,
          displayName: provider.displayName,
          status: provider.status,
          credential: provider.credential,
          ...(provider.providerId !== undefined ? { providerId: provider.providerId } : {}),
          ...(provider.updatedAt !== undefined ? { updatedAt: provider.updatedAt } : {}),
          ...(provider.checkedAt !== undefined ? { checkedAt: provider.checkedAt } : {}),
          ...(provider.error !== undefined ? { error: provider.error } : {}),
          ...(provider.errorKind !== undefined ? { errorKind: provider.errorKind } : {}),
          ...(provider.plan !== undefined ? { plan: provider.plan } : {}),
          ...(provider.quota !== undefined ? { quota: provider.quota } : {}),
          ...(provider.usage !== undefined ? { usage: usageView(provider.usage) } : {}),
        }
      }),
    }
  }

  /** The reset-card slice of the overview: only ever the browser-safe projection. */
  function resetView() {
    if (resetState === undefined) return { status: 'loading' }
    if (resetState.status === 'ready') {
      return {
        status: 'ready',
        cards: publicResetCards(resetState.cards),
        ...(resetState.updatedAt !== undefined ? { updatedAt: resetState.updatedAt } : {}),
        ...(resetState.checkedAt !== undefined ? { checkedAt: resetState.checkedAt } : {}),
      }
    }
    return {
      status: resetState.status,
      ...(resetState.error !== undefined ? { error: resetState.error } : {}),
      ...(resetState.errorKind !== undefined ? { errorKind: resetState.errorKind } : {}),
      ...(resetState.checkedAt !== undefined ? { checkedAt: resetState.checkedAt } : {}),
    }
  }

  /** Log one real state transition; degradations warn, recoveries and missing-credentials inform.
   * Dual-channel: ctx.logger (cordis, ring-buffer only — the host registers no journal
   * exporter) mirrored to console so service stdout lands in journald. */
  function logTransition(key, from, to, detail) {
    if (from === to) return
    const line = `quota-watch: ${key} ${from}→${to}${detail ? ` (${detail})` : ''}`
    const level = to === 'error' || to === 'stale' ? 'warn' : 'info'
    if (level === 'warn') ctx.logger?.warn?.(line)
    else ctx.logger?.info?.(line)
    ;(options.logMirror ?? console)[level]?.(line)
  }

  function logAuto(level, line) {
    ctx.logger?.[level]?.(line)
    ;(options.logMirror ?? console)[level]?.(line)
  }

  function markMissing(key, displayName) {
    const from = providers.get(key)?.status
    providers.set(key, {
      key,
      displayName,
      status: 'missing',
      credential: 'none',
      checkedAt: now(),
    })
    logTransition(key, from, 'missing')
  }

  function markSuccess(key, displayName, payload) {
    const from = providers.get(key)?.status
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
    logTransition(key, from, 'ready')
  }

  function markGlmPlanSuccess(plan, providerId) {
    const previous = providers.get('glm')
    const at = now()
    providers.set('glm', {
      key: 'glm',
      displayName: 'GLM Coding Plan',
      status: 'ready',
      credential: 'configured',
      updatedAt: at,
      checkedAt: at,
      // Which configured route answered (zai-coding-cn / zai / zai-coding): the
      // client gates the domestic-only reset-card section on this field.
      ...(providerId !== undefined ? { providerId } : {}),
      plan,
      ...(previous?.usage !== undefined ? { usage: previous.usage } : {}),
    })
    logTransition('glm', previous?.status, 'ready')
  }

  function markGlmUsageSuccess(usage) {
    const previous = providers.get('glm')
    if (previous === undefined || previous.key !== 'glm') return
    const at = now()
    providers.set('glm', {
      ...previous,
      status: 'ready',
      credential: 'configured',
      updatedAt: at,
      checkedAt: at,
      // A fresh ready block: the previous episode's failureSince (if any) and
      // any projected staleTooLong end here by construction.
      usage: { status: 'ready', updatedAt: at, ...usage },
    })
    logTransition('glm-usage', previous.usage?.status ?? 'loading', 'ready')
  }

  function markGlmUsageFailure(error) {
    const previous = providers.get('glm')
    if (previous === undefined || previous.key !== 'glm') return
    const lastGood = previous.usage?.status === 'ready' || previous.usage?.status === 'stale'
      ? previous.usage
      : undefined
    const { message, kind } = classifyProbeError(error)
    const status = lastGood !== undefined ? 'stale' : 'error'
    // One timestamp per continuous failure episode: later failing rounds keep
    // the FIRST failure's stamp so elapsed time can gate client degradation
    // without waiting for another probe round.
    const failureSince = typeof previous.usage?.failureSince === 'number' && previous.usage.status !== 'ready'
      ? previous.usage.failureSince
      : now()
    providers.set('glm', {
      ...previous,
      checkedAt: now(),
      usage: {
        ...(lastGood !== undefined ? lastGood : {}),
        status,
        error: message,
        errorKind: kind,
        failureSince,
      },
    })
    logTransition('glm-usage', previous.usage?.status ?? 'loading', status, message)
  }

  function markFailure(key, displayName, error) {
    const previous = providers.get(key)
    const checkedAt = now()
    const hasLastGood = previous?.status === 'ready' || previous?.status === 'stale'
    const { message, kind } = classifyProbeError(error)
    const status = hasLastGood ? 'stale' : 'error'
    providers.set(key, {
      ...(hasLastGood ? previous : { key, displayName, credential: 'configured' }),
      status,
      checkedAt,
      error: message,
      errorKind: kind,
    })
    logTransition(key, previous?.status, status, message)
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

  /**
   * POST a JSON body for the card-consuming reset call.
   * Unlike fetchBody this never throws on a non-2xx: the reset parser turns any
   * status into a business result, because a refused reset is a normal outcome the
   * panel must show rather than a transport failure.
   */
  async function postJson(spec) {
    const headers = new Headers(spec.headers)
    const response = await fetchImpl(spec.url, {
      method: 'POST',
      headers,
      body: spec.body,
      signal: AbortSignal.timeout(RESET_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => undefined)
    return { status: response.status, body }
  }

  async function probeGlm() {
    const provider = configuredGlmProvider(ctx)
    if (provider === undefined) {
      markMissing('glm', 'GLM Coding Plan')
      return false
    }
    const apiKey = await resolveGlmCredential(ctx, provider)
    if (apiKey === undefined) {
      markMissing('glm', 'GLM Coding Plan')
      return false
    }
    try {
      const spec = buildGlmProbe({ provider, apiKey })
      if (spec === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const { status, body } = await fetchBody(spec)
      const plan = parseGlmPlan(status, body)
      if (plan === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      markGlmPlanSuccess(plan, provider)
    } catch (error) {
      markFailure('glm', 'GLM Coding Plan', error)
      return false
    }
    await probeGlmUsage(provider, apiKey)
    return true
  }

  async function probeGlmUsage(provider, apiKey) {
    const window = usageDayWindow(new Date(now()))
    if (window === undefined) return
    try {
      const spec = buildGlmUsageProbe({ provider, apiKey, startTime: window.startTime, endTime: window.endTime })
      if (spec === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const { status, body } = await fetchBody(spec)
      const usage = parseGlmUsage(status, body)
      if (usage === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      markGlmUsageSuccess(usage)
    } catch (error) {
      markGlmUsageFailure(error)
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

  // --- Reset cards -----------------------------------------------------------

  function refresh(forceCards = false) {
    // Idle pause: a timer-driven round with no recent client serves the cache
    // and skips every upstream probe. A forced refresh is exempt, and any
    // client-driven path has just stamped lastClientSeenAt, so it never lands
    // here (one check covers both callers).
    if (forceCards !== true && idleNow()) {
      if (!idleActive) {
        idleActive = true
        logAuto('info', `quota-watch: idle — no client request for ${Math.round(idleAfterMs / 1000)}s, scheduled poll paused`)
      }
      return Promise.resolve(view())
    }
    if (pollPromise !== undefined) {
      // A manual refresh must still re-list cards when it overlaps a scheduled
      // round whose ten-minute gate skipped the list.
      if (forceCards !== true) return pollPromise
      return pollPromise.then(async () => {
        if (!disposed) await probeResetCards(true)
        return view()
      })
    }
    if (disposed) return Promise.resolve(view())
    pollPromise = Promise.all([probeGlm(), probeCopilot()])
      .then(async () => {
        updatedAt = now()
        // The poll round is strictly read-only since the automatic-use
        // retirement: no poll path may ever reach the card-consuming endpoint.
        await probeResetCards(forceCards === true)
        return view()
      })
      .finally(() => { pollPromise = undefined })
    return pollPromise
  }

  // --- Reset cards -----------------------------------------------------------
  // Card state is independent of the quota probes: poll it on its own slow
  // clock, as well as on demand and before spending. A failed list never blanks
  // the provider rows or turns a known card count into an authoritative zero.
  let resetState
  let resetSpendInFlight = false
  let resetProbePromise
  const RESET_CARDS_POLL_INTERVAL_MS = 10 * 60_000

  async function probeResetCards(force = false) {
    if (configuredGlmProvider(ctx) !== PROVIDER_IDS.glmDomestic || resetSpendInFlight) return
    if (resetProbePromise !== undefined) return resetProbePromise
    if (!force && resetState?.checkedAt !== undefined
      && now() - resetState.checkedAt < RESET_CARDS_POLL_INTERVAL_MS) return
    const probe = (async () => {
      try {
        await listResetCards()
      } catch (error) {
        // Even unexpected credential failures cannot break the quota poll round.
        const { message, kind } = classifyProbeError(error)
        resetState = { status: 'error', error: message, errorKind: kind, checkedAt: now() }
      }
    })()
    resetProbePromise = probe
    try { await probe } finally { resetProbePromise = undefined }
  }

  /** Resolve the GLM provider + key, or report why no reset can be attempted. */
  async function resetCredential() {
    const provider = configuredGlmProvider(ctx)
    if (provider === undefined) return { error: 'no-provider', message: '未配置 GLM provider' }
    // The reset API contract is verified only for domestic personal plans; never
    // send an international key to the domestic write endpoint, even via direct HTTP.
    if (provider !== PROVIDER_IDS.glmDomestic) return { error: 'unsupported-provider', message: '仅支持国内站个人版 GLM provider' }
    const apiKey = await resolveGlmCredential(ctx, provider)
    if (apiKey === undefined) return { error: 'no-credential', message: '未找到 GLM API Key' }
    return { provider, apiKey }
  }

  /** Fetch the live available cards. The poll clock gates only the background
   * probe; an explicit list or spend always re-reads upstream. */
  async function listResetCards() {
    const credential = await resetCredential()
    if (credential.error !== undefined) {
      resetState = { status: 'error', error: credential.message, errorKind: 'auth', checkedAt: now() }
      return { ok: false, error: credential.error, message: credential.message }
    }
    try {
      const spec = buildResetListSpec({ apiKey: credential.apiKey })
      if (spec === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const { status, body } = await fetchBody(spec)
      const cards = parseResetCards(status, body)
      if (cards === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const at = now()
      resetState = { status: 'ready', cards, updatedAt: at, checkedAt: at }
      return { ok: true, cards: publicResetCards(cards), updatedAt: at }
    } catch (error) {
      const { message, kind } = classifyProbeError(error)
      resetState = { status: 'error', error: message, errorKind: kind, checkedAt: now() }
      return { ok: false, error: 'list-failed', message }
    }
  }

  /**
   * The browser-safe manual-outcome projection: any unresolved record — in-flight
   * included, which the browser can only treat as unknown — shows up as a minimal
   * receipt, and unreadable storage disables manual spending. Never credentials.
   */
  function manualOutcomeView() {
    try {
      const record = manualJournal.read()
      if (record === null) return {}
      return {
        manualOutcome: {
          attemptId: record.attemptId,
          resetType: record.resetType,
          startedAt: record.startedAt,
          status: record.status === 'in-flight' ? 'unknown' : record.status,
        },
      }
    } catch {
      return { manualOutcomeError: 'storage-unavailable' }
    }
  }

  /** A new manual consumption may not start while any outcome record is unresolved or unreadable. */
  function manualConsumptionGuard() {
    try {
      const record = manualJournal.read()
      if (record === null) return undefined
      return {
        ok: false,
        error: 'manual-outcome-unresolved',
        message: '上一次手动用卡结果未核实，请先在面板确认后再试',
        attemptId: record.attemptId,
        manualOutcome: {
          attemptId: record.attemptId,
          resetType: record.resetType,
          startedAt: record.startedAt,
          status: record.status === 'in-flight' ? 'unknown' : record.status,
        },
      }
    } catch {
      return { ok: false, error: 'storage-unavailable', message: '手动用卡暂不可用：结果记录无法读取' }
    }
  }

  /**
   * Spend one reset card. The caller must have shown the user which card will be
   * used; this function re-lists first so the choice is made against live state,
   * then re-probes the quota so the panel reflects the reset immediately.
   */
  async function useResetCard(args = {}) {
    if (resetSpendInFlight) return { ok: false, error: 'busy', message: '重置操作进行中，请稍后重试' }
    const guard = manualConsumptionGuard()
    if (guard !== undefined) return guard
    resetSpendInFlight = true
    try {
      // A spend re-lists against live state; wait for any cosmetic background
      // read first so its older result cannot overwrite the post-spend wallet.
      if (resetProbePromise !== undefined) await resetProbePromise
      return await performResetCard(args)
    } finally {
      resetSpendInFlight = false
    }
  }

  async function performResetCard({ resetType, recordId } = {}) {
    const type = normalizeResetType(resetType)
    if (type === undefined) return { ok: false, error: 'invalid-type', message: '未知的重置类型' }
    const credential = await resetCredential()
    if (credential.error !== undefined) return { ok: false, error: credential.error, message: credential.message }

    let cards
    try {
      const spec = buildResetListSpec({ apiKey: credential.apiKey })
      if (spec === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      const { status, body } = await fetchBody(spec)
      cards = parseResetCards(status, body)
      if (cards === undefined) throw Object.assign(new Error(), { code: 'UNRECOGNIZED_RESPONSE' })
      resetState = { status: 'ready', cards, updatedAt: now(), checkedAt: now() }
    } catch (error) {
      const { message, kind } = classifyProbeError(error)
      resetState = { status: 'error', error: message, errorKind: kind, checkedAt: now() }
      return { ok: false, error: 'list-failed', message }
    }

    const picked = pickResetCard(cards, type, recordId)
    if (picked.error !== undefined) {
      const messages = {
        'no-card': type === 'WEEK' ? '没有可用的每周重置卡' : '没有可用的 5 小时重置卡',
        'card-not-available': '该重置卡已不可用，请刷新后重试',
        'invalid-record': '重置卡编号无效',
        'invalid-type': '未知的重置类型',
      }
      return { ok: false, error: picked.error, message: messages[picked.error] ?? '无法选择重置卡' }
    }

    const card = picked.card
    const requestId = globalThis.crypto?.randomUUID?.()
    if (requestId === undefined) return { ok: false, error: 'no-uuid', message: '无法生成请求标识' }
    const spec = buildResetUseSpec({
      apiKey: credential.apiKey,
      resetType: type,
      recordId: card.recordId,
      grantType: card.grantType,
      requestId,
    })
    if (spec === undefined) return { ok: false, error: 'invalid-spec', message: '重置请求参数无效' }

    // Write-ahead: durably record the attempt BEFORE the irreversible POST.
    // A failed or refused journal write means no POST is sent at all.
    let attempt
    try {
      attempt = manualJournal.begin({ resetType: type })
    } catch {
      return { ok: false, error: 'storage-unavailable', message: '手动用卡暂不可用：未能持久记录本次尝试，已阻止消费' }
    }

    // Only HTTP 200 with an explicit boolean `success` is a known result.
    // Timeouts, non-200 answers, unparseable bodies and unclear flags stay
    // unknown: the card may or may not have been consumed upstream.
    let knownOutcome
    let message
    try {
      const { status, body } = await postJson(spec)
      if (status === 200 && typeof body?.success === 'boolean') {
        const parsed = parseResetUseResult(status, body)
        knownOutcome = parsed.ok ? 'success' : 'refused'
        message = parsed.message
      } else {
        message = '重置结果未知；请先核实卡数与额度，再决定是否重试'
      }
    } catch {
      message = '重置结果未知；请先核实卡数与额度，再决定是否重试'
    }

    // Persist the durable outcome BEFORE answering the browser: a known result
    // becomes a receipt that survives a lost host→browser response, an unclear
    // one becomes unknown. A failed write keeps the on-disk in-flight record,
    // which stays locked and presents as unknown.
    let stored
    try {
      stored = knownOutcome === undefined
        ? manualJournal.markUnknown(attempt.attemptId)
        : manualJournal.finishKnown(attempt.attemptId, knownOutcome)
    } catch { stored = undefined }

    const outcomeProjection = (status) => ({
      attemptId: attempt.attemptId,
      resetType: attempt.resetType,
      startedAt: attempt.startedAt,
      status: status === 'in-flight' ? 'unknown' : status,
    })

    if (stored === undefined) {
      // The outcome could not be durably recorded: never present this as a
      // certain result, and keep the wallet locked via the surviving record.
      return {
        ok: false,
        error: 'request-unknown',
        message: '重置结果未知；请先核实卡数与额度，再决定是否重试',
        attemptId: attempt.attemptId,
      }
    }
    if (knownOutcome === undefined) {
      return {
        ok: false,
        error: 'request-unknown',
        message,
        attemptId: attempt.attemptId,
        manualOutcome: outcomeProjection(stored.status),
      }
    }
    if (knownOutcome === 'refused') {
      // A refusal can mean the card was consumed by another client; re-list so the
      // panel stops offering a card that no longer exists.
      await listResetCards()
      return {
        ok: false,
        error: 'rejected',
        message,
        attemptId: attempt.attemptId,
        manualOutcome: outcomeProjection(stored.status),
      }
    }

    const cleared = resetWindow(type)

    // The card is gone now: refresh both the card list and the quota windows so the
    // panel shows the post-reset state without a manual reload.
    const after = await listResetCards()
    await probeGlm()
    updatedAt = now()
    // A direct log line: logTransition dedupes on state transition, and a manual
    // reset leaves every provider state unchanged, so the spend would go unlogged.
    const spendLine = `quota-watch: reset card spent (${type} record=${card.recordId}${cleared?.alsoClears ? `, also clears ${cleared.alsoClears}` : ''})`
    ctx.logger?.info?.(spendLine)
    ;(options.logMirror ?? console).info?.(spendLine)
    return {
      ok: true,
      message,
      resetType: type,
      ...(cleared !== undefined ? { window: cleared.window } : {}),
      recordId: card.recordId,
      attemptId: attempt.attemptId,
      manualOutcome: outcomeProjection(stored.status),
      ...(after.ok ? { cards: after.cards } : {}),
      quota: view().providers.find((provider) => provider.key === 'glm'),
    }
  }

  /**
   * The user says they verified the outcome against the provider: clear an
   * unknown record — but only after a fresh plan + card-list recheck succeeded,
   * so the acknowledgement is grounded in current upstream answers. A failed
   * recheck, a stale id or an in-flight POST keeps the record and the lock.
   */
  async function acknowledgeManualOutcome({ attemptId } = {}) {
    let record
    try {
      record = manualJournal.read()
    } catch {
      return { ok: false, error: 'storage-unavailable', message: '手动用卡暂不可用：结果记录无法读取' }
    }
    if (record === null) return { ok: false, error: 'no-record', message: '没有待核实的手动用卡记录' }
    if (record.attemptId !== attemptId) return { ok: false, error: 'attempt-mismatch', message: '核实标识不匹配' }
    if (record.status !== 'unknown') {
      return { ok: false, error: 'invalid-state', message: '该记录当前不接受用户核实' }
    }
    const planReady = await probeGlm()
    if (planReady !== true) {
      return { ok: false, error: 'verify-failed', message: '核实失败：无法重新读取 GLM 计划状态，记录保持锁定' }
    }
    const listed = await listResetCards()
    if (listed.ok !== true) {
      // Surface the truthful reason (e.g. an international provider answering
      // 仅支持国内站个人版) instead of a generic wallet error; the record and
      // the lock stay put either way.
      return {
        ok: false,
        error: 'verify-failed',
        message: `核实失败：${listed.message ?? '无法重新读取重置卡列表'}，记录保持锁定`,
      }
    }
    try {
      manualJournal.acknowledgeUnknown(attemptId)
    } catch {
      return { ok: false, error: 'storage-unavailable', message: '核实结果写入失败，记录保持锁定' }
    }
    return { ok: true }
  }

  /** The browser confirmed it received the known outcome: clear that receipt — nothing else, no re-query. */
  function acknowledgeKnownReceipt({ attemptId } = {}) {
    try {
      manualJournal.acknowledgeReceipt(attemptId)
      return { ok: true }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : ''
      if (code === 'attempt-mismatch' || code === 'no-record') {
        return { ok: false, error: 'attempt-mismatch', message: '送达确认标识不匹配' }
      }
      if (code === 'invalid-transition') {
        return { ok: false, error: 'invalid-state', message: '该记录当前不接受送达确认' }
      }
      return { ok: false, error: 'storage-unavailable', message: '送达确认写入失败，记录保持锁定' }
    }
  }

  /** Any allowed route hit: stamp the watcher clock, and — if the snapshot
   * went stale during a pause — kick a background round. Stale-while-
   * revalidate: the caller serves the cached view immediately and never waits
   * for the kick. Returns the kicked round's promise for tests. */
  function noteClientSeen() {
    const resuming = idleActive
    lastClientSeenAt = now()
    idleActive = false
    if (resuming) logAuto('info', 'quota-watch: client request — scheduled poll resumed')
    if (disposed || pollPromise !== undefined || !snapshotStale()) return undefined
    return refresh()
  }

  function schedule(delayMs) {
    if (disposed) return
    timer = setTimeout(async () => {
      timer = undefined
      await refresh()
      // Cold-start retry with capped exponential backoff: until at least one
      // provider has reached ready/stale, a failed or still-loading round re-arms
      // at coldRetryMs, doubling per consecutive retryable round and capping at
      // the normal cadence — a desktop cold start with a slow network still gets
      // fast early retries, but a persistently broken state (e.g. a rejected
      // credential) can no longer hammer the upstream every few seconds forever.
      // Any non-retryable round (success, or all-missing) resets the counter, so
      // a later cold phase restarts from the short interval. (updatedAt alone
      // cannot signal "cold": refresh() stamps it even when every probe failed.)
      const states = [...providers.values()].map((provider) => provider.status)
      const retryable = states.some((status) => status === 'loading' || status === 'error')
        && states.every((status) => status !== 'ready' && status !== 'stale')
      if (retryable) coldAttempts += 1
      else coldAttempts = 0
      schedule(retryable
        ? Math.min((options.coldRetryMs ?? 5_000) * 2 ** (coldAttempts - 1), pollIntervalSec * 1000)
        : pollIntervalSec * 1000)
    }, delayMs)
    timer.unref?.()
  }

  return {
    overview: view,
    refresh,
    noteClientSeen,
    listResetCards,
    useResetCard,
    acknowledgeManualOutcome,
    acknowledgeKnownReceipt,
    start() {
      if (disposed || timer !== undefined) return
      // One-time retirement of the legacy automatic-use switches, BEFORE any
      // poll can run: both saved switches are persistently forced off so a
      // rollback to an old package cannot silently revive the authorization.
      // A failed write only reports the rollback risk — this host has no
      // automatic spending path either way, so it must not block startup.
      legacyRetirement = retireLegacyAutoResetSettings(settingsPath)
      if (legacyRetirement.ok === true) {
        logAuto('info', 'quota-watch: legacy auto-reset switches forced off (glm-quota-reset/settings.json)')
      } else {
        logAuto('warn', `quota-watch: could not overwrite the legacy auto-reset settings (${legacyRetirement.error}); a rollback to an old version could revive its switches, but this host has no automatic spending path`)
      }
      // Boot counts as watched for the first idle window: the initial round
      // always runs, so the first client GET meets data instead of 'loading'.
      lastClientSeenAt = now()
      // Routes register synchronously in apply() before start(), so probing
      // immediately is safe; the legacy 2s delay only padded the cold start.
      schedule(0)
    },
    stop() {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
    legacyAutoRetirement: () => legacyRetirement,
    pollIntervalSec,
  }
}

export function makeOverviewRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.overview,
    handler: (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'GET')) return
      responseJson(res, 200, service.overview())
    },
  }
}

export function makeRefreshRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.refresh,
    handler: async (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'POST')) return
      try {
        await service.refresh(true)
        responseJson(res, 200, service.overview())
      } catch {
        responseJson(res, 500, { ok: false, error: 'refresh failed' })
      }
    },
  }
}

/** GET the available reset cards. Read-only: never spends a card. */
export function makeResetCardsRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.resetCards,
    handler: async (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'GET')) return
      try {
        const result = await service.listResetCards()
        responseJson(res, result.ok ? 200 : 502, result)
      } catch {
        responseJson(res, 500, { ok: false, error: 'list-failed', message: '读取重置卡失败' })
      }
    },
  }
}

/**
 * Spend one reset card.
 * This route consumes a real, finite subscription entitlement, so it requires POST
 * (no prefetch, link, or image can trigger it) and the same origin+pairing fence as
 * every other route. The body is `{ resetType, recordId? }`; omitting `recordId`
 * spends the earliest-expiring available card of that type.
 */
export function makeResetUseRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.resetUse,
    handler: async (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'POST')) return
      const payload = await readJsonBody(req)
      if (payload === undefined) {
        responseJson(res, 400, { ok: false, error: 'invalid-body', message: '请求体不是合法 JSON' })
        return
      }
      try {
        const result = await service.useResetCard(payload)
        responseJson(res, result.ok ? 200 : 502, result)
      } catch {
        responseJson(res, 500, { ok: false, error: 'use-failed', message: '重置请求失败' })
      }
    },
  }
}

/** Map a failed acknowledgement to a specific HTTP status; the record stays locked either way. */
function acknowledgementStatus(error) {
  if (error === 'verify-failed' || error === 'no-provider' || error === 'unsupported-provider'
    || error === 'no-credential' || error === 'list-failed') return 502
  if (error === 'storage-unavailable') return 503
  return 409
}

/**
 * The user-verified acknowledgement of an unknown manual outcome.
 * POST-only with the same origin+pairing fence as the spend route: nothing a
 * prefetch, link or image can trigger may clear a spend lock. The body is
 * `{ attemptId }`; an unknown clears only after a fresh domestic plan and card
 * list recheck succeeded.
 */
export function makeResetAcknowledgeRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.resetAcknowledge,
    handler: async (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'POST')) return
      const payload = await readJsonBody(req)
      if (payload === undefined) {
        responseJson(res, 400, { ok: false, error: 'invalid-body', message: '请求体不是合法 JSON' })
        return
      }
      try {
        const result = await service.acknowledgeManualOutcome(payload)
        responseJson(res, result.ok === true ? 200 : acknowledgementStatus(result.error), result)
      } catch {
        responseJson(res, 500, { ok: false, error: 'acknowledge-failed', message: '核实请求失败' })
      }
    },
  }
}

/**
 * The browser's delivery confirmation for a known manual outcome (success or
 * refusal). POST-only, same fence; the body is `{ attemptId }` and only the
 * currently stored known receipt with that id can be cleared. No upstream
 * request is made: the outcome is already known and durable.
 */
export function makeResetReceiptRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.resetReceipt,
    handler: async (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'POST')) return
      const payload = await readJsonBody(req)
      if (payload === undefined) {
        responseJson(res, 400, { ok: false, error: 'invalid-body', message: '请求体不是合法 JSON' })
        return
      }
      try {
        const result = service.acknowledgeKnownReceipt(payload)
        responseJson(res, result.ok === true ? 200 : acknowledgementStatus(result.error), result)
      } catch {
        responseJson(res, 500, { ok: false, error: 'receipt-failed', message: '送达确认失败' })
      }
    },
  }
}

const RETIRED_AUTO_RESET_PATH = '/api/dsh-quota-watch/auto-reset'

/**
 * Retired automatic-authorization endpoint: a tombstone for old clients.
 * A POST returns 410 without reading the body, touching any setting or spending
 * anything — no code path that could re-arm automatic spending exists anymore.
 * The path is a private host constant precisely so it never re-enters the
 * shared client contract in src/shared.mjs.
 */
export function makeRetiredAutoResetRoute(ctx, service) {
  return {
    kind: 'exact',
    path: RETIRED_AUTO_RESET_PATH,
    handler: async (req, res) => {
      if (!requestAllowedAndSeen(ctx, req, res, service) || !methodAllowed(req, res, 'POST')) return
      responseJson(res, 410, { ok: false, error: 'retired', message: '自动用卡功能已退役；重置卡请在面板手动确认使用' })
    },
  }
}

/** Read a bounded JSON request body; undefined means malformed or oversized. */
async function readJsonBody(req, limitBytes = 8 * 1024) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > limitBytes) return undefined
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.trim() === '') return {}
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx, config = {}) {
  const service = createQuotaService(ctx, { pollIntervalSec: config.pollIntervalSec })
  const disposers = [
    ctx.webServer.register(makeOverviewRoute(ctx, service)),
    ctx.webServer.register(makeRefreshRoute(ctx, service)),
    ctx.webServer.register(makeResetCardsRoute(ctx, service)),
    ctx.webServer.register(makeResetUseRoute(ctx, service)),
    ctx.webServer.register(makeResetAcknowledgeRoute(ctx, service)),
    ctx.webServer.register(makeResetReceiptRoute(ctx, service)),
    ctx.webServer.register(makeRetiredAutoResetRoute(ctx, service)),
  ]
  service.start()
  ctx.effect(() => () => {
    service.stop()
    for (const dispose of disposers) {
      try { dispose() } catch { /* Route fiber may already be down. */ }
    }
  }, 'dsh-quota-watch: runtime')
}
