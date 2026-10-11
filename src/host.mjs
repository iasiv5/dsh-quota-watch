import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { credentialKey, credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { buildCopilotProbe, buildGlmProbe, buildGlmUsageProbe, parseCopilotUser, parseGlmPlan, parseGlmUsage, usageDayWindow } from './core/adapters.mjs'
import {
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
  RESET_TIMEOUT_MS,
  windowKeyForResetType,
} from './core/reset.mjs'
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

/**
 * Where the panel's auto-reset switches persist.
 * These live in a file rather than the browser because the whole point of the
 * feature is to protect long runs with no browser open: a switch stored in
 * localStorage would silently stop working the moment the tab closed.
 */
export function resolveAutoResetSettingsPath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'glm-quota-reset', 'settings.json')
}

/**
 * Read the saved auto-reset switches.
 * Only a genuinely missing file falls back to the profile config. An unreadable
 * or corrupt saved file fails CLOSED to both switches off: otherwise a previously
 * disabled switch could silently revive from an enabled profile default.
 */
export function readAutoResetSettings(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return asRecord(parsed?.autoReset) ?? normalizeAutoResetConfig(undefined)
  } catch (error) {
    return error?.code === 'ENOENT' ? undefined : normalizeAutoResetConfig(undefined)
  }
}

