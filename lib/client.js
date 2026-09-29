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
    updated: "\u66F4\u65B0",
    failed: "\u67E5\u8BE2\u5931\u8D25",
    stale: "\u6570\u636E\u53EF\u80FD\u5DF2\u8FC7\u671F",
    requestFailed: "\u5237\u65B0\u5931\u8D25\uFF0C\u663E\u793A\u4E0A\u6B21\u6210\u529F\u6570\u636E",
    available: "\u53EF\u7528\u989D\u5EA6",
    used: "\u672C\u671F\u5DF2\u7528",
    reset: "\u91CD\u7F6E",
    todayTokens: "\u4ECA\u65E5 tokens",
    todayCalls: "\u4ECA\u65E5\u8C03\u7528",
    windows: {
      "5h": "5 \u5C0F\u65F6\u7A97\u53E3 \xB7 \u5DF2\u7528",
      week: "\u6BCF\u5468\u7A97\u53E3 \xB7 \u5DF2\u7528",
      month: "\u6BCF\u6708\u7A97\u53E3 \xB7 \u5DF2\u7528",
      mcp: "MCP\uFF08\u6708\uFF09\xB7 \u5DF2\u7528"
    }
  },
  en: {
    title: "Quota Watch",
    refresh: "Refresh",
    loading: "Loading",
    updated: "Updated",
    failed: "Query failed",
    stale: "Data may be stale",
    requestFailed: "Refresh failed; showing last successful data",
    available: "Available credits",
    used: "Used this cycle",
    reset: "Resets",
    todayTokens: "Today tokens",
    todayCalls: "Calls today",
    windows: {
      "5h": "5-hour window \xB7 used",
      week: "Weekly window \xB7 used",
      month: "Monthly window \xB7 used",
      mcp: "MCP (month) \xB7 used"
    }
  }
};
var STYLE_TEXT = `
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
function progress(doc, label, percent, locale) {
  const row = doc.createElement("div");
  row.className = "dqw-row";
  const head = doc.createElement("div");
  head.className = "dqw-row-head";
  head.append(text(doc, "span", "", label), text(doc, "span", "", formatPercent(percent, locale)));
  const bar = doc.createElement("span");
  bar.className = "dqw-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, percent))));
  const fill = doc.createElement("span");
  fill.className = `dqw-bar-fill${percent > 95 ? " danger" : percent > 80 ? " warn" : ""}`;
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  bar.append(fill);
  row.append(head, bar);
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
    error: provider.error
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
  const header = doc.createElement("header");
  header.className = "dqw-head";
  header.append(text(doc, "h3", "dqw-title", copy.title));
  const refreshButton = text(doc, "button", "dqw-button", "\u21BB");
  refreshButton.type = "button";
  refreshButton.title = copy.refresh;
  refreshButton.setAttribute("aria-label", copy.refresh);
  refreshButton.dataset.action = "refresh";
  header.append(refreshButton);
  const body = doc.createElement("div");
  body.className = "dqw-body";
  const lastUpdated = text(doc, "p", "dqw-meta", copy.loading);
  lastUpdated.dataset.role = "updated";
  body.append(lastUpdated);
  card.append(header, body);
  container.append(style, card);
  let snapshot;
  let requestSequence = 0;
  let timer;
  let disposed = false;
  let queuedPlace = false;
  let openKey;
  const fillClass = (percent) => percent > 95 ? "dqw-bar-fill danger" : percent > 80 ? "dqw-bar-fill warn" : "dqw-bar-fill";
  const renderProvider = (key, model, provider) => {
    if (model === null) return null;
    const row = doc.createElement("div");
    row.className = "dqw-row-summary";
    row.dataset.dshQuotaWatchRow = key;
    row.append(text(doc, "span", "dqw-label", model.label));
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
    const detail = doc.createElement("div");
    detail.className = "dqw-detail";
    detail.dataset.dshQuotaWatchDetail = key;
    if (openKey === key) renderDetail(detail, key, provider);
    return [row, detail];
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
      for (const window of provider?.plan?.windows ?? []) {
        const label = copy.windows[window?.key] ?? window?.key;
        if (typeof window?.percent === "number" && Number.isFinite(window.percent)) {
          detail.append(progress(doc, label, window.percent, locale));
        } else {
          detail.append(text(doc, "p", "dqw-muted", label));
        }
        const reset2 = formatTime(window?.resetsAt, locale);
        if (reset2) detail.append(text(doc, "p", "dqw-muted", `${copy.reset}: ${reset2}`));
      }
      const models = Array.isArray(usage?.models) && usage.models.length > 0 ? usage.models.map((model) => `${model.name} ${formatCompact(model.tokens, locale)}`).join(" \xB7 ") : void 0;
      if (models) detail.append(text(doc, "p", "dqw-models", models));
      const updated = formatTime(provider?.updatedAt ? new Date(provider.updatedAt).toISOString() : "", locale);
      if (updated) detail.append(text(doc, "p", "dqw-meta", `${copy.updated}: ${updated}`));
      return;
    }
    const quota = provider?.quota;
    if (quota?.balanceAvailable === true) {
      detail.append(text(doc, "p", "dqw-credit", `${copy.available}: ${formatNumber(quota.remaining, locale)} / ${formatNumber(quota.entitlement, locale)}`));
      const used = remainingToUsed(quota.percentRemaining);
      if (used !== void 0) detail.append(progress(doc, copy.used, used, locale));
      if (typeof quota.creditsUsed === "number" && quota.creditsUsed >= 0) {
        detail.append(text(doc, "p", "dqw-muted", `${copy.used}: ${formatNumber(quota.creditsUsed, locale)}`));
      }
    } else {
      detail.append(text(doc, "p", "dqw-muted", copy.stale));
    }
    const reset = formatTime(quota?.resetsAt, locale);
    if (reset) detail.append(text(doc, "p", "dqw-muted", `${copy.reset}: ${reset}`));
  }
  const renderAll = () => {
    const providers = snapshot?.providers ?? [];
    const glm = providers.find((provider) => provider?.key === "glm");
    const copilot = providers.find((provider) => provider?.key === "copilot");
    const glmParts = renderProvider("glm", glmRowModel(glm), glm);
    const copilotParts = renderProvider("copilot", copilotRowModel(copilot), copilot);
    const fragment = doc.createDocumentFragment();
    fragment.append(lastUpdated);
    if (glmParts) fragment.append(...glmParts);
    if (copilotParts) fragment.append(...copilotParts);
    body.replaceChildren(fragment);
    container.hidden = glmParts === null && copilotParts === null;
    const updated = formatTime(snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : "", locale);
    lastUpdated.textContent = updated ? `${copy.updated}: ${updated}` : copy.loading;
  };
  const render = (next) => {
    snapshot = next;
    renderAll();
  };
  const showTransportError = () => {
    if (snapshot) lastUpdated.textContent = copy.requestFailed;
    else lastUpdated.textContent = copy.failed;
  };
  const poll = async (force) => {
    if (disposed) return;
    const sequence = ++requestSequence;
    refreshButton.disabled = force === true;
    try {
      const next = await fetchJson(fetchImpl, force ? CLIENT_ROUTES.refresh : CLIENT_ROUTES.overview, force ? "POST" : "GET");
      if (sequence === requestSequence && !disposed) render(next);
    } catch {
      if (sequence === requestSequence && !disposed) showTransportError();
    } finally {
      if (!disposed && sequence === requestSequence) refreshButton.disabled = false;
    }
  };
  const place = () => {
    const foot = footArea(doc);
    if (!foot) return;
    const settings = foot.querySelector('[class*="settingsArea"]');
    if (settings) {
      if (container.parentElement !== foot || container.nextElementSibling !== settings) foot.insertBefore(container, settings);
    } else if (container.parentElement !== foot || foot.lastElementChild !== container) {
      foot.append(container);
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
    void poll(false);
    timer = win.setInterval(() => {
      void poll(false);
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
  const onRefresh = () => {
    void poll(true);
  };
  const toggleRow = (key) => {
    openKey = openKey === key ? void 0 : key;
    renderAll();
  };
  const onBodyClick = (event) => {
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
  refreshButton.addEventListener("click", onRefresh);
  body.addEventListener("click", onBodyClick);
  body.addEventListener("keydown", onBodyKeydown);
  doc.addEventListener("visibilitychange", onVisibilityChange);
  startPolling();
  return () => {
    disposed = true;
    stopPolling();
    observer.disconnect();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    refreshButton.removeEventListener("click", onRefresh);
    body.removeEventListener("click", onBodyClick);
    body.removeEventListener("keydown", onBodyKeydown);
    container.remove();
  };
}
function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), "dsh-quota-watch: sidebar");
}

		return module.exports;
	}
});
