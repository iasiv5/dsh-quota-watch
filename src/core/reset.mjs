/**
 * Zhipu GLM Coding Plan「用量重置额度」（重置卡）的查询与使用。
 *
 * 上游契约（与开源实现 sub2api 的 cn_provider_zhipu_reset.go 对齐，并经本机
 * 实测验证）：
 *   list：GET  /api/biz/customer-package-reset/list?targetType=PERSONAL
 *   use ：POST /api/biz/customer-package-reset/use
 * 鉴权：authorization 头直接放 API Key，不加 Bearer 前缀（与额度探测一致）。
 *
 * 只支持国内站 open.bigmodel.cn 的个人版；国际站 z.ai 是否提供同一套接口未经验证，
 * 因此重置请求固定打到国内站，国际化 provider 的 key 若在国内站被拒会如实报错。
 *
 * use 是「消耗型」操作：一张卡用掉就没了，因此调用方必须先取 list、由用户确认。
 */

/** 唯一支持重置卡的主机（国内站）。 */
export const RESET_HOST = 'open.bigmodel.cn'
export const RESET_LIST_PATH = '/api/biz/customer-package-reset/list'
export const RESET_USE_PATH = '/api/biz/customer-package-reset/use'
export const RESET_TARGET_TYPE = 'PERSONAL'
export const RESET_TIMEOUT_MS = 15_000

/** 上游承认的两种重置类型。 */
export const RESET_TYPES = Object.freeze({ week: 'WEEK', fiveHour: 'FIVE_HOUR' })

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function asString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * Normalize a caller-supplied reset type.
 * Accepts the wire values plus the spellings a UI or a human may produce
 * (`weekly`, `5h`, `five-hour`), so a typo can never reach the upstream as-is.
 */
export function normalizeResetType(value) {
  const text = asString(value)?.toUpperCase().replace(/[\s-]+/g, '_')
  if (text === undefined) return undefined
  if (text === 'WEEK' || text === 'WEEKLY') return RESET_TYPES.week
  if (text === 'FIVE_HOUR' || text === 'FIVEHOUR' || text === '5H') return RESET_TYPES.fiveHour
  return undefined
}

/** The window a reset type actually clears; the weekly card also clears the 5h window. */
export function resetWindow(resetType) {
  const type = normalizeResetType(resetType)
  if (type === RESET_TYPES.week) return { window: 'week', alsoClears: '5h' }
  if (type === RESET_TYPES.fiveHour) return { window: '5h', alsoClears: undefined }
  return undefined
}

/** Build the read-only reset-card list request. */
export function buildResetListSpec({ apiKey } = {}) {
  const key = asString(apiKey)
  if (key === undefined) return undefined
  return {
    url: `https://${RESET_HOST}${RESET_LIST_PATH}?targetType=${RESET_TARGET_TYPE}`,
    headers: { authorization: key, 'accept-language': 'en-US,en' },
  }
}

/**
 * Build the card-consuming request.
 * `requestId` must be a fresh UUID per call so upstream cannot dedupe two
 * deliberate resets into one; the caller supplies it to keep this module pure.
 */
export function buildResetUseSpec({ apiKey, resetType, recordId, grantType, requestId } = {}) {
  const key = asString(apiKey)
  const type = normalizeResetType(resetType)
  const id = asNumber(recordId)
  if (key === undefined || type === undefined || id === undefined || !Number.isInteger(id) || id <= 0) return undefined
  const rid = asString(requestId)
  if (rid === undefined) return undefined
  const body = {
    targetType: RESET_TARGET_TYPE,
    resetType: type,
    recordId: id,
    requestId: rid,
  }
  const grant = asString(grantType)
  if (grant !== undefined) body.grantType = grant
  return {
    url: `https://${RESET_HOST}${RESET_USE_PATH}`,
    headers: {
      authorization: key,
      'content-type': 'application/json',
      'accept-language': 'en-US,en',
    },
    body: JSON.stringify(body),
  }
}

function normalizeCard(candidate) {
  const row = asRecord(candidate)
  if (row === undefined) return undefined
  const recordId = asNumber(row.recordId)
  // A record without a usable id cannot be spent, so it never becomes a candidate.
  if (recordId === undefined || !Number.isInteger(recordId) || recordId <= 0) return undefined
  const expireTime = asString(row.expireTime)
  return {
    recordId,
    available: row.available === true,
    ...(asString(row.grantType) !== undefined ? { grantType: asString(row.grantType) } : {}),
    ...(expireTime !== undefined ? { expireTime } : {}),
  }
}

function parseCardList(value) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeCard).filter((card) => card !== undefined)
}

