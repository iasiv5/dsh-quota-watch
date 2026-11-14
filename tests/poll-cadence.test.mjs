// src/client/poll-cadence.mjs 直测（poll-cadence 内部 seam，ADR 0007 carve 程序）。
// mock timers 口径：t.mock.timers.enable({ apis: ["setTimeout"] }) + 同步 tick(ms)
// 推进，promise 链用 8 跳 setImmediate flush 落定（先例 tests/host.test.mjs:375-377
// 同款）。本机 node v24 的 MockTimers 无 tickAsync，不得使用。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPollCadence } from "../src/client/poll-cadence.mjs";

const ROUTES = { overview: "api/dsh-quota-watch/overview", refresh: "api/dsh-quota-watch/refresh" };
const FLUSH = async () => {
  for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve));
};
const okResponse = (json) => ({ ok: true, json: async () => json });
const SNAP_A = { providers: [{ key: "glm", percent: 10 }] };
const SNAP_B = { providers: [{ key: "glm", percent: 20 }] };

/**
 * 共享夹具。默认 applySnapshot 在记录之外把 dataHidden 翻为 false——模拟真实
 * render 管线（renderFloatFace 成功渲染后重算 dataHidden）对冷启动退避判据的
 * 影响：全 reject 用例保持冷态退避，首次成功用例自动转暖。overrides 逐键
 * 覆盖注入面（签名钉死见实施计划）。
 */
function makeCadence(overrides = {}) {
  const state = { disposed: false, embedded: false, dataHidden: true, dataSurfaceOpen: false, visibilityState: "visible" };
  const calls = []; // { path, method, resolve, reject }
  const applySnapshots = [];
  const transportErrors = [];
  const fetchImpl = (path, init = {}) =>
    new Promise((resolve, reject) => {
      calls.push({ path, method: init.method ?? "GET", resolve, reject });
    });
  const cadence = createPollCadence({
    doc: {
      get visibilityState() {
        return state.visibilityState;
      },
    },
    fetchImpl,
    routes: ROUTES,
    pollIntervalMs: 30_000,
    retryNoDataMs: 2_000,
    retryBackoff: 2,
    isDisposed: () => state.disposed,
    isEmbedded: () => state.embedded,
    isDataHidden: () => state.dataHidden,
    isDataSurfaceOpen: () => state.dataSurfaceOpen,
    applySnapshot: (next) => {
      applySnapshots.push(next);
      state.dataHidden = false;
    },
    onTransportError: () => {
      transportErrors.push(calls.length - 1);
    },
    onBusyRender: () => {},
    ...overrides,
  });
  return {
    cadence,
    calls,
    applySnapshots,
    transportErrors,
    setVisibilityState: (v) => {
      state.visibilityState = v;
    },
    setEmbedded: (v) => {
      state.embedded = v;
    },
    setDataHidden: (v) => {
      state.dataHidden = v;
    },
    setDataSurfaceOpen: (v) => {
      state.dataSurfaceOpen = v;
    },
    setDisposed: (v) => {
      state.disposed = v;
    },
  };
}

