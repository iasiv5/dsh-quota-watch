import { CLIENT_POLL_INTERVAL_MS, CLIENT_ROUTES } from './shared.mjs'
import { remainingToUsed } from './core/adapters.mjs'
import { MARGIN, clampPoint, loadFloatPosition, loadSurfaceFlags, saveFloatPosition, saveSurfaceFlags } from './client/prefs.mjs'
import { DRAG_SLOP_MOUSE, DRAG_SLOP_TOUCH, parseInset, clampFrame, dragSlop, grabOffset } from './client/drag.mjs'

export const name = 'quota-watch-client'
export const inject = []

const CARD_SELECTOR = '[data-dsh-quota-watch-card]'
const FLOAT_SELECTOR = '[data-dsh-quota-watch-float]'
const FETCH_TIMEOUT_MS = 15_000
// Measured-size fallback for environments where getBoundingClientRect reports
// zeros (jsdom) or the capsule has not painted yet.
const FALLBACK_SIZE = { width: 38, height: 26 }
const ZERO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 }
// Below this a mounted card would clip into unreadable text (collapsed web
// rails, squeezed desktop layouts) — hide it and let the capsule carry the
// entry. clientWidth 0 (no layout yet, jsdom) counts as "unknown", not narrow.
const CARD_MIN_WIDTH = 160

const COPY = {
  zh: {
    title: 'Token额度',
    openDetails: '查看详情',
    close: '关闭',
    actions: {
      showCard: '显示侧边栏卡片',
      hideCard: '隐藏侧边栏卡片',
      refreshNow: '立即刷新',
    },
    backToOverview: '返回额度概览',
    providerNames: { glm: 'GLM', copilot: 'Copilot' },
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
    unlimitedNote: '（ 无限 ）',
    // Full-width paren pair for zh: both window-grid notes share the same
    // glyph class so their left edges line up.
    noteOpen: '（ ',
    noteClose: ' ）',
    windows: {
      '5h': '5 小时额度',
      week: '每周额度',
      month: '每月额度',
      mcp: 'MCP（月）',
    },
  },
  en: {
    title: 'Quota Watch',
    openDetails: 'View details',
    close: 'Close',
    actions: {
      showCard: 'Show sidebar card',
      hideCard: 'Hide sidebar card',
      refreshNow: 'Refresh now',
    },
    backToOverview: 'Back to quota overview',
    providerNames: { glm: 'GLM', copilot: 'Copilot' },
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
    unlimitedNote: '( unlimited )',
    // ASCII parens for en — and NO leading space: the note must start with
    // the same glyph as the reset notes or the grid's left edges diverge
    // (0.1.15 shipped ' ( unlimited )', which broke alignment against the
    // full-width （ Resets: … ） notes the template used to emit in en too).
    noteOpen: '( ',
    noteClose: ' )',
    windows: {
      '5h': '5-hour quota',
      week: 'Weekly quota',
      month: 'Monthly quota',
      mcp: 'MCP (month)',
    },
  },
}

const STYLE_TEXT = `
:host { box-sizing: border-box; width: 100%; margin: 0 0 8px; color: var(--dsw-alias-label-primary, inherit); font: inherit; }
:host *, :host *::before, :host *::after { box-sizing: border-box; }
.dqw-card { position: relative; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-base, rgba(128,128,128,.08)); padding: 5px 8px; display: flex; flex-direction: column; gap: 2px; }
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
@media print { :host { display: none !important; } }
`