/**
 * Parse the reset-card list.
 * Both `weekResets` and `fiveHourResets` must be arrays (a missing or null one is
 * treated as empty only when the other is present) — an unrecognized shape returns
 * undefined so the caller reports a parse failure instead of showing "0 cards".
 */
export function parseResetCards(status, body) {
  if (status !== 200) return undefined
  const root = asRecord(body)
  if (root?.success !== true) return undefined
  const data = asRecord(root.data)
  if (data === undefined) return undefined
  const hasWeek = Array.isArray(data.weekResets)
  const hasFive = Array.isArray(data.fiveHourResets)
  if (!hasWeek && !hasFive) return undefined
  return {
    week: (hasWeek ? parseCardList(data.weekResets) : []).filter((card) => card.available),
    fiveHour: (hasFive ? parseCardList(data.fiveHourResets) : []).filter((card) => card.available),
    weekTotal: (hasWeek ? parseCardList(data.weekResets) : []).length,
    fiveHourTotal: (hasFive ? parseCardList(data.fiveHourResets) : []).length,
    ...(asString(data.lastWeekResetTime) !== undefined ? { lastWeekResetTime: asString(data.lastWeekResetTime) } : {}),
    ...(asString(data.lastFiveHourResetTime) !== undefined ? { lastFiveHourResetTime: asString(data.lastFiveHourResetTime) } : {}),
  }
}

/**
 * Parse a card-use response.
 * Business refusals arrive as HTTP 200 with `success: false`, so they are returned
 * as `{ ok: false, message }` rather than thrown.
 */
export function parseResetUseResult(status, body) {
  const root = asRecord(body)
  if (status !== 200) {
    return { ok: false, message: asString(root?.msg) ?? `HTTP ${status}`, status }
  }
  if (root?.success !== true) {
    return { ok: false, message: asString(root?.msg) ?? '上游拒绝了本次重置', status }
  }
  return { ok: true, message: asString(root?.msg) ?? '操作成功', status }
}

/**
 * Choose which card to spend.
 * With no explicit recordId the earliest-expiring available card wins, matching the
 * official page's behaviour — a card that expires sooner is worth more.
 * An explicit recordId must still name an available card of the requested type.
 */
export function pickResetCard(cards, resetType, recordId) {
  const type = normalizeResetType(resetType)
  if (type === undefined) return { error: 'invalid-type' }
  if (cards === undefined) return { error: 'no-cards' }
  const pool = type === RESET_TYPES.week ? cards.week : cards.fiveHour
  if (!Array.isArray(pool) || pool.length === 0) return { error: 'no-card' }
  const explicit = asNumber(recordId)
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) return { error: 'invalid-record' }
    const found = pool.find((card) => card.recordId === explicit)
    return found === undefined ? { error: 'card-not-available' } : { card: found }
  }
  const sorted = [...pool].sort((a, b) => expiryRank(a.expireTime) - expiryRank(b.expireTime))
  return { card: sorted[0] }
}

