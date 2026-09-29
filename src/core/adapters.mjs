const GLM_HOSTS = Object.freeze({
  'zai-coding-cn': 'open.bigmodel.cn',
  zai: 'api.z.ai',
  'zai-coding': 'api.z.ai',
})

const GLM_WINDOW_KEYS = Object.freeze({ 3: '5h', 5: 'month', 6: 'week' })
const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user'
const COPILOT_HEADERS = Object.freeze({
  accept: 'application/json',
  'user-agent': 'GitHubCopilotChat/0.35.0',
  'editor-version': 'vscode/1.107.0',
  'editor-plugin-version': 'copilot-chat/0.35.0',
  'copilot-integration-id': 'vscode-chat',
})

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

function clampPercent(value) {
  return Math.max(0, Math.min(100, value))
}

function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const milliseconds = value < 1e12 ? value * 1000 : value
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  const text = asString(value)
  if (text === undefined) return undefined
  if (/^\d+$/.test(text)) return toIso(Number(text))
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function glmPercent(row, kind) {
  if (kind === 'CREDIT_LIMIT' || kind === 'TIME_LIMIT') {
    const current = asNumber(row.currentValue)
    const total = asNumber(row.usage)
    if (current !== undefined && total !== undefined && total > 0) {
      return clampPercent((current / total) * 100)
    }
  }
  const reported = asNumber(row.percentage)
  return reported === undefined ? undefined : clampPercent(reported)
}

/** Build a fixed-origin GLM Coding Plan quota request. */
export function buildGlmProbe({ provider, apiKey } = {}) {
  const host = GLM_HOSTS[provider]
  const key = asString(apiKey)
  if (host === undefined || key === undefined) return undefined
  return {
    url: `https://${host}/api/monitor/usage/quota/limit`,
    headers: {
      authorization: key,
      'accept-language': 'en-US,en',
    },
  }
}

const GLM_USAGE_PATH = '/api/monitor/usage/model-usage'

/** Build a GLM model-usage request over a formatted local-time interval. */
export function buildGlmUsageProbe({ provider, apiKey, startTime, endTime } = {}) {
  const host = GLM_HOSTS[provider]
  const key = asString(apiKey)
  const from = asString(startTime)
  const to = asString(endTime)
  if (host === undefined || key === undefined || from === undefined || to === undefined) return undefined
  return {
    url: `https://${host}${GLM_USAGE_PATH}?startTime=${encodeURIComponent(from)}&endTime=${encodeURIComponent(to)}`,
    headers: {
      authorization: key,
      'accept-language': 'en-US,en',
    },
  }
}

/** Format a Date as the provider's local-time `yyyy-MM-dd HH:mm:ss` interval stamp. */
export function formatGlmIntervalTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** The host-local calendar day so far, as a model-usage query interval. */
export function usageDayWindow(now = new Date()) {
  const end = formatGlmIntervalTime(now)
  if (end === undefined) return undefined
  return { startTime: `${end.slice(0, 10)} 00:00:00`, endTime: end }
}

/** Normalize a provider-reported remaining percentage to used, without other fields. */
export function remainingToUsed(percentRemaining) {
  const value = asNumber(percentRemaining)
  if (value === undefined || value < 0 || value > 100) return undefined
  return clampPercent(Math.round((100 - value) * 100) / 100)
}

