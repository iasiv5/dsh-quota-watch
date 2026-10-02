window.__ModuleLoader__.load({
	id: "@iasiv5/dsh-quota-watch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.mjs
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  mountQuotaCard: () => mountQuotaCard,
  name: () => name
});
module.exports = __toCommonJS(client_exports);

// src/shared.mjs
var API_PREFIX = "/api/dsh-quota-watch";
var ROUTES = Object.freeze({
  overview: `${API_PREFIX}/overview`,
  refresh: `${API_PREFIX}/refresh`
});
var CLIENT_ROUTES = Object.freeze({
  overview: `${API_PREFIX.slice(1)}/overview`,
  refresh: `${API_PREFIX.slice(1)}/refresh`
});
var PROVIDER_IDS = Object.freeze({
  glmDomestic: "zai-coding-cn",
  glmInternational: "zai",
  glmInternationalLegacy: "zai-coding",
  copilot: "github-copilot"
});
var CLIENT_POLL_INTERVAL_MS = 3e4;

// src/core/adapters.mjs
var GLM_HOSTS = Object.freeze({
  "zai-coding-cn": "open.bigmodel.cn",
  zai: "api.z.ai",
  "zai-coding": "api.z.ai"
});
var GLM_WINDOW_KEYS = Object.freeze({ 3: "5h", 5: "month", 6: "week" });
var COPILOT_HEADERS = Object.freeze({
  accept: "application/json",
  "user-agent": "GitHubCopilotChat/0.35.0",
  "editor-version": "vscode/1.107.0",
  "editor-plugin-version": "copilot-chat/0.35.0",
  "copilot-integration-id": "vscode-chat"
});
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}
function remainingToUsed(percentRemaining) {
  const value = asNumber(percentRemaining);
  if (value === void 0 || value < 0 || value > 100) return void 0;
  return clampPercent(Math.round((100 - value) * 100) / 100);
}

// src/client/prefs.mjs
var FLOAT_GEOMETRY_KEY = "dsh-quota-watch:float-geometry";
var SURFACE_FLAGS_KEY = "dsh-quota-watch:surface-flags";
var MARGIN = 8;
function clampPoint(point, viewport, size = 0) {
  const minX = MARGIN;
  const minY = MARGIN;
  const maxX = Math.max(MARGIN, viewport.width - MARGIN - size);
  const maxY = Math.max(MARGIN, viewport.height - MARGIN - size);
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY)
  };
}
function loadFloatGeometry(storage) {
  try {
    const raw = storage.getItem(FLOAT_GEOMETRY_KEY);
    if (typeof raw !== "string" || raw === "") return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}
function saveFloatGeometry(storage, point) {
  try {
    storage.setItem(FLOAT_GEOMETRY_KEY, JSON.stringify({ x: point.x, y: point.y }));
  } catch {
  }
}
function loadSurfaceFlags(storage) {
  try {
    const raw = storage.getItem(SURFACE_FLAGS_KEY);
    if (typeof raw !== "string" || raw === "") return { cardHidden: true };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.cardHidden !== "boolean") {
      return { cardHidden: true };
    }
    return { cardHidden: parsed.cardHidden };
  } catch {
    return { cardHidden: true };
  }
}
function saveSurfaceFlags(storage, flags) {
  try {
    storage.setItem(SURFACE_FLAGS_KEY, JSON.stringify({ cardHidden: Boolean(flags?.cardHidden) }));
  } catch {
  }
}