/** Rank a card's expiry for "earliest wins"; an unparseable date sorts last. */
function expiryRank(expireTime) {
  const text = asString(expireTime)
  if (text === undefined) return Number.MAX_SAFE_INTEGER
  // The upstream stamps are Beijing wall-clock without a zone suffix.
  const parsed = Date.parse(text.replace(' ', 'T') + '+08:00')
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

/** A compact public view of the available cards, safe to hand to the browser. */
export function publicResetCards(cards) {
  if (cards === undefined) return undefined
  const shape = (card) => ({
    recordId: card.recordId,
    ...(card.expireTime !== undefined ? { expireTime: card.expireTime } : {}),
    ...(card.grantType !== undefined ? { grantType: card.grantType } : {}),
  })
  return {
    week: cards.week.map(shape),
    fiveHour: cards.fiveHour.map(shape),
    weekTotal: cards.weekTotal,
    fiveHourTotal: cards.fiveHourTotal,
    ...(cards.lastWeekResetTime !== undefined ? { lastWeekResetTime: cards.lastWeekResetTime } : {}),
    ...(cards.lastFiveHourResetTime !== undefined ? { lastFiveHourResetTime: cards.lastFiveHourResetTime } : {}),
  }
}

// --- Automatic card use -----------------------------------------------------

/**
 * Default trigger: used-percent at which an enabled window spends a card.
 *
 * 99.9 is deliberately late — the point of the feature is to rescue a run that is
 * about to be cut off, not to top up early and burn a card on a window that would
 * have reset on its own. The cost of waiting this long is that the quota must be
 * checked often enough to notice: with the default 60s poll a busy run can cross
 * the line between two probes, so deployments that want the last possible moment
 * should also lower `pollIntervalSec`.
 */
export const AUTO_RESET_DEFAULT_THRESHOLD = 99.9
export const AUTO_RESET_MIN_THRESHOLD = 50
/** One decimal is meaningful here: 99.9 must be expressible, not rounded to 100. */
export const AUTO_RESET_MAX_THRESHOLD = 99.9
/** After a failed attempt, wait this long before trying the same window again. */
export const AUTO_RESET_RETRY_INTERVAL_MS = 10 * 60_000

/**
 * Clamp a threshold into range without losing its decimal.
 * Rounding here would turn an explicit 99.9 into 100, i.e. a value that can never
 * be reached, silently disabling the window it was meant to protect.
 */
function clampThreshold(value) {
  const clamped = Math.max(AUTO_RESET_MIN_THRESHOLD, Math.min(AUTO_RESET_MAX_THRESHOLD, value))
  return Math.round(clamped * 10) / 10
}

/**
 * Normalize the profile's `autoReset` config.
 * Both windows default to disabled; a malformed entry is coerced to the default
 * rather than thrown, so a bad YAML value can never take the plugin down.
 */
export function normalizeAutoResetConfig(value) {
  const root = asRecord(value) ?? {}
  const window = (entry) => {
    const raw = asRecord(entry) ?? {}
    const thresholdRaw = asNumber(raw.threshold)
    const threshold = thresholdRaw === undefined
      ? AUTO_RESET_DEFAULT_THRESHOLD
      : clampThreshold(thresholdRaw)
    return { enabled: raw.enabled === true, threshold }
  }
  return Object.freeze({
    fiveHour: Object.freeze(window(root.fiveHour)),
    week: Object.freeze(window(root.week)),
  })
}

/** The window key (`'5h'` / `'week'`) for a wire reset type, or undefined. */
export function windowKeyForResetType(resetType) {
  const type = normalizeResetType(resetType)
  if (type === RESET_TYPES.week) return 'week'
  if (type === RESET_TYPES.fiveHour) return '5h'
  return undefined
}

/**
 * Plan-window key → config key.
 * Preview windows are keyed `'5h'` / `'week'` while the config reads better as
 * `fiveHour` / `week`. Those are two different namespaces: indexing the config
 * with a window key yields `undefined`, which is exactly how a missing mapping
 * once took the whole host process down. Always read through
 * {@link autoResetConfigFor} instead of indexing directly.
 */
export const AUTO_RESET_CONFIG_KEYS = Object.freeze({ '5h': 'fiveHour', week: 'week' })

/**
 * Read one window's auto-reset config, always returning a usable object.
 * An unknown window key or a missing entry reads as "disabled", so a future
 * namespace mismatch degrades to off rather than throwing.
 */
export function autoResetConfigFor(config, windowKey) {
  const key = AUTO_RESET_CONFIG_KEYS[windowKey]
  const entry = key === undefined ? undefined : asRecord(config?.[key])
  if (entry === undefined) return { enabled: false, threshold: AUTO_RESET_DEFAULT_THRESHOLD }
  return entry
}

/**
 * Decide whether the auto-reset should spend a card right now.
 *
 * Guards, in order:
 *   disabled       — the window's switch is off (the default).
 *   no-data        — the latest probe has no usable percentage for this window.
 *   below-threshold— usage under the threshold; also RE-ARMS the window, so after a
 *                    reset (usage drops to ~0) the guard re-arms automatically.
 *   already-spent  — a card was spent for this high-usage episode and usage has not
 *                    dropped below the threshold yet; without this, one episode
 *                    would burn every available card at a minute per card.
 *   backoff        — a failed attempt waits `minIntervalMs` before retrying, so a
 *                    persistent upstream error cannot hammer the API every poll.
 *
 * `used` is the provider-reported **used** percentage, matching the panel.
 */
export function evaluateAutoReset({
  enabled, threshold, used, armed, lastAttemptAt, now,
  minIntervalMs = AUTO_RESET_RETRY_INTERVAL_MS,
} = {}) {
  if (enabled !== true) return { spend: false, reason: 'disabled' }
  if (typeof used !== 'number' || !Number.isFinite(used)) return { spend: false, reason: 'no-data' }
  if (used < threshold) return { spend: false, reason: 'below-threshold', rearm: true }
  if (armed !== true) return { spend: false, reason: 'already-spent' }
  if (typeof lastAttemptAt === 'number' && Number.isFinite(now) && now - lastAttemptAt < minIntervalMs) {
    return { spend: false, reason: 'backoff' }
  }
  return { spend: true }
}
