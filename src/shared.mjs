export const API_PREFIX = '/api/dsh-quota-watch'

export const ROUTES = Object.freeze({
  overview: `${API_PREFIX}/overview`,
  refresh: `${API_PREFIX}/refresh`,
  resetCards: `${API_PREFIX}/reset-cards`,
  resetUse: `${API_PREFIX}/reset-cards/use`,
  resetAcknowledge: `${API_PREFIX}/reset-cards/acknowledge`,
  resetReceipt: `${API_PREFIX}/reset-cards/receipt`,
})

// The Web UI is served under <base href="./">; clients must use document-relative paths.
export const CLIENT_ROUTES = Object.freeze({
  overview: `${API_PREFIX.slice(1)}/overview`,
  refresh: `${API_PREFIX.slice(1)}/refresh`,
  resetCards: `${API_PREFIX.slice(1)}/reset-cards`,
  resetUse: `${API_PREFIX.slice(1)}/reset-cards/use`,
  resetAcknowledge: `${API_PREFIX.slice(1)}/reset-cards/acknowledge`,
  resetReceipt: `${API_PREFIX.slice(1)}/reset-cards/receipt`,
})

export const PROVIDER_IDS = Object.freeze({
  glmDomestic: 'zai-coding-cn',
  glmInternational: 'zai',
  glmInternationalLegacy: 'zai-coding',
  copilot: 'github-copilot',
})

export const DEFAULT_POLL_INTERVAL_SEC = 60
export const MIN_POLL_INTERVAL_SEC = 30
export const MAX_POLL_INTERVAL_SEC = 3600
export const PROBE_TIMEOUT_MS = 10_000
export const CLIENT_POLL_INTERVAL_MS = 30_000
// Idle polling pause: a scheduled round is skipped once this many poll
// intervals have passed without any request to a plugin route (every allowed
// route hit stamps the watcher clock).
export const IDLE_AFTER_POLL_INTERVALS = 2