// src/client.mjs
var name = "quota-watch-client";
var inject = [];
var CARD_SELECTOR = "[data-dsh-quota-watch-card]";
var FLOAT_SELECTOR = "[data-dsh-quota-watch-float]";
var FETCH_TIMEOUT_MS = 15e3;
var SURFACE_SIZE = 38;
var SURFACE_MARGIN = 16;
var CARD_MIN_WIDTH = 160;
var COPY = {
  zh: {
    title: "Token\u989D\u5EA6",
    openDetails: "\u67E5\u770B\u8BE6\u60C5",
    close: "\u5173\u95ED",
    menu: {
      showCard: "\u663E\u793A\u4FA7\u8FB9\u680F\u5361\u7247",
      hideCard: "\u9690\u85CF\u4FA7\u8FB9\u680F\u5361\u7247",
      refreshNow: "\u7ACB\u5373\u5237\u65B0"
    },
    backToOverview: "\u8FD4\u56DE\u989D\u5EA6\u6982\u89C8",
    providerNames: { glm: "GLM", copilot: "Copilot" },
    refresh: "\u5237\u65B0",
    loading: "\u8BFB\u53D6\u4E2D",
    failed: "\u67E5\u8BE2\u5931\u8D25",
    stale: "\u6570\u636E\u53EF\u80FD\u5DF2\u8FC7\u671F",
    requestFailed: "\u5237\u65B0\u5931\u8D25\uFF0C\u663E\u793A\u4E0A\u6B21\u6210\u529F\u6570\u636E",
    available: "\u53EF\u7528\u989D\u5EA6",
    used: "\u672C\u671F\u5DF2\u7528",
    reset: "\u91CD\u7F6E",
    resetTime: "\u91CD\u7F6E\u65F6\u95F4",
    windowUsed: "\u5DF2\u7528",
    todayTokens: "\u4ECA\u65E5 Tokens",
    todayCalls: "\u8C03\u7528\u6B21\u6570",
    weekUnlimited: "\u6BCF\u5468\u989D\u5EA6",
    unlimited: "\u267E\uFE0F",
    unlimitedNote: "\uFF08 \u65E0\u9650 \uFF09",
    windows: {
      "5h": "5 \u5C0F\u65F6\u989D\u5EA6",
      week: "\u6BCF\u5468\u989D\u5EA6",
      month: "\u6BCF\u6708\u989D\u5EA6",
      mcp: "MCP\uFF08\u6708\uFF09"
    }
  },
  en: {
    title: "Quota Watch",
    openDetails: "View details",
    close: "Close",
    menu: {
      showCard: "Show sidebar card",
      hideCard: "Hide sidebar card",
      refreshNow: "Refresh now"
    },
    backToOverview: "Back to quota overview",
    providerNames: { glm: "GLM", copilot: "Copilot" },
    refresh: "Refresh",
    loading: "Loading",
    failed: "Query failed",
    stale: "Data may be stale",
    requestFailed: "Refresh failed; showing last successful data",
    available: "Available credits",
    used: "Used this cycle",
    reset: "Resets",
    resetTime: "Reset time",
    windowUsed: "used",
    todayTokens: "Today tokens",
    todayCalls: "Calls",
    weekUnlimited: "Weekly quota",
    unlimited: "\u267E\uFE0F",
    unlimitedNote: " ( unlimited )",
    windows: {
      "5h": "5-hour quota",
      week: "Weekly quota",
      month: "Monthly quota",
      mcp: "MCP (month)"
    }
  }
};
var STYLE_TEXT = `
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
.dqw-rail-trigger { display: none; flex: none; align-items: center; justify-content: center; width: 36px; height: 36px; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-primary, inherit); cursor: pointer; transition: background-color .12s, color .12s; }
.dqw-rail-trigger svg { display: block; width: 16px; height: 16px; }
.dqw-rail-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, inherit); }
.dqw-rail-trigger:active:not(:disabled), .dqw-rail-trigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-active, rgba(128,128,128,.18)); color: var(--dsw-alias-label-primary, inherit); }
.dqw-rail-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #5b8def); outline-offset: 2px; }
:host([data-dsh-quota-watch-sidebar-collapsed]) .dqw-card { display: none; }
:host([data-dsh-quota-watch-sidebar-collapsed]) .dqw-rail-trigger { display: inline-flex; }
@media print { :host { display: none !important; } }
`;
var FLOAT_STYLE_TEXT = `
:host { position: fixed; z-index: 2147483000; }
.dqw-capsule { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 999px; background: var(--dsw-alias-bg-base, rgba(128,128,128,.08)); background: color-mix(in srgb, var(--dsw-alias-bg-base, #1f1f1f) 86%, transparent); -webkit-backdrop-filter: blur(10px) saturate(1.2); backdrop-filter: blur(10px) saturate(1.2); box-shadow: 0 4px 14px rgba(0,0,0,.22); color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 11px; line-height: 24px; cursor: pointer; user-select: none; white-space: nowrap; }
.dqw-capsule:hover { border-color: var(--dsw-alias-border-primary, var(--dsw-alias-border-secondary, rgba(128,128,128,.35))); }
.dqw-capsule:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #5b8def); outline-offset: 2px; }
.dqw-capsule-sep { opacity: .5; }
.dqw-capsule-glm, .dqw-capsule-copilot { font-variant-numeric: tabular-nums; font-weight: 600; }
.dqw-capsule-glm.warn, .dqw-capsule-copilot.warn { color: var(--dsw-alias-label-warning, #d29922); }
.dqw-capsule-glm.danger, .dqw-capsule-copilot.danger { color: var(--dsw-alias-label-danger, #c93c3c); }
.dqw-capsule[hidden] { display: none; }
@media (prefers-reduced-motion: no-preference) {
  .dqw-capsule[data-alert] { animation: dqw-pulse 1.6s ease-in-out infinite; }
}
@media print { :host { display: none !important; } }
@keyframes dqw-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
.dqw-menu { position: fixed; min-width: 150px; padding: 4px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); background: color-mix(in srgb, var(--dsw-alias-bg-base, #1f1f1f) 88%, transparent); -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3); box-shadow: 0 8px 24px rgba(0,0,0,.25); color: var(--dsw-alias-label-primary, inherit); font: inherit; display: flex; flex-direction: column; }
.dqw-menu[hidden] { display: none; }
.dqw-menu-item { display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 11px; line-height: 16px; text-align: left; cursor: pointer; }
.dqw-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dqw-panel { position: fixed; z-index: 2147483000; min-width: 166px; max-width: min(320px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); background: color-mix(in srgb, var(--dsw-alias-bg-base, #1f1f1f) 86%, transparent); -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3); box-shadow: 0 8px 24px rgba(0,0,0,.25); color: var(--dsw-alias-label-primary, inherit); display: flex; flex-direction: column; gap: 8px; font: inherit; }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .dqw-panel { background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f)); } }
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
.dqw-bar { display: block; flex: 1; height: 4px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.2)); }
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
`;
function localeFor(win) {
  return String(win?.navigator?.language ?? "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
}
function formatNumber(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 1 }).format(value);
}
function formatCompact(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}
function formatPercent(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const clamped = Math.max(0, Math.min(100, value));
  const rounded = clamped >= 10 ? Math.round(clamped) : Number(clamped.toFixed(1));
  return `${formatNumber(rounded, locale)}%`;
}
function formatTime(value, locale) {
  if (typeof value !== "string" || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";
  const dateParts = new Intl.DateTimeFormat(dateLocale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => dateParts.find((item) => item.type === type)?.value ?? "";
  const dateText = `${part("year")}/${part("month")}/${part("day")}`;
  const timeText = new Intl.DateTimeFormat(dateLocale, { timeStyle: "short" }).format(date);
  return `${dateText} ${timeText}`;
}
function text(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value ?? "");
  return node;
}
function quotaIcon(doc) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const dial = doc.createElementNS(namespace, "circle");
  dial.setAttribute("cx", "12");
  dial.setAttribute("cy", "12");
  dial.setAttribute("r", "10");
  const ticks = doc.createElementNS(namespace, "path");
  ticks.setAttribute("d", "M12 2.4v1.6M12 20v1.6M2.4 12h1.6M20 12h1.6M5.2 5.2l1.1 1.1M18.8 18.8l-1.1-1.1M18.8 5.2l-1.1 1.1M5.2 18.8l1.1-1.1");
  const needle = doc.createElementNS(namespace, "path");
  needle.setAttribute("d", "M12 12l4.5-4");
  const hub = doc.createElementNS(namespace, "circle");
  hub.setAttribute("cx", "12");
  hub.setAttribute("cy", "12");
  hub.setAttribute("r", "1.4");
  hub.setAttribute("fill", "currentColor");
  hub.setAttribute("stroke", "none");
  svg.append(dial, ticks, needle, hub);
  return svg;
}
function menuItem(doc, action, label) {
  const item = doc.createElement("button");
  item.type = "button";
  item.className = "dqw-menu-item";
  item.setAttribute("role", "menuitem");
  item.dataset.menu = action;
  item.append(text(doc, "span", "", label));
  return item;
}
function backIcon(doc) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const chevrons = doc.createElementNS(namespace, "path");
  chevrons.setAttribute("d", "M11 4 7 8l4 4M7 4 3 8l4 4");
  svg.append(chevrons);
  return svg;
}
function kvRow(doc, label, value) {
  const row = doc.createElement("div");
  row.className = "dqw-kv";
  row.append(text(doc, "span", "dqw-kv-label", label), text(doc, "span", "dqw-kv-value", value));
  return row;
}
function glmRowModel(provider) {
  if (provider?.status === "missing") return null;
  if (provider?.status === "error") return { kind: "error", label: "GLM", error: provider.error };
  const windows = provider?.plan?.windows;
  if (!Array.isArray(windows) || windows.length === 0) return null;
  const five = windows.find((window) => window?.key === "5h");
  const tokens = provider?.usage?.status === "ready" || provider?.usage?.status === "stale" ? provider?.usage?.totalTokens : void 0;
  return {
    kind: "data",
    label: "GLM",
    percent: five?.percent,
    stale: provider.status === "stale",
    error: provider.error,
    extra: tokens
  };
}
function copilotRowModel(provider) {
  if (provider?.status === "missing") return null;
  if (provider?.status === "error") return { kind: "error", label: "Copilot", error: provider.error };
  const quota = provider?.quota;
  if (quota?.balanceAvailable !== true) return null;
  const used = remainingToUsed(quota.percentRemaining);
  if (used === void 0) return null;
  return {
    kind: "data",
    label: "Copilot",
    percent: used,
    stale: provider.status === "stale",
    error: provider.error,
    extra: typeof quota.creditsUsed === "number" && quota.creditsUsed >= 0 ? quota.creditsUsed : void 0
  };
}
function footArea(doc) {
  const sidebar = doc.querySelector('[class*="sidebarCol"]');
  return sidebar?.querySelector('[class*="footArea"]') ?? void 0;
}
async function fetchJson(fetchImpl, path, method) {
  const response = await fetchImpl(path, {
    ...method === "POST" ? { method: "POST" } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function mountQuotaCard({
  doc = globalThis.document,
  win = globalThis.window,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = CLIENT_POLL_INTERVAL_MS
} = {}) {
  if (!doc?.body || typeof fetchImpl !== "function") return () => {
  };
  if (doc.querySelector(CARD_SELECTOR) || doc.querySelector(FLOAT_SELECTOR)) return () => {
  };
  const locale = localeFor(win);
  const copy = COPY[locale];
  const container = doc.createElement("div");
  container.dataset.dshQuotaWatchCard = "";
  container.dataset.dshPlugin = "quota-watch";
  container.dataset.dshPart = "sidebar-card";
  if (typeof container.attachShadow !== "function") return () => {
  };
  const cardRoot = container.attachShadow({ mode: "open" });
  let style = text(doc, "style", "", STYLE_TEXT);
  const card = doc.createElement("section");
  card.className = "dqw-card";
  card.setAttribute("aria-label", copy.title);
  const body = doc.createElement("div");
  body.className = "dqw-body";
  const lastUpdated = text(doc, "p", "dqw-meta", copy.loading);
  lastUpdated.dataset.role = "updated";
  body.append(lastUpdated);
  const railTrigger = doc.createElement("button");
  railTrigger.type = "button";
  railTrigger.className = "dqw-rail-trigger";
  railTrigger.dataset.dshQuotaWatchRail = "";
  railTrigger.title = copy.title;
  railTrigger.setAttribute("aria-label", copy.title);
  railTrigger.setAttribute("aria-haspopup", "dialog");
  railTrigger.setAttribute("aria-expanded", "false");
  railTrigger.append(quotaIcon(doc));
  card.append(body, railTrigger);
  cardRoot.append(style, card);
  const panel = doc.createElement("div");
  panel.className = "dqw-panel";
  panel.setAttribute("role", "dialog");
  panel.dataset.dshQuotaWatchPanel = "";
  panel.hidden = true;
  doc.body.append(panel);
  const floatHost = doc.createElement("div");
  floatHost.dataset.dshQuotaWatchFloat = "";
  const floatRoot = floatHost.attachShadow({ mode: "open" });
  floatRoot.append(text(doc, "style", "", FLOAT_STYLE_TEXT));
  const buildCapsule = () => {
    const el = doc.createElement("div");
    el.className = "dqw-capsule";
    el.dataset.dshQuotaWatchCapsule = "";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-expanded", "false");
    el.append(
      text(doc, "span", "dqw-capsule-glm", ""),
      text(doc, "span", "dqw-capsule-sep", "\xB7"),
      text(doc, "span", "dqw-capsule-copilot", "")
    );
    return el;
  };
  let surface = buildCapsule();
  floatRoot.append(surface);
  const syncFloatVisibility = () => {
    surface.hidden = dataHidden;
    floatHost.hidden = dataHidden;
  };
  doc.documentElement.append(floatHost);
  const applyFloatGeometry = () => {
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const saved = loadFloatGeometry(win.localStorage);
    const point = clampPoint(
      saved ?? { x: viewWidth - SURFACE_MARGIN - SURFACE_SIZE, y: viewHeight - SURFACE_MARGIN - SURFACE_SIZE },
      { width: viewWidth, height: viewHeight },
      SURFACE_SIZE
    );
    floatHost.style.left = `${Math.round(point.x)}px`;
    floatHost.style.top = `${Math.round(point.y)}px`;
  };
  applyFloatGeometry();
  floatRoot.append(panel);
  const menu = doc.createElement("div");
  menu.className = "dqw-menu";
  menu.dataset.dshQuotaWatchMenu = "";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  floatRoot.append(menu);
  let suppressNextClick = false;
  const attachDrag = (surfaceEl) => {
    let dragging = false;
    let moved = false;
    let originX = 0;
    let originY = 0;
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      originX = event.clientX;
      originY = event.clientY;
      surfaceEl.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      if (!moved && Math.hypot(event.clientX - originX, event.clientY - originY) < 6) return;
      moved = true;
      doc.body.style.userSelect = "none";
      floatHost.style.left = `${Math.round(event.clientX)}px`;
      floatHost.style.top = `${Math.round(event.clientY)}px`;
    };
    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      doc.body.style.userSelect = "";
      if (!moved) return;
      const viewWidth = win.innerWidth ?? 1024;
      const viewHeight = win.innerHeight ?? 768;
      const point = clampPoint(
        { x: event.clientX, y: event.clientY },
        { width: viewWidth, height: viewHeight },
        SURFACE_SIZE
      );
      floatHost.style.left = `${Math.round(point.x)}px`;
      floatHost.style.top = `${Math.round(point.y)}px`;
      saveFloatGeometry(win.localStorage, point);
      suppressNextClick = true;
    };
    surfaceEl.addEventListener("pointerdown", onPointerDown);
    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    return () => {
      surfaceEl.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
    };
  };
  let snapshot;
  let requestSequence = 0;
  let timer;
  let disposed = false;
  let queuedPlace = false;
  let openKey;
  let panelNav = false;
  let dataHidden = false;
  let surfaceFlags = loadSurfaceFlags(win.localStorage);
  const setCardHidden = (hidden) => {
    surfaceFlags = { cardHidden: hidden };
    saveSurfaceFlags(win.localStorage, surfaceFlags);
    renderAll();
  };
  const fillClass = (percent) => percent > 95 ? "dqw-bar-fill danger" : percent > 80 ? "dqw-bar-fill warn" : "dqw-bar-fill";
  const renderProvider = (key, model) => {
    if (model === null) return null;
    const row = doc.createElement("div");
    row.className = "dqw-row-summary";
    row.dataset.dshQuotaWatchRow = key;
    const label = text(doc, "span", "dqw-label", model.label);
    label.dataset.action = "refresh";
    label.title = `${model.label} \xB7 ${copy.refresh}`;
    row.append(label);
    if (model.kind === "error") {
      row.classList.add("is-error");
      row.append(text(doc, "span", "dqw-errtext", model.error ? `${copy.failed}: ${model.error}` : copy.failed));
      return [row];
    }
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-expanded", String(openKey === key));
    row.dataset.expandable = "";
    if (typeof model.percent === "number" && Number.isFinite(model.percent)) {
      const bar = doc.createElement("span");
      bar.className = "dqw-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, model.percent))));
      const fill = text(doc, "span", fillClass(model.percent));
      fill.style.width = `${Math.max(0, Math.min(100, model.percent))}%`;
      bar.append(fill);
      row.append(bar);
    }
    if (model.stale) {
      const mark = text(doc, "span", "dqw-stale-mark", "\u26A0");
      mark.dataset.dshQuotaWatchStale = "";
      mark.title = model.error ?? copy.stale;
      row.append(mark);
    }
    row.append(text(doc, "span", "dqw-pct", typeof model.percent === "number" ? formatPercent(model.percent, locale) : "\u2014"));
    if (model.extra !== void 0) {
      const extra = text(doc, "span", "dqw-extra", formatCompact(model.extra, locale));
      extra.dataset.dshQuotaWatchExtra = "";
      row.append(extra);
    }
    row.append(text(doc, "span", "dqw-chev", openKey === key ? "\u25BE" : "\u25B8"));
    return [row];
  };
  const panelHeader = ({ title, showBack = false }) => {
    const header = doc.createElement("div");
    header.className = "dqw-panel-header";
    if (showBack) {
      const back = doc.createElement("button");
      back.type = "button";
      back.className = "dqw-panel-back";
      back.dataset.action = "back-to-overview";
      back.setAttribute("aria-label", copy.backToOverview);
      back.title = copy.backToOverview;
      back.append(backIcon(doc));
      header.append(back);
    }
    header.append(text(doc, "p", "dqw-panel-title", title));
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "dqw-panel-close";
    close.dataset.action = "panel-close";
    close.setAttribute("aria-label", copy.close);
    close.title = copy.close;
    close.append(text(doc, "span", "", "\u2715"));
    header.append(close);
    return header;
  };
  const renderOverview = () => {
    panel.replaceChildren(panelHeader({ title: copy.title }));
    const providers = snapshot?.providers ?? [];
    const glm = providers.find((provider) => provider?.key === "glm");
    const copilot = providers.find((provider) => provider?.key === "copilot");
    const rows = [
      renderProvider("glm", glmRowModel(glm)),
      renderProvider("copilot", copilotRowModel(copilot))
    ].filter(Boolean).flat();
    if (rows.length === 0) {
      panel.append(text(doc, "p", "dqw-muted", lastUpdated.textContent || copy.loading));
      return;
    }
    const list = doc.createElement("div");
    list.className = "dqw-overview-list";
    list.append(...rows);
    for (const row of list.querySelectorAll("[data-dsh-quota-watch-row]")) {
      row.dataset.dshQuotaWatchPanelProvider = row.dataset.dshQuotaWatchRow;
    }
    panel.append(list);
  };
  function renderDetail(detail, key, provider, fromPanelNav = false) {
    detail.replaceChildren();
    detail.append(panelHeader({ title: copy.providerNames[key], showBack: fromPanelNav }));
    if (provider?.status === "stale") {
      detail.append(text(doc, "p", "dqw-error", `${copy.stale}${provider.error ? `: ${provider.error}` : ""}`));
    }
    if (key === "glm") {
      const usage = provider?.usage;
      const numbers = doc.createElement("div");
      numbers.className = "dqw-bignums";
      const tokensBig = doc.createElement("div");
      tokensBig.className = "dqw-big";
      tokensBig.append(
        text(doc, "div", "dqw-big-value", formatCompact(usage?.totalTokens, locale)),
        text(doc, "div", "dqw-big-label", copy.todayTokens)
      );
      const callsBig = doc.createElement("div");
      callsBig.className = "dqw-big";
      callsBig.append(
        text(doc, "div", "dqw-big-value", formatNumber(usage?.totalCalls, locale)),
        text(doc, "div", "dqw-big-label", copy.todayCalls)
      );
      numbers.append(tokensBig, callsBig);
      detail.append(numbers);
      const raw = Array.isArray(provider?.plan?.windows) ? provider.plan.windows : [];
      const order = { mcp: 0, "5h": 1, month: 2, week: 3 };
      const sorted = [...raw].sort((a, b) => (order[a?.key] ?? 99) - (order[b?.key] ?? 99));
      const items = [];
      let weekPlaced = false;
      for (const window of sorted) {
        if (!weekPlaced && (order[window?.key] ?? 99) > order.week) {
          items.push({ placeholder: true });
          weekPlaced = true;
        }
        if (window?.key === "week") weekPlaced = true;
        items.push({ window });
      }
      if (!weekPlaced) items.push({ placeholder: true });
      const wins = doc.createElement("div");
      wins.className = "dqw-wins";
      for (const item of items) {
        if (item.placeholder) {
          wins.append(
            text(doc, "span", "dqw-win-name", copy.weekUnlimited),
            text(doc, "span", "dqw-win-mid", "\xB7"),
            text(doc, "span", "dqw-win-used", copy.unlimited),
            text(doc, "span", ""),
            text(doc, "span", "dqw-kv-sub", copy.unlimitedNote)
          );
          continue;
        }
        const window = item.window;
        const percent = typeof window?.percent === "number" && Number.isFinite(window.percent) ? window.percent : void 0;
        const reset = formatTime(window?.resetsAt, locale);
        wins.append(text(doc, "span", "dqw-win-name", copy.windows[window?.key] ?? window?.key));
        wins.append(text(doc, "span", "dqw-win-mid", "\xB7"));
        wins.append(text(doc, "span", "dqw-win-used", copy.windowUsed));
        wins.append(text(doc, "span", "dqw-win-val", percent !== void 0 ? formatPercent(percent, locale) : "\u2014"));
        wins.append(text(doc, "span", "dqw-kv-sub", reset ? `\uFF08 ${copy.reset}: ${reset} \uFF09` : ""));
      }
      detail.append(wins);
      if (Array.isArray(usage?.models) && usage.models.length > 0) {
        const models = doc.createElement("div");
        models.className = "dqw-models";
        for (const model of usage.models) {
          const row = doc.createElement("div");
          row.className = "dqw-model-row";
          row.append(
            text(doc, "span", "dqw-model-name", model?.name ?? "\u2014"),
            text(doc, "span", "dqw-model-value", formatCompact(model?.tokens, locale))
          );
          models.append(row);
        }
        detail.append(models);
      }
      return;
    }
    const quota = provider?.quota;
    if (quota?.balanceAvailable === true) {
      detail.append(kvRow(doc, copy.available, `${formatNumber(quota.remaining, locale)} / ${formatNumber(quota.entitlement, locale)}`));
      const used = remainingToUsed(quota.percentRemaining);
      if (typeof quota.creditsUsed === "number" && quota.creditsUsed >= 0) {
        const row = doc.createElement("div");
        row.className = "dqw-kv";
        const value = doc.createElement("span");
        value.className = "dqw-kv-value";
        value.append(text(doc, "span", "", formatNumber(quota.creditsUsed, locale)));
        if (used !== void 0) value.append(text(doc, "span", "dqw-kv-sub", ` \xB7 ${formatPercent(used, locale)}`));
        row.append(text(doc, "span", "dqw-kv-label", copy.used), value);
        detail.append(row);
      }
      const reset = formatTime(quota?.resetsAt, locale);
      if (reset) detail.append(kvRow(doc, copy.resetTime, reset));
    } else {
      detail.append(text(doc, "p", "dqw-muted", copy.stale));
    }
  }
  let lastAnchor = null;
  const anchorFromRow = (key) => () => body.querySelector(`[data-dsh-quota-watch-row="${key}"]`);
  const anchorFromEl = (el) => () => el;
  const placePanel = () => {
    if (panel.hidden) return;
    const anchor = lastAnchor?.();
    if (!anchor || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const width = panel.offsetWidth || 240;
    const height = panel.offsetHeight || 160;
    let left = rect.right + 8;
    if (left + width > viewWidth - 8) left = rect.left - width - 8;
    if (left + width > viewWidth - 8) left = viewWidth - width - 8;
    left = Math.max(8, left);
    const top = Math.min(Math.max(rect.top, 8), Math.max(8, viewHeight - height - 8));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  };
  const syncPop = () => {
    if (openKey === void 0 || disposed) {
      panel.hidden = true;
      panel.replaceChildren();
      delete panel.dataset.dshQuotaWatchPanelDetail;
      delete panel.dataset.dshQuotaWatchPanelOverview;
      lastAnchor = null;
      panelNav = false;
      surface.setAttribute("aria-expanded", "false");
      railTrigger.setAttribute("aria-expanded", "false");
      return;
    }
    if (openKey === "overview") {
      renderOverview();
      delete panel.dataset.dshQuotaWatchPanelDetail;
      panel.dataset.dshQuotaWatchPanelOverview = "";
      panel.setAttribute("aria-label", copy.title);
      panel.hidden = false;
      placePanel();
      surface.setAttribute("aria-expanded", "true");
      railTrigger.setAttribute("aria-expanded", "true");
      return;
    }
    const provider = (snapshot?.providers ?? []).find((item) => item?.key === openKey);
    const row = body.querySelector(`[data-dsh-quota-watch-row="${openKey}"]`);
    if (!provider || !panelNav && (!row || !row.hasAttribute("data-expandable"))) {
      openKey = void 0;
      syncPop();
      return;
    }
    renderDetail(panel, openKey, provider, panelNav);
    panel.dataset.dshQuotaWatchPanelDetail = openKey;
    delete panel.dataset.dshQuotaWatchPanelOverview;
    panel.setAttribute("aria-label", panelNav ? `${copy.providerNames[openKey]} \xB7 ${copy.title}` : copy.providerNames[openKey]);
    panel.hidden = false;
    placePanel();
    surface.setAttribute("aria-expanded", "true");
    railTrigger.setAttribute("aria-expanded", "true");
  };
  const renderFloatFace = () => {
    const providers = snapshot?.providers ?? [];
    const glm = glmRowModel(providers.find((provider) => provider?.key === "glm"));
    const copilot = copilotRowModel(providers.find((provider) => provider?.key === "copilot"));
    dataHidden = glm === null && copilot === null;
    if (dataHidden && openKey !== void 0) {
      openKey = void 0;
      syncPop();
    }
    syncFloatVisibility();
    if (floatHost.hidden) return;
    const paint = (span, model) => {
      const visible = model !== null && typeof model.percent === "number" && Number.isFinite(model.percent);
      span.textContent = visible ? `${model.label} ${formatPercent(model.percent, locale)}` : "";
      span.classList.toggle("warn", visible && model.percent > 80 && model.percent <= 95);
      span.classList.toggle("danger", visible && model.percent > 95);
      return visible;
    };
    const glmVisible = paint(surface.querySelector(".dqw-capsule-glm"), glm);
    const copilotVisible = paint(surface.querySelector(".dqw-capsule-copilot"), copilot);
    surface.querySelector(".dqw-capsule-sep").hidden = !glmVisible || !copilotVisible;
    const alert = [glm, copilot].some((model) => model !== null && typeof model.percent === "number" && model.percent > 95);
    if (alert) surface.setAttribute("data-alert", "true");
    else surface.removeAttribute("data-alert");
    const summary = [glm, copilot].filter(Boolean).map((model) => `${model.label} ${formatPercent(model.percent, locale)}`).join(" \xB7 ");
    const label = summary === "" ? copy.title : locale === "zh" ? `${copy.title}\uFF1A${summary}` : `${copy.title}: ${summary}`;
    surface.setAttribute("aria-label", label);
    surface.title = label;
  };
  const onSurfaceClick = () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (openKey !== void 0 && !panel.hidden) {
      openKey = void 0;
      syncPop();
      return;
    }
    openOverview(surface);
  };
  const onSurfaceKeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSurfaceClick();
  };
  const hasCardMount = () => Boolean(footArea(doc));
  const openMenu = () => {
    const items = [];
    if (hasCardMount()) {
      items.push(menuItem(doc, "toggle-card", surfaceFlags.cardHidden ? copy.menu.showCard : copy.menu.hideCard));
    }
    items.push(menuItem(doc, "refresh", copy.menu.refreshNow));
    menu.replaceChildren(...items);
    menu.hidden = false;
    const rect = surface.getBoundingClientRect();
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const width = menu.offsetWidth || 150;
    const height = menu.offsetHeight || 120;
    let left = rect.right + 8;
    if (left + width > viewWidth - 8) left = Math.max(8, rect.left - width - 8);
    const top = Math.min(Math.max(rect.top, 8), Math.max(8, viewHeight - height - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };
  const onSurfaceContext = (event) => {
    event.preventDefault();
    openMenu();
  };
  const onRailClick = () => {
    if (openKey !== void 0 && !panel.hidden) {
      openKey = void 0;
      syncPop();
      return;
    }
    openOverview(railTrigger);
  };
  const onMenuClick = (event) => {
    const item = event.target?.closest?.("[data-menu]");
    if (!item) return;
    const action = item.dataset.menu;
    if (action === "toggle-card") {
      setCardHidden(!surfaceFlags.cardHidden);
    } else if (action === "refresh") {
      void poll(true);
    }
    menu.hidden = true;
  };
  menu.addEventListener("click", onMenuClick);
  let currentFoot = null;
  let footTooNarrow = false;
  let noDataHidden = false;
  const syncFootNarrowness = () => {
    footTooNarrow = currentFoot !== null && currentFoot.clientWidth > 0 && currentFoot.clientWidth < CARD_MIN_WIDTH;
  };
  const syncCardVisibility = () => {
    syncFootNarrowness();
    const cardOn = !surfaceFlags.cardHidden;
    const narrowOrCollapsed = footTooNarrow || sidebarCollapsed;
    const showCard = cardOn && !narrowOrCollapsed && !noDataHidden;
    const showRail = cardOn && narrowOrCollapsed && !noDataHidden;
    container.hidden = !showCard && !showRail;
    if (showRail) container.dataset.dshQuotaWatchSidebarCollapsed = "";
    else delete container.dataset.dshQuotaWatchSidebarCollapsed;
    card.style.display = showCard ? "" : "none";
    railTrigger.style.display = showRail ? "inline-flex" : "none";
    if (showRail) {
      container.style.height = SURFACE_SIZE + "px";
      container.style.flex = "0 0 auto";
    } else {
      container.style.height = "";
      container.style.flex = "";
    }
  };
  const footResizeObserver = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(() => {
    syncCardVisibility();
  }) : null;
  const renderAll = () => {
    const providers = snapshot?.providers ?? [];
    const glm = providers.find((provider) => provider?.key === "glm");
    const copilot = providers.find((provider) => provider?.key === "copilot");
    const glmParts = renderProvider("glm", glmRowModel(glm));
    const copilotParts = renderProvider("copilot", copilotRowModel(copilot));
    const fragment = doc.createDocumentFragment();
    fragment.append(lastUpdated);
    if (glmParts) fragment.append(...glmParts);
    if (copilotParts) fragment.append(...copilotParts);
    body.replaceChildren(fragment);
    noDataHidden = glmParts === null && copilotParts === null;
    syncCardVisibility();
    const updated = formatTime(snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : "", locale);
    if (updated) {
      lastUpdated.hidden = true;
    } else {
      lastUpdated.hidden = false;
      lastUpdated.textContent = copy.loading;
    }
    syncPop();
    renderFloatFace();
  };
  const render = (next) => {
    snapshot = next;
    renderAll();
  };
  const showTransportError = () => {
    lastUpdated.hidden = false;
    lastUpdated.textContent = snapshot ? copy.requestFailed : copy.failed;
  };
  const poll = async (force) => {
    if (disposed) return;
    const sequence = ++requestSequence;
    try {
      const next = await fetchJson(fetchImpl, force ? CLIENT_ROUTES.refresh : CLIENT_ROUTES.overview, force ? "POST" : "GET");
      if (sequence === requestSequence && !disposed) render(next);
    } catch {
      if (sequence === requestSequence && !disposed) showTransportError();
    }
  };
  const place = () => {
    const foot = footArea(doc);
    if (!foot) return;
    if (container.parentElement !== foot || foot.firstElementChild !== container) {
      foot.insertBefore(container, foot.firstChild);
    }
    if (currentFoot !== foot) {
      currentFoot = foot;
      footResizeObserver?.disconnect();
      footResizeObserver?.observe(foot);
    }
  };
  const schedulePlace = () => {
    if (queuedPlace || disposed) return;
    queuedPlace = true;
    queueMicrotask(() => {
      queuedPlace = false;
      if (!disposed) place();
    });
  };
  let sidebarCollapsed = Boolean(doc.querySelector("[data-sidebar-collapsed]"));
  const syncSidebarCollapsed = () => {
    const next = Boolean(doc.querySelector("[data-sidebar-collapsed]"));
    if (next !== sidebarCollapsed) {
      sidebarCollapsed = next;
      renderAll();
    }
  };
  const observer = new win.MutationObserver(() => {
    syncSidebarCollapsed();
    schedulePlace();
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-sidebar-collapsed"]
  });
  place();
  const startPolling = () => {
    if (timer !== void 0 || doc.visibilityState === "hidden" || disposed) return;
    void poll();
    timer = win.setInterval(() => {
      void poll();
    }, pollIntervalMs);
  };
  const stopPolling = () => {
    if (timer !== void 0) win.clearInterval(timer);
    timer = void 0;
  };
  const onVisibilityChange = () => {
    if (doc.visibilityState === "hidden") stopPolling();
    else startPolling();
  };
  const toggleRow = (key) => {
    panelNav = false;
    lastAnchor = anchorFromRow(key);
    openKey = openKey === key ? void 0 : key;
    renderAll();
  };
  const openOverview = (anchorEl) => {
    panelNav = false;
    lastAnchor = anchorFromEl(anchorEl);
    openKey = "overview";
    syncPop();
  };
  const onPanelClick = (event) => {
    if (event.target?.closest?.('[data-action="panel-close"]')) {
      openKey = void 0;
      syncPop();
      return;
    }
    if (event.target?.closest?.('[data-action="back-to-overview"]')) {
      openKey = "overview";
      syncPop();
      return;
    }
    const provider = event.target?.closest?.("[data-dsh-quota-watch-panel-provider]");
    if (provider) {
      openKey = provider.dataset.dshQuotaWatchPanelProvider;
      panelNav = true;
      syncPop();
    }
  };
  const onBodyClick = (event) => {
    if (event.target?.closest?.('[data-action="refresh"]')) {
      void poll(true);
      return;
    }
    const row = event.target?.closest?.("[data-dsh-quota-watch-row][data-expandable]");
    if (row) toggleRow(row.dataset.dshQuotaWatchRow);
  };
  const onBodyKeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target?.closest?.("[data-dsh-quota-watch-row][data-expandable]");
    if (row) {
      event.preventDefault();
      toggleRow(row.dataset.dshQuotaWatchRow);
    }
  };
  const onDocPointerDown = (event) => {
    if (openKey === void 0) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(panel) || path.includes(menu) || path.includes(container)) return;
    const target = event.target;
    if (target === panel || target === menu || target === container) return;
    if (target?.getRootNode?.() === cardRoot || target?.getRootNode?.() === floatRoot) return;
    openKey = void 0;
    renderAll();
  };
  const onDocScroll = () => {
    placePanel();
  };
  const onWinResize = () => {
    placePanel();
    syncCardVisibility();
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const x = parseFloat(floatHost.style.left);
    const y = parseFloat(floatHost.style.top);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const point = clampPoint({ x, y }, { width: viewWidth, height: viewHeight }, SURFACE_SIZE);
      floatHost.style.left = `${Math.round(point.x)}px`;
      floatHost.style.top = `${Math.round(point.y)}px`;
    }
  };
  const onDocKeydown = (event) => {
    if (event.key !== "Escape") return;
    if (!menu.hidden) {
      menu.hidden = true;
      return;
    }
    if (openKey !== void 0) {
      openKey = void 0;
      renderAll();
    }
  };
  body.addEventListener("click", onBodyClick);
  body.addEventListener("keydown", onBodyKeydown);
  panel.addEventListener("click", onPanelClick);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target?.closest?.("[data-dsh-quota-watch-panel-provider][data-expandable]");
    if (!row) return;
    event.preventDefault();
    openKey = row.dataset.dshQuotaWatchPanelProvider;
    panelNav = true;
    syncPop();
  });
  surface.addEventListener("click", onSurfaceClick);
  surface.addEventListener("keydown", onSurfaceKeydown);
  surface.addEventListener("contextmenu", onSurfaceContext);
  railTrigger.addEventListener("click", onRailClick);
  let disposeDrag = attachDrag(surface);
  doc.addEventListener("visibilitychange", onVisibilityChange);
  doc.addEventListener("pointerdown", onDocPointerDown, true);
  doc.addEventListener("scroll", onDocScroll, true);
  doc.addEventListener("keydown", onDocKeydown);
  win.addEventListener("resize", onWinResize);
  startPolling();
  return () => {
    disposed = true;
    stopPolling();
    observer.disconnect();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    doc.removeEventListener("pointerdown", onDocPointerDown, true);
    doc.removeEventListener("scroll", onDocScroll, true);
    doc.removeEventListener("keydown", onDocKeydown);
    win.removeEventListener("resize", onWinResize);
    body.removeEventListener("click", onBodyClick);
    body.removeEventListener("keydown", onBodyKeydown);
    panel.removeEventListener("click", onPanelClick);
    surface.removeEventListener("click", onSurfaceClick);
    surface.removeEventListener("keydown", onSurfaceKeydown);
    surface.removeEventListener("contextmenu", onSurfaceContext);
    railTrigger.removeEventListener("click", onRailClick);
    menu.removeEventListener("click", onMenuClick);
    disposeDrag();
    container.remove();
    panel.remove();
    floatHost.remove();
  };
}
function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), "dsh-quota-watch: sidebar");
}

		return module.exports;
	}
});