/** Replace the switches atomically; throws so the caller can report a failed write. */
export function writeAutoResetSettings(path, autoReset) {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const tempPath = join(directory, `.quota-reset-${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, `${JSON.stringify({ autoReset }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(tempPath, path)
  } catch (error) {
    try { unlinkSync(tempPath) } catch { /* No temp file when opening failed. */ }
    throw error
  }
}

export function createQuotaService(ctx, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const pollIntervalSec = resolvePollInterval(options.pollIntervalSec)
  const settingsPath = options.autoResetSettingsPath ?? resolveAutoResetSettingsPath()
  // A saved switch wins over the profile config: the panel is the user-facing
  // control, and the profile value is only the initial default.
  const savedAutoReset = readAutoResetSettings(settingsPath)
  let autoResetConfig = normalizeAutoResetConfig(savedAutoReset ?? options.autoReset)
  let autoResetSource = savedAutoReset === undefined ? 'config' : 'saved'
  let autoResetPersistError
  const providers = new Map([
    ['glm', initialProvider('glm', 'GLM Coding Plan')],
    ['copilot', initialProvider('copilot', 'GitHub Copilot')],
  ])
  let updatedAt
  let pollPromise
  let timer
  let disposed = false
  let coldAttempts = 0
  // One guard flag + one backoff stamp per window; `armed` starts true so an
  // install whose quota is already over the threshold at boot gets protected.
  const autoResetArmed = { '5h': true, week: true }
  const autoResetLastAttempt = { '5h': undefined, week: undefined }
  let autoResetEvent

  const AUTO_RESET_WINDOWS = Object.freeze([['5h', 'fiveHour'], ['week', 'week']])

  /** The browser-safe auto-reset projection: config, guards and the last event. */
  function autoResetView() {
    const shape = (windowKey) => {
      const config = autoResetConfigFor(autoResetConfig, windowKey)
      return {
        enabled: config.enabled,
        threshold: config.threshold,
        armed: autoResetArmed[windowKey],
        ...(autoResetLastAttempt[windowKey] !== undefined
          ? { lastAttemptAt: autoResetLastAttempt[windowKey] }
          : {}),
      }
    }
    return {
      fiveHour: shape('5h'),
      week: shape('week'),
      source: autoResetSource,
      ...(autoResetPersistError !== undefined ? { persistError: autoResetPersistError } : {}),
      ...(autoResetEvent !== undefined ? { lastEvent: autoResetEvent } : {}),
    }
  }

  /**
   * Apply switches from the panel and persist them.
   * Enabling a window re-arms it and clears its backoff, because the reason to
   * enable one is usually "we are about to run out right now" — carrying a stale
   * disarm or backoff over from a previous state would silently do nothing.
   * Disabling never touches the guards, but off-then-on deliberately re-arms:
   * treat re-enabling as a new, potentially immediate spending authorization.
   */
  function updateAutoResetConfig(patch) {
    const previous = autoResetConfig
    const next = normalizeAutoResetConfig(patch)
    autoResetConfig = next
    autoResetSource = 'saved'
    for (const [windowKey, configKey] of AUTO_RESET_WINDOWS) {
      const wasEnabled = asRecord(previous?.[configKey])?.enabled === true
      const isEnabled = asRecord(next?.[configKey])?.enabled === true
      if (isEnabled && !wasEnabled) {
        autoResetArmed[windowKey] = true
        autoResetLastAttempt[windowKey] = undefined
      }
    }
    try {
      writeAutoResetSettings(settingsPath, next)
      autoResetPersistError = undefined
    } catch (error) {
      // The switch is live for this process either way; report that it will not
      // survive a restart instead of pretending the write succeeded.
      autoResetPersistError = error instanceof Error ? error.message : String(error)
    }
    return { ok: true, autoReset: autoResetView() }
  }

  function view() {
    return {
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(resetState !== undefined ? { reset: resetView() } : {}),
      autoReset: autoResetView(),
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
          ...(provider.usage !== undefined ? { usage: provider.usage } : {}),
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
    providers.set('glm', {
      ...previous,
      checkedAt: now(),
      usage: {
        ...(lastGood !== undefined ? lastGood : {}),
        status,
        error: message,
        errorKind: kind,
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
      markGlmPlanSuccess(plan, provider)
    } catch (error) {
      markFailure('glm', 'GLM Coding Plan', error)
      return
    }
    await probeGlmUsage(provider, apiKey)
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

  // --- Automatic card use -----------------------------------------------------
  // Both windows default to OFF; enabling is a profile-config decision (see
  // cordis.patch.yml). When enabled, the check runs after every poll round and
  // spends the earliest-expiring available card once usage crosses the threshold.
  // Two guards keep one episode from burning the whole wallet:
  //   armed     — cleared after a spend, re-armed only when usage falls back
  //               below the threshold (which is what a successful reset does).
  //   backoff   — a failed attempt waits AUTO_RESET_RETRY_INTERVAL_MS before the
  //               same window is retried, so a persistent error cannot hammer
  //               the upstream every poll.

  function refresh(forceCards = false) {
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
        // Spending gets priority over the read-only background list: otherwise
        // two wallet reads could race and a manual spend could slip between them.
        await maybeAutoReset()
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
   * Spend one reset card. The caller must have shown the user which card will be
   * used; this function re-lists first so the choice is made against live state,
   * then re-probes the quota so the panel reflects the reset immediately.
   */
  async function useResetCard(args = {}, autoWindowKey) {
    if (resetSpendInFlight) return { ok: false, error: 'busy', message: '重置操作进行中，请稍后重试' }
    resetSpendInFlight = true
    try {
      // A spend re-lists against live state; wait for any cosmetic background
      // read first so its older result cannot overwrite the post-spend wallet.
      if (resetProbePromise !== undefined) await resetProbePromise
      return await performResetCard(args, autoWindowKey)
    } finally {
      resetSpendInFlight = false
    }
  }

  async function performResetCard({ resetType, recordId } = {}, autoWindowKey) {
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

    if (autoWindowKey !== undefined) {
      const current = providers.get('glm')
      const window = current?.plan?.windows?.find((row) => row?.key === autoWindowKey)
      const config = autoResetConfigFor(autoResetConfig, autoWindowKey)
      const decision = evaluateAutoReset({
        enabled: config.enabled,
        threshold: config.threshold,
        used: window?.percent,
        armed: autoResetArmed[autoWindowKey],
        lastAttemptAt: autoResetLastAttempt[autoWindowKey],
        now: now(),
      })
      // List/credential awaits give manual spending, a new probe or a switch-off
      // time to intervene. Recheck *after* them, immediately before the POST.
      if (windowKeyForResetType(type) !== autoWindowKey || current?.status !== 'ready' || !decision.spend) {
        return { ok: false, error: 'auto-skipped', message: '自动重置条件已变化，未消耗卡' }
      }
      autoResetLastAttempt[autoWindowKey] = now()
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

    // A timed-out/non-JSON/non-200 POST can have consumed a card upstream. Do not
    // silently retry it at the next backoff boundary without a fresh user decision.
    const unknownOutcome = () => {
      const windowKey = windowKeyForResetType(type)
      if (windowKey !== undefined) autoResetArmed[windowKey] = false
      const additionallyCleared = resetWindow(type)?.alsoClears
      if (additionallyCleared !== undefined) autoResetArmed[additionallyCleared] = false
      return { ok: false, error: 'request-unknown', message: '重置结果未知；请先核实卡数与额度，再决定是否重试' }
    }
    let outcome
    try {
      const { status, body } = await postJson(spec)
      if (status !== 200 || typeof body?.success !== 'boolean') return unknownOutcome()
      outcome = parseResetUseResult(status, body)
    } catch {
      return unknownOutcome()
    }
    if (!outcome.ok) {
      // A refusal can mean the card was consumed by another client; re-list so the
      // panel stops offering a card that no longer exists.
      await listResetCards()
      return { ok: false, error: 'rejected', message: outcome.message }
    }

    // Disarm immediately after a confirmed spend, BEFORE follow-up network calls.
    // A weekly card also clears the 5h window; disarming both avoids spending a
    // second card on a snapshot captured before the weekly reset took effect.
    const cleared = resetWindow(type)
    const spentWindow = windowKeyForResetType(type)
    if (spentWindow !== undefined) autoResetArmed[spentWindow] = false
    if (cleared?.alsoClears !== undefined) autoResetArmed[cleared.alsoClears] = false

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
      message: outcome.message,
      resetType: type,
      ...(cleared !== undefined ? { window: cleared.window } : {}),
      recordId: card.recordId,
      ...(after.ok ? { cards: after.cards } : {}),
      quota: view().providers.find((provider) => provider.key === 'glm'),
    }
  }

  /**
   * Spend a card automatically when an enabled window crosses its threshold.
   * Called once per poll round, after the probes have landed. Disabled, stale,
   * already-spent and no-data windows skip without noisy per-poll logging; every
   * actual POST attempt records success or failure for the panel and host log.
   *
   * The whole body is guarded: this runs on the poll timer, where a throw becomes
   * an unhandled rejection and takes the host process down with it. A defect in
   * automatic spending must never be able to do that, so it degrades to a log line.
   */
  async function maybeAutoReset() {
    if (disposed) return
    try {
      // Never spend from markFailure's last-good (stale) plan: its percent may
      // describe a window that has already rolled over or been manually reset.
      if (providers.get('glm')?.status !== 'ready') return
      // Weekly cards clear 5h too. Evaluate them first, and read the current plan
      // per iteration instead of keeping the pre-spend snapshot for both windows.
      for (const resetType of ['WEEK', 'FIVE_HOUR']) {
        const windowKey = windowKeyForResetType(resetType)
        if (windowKey === undefined) continue
        const provider = providers.get('glm')
        if (provider?.status !== 'ready') break
        const config = autoResetConfigFor(autoResetConfig, windowKey)
        const row = provider.plan?.windows?.find((window) => window?.key === windowKey)
        const decision = evaluateAutoReset({
          enabled: config.enabled,
          threshold: config.threshold,
          used: row?.percent,
          armed: autoResetArmed[windowKey],
          lastAttemptAt: autoResetLastAttempt[windowKey],
          now: now(),
        })
        if (decision.rearm === true) autoResetArmed[windowKey] = true
        if (!decision.spend) continue

        const result = await useResetCard({ resetType }, windowKey)
        if (result.error === 'auto-skipped' || result.error === 'busy') continue
        // Includes list failures: they must still respect the 10-minute retry
        // backoff. A skip/busy is not a real attempt and must not start one.
        autoResetLastAttempt[windowKey] = now()
        if (result.ok === true) {
          // Disarm until usage drops back below the threshold, which a successful
          // reset causes on the next probe.
          autoResetArmed[windowKey] = false
          autoResetEvent = {
            kind: 'auto',
            resetType,
            window: windowKey,
            recordId: result.recordId,
            at: now(),
          }
          logAuto('info', `quota-watch: auto-reset spent a ${resetType} card (window ${windowKey} was at or past ${config.threshold}%)`)
        } else {
          autoResetEvent = {
            kind: 'auto-failed',
            resetType,
            window: windowKey,
            at: now(),
            message: result.message,
          }
          logAuto('warn', `quota-watch: auto-reset for ${windowKey} failed (${result.error ?? 'unknown'})`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      autoResetEvent = { kind: 'auto-failed', window: 'unknown', at: now(), message }
      logAuto('warn', `quota-watch: auto-reset check failed: ${message}`)
    }
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
    listResetCards,
    useResetCard,
    updateAutoResetConfig,
    start() {
      if (disposed || timer !== undefined) return
      // Routes register synchronously in apply() before start(), so probing
      // immediately is safe; the legacy 2s delay only padded the cold start.
      schedule(0)
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
      if (!requestAllowed(ctx, req, res) || !methodAllowed(req, res, 'GET')) return
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
      if (!requestAllowed(ctx, req, res) || !methodAllowed(req, res, 'POST')) return
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

/**
 * Apply the panel's auto-reset switches.
 * POST-only for the same reason as the spend route: this arms automatic spending,
 * so nothing that a link, prefetch or image can trigger may reach it.
 */
export function makeAutoResetRoute(ctx, service) {
  return {
    kind: 'exact',
    path: ROUTES.autoReset,
    handler: async (req, res) => {
      if (!requestAllowed(ctx, req, res) || !methodAllowed(req, res, 'POST')) return
      const payload = await readJsonBody(req)
      if (payload === undefined) {
        responseJson(res, 400, { ok: false, error: 'invalid-body', message: '请求体不是合法 JSON' })
        return
      }
      try {
        responseJson(res, 200, service.updateAutoResetConfig(payload))
      } catch {
        responseJson(res, 500, { ok: false, error: 'auto-reset-failed', message: '自动重置设置保存失败' })
      }
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
  const service = createQuotaService(ctx, { pollIntervalSec: config.pollIntervalSec, autoReset: config.autoReset })
  const disposers = [
    ctx.webServer.register(makeOverviewRoute(ctx, service)),
    ctx.webServer.register(makeRefreshRoute(ctx, service)),
    ctx.webServer.register(makeResetCardsRoute(ctx, service)),
    ctx.webServer.register(makeResetUseRoute(ctx, service)),
    ctx.webServer.register(makeAutoResetRoute(ctx, service)),
  ]
  service.start()
  ctx.effect(() => () => {
    service.stop()
    for (const dispose of disposers) {
      try { dispose() } catch { /* Route fiber may already be down. */ }
    }
  }, 'dsh-quota-watch: runtime')
}
