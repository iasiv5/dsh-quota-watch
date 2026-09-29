import { CLIENT_POLL_INTERVAL_MS, CLIENT_ROUTES } from './shared.mjs'
import { remainingToUsed } from './core/adapters.mjs'

export const name = 'quota-watch-client'
export const inject = []

const CARD_SELECTOR = '[data-dsh-quota-watch-card]'
const FETCH_TIMEOUT_MS = 15_000

const COPY = {
  zh: {
    title: '套餐监控',
    refresh: '刷新',
    loading: '读取中',
    updated: '更新',
    failed: '查询失败',
    stale: '数据可能已过期',
    requestFailed: '刷新失败，显示上次成功数据',
    available: '可用额度',
    used: '本期已用',
    reset: '重置',
    todayTokens: '今日 tokens',
    todayCalls: '今日调用',
    windows: {
      '5h': '5 小时窗口 · 已用',
      week: '每周窗口 · 已用',
      month: '每月窗口 · 已用',
      mcp: 'MCP（月）· 已用',
    },
  },
  en: {
    title: 'Quota Watch',
    refresh: 'Refresh',
    loading: 'Loading',
    updated: 'Updated',
    failed: 'Query failed',
    stale: 'Data may be stale',
    requestFailed: 'Refresh failed; showing last successful data',
    available: 'Available credits',
    used: 'Used this cycle',
    reset: 'Resets',
    todayTokens: 'Today tokens',
    todayCalls: 'Calls today',
    windows: {
      '5h': '5-hour window · used',
      week: 'Weekly window · used',
      month: 'Monthly window · used',
      mcp: 'MCP (month) · used',
    },
  },
}

const STYLE_TEXT = `
[data-dsh-quota-watch-card] { box-sizing: border-box; width: 100%; margin: 0 0 8px; color: var(--dsw-alias-label-primary, inherit); font: inherit; }
[data-dsh-quota-watch-card] *, [data-dsh-quota-watch-card] *::before, [data-dsh-quota-watch-card] *::after { box-sizing: border-box; }
.dqw-card { border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-base, rgba(128,128,128,.08)); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.dqw-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dqw-title { flex: 1; min-width: 0; margin: 0; font-size: 12px; font-weight: 600; line-height: 18px; }
.dqw-button { border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 11px; line-height: 18px; padding: 1px 4px; }
.dqw-button:hover { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.16)); }
.dqw-button:disabled { cursor: wait; opacity: .6; }
.dqw-meta { margin: 0; font-size: 10px; line-height: 14px; opacity: .7; }
.dqw-body { display: flex; flex-direction: column; }
.dqw-row-summary { display: flex; align-items: center; gap: 6px; padding: 7px 6px; margin: 1px -2px 2px; border-radius: 8px; }
.dqw-row-summary[data-expandable] { cursor: pointer; }
.dqw-row-summary[data-expandable]:hover { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.12)); }
.dqw-row-summary:focus-visible { outline: 1px solid var(--dsw-alias-button-primary-fill, #5b8def); outline-offset: -1px; }
.dqw-row-summary.is-error { cursor: default; }
.dqw-label { font-size: 11px; font-weight: 600; width: 52px; flex: none; }
.dqw-bar { display: block; flex: 1; height: 4px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.2)); }
.dqw-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-button-primary-fill, #5b8def); }
.dqw-bar-fill.warn { background: var(--dsw-alias-label-warning, #d29922); }
.dqw-bar-fill.danger { background: var(--dsw-alias-label-danger, #c93c3c); }
.dqw-pct { font-size: 10.5px; line-height: 14px; font-variant-numeric: tabular-nums; width: 30px; text-align: right; flex: none; }
.dqw-extra { font-size: 10px; line-height: 14px; opacity: .72; font-variant-numeric: tabular-nums; flex: none; }
.dqw-chev { font-size: 9px; line-height: 14px; opacity: .6; flex: none; width: 10px; text-align: center; }
.dqw-stale-mark { flex: none; font-size: 9px; line-height: 14px; color: var(--dsw-alias-label-warning, #b46900); cursor: help; }
.dqw-errtext { font-size: 10px; line-height: 14px; opacity: .7; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dqw-detail { padding: 2px 6px 6px; display: flex; flex-direction: column; gap: 7px; }
.dqw-bignums { display: flex; gap: 6px; }
.dqw-big { flex: 1; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); border-radius: 8px; padding: 6px 8px; }
.dqw-big .dqw-big-value { font-size: 16px; font-weight: 650; line-height: 20px; font-variant-numeric: tabular-nums; }
.dqw-big .dqw-big-label { font-size: 9.5px; line-height: 13px; opacity: .65; }
.dqw-row { display: flex; flex-direction: column; gap: 2px; }
.dqw-row-head { display: flex; justify-content: space-between; gap: 5px; font-size: 10px; line-height: 14px; }
.dqw-muted { margin: 0; font-size: 10px; line-height: 14px; opacity: .7; }
.dqw-models { margin: 0; font-size: 10px; line-height: 15px; opacity: .8; border-top: 1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); padding-top: 6px; }
.dqw-error { margin: 0; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-warning, #b46900); }
.dqw-credit { margin: 0; font-size: 10px; line-height: 14px; font-variant-numeric: tabular-nums; }
`