test("poll-cadence · ordinary GET applies the latest snapshot and re-arms at pollIntervalMs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots } = makeCadence();
    cadence.startPolling();
    assert.equal(calls.length, 1, "startPolling 立即发起一次 GET");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].path, ROUTES.overview);
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH();
    assert.equal(applySnapshots.length, 1);
    assert.equal(applySnapshots[0], SNAP_A);
    // 成功转暖后重排臂 = pollIntervalMs：不足量 tick 不触发
    t.mock.timers.tick(29_000);
    await FLUSH();
    assert.equal(calls.length, 1, "29s 不足以触发 30s 臂");
    t.mock.timers.tick(1_000);
    await FLUSH();
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.path}`),
      [`GET ${ROUTES.overview}`, `GET ${ROUTES.overview}`],
    );
    calls[1].resolve(okResponse(SNAP_B));
    await FLUSH();
    assert.equal(applySnapshots.length, 2, "第二次快照生效");
    assert.equal(applySnapshots[1], SNAP_B);
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · cold-start backoff re-arms at retryNoDataMs × retryBackoff^n capped at pollIntervalMs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots } = makeCadence();
    cadence.startPolling();
    // 全程 reject：dataHidden 恒 true，臂序列 2000/4000/8000/16000/封顶 30000
    const stages = [
      { delay: 2_000, label: "2000×2⁰" },
      { delay: 4_000, label: "2000×2¹" },
      { delay: 8_000, label: "2000×2²" },
      { delay: 16_000, label: "2000×2³" },
      { delay: 30_000, label: "2000×2⁴=32000 封顶 30000" },
    ];
    for (const [index, stage] of stages.entries()) {
      calls[calls.length - 1].reject(new Error("transport down"));
      await FLUSH();
      assert.equal(applySnapshots.length, 0, "失败不 apply");
      t.mock.timers.tick(Math.max(stage.delay - 1_000, 0));
      await FLUSH();
      assert.equal(calls.length, index + 1, `${stage.label}：不足量不触发`);
      t.mock.timers.tick(1_000);
      await FLUSH();
      assert.equal(calls.length, index + 2, `${stage.label}：臂到点触发`);
    }
    assert.ok(calls.every((c) => c.method === "GET" && c.path === ROUTES.overview));
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · first success flips to warm cadence", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots } = makeCadence();
    cadence.startPolling();
    calls[0].reject(new Error("down"));
    await FLUSH();
    t.mock.timers.tick(2_000); // 冷态第一臂 2000
    await FLUSH();
    assert.equal(calls.length, 2);
    calls[1].resolve(okResponse(SNAP_A)); // 首次成功 → dataHidden 翻 false
    await FLUSH();
    assert.equal(applySnapshots.length, 1);
    t.mock.timers.tick(29_000);
    await FLUSH();
    assert.equal(calls.length, 2, "转暖后按 30s 续排：29s 不触发");
    t.mock.timers.tick(1_000);
    await FLUSH();
    assert.equal(calls.length, 3, "转暖臂 30s 触发");
    calls[2].resolve(okResponse(SNAP_B));
    await FLUSH();
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 4, "noDataRetries 已归零：后续臂持续 30s");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · warm client keeps pollIntervalMs across transport errors", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, transportErrors, setDataHidden } = makeCadence();
    setDataHidden(false);
    cadence.startPolling();
    for (let round = 0; round < 2; round += 1) {
      calls[calls.length - 1].reject(new Error("down"));
      await FLUSH();
      t.mock.timers.tick(29_000);
      await FLUSH();
      assert.equal(calls.length, round + 1, "29s 不触发");
      t.mock.timers.tick(1_000);
      await FLUSH();
      assert.equal(calls.length, round + 2, "warm 失败不回冷：仍按 30s 续排");
    }
    assert.equal(transportErrors.length, 2, "每次失败通知一次 transport error");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · visibilitychange hidden stops the chain; visible restarts with an immediate poll", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, setVisibilityState } = makeCadence();
    cadence.startPolling();
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH(); // armed 30s
    setVisibilityState("hidden");
    cadence.onVisibilityChange();
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 1, "hidden：armed 链已停");
    setVisibilityState("visible");
    cadence.onVisibilityChange();
    assert.equal(calls.length, 2, "visible：立即恢复一次 GET");
    calls[1].resolve(okResponse(SNAP_B));
    await FLUSH();
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 3, "恢复后链续排");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · startPolling is a no-op while the document is hidden", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, setVisibilityState } = makeCadence();
    setVisibilityState("hidden");
    cadence.startPolling();
    await FLUSH();
    assert.equal(calls.length, 0);
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 0, "hidden 下 startPolling 无操作、无 timer");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · embedded engage with all data surfaces closed parks the chain", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, setEmbedded, setDataSurfaceOpen } = makeCadence();
    cadence.startPolling();
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH(); // armed 30s
    setEmbedded(true);
    setDataSurfaceOpen(false);
    cadence.syncEmbeddedPolling(); // stopPolling
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 1, "嵌入且面全关：armed 链被停");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · embedded with a data surface open keeps an immediate poll and normal re-arm", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, setEmbedded, setDataSurfaceOpen } = makeCadence();
    setEmbedded(true);
    setDataSurfaceOpen(true);
    cadence.syncEmbeddedPolling(); // startPolling → 立即拉取
    assert.equal(calls.length, 1, "面开：立即拉取");
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH();
    t.mock.timers.tick(29_000);
    await FLUSH();
    assert.equal(calls.length, 1, "29s 不触发");
    t.mock.timers.tick(1_000);
    await FLUSH();
    assert.equal(calls.length, 2, "面开期间按常规节奏续排");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · storm guard: syncEmbeddedPolling during an in-flight ordinary GET fires no extra immediate poll", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, setEmbedded, setDataSurfaceOpen } = makeCadence();
    setEmbedded(true);
    setDataSurfaceOpen(true);
    cadence.startPolling(); // call1 在飞
    cadence.syncEmbeddedPolling(); // ordinaryPollInFlight → 不补发
    assert.equal(calls.length, 1, "在飞期间级联不补发即时拉取");
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH(); // settle → armed 30s
    cadence.syncEmbeddedPolling(); // timer 已定 → 仍不补发（双条件守卫）
    assert.equal(calls.length, 1, "settle 后 armed 也不补发");
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 2, "按常规节奏续排恰一次");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · a data surface opening with an armed timer does not double-poll", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, setEmbedded, setDataSurfaceOpen } = makeCadence();
    cadence.startPolling();
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH(); // armed 30s（此时 embedded=false）
    setEmbedded(true);
    setDataSurfaceOpen(true);
    cadence.syncEmbeddedPolling(); // timer !== undefined → 不 startPolling
    assert.equal(calls.length, 1, "armed 期间开面不双拉");
    t.mock.timers.tick(30_000);
    await FLUSH();
    assert.equal(calls.length, 2, "既有链到点触发恰一次");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · a landing GET while embedded and closed does not re-arm; disengage revives immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots, setEmbedded, setDataSurfaceOpen } = makeCadence();
    cadence.startPolling(); // call1 在飞（独立态起飞）
    setEmbedded(true);
    setDataSurfaceOpen(false);
    cadence.syncEmbeddedPolling(); // 停链（此时无 armed timer）
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH(); // 落地：重排条件 !embedded || dataSurfaceOpen() = false → 停链
    t.mock.timers.tick(60_000);
    await FLUSH();
    assert.equal(calls.length, 1, "嵌入态面全关：落地 GET 不重排");
    setEmbedded(false);
    cadence.startPolling(); // 脱离嵌入 → startPolling
    assert.equal(calls.length, 2, "脱离嵌入立即恢复");
    calls[1].resolve(okResponse(SNAP_B));
    await FLUSH();
    assert.equal(applySnapshots.length, 2);
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · poll(true) force: POST refresh, single flight via isRefreshBusy, busy clears after settle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots } = makeCadence();
    void cadence.poll(true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].path, ROUTES.refresh);
    assert.equal(cadence.isRefreshBusy(), true, "在飞期间共享 busy 置位");
    void cadence.poll(true);
    assert.equal(calls.length, 1, "single flight：在飞期间的第二次 force 不发请求");
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH();
    assert.equal(cadence.isRefreshBusy(), false, "settle 后 busy 复位");
    assert.equal(applySnapshots.length, 1);
    assert.equal(applySnapshots[0], SNAP_A);
    t.mock.timers.tick(60_000);
    await FLUSH();
    assert.equal(calls.length, 1, "force 路径不续排轮询链");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · an ordinary GET started during a force is never applied", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots } = makeCadence();
    void cadence.poll(true); // call1 POST 在飞，forceGeneration=1
    cadence.startPolling(); // ordinary call2 在 force 在飞期间起飞（startedDuringForce=true）
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, "GET");
    calls[0].resolve(okResponse(SNAP_A)); // force 响应先回
    await FLUSH();
    assert.deepEqual(applySnapshots, [SNAP_A], "force 响应生效");
    calls[1].resolve(okResponse(SNAP_B)); // 迟到普通 GET
    await FLUSH();
    assert.deepEqual(applySnapshots, [SNAP_A], "force 在飞期间起飞的普通 GET 永不 apply");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · an ordinary GET started under an older force generation is never applied", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots } = makeCadence();
    cadence.startPolling(); // call1 GET 在飞，genAtStart=0
    void cadence.poll(true); // force call2，generation=1
    assert.equal(calls.length, 2);
    calls[1].resolve(okResponse(SNAP_A)); // force 先回并生效
    await FLUSH();
    assert.deepEqual(applySnapshots, [SNAP_A], "force 响应生效");
    calls[0].resolve(okResponse(SNAP_B)); // 旧 generation 下起飞的普通 GET 迟到
    await FLUSH();
    assert.deepEqual(applySnapshots, [SNAP_A], "迟到普通 GET 不回滚 force 结果");
  } finally {
    t.mock.timers.reset();
  }
});

test("poll-cadence · disposed mid-flight: no apply, no re-arm; dispose stops an armed timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { cadence, calls, applySnapshots, transportErrors, setDisposed } = makeCadence();
    cadence.startPolling(); // call1 在飞
    setDisposed(true);
    calls[0].resolve(okResponse(SNAP_A));
    await FLUSH();
    assert.equal(applySnapshots.length, 0, "disposed 后响应不 apply");
    assert.equal(transportErrors.length, 0);
    t.mock.timers.tick(60_000);
    await FLUSH();
    assert.equal(calls.length, 1, "disposed 后不重排");
    // armed 状态下调 stopPolling（dispose 契约路径）→ tick 无 fetch
    setDisposed(false);
    cadence.startPolling();
    calls[calls.length - 1].resolve(okResponse(SNAP_B));
    await FLUSH(); // armed 30s
    setDisposed(true);
    cadence.stopPolling();
    t.mock.timers.tick(60_000);
    await FLUSH();
    assert.equal(calls.length, 2, "armed 后 stopPolling 清链");
  } finally {
    t.mock.timers.reset();
  }
});
