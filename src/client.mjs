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
    failed: '查询失败',
    stale: '数据可能已过期',
    requestFailed: '刷新失败，显示上次成功数据',
    available: '可用额度',
    used: '本期已用',
    reset: '重置',
    resetTime: '重置时间',
    windowUsed: '已用',
    todayTokens: '今日 Tokens',
    todayCalls: '调用次数',
    weekUnlimited: '每周额度',
    unlimited: '♾️',
    unlimitedNote: '（无限）',
    windows: {
      '5h': '5 小时额度',
      week: '每周额度',
      month: '每月额度',
      mcp: 'MCP（月）',
    },
  },
  en: {
    title: 'Quota Watch',
    refresh: 'Refresh',
    loading: 'Loading',
    failed: 'Query failed',
    stale: 'Data may be stale',
    requestFailed: 'Refresh failed; showing last successful data',
    available: 'Available credits',
    used: 'Used this cycle',
    reset: 'Resets',
    resetTime: 'Reset time',
    windowUsed: 'used',
    todayTokens: 'Today tokens',
    todayCalls: 'Calls',
    weekUnlimited: 'Weekly quota',
    unlimited: '♾️',
    unlimitedNote: ' (unlimited)',
    windows: {
      '5h': '5-hour quota',
      week: 'Weekly quota',
      month: 'Monthly quota',
      mcp: 'MCP (month)',
    },
  },
}

