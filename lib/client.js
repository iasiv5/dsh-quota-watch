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
  COPY: () => COPY,
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
  refresh: `${API_PREFIX}/refresh`,
  resetCards: `${API_PREFIX}/reset-cards`,
  resetUse: `${API_PREFIX}/reset-cards/use`,
  resetAcknowledge: `${API_PREFIX}/reset-cards/acknowledge`,
  resetReceipt: `${API_PREFIX}/reset-cards/receipt`
});
var CLIENT_ROUTES = Object.freeze({
  overview: `${API_PREFIX.slice(1)}/overview`,
  refresh: `${API_PREFIX.slice(1)}/refresh`,
  resetCards: `${API_PREFIX.slice(1)}/reset-cards`,
  resetUse: `${API_PREFIX.slice(1)}/reset-cards/use`,
  resetAcknowledge: `${API_PREFIX.slice(1)}/reset-cards/acknowledge`,
  resetReceipt: `${API_PREFIX.slice(1)}/reset-cards/receipt`
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
var FLOAT_POSITION_KEY = "dsh-quota-watch:float-position";
var SURFACE_FLAGS_KEY = "dsh-quota-watch:surface-flags";
var MARGIN = 8;
var ZERO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };
function normalizeSize(size) {
  if (typeof size === "number") return { width: size, height: size };
  const width = typeof size?.width === "number" ? size.width : 0;
  const height = typeof size?.height === "number" ? size.height : 0;
  return { width, height };
}
function clampPoint(point, viewport, size = 0, insets = ZERO_INSETS) {
  const { width, height } = normalizeSize(size);
  const insetLeft = Number.isFinite(insets?.left) ? insets.left : 0;
  const insetRight = Number.isFinite(insets?.right) ? insets.right : 0;
  const insetTop = Number.isFinite(insets?.top) ? insets.top : 0;
  const insetBottom = Number.isFinite(insets?.bottom) ? insets.bottom : 0;
  const minX = MARGIN + insetLeft;
  const minY = MARGIN + insetTop;
  const maxX = Math.max(minX, viewport.width - insetRight - MARGIN - width);
  const maxY = Math.max(minY, viewport.height - insetBottom - MARGIN - height);
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY)
  };
}
function titlebarTopInset({ titlebar = false, fullscreen = false, height } = {}) {
  if (!titlebar || fullscreen) return 0;
  const value = Number.parseFloat(height);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function loadFloatPosition(storage) {
  try {
    const raw = storage.getItem(FLOAT_POSITION_KEY);
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
function saveFloatPosition(storage, point) {
  if (typeof point !== "object" || point === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`invalid float position: ${JSON.stringify(point)}`);
  }
  try {
    storage.setItem(FLOAT_POSITION_KEY, JSON.stringify({ x: point.x, y: point.y }));
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

// src/client/drag.mjs
var DRAG_SLOP_MOUSE = 6;
var DRAG_SLOP_TOUCH = 10;
function dragSlop(pointerType) {
  return pointerType === "touch" || pointerType === "pen" ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE;
}
function grabOffset(point, rect) {
  return { dx: point.x - rect.left, dy: point.y - rect.top };
}
function pillTopLeft(point, grab) {
  return { x: point.x - grab.dx, y: point.y - grab.dy };
}
function clampFrame(point, grab, size, viewport, insets) {
  return clampPoint(pillTopLeft(point, grab), viewport, size, insets);
}
function parseInset(computedValue) {
  const value = Number.parseFloat(computedValue);
  return Number.isFinite(value) ? value : 0;
}

// src/core/reset.mjs
var RESET_TYPES = Object.freeze({ week: "WEEK", fiveHour: "FIVE_HOUR" });
function asString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function parseResetExpiryTime(expireTime) {
  const text3 = asString(expireTime);
  if (text3 === void 0) return void 0;
  const normalized = text3.includes("T") ? text3 : text3.replace(" ", "T");
  const hasZone = /(?:Z|z|[+-]\d{2}:?\d{2})$/.test(normalized);
  const parsed = Date.parse(hasZone ? normalized : `${normalized}+08:00`);
  return Number.isNaN(parsed) ? void 0 : parsed;
}

// src/client/reset-cards.mjs
function localeFor(win) {
  const host = String(win?.document?.documentElement?.lang ?? "").trim();
  if (host !== "") return host.toLowerCase().startsWith("zh") ? "zh" : "en";
  return String(win?.navigator?.language ?? "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
}
function formatNumber(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 1 }).format(value);
}
function text(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value ?? "");
  return node;
}
function earliestExpiryCard(cards) {
  let best;
  for (const card of Array.isArray(cards) ? cards : []) {
    const parsed = parseResetExpiryTime(card?.expireTime);
    if (parsed === void 0) continue;
    if (best === void 0 || parsed < best.parsed) best = { card, parsed };
  }
  return best;
}
function earliestExpiryLabel(cards) {
  const best = earliestExpiryCard(cards);
  if (best === void 0) return void 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai"
  }).formatToParts(new Date(best.parsed));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")}/${part("day")}`;
}
var RESET_FETCH_TIMEOUT_MS = 6e4;
async function fetchResetEnvelope(fetchImpl, path, body) {
  const response = await fetchImpl(path, {
    ...body !== void 0 ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(RESET_FETCH_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => void 0);
  if (payload === void 0 || typeof payload !== "object" || payload === null) {
    throw new Error(`HTTP ${response.status}`);
  }
  return payload;
}
function createResetCards({
  doc,
  win,
  fetchImpl,
  copy: copyAccessor,
  routes,
  refresh,
  onDirty,
  outcomeNoticeMs = 5e3
} = {}) {
  let resetPending;
  let resetBusy;
  let resetNotice;
  let outcomeBusy = false;
  let outcomeNoticeTimer;
  let lastSnapshot;
  let disposed = false;
  function manualLocked() {
    return lastSnapshot?.manualOutcome !== void 0 || lastSnapshot?.manualOutcomeError !== void 0;
  }
  async function spendResetCard(resetType) {
    if (resetBusy !== void 0 || disposed || manualLocked()) return;
    resetBusy = resetType;
    resetPending = void 0;
    resetNotice = void 0;
    onDirty();
    let outcome;
    try {
      outcome = await fetchResetEnvelope(fetchImpl, routes.resetUse, { resetType });
    } catch {
      outcome = { ok: false, error: "request-unknown" };
    } finally {
      resetBusy = void 0;
    }
    const copy = copyAccessor();
    if (outcome.ok === true) {
      resetNotice = { kind: "ok", message: copy.resetCards.succeeded, attemptId: outcome.attemptId, known: true };
    } else if (outcome.error === "rejected") {
      resetNotice = { kind: "error", message: outcome.message ?? copy.resetCards.failed, attemptId: outcome.attemptId, known: true };
    } else if (outcome.error === "request-unknown") {
      resetNotice = { kind: "unknown", message: copy.resetCards.unconfirmed };
    } else if (outcome.error === "storage-unavailable") {
      resetNotice = { kind: "error", message: copy.resetCards.storageUnavailable };
    } else {
      resetNotice = { kind: "error", message: outcome.message ?? copy.resetCards.failed };
    }
    if (!disposed) await refresh();
    if (!disposed) onDirty();
    if (!disposed && resetNotice?.known === true && typeof resetNotice.attemptId === "string") {
      await acknowledgeOutcome(routes.resetReceipt, resetNotice.attemptId);
    }
    if (!disposed && resetNotice?.kind === "ok") {
      const notice = resetNotice;
      if (outcomeNoticeTimer !== void 0) win.clearTimeout(outcomeNoticeTimer);
      const timerId = win.setTimeout(() => {
        if (outcomeNoticeTimer === timerId) outcomeNoticeTimer = void 0;
        if (!disposed && resetNotice === notice) {
          resetNotice = void 0;
          onDirty();
        }
      }, Math.max(0, outcomeNoticeMs));
      outcomeNoticeTimer = timerId;
    }
  }
  async function acknowledgeOutcome(route, attemptId) {
    if (outcomeBusy || disposed || typeof attemptId !== "string" || attemptId === "") return;
    outcomeBusy = true;
    onDirty();
    try {
      await fetchResetEnvelope(fetchImpl, route, { attemptId });
    } catch {
    }
    outcomeBusy = false;
    if (!disposed) await refresh();
    if (!disposed) onDirty();
  }
  function renderManualOutcomeBlock() {
    const copy = copyAccessor();
    const block = doc.createElement("div");
    block.dataset.dshQuotaWatchOutcome = "";
    if (lastSnapshot?.manualOutcomeError === "storage-unavailable") {
      block.className = "dqw-reset-notice is-error";
      block.textContent = copy.resetCards.storageUnavailable;
      return block;
    }
    const outcome = lastSnapshot?.manualOutcome;
    if (outcome === void 0) return null;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "dqw-reset-btn";
    button.disabled = outcomeBusy;
    if (outcome.status === "unknown") {
      block.className = "dqw-reset-confirm";
      block.append(
        text(doc, "div", "dqw-reset-confirm-title", copy.resetCards.outcomeUnknownTitle),
        text(doc, "div", "dqw-reset-confirm-body", copy.resetCards.outcomeUnknownBody)
      );
      button.textContent = copy.resetCards.verifyButton;
      button.addEventListener("click", () => {
        void acknowledgeOutcome(routes.resetAcknowledge, outcome.attemptId);
      });
    } else {
      const knownSuccess = outcome.status === "known-success";
      block.className = knownSuccess ? "dqw-reset-notice is-ok" : "dqw-reset-notice is-error";
      block.append(text(doc, "div", "", knownSuccess ? copy.resetCards.knownSuccessTitle : copy.resetCards.knownRefusedTitle));
      button.textContent = copy.resetCards.acknowledgeButton;
      button.addEventListener("click", () => {
        void acknowledgeOutcome(routes.resetReceipt, outcome.attemptId);
      });
    }
    block.append(button);
    return block;
  }
  function renderResetRow(type, model) {
    const copy = copyAccessor();
    const locale = localeFor(win);
    const row = doc.createElement("div");
    row.className = "dqw-reset-row";
    const expiry = earliestExpiryLabel(model);
    const expiryLabel = expiry !== void 0 ? copy.resetCards.expiry.replace("{date}", expiry) : "\u2014";
    row.append(text(doc, "span", "dqw-reset-kind", type === "WEEK" ? copy.resetCards.week : copy.resetCards.fiveHour));
    row.append(text(doc, "span", "dqw-reset-mid", "\xB7"));
    const expiryNode = text(doc, "span", "dqw-reset-expiry", expiryLabel);
    const earliest = earliestExpiryCard(model);
    if (earliest !== void 0) {
      const detail = `${expiryLabel} \xB7 ${earliest.card.expireTime} \xB7 ${copy.resetCards.expiryAssumed}`;
      expiryNode.tabIndex = 0;
      expiryNode.setAttribute("aria-label", detail);
      expiryNode.title = detail;
    }
    row.append(expiryNode);
    const count = model.length;
    row.append(text(doc, "span", `dqw-reset-count${count === 0 ? " is-empty" : ""}`, count === 0 ? copy.resetCards.none : copy.resetCards.count.replace("{count}", formatNumber(count, locale))));
    if (count === 0 && resetBusy !== type) {
      row.append(text(doc, "span", "dqw-reset-placeholder", ""));
      return row;
    }
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "dqw-reset-use";
    button.textContent = resetPending === type ? copy.resetCards.cancel : copy.resetCards.use;
    if (resetBusy === type) {
      button.textContent = copy.resetCards.working;
      button.disabled = true;
    } else {
      button.disabled = resetBusy !== void 0 || manualLocked();
    }
    button.addEventListener("click", () => {
      if (resetBusy !== void 0 || manualLocked()) return;
      resetPending = resetPending === type ? void 0 : type;
      resetNotice = void 0;
      onDirty();
    });
    row.append(button);
    return row;
  }
  function renderResetSection() {
    const copy = copyAccessor();
    const section = doc.createElement("div");
    section.className = "dqw-reset";
    const reset = lastSnapshot?.reset;
    if (reset === void 0 || reset.status === "loading") {
      const head2 = doc.createElement("div");
      head2.className = "dqw-reset-head";
      head2.append(text(doc, "span", "dqw-reset-title", copy.resetCards.section));
      section.append(head2, text(doc, "p", "dqw-muted", copy.resetCards.querying));
      appendOutcomeBlock(section);
      return section;
    }
    if (reset.status === "error") {
      const head2 = doc.createElement("div");
      head2.className = "dqw-reset-head";
      head2.append(text(doc, "span", "dqw-reset-title", copy.resetCards.section));
      const reason = reset.error ? `: ${reset.error}` : "";
      section.append(head2, text(doc, "p", "dqw-muted", `${copy.failed}${reason}`));
      appendOutcomeBlock(section);
      return section;
    }
    const cards = reset.cards;
    const week = Array.isArray(cards?.week) ? cards.week : [];
    const fiveHour = Array.isArray(cards?.fiveHour) ? cards.fiveHour : [];
    if (week.length === 0 && fiveHour.length === 0 && resetPending === void 0 && resetBusy === void 0 && resetNotice === void 0) {
      const row = doc.createElement("div");
      row.className = "dqw-reset-collapsed";
      row.append(text(doc, "span", "dqw-reset-title", `${copy.resetCards.section} \xB7 ${copy.resetCards.none}`));
      section.append(row);
      appendOutcomeBlock(section);
      return section;
    }
    const head = doc.createElement("div");
    head.className = "dqw-reset-head";
    head.append(text(doc, "span", "dqw-reset-title", copy.resetCards.section));
    section.append(head);
    const rows = doc.createElement("div");
    rows.className = "dqw-reset-lines";
    if (fiveHour.length > 0) rows.append(renderResetRow("FIVE_HOUR", fiveHour));
    if (week.length > 0) rows.append(renderResetRow("WEEK", week));
    if (rows.childElementCount > 0) section.append(rows);
    if (resetPending !== void 0) {
      const box = doc.createElement("div");
      box.className = "dqw-reset-confirm";
      box.append(text(doc, "div", "dqw-reset-confirm-title", copy.resetCards.confirmTitle));
      box.append(text(doc, "div", "dqw-reset-confirm-body", resetPending === "WEEK" ? copy.resetCards.confirmWeek : copy.resetCards.confirmFiveHour));
      box.append(text(doc, "div", "dqw-reset-confirm-warn", copy.resetCards.confirmIrreversible));
      const actions = doc.createElement("div");
      actions.className = "dqw-reset-confirm-actions";
      const cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.className = "dqw-reset-btn";
      cancel.textContent = copy.resetCards.cancel;
      cancel.addEventListener("click", () => {
        resetPending = void 0;
        onDirty();
      });
      const confirm = doc.createElement("button");
      confirm.type = "button";
      confirm.className = "dqw-reset-btn is-primary";
      confirm.textContent = copy.resetCards.ok;
      confirm.disabled = resetBusy !== void 0 || manualLocked();
      confirm.addEventListener("click", () => {
        spendResetCard(resetPending);
      });
      actions.append(cancel, confirm);
      box.append(actions);
      section.append(box);
    }
    if (resetNotice !== void 0) {
      section.append(text(doc, "div", `dqw-reset-notice is-${resetNotice.kind}`, resetNotice.message));
    }
    appendOutcomeBlock(section);
    return section;
  }
  const appendOutcomeBlock = (container) => {
    const block = renderManualOutcomeBlock();
    if (block !== null) container.append(block);
  };
  return {
    /** Render the domestic reset-card section for the GLM detail view. */
    renderSection(snapshot) {
      lastSnapshot = snapshot;
      return renderResetSection();
    },
    /** Render the persistent outcome block for the overview panel (null when absent). */
    renderOutcomeBlock(snapshot) {
      lastSnapshot = snapshot;
      return renderManualOutcomeBlock();
    },
    /** Clear an uncommitted confirmation; true iff one was actually cleared. */
    clearPending() {
      if (resetPending === void 0) return false;
      resetPending = void 0;
      return true;
    },
    /** Stop the flow: retire the notice timer and freeze every in-flight guard. */
    dispose() {
      disposed = true;
      if (outcomeNoticeTimer !== void 0) win.clearTimeout(outcomeNoticeTimer);
      outcomeNoticeTimer = void 0;
    }
  };
}

// src/client.mjs
var name = "quota-watch-client";
var inject = ["slots"];
var CARD_SELECTOR = "[data-dsh-quota-watch-card]";
var FLOAT_SELECTOR = "[data-dsh-quota-watch-float]";
var FETCH_TIMEOUT_MS = 15e3;
var FALLBACK_SIZE = { width: 38, height: 26 };
var ZERO_INSETS2 = { left: 0, right: 0, top: 0, bottom: 0 };
var CARD_MIN_WIDTH = 160;
var CARD_SLOT_NAME = "sidebar.footer.action";
function loadReact() {
  try {
    return typeof require === "function" ? require("react") : null;
  } catch {
    return null;
  }
}
var COPY = {
  zh: {
    title: "Token\u989D\u5EA6",
    openDetails: "\u67E5\u770B\u8BE6\u60C5",
    close: "\u5173\u95ED",
    actions: {
      showCard: "\u663E\u793A\u4FA7\u8FB9\u680F\u5361\u7247",
      hideCard: "\u9690\u85CF\u4FA7\u8FB9\u680F\u5361\u7247",
      refreshNow: "\u7ACB\u5373\u5237\u65B0",
      refreshing: "\u5237\u65B0\u4E2D"
    },
    backToOverview: "\u8FD4\u56DE\u989D\u5EA6\u6982\u89C8",
    providerNames: { glm: "GLM", copilot: "Copilot" },
    refresh: "\u5237\u65B0",
    loading: "\u8BFB\u53D6\u4E2D",
    failed: "\u67E5\u8BE2\u5931\u8D25",
    stale: "\u6570\u636E\u53EF\u80FD\u5DF2\u8FC7\u671F",
    authRejected: "\u51ED\u8BC1\u5DF2\u88AB\u670D\u52A1\u5546\u62D2\u7EDD\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743",
    requestFailed: "\u5237\u65B0\u5931\u8D25\uFF0C\u663E\u793A\u4E0A\u6B21\u6210\u529F\u6570\u636E",
    available: "\u53EF\u7528\u989D\u5EA6",
    used: "\u672C\u671F\u5DF2\u7528",
    reset: "\u91CD\u7F6E",
    resetTime: "\u91CD\u7F6E\u65F6\u95F4",
    windowUsed: "\u5DF2\u7528",
    todayTokens: "\u4ECA\u65E5 Tokens",
    todayCalls: "\u8C03\u7528\u6B21\u6570",
    todayModelsUnavailable: "\u4ECA\u65E5\u5206\u6A21\u578B\u6570\u636E\u6682\u4E0D\u53EF\u7528",
    weekUnlimited: "\u6BCF\u5468\u989D\u5EA6",
    unlimited: "\u267E\uFE0F",
    unlimitedNote: "\uFF08 \u65E0\u9650 \uFF09",
    // Full-width paren pair for zh: both window-grid notes share the same
    // glyph class so their left edges line up.
    noteOpen: "\uFF08 ",
    noteClose: " \uFF09",
    windows: {
      "5h": "5 \u5C0F\u65F6\u989D\u5EA6",
      week: "\u6BCF\u5468\u989D\u5EA6",
      month: "\u6BCF\u6708\u989D\u5EA6",
      mcp: "MCP\uFF08\u6708\uFF09"
    },
    resetCards: {
      section: "\u989D\u5EA6\u91CD\u7F6E\u5361",
      querying: "\u67E5\u8BE2\u4E2D",
      week: "\u6BCF\u5468\u91CD\u7F6E\u5361",
      fiveHour: "5 \u5C0F\u65F6\u91CD\u7F6E\u5361",
      count: "{count} \u5F20",
      none: "\u65E0\u53EF\u7528",
      use: "\u91CD\u7F6E",
      expiry: "{date} \u524D\u6709\u6548",
      expiryAssumed: "\u65E0\u65F6\u533A\u5B57\u6BB5\u6309\u5317\u4EAC\u65F6\u95F4\u89E3\u8BFB\uFF0C\u975E\u4E0A\u6E38\u5B98\u65B9\u8BF4\u660E",
      unconfirmed: "\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u8BF7\u6838\u5BF9\u670D\u52A1\u5546\u5B98\u65B9\u5361\u6570\u548C\u989D\u5EA6",
      outcomeUnknownTitle: "\u4E0A\u6B21\u624B\u52A8\u7528\u5361\u7ED3\u679C\u672A\u786E\u8BA4",
      outcomeUnknownBody: "\u53EF\u80FD\u5DF2\u6D88\u8017\u4E00\u5F20\u91CD\u7F6E\u5361\uFF0C\u4E14\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002\u8BF7\u5148\u6838\u5BF9\u670D\u52A1\u5546\u5B98\u65B9\u5361\u6570\u4E0E\u989D\u5EA6\uFF0C\u518D\u6807\u8BB0\u300C\u6211\u5DF2\u6838\u5B9E\u300D\u3002",
      verifyButton: "\u6211\u5DF2\u6838\u5B9E",
      knownSuccessTitle: "\u4E0A\u6B21\u624B\u52A8\u7528\u5361\uFF1A\u5DF2\u786E\u8BA4\u6210\u529F",
      knownRefusedTitle: "\u4E0A\u6B21\u624B\u52A8\u7528\u5361\uFF1A\u4E0A\u6E38\u660E\u786E\u62D2\u7EDD",
      acknowledgeButton: "\u6211\u5DF2\u4E86\u89E3\u7ED3\u679C",
      storageUnavailable: "\u624B\u52A8\u7528\u5361\u6682\u4E0D\u53EF\u7528\uFF08\u7ED3\u679C\u8BB0\u5F55\u65E0\u6CD5\u8BFB\u53D6\uFF09",
      confirmTitle: "\u786E\u8BA4\u4F7F\u7528\u91CD\u7F6E\u5361\uFF1F",
      confirmWeek: "\u5C06\u6D88\u8017 1 \u5F20\u6BCF\u5468\u91CD\u7F6E\u5361\uFF0C\u7ACB\u5373\u91CD\u7F6E\u6BCF\u5468\u989D\u5EA6\u4E0E 5 \u5C0F\u65F6\u989D\u5EA6\u3002",
      confirmFiveHour: "\u5C06\u6D88\u8017 1 \u5F20 5 \u5C0F\u65F6\u91CD\u7F6E\u5361\uFF0C\u7ACB\u5373\u91CD\u7F6E 5 \u5C0F\u65F6\u989D\u5EA6\u3002",
      confirmIrreversible: "\u91CD\u7F6E\u5361\u7528\u6389\u5373\u6D88\u5931\uFF0C\u65E0\u6CD5\u64A4\u9500\u3002",
      ok: "\u786E\u8BA4\u91CD\u7F6E",
      cancel: "\u53D6\u6D88",
      working: "\u91CD\u7F6E\u4E2D\u2026",
      succeeded: "\u5DF2\u91CD\u7F6E",
      failed: "\u91CD\u7F6E\u5931\u8D25"
    }
  },
  en: {
    title: "Quota Watch",
    openDetails: "View details",
    close: "Close",
    actions: {
      showCard: "Show sidebar card",
      hideCard: "Hide sidebar card",
      refreshNow: "Refresh now",
      refreshing: "Refreshing"
    },
    backToOverview: "Back to quota overview",
    providerNames: { glm: "GLM", copilot: "Copilot" },
    refresh: "Refresh",
    loading: "Loading",
    failed: "Query failed",
    stale: "Data may be stale",
    authRejected: "Credential rejected by provider \u2014 re-authorize",
    requestFailed: "Refresh failed; showing last successful data",
    available: "Available credits",
    used: "Used this cycle",
    reset: "Resets",
    resetTime: "Reset time",
    windowUsed: "used",
    todayTokens: "Today tokens",
    todayCalls: "Calls",
    todayModelsUnavailable: "Per-model data unavailable today",
    weekUnlimited: "Weekly quota",
    unlimited: "\u267E\uFE0F",
    unlimitedNote: "( unlimited )",
    // ASCII parens for en — and NO leading space: the note must start with
    // the same glyph as the reset notes or the grid's left edges diverge
    // (0.1.15 shipped ' ( unlimited )', which broke alignment against the
    // full-width （ Resets: … ） notes the template used to emit in en too).
    noteOpen: "( ",
    noteClose: " )",
    windows: {
      "5h": "5-hour quota",
      week: "Weekly quota",
      month: "Monthly quota",
      mcp: "MCP (month)"
    },
    resetCards: {
      section: "Quota reset cards",
      querying: "Checking",
      week: "Weekly reset card",
      fiveHour: "5-hour reset card",
      count: "{count}",
      none: "none",
      use: "Reset",
      expiry: "expires {date}",
      expiryAssumed: "No-zone stamps are read as Beijing time \u2014 not an official upstream statement",
      unconfirmed: "Outcome unconfirmed \u2014 check the official card count and quota",
      outcomeUnknownTitle: "Last manual reset outcome unconfirmed",
      outcomeUnknownBody: "A card may have been spent and nothing retries automatically. Check the official card count and quota first, then confirm below.",
      verifyButton: "I verified it",
      knownSuccessTitle: "Last manual reset: confirmed success",
      knownRefusedTitle: "Last manual reset: refused upstream",
      acknowledgeButton: "I acknowledge",
      storageUnavailable: "Manual card use unavailable (outcome journal unreadable)",
      confirmTitle: "Use a reset card?",
      confirmWeek: "This spends 1 weekly reset card and immediately resets both the weekly and 5-hour quotas.",
      confirmFiveHour: "This spends 1 5-hour reset card and immediately resets the 5-hour quota.",
      confirmIrreversible: "The card is consumed and cannot be restored.",
      ok: "Use card",
      cancel: "Cancel",
      working: "Resetting\u2026",
      succeeded: "Reset done",
      failed: "Reset failed"
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
@media print { :host { display: none !important; } }
`;
var FLOAT_STYLE_TEXT = `
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
.dqw-capsule [hidden] { display: none; }
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
/* Overview-only pin: the capsule pop matches the sidebar card (240px); detail
   views (GLM/Copilot) keep the 0.0.18 content-driven width above. :not() keeps
   the bottom sheet (\u2264480px) winning over the pin. Keyed off the data attr that
   syncPop already maintains \u2014 no JS state change. */
.dqw-panel[data-dsh-quota-watch-panel-overview]:not(.dqw-panel--sheet) { width: min(240px, calc(100vw - 24px)); }
.dqw-panel[hidden] { display: none; }
.dqw-panel *, .dqw-panel *::before, .dqw-panel *::after { box-sizing: border-box; }
.dqw-panel-header { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dqw-panel-title { margin: 0; font-size: 11px; font-weight: 600; line-height: 16px; flex: 1; min-width: 0; }
.dqw-panel-back { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; }
.dqw-panel-back svg { display: block; width: 16px; height: 16px; }
.dqw-panel-back:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, inherit); }
.dqw-panel-refresh { flex: none; margin: 0; padding: 4px 6px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; font: inherit; font-size: 10px; line-height: 14px; opacity: .72; }
.dqw-panel-refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, inherit); opacity: 1; }
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
.dqw-bar { display: block; flex: 1 1 auto; width: auto; min-width: 36px; height: 4px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-tertiary, rgba(128,128,128,.2)); }
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
.dqw-kv-sub { min-width: 0; overflow-wrap: anywhere; font-weight: 400; opacity: .55; }
.dqw-wins { display: grid; grid-template-columns: max-content max-content max-content max-content 1fr; column-gap: 6px; row-gap: 3px; align-items: baseline; font-size: 10.5px; line-height: 17px; font-variant-numeric: tabular-nums; }
.dqw-win-name { opacity: .65; }
.dqw-win-mid { opacity: .65; white-space: nowrap; }
.dqw-win-used { opacity: .65; white-space: nowrap; }
.dqw-win-val { min-width: 0; font-weight: 600; }
/* Reset cards: keep the dashed divider even when an empty wallet collapses to
   one row. The panel's \u7ACB\u5373\u5237\u65B0 is the only manual re-check control. */
.dqw-reset { border-top: 1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.dqw-reset-head, .dqw-reset-collapsed { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 10px; line-height: 14px; }
.dqw-reset-title { opacity: .65; }
.dqw-reset-lines { display: grid; grid-template-columns: max-content max-content minmax(0, 1fr) max-content max-content; column-gap: 6px; row-gap: 4px; align-items: center; font-size: 10.5px; line-height: 17px; font-variant-numeric: tabular-nums; }
.dqw-reset-row { display: contents; }
.dqw-reset-kind { white-space: nowrap; opacity: .65; }
.dqw-reset-mid { white-space: nowrap; text-align: center; opacity: .65; }
.dqw-reset-expiry { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .65; }
.dqw-reset-count { justify-self: end; white-space: nowrap; font-weight: 600; }
.dqw-reset-placeholder { min-width: 0; }

.dqw-reset-count.is-empty { font-weight: 400; opacity: .5; }
.dqw-reset-use { flex: none; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.4)); border-radius: 5px; background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.1)); color: inherit; font: inherit; font-weight: 400; font-size: 10px; line-height: 14px; padding: 1px 7px; cursor: pointer; }
.dqw-reset-use:hover:not(:disabled) { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.2)); }
.dqw-reset-use:disabled { cursor: default; opacity: .4; }
.dqw-reset-confirm { border: 1px solid var(--dsw-alias-label-warning, #d29922); border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; font-size: 10.5px; line-height: 15px; }
.dqw-reset-confirm-title { font-weight: 600; }
.dqw-reset-confirm-body { opacity: .8; }
.dqw-reset-confirm-warn { opacity: .65; }
.dqw-reset-confirm-actions { display: flex; gap: 6px; justify-content: flex-end; }
.dqw-reset-btn { border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.4)); border-radius: 5px; background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.1)); color: inherit; font: inherit; font-weight: 400; font-size: 10px; line-height: 14px; padding: 2px 9px; cursor: pointer; }
.dqw-reset-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-hover, rgba(128,128,128,.2)); }
.dqw-reset-btn:disabled { cursor: default; opacity: .5; }
.dqw-reset-btn.is-primary { border-color: var(--dsw-alias-label-warning, #d29922); }
.dqw-reset-notice { font-size: 10px; line-height: 14px; }
.dqw-reset-notice.is-ok { color: var(--dsw-alias-label-success, #3fb950); }
.dqw-reset-notice.is-error { color: var(--dsw-alias-label-danger, #c93c3c); }
.dqw-error { margin: 0; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-warning, #b46900); }
/* A pending manual outcome turns the capsule into the always-visible warning entry. */
.dqw-capsule[data-outcome='true'] { box-shadow: 0 0 0 2px var(--dsw-alias-label-warning, #d29922); }
/* Narrow widths (~280px containers and the \u2264480px bottom sheet): card rows
   wrap so kind, expiry and button never truncate horizontally; the expiry may
   grow onto its own line. The five-column alignment grid above stays for wide
   floating panels. */
@media (max-width: 480px) {
  .dqw-reset-lines { display: flex; flex-direction: column; gap: 4px; }
  .dqw-reset-row { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 6px; row-gap: 2px; }
  .dqw-reset-expiry { flex: 1 1 100%; white-space: normal; overflow: visible; text-overflow: clip; }
  .dqw-reset-use { margin-left: auto; }
}
`;
function localeFor2(win) {
  const host = String(win?.document?.documentElement?.lang ?? "").trim();
  if (host !== "") return host.toLowerCase().startsWith("zh") ? "zh" : "en";
  return String(win?.navigator?.language ?? "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
}
function formatNumber2(value, locale) {
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
  return `${formatNumber2(rounded, locale)}%`;
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
function text2(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value ?? "");
  return node;
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
  row.append(text2(doc, "span", "dqw-kv-label", label), text2(doc, "span", "dqw-kv-value", value));
  return row;
}
function displayableGlmUsage(usage) {
  if (usage?.status === "ready") return usage;
  if (usage?.status === "stale" && usage?.staleTooLong !== true) return usage;
  return void 0;
}
function glmRowModel(provider) {
  if (provider?.status === "missing") return null;
  if (provider?.status === "error") return { kind: "error", label: "GLM", error: provider.error, errorKind: provider.errorKind };
  const windows = provider?.plan?.windows;
  if (!Array.isArray(windows) || windows.length === 0) return null;
  const five = windows.find((window) => window?.key === "5h");
  const tokens = displayableGlmUsage(provider?.usage)?.totalTokens;
  return {
    kind: "data",
    label: "GLM",
    percent: five?.percent,
    stale: provider.status === "stale",
    error: provider.error,
    errorKind: provider.errorKind,
    extra: tokens
  };
}
function copilotRowModel(provider) {
  if (provider?.status === "missing") return null;
  if (provider?.status === "error") return { kind: "error", label: "Copilot", error: provider.error, errorKind: provider.errorKind };
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
    errorKind: provider.errorKind,
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
  pollIntervalMs = CLIENT_POLL_INTERVAL_MS,
  retryNoDataMs = 2e3,
  retryBackoff = 2,
  // Q16: a confirmed SUCCESS notice lingers about five seconds before the
  // panel returns to the latest inventory. Injectable for tests.
  outcomeNoticeMs = 5e3,
  // Shell-takeover sentinel (2026-10-13 ds-bot): inject `ctx.slots` to arm it.
  // Injectable so DOM tests and exotic hosts keep the legacy behavior.
  slots = null,
  // Host React for the slot-first sidebar seat; default resolves through the
  // module-loader factory and stays null under node --test / DOM tests.
  react = loadReact()
} = {}) {
  if (!doc?.body || typeof fetchImpl !== "function") return () => {
  };
  if (doc.querySelector(CARD_SELECTOR) || doc.querySelector(FLOAT_SELECTOR)) return () => {
  };
  let locale = localeFor2(win);
  let copy = COPY[locale];
  const container = doc.createElement("div");
  container.dataset.dshQuotaWatchCard = "";
  container.dataset.dshPlugin = "quota-watch";
  container.dataset.dshPart = "sidebar-card";
  if (typeof container.attachShadow !== "function") return () => {
  };
  const cardRoot = container.attachShadow({ mode: "open" });
  let style = text2(doc, "style", "", STYLE_TEXT);
  const card = doc.createElement("section");
  card.className = "dqw-card";
  card.setAttribute("aria-label", copy.title);
  const body = doc.createElement("div");
  body.className = "dqw-body";
  const lastUpdated = text2(doc, "p", "dqw-meta", copy.loading);
  lastUpdated.dataset.role = "updated";
  body.append(lastUpdated);
  card.append(body);
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
  floatRoot.append(text2(doc, "style", "", FLOAT_STYLE_TEXT));
  const buildCapsule = () => {
    const el = doc.createElement("div");
    el.className = "dqw-capsule";
    el.dataset.dshQuotaWatchCapsule = "";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-expanded", "false");
    el.append(
      text2(doc, "span", "dqw-capsule-glm", ""),
      text2(doc, "span", "dqw-capsule-sep", "\xB7"),
      text2(doc, "span", "dqw-capsule-copilot", "")
    );
    return el;
  };
  let surface = buildCapsule();
  floatRoot.append(surface);
  const syncFloatVisibility = () => {
    surface.hidden = dataHidden;
    floatHost.hidden = dataHidden;
  };
  doc.body.append(floatHost);
  const measureSurface = () => {
    const rect = surface.getBoundingClientRect();
    return rect.width > 0 ? { width: rect.width, height: rect.height } : FALLBACK_SIZE;
  };
  const applyPosition = () => {
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const viewport = { width: viewWidth, height: viewHeight };
    const size = measureSurface();
    const insets = readInsets();
    const pos = loadFloatPosition(win.localStorage) ?? {
      x: viewWidth - MARGIN - insets.right - size.width,
      y: viewHeight - MARGIN - insets.bottom - size.height
    };
    const point = clampPoint(pos, viewport, size, insets);
    floatHost.style.left = `${Math.round(point.x)}px`;
    floatHost.style.top = `${Math.round(point.y)}px`;
  };
  const safeAreaProbe = text2(doc, "div", "", "");
  safeAreaProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);";
  floatRoot.append(safeAreaProbe);
  const readTitlebarInset = () => {
    try {
      const html = doc.documentElement;
      return titlebarTopInset({
        titlebar: html.hasAttribute("data-windows-titlebar"),
        fullscreen: html.hasAttribute("data-fullscreen"),
        height: parseInset(win.getComputedStyle(html)?.getPropertyValue("--dsh-windows-titlebar-height"))
      });
    } catch {
      return 0;
    }
  };
  const readInsets = () => {
    try {
      const style2 = win.getComputedStyle(safeAreaProbe);
      return {
        top: Math.max(parseInset(style2?.paddingTop), readTitlebarInset()),
        right: parseInset(style2?.paddingRight),
        bottom: parseInset(style2?.paddingBottom),
        left: parseInset(style2?.paddingLeft)
      };
    } catch {
      return ZERO_INSETS2;
    }
  };
  applyPosition();
  floatRoot.append(panel);
  let suppressNextClick = false;
  const scheduleFrame = (fn) => typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame.call(win, fn) : fn();
  const attachDrag = (surfaceEl) => {
    let dragging = false;
    let moved = false;
    let originX = 0;
    let originY = 0;
    let slop = DRAG_SLOP_MOUSE;
    let grab = { dx: 0, dy: 0 };
    let dragSize = FALLBACK_SIZE;
    let restX = 0;
    let restY = 0;
    let lastPoint = null;
    const bindGesture = () => {
      doc.addEventListener("pointermove", onPointerMove);
      doc.addEventListener("pointerup", onPointerUp);
      doc.addEventListener("pointercancel", onPointerCancel);
    };
    const unbindGesture = () => {
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerCancel);
    };
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      originX = event.clientX;
      originY = event.clientY;
      slop = dragSlop(event.pointerType);
      const rect = surfaceEl.getBoundingClientRect();
      grab = grabOffset({ x: event.clientX, y: event.clientY }, rect);
      dragSize = rect.width > 0 ? { width: rect.width, height: rect.height } : FALLBACK_SIZE;
      restX = Number.parseFloat(floatHost.style.left) || 0;
      restY = Number.parseFloat(floatHost.style.top) || 0;
      surfaceEl.setPointerCapture?.(event.pointerId);
      bindGesture();
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      if (!moved) {
        if (Math.hypot(event.clientX - originX, event.clientY - originY) < slop) return;
        moved = true;
        doc.body.style.userSelect = "none";
        surfaceEl.classList.add("dqw-capsule--dragging");
      }
      lastPoint = { x: event.clientX, y: event.clientY };
      scheduleFrame(() => {
        if (!dragging || !lastPoint || disposed) return;
        const viewWidth = win.innerWidth ?? 1024;
        const viewHeight = win.innerHeight ?? 768;
        const insets = readInsets();
        const topLeft = clampFrame(lastPoint, grab, dragSize, { width: viewWidth, height: viewHeight }, insets);
        const dx = topLeft.x - restX;
        const dy = topLeft.y - restY;
        floatHost.style.willChange = "transform";
        floatHost.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
      });
    };
    const finishDragRelease = (point) => {
      surfaceEl.classList.remove("dqw-capsule--dragging");
      floatHost.style.willChange = "";
      floatHost.style.transform = "";
      saveFloatPosition(win.localStorage, point);
      applyPosition();
      suppressNextClick = true;
    };
    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      unbindGesture();
      doc.body.style.userSelect = "";
      if (!moved) return;
      const viewWidth = win.innerWidth ?? 1024;
      const viewHeight = win.innerHeight ?? 768;
      const insets = readInsets();
      const viewport = { width: viewWidth, height: viewHeight };
      const point = clampFrame(
        { x: event.clientX, y: event.clientY },
        grab,
        dragSize,
        viewport,
        insets
      );
      suppressNextClick = true;
      finishDragRelease(point);
    };
    const onPointerCancel = () => {
      if (!dragging) return;
      dragging = false;
      unbindGesture();
      doc.body.style.userSelect = "";
      surfaceEl.classList.remove("dqw-capsule--dragging");
      floatHost.style.willChange = "";
      floatHost.style.transform = "";
    };
    surfaceEl.addEventListener("pointerdown", onPointerDown);
    const disposeDrag2 = () => {
      surfaceEl.removeEventListener("pointerdown", onPointerDown);
      unbindGesture();
    };
    return disposeDrag2;
  };
  let snapshot;
  let normalSequence = 0;
  let timer;
  let noDataRetries = 0;
  let disposed = false;
  let queuedPlace = false;
  let openKey;
  let panelNav = false;
  const resetCards = createResetCards({
    doc,
    win,
    fetchImpl,
    copy: () => copy,
    routes: CLIENT_ROUTES,
    refresh: () => poll(),
    onDirty: () => {
      if (openKey === "glm") syncPop();
    },
    outcomeNoticeMs
  });
  let forceBusy = false;
  let forceGeneration = 0;
  let refreshBusy = false;
  let forcedResetForOpen = false;
  let dataHidden = true;
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
    const label = text2(doc, "span", "dqw-label", model.label);
    label.dataset.action = "refresh";
    label.title = `${model.label} \xB7 ${copy.refresh}`;
    row.append(label);
    if (model.kind === "error") {
      row.classList.add("is-error");
      row.append(text2(doc, "span", "dqw-errtext", model.error ? `${copy.failed}: ${model.error}` : copy.failed));
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
      const fill = text2(doc, "span", fillClass(model.percent));
      fill.style.width = `${Math.max(0, Math.min(100, model.percent))}%`;
      bar.append(fill);
      row.append(bar);
    }
    if (model.stale) {
      const mark = text2(doc, "span", "dqw-stale-mark", "\u26A0");
      mark.dataset.dshQuotaWatchStale = "";
      mark.title = model.errorKind === "auth" && model.error ? `${copy.authRejected}: ${model.error}` : model.error ?? copy.stale;
      row.append(mark);
    }
    row.append(text2(doc, "span", "dqw-pct", typeof model.percent === "number" ? formatPercent(model.percent, locale) : "\u2014"));
    if (model.extra !== void 0) {
      const extra = text2(doc, "span", "dqw-extra", formatCompact(model.extra, locale));
      extra.dataset.dshQuotaWatchExtra = "";
      row.append(extra);
    }
    row.append(text2(doc, "span", "dqw-chev", openKey === key ? "\u25BE" : "\u25B8"));
    return [row];
  };
  const panelHeader = ({ title, showBack = false, showRefresh = false }) => {
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
    header.append(text2(doc, "p", "dqw-panel-title", title));
    if (showRefresh) {
      const refresh = doc.createElement("button");
      refresh.type = "button";
      refresh.className = "dqw-panel-refresh";
      refresh.dataset.action = "panel-refresh";
      refresh.textContent = refreshBusy ? copy.actions.refreshing : copy.actions.refreshNow;
      refresh.setAttribute("aria-label", refresh.textContent);
      refresh.disabled = refreshBusy;
      header.append(refresh);
    }
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "dqw-panel-close";
    close.dataset.action = "panel-close";
    close.setAttribute("aria-label", copy.close);
    close.title = copy.close;
    close.append(text2(doc, "span", "", "\u2715"));
    header.append(close);
    return header;
  };
  const overviewActions = () => {
    const actions = doc.createElement("div");
    actions.className = "dqw-panel-actions";
    if (hasCardMount()) {
      const toggle = doc.createElement("button");
      toggle.type = "button";
      toggle.className = "dqw-panel-action";
      toggle.dataset.action = "toggle-card";
      const toggleLabel = surfaceFlags.cardHidden ? copy.actions.showCard : copy.actions.hideCard;
      toggle.textContent = toggleLabel;
      toggle.setAttribute("aria-label", toggleLabel);
      actions.append(toggle);
    }
    const refresh = doc.createElement("button");
    refresh.type = "button";
    refresh.className = "dqw-panel-action";
    refresh.dataset.action = "panel-refresh";
    refresh.textContent = refreshBusy ? copy.actions.refreshing : copy.actions.refreshNow;
    refresh.setAttribute("aria-label", refresh.textContent);
    refresh.disabled = refreshBusy;
    actions.append(refresh);
    return actions;
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
      panel.append(text2(doc, "p", "dqw-muted", lastUpdated.textContent || copy.loading));
    } else {
      const list = doc.createElement("div");
      list.className = "dqw-overview-list";
      list.append(...rows);
      for (const row of list.querySelectorAll("[data-dsh-quota-watch-row]")) {
        row.dataset.dshQuotaWatchPanelProvider = row.dataset.dshQuotaWatchRow;
      }
      panel.append(list);
    }
    const outcomeBlock = resetCards.renderOutcomeBlock(snapshot);
    if (outcomeBlock !== null) panel.append(outcomeBlock);
    panel.append(overviewActions());
  };
  function renderDetail(detail, key, provider, fromPanelNav = false) {
    detail.replaceChildren();
    detail.append(panelHeader({ title: copy.providerNames[key], showBack: fromPanelNav, showRefresh: key === "glm" }));
    if (provider?.status === "stale") {
      const bannerPrefix = provider.errorKind === "auth" ? copy.authRejected : copy.stale;
      detail.append(text2(doc, "p", "dqw-error", `${bannerPrefix}${provider.error ? `: ${provider.error}` : ""}`));
    }
    if (key === "glm") {
      const usage = displayableGlmUsage(provider?.usage);
      const numbers = doc.createElement("div");
      numbers.className = "dqw-bignums";
      const tokensBig = doc.createElement("div");
      tokensBig.className = "dqw-big";
      tokensBig.append(
        text2(doc, "div", "dqw-big-value", usage !== void 0 ? formatCompact(usage.totalTokens, locale) : "\u2014"),
        text2(doc, "div", "dqw-big-label", copy.todayTokens)
      );
      const callsBig = doc.createElement("div");
      callsBig.className = "dqw-big";
      callsBig.append(
        text2(doc, "div", "dqw-big-value", usage !== void 0 ? formatNumber2(usage.totalCalls, locale) : "\u2014"),
        text2(doc, "div", "dqw-big-label", copy.todayCalls)
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
            text2(doc, "span", "dqw-win-name", copy.weekUnlimited),
            text2(doc, "span", "dqw-win-mid", "\xB7"),
            text2(doc, "span", "dqw-win-used", copy.unlimited),
            text2(doc, "span", ""),
            text2(doc, "span", "dqw-kv-sub", copy.unlimitedNote)
          );
          continue;
        }
        const window = item.window;
        const percent = typeof window?.percent === "number" && Number.isFinite(window.percent) ? window.percent : void 0;
        const reset = formatTime(window?.resetsAt, locale);
        wins.append(text2(doc, "span", "dqw-win-name", copy.windows[window?.key] ?? window?.key));
        wins.append(text2(doc, "span", "dqw-win-mid", "\xB7"));
        wins.append(text2(doc, "span", "dqw-win-used", copy.windowUsed));
        wins.append(text2(doc, "span", "dqw-win-val", percent !== void 0 ? formatPercent(percent, locale) : "\u2014"));
        wins.append(text2(doc, "span", "dqw-kv-sub", reset ? `${copy.noteOpen}${copy.reset}: ${reset}${copy.noteClose}` : ""));
      }
      detail.append(wins);
      if (usage === void 0) {
        detail.append(text2(doc, "p", "dqw-muted", copy.todayModelsUnavailable));
      } else if (Array.isArray(usage.models) && usage.models.length > 0) {
        const models = doc.createElement("div");
        models.className = "dqw-models";
        for (const model of usage.models) {
          const row = doc.createElement("div");
          row.className = "dqw-model-row";
          row.append(
            text2(doc, "span", "dqw-model-name", model?.name ?? "\u2014"),
            text2(doc, "span", "dqw-model-value", formatCompact(model?.tokens, locale))
          );
          models.append(row);
        }
        detail.append(models);
      }
      if (provider?.credential === "configured" && provider?.providerId === PROVIDER_IDS.glmDomestic) {
        detail.append(resetCards.renderSection(snapshot));
        if (snapshot?.reset === void 0 && !forcedResetForOpen) {
          forcedResetForOpen = true;
          void poll(true);
        }
      }
      return;
    }
    const quota = provider?.quota;
    if (quota?.balanceAvailable === true) {
      detail.append(kvRow(doc, copy.available, `${formatNumber2(quota.remaining, locale)} / ${formatNumber2(quota.entitlement, locale)}`));
      const used = remainingToUsed(quota.percentRemaining);
      if (typeof quota.creditsUsed === "number" && quota.creditsUsed >= 0) {
        const row = doc.createElement("div");
        row.className = "dqw-kv";
        const value = doc.createElement("span");
        value.className = "dqw-kv-value";
        value.append(text2(doc, "span", "", formatNumber2(quota.creditsUsed, locale)));
        if (used !== void 0) value.append(text2(doc, "span", "dqw-kv-sub", ` \xB7 ${formatPercent(used, locale)}`));
        row.append(text2(doc, "span", "dqw-kv-label", copy.used), value);
        detail.append(row);
      }
      const reset = formatTime(quota?.resetsAt, locale);
      if (reset) detail.append(kvRow(doc, copy.resetTime, reset));
    } else {
      detail.append(text2(doc, "p", "dqw-muted", copy.stale));
    }
  }
  let lastAnchor = null;
  const anchorFromRow = (key) => () => body.querySelector(`[data-dsh-quota-watch-row="${key}"]`);
  const anchorFromEl = (el) => () => el;
  const placePanel = () => {
    if (panel.hidden) return;
    const anchor = lastAnchor?.();
    if (!anchor || !anchor.isConnected) return;
    if ((win.innerWidth ?? 1024) <= 480) {
      panel.classList.add("dqw-panel--sheet");
      panel.style.left = "";
      panel.style.top = "";
      return;
    }
    panel.classList.remove("dqw-panel--sheet");
    const rect = anchor.getBoundingClientRect();
    const viewWidth = win.innerWidth ?? 1024;
    const viewHeight = win.innerHeight ?? 768;
    const width = panel.offsetWidth || 240;
    const height = panel.offsetHeight || 160;
    let left = rect.right + 8;
    if (left + width > viewWidth - 8) left = rect.left - width - 8;
    if (left + width > viewWidth - 8) left = viewWidth - width - 8;
    left = Math.max(8, left);
    const minTop = MARGIN + readInsets().top;
    const top = Math.min(Math.max(rect.top, minTop), Math.max(minTop, viewHeight - height - 8));
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
  };
  const renderFloatFace = () => {
    const providers = snapshot?.providers ?? [];
    const glm = glmRowModel(providers.find((provider) => provider?.key === "glm"));
    const copilot = copilotRowModel(providers.find((provider) => provider?.key === "copilot"));
    const pendingOutcome = snapshot?.manualOutcome !== void 0 || snapshot?.manualOutcomeError !== void 0;
    dataHidden = glm === null && copilot === null && !pendingOutcome;
    if (dataHidden && openKey !== void 0) {
      openKey = void 0;
      syncPop();
    }
    syncFloatVisibility();
    if (floatHost.hidden) return;
    const paint = (span, model) => {
      const visible = model !== null && typeof model.percent === "number" && Number.isFinite(model.percent);
      span.hidden = !visible;
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
    if (pendingOutcome) surface.setAttribute("data-outcome", "true");
    else surface.removeAttribute("data-outcome");
    const summary = [glm, copilot].filter(Boolean).map((model) => `${model.label} ${formatPercent(model.percent, locale)}`).join(" \xB7 ");
    let label = summary === "" ? copy.title : locale === "zh" ? `${copy.title}\uFF1A${summary}` : `${copy.title}: ${summary}`;
    if (pendingOutcome) {
      const outcome = snapshot?.manualOutcome;
      const suffix = outcome?.status === "known-success" ? copy.resetCards.knownSuccessTitle : outcome?.status === "known-refused" ? copy.resetCards.knownRefusedTitle : copy.resetCards.outcomeUnknownTitle;
      label = `${label} \xB7 ${suffix}`;
    }
    surface.setAttribute("aria-label", label);
    surface.title = label;
    applyPosition();
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
  const hasCardMount = () => slotMode ? slotParent !== null : Boolean(footArea(doc));
  let currentFoot = null;
  let footTooNarrow = false;
  let noDataHidden = false;
  let slotMode = false;
  let slotParent = null;
  let slotDispose = null;
  let slotWide = true;
  let anchorRetryTimer = null;
  let shellTakeover = false;
  const syncShellTakeover = () => {
    try {
      shellTakeover = (slots?.entries?.("sidebar.workspaces") ?? []).some(
        (entry) => (entry.options.priority ?? 0) < 0
      );
    } catch {
      shellTakeover = false;
    }
  };
  const syncFootNarrowness = () => {
    const seat = slotMode ? currentFoot : slotParent ?? currentFoot;
    footTooNarrow = seat !== null && seat.clientWidth > 0 && seat.clientWidth < CARD_MIN_WIDTH;
  };
  const syncCardVisibility = () => {
    syncFootNarrowness();
    const slotRail = slotMode && slotWide === false;
    const showCard = !surfaceFlags.cardHidden && !footTooNarrow && !noDataHidden && !shellTakeover && !slotRail;
    container.hidden = !showCard;
    card.style.display = showCard ? "" : "none";
  };
  const scheduleSlotSync = () => {
    if (disposed) return;
    queueMicrotask(() => {
      if (!disposed) syncCardVisibility();
    });
  };
  const footResizeObserver = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(() => {
    syncCardVisibility();
  }) : null;
  const renderAll = () => {
    locale = localeFor2(win);
    copy = COPY[locale];
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
    if (force === true) {
      if (refreshBusy) return;
      refreshBusy = true;
      forceBusy = true;
      const generation = ++forceGeneration;
      renderAll();
      if (openKey !== void 0) syncPop();
      try {
        const next = await fetchJson(fetchImpl, CLIENT_ROUTES.refresh, "POST");
        if (generation === forceGeneration && !disposed) render(next);
      } catch {
        if (!disposed) showTransportError();
      } finally {
        forceBusy = false;
        refreshBusy = false;
        if (!disposed) {
          renderAll();
          if (openKey !== void 0) syncPop();
        }
      }
      return;
    }
    const sequence = ++normalSequence;
    const startedDuringForce = forceBusy;
    const genAtStart = forceGeneration;
    try {
      const next = await fetchJson(fetchImpl, CLIENT_ROUTES.overview, "GET");
      const applicable = !startedDuringForce && genAtStart === forceGeneration;
      if (sequence === normalSequence && applicable && !disposed) render(next);
    } catch {
      if (sequence === normalSequence && !disposed) showTransportError();
    } finally {
      if (timer === void 0 && sequence === normalSequence && !disposed && doc.visibilityState !== "hidden") {
        timer = win.setTimeout(() => {
          timer = void 0;
          if (!disposed && doc.visibilityState !== "hidden") void poll();
        }, nextPollDelay());
      }
    }
  };
  const place = () => {
    if (slotMode) return;
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
  const SEAT_MARKERS = ["sidebarCol", "footArea"];
  const seatValid = () => currentFoot !== null && currentFoot.isConnected && container.parentElement === currentFoot && currentFoot.firstElementChild === container;
  const nodeTouchesSeatDiscovery = (node) => {
    if (node?.nodeType !== 1) return false;
    const cls = node.getAttribute("class") ?? "";
    if (SEAT_MARKERS.some((marker) => cls.includes(marker))) return true;
    return node.querySelector('[class*="sidebarCol"], [class*="footArea"]') != null;
  };
  const batchTouchesSeatDiscovery = (records) => records.some((record) => {
    const touched = [...record.addedNodes ?? [], ...record.removedNodes ?? []];
    return touched.some(nodeTouchesSeatDiscovery);
  });
  const observer = new win.MutationObserver((records) => {
    const noLiveFoot = currentFoot === null || !currentFoot.isConnected;
    if (!batchTouchesSeatDiscovery(records) && (seatValid() || noLiveFoot)) return;
    schedulePlace();
  });
  if (!slotMode) observer.observe(doc.body, { childList: true, subtree: true });
  if (slots && typeof slots.inject === "function" && typeof slots.register === "function" && react && typeof react.createElement === "function") {
    try {
      const SLOT_SEAT_ID = "quota-watch-card";
      const CardSeat = (props) => {
        slotWide = props?.wide !== false;
        scheduleSlotSync();
        return react.createElement("div", {
          ref: (el) => {
            if (!slotMode) return;
            slotParent = el;
            if (el) {
              if (container.parentElement !== el) el.appendChild(container);
              footResizeObserver?.observe(el);
            } else {
              footResizeObserver?.disconnect();
            }
          },
          "data-dsh-quota-watch-slot": ""
        });
      };
      slotDispose = slots.inject(CARD_SLOT_NAME, () => slots.register(
        { name: CARD_SLOT_NAME, id: SLOT_SEAT_ID },
        CardSeat
      ));
      slotMode = true;
      syncCardVisibility();
      win.setTimeout(() => {
        if (disposed || !slotMode || slotParent) return;
        try {
          win.console?.debug?.("[dsh-quota-watch] slot seat: host never rendered the slot mount \u2014 falling back to legacy anchor seat");
        } catch {
        }
        slotMode = false;
        slotParent = null;
        slotWide = true;
        slotDispose?.();
        slotDispose = null;
        schedulePlace();
        syncCardVisibility();
      }, 5e3);
    } catch (error) {
      try {
        win.console?.debug?.(`[dsh-quota-watch] slot seat unavailable (${error?.message ?? error}) \u2014 using legacy anchor seat`);
      } catch {
      }
    }
  } else {
    try {
      win.console?.debug?.("[dsh-quota-watch] slot seat: slots facade or host React unavailable \u2014 using legacy anchor seat");
    } catch {
    }
  }
  if (!slotMode) {
    let anchorMisses = 0;
    anchorRetryTimer = win.setInterval(() => {
      if (disposed || seatValid()) return;
      schedulePlace();
      anchorMisses += 1;
      if (anchorMisses === 4) {
        try {
          win.console?.warn?.("[dsh-quota-watch] sidebar anchor (sidebarCol/footArea) not found \u2014 sidebar card not mounted; capsule unaffected");
        } catch {
        }
      }
    }, 15e3);
  }
  const langObserver = typeof win.MutationObserver === "function" ? new win.MutationObserver(() => {
    if (!disposed) renderAll();
  }) : null;
  langObserver?.observe(doc.documentElement, { attributeFilter: ["lang"] });
  let offShellTakeover = null;
  try {
    if (slots && typeof slots.subscribe === "function") {
      offShellTakeover = slots.subscribe("sidebar.workspaces", () => {
        if (disposed) return;
        syncShellTakeover();
        syncCardVisibility();
      });
    }
  } catch {
  }
  syncShellTakeover();
  syncFloatVisibility();
  place();
  const nextPollDelay = () => {
    if (!dataHidden) {
      noDataRetries = 0;
      return pollIntervalMs;
    }
    const delay = retryNoDataMs * retryBackoff ** noDataRetries;
    noDataRetries += 1;
    return Math.min(delay, pollIntervalMs);
  };
  const startPolling = () => {
    if (timer !== void 0 || doc.visibilityState === "hidden" || disposed) return;
    void poll();
  };
  const stopPolling = () => {
    if (timer !== void 0) win.clearTimeout(timer);
    timer = void 0;
  };
  const onVisibilityChange = () => {
    if (doc.visibilityState === "hidden") stopPolling();
    else startPolling();
  };
  const toggleRow = (key) => {
    panelNav = false;
    lastAnchor = anchorFromRow(key);
    if (openKey !== key) forcedResetForOpen = false;
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
    if (event.target?.closest?.('[data-action="panel-refresh"]')) {
      void poll(true);
      return;
    }
    if (event.target?.closest?.('[data-action="toggle-card"]')) {
      setCardHidden(!surfaceFlags.cardHidden);
      return;
    }
    if (event.target?.closest?.('[data-action="panel-close"]')) {
      resetCards.clearPending();
      openKey = void 0;
      syncPop();
      return;
    }
    if (event.target?.closest?.('[data-action="back-to-overview"]')) {
      resetCards.clearPending();
      openKey = "overview";
      syncPop();
      return;
    }
    const provider = event.target?.closest?.("[data-dsh-quota-watch-panel-provider]");
    if (provider) {
      forcedResetForOpen = false;
      openKey = provider.dataset.dshQuotaWatchPanelProvider;
      panelNav = true;
      syncPop();
    }
  };
  const onBodyClick = (event) => {
    if (event.target?.closest?.('[data-action="refresh"]')) {
      if (refreshBusy) return;
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
    if (path.includes(panel) || path.includes(container)) return;
    const target = event.target;
    if (target === panel || target === container) return;
    if (target?.getRootNode?.() === cardRoot || target?.getRootNode?.() === floatRoot) return;
    resetCards.clearPending();
    openKey = void 0;
    renderAll();
  };
  let scrollFrameQueued = false;
  const onDocScroll = () => {
    if (scrollFrameQueued || disposed) return;
    scrollFrameQueued = true;
    scheduleFrame(() => {
      scrollFrameQueued = false;
      if (!disposed) placePanel();
    });
  };
  const onWinResize = () => {
    placePanel();
    syncCardVisibility();
    applyPosition();
  };
  const onDocKeydown = (event) => {
    if (event.key !== "Escape") return;
    if (openKey !== void 0) {
      if (openKey === "glm" && resetCards.clearPending()) {
        renderAll();
        return;
      }
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
    resetCards.dispose();
    if (anchorRetryTimer !== null) win.clearInterval(anchorRetryTimer);
    anchorRetryTimer = null;
    slotDispose?.();
    observer.disconnect();
    langObserver?.disconnect();
    if (offShellTakeover) offShellTakeover();
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
    disposeDrag();
    doc.body.style.userSelect = "";
    container.remove();
    panel.remove();
    floatHost.remove();
  };
}
function apply(ctx) {
  ctx.effect(() => mountQuotaCard({ slots: ctx.slots ?? null }), "dsh-quota-watch: sidebar");
}

		return module.exports;
	}
});