// Float shell (capsule) and the panel live on their own shadow host at the
// document root — ADR 0001 isolation, and survival without any sidebar DOM
// (collapsed sidebar, desktop profile). Panel content shares the card's visual
// language, so the row/detail rules are duplicated into THIS shadow root; the
// card shadow keeps its own copies for the sidebar rows.
const FLOAT_STYLE_TEXT = `
:host { position: fixed; z-index: 2147483000; }
.dqw-capsule { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 999px; background: var(--dsw-alias-bg-base, rgba(128,128,128,.08)); background: color-mix(in srgb, var(--dsw-alias-bg-base, #1f1f1f) 86%, transparent); -webkit-backdrop-filter: blur(10px) saturate(1.2); backdrop-filter: blur(10px) saturate(1.2); box-shadow: 0 4px 14px rgba(0,0,0,.22); color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 11px; line-height: 24px; cursor: grab; user-select: none; white-space: nowrap; position: relative; touch-action: none; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.dqw-capsule::before { content: ''; position: absolute; inset: -9px; }
.dqw-capsule:hover { border-color: var(--dsw-alias-border-primary, var(--dsw-alias-border-secondary, rgba(128,128,128,.35))); box-shadow: 0 6px 18px rgba(0,0,0,.28); }
.dqw-capsule:active { transform: scale(.98); }
.dqw-capsule:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #5b8def); outline-offset: 2px; }
.dqw-capsule-sep { opacity: .5; }
.dqw-capsule-glm, .dqw-capsule-copilot { font-variant-numeric: tabular-nums; font-weight: 600; }
.dqw-capsule-glm.warn, .dqw-capsule-copilot.warn { color: var(--dsw-alias-label-warning, #d29922); }
.dqw-capsule-glm.danger, .dqw-capsule-copilot.danger { color: var(--dsw-alias-label-danger, #c93c3c); }
.dqw-capsule[hidden] { display: none; }
.dqw-capsule--dragging { cursor: grabbing; -webkit-backdrop-filter: none; backdrop-filter: none; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); box-shadow: 0 8px 24px rgba(0,0,0,.35); transform: scale(1.04); transition: none; }
@media (prefers-reduced-motion: no-preference) {
  .dqw-capsule[data-alert] { animation: dqw-pulse 1.6s ease-in-out infinite; }
  .dqw-capsule { transition: border-color .12s ease-out, box-shadow .12s ease-out; }
}
@media print { :host { display: none !important; } }
@keyframes dqw-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
.dqw-panel-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dqw-panel-action { min-width: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, inherit); font: inherit; font-size: 10px; line-height: 14px; opacity: .72; text-align: center; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dqw-panel-action:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, inherit); opacity: 1; }
.dqw-panel { position: fixed; z-index: 2147483000; min-width: 166px; max-width: min(320px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); background: color-mix(in srgb, var(--dsw-alias-bg-base, #1f1f1f) 86%, transparent); -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3); box-shadow: 0 8px 24px rgba(0,0,0,.25); color: var(--dsw-alias-label-primary, inherit); display: flex; flex-direction: column; gap: 8px; font: inherit; }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .dqw-panel { background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); } }
.dqw-panel--sheet { left:8px; right:8px; top:auto; bottom:calc(8px + env(safe-area-inset-bottom, 0px)); width:auto; max-width:none; max-height:calc(100dvh - 24px); }
.dqw-panel[hidden] { display: none; }
.dqw-panel *, .dqw-panel *::before, .dqw-panel *::after { box-sizing: border-box; }
.dqw-panel-header { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dqw-panel-title { margin: 0; font-size: 11px; font-weight: 600; line-height: 16px; flex: 1; min-width: 0; }
.dqw-panel-back { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; }
.dqw-panel-back svg { display: block; width: 16px; height: 16px; }
.dqw-panel-back:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, inherit); }
.dqw-panel-close { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; margin: 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; font: inherit; font-size: 12px; line-height: 1; }
.dqw-panel-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, inherit); }
.dqw-overview-list { display: flex; flex-direction: column; gap: 2px; }
.dqw-bar { background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.38)); }
.dqw-row-summary { display: flex; align-items: center; gap: 6px; padding: 3px 6px; margin: 0 -2px; border-radius: 8px; }
.dqw-row-summary[data-expandable] { cursor: pointer; }
.dqw-row-summary[data-expandable]:hover { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.12)); }
.dqw-row-summary:focus-visible { outline: 1px solid var(--dsw-alias-button-primary-fill, #5b8def); outline-offset: -1px; }
.dqw-row-summary.is-error { cursor: default; }
.dqw-label { font-size: 11px; font-weight: 600; width: 52px; flex: none; }
.dqw-label[data-action="refresh"] { cursor: pointer; border-radius: 4px; }
.dqw-label[data-action="refresh"]:hover { opacity: .75; }
.dqw-bar { display: block; flex: 0 0 auto; width: 100px; height: 4px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.2)); }
.dqw-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-button-primary-fill, #5b8def); }
.dqw-bar-fill.warn { background: var(--dsw-alias-label-warning, #d29922); }
.dqw-bar-fill.danger { background: var(--dsw-alias-label-danger, #c93c3c); }
.dqw-pct { font-size: 10.5px; line-height: 14px; font-variant-numeric: tabular-nums; width: 30px; text-align: right; flex: none; }
.dqw-extra { font-size: 10px; line-height: 14px; opacity: .72; font-variant-numeric: tabular-nums; flex: none; min-width: 34px; text-align: right; }
.dqw-chev { font-size: 9px; line-height: 14px; opacity: .6; flex: none; width: 10px; text-align: center; }
.dqw-stale-mark { flex: none; font-size: 9px; line-height: 14px; color: var(--dsw-alias-label-warning, #b46900); cursor: help; }
.dqw-errtext { font-size: 10px; line-height: 14px; opacity: .7; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

/** Locale resolution follows the host, not just the browser: the DSH locale
 * feature mirrors its resolved preference (设置 → 语言) onto
 * `<html lang>` and keeps it updated on every switch, so prefer that signal
 * and fall back to navigator.language when the host has not synced yet. */
function localeFor(win) {
  const host = String(win?.document?.documentElement?.lang ?? '').trim()
  if (host !== '') return host.toLowerCase().startsWith('zh') ? 'zh' : 'en'
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
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'
  const dateParts = new Intl.DateTimeFormat(dateLocale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => dateParts.find((item) => item.type === type)?.value ?? ''
  const dateText = `${part('year')}/${part('month')}/${part('day')}`
  const timeText = new Intl.DateTimeFormat(dateLocale, { timeStyle: 'short' }).format(date)
  return `${dateText} ${timeText}`
}

function text(doc, tag, className, value) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  node.textContent = String(value ?? '')
  return node
}

function quotaIcon(doc) {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(namespace, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const dial = doc.createElementNS(namespace, 'circle')
  dial.setAttribute('cx', '12')
  dial.setAttribute('cy', '12')
  dial.setAttribute('r', '10')
  const ticks = doc.createElementNS(namespace, 'path')
  ticks.setAttribute('d', 'M12 2.4v1.6M12 20v1.6M2.4 12h1.6M20 12h1.6M5.2 5.2l1.1 1.1M18.8 18.8l-1.1-1.1M18.8 5.2l-1.1 1.1M5.2 18.8l1.1-1.1')
  const needle = doc.createElementNS(namespace, 'path')
  needle.setAttribute('d', 'M12 12l4.5-4')
  const hub = doc.createElementNS(namespace, 'circle')
  hub.setAttribute('cx', '12')
  hub.setAttribute('cy', '12')
  hub.setAttribute('r', '1.4')
  hub.setAttribute('fill', 'currentColor')
  hub.setAttribute('stroke', 'none')
  svg.append(dial, ticks, needle, hub)
  return svg
}

/** Double-chevron icon for the panel's back affordance. */
function backIcon(doc) {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(namespace, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const chevrons = doc.createElementNS(namespace, 'path')
  chevrons.setAttribute('d', 'M11 4 7 8l4 4M7 4 3 8l4 4')
  svg.append(chevrons)
  return svg
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
  if (doc.querySelector(CARD_SELECTOR) || doc.querySelector(FLOAT_SELECTOR)) return () => {}

  // Mutable so a host language switch (设置 → 语言 → <html lang>) re-renders
  // every surface with the new dictionary on the next pass — renderAll is the
  // one funnel all render paths share.
  let locale = localeFor(win)
  let copy = COPY[locale]
  const container = doc.createElement('div')
  container.dataset.dshQuotaWatchCard = ''
  container.dataset.dshPlugin = 'quota-watch'
  container.dataset.dshPart = 'sidebar-card'
  if (typeof container.attachShadow !== 'function') return () => {}
  // ADR 0001: the card and its stylesheet live inside an open shadow root, so
  // external actors cannot strip page-level style tags out from under it.
  const cardRoot = container.attachShadow({ mode: 'open' })
  let style = text(doc, 'style', '', STYLE_TEXT)
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
  cardRoot.append(style, card)
  // Details open in a viewport-level floating panel — the only detail surface.
  const panel = doc.createElement('div')
  panel.className = 'dqw-panel'
  panel.setAttribute('role', 'dialog')
  panel.dataset.dshQuotaWatchPanel = ''
  panel.hidden = true
  doc.body.append(panel)
  // Float shell host at the document root; survives sidebar absence entirely.
  const floatHost = doc.createElement('div')
  floatHost.dataset.dshQuotaWatchFloat = ''
  const floatRoot = floatHost.attachShadow({ mode: 'open' })
  floatRoot.append(text(doc, 'style', '', FLOAT_STYLE_TEXT))
  const buildCapsule = () => {
    const el = doc.createElement('div')
    el.className = 'dqw-capsule'
    el.dataset.dshQuotaWatchCapsule = ''
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    el.setAttribute('aria-haspopup', 'dialog')
    el.setAttribute('aria-expanded', 'false')
    el.append(
      text(doc, 'span', 'dqw-capsule-glm', ''),
      text(doc, 'span', 'dqw-capsule-sep', '·'),
      text(doc, 'span', 'dqw-capsule-copilot', ''),
    )
    return el
  }
  // Capsule is the only floating surface (0.1.1: the round ball was retired).
  let surface = buildCapsule()
  floatRoot.append(surface)
  /** The capsule is always present unless no provider reports anything. */
  const syncFloatVisibility = () => {
    surface.hidden = dataHidden
    floatHost.hidden = dataHidden
  }
  // Mount under <body>, NOT <html>: the DSH theme tokens (--dsw-alias-*) are
  // defined on <body>, and a sibling of <body> never inherits them — mounting
  // on documentElement silently stranded the float shell on hardcoded dark
  // fallbacks (broke the light theme). <body> is also transform-free, so
  // position:fixed stays viewport-anchored.
  doc.body.append(floatHost)
  /** Measured capsule size; zeros (jsdom / unpainted) fall back to the box. */
  const measureSurface = () => {
    const rect = surface.getBoundingClientRect()
    return rect.width > 0 ? { width: rect.width, height: rect.height } : FALLBACK_SIZE
  }
  /** Position = user preferred {x, y} clamped to viewport & safe-area insets. */
  const applyPosition = () => {
    const viewWidth = win.innerWidth ?? 1024
    const viewHeight = win.innerHeight ?? 768
    const viewport = { width: viewWidth, height: viewHeight }
    const size = measureSurface()
    const insets = readInsets()
    const pos = loadFloatPosition(win.localStorage) ?? {
      x: viewWidth - MARGIN - insets.right - size.width,
      y: viewHeight - MARGIN - insets.bottom - size.height,
    }
    // Clamped visually so a restored or shrunk window never lets the capsule fall outside.
    const point = clampPoint(pos, viewport, size, insets)
    floatHost.style.left = `${Math.round(point.x)}px`
    floatHost.style.top = `${Math.round(point.y)}px`
  }
  // Safe-area probe: env() insets ride computed padding; jsdom reports '' which
  // parseInset normalizes to 0, so tests without a stub see zero insets.
  const safeAreaProbe = text(doc, 'div', '', '')
  safeAreaProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);'
  floatRoot.append(safeAreaProbe)
  /** Live env(safe-area-inset-*) reading — re-probed on every use, so window
   * chrome changes (rotation, URL-bar collapse) need no explicit invalidation. */
  const readInsets = () => {
    try {
      const style = win.getComputedStyle(safeAreaProbe)
      return {
        top: parseInset(style?.paddingTop),
        right: parseInset(style?.paddingRight),
        bottom: parseInset(style?.paddingBottom),
        left: parseInset(style?.paddingLeft),
      }
    } catch {
      return ZERO_INSETS
    }
  }
  applyPosition()
  // Panel lives inside the float shadow root from now on (契约总表「归属时序」).
  floatRoot.append(panel)

  let suppressNextClick = false
  /** One rAF (or a synchronous fallback when the host has none) — drag frames
   * and scroll re-placement share this gate so a burst of events costs one
   * layout read/write per frame. */
  const scheduleFrame = (fn) => (
    typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.call(win, fn) : fn()
  )
  /** Grab-offset + transform drag (ADR 0002): the pill keeps its grab point
   * under the cursor, moves via transform during the gesture (rAF-batched,
   * live-clamped to the measured size), and the dock is persisted on release —
   * optionally through a short snap transition when motion is allowed.
   * Move/up listen on `document` — pointer events always bubble there, in
   * browsers and jsdom alike. Returns a dispose function. */
  const attachDrag = (surfaceEl) => {
    let dragging = false
    let moved = false
    let originX = 0
    let originY = 0
    let slop = DRAG_SLOP_MOUSE
    let grab = { dx: 0, dy: 0 }
    let dragSize = FALLBACK_SIZE
    let restX = 0
    let restY = 0
    let lastPoint = null
    /** Doc-level move/up/cancel are bound only while a gesture is active —
     * the pill's resting state costs zero document-level listeners. */
    const bindGesture = () => {
      doc.addEventListener('pointermove', onPointerMove)
      doc.addEventListener('pointerup', onPointerUp)
      doc.addEventListener('pointercancel', onPointerCancel)
    }
    const unbindGesture = () => {
      doc.removeEventListener('pointermove', onPointerMove)
      doc.removeEventListener('pointerup', onPointerUp)
      doc.removeEventListener('pointercancel', onPointerCancel)
    }
    const onPointerDown = (event) => {
      if (event.button !== 0) return
      dragging = true
      moved = false
      originX = event.clientX
      originY = event.clientY
      // Graded slop: touch/pen get 10px so taps win over drags (Task 6).
      slop = dragSlop(event.pointerType)
      const rect = surfaceEl.getBoundingClientRect()
      grab = grabOffset({ x: event.clientX, y: event.clientY }, rect)
      dragSize = rect.width > 0 ? { width: rect.width, height: rect.height } : FALLBACK_SIZE
      restX = Number.parseFloat(floatHost.style.left) || 0
      restY = Number.parseFloat(floatHost.style.top) || 0
      surfaceEl.setPointerCapture?.(event.pointerId)
      bindGesture()
    }
    const onPointerMove = (event) => {
      if (!dragging) return
      if (!moved) {
        if (Math.hypot(event.clientX - originX, event.clientY - originY) < slop) return
        moved = true
        doc.body.style.userSelect = 'none'
        surfaceEl.classList.add('dqw-capsule--dragging')
      }
      lastPoint = { x: event.clientX, y: event.clientY }
      scheduleFrame(() => {
        if (!dragging || !lastPoint || disposed) return
        const viewWidth = win.innerWidth ?? 1024
        const viewHeight = win.innerHeight ?? 768
        const insets = readInsets()
        const topLeft = clampFrame(lastPoint, grab, dragSize, { width: viewWidth, height: viewHeight }, insets)
        const dx = topLeft.x - restX
        const dy = topLeft.y - restY
        floatHost.style.willChange = 'transform'
        floatHost.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`
      })
    }
    const finishDragRelease = (point) => {
      surfaceEl.classList.remove('dqw-capsule--dragging')
      floatHost.style.willChange = ''
      floatHost.style.transform = ''
      saveFloatPosition(win.localStorage, point)
      applyPosition()
      suppressNextClick = true
    }
    const onPointerUp = (event) => {
      if (!dragging) return
      dragging = false
      unbindGesture()
      doc.body.style.userSelect = ''
      if (!moved) return
      const viewWidth = win.innerWidth ?? 1024
      const viewHeight = win.innerHeight ?? 768
      const insets = readInsets()
      const viewport = { width: viewWidth, height: viewHeight }
      const point = clampFrame(
        { x: event.clientX, y: event.clientY },
        grab,
        dragSize,
        viewport,
        insets,
      )
      suppressNextClick = true
      finishDragRelease(point)
    }
    /** A canceled pointer (scroll takeover, incoming call, palm) resets the
     * gesture: no position is persisted and the trailing click stays allowed. */
    const onPointerCancel = () => {
      if (!dragging) return
      dragging = false
      unbindGesture()
      doc.body.style.userSelect = ''
      surfaceEl.classList.remove('dqw-capsule--dragging')
      floatHost.style.willChange = ''
      floatHost.style.transform = ''
    }
    surfaceEl.addEventListener('pointerdown', onPointerDown)
    const disposeDrag = () => {
      surfaceEl.removeEventListener('pointerdown', onPointerDown)
      unbindGesture()
    }
    return disposeDrag
  }
  let snapshot
  let requestSequence = 0
  let timer
  let disposed = false
  let queuedPlace = false
  let openKey
  let panelNav = false
  let dataHidden = false
  let surfaceFlags = loadSurfaceFlags(win.localStorage)
  const setCardHidden = (hidden) => {
    surfaceFlags = { cardHidden: hidden }
    saveSurfaceFlags(win.localStorage, surfaceFlags)
    renderAll()
  }

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

  /** Panel chrome: optional back, title, always a close affordance. */
  const panelHeader = ({ title, showBack = false }) => {
    const header = doc.createElement('div')
    header.className = 'dqw-panel-header'
    if (showBack) {
      const back = doc.createElement('button')
      back.type = 'button'
      back.className = 'dqw-panel-back'
      back.dataset.action = 'back-to-overview'
      back.setAttribute('aria-label', copy.backToOverview)
      back.title = copy.backToOverview
      back.append(backIcon(doc))
      header.append(back)
    }
    header.append(text(doc, 'p', 'dqw-panel-title', title))
    const close = doc.createElement('button')
    close.type = 'button'
    close.className = 'dqw-panel-close'
    close.dataset.action = 'panel-close'
    close.setAttribute('aria-label', copy.close)
    close.title = copy.close
    close.append(text(doc, 'span', '', '✕'))
    header.append(close)
    return header
  }

  /** Panel footer: the card toggle and a manual refresh sit side by side in an
   * equal-width grid (perceived width is the box, not the glyph count, so the
   * 1fr/1fr columns also survive label flips and other locales). This replaces
   * the retired capsule context menu: one click surface, no hidden gestures,
   * and it renders even in the loading/error empty state. */
  const overviewActions = () => {
    const actions = doc.createElement('div')
    actions.className = 'dqw-panel-actions'
    if (hasCardMount()) {
      const toggle = doc.createElement('button')
      toggle.type = 'button'
      toggle.className = 'dqw-panel-action'
      toggle.dataset.action = 'toggle-card'
      const toggleLabel = surfaceFlags.cardHidden ? copy.actions.showCard : copy.actions.hideCard
      toggle.textContent = toggleLabel
      toggle.setAttribute('aria-label', toggleLabel)
      actions.append(toggle)
    }
    const refresh = doc.createElement('button')
    refresh.type = 'button'
    refresh.className = 'dqw-panel-action'
    refresh.dataset.action = 'panel-refresh'
    refresh.textContent = copy.actions.refreshNow
    refresh.setAttribute('aria-label', copy.actions.refreshNow)
    actions.append(refresh)
    return actions
  }

  const renderOverview = () => {
    panel.replaceChildren(panelHeader({ title: copy.title }))
    const providers = snapshot?.providers ?? []
    const glm = providers.find((provider) => provider?.key === 'glm')
    const copilot = providers.find((provider) => provider?.key === 'copilot')
    // The overview reuses the card's row-summary renderer verbatim so the
    // panel looks exactly like the 0.0.18 sidebar rows (label · bar · percent
    // · extra · chevron).
    const rows = [
      renderProvider('glm', glmRowModel(glm)),
      renderProvider('copilot', copilotRowModel(copilot)),
    ].filter(Boolean).flat()
    if (rows.length === 0) {
      panel.append(text(doc, 'p', 'dqw-muted', lastUpdated.textContent || copy.loading))
    } else {
      const list = doc.createElement('div')
      list.className = 'dqw-overview-list'
      list.append(...rows)
      // Tag the reused rows for the panel's own click/keyboard routing.
      for (const row of list.querySelectorAll('[data-dsh-quota-watch-row]')) {
        row.dataset.dshQuotaWatchPanelProvider = row.dataset.dshQuotaWatchRow
      }
      panel.append(list)
    }
    panel.append(overviewActions())
  }

  function renderDetail(detail, key, provider, fromPanelNav = false) {
    detail.replaceChildren()
    detail.append(panelHeader({ title: copy.providerNames[key], showBack: fromPanelNav }))
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
        wins.append(text(doc, 'span', 'dqw-kv-sub', reset ? `${copy.noteOpen}${copy.reset}: ${reset}${copy.noteClose}` : ''))
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

  /** Anchor the panel beside its opener (a card row today, the float surface later). */
  // Anchor resolver: card rows are re-created on every render pass, so keep a
  // "how to find the anchor" closure instead of a detached element reference
  // (a detached node's getBoundingClientRect is all zeros → panel teleports).
  let lastAnchor = null
  const anchorFromRow = (key) => () => body.querySelector(`[data-dsh-quota-watch-row="${key}"]`)
  const anchorFromEl = (el) => () => el
  const placePanel = () => {
    if (panel.hidden) return
    const anchor = lastAnchor?.()
    if (!anchor || !anchor.isConnected) return
    if ((win.innerWidth ?? 1024) <= 480) {
      // Narrow viewport (phones): dock the panel to the bottom instead of
      // squeezing it beside the capsule — the sheet is CSS-positioned, so the
      // inline anchor coordinates are dropped.
      panel.classList.add('dqw-panel--sheet')
      panel.style.left = ''
      panel.style.top = ''
      return
    }
    panel.classList.remove('dqw-panel--sheet')
    const rect = anchor.getBoundingClientRect()
    const viewWidth = win.innerWidth ?? 1024
    const viewHeight = win.innerHeight ?? 768
    const width = panel.offsetWidth || 240
    const height = panel.offsetHeight || 160
    let left = rect.right + 8
    if (left + width > viewWidth - 8) left = rect.left - width - 8
    if (left + width > viewWidth - 8) left = viewWidth - width - 8
    left = Math.max(8, left)
    const top = Math.min(Math.max(rect.top, 8), Math.max(8, viewHeight - height - 8))
    panel.style.left = `${Math.round(left)}px`
    panel.style.top = `${Math.round(top)}px`
  }

  const syncPop = () => {
    if (openKey === undefined || disposed) {
      panel.hidden = true
      panel.replaceChildren()
      delete panel.dataset.dshQuotaWatchPanelDetail
      delete panel.dataset.dshQuotaWatchPanelOverview
      lastAnchor = null
      panelNav = false
      surface.setAttribute('aria-expanded', 'false')
      return
    }
    if (openKey === 'overview') {
      renderOverview()
      delete panel.dataset.dshQuotaWatchPanelDetail
      panel.dataset.dshQuotaWatchPanelOverview = ''
      panel.setAttribute('aria-label', copy.title)
      panel.hidden = false
      placePanel()
      surface.setAttribute('aria-expanded', 'true')
      return
    }
    const provider = (snapshot?.providers ?? []).find((item) => item?.key === openKey)
    const row = body.querySelector(`[data-dsh-quota-watch-row="${openKey}"]`)
    if (!provider || (!panelNav && (!row || !row.hasAttribute('data-expandable')))) {
      openKey = undefined
      syncPop()
      return
    }
    renderDetail(panel, openKey, provider, panelNav)
    panel.dataset.dshQuotaWatchPanelDetail = openKey
    delete panel.dataset.dshQuotaWatchPanelOverview
    panel.setAttribute('aria-label', panelNav ? `${copy.providerNames[openKey]} · ${copy.title}` : copy.providerNames[openKey])
    panel.hidden = false
    placePanel()
    surface.setAttribute('aria-expanded', 'true')
  }

  const renderFloatFace = () => {
    const providers = snapshot?.providers ?? []
    const glm = glmRowModel(providers.find((provider) => provider?.key === 'glm'))
    const copilot = copilotRowModel(providers.find((provider) => provider?.key === 'copilot'))
    dataHidden = glm === null && copilot === null
    if (dataHidden && openKey !== undefined) {
      openKey = undefined
      syncPop()
    }
    syncFloatVisibility()
    if (floatHost.hidden) return
    const paint = (span, model) => {
      const visible = model !== null && typeof model.percent === 'number' && Number.isFinite(model.percent)
      span.textContent = visible ? `${model.label} ${formatPercent(model.percent, locale)}` : ''
      span.classList.toggle('warn', visible && model.percent > 80 && model.percent <= 95)
      span.classList.toggle('danger', visible && model.percent > 95)
      return visible
    }
    const glmVisible = paint(surface.querySelector('.dqw-capsule-glm'), glm)
    const copilotVisible = paint(surface.querySelector('.dqw-capsule-copilot'), copilot)
    surface.querySelector('.dqw-capsule-sep').hidden = !glmVisible || !copilotVisible
    const alert = [glm, copilot].some((model) => model !== null && typeof model.percent === 'number' && model.percent > 95)
    if (alert) surface.setAttribute('data-alert', 'true')
    else surface.removeAttribute('data-alert')
    const summary = [glm, copilot]
      .filter(Boolean)
      .map((model) => `${model.label} ${formatPercent(model.percent, locale)}`)
      .join(' · ')
    const label = summary === '' ? copy.title : locale === 'zh' ? `${copy.title}：${summary}` : `${copy.title}: ${summary}`
    surface.setAttribute('aria-label', label)
    surface.title = label
    applyPosition()
  }

  const onSurfaceClick = () => {
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    // Toggle semantics (same as the 0.0.18 rail): any open panel closes first.
    if (openKey !== undefined && !panel.hidden) {
      openKey = undefined
      syncPop()
      return
    }
    openOverview(surface)
  }
  const onSurfaceKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSurfaceClick()
  }
  const hasCardMount = () => Boolean(footArea(doc))

  // Cross-profile narrow-container detection: a measurably narrow foot would
  // clip the card into unreadable text regardless of HOW the host signals its
  // collapsed state — hide the card and let the capsule carry the entry.
  // clientWidth 0 (no layout yet, jsdom) counts as "unknown", not narrow.
  let currentFoot = null
  let footTooNarrow = false
  let noDataHidden = false
  const syncFootNarrowness = () => {
    footTooNarrow = currentFoot !== null && currentFoot.clientWidth > 0 && currentFoot.clientWidth < CARD_MIN_WIDTH
  }
  const syncCardVisibility = () => {
    syncFootNarrowness()
    // Rail entry follows the WIDTH signal, not the host attribute: this DSH
    // build (0.2.0-rc.2 web) never writes data-sidebar-collapsed on collapse
    // (verified via CDP + bundle grep), but the foot container measurably
    // narrows — and the 36px gauge icon fits any rail.
    // The sidebar card shows ONLY in an expanded sidebar: the width guard hides
    // it in narrow rails / squeezed containers (works on every profile), and no
    // host collapse signal is consulted at all (they proved host-specific).
    const showCard = !surfaceFlags.cardHidden && !footTooNarrow && !noDataHidden
    container.hidden = !showCard
    card.style.display = showCard ? '' : 'none'
  }
  const footResizeObserver = typeof win.ResizeObserver === 'function'
    ? new win.ResizeObserver(() => { syncCardVisibility() })
    : null
  const renderAll = () => {
    locale = localeFor(win)
    copy = COPY[locale]
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
    noDataHidden = glmParts === null && copilotParts === null
    syncCardVisibility()
    const updated = formatTime(snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : '', locale)
    if (updated) {
      lastUpdated.hidden = true
    } else {
      lastUpdated.hidden = false
      lastUpdated.textContent = copy.loading
    }
    syncPop()
    renderFloatFace()
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
    if (currentFoot !== foot) {
      currentFoot = foot
      footResizeObserver?.disconnect()
      footResizeObserver?.observe(foot)
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

  const observer = new win.MutationObserver(() => {
    schedulePlace()
  })
  observer.observe(doc.body, { childList: true, subtree: true })
  // The DSH locale feature mirrors every language switch onto <html lang>;
  // re-render on that flip so the UI follows 设置 → 语言 without a reload.
  // A no-op flip (same value) never fires, so this costs nothing at rest.
  const langObserver = typeof win.MutationObserver === 'function'
    ? new win.MutationObserver(() => { if (!disposed) renderAll() })
    : null
  langObserver?.observe(doc.documentElement, { attributeFilter: ['lang'] })
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
    panelNav = false
    lastAnchor = anchorFromRow(key)
    openKey = openKey === key ? undefined : key
    renderAll()
  }
  const openOverview = (anchorEl) => {
    panelNav = false
    lastAnchor = anchorFromEl(anchorEl)
    openKey = 'overview'
    syncPop()
  }
  const onPanelClick = (event) => {
    // Panel-scoped actions (the retired context menu now lives here): buttons
    // sit inside this shadow tree, so a panel-level listener sees the real
    // target with no retargeting ambiguity.
    if (event.target?.closest?.('[data-action="panel-refresh"]')) {
      void poll(true)
      return
    }
    if (event.target?.closest?.('[data-action="toggle-card"]')) {
      // renderAll → syncPop → renderOverview re-renders the footer, so the
      // label flips in place while the panel stays open.
      setCardHidden(!surfaceFlags.cardHidden)
      return
    }
    if (event.target?.closest?.('[data-action="panel-close"]')) {
      openKey = undefined
      syncPop()
      return
    }
    if (event.target?.closest?.('[data-action="back-to-overview"]')) {
      openKey = 'overview'
      syncPop()
      return
    }
    const provider = event.target?.closest?.('[data-dsh-quota-watch-panel-provider]')
    if (provider) {
      openKey = provider.dataset.dshQuotaWatchPanelProvider
      panelNav = true
      syncPop()
    }
  }
  // Both handlers ride the card's inner body element — INSIDE the card shadow
  // root — so shadow-host retargeting never applies and event.target is the
  // real row/label in every browser.
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
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    if (path.includes(panel) || path.includes(container)) return
    const target = event.target
    if (target === panel || target === container) return
    if (target?.getRootNode?.() === cardRoot || target?.getRootNode?.() === floatRoot) return
    openKey = undefined
    renderAll()
  }
  let scrollFrameQueued = false
  const onDocScroll = () => {
    // Coalesce scroll bursts into one placement per frame (mobile inertia).
    if (scrollFrameQueued || disposed) return
    scrollFrameQueued = true
    scheduleFrame(() => {
      scrollFrameQueued = false
      if (!disposed) placePanel()
    })
  }
  const onWinResize = () => {
    placePanel()
    syncCardVisibility()
    applyPosition()
  }
  const onDocKeydown = (event) => {
    if (event.key !== 'Escape') return
    if (openKey !== undefined) {
      openKey = undefined
      renderAll()
    }
  }
  body.addEventListener('click', onBodyClick)
  body.addEventListener('keydown', onBodyKeydown)
  panel.addEventListener('click', onPanelClick)
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target?.closest?.('[data-dsh-quota-watch-panel-provider][data-expandable]')
    if (!row) return
    event.preventDefault()
    openKey = row.dataset.dshQuotaWatchPanelProvider
    panelNav = true
    syncPop()
  })
  surface.addEventListener('click', onSurfaceClick)
  surface.addEventListener('keydown', onSurfaceKeydown)
  let disposeDrag = attachDrag(surface)
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
    langObserver?.disconnect()
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    doc.removeEventListener('pointerdown', onDocPointerDown, true)
    doc.removeEventListener('scroll', onDocScroll, true)
    doc.removeEventListener('keydown', onDocKeydown)
    win.removeEventListener('resize', onWinResize)
    body.removeEventListener('click', onBodyClick)
    body.removeEventListener('keydown', onBodyKeydown)
    panel.removeEventListener('click', onPanelClick)
    surface.removeEventListener('click', onSurfaceClick)
    surface.removeEventListener('keydown', onSurfaceKeydown)
    disposeDrag()
    // A dispose landing mid-gesture must not leave the body unselectable.
    doc.body.style.userSelect = ''
    container.remove()
    panel.remove()
    floatHost.remove()
  }
}

export function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), 'dsh-quota-watch: sidebar')
}