function localeFor(win) {
  return String(win?.navigator?.language ?? 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function formatNumber(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(value)
}

function formatCompact(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPercent(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const clamped = Math.max(0, Math.min(100, value))
  const rounded = clamped >= 10 ? Math.round(clamped) : Number(clamped.toFixed(1))
  return `${formatNumber(rounded, locale)}%`
}

function formatTime(value, locale) {
  if (typeof value !== 'string' || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function text(doc, tag, className, value) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  node.textContent = String(value ?? '')
  return node
}

function progress(doc, label, percent, locale) {
  const row = doc.createElement('div')
  row.className = 'dqw-row'
  const head = doc.createElement('div')
  head.className = 'dqw-row-head'
  head.append(text(doc, 'span', '', label), text(doc, 'span', '', formatPercent(percent, locale)))
  const bar = doc.createElement('span')
  bar.className = 'dqw-bar'
  bar.setAttribute('role', 'progressbar')
  bar.setAttribute('aria-valuemin', '0')
  bar.setAttribute('aria-valuemax', '100')
  bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, percent))))
  const fill = doc.createElement('span')
  fill.className = `dqw-bar-fill${percent > 95 ? ' danger' : percent > 80 ? ' warn' : ''}`
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`
  bar.append(fill)
  row.append(head, bar)
  return row
}

/** GLM summary row view model: fixed 5h-window percent plus today's compact tokens. */
function glmRowModel(provider) {
  if (provider?.status === 'missing') return null
  if (provider?.status === 'error') return { kind: 'error', label: 'GLM', error: provider.error }
  const windows = provider?.plan?.windows
  if (!Array.isArray(windows) || windows.length === 0) return null
  const five = windows.find((window) => window?.key === '5h')
  const tokens = provider?.usage?.status === 'ready' || provider?.usage?.status === 'stale'
    ? provider?.usage?.totalTokens
    : undefined
  return {
    kind: 'data',
    label: 'GLM',
    percent: five?.percent,
    stale: provider.status === 'stale',
    error: provider.error,
    extra: tokens,
  }
}

/** Copilot summary row view model: used% inverted from the reported remaining percent. */
function copilotRowModel(provider) {
  if (provider?.status === 'missing') return null
  if (provider?.status === 'error') return { kind: 'error', label: 'Copilot', error: provider.error }
  const quota = provider?.quota
  if (quota?.balanceAvailable !== true) return null
  const used = remainingToUsed(quota.percentRemaining)
  if (used === undefined) return null
  return {
    kind: 'data',
    label: 'Copilot',
    percent: used,
    stale: provider.status === 'stale',
    error: provider.error,
  }
}

function footArea(doc) {
  const sidebar = doc.querySelector('[class*="sidebarCol"]')
  return sidebar?.querySelector('[class*="footArea"]') ?? undefined
}

async function fetchJson(fetchImpl, path, method) {
  const response = await fetchImpl(path, {
    ...(method === 'POST' ? { method: 'POST' } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** Mount a self-healing sidebar card. Dependencies are injectable for DOM tests. */
export function mountQuotaCard({
  doc = globalThis.document,
  win = globalThis.window,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = CLIENT_POLL_INTERVAL_MS,
} = {}) {
  if (!doc?.body || typeof fetchImpl !== 'function') return () => {}
  if (doc.querySelector(CARD_SELECTOR)) return () => {}

  const locale = localeFor(win)
  const copy = COPY[locale]
  const container = doc.createElement('div')
  container.dataset.dshQuotaWatchCard = ''
  container.dataset.dshPlugin = 'quota-watch'
  container.dataset.dshPart = 'sidebar-card'
  const style = text(doc, 'style', '', STYLE_TEXT)
  const card = doc.createElement('section')
  card.className = 'dqw-card'
  card.setAttribute('aria-label', copy.title)
  const header = doc.createElement('header')
  header.className = 'dqw-head'
  header.append(text(doc, 'h3', 'dqw-title', copy.title))
  const refreshButton = text(doc, 'button', 'dqw-button', '↻')
  refreshButton.type = 'button'
  refreshButton.title = copy.refresh
  refreshButton.setAttribute('aria-label', copy.refresh)
  refreshButton.dataset.action = 'refresh'
  header.append(refreshButton)
  const body = doc.createElement('div')
  body.className = 'dqw-body'
  const lastUpdated = text(doc, 'p', 'dqw-meta', copy.loading)
  lastUpdated.dataset.role = 'updated'
  body.append(lastUpdated)
  card.append(header, body)
  container.append(style, card)
  let snapshot
  let requestSequence = 0
  let timer
  let disposed = false
  let queuedPlace = false
  let openKey

  const fillClass = (percent) => (percent > 95 ? 'dqw-bar-fill danger' : percent > 80 ? 'dqw-bar-fill warn' : 'dqw-bar-fill')

  /** Build [row, detail] fragments for one provider, or null when it must not render. */
  const renderProvider = (key, model, provider) => {
    if (model === null) return null
    const row = doc.createElement('div')
    row.className = 'dqw-row-summary'
    row.dataset.dshQuotaWatchRow = key
    row.append(text(doc, 'span', 'dqw-label', model.label))
    if (model.kind === 'error') {
      row.classList.add('is-error')
      row.append(text(doc, 'span', 'dqw-errtext', model.error ? `${copy.failed}: ${model.error}` : copy.failed))
      return [row]
    }
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.setAttribute('aria-expanded', String(openKey === key))
    row.dataset.expandable = ''
    if (typeof model.percent === 'number' && Number.isFinite(model.percent)) {
      const bar = doc.createElement('span')
      bar.className = 'dqw-bar'
      bar.setAttribute('role', 'progressbar')
      bar.setAttribute('aria-valuemin', '0')
      bar.setAttribute('aria-valuemax', '100')
      bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, model.percent))))
      const fill = text(doc, 'span', fillClass(model.percent))
      fill.style.width = `${Math.max(0, Math.min(100, model.percent))}%`
      bar.append(fill)
      row.append(bar)
    }
    if (model.stale) {
      const mark = text(doc, 'span', 'dqw-stale-mark', '⚠')
      mark.dataset.dshQuotaWatchStale = ''
      mark.title = model.error ?? copy.stale
      row.append(mark)
    }
    row.append(text(doc, 'span', 'dqw-pct', typeof model.percent === 'number' ? formatPercent(model.percent, locale) : '—'))
    if (model.extra !== undefined) {
      const extra = text(doc, 'span', 'dqw-extra', formatCompact(model.extra, locale))
      extra.dataset.dshQuotaWatchExtra = ''
      row.append(extra)
    }
    row.append(text(doc, 'span', 'dqw-chev', openKey === key ? '▾' : '▸'))
    const detail = doc.createElement('div')
    detail.className = 'dqw-detail'
    detail.dataset.dshQuotaWatchDetail = key
    if (openKey === key) renderDetail(detail, key, provider)
    return [row, detail]
  }

  function renderDetail(detail, key, provider) {
    detail.replaceChildren()
    if (provider?.status === 'stale') {
      detail.append(text(doc, 'p', 'dqw-error', `${copy.stale}${provider.error ? `: ${provider.error}` : ''}`))
    }
    if (key === 'glm') {
      const usage = provider?.usage
      const numbers = doc.createElement('div')
      numbers.className = 'dqw-bignums'
      const tokensBig = doc.createElement('div')
      tokensBig.className = 'dqw-big'
      tokensBig.append(
        text(doc, 'div', 'dqw-big-value', formatCompact(usage?.totalTokens, locale)),
        text(doc, 'div', 'dqw-big-label', copy.todayTokens),
      )
      const callsBig = doc.createElement('div')
      callsBig.className = 'dqw-big'
      callsBig.append(
        text(doc, 'div', 'dqw-big-value', formatNumber(usage?.totalCalls, locale)),
        text(doc, 'div', 'dqw-big-label', copy.todayCalls),
      )
      numbers.append(tokensBig, callsBig)
      detail.append(numbers)
      for (const window of provider?.plan?.windows ?? []) {
        const label = copy.windows[window?.key] ?? window?.key
        if (typeof window?.percent === 'number' && Number.isFinite(window.percent)) {
          detail.append(progress(doc, label, window.percent, locale))
        } else {
          detail.append(text(doc, 'p', 'dqw-muted', label))
        }
        const reset = formatTime(window?.resetsAt, locale)
        if (reset) detail.append(text(doc, 'p', 'dqw-muted', `${copy.reset}: ${reset}`))
      }
      const models = Array.isArray(usage?.models) && usage.models.length > 0
        ? usage.models.map((model) => `${model.name} ${formatCompact(model.tokens, locale)}`).join(' · ')
        : undefined
      if (models) detail.append(text(doc, 'p', 'dqw-models', models))
      const updated = formatTime(provider?.updatedAt ? new Date(provider.updatedAt).toISOString() : '', locale)
      if (updated) detail.append(text(doc, 'p', 'dqw-meta', `${copy.updated}: ${updated}`))
      return
    }
    const quota = provider?.quota
    if (quota?.balanceAvailable === true) {
      detail.append(text(doc, 'p', 'dqw-credit', `${copy.available}: ${formatNumber(quota.remaining, locale)} / ${formatNumber(quota.entitlement, locale)}`))
      const used = remainingToUsed(quota.percentRemaining)
      if (used !== undefined) detail.append(progress(doc, copy.used, used, locale))
      if (typeof quota.creditsUsed === 'number' && quota.creditsUsed >= 0) {
        detail.append(text(doc, 'p', 'dqw-muted', `${copy.used}: ${formatNumber(quota.creditsUsed, locale)}`))
      }
    } else {
      detail.append(text(doc, 'p', 'dqw-muted', copy.stale))
    }
    const reset = formatTime(quota?.resetsAt, locale)
    if (reset) detail.append(text(doc, 'p', 'dqw-muted', `${copy.reset}: ${reset}`))
  }

  const renderAll = () => {
    const providers = snapshot?.providers ?? []
    const glm = providers.find((provider) => provider?.key === 'glm')
    const copilot = providers.find((provider) => provider?.key === 'copilot')
    const glmParts = renderProvider('glm', glmRowModel(glm), glm)
    const copilotParts = renderProvider('copilot', copilotRowModel(copilot), copilot)
    const fragment = doc.createDocumentFragment()
    fragment.append(lastUpdated)
    if (glmParts) fragment.append(...glmParts)
    if (copilotParts) fragment.append(...copilotParts)
    body.replaceChildren(fragment)
    container.hidden = glmParts === null && copilotParts === null
    const updated = formatTime(snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : '', locale)
    lastUpdated.textContent = updated ? `${copy.updated}: ${updated}` : copy.loading
  }

  const render = (next) => {
    snapshot = next
    renderAll()
  }

  const showTransportError = () => {
    if (snapshot) lastUpdated.textContent = copy.requestFailed
    else lastUpdated.textContent = copy.failed
  }

  const poll = async (force) => {
    if (disposed) return
    const sequence = ++requestSequence
    refreshButton.disabled = force === true
    try {
      const next = await fetchJson(fetchImpl, force ? CLIENT_ROUTES.refresh : CLIENT_ROUTES.overview, force ? 'POST' : 'GET')
      if (sequence === requestSequence && !disposed) render(next)
    } catch {
      if (sequence === requestSequence && !disposed) showTransportError()
    } finally {
      if (!disposed && sequence === requestSequence) refreshButton.disabled = false
    }
  }

  const place = () => {
    const foot = footArea(doc)
    if (!foot) return
    const settings = foot.querySelector('[class*="settingsArea"]')
    if (settings) {
      if (container.parentElement !== foot || container.nextElementSibling !== settings) foot.insertBefore(container, settings)
    } else if (container.parentElement !== foot || foot.lastElementChild !== container) {
      foot.append(container)
    }
  }

  const schedulePlace = () => {
    if (queuedPlace || disposed) return
    queuedPlace = true
    queueMicrotask(() => {
      queuedPlace = false
      if (!disposed) place()
    })
  }

  const observer = new win.MutationObserver(schedulePlace)
  observer.observe(doc.body, { childList: true, subtree: true })
  place()

  const startPolling = () => {
    if (timer !== undefined || doc.visibilityState === 'hidden' || disposed) return
    void poll(false)
    timer = win.setInterval(() => { void poll(false) }, pollIntervalMs)
  }
  const stopPolling = () => {
    if (timer !== undefined) win.clearInterval(timer)
    timer = undefined
  }
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') stopPolling()
    else startPolling()
  }
  const onRefresh = () => { void poll(true) }
  const toggleRow = (key) => {
    openKey = openKey === key ? undefined : key
    renderAll()
  }
  const onBodyClick = (event) => {
    const row = event.target?.closest?.('[data-dsh-quota-watch-row][data-expandable]')
    if (row) toggleRow(row.dataset.dshQuotaWatchRow)
  }
  const onBodyKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target?.closest?.('[data-dsh-quota-watch-row][data-expandable]')
    if (row) {
      event.preventDefault()
      toggleRow(row.dataset.dshQuotaWatchRow)
    }
  }
  refreshButton.addEventListener('click', onRefresh)
  body.addEventListener('click', onBodyClick)
  body.addEventListener('keydown', onBodyKeydown)
  doc.addEventListener('visibilitychange', onVisibilityChange)
  startPolling()

  return () => {
    disposed = true
    stopPolling()
    observer.disconnect()
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    refreshButton.removeEventListener('click', onRefresh)
    body.removeEventListener('click', onBodyClick)
    body.removeEventListener('keydown', onBodyKeydown)
    container.remove()
  }
}

export function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), 'dsh-quota-watch: sidebar')
}
