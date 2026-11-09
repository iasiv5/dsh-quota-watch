// src/client/embed.mjs 直测（CEP v1 访客侧协议簇，Plan B Task G2）。
// fake win 注入（EventTarget + CustomEvent），看门狗用参数注入缩短的
// heartbeatTimeoutMs 驱动真实定时器。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMBED_PROTOCOL_VERSION,
  EMBED_CAPABILITIES,
  EMBED_GUEST_VERSION,
  createEmbed,
} from "../src/client/embed.mjs";
import { mountQuotaCard } from "../src/client.mjs";
import { JSDOM } from "jsdom";

const NS = "dsh-quota-watch";

function fakeWin() {
  const target = new EventTarget();
  return {
    addEventListener: (type, fn, opts) => target.addEventListener(type, fn, opts),
    removeEventListener: (type, fn, opts) => target.removeEventListener(type, fn, opts),
    dispatchEvent: (ev) => target.dispatchEvent(ev),
    CustomEvent,
    setTimeout,
    clearTimeout,
  };
}

const fire = (win, type, detail) =>
  win.dispatchEvent(new CustomEvent(`${NS}:${type}`, { detail, composed: true, bubbles: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("embed · 协议常量", () => {
  assert.equal(EMBED_PROTOCOL_VERSION, 1);
  assert.deepEqual([...EMBED_CAPABILITIES], ["hide-pill", "anchored-panel", "poll-pause"]);
  assert.match(EMBED_GUEST_VERSION, /^\d+\.\d+\.\d+$/);
});

test("embed · probe → 同步应答 capabilities（detail 三字段）", () => {
  const win = fakeWin();
  const embed = createEmbed({ win, onEmbeddedChange() {}, onOpenPanel() {} });
  try {
    const replies = [];
    win.addEventListener(`${NS}:embed-capabilities`, (ev) => replies.push(ev.detail));
    fire(win, "embed-probe", { v: 1, host: "dsh-stock-kanban" });
    assert.equal(replies.length, 1, "同步应答恰一次");
    assert.deepEqual(replies[0], {
      v: 1,
      capabilities: ["hide-pill", "anchored-panel", "poll-pause"],
      guestVersion: EMBED_GUEST_VERSION,
    });
  } finally {
    embed.dispose();
  }
});

test("embed · engage → onEmbeddedChange(true)，isEmbedded 读数", () => {
  const win = fakeWin();
  const states = [];
  const embed = createEmbed({
    win,
    heartbeatTimeoutMs: 10000,
    onEmbeddedChange: (v) => states.push(v),
    onOpenPanel() {},
  });
  try {
    assert.equal(embed.isEmbedded(), false, "初始未嵌入");
    fire(win, "embed-engage", { v: 1 });
    assert.equal(embed.isEmbedded(), true);
    assert.deepEqual(states, [true]);
  } finally {
    embed.dispose();
  }
});

test("embed · 心跳窗口内不恢复；超时后自恢复+清状态", async () => {
  const win = fakeWin();
  const states = [];
  const embed = createEmbed({
    win,
    heartbeatTimeoutMs: 100,
    onEmbeddedChange: (v) => states.push(v),
    onOpenPanel() {},
  });
  try {
    fire(win, "embed-engage", { v: 1 });
    await sleep(60);
    fire(win, "embed-heartbeat", { v: 1 }); // 看门狗重置
    await sleep(60);
    assert.equal(embed.isEmbedded(), true, "上次心跳后 60ms < 100ms：不恢复");
    await sleep(120); // 距上次心跳 ~180ms > 100ms
    assert.equal(embed.isEmbedded(), false, "超时自恢复");
    assert.deepEqual(states, [true, false]);
    // 清状态：恢复后再收到 engage 可重新进入
    fire(win, "embed-engage", { v: 1 });
    assert.equal(embed.isEmbedded(), true, "恢复后可重新嵌入");
  } finally {
    embed.dispose();
  }
});

test("embed · disengage → 立即 onEmbeddedChange(false)", () => {
  const win = fakeWin();
  const states = [];
  const embed = createEmbed({
    win,
    heartbeatTimeoutMs: 10000,
    onEmbeddedChange: (v) => states.push(v),
    onOpenPanel() {},
  });
  try {
    fire(win, "embed-engage", { v: 1 });
    fire(win, "embed-disengage", { v: 1 });
    assert.equal(embed.isEmbedded(), false);
    assert.deepEqual(states, [true, false]);
  } finally {
    embed.dispose();
  }
});

test("embed · open-panel 原样透传 anchor rect", () => {
  const win = fakeWin();
  const anchors = [];
  const embed = createEmbed({
    win,
    heartbeatTimeoutMs: 10000,
    onEmbeddedChange() {},
    onOpenPanel: (anchor) => anchors.push(anchor),
  });
  try {
    const rect = { left: 100, top: 200, width: 150, height: 26 };
    fire(win, "open-panel", { v: 1, anchor: rect });
    assert.equal(anchors.length, 1);
    assert.deepEqual(anchors[0], rect, "rect 对象原样透传");
  } finally {
    embed.dispose();
  }
});

test("embed · dispose 后事件全不应答、看门狗已清", async () => {
  const win = fakeWin();
  const states = [];
  let opened = 0;
  const embed = createEmbed({
    win,
    heartbeatTimeoutMs: 60,
    onEmbeddedChange: (v) => states.push(v),
    onOpenPanel: () => { opened += 1; },
  });
  fire(win, "embed-engage", { v: 1 });
  embed.dispose();
  fire(win, "embed-probe", { v: 1, host: "dsh-stock-kanban" });
  fire(win, "embed-engage", { v: 1 });
  fire(win, "open-panel", { v: 1, anchor: { left: 0, top: 0, width: 1, height: 1 } });
  assert.equal(embed.isEmbedded(), false, "dispose 后不进入嵌入态");
  assert.deepEqual(states, [true], "dispose 前的合法转换保留，之后零新增回调");
  assert.equal(opened, 0, "dispose 后不透传 open-panel");
  await sleep(120); // 若看门狗未清会在此窗口触发 onEmbeddedChange(false)
  assert.deepEqual(states, [true], "看门狗已清：超时不再新增回调");
});

/* ---------------- 集成组（真实 mountQuotaCard + fetch 桩 + jsdom，Task G3） ---------------- */

function qwResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function qwGlm() {
  return {
    key: "glm",
    displayName: "GLM Coding Plan",
    status: "ready",
    credential: "configured",
    updatedAt: Date.parse("2026-10-01T12:00:00.000Z"),
    plan: { planName: "GLM-Code-Plan", windows: [{ key: "5h", percent: 12.5, resetsAt: "2026-10-01T13:00:00.000Z" }] },
    usage: { status: "ready", totalTokens: 8300000, totalCalls: 152, models: [] },
  };
}

function qwSnapshot() {
  return { updatedAt: Date.parse("2026-10-01T12:00:00.000Z"), providers: [qwGlm()] };
}

function qwDom() {
  const { window } = new JSDOM(
    '<!doctype html><html><body><div class="frame"><div class="sidebarCol"><div class="footArea"><div class="settingsArea"><button class="settings-trigger" type="button"><svg width="16" height="16"></svg></button></div></div></div></div></body></html>',
    { url: "https://dsh.example/", pretendToBeVisual: true },
  );
  return window;
}

const fireHost = (win, type, detail) =>
  win.dispatchEvent(new win.CustomEvent(`${NS}:${type}`, { detail, composed: true, bubbles: true }));

test("embed 集成 · probe 应答 + engage 只藏 pill 不藏 host", async () => {
  const window = qwDom();
  const replies = [];
  window.addEventListener(`${NS}:embed-capabilities`, (ev) => replies.push(ev.detail));
  const dispose = mountQuotaCard({
    doc: window.document,
    win: window,
    fetchImpl: async () => qwResponse(qwSnapshot()),
    pollIntervalMs: 60000,
  });
  await sleep(10);
  try {
    fireHost(window, "embed-probe", { v: 1, host: "dsh-stock-kanban" });
    assert.equal(replies.length, 1, "真实 mount 下 probe → capabilities 恰一次");
    assert.equal(replies[0].guestVersion, EMBED_GUEST_VERSION);

    const host = window.document.querySelector("[data-dsh-quota-watch-float]");
    const surface = host.shadowRoot.querySelector(".dqw-capsule");
    assert.equal(surface.hidden, false, "数据在位：pill 初始可见");

    fireHost(window, "embed-engage", { v: 1 });
    assert.equal(surface.hidden, true, "嵌入态：pill 藏");
    assert.equal(host.hidden, false, "host 永不因 embed 隐藏");

    fireHost(window, "embed-disengage", { v: 1 });
    assert.equal(surface.hidden, false, "退出嵌入：pill 恢复");
  } finally {
    dispose();
    window.close();
  }
});

test("embed 集成 · 嵌入态停轮询链，disengage 恢复", async () => {
  const window = qwDom();
  let calls = 0;
  const dispose = mountQuotaCard({
    doc: window.document,
    win: window,
    fetchImpl: async () => { calls += 1; return qwResponse(qwSnapshot()); },
    pollIntervalMs: 15,
  });
  await sleep(40); // 初始 + 数拍
  assert.ok(calls >= 2, "轮询在跑");
  try {
    fireHost(window, "embed-engage", { v: 1 });
    const frozen = calls;
    await sleep(45);
    assert.equal(calls, frozen, "嵌入态：overview 请求冻结（再武装位与 startPolling 双守）");

    fireHost(window, "embed-disengage", { v: 1 });
    await sleep(45);
    assert.ok(calls > frozen, "退出嵌入：轮询恢复");
  } finally {
    dispose();
    window.close();
  }
});

test("embed 集成 · open-panel 锚定开面板 + toggle 语义（再点即关）", async () => {
  const window = qwDom();
  const dispose = mountQuotaCard({
    doc: window.document,
    win: window,
    fetchImpl: async () => qwResponse(qwSnapshot()),
    pollIntervalMs: 60000,
  });
  await sleep(10);
  try {
    const host = window.document.querySelector("[data-dsh-quota-watch-float]");
    const panel = host.shadowRoot.querySelector(".dqw-panel");
    assert.equal(panel.hidden, true, "初始关");
    const rect = { left: 100, top: 200, width: 150, height: 26 };
    fireHost(window, "open-panel", { v: 1, anchor: rect });
    await sleep(10);
    assert.equal(panel.hidden, false, "open-panel → 面板开（合成锚）");
    fireHost(window, "open-panel", { v: 1, anchor: rect });
    await sleep(10);
    assert.equal(panel.hidden, true, "再派发一次 → 面板关（toggle 语义）");
  } finally {
    dispose();
    window.close();
  }
});
