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

// src/client.mjs
var name = "quota-watch-client";
var inject = [];
var CARD_SELECTOR = "[data-dsh-quota-watch-card]";
var FETCH_TIMEOUT_MS = 15e3;
var COPY = {
  zh: {
    title: "\u5957\u9910\u76D1\u63A7",
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
    unlimitedNote: "\uFF08\u65E0\u9650\uFF09",
    windows: {
      "5h": "5 \u5C0F\u65F6\u989D\u5EA6",
      week: "\u6BCF\u5468\u989D\u5EA6",
      month: "\u6BCF\u6708\u989D\u5EA6",
      mcp: "MCP\uFF08\u6708\uFF09"
    }
  },
  en: {
    title: "Quota Watch",
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
    unlimitedNote: " (unlimited)",
    windows: {
      "5h": "5-hour quota",
      week: "Weekly quota",
      month: "Monthly quota",
      mcp: "MCP (month)"
    }
  }
};
var STYLE_TEXT = `
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
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
function text(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value ?? "");
  return node;
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
  if (doc.querySelector(CARD_SELECTOR)) return () => {
  };
  const locale = localeFor(win);
  const copy = COPY[locale];
  const container = doc.createElement("div");
  container.dataset.dshQuotaWatchCard = "";
  container.dataset.dshPlugin = "quota-watch";
  container.dataset.dshPart = "sidebar-card";
  const style = text(doc, "style", "", STYLE_TEXT);
  const card = doc.createElement("section");
  card.className = "dqw-card";
  card.setAttribute("aria-label", copy.title);
  const body = doc.createElement("div");
  body.className = "dqw-body";
  const lastUpdated = text(doc, "p", "dqw-meta", copy.loading);
  lastUpdated.dataset.role = "updated";
  body.append(lastUpdated);
  card.append(body);
  container.append(style, card);
  const pop = doc.createElement("div");
  pop.className = "dqw-pop";
  pop.dataset.dshQuotaWatchPop = "";
  pop.hidden = true;
  doc.body.append(pop);
  let snapshot;
  let requestSequence = 0;
  let timer;
  let disposed = false;
  let queuedPlace = false;
  let openKey;
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
  function renderDetail(detail, key, provider) {
    detail.replaceChildren();
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
        wins.append(text(doc, "span", "dqw-kv-sub", reset ? `\uFF08${copy.reset}: ${reset}\uFF09` : ""));
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
  const positionPop = () => {
    if (pop.hidden || openKey === void 0) return;
    const row = body.querySelector(`[data-dsh-quota-watch-row="${openKey}"]`);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const width = pop.offsetWidth || 240;
    const height = pop.offsetHeight || 160;
    let left = rect.right + 8;
    if (left + width > viewWidth - 8) left = rect.left - width - 8;
    if (left + width > viewWidth - 8) left = viewWidth - width - 8;
    left = Math.max(8, left);
    const top = Math.min(Math.max(rect.top, 8), Math.max(8, viewHeight - height - 8));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };
  const syncPop = () => {
    if (openKey === void 0 || disposed) {
      if (!pop.hidden) {
        pop.hidden = true;
        pop.replaceChildren();
        delete pop.dataset.dshQuotaWatchDetail;
      }
      return;
    }
    const provider = (snapshot?.providers ?? []).find((item) => item?.key === openKey);
    const row = body.querySelector(`[data-dsh-quota-watch-row="${openKey}"]`);
    if (!provider || !row || !row.hasAttribute("data-expandable")) {
      openKey = void 0;
      syncPop();
      return;
    }
    renderDetail(pop, openKey, provider);
    pop.dataset.dshQuotaWatchDetail = openKey;
    pop.setAttribute("aria-label", openKey === "glm" ? "GLM" : "Copilot");
    pop.hidden = false;
    positionPop();
  };
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
    container.hidden = glmParts === null && copilotParts === null;
    const updated = formatTime(snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : "", locale);
    if (updated) {
      lastUpdated.hidden = true;
    } else {
      lastUpdated.hidden = false;
      lastUpdated.textContent = copy.loading;
    }
    syncPop();
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
  };
  const schedulePlace = () => {
    if (queuedPlace || disposed) return;
    queuedPlace = true;
    queueMicrotask(() => {
      queuedPlace = false;
      if (!disposed) place();
    });
  };
  const observer = new win.MutationObserver(schedulePlace);
  observer.observe(doc.body, { childList: true, subtree: true });
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
    openKey = openKey === key ? void 0 : key;
    renderAll();
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
    const target = event.target;
    if (pop.contains(target) || target?.closest?.("[data-dsh-quota-watch-row]") || target?.closest?.(CARD_SELECTOR)) return;
    openKey = void 0;
    renderAll();
  };
  const onDocScroll = () => {
    positionPop();
  };
  const onWinResize = () => {
    positionPop();
  };
  const onDocKeydown = (event) => {
    if (event.key === "Escape" && openKey !== void 0) {
      openKey = void 0;
      renderAll();
    }
  };
  body.addEventListener("click", onBodyClick);
  body.addEventListener("keydown", onBodyKeydown);
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
    container.remove();
    pop.remove();
  };
}
function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), "dsh-quota-watch: sidebar");
}

		return module.exports;
	}
});