/** Normalize GLM's provider-defined quota windows without relying on row order. */
export function parseGlmPlan(status, body) {
  if (status !== 200) return undefined
  const root = asRecord(body)
  if (root?.success !== true) return undefined
  const data = asRecord(root.data)
  if (!Array.isArray(data?.limits)) return undefined

  const windows = []
  for (const candidate of data.limits) {
    const row = asRecord(candidate)
    if (row === undefined) continue
    const kind = asString(row.type)
    if (kind !== 'TOKENS_LIMIT' && kind !== 'CREDIT_LIMIT' && kind !== 'TIME_LIMIT') continue
    const percent = glmPercent(row, kind)
    const resetsAt = toIso(row.nextResetTime)
    if (kind === 'TIME_LIMIT') {
      windows.push({
        key: 'mcp',
        ...(percent !== undefined ? { percent } : {}),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      })
      continue
    }
    const unit = asNumber(row.unit)
    const key = GLM_WINDOW_KEYS[unit]
    if (key === undefined) continue
    windows.push({
      key,
      ...(percent !== undefined ? { percent } : {}),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    })
  }

  if (windows.length === 0) return undefined
  const planName = asString(data.level)
  return { ...(planName !== undefined ? { planName } : {}), windows }
}

/** Normalize GLM's provider-reported usage totals for a queried interval. */
export function parseGlmUsage(status, body) {
  if (status !== 200) return undefined
  const root = asRecord(body)
  if (root?.success !== true) return undefined
  const data = asRecord(root.data)
  const total = asRecord(data?.totalUsage)
  const totalTokens = asNumber(total?.totalTokensUsage)
  const totalCalls = asNumber(total?.totalModelCallCount)
  if (totalTokens === undefined || totalTokens < 0) return undefined
  if (totalCalls === undefined || totalCalls < 0) return undefined
  const list = Array.isArray(total.modelSummaryList) ? total.modelSummaryList : []
  const models = []
  for (const candidate of list) {
    const row = asRecord(candidate)
    const name = asString(row?.modelName)
    const tokens = asNumber(row?.totalTokens)
    if (name === undefined || tokens === undefined || tokens < 0) continue
    models.push({ name, tokens })
  }
  return { totalTokens, totalCalls, ...(models.length > 0 ? { models } : {}) }
}

/** Build the Copilot user-quota request using the raw GitHub OAuth grant. */
export function buildCopilotProbe({ githubOAuthToken } = {}) {
  const token = asString(githubOAuthToken)
  if (token === undefined) return undefined
  return {
    url: COPILOT_USER_URL,
    headers: {
      authorization: `Bearer ${token}`,
      ...COPILOT_HEADERS,
    },
  }
}

/**
 * Normalize the Copilot user's premium-interaction snapshot.
 * Remaining credits are never derived from entitlement minus credits_used.
 */
export function parseCopilotUser(status, body) {
  if (status !== 200) return undefined
  const root = asRecord(body)
  const snapshots = asRecord(root?.quota_snapshots)
  const snapshot = asRecord(snapshots?.premium_interactions)
  if (snapshot === undefined) return undefined

  const tokenBasedBilling = typeof snapshot.token_based_billing === 'boolean'
    ? snapshot.token_based_billing
    : typeof root?.token_based_billing === 'boolean'
      ? root.token_based_billing
      : undefined
  const entitlement = asNumber(snapshot.entitlement)
  const reportedRemaining = asNumber(snapshot.remaining)
  const balanceAvailable = tokenBasedBilling === true
    && snapshot.unlimited === false
    && entitlement !== undefined
    && entitlement > 0
    && reportedRemaining !== undefined
    && reportedRemaining >= 0
  const percentReported = asNumber(snapshot.percent_remaining)
  const creditsUsed = tokenBasedBilling === true ? asNumber(snapshot.credits_used) : undefined
  const resetsAt = toIso(root?.quota_reset_date_utc) ?? toIso(root?.quota_reset_date)
  const planName = asString(root?.copilot_plan)

  return {
    ...(planName !== undefined ? { planName } : {}),
    ...(tokenBasedBilling !== undefined ? { tokenBasedBilling } : {}),
    balanceAvailable,
    ...(balanceAvailable ? {
      remaining: reportedRemaining,
      entitlement,
      ...(percentReported !== undefined ? { percentRemaining: clampPercent(percentReported) } : {}),
    } : {}),
    ...(creditsUsed !== undefined && creditsUsed >= 0 ? { creditsUsed } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  }
}