const STYLE_TEXT = `
[data-dsh-quota-watch-card] { box-sizing: border-box; width: 100%; margin: 0 0 8px; color: var(--dsw-alias-label-primary, inherit); font: inherit; }
[data-dsh-quota-watch-card] *, [data-dsh-quota-watch-card] *::before, [data-dsh-quota-watch-card] *::after { box-sizing: border-box; }
.dqw-card { border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-base, rgba(128,128,128,.08)); padding: 5px 8px; display: flex; flex-direction: column; gap: 2px; }
.dqw-meta { margin: 0; font-size: 10px; line-height: 14px; opacity: .7; }
.dqw-body { display: flex; flex-direction: column; }
.dqw-row-summary { display: flex; align-items: center; gap: 6px; padding: 3px 6px; margin: 0 -2px; border-radius: 8px; }
.dqw-row-summary[data-expandable] { cursor: pointer; }
.dqw-row-summary[data-expandable]:hover { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.12)); }
.dqw-row-summary:focus-visible { outline: 1px solid var(--dsw-alias-button-primary-fill, #5b8def); outline-offset: -1px; }
.dqw-row-summary.is-error { cursor: default; }
.dqw-label { font-size: 11px; font-weight: 600; width: 52px; flex: none; }
.dqw-label[data-action="refresh"] { cursor: pointer; border-radius: 4px; }
.dqw-label[data-action="refresh"]:hover { opacity: .75; }
.dqw-bar { display: block; flex: 1; height: 4px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.2)); }
.dqw-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-button-primary-fill, #5b8def); }
.dqw-bar-fill.warn { background: var(--dsw-alias-label-warning, #d29922); }
.dqw-bar-fill.danger { background: var(--dsw-alias-label-danger, #c93c3c); }
.dqw-pct { font-size: 10.5px; line-height: 14px; font-variant-numeric: tabular-nums; width: 30px; text-align: right; flex: none; }
.dqw-extra { font-size: 10px; line-height: 14px; opacity: .72; font-variant-numeric: tabular-nums; flex: none; min-width: 34px; text-align: right; }
.dqw-chev { font-size: 9px; line-height: 14px; opacity: .6; flex: none; width: 10px; text-align: center; }
.dqw-stale-mark { flex: none; font-size: 9px; line-height: 14px; color: var(--dsw-alias-label-warning, #b46900); cursor: help; }
.dqw-errtext { font-size: 10px; line-height: 14px; opacity: .7; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dqw-pop { position: fixed; z-index: 2147483000; min-width: 232px; max-width: 320px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); background: color-mix(in srgb, var(--dsw-alias-bg-base, #1f1f1f) 86%, transparent); -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3); box-shadow: 0 8px 24px rgba(0,0,0,.25); color: var(--dsw-alias-label-primary, inherit); display: flex; flex-direction: column; gap: 8px; font: inherit; }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .dqw-pop { background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); } }
.dqw-pop[hidden] { display: none; }
.dqw-pop *, .dqw-pop *::before, .dqw-pop *::after { box-sizing: border-box; }
.dqw-bignums { display: flex; gap: 6px; }
.dqw-big { flex: 1; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); border-radius: 8px; padding: 5px 8px; }
.dqw-big .dqw-big-value { font-size: 15px; font-weight: 650; line-height: 19px; font-variant-numeric: tabular-nums; }
.dqw-big .dqw-big-label { font-size: 9.5px; line-height: 13px; opacity: .65; }
.dqw-muted { margin: 0; font-size: 10px; line-height: 14px; opacity: .7; }
.dqw-models { border-top: 1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); padding-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.dqw-model-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 10.5px; line-height: 15px; font-variant-numeric: tabular-nums; }
.dqw-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .85; }
.dqw-model-value { flex: none; font-weight: 600; }
.dqw-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 10.5px; line-height: 17px; font-variant-numeric: tabular-nums; }
.dqw-kv-label { flex: none; opacity: .65; }
.dqw-kv-value { min-width: 0; text-align: right; font-weight: 600; }
.dqw-kv-sub { font-weight: 400; opacity: .55; }
.dqw-wins { display: grid; grid-template-columns: max-content max-content max-content max-content 1fr; column-gap: 6px; row-gap: 3px; align-items: baseline; font-size: 10.5px; line-height: 17px; font-variant-numeric: tabular-nums; }
.dqw-win-name { opacity: .65; }
.dqw-win-mid { opacity: .65; white-space: nowrap; }
.dqw-win-used { opacity: .65; white-space: nowrap; }
.dqw-win-val { min-width: 0; font-weight: 600; }
.dqw-error { margin: 0; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-warning, #b46900); }
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

/** Aligned label/value line used by the simplified Copilot detail. */
function kvRow(doc, label, value) {
  const row = doc.createElement('div')
  row.className = 'dqw-kv'
  row.append(text(doc, 'span', 'dqw-kv-label', label), text(doc, 'span', 'dqw-kv-value', value))
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
    extra: typeof quota.creditsUsed === 'number' && quota.creditsUsed >= 0 ? quota.creditsUsed : undefined,
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
  const body = doc.createElement('div')
  body.className = 'dqw-body'
  // Status line doubles as the transport-error surface; hidden once data renders.
  const lastUpdated = text(doc, 'p', 'dqw-meta', copy.loading)
  lastUpdated.dataset.role = 'updated'
  body.append(lastUpdated)
  card.append(body)
  container.append(style, card)
  // Details open in a fixed-position panel to the right of the rows.
  const pop = doc.createElement('div')
  pop.className = 'dqw-pop'
  pop.dataset.dshQuotaWatchPop = ''
  pop.hidden = true
  doc.body.append(pop)
  let snapshot
  let requestSequence = 0
  let timer
  let disposed = false
  let queuedPlace = false
  let openKey

  const fillClass = (percent) => (percent > 95 ? 'dqw-bar-fill danger' : percent > 80 ? 'dqw-bar-fill warn' : 'dqw-bar-fill')

  /** Build the summary row for one provider, or null when it must not render. */
  const renderProvider = (key, model) => {
    if (model === null) return null
    const row = doc.createElement('div')
    row.className = 'dqw-row-summary'
    row.dataset.dshQuotaWatchRow = key
    const label = text(doc, 'span', 'dqw-label', model.label)
    // Clicking the provider name re-probes, standing in for the removed refresh button.
    label.dataset.action = 'refresh'
    label.title = `${model.label} · ${copy.refresh}`
    row.append(label)
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
    return [row]
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
      const raw = Array.isArray(provider?.plan?.windows) ? provider.plan.windows : []
      // Fixed display order (MCP, 5h, month, week); the weekly window shows an
      // unlimited placeholder until the provider starts reporting one.
      const order = { mcp: 0, '5h': 1, month: 2, week: 3 }
      const sorted = [...raw].sort((a, b) => (order[a?.key] ?? 99) - (order[b?.key] ?? 99))
      const items = []
      let weekPlaced = false
      for (const window of sorted) {
        if (!weekPlaced && (order[window?.key] ?? 99) > order.week) {
          items.push({ placeholder: true })
          weekPlaced = true
        }
        if (window?.key === 'week') weekPlaced = true
        items.push({ window })
      }
      if (!weekPlaced) items.push({ placeholder: true })
      // One grid keeps the name, ·, used/♾️, percent and weak-note columns aligned
      // across all window rows.
      const wins = doc.createElement('div')
      wins.className = 'dqw-wins'
      for (const item of items) {
        if (item.placeholder) {
          wins.append(
            text(doc, 'span', 'dqw-win-name', copy.weekUnlimited),
            text(doc, 'span', 'dqw-win-mid', '·'),
            text(doc, 'span', 'dqw-win-used', copy.unlimited),
            text(doc, 'span', ''),
            text(doc, 'span', 'dqw-kv-sub', copy.unlimitedNote),
          )
          continue
        }
        const window = item.window
        const percent = typeof window?.percent === 'number' && Number.isFinite(window.percent) ? window.percent : undefined
        const reset = formatTime(window?.resetsAt, locale)
        wins.append(text(doc, 'span', 'dqw-win-name', copy.windows[window?.key] ?? window?.key))
        wins.append(text(doc, 'span', 'dqw-win-mid', '·'))
        wins.append(text(doc, 'span', 'dqw-win-used', copy.windowUsed))
        wins.append(text(doc, 'span', 'dqw-win-val', percent !== undefined ? formatPercent(percent, locale) : '—'))
        wins.append(text(doc, 'span', 'dqw-kv-sub', reset ? `（${copy.reset}: ${reset}）` : ''))
      }
      detail.append(wins)
      if (Array.isArray(usage?.models) && usage.models.length > 0) {
        const models = doc.createElement('div')
        models.className = 'dqw-models'
        for (const model of usage.models) {
          const row = doc.createElement('div')
          row.className = 'dqw-model-row'
          row.append(
            text(doc, 'span', 'dqw-model-name', model?.name ?? '—'),
            text(doc, 'span', 'dqw-model-value', formatCompact(model?.tokens, locale)),
          )
          models.append(row)
        }
        detail.append(models)
      }
      return
    }
    const quota = provider?.quota
    if (quota?.balanceAvailable === true) {
      detail.append(kvRow(doc, copy.available, `${formatNumber(quota.remaining, locale)} / ${formatNumber(quota.entitlement, locale)}`))
      const used = remainingToUsed(quota.percentRemaining)
      if (typeof quota.creditsUsed === 'number' && quota.creditsUsed >= 0) {
        const row = doc.createElement('div')
        row.className = 'dqw-kv'
        const value = doc.createElement('span')
        value.className = 'dqw-kv-value'
        value.append(text(doc, 'span', '', formatNumber(quota.creditsUsed, locale)))
        // The percent duplicates the summary bar, so render it weakened.
        if (used !== undefined) value.append(text(doc, 'span', 'dqw-kv-sub', ` · ${formatPercent(used, locale)}`))
        row.append(text(doc, 'span', 'dqw-kv-label', copy.used), value)
        detail.append(row)
      }
      const reset = formatTime(quota?.resetsAt, locale)
      if (reset) detail.append(kvRow(doc, copy.resetTime, reset))
    } else {
      detail.append(text(doc, 'p', 'dqw-muted', copy.stale))
    }
  }

  /** Keep the detail panel anchored to the expanded row's right edge. */
  const positionPop = () => {
    if (pop.hidden || openKey === undefined) return
    const row = body.querySelector(`[data-dsh-quota-watch-row="${openKey}"]`)
    if (!row) return
    const rect = row.getBoundingClientRect()
    const viewWidth = win.innerWidth ?? 1024
    const viewHeight = win.innerHeight ?? 768
    const width = pop.offsetWidth || 240
    const height = pop.offsetHeight || 160
    let left = rect.right + 8
    if (left + width > viewWidth - 8) left = rect.left - width - 8
    if (left + width > viewWidth - 8) left = viewWidth - width - 8
    left = Math.max(8, left)
    const top = Math.min(Math.max(rect.top, 8), Math.max(8, viewHeight - height - 8))
    pop.style.left = `${Math.round(left)}px`
    pop.style.top = `${Math.round(top)}px`
  }

  const syncPop = () => {
    if (openKey === undefined || disposed) {
      if (!pop.hidden) {
        pop.hidden = true
        pop.replaceChildren()
        delete pop.dataset.dshQuotaWatchDetail
      }
      return
    }
    const provider = (snapshot?.providers ?? []).find((item) => item?.key === openKey)
    const row = body.querySelector(`[data-dsh-quota-watch-row="${openKey}"]`)
    if (!provider || !row || !row.hasAttribute('data-expandable')) {
      openKey = undefined
      syncPop()
      return
    }
    renderDetail(pop, openKey, provider)
    pop.dataset.dshQuotaWatchDetail = openKey
    pop.setAttribute('aria-label', openKey === 'glm' ? 'GLM' : 'Copilot')
    pop.hidden = false
    positionPop()
  }

  const renderAll = () => {
    const providers = snapshot?.providers ?? []
    const glm = providers.find((provider) => provider?.key === 'glm')
    const copilot = providers.find((provider) => provider?.key === 'copilot')
    const glmParts = renderProvider('glm', glmRowModel(glm))
    const copilotParts = renderProvider('copilot', copilotRowModel(copilot))
    const fragment = doc.createDocumentFragment()
    fragment.append(lastUpdated)
    if (glmParts) fragment.append(...glmParts)
    if (copilotParts) fragment.append(...copilotParts)
    body.replaceChildren(fragment)
    container.hidden = glmParts === null && copilotParts === null
    const updated = formatTime(snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : '', locale)
    if (updated) {
      lastUpdated.hidden = true
    } else {
      lastUpdated.hidden = false
      lastUpdated.textContent = copy.loading
    }
    syncPop()
  }

  const render = (next) => {
    snapshot = next
    renderAll()
  }

  const showTransportError = () => {
    lastUpdated.hidden = false
    lastUpdated.textContent = snapshot ? copy.requestFailed : copy.failed
  }

  const poll = async (force) => {
    if (disposed) return
    const sequence = ++requestSequence
    try {
      const next = await fetchJson(fetchImpl, force ? CLIENT_ROUTES.refresh : CLIENT_ROUTES.overview, force ? 'POST' : 'GET')
      if (sequence === requestSequence && !disposed) render(next)
    } catch {
      if (sequence === requestSequence && !disposed) showTransportError()
    }
  }

  const place = () => {
    const foot = footArea(doc)
    if (!foot) return
    // Claim the first slot of the sidebar footer so the card sits above the
    // framework-rendered plugin entries and the settings row; the mutation
    // observer re-seats it whenever the framework displaces it.
    if (container.parentElement !== foot || foot.firstElementChild !== container) {
      foot.insertBefore(container, foot.firstChild)
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
    void poll()
    timer = win.setInterval(() => { void poll() }, pollIntervalMs)
  }
  const stopPolling = () => {
    if (timer !== undefined) win.clearInterval(timer)
    timer = undefined
  }
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') stopPolling()
    else startPolling()
  }
  const toggleRow = (key) => {
    openKey = openKey === key ? undefined : key
    renderAll()
  }
  const onBodyClick = (event) => {
    if (event.target?.closest?.('[data-action="refresh"]')) {
      void poll(true)
      return
    }
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
  const onDocPointerDown = (event) => {
    if (openKey === undefined) return
    const target = event.target
    if (pop.contains(target) || target?.closest?.('[data-dsh-quota-watch-row]') || target?.closest?.(CARD_SELECTOR)) return
    openKey = undefined
    renderAll()
  }
  const onDocScroll = () => { positionPop() }
  const onWinResize = () => { positionPop() }
  const onDocKeydown = (event) => {
    if (event.key === 'Escape' && openKey !== undefined) {
      openKey = undefined
      renderAll()
    }
  }
  body.addEventListener('click', onBodyClick)
  body.addEventListener('keydown', onBodyKeydown)
  doc.addEventListener('visibilitychange', onVisibilityChange)
  doc.addEventListener('pointerdown', onDocPointerDown, true)
  doc.addEventListener('scroll', onDocScroll, true)
  doc.addEventListener('keydown', onDocKeydown)
  win.addEventListener('resize', onWinResize)
  startPolling()

  return () => {
    disposed = true
    stopPolling()
    observer.disconnect()
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    doc.removeEventListener('pointerdown', onDocPointerDown, true)
    doc.removeEventListener('scroll', onDocScroll, true)
    doc.removeEventListener('keydown', onDocKeydown)
    win.removeEventListener('resize', onWinResize)
    body.removeEventListener('click', onBodyClick)
    body.removeEventListener('keydown', onBodyKeydown)
    container.remove()
    pop.remove()
  }
}

export function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), 'dsh-quota-watch: sidebar')
}
