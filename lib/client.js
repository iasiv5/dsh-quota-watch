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

// src/client.mjs
var name = "quota-watch-client";
var inject = [];
var CARD_SELECTOR = "[data-dsh-quota-watch-card]";
var COLLAPSE_KEY = "dsh-quota-watch:collapsed";
var FETCH_TIMEOUT_MS = 15e3;
var COPY = {
  zh: {
    title: "\u5957\u9910\u76D1\u63A7",
    refresh: "\u5237\u65B0",
    collapse: "\u6536\u8D77",
    expand: "\u5C55\u5F00",
    loading: "\u8BFB\u53D6\u4E2D",
    updated: "\u66F4\u65B0",
    notConfigured: "\u672A\u914D\u7F6E",
    noPlan: "\u6682\u65E0\u5957\u9910\u7A97\u53E3",
    failed: "\u67E5\u8BE2\u5931\u8D25",
    stale: "\u6570\u636E\u53EF\u80FD\u5DF2\u8FC7\u671F",
    requestFailed: "\u5237\u65B0\u5931\u8D25\uFF0C\u663E\u793A\u4E0A\u6B21\u6210\u529F\u6570\u636E",
    available: "\u53EF\u7528\u989D\u5EA6",
    used: "\u672C\u671F\u5DF2\u7528",
    balanceUnavailable: "\u4F59\u989D\u6682\u4E0D\u53EF\u7528",
    reset: "\u91CD\u7F6E",
    windows: { "5h": "5 \u5C0F\u65F6", week: "\u6BCF\u5468", month: "\u6BCF\u6708" }
  },
  en: {
    title: "Quota Watch",
    refresh: "Refresh",
    collapse: "Collapse",
    expand: "Expand",
    loading: "Loading",
    updated: "Updated",
    notConfigured: "Not configured",
    noPlan: "No plan windows",
    failed: "Query failed",
    stale: "Data may be stale",
    requestFailed: "Refresh failed; showing last successful data",
    available: "Available credits",
    used: "Used this cycle",
    balanceUnavailable: "Balance unavailable",
    reset: "Resets",
    windows: { "5h": "5 hours", week: "Weekly", month: "Monthly" }
  }
};
var STYLE_TEXT = `
[data-dsh-quota-watch-card] { box-sizing: border-box; width: 100%; margin: 0 0 8px; color: var(--dsw-alias-label-primary, inherit); font: inherit; }
[data-dsh-quota-watch-card] *, [data-dsh-quota-watch-card] *::before, [data-dsh-quota-watch-card] *::after { box-sizing: border-box; }
.dqw-card { border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); border-radius: 10px; background: var(--dsw-alias-bg-base, rgba(128,128,128,.08)); padding: 8px; display: flex; flex-direction: column; gap: 7px; }
.dqw-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dqw-title { flex: 1; min-width: 0; margin: 0; font-size: 12px; font-weight: 600; line-height: 18px; }
.dqw-button { border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 11px; line-height: 18px; padding: 1px 4px; }
.dqw-button:hover { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.16)); }
.dqw-button:disabled { cursor: wait; opacity: .6; }
.dqw-meta { margin: 0; font-size: 10px; line-height: 14px; opacity: .7; }
.dqw-provider { border-top: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.dqw-provider-title { margin: 0; font-size: 11px; font-weight: 600; line-height: 16px; }
.dqw-row { display: flex; flex-direction: column; gap: 2px; }
.dqw-row-head { display: flex; justify-content: space-between; gap: 5px; font-size: 10px; line-height: 14px; }
.dqw-bar { display: block; height: 4px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.2)); }
.dqw-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-button-primary-fill, #5b8def); }
.dqw-muted { margin: 0; font-size: 10px; line-height: 14px; opacity: .7; }
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
  fill.className = "dqw-bar-fill";
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  bar.append(fill);
  row.append(head, bar);
  return row;
}
function providerSection(doc, key, heading) {
  const section = doc.createElement("section");
  section.className = "dqw-provider";
  section.dataset.provider = key;
  section.append(text(doc, "h4", "dqw-provider-title", heading));
  const content = doc.createElement("div");
  content.dataset.role = "content";
  content.className = "dqw-content";
  section.append(content);
  return section;
}
function appendStaleError(doc, content, provider, copy) {
  if (provider.status === "stale") content.append(text(doc, "p", "dqw-error", `${copy.stale}: ${provider.error ?? ""}`));
  else if (provider.status === "error") content.append(text(doc, "p", "dqw-error", provider.error ?? copy.failed));
}
function renderGlm(doc, section, provider, copy, locale) {
  const content = section.querySelector('[data-role="content"]');
  content.replaceChildren();
  appendStaleError(doc, content, provider, copy);
  if (provider.status === "missing") {
    content.append(text(doc, "p", "dqw-muted", copy.notConfigured));
    return;
  }
  if (provider.status === "loading") {
    content.append(text(doc, "p", "dqw-muted", copy.loading));
    return;
  }
  if (!provider.plan?.windows?.length) {
    if (provider.status !== "error") content.append(text(doc, "p", "dqw-muted", copy.noPlan));
    return;
  }
  const planName = provider.plan.planName;
  if (planName) content.append(text(doc, "p", "dqw-muted", planName));
  for (const window of provider.plan.windows) {
    const label = window.name || copy.windows[window.key] || window.key;
    if (typeof window.percent === "number" && Number.isFinite(window.percent)) {
      content.append(progress(doc, label, window.percent, locale));
    } else {
      content.append(text(doc, "p", "dqw-muted", label));
    }
    const reset = formatTime(window.resetsAt, locale);
    if (reset) content.append(text(doc, "p", "dqw-muted", `${copy.reset}: ${reset}`));
  }
}
function renderCopilot(doc, section, provider, copy, locale) {
  const content = section.querySelector('[data-role="content"]');
  content.replaceChildren();
  appendStaleError(doc, content, provider, copy);
  if (provider.status === "missing") {
    content.append(text(doc, "p", "dqw-muted", copy.notConfigured));
    return;
  }
  if (provider.status === "loading") {
    content.append(text(doc, "p", "dqw-muted", copy.loading));
    return;
  }
  const quota = provider.quota;
  if (quota?.planName) content.append(text(doc, "p", "dqw-muted", quota.planName));
  if (quota?.balanceAvailable === true) {
    content.append(text(doc, "p", "dqw-credit", `${copy.available}: ${formatNumber(quota.remaining, locale)} / ${formatNumber(quota.entitlement, locale)}`));
    if (typeof quota.percentRemaining === "number") {
      content.append(progress(doc, copy.available, quota.percentRemaining, locale));
    }
  } else {
    content.append(text(doc, "p", "dqw-muted", copy.balanceUnavailable));
  }
  if (typeof quota?.creditsUsed === "number") {
    content.append(text(doc, "p", "dqw-muted", `${copy.used}: ${formatNumber(quota.creditsUsed, locale)}`));
  }
  const reset = formatTime(quota?.resetsAt, locale);
  if (reset) content.append(text(doc, "p", "dqw-muted", `${copy.reset}: ${reset}`));
}
function footArea(doc) {
  const sidebar = doc.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  return sidebar?.querySelector('[class*="footArea"]') ?? void 0;
}
function readCollapsed(win) {
  try {
    return win.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(win, value) {
  try {
    win.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
  }
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
  const collapseButton = text(doc, "button", "dqw-button", "\u2212");
  collapseButton.type = "button";
  collapseButton.dataset.action = "collapse";
  const body = doc.createElement("div");
  body.className = "dqw-body";
  const lastUpdated = text(doc, "p", "dqw-meta", copy.loading);
  lastUpdated.dataset.role = "updated";
  const glmSection = providerSection(doc, "glm", "GLM Coding Plan");
  const copilotSection = providerSection(doc, "copilot", "GitHub Copilot");
  body.append(lastUpdated, glmSection, copilotSection);
  header.append(refreshButton, collapseButton);
  card.append(header, body);
  container.append(style, card);
  let collapsed = readCollapsed(win);
  let snapshot;
  let requestSequence = 0;
  let timer;
  let disposed = false;
  let queuedPlace = false;
  const applyCollapsed = () => {
    body.hidden = collapsed;
    collapseButton.textContent = collapsed ? "+" : "\u2212";
    collapseButton.title = collapsed ? copy.expand : copy.collapse;
    collapseButton.setAttribute("aria-label", collapseButton.title);
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
  };
  const render = (next) => {
    snapshot = next;
    const glm = next?.providers?.find((provider) => provider.key === "glm");
    const copilot = next?.providers?.find((provider) => provider.key === "copilot");
    if (glm) renderGlm(doc, glmSection, glm, copy, locale);
    if (copilot) renderCopilot(doc, copilotSection, copilot, copy, locale);
    const updated = formatTime(next?.updatedAt ? new Date(next.updatedAt).toISOString() : "", locale);
    lastUpdated.textContent = updated ? `${copy.updated}: ${updated}` : copy.loading;
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
  applyCollapsed();
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
  const onCollapse = () => {
    collapsed = !collapsed;
    writeCollapsed(win, collapsed);
    applyCollapsed();
  };
  refreshButton.addEventListener("click", onRefresh);
  collapseButton.addEventListener("click", onCollapse);
  doc.addEventListener("visibilitychange", onVisibilityChange);
  startPolling();
  return () => {
    disposed = true;
    stopPolling();
    observer.disconnect();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    refreshButton.removeEventListener("click", onRefresh);
    collapseButton.removeEventListener("click", onCollapse);
    container.remove();
  };
}
function apply(ctx) {
  ctx.effect(() => mountQuotaCard(), "dsh-quota-watch: sidebar");
}

		return module.exports;
	}
});
