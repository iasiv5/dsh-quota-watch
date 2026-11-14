# poll-cadence 内部 seam 切出实施计划

## 目标

把 `mountQuotaCard` 闭包中残留的「轮询节奏 + 嵌入豁免」策略集群切出为内部 seam 模块
`src/client/poll-cadence.mjs`，行为逐字节等价（ADR 0007 既定 carve 程序的下一步）。
达成三个可验证结果：

1. cadence 集群拥有单一 owner：`ordinaryPollInFlight` 风暴守卫、重排条件、嵌入豁免面收敛进一个模块；
2. `dataSurfaceOpen` 对 A 集群 DOM（`container.hidden`）的读反转为 mount 注入的可见性回调，cadence 模块零 DOM 访问；
3. engage/暂停/恢复/豁免矩阵获得 mock-timers 决策表单测（`t.mock.timers`，仓库先例 `tests/host.test.mjs:374`），现有集成测试逐字节不动地保留为 no-drift 护栏。

## 架构快照

沿用 reset-cards carve 的三段式先例（commit 1e3be0e → 820924d）：先建模块+直测（unwired）→ 再接线挂载点 → 产物随笔重建。ADR 0007 冻结 `mountQuotaCard` 外部接口，本计划只动闭包内部。

### 新模块接口（钉死，执行中不得增删参数）

```js
// src/client/poll-cadence.mjs —— 零 import、零 DOM 访问、零 win 依赖
export function createPollCadence({
  doc,                // 只读 doc.visibilityState（单元测试传 { visibilityState } 桩）
  fetchImpl,          // 与 mountQuotaCard 同参注入
  routes,             // mount 传入 CLIENT_ROUTES（reset-cards 先例同款），用 .overview / .refresh
  pollIntervalMs, retryNoDataMs, retryBackoff,   // mount 的同名 options 透传
  isDisposed,         // () => boolean —— 读闭包 disposed
  isEmbedded,         // () => boolean —— 读闭包 embedded（embedded 所有权留在 mount，见下）
  isDataHidden,       // () => boolean —— 读闭包 dataHidden（冷启动退避判据）
  isDataSurfaceOpen,  // () => boolean —— mount 提供 () => openKey !== undefined || !container.hidden
  applySnapshot,      // (next) => void —— mount 的 render()
  onTransportError,   // () => void    —— mount 的 showTransportError()
  onBusyRender,       // () => void    —— () => { renderAll(); if (openKey !== undefined) syncPop() }
}) => {
  poll,               // (force?) —— 原 client.mjs poll 整体
  startPolling, stopPolling,
  syncEmbeddedPolling,
  isRefreshBusy,      // () => boolean —— 共享 立即刷新 busy 态的读 accessor
  onVisibilityChange, // doc visibilitychange 的委托入口（监听器接线留在 mount，dispose 结构不变）
}
```

### 状态归属划分

| 迁入 cadence（模块内部私有） | 留在 mount 闭包 |
|---|---|
| `timer`、`noDataRetries`、`normalSequence`、`forceBusy`、`forceGeneration`、`refreshBusy`、`ordinaryPollInFlight` | `disposed`、`embedded`（所有权不变，经 `isEmbedded()` 注入）、`dataHidden`、`openKey`、`snapshot`、`forcedResetForOpen` 及其余全部 |
| `fetchJson` 助手 + `FETCH_TIMEOUT_MS`（client.mjs 中唯一消费方就是 poll，L1440/L1461） | `lastOutsideCloseAt`、`suppressNextClick`（手势，不在本次范围） |

### setTimeout 等价性论证（计划内决策，执行线不得改回 win.setTimeout）

迁移后 cadence 用**裸 `setTimeout`/`clearTimeout`**，不再走 `win.setTimeout`：

- 浏览器 bundle：esbuild `format: 'cjs'` 包进 ModuleLoader factory（`scripts/build-client.mjs`），裸 `setTimeout` 解析到全局作用域 = `window.setTimeout`，运行时逐字节等价；
- node 单测：裸定时器是 node 全局定时器，被 `t.mock.timers.enable({ apis: ['setTimeout'] })` 拦截——这是本计划测试收益的前提；`clearTimeout` 随 `setTimeout` 启用一并被 mock（`tests/host.test.mjs:374-417` 同款用法已在仓内验证）；
- jsdom 集成测试：cadence 定时器从 jsdom 定时器变为 node 定时器——两者在 `node --test` 下都是真实定时器，节奏语义不变；既有集成测试不 mock 定时器且总在用例内 dispose，此差异对它们不可观测。**若 Task 4 全量复跑出现任何既有用例红，立即停下上报，不得改测试。**

### 嵌入态接线等价性论证

`embedded` 保持 mount 所有（embed.dispose() 的惰性失效语义依赖挂载侧镜像，不引入第三份镜像）。`onEmbeddedChange` 结构不变，仅委托目标换名：

- engage 分支：`embedded = next; cadence.syncEmbeddedPolling(); syncFloatVisibility()`——与原 L833-838 逐语句对应；
- disengage 分支：`embedded = next; syncFloatVisibility(); cadence.startPolling()`——与原 L839-842 逐语句对应。

## 全局约束（从 ADR 0007 / 仓根 AGENTS.md 逐字继承）

- **外部接口冻结**：`mountQuotaCard` 的 options bag、dispose 契约、包的 `./client` 导出不变；重构提交不得触碰。
- **no-drift 护栏**：未触碰集群的测试必须逐字节原样通过（「byte-unmodified」）。
- **产物纪律**：改 `src/client.mjs` / `src/client/*.mjs` 后必跑 `npm run build` 且 `lib/client.js` 随源码同笔提交（CI verify 重建后 `git diff --exit-code lib/client.js`，stale 直接红）。
- **零运行时依赖**：新模块零 import（routes/doc/fetchImpl 全部注入），不新增任何 npm 依赖。
- **版本锁步不在范围**：本计划不含发版——`package.json`、`src/client/embed.mjs` 的 `EMBED_GUEST_VERSION`、package-lock 均不动。
- **零文案改动**：不触碰 `COPY`、locale/*.json，无任何用户可见字符串新增或修改。
- 平台：Windows + Git Bash；`npm test` 经 `scripts/run-tests.mjs`（串行锁 + 15s 单例超时），锁文件 `/tmp/iasiv5-plugin-tests.lock`，同机勿并发跑套件。

## 输入工件

- 需求基线：架构评审裁决（2026-11-14 会话结论，唯一开工项=本 carve）
- ADR：`docs/adr/0007-client-internal-seams.md`（程序与冻结条款）、`docs/adr/0008-capsule-embed-protocol.md`（嵌入语义）、`docs/adr/0006-idle-polling-pause.md`（host 侧节奏背景）
- 先例：`docs/plans/2026-10-24-client-internal-seams-reset-cards-implementation-plan.md`；commit 1e3be0e/820924d/c99c683
- 基线测试记录：`/d/_dsh-workspace/.dsh-research/qw-plan-baseline-test.log`（2026-11-14，272 pass / 0 fail / EXIT=0 / ~20.4s，HEAD b1adab8）

## 基线与冻结面清点（Task 1 产出的对账锚点）

基线 HEAD `b1adab8`：全量 `npm test` = **tests 272 / pass 272 / fail 0**。既有 16 个测试文件全部冻结逐字节不动，逐文件用例数（`grep -c '^test('`，合计 272）：

| 文件 | 用例数 | 文件 | 用例数 |
|---|---|---|---|
| tests/client.test.mjs | 94 | tests/manual-redemption.test.mjs | 17 |
| tests/host.test.mjs | 37 | tests/reset-cards.test.mjs | 16 |
| tests/adapters.test.mjs | 17 | tests/package-shape.test.mjs | 13 |
| tests/client-reset-cards.test.mjs | 14 | tests/manual-outcome.test.mjs | 12 |
| tests/client-embed.test.mjs | 13 | tests/prefs.test.mjs | 10 |
| tests/security-scan.test.mjs | 8 | tests/credential-ref.test.mjs | 5 |
| tests/drag.test.mjs | 5 | tests/credentials.test.mjs | 4 |
| tests/legacy-auto-settings.test.mjs | 4 | tests/access-guard.test.mjs | 3 |

源码冻结面（不可触碰）：`src/client/embed.mjs`、`src/client/reset-cards.mjs`、`src/client/drag.mjs`、`src/client/prefs.mjs`、`src/host.mjs`、`src/core/*.mjs`、`src/shared.mjs`、`src/access.mjs`、`src/credential-ref.mjs`、`scripts/*.mjs`、`package.json`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`。
改动面（全部）：新建 `src/client/poll-cadence.mjs`、新建 `tests/poll-cadence.test.mjs`、修改 `src/client.mjs`、重建 `lib/client.js`。

## 文件结构与职责

- Create: `src/client/poll-cadence.mjs` —— 轮询节奏 + 嵌入豁免策略集群（接口见架构快照；ADR 0007 内部 seam，头注仿 reset-cards/embed 先例声明 seam 身份）
- Create: `tests/poll-cadence.test.mjs` —— mock-timers 决策表直测（15 例，清单见 Task 2）
- Modify: `src/client.mjs` —— 删除迁出代码、构造 cadence 并改写全部调用点（清单见 Task 4）
- Modify: `lib/client.js` —— 仅 Task 4 后 `npm run build` 重建，随源码同笔提交

## 任务清单

### Task 1: 基线钉住与冻结面记录

- 目标：把对账锚点（272/272、冻结文件清单）在本机当前 HEAD 复核一遍，供后续所有任务引用。
- 涉及文件：无改动（只读核证）。
- 接口契约
  - Consumes: 干净工作树（`git status --porcelain` 为空，HEAD = b1adab8 或其后的纯文档提交——若 HEAD 已前进，重跑基线更新数字并记录新 HEAD）
  - Produces: 对账数字「baseline N / pass N」与冻结面清单（写进执行日志，不落仓库文件）
- 验证范围：全量套件在当前 HEAD 全绿。

- [ ] Step 0: 计划文件先入库（仓库惯例：docs/plans 随仓管理；此后 porcelain 锚点才成立）
- Run: `git add docs/plans/2026-11-14-poll-cadence-carve-implementation-plan.md && git commit -m "docs(plans): poll-cadence carve implementation plan"`
- Expected: commit 成功，`git status --porcelain` 转空
- [ ] Step 1: 确认工作树与 HEAD
- Run: `git status --porcelain && git log --oneline -1`
- Expected: porcelain 为空 + HEAD 为基线或其文档后继（含本计划入库提交）
- [ ] Step 2: 全量基线复跑
- Run: `npm test`
- Expected: `tests 272 / pass 272 / fail 0`（HEAD 前进过则按新基线记录）——数字与 `docs/plans/2026-11-14-poll-cadence-carve-implementation-plan.md` 基线表一致

### Task 2: tests/poll-cadence.test.mjs 全矩阵测试（红灯）

- 目标：对钉死的 `createPollCadence` 接口写 15 例决策表直测；红灯来自模块缺失（`ERR_MODULE_NOT_FOUND`），整文件装不下——这是「模块不存在」型红灯，声明在案：Task 3 落地实现后即无后续红灯步骤（Task 4/5 是等价迁移，以绿 + 冻结面复核验证，不硬凑红灯）。
- 涉及文件：Create `tests/poll-cadence.test.mjs`。
- 接口契约
  - Consumes: `../src/client/poll-cadence.mjs` 的 `createPollCadence`（Task 3 产出）；`node:test` 的 `t.mock.timers`（先例 `tests/host.test.mjs:374`）
  - Produces: 15 例测试对 Task 3 实现的红绿判据
- 夹具纪律（钉死三件事）
  - 桩什么：只桩 `fetchImpl`（手工排队 promise 的假 fetch，记录 `{path, method}` 调用序列）、`doc`（`{ visibilityState: 'visible' }` 可变属性对象）、四个 getter 闭包（普通 let 变量，对应 isDisposed/isEmbedded/isDataHidden/isDataSurfaceOpen）。定时器一律 `t.mock.timers.enable({ apis: ['setTimeout'] })` + 同步 `t.mock.timers.tick(ms)` 推进，promise 链用 8 跳 setImmediate flush 落定（`for (let hop = 0; hop < 8; hop += 1) await new Promise((resolve) => setImmediate(resolve))`，先例 `tests/host.test.mjs:375-377` 同款）；禁止 sleep/真实定时器。本机 node v24 的 MockTimers 无 `tickAsync`（评审探针 TypeError 证实），不得使用。
  - 不许桩什么：不许桩 `AbortSignal`（真 `AbortSignal.timeout` 直接生效，假 fetch 忽略 signal 即可）；不许给模块加 `win` 参数；不许包一层自定义 timer 包装；不许改 `COPY` 或断言任何文案。
  - 期望值来源：全部延迟断言写绝对毫秒数（`pollIntervalMs: 30_000`、`retryNoDataMs: 2_000`、`retryBackoff: 2` 为标准注入值，个别用例另行声明）。
- 15 例清单（文件内顺序即此顺序；每例一个 `test('…')`）

  1. `ordinary GET applies the latest snapshot and re-arms at pollIntervalMs`——startPolling → tick+flush 推进定时器 → fetch `.overview` GET → applySnapshot 收到快照 → 再 tick 30_000 触发第二次 GET；断言调用序列 `['GET overview', 'GET overview']` 与两次 applySnapshot。
  2. `cold-start backoff re-arms at retryNoDataMs × retryBackoff^n capped at pollIntervalMs`——dataHidden=true、首次 GET reject → 断言臂序列 2_000 / 4_000 / 8_000 / 16_000 / 其后封顶 30_000（连续 tick+flush 验证延迟序列；第五臂 2000×2⁴=32000 已超 30_000 封顶）。
  3. `first success flips to warm cadence`——失败一次后成功，applySnapshot 回调里翻转 dataHidden=false → 下一臂 30_000；再成功后持续 30_000（noDataRetries 归零）。
  4. `warm client keeps pollIntervalMs across transport errors`——dataHidden=false 起步，GET reject → 断言 onTransportError 调用一次且下一臂仍 30_000。
  5. `visibilitychange hidden stops the chain; visible restarts with an immediate poll`——armed 后派 `onVisibilityChange`（doc.visibilityState 翻 'hidden'）→ tick 无 fetch；翻回 'visible' 再派 → 立即一次 GET 且链续排。
  6. `startPolling is a no-op while the document is hidden`——doc.visibilityState='hidden' 时 startPolling → 无 fetch、无 timer。
  7. `embedded engage with all data surfaces closed parks the chain`——armed 后 isEmbedded 翻 true → syncEmbeddedPolling → tick 无 fetch（timer 被 stopPolling 清除）。
  8. `embedded with a data surface open keeps an immediate poll and normal re-arm`——isEmbedded=true 且 isDataSurfaceOpen=true → syncEmbeddedPolling → 立即 GET + 30_000 续排。
  9. `storm guard: syncEmbeddedPolling during an in-flight ordinary GET fires no extra immediate poll`——GET 在飞（fetchImpl 返回未决 promise）时调 syncEmbeddedPolling（面开）→ 断言 fetch 恰 1 次；GET settle 后按常规续排（timer 在 pollIntervalMs 后触发第二次），期间额外调 syncEmbeddedPolling 亦不产生第二次即时 GET（在飞标记持续守卫，L1694-1695 双条件）。
  10. `a data surface opening with an armed timer does not double-poll`——armed（timer 已定）后翻 embedded+面开 → syncEmbeddedPolling → tick 到点恰一次 GET（`timer === undefined` 条件挡住重复 startPolling）。
  11. `a landing GET while embedded and closed does not re-arm; disengage revives immediately`——embedded=true、面关、在飞 GET settle → tick 无后续 fetch（重排条件 `!isEmbedded() || isDataSurfaceOpen()` 为假，L1476）；翻 embedded=false → startPolling 立即 GET。
  12. `poll(true) force: POST refresh, single flight via isRefreshBusy, busy clears after settle`——在飞期间 isRefreshBusy()===true、settle 后 false；fetch 序列恰一次 `POST refresh`；applySnapshot 收到响应。
  13. `an ordinary GET started during a force is never applied`——force 在飞期间发起普通 GET（startedDuringForce=true）→ 普通 GET 后返回：applySnapshot 不被它调用；force 响应正常 apply。
  14. `an ordinary GET started under an older force generation is never applied`——普通 GET 起飞后完成一次 force（generation++）→ 迟到普通 GET 的响应不 apply（genAtStart !== forceGeneration）。
  15. `disposed mid-flight: no apply, no re-arm; dispose stops an armed timer`——GET 在飞时 isDisposed 翻 true → settle 后无 apply、无重排；armed 状态下调 stopPolling → tick 无 fetch。

- [ ] Step 1: 写测试文件
- Change: 新建 `tests/poll-cadence.test.mjs`，头注声明被测 seam 与 mock-timers 口径；按上面清单 15 例逐例实现，共享夹具函数 `makeCadence(overrides)` 返回 `{ cadence, calls, applySnapshots, transportErrors, setVisibilityState, setEmbedded, setDataHidden, setDataSurfaceOpen, setDisposed }`（`calls` 为 `{path, method}` 调用序列；`setVisibilityState` 翻转桩 doc 的 `visibilityState`；setter 翻转对应 getter 闭包的底层变量——用例叙述里的「翻 embedded」「翻 disposed」即调这些 setter）。
- [ ] Step 2: 确认红灯
- Run: `npm test tests/poll-cadence.test.mjs`
- Expected: 红——`ERR_MODULE_NOT_FOUND`，无法解析 `../src/client/poll-cadence.mjs`；整文件装载失败计 fail 1（15 例未执行）。**红因必须只有这一个**；若另有语法/断言红，先修测试再继续。
- [ ] Step 3: 记录红灯计数（不提交，Task 3 完成后同笔提交）

### Task 3: src/client/poll-cadence.mjs 实现（unwired）

- 目标：实现模块本体；15 例转绿；既有 272 例与产物零变动。
- 涉及文件：Create `src/client/poll-cadence.mjs`。
- 接口契约
  - Consumes: Task 2 的 15 例测试（红转绿判据）；`src/client.mjs` L1427-1483（poll）、L1662-1677（nextPollDelay）、L1678-1703（start/stop/dataSurfaceOpen/sync/onVisibilityChange）的迁移源
  - Produces: `createPollCadence`（接口钉死见架构快照）——Task 4 接线的唯一依赖
- [ ] Step 1: 写最小实现
- Change: 新建模块，内容 = 迁移源逐行搬移 + 注入化替换（`disposed`→`isDisposed()`、`embedded`→`isEmbedded()`、`dataHidden`→`isDataHidden()`、`dataSurfaceOpen()`→`isDataSurfaceOpen()`、`win.setTimeout/clearTimeout`→裸 `setTimeout/clearTimeout`、`CLIENT_ROUTES.refresh/overview`→`routes.refresh/overview`、`render`→`applySnapshot`、`showTransportError`→`onTransportError`、`renderAll+openKey门槛syncPop`→`onBusyRender`）。实现全文（执行线照抄，不得另行发挥）：

```js
/**
 * The poll-cadence cluster of mountQuotaCard: the self-scheduling GET chain,
 * its cold-start backoff, the force/ordinary refresh watermark, and the CEP v1
 * poll-pause exemption (embedded guests keep their background chain parked
 * while no data surface is visible — 0.1.41).
 *
 * Internal seam of mountQuotaCard (ADR 0007): the external mountQuotaCard
 * interface is frozen; this module is wired only by src/client.mjs and is
 * tested directly by tests/poll-cadence.test.mjs. Zero imports — doc, fetch,
 * routes and every cross-cluster read arrive as injected getters — and zero
 * DOM access, so the engage/pause/resume/exemption matrix stays unit-testable
 * with mock timers and without jsdom. Bare setTimeout/clearTimeout resolve to
 * the window timers in the browser bundle (global scope) and to the Node
 * timers under node --test, which t.mock.timers intercepts.
 */

const FETCH_TIMEOUT_MS = 15_000

async function fetchJson(fetchImpl, path, method) {
  const response = await fetchImpl(path, {
    ...(method === 'POST' ? { method: 'POST' } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function createPollCadence({
  doc,
  fetchImpl,
  routes,
  pollIntervalMs,
  retryNoDataMs,
  retryBackoff,
  isDisposed,
  isEmbedded,
  isDataHidden,
  isDataSurfaceOpen,
  applySnapshot,
  onTransportError,
  onBusyRender,
}) {
  let timer
  let noDataRetries = 0
  let normalSequence = 0
  // Force/ordinary refresh watermark. An ordinary GET may only apply when it
  // started while NO force was in flight AND under the current force
  // generation — so a force result can neither be dropped by a later-started
  // GET that returned first, nor rolled back by a GET that started during the
  // force and returned late. Only a GET started after the force completed may
  // update the UI.
  let forceBusy = false
  let forceGeneration = 0
  // The ONE shared 立即刷新 busy state: the detail header button, the overview
  // action and every refresh click all honor this single flag.
  let refreshBusy = false
  // Ordinary-GET in-flight marker: render cascades (syncPop/syncCardVisibility →
  // syncEmbeddedPolling) must not fire an extra poll while one is landing —
  // a microtask-level poll storm would starve timers (0.1.41 regression guard).
  let ordinaryPollInFlight = false

  /** Cold-start cadence: while no provider has rendered any data, re-poll on
   * a shortening backoff (retryNoDataMs × retryBackoffⁿ, capped at
   * pollIntervalMs) so a desktop cold start surfaces the capsule in seconds
   * instead of waiting out the fixed interval. A successful render resets the
   * chain to the normal cadence; a transport error keeps the previous
   * dataHidden state, so a cold client keeps retrying fast and a warm one
   * stays calm. */
  const nextPollDelay = () => {
    if (!isDataHidden()) {
      noDataRetries = 0
      return pollIntervalMs
    }
    const delay = retryNoDataMs * (retryBackoff ** noDataRetries)
    noDataRetries += 1
    return Math.min(delay, pollIntervalMs)
  }

  const poll = async (force) => {
    if (isDisposed()) return
    if (force === true) {
      // One refresh at a time; its response always wins over any ordinary GET.
      if (refreshBusy) return
      refreshBusy = true
      forceBusy = true
      const generation = ++forceGeneration
      // Flip the shared busy state before the request: header button, overview
      // action and label clicks all re-render against it.
      onBusyRender()
      try {
        const next = await fetchJson(fetchImpl, routes.refresh, 'POST')
        if (generation === forceGeneration && !isDisposed()) applySnapshot(next)
      } catch {
        if (!isDisposed()) onTransportError()
      } finally {
        forceBusy = false
        refreshBusy = false
        if (!isDisposed()) onBusyRender()
      }
      return
    }
    const sequence = ++normalSequence
    ordinaryPollInFlight = true
    // Watermark captured at start: a GET that started during a force is never
    // applied, and neither is one started under an older force generation.
    const startedDuringForce = forceBusy
    const genAtStart = forceGeneration
    try {
      const next = await fetchJson(fetchImpl, routes.overview, 'GET')
      const applicable = !startedDuringForce && genAtStart === forceGeneration
      if (sequence === normalSequence && applicable && !isDisposed()) applySnapshot(next)
    } catch {
      if (sequence === normalSequence && !isDisposed()) onTransportError()
    } finally {
      ordinaryPollInFlight = false
      // Self-scheduling chain (replaces the fixed interval): every completed
      // poll — success OR transport error — arms the next one, so the no-data
      // backoff also covers a cold start whose first request fails outright.
      // The force path never arms a second chain: only the latest ordinary
      // GET may re-arm the timer. While merged (CEP v1) the guest keeps its
      // background chain parked — a landing GET may only revive it when a
      // guest data surface is visible (panel/pop/sidebar card, 0.1.41);
      // disengage / heartbeat-timeout restore always does.
      if (timer === undefined && sequence === normalSequence && !isDisposed() && (!isEmbedded() || isDataSurfaceOpen()) && doc.visibilityState !== 'hidden') {
        timer = setTimeout(() => {
          timer = undefined
          if (!isDisposed() && doc.visibilityState !== 'hidden') void poll()
        }, nextPollDelay())
      }
    }
  }

  const startPolling = () => {
    // 嵌入态仅在无可见数据面时拦截：面板/弹卡/副栏卡片可见 ⇒ 访客按自身节奏拉取（0.1.41）
    if (timer !== undefined || doc.visibilityState === 'hidden' || isDisposed() || (isEmbedded() && !isDataSurfaceOpen())) return
    void poll()
  }
  const stopPolling = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  /** 嵌入态轮询随数据面升降：任一数据面开 ⇒ 立即拉取并续排常规链；全关 ⇒ 恢复停链。
   *  豁免面由 mount 经 isDataSurfaceOpen 注入（openKey 或副栏卡片可见）；胶囊小脸
   *  嵌入态恒隐藏，不计入——后台停链语义保持。 */
  const syncEmbeddedPolling = () => {
    if (!isEmbedded() || isDisposed()) return
    if (isDataSurfaceOpen()) {
      // 在飞 GET 的级联渲染不补发即时拉取（settle 会按常规节奏续排），防微任务风暴
      if (!ordinaryPollInFlight && timer === undefined) startPolling()
    } else {
      stopPolling()
    }
  }
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') stopPolling()
    else startPolling()
  }

  return {
    poll,
    startPolling,
    stopPolling,
    syncEmbeddedPolling,
    isRefreshBusy: () => refreshBusy,
    onVisibilityChange,
  }
}
```

- [ ] Step 2: 确认新测试转绿
- Run: `npm test tests/poll-cadence.test.mjs`
- Expected: 15 pass / 0 fail
- [ ] Step 3: 确认既有面零扰动 + 产物零漂移
- Run: `npm test && npm run build && git diff --exit-code lib/client.js && git status --porcelain`
- Expected: `tests 287 / pass 287 / fail 0`；build 成功且 lib 无 diff（client.mjs 未接线，bundle 内容不变）；porcelain 恰两项 `?? src/client/poll-cadence.mjs`、`?? tests/poll-cadence.test.mjs`
- [ ] Step 4: checkpoint commit（unwired 模块 + 测试，仿先例 1e3be0e）
- Run: `git add src/client/poll-cadence.mjs tests/poll-cadence.test.mjs && git commit -m "refactor(client): add poll-cadence internal module with cadence matrix tests (unwired)"`
- Expected: commit 成功

### Task 4: 接线 mountQuotaCard 并重建 bundle

- 目标：删除闭包内迁出代码，构造 cadence，改写全部调用点；既有测试逐字节不动地全绿；bundle 随笔重建。
- 涉及文件：Modify `src/client.mjs`；Modify `lib/client.js`（重建）。
- 接口契约
  - Consumes: Task 3 的 `createPollCadence`（签名钉死）；Task 1 的冻结面清单
  - Produces: 接线完成的可发布源码态（Task 5 的最终对账对象）
- 调用点改写清单（`src/client.mjs`，行号为 HEAD b1adab8 读数，定位以符号为准）

  | 位置（符号） | 改写 |
  |---|---|
  | 文件头 import 区（L1-6） | 增 `import { createPollCadence } from './client/poll-cadence.mjs'` |
  | `FETCH_TIMEOUT_MS`（L18）与 `fetchJson`（L513-521） | 删除（唯一消费方 poll 已迁出） |
  | `createResetCards` 的 `refresh`（L822） | `() => poll()` → `() => cadence.poll()` |
  | `createEmbed` 的 `onEmbeddedChange`（L833-842） | `syncEmbeddedPolling()` → `cadence.syncEmbeddedPolling()`；`startPolling()` → `cadence.startPolling()`；其余逐语句保留（等价性论证见架构快照） |
  | 水位线状态块（L871-879：forceBusy/forceGeneration/refreshBusy/ordinaryPollInFlight） | 删除（迁入模块）；**L880 `forcedResetForOpen` 不在删除区间**，留 mount（renderDetail L1132 仍读写）；`dataHidden`（L884）保留 |
  | `dataHidden` 声明之后（约 L885） | 新增 `const cadence = createPollCadence({ doc, fetchImpl, routes: CLIENT_ROUTES, pollIntervalMs, retryNoDataMs, retryBackoff, isDisposed: () => disposed, isEmbedded: () => embedded, isDataHidden: () => dataHidden, isDataSurfaceOpen: () => openKey !== undefined || !container.hidden, applySnapshot: (next) => render(next), onTransportError: () => showTransportError(), onBusyRender: () => { renderAll(); if (openKey !== undefined) syncPop() } })`（原 L1687-1689 的豁免面注释随迁到 isDataSurfaceOpen 实参处） |
  | `panelHeader` 的 refreshBusy 读（L964、L966） | `refreshBusy` → `cadence.isRefreshBusy()` |
  | `overviewActions` 的 refreshBusy 读（L1002-1004） | 同上 |
  | `renderDetail` 的一次性强制刷新（L1134） | `void poll(true)` → `void cadence.poll(true)` |
  | `syncPop` 开头的嵌入态同步（L1201） | `syncEmbeddedPolling()` → `cadence.syncEmbeddedPolling()` |
  | `syncCardVisibility` 尾部（L1378） | 同上 |
  | `poll` 整体（L1427-1483）、`nextPollDelay`（L1662-1677）、`startPolling`/`stopPolling`/`dataSurfaceOpen`/`syncEmbeddedPolling`（L1678-1699） | 删除 |
  | `onVisibilityChange`（L1700-1703） | 改为委托 `const onVisibilityChange = () => cadence.onVisibilityChange()`（保持 L1837 注册与 L1855 解除引用的既有结构） |
  | `onPanelClick` 立即刷新（L1723） | `void poll(true)` → `void cadence.poll(true)` |
  | `onBodyClick` 立即刷新（L1760-1761） | `if (refreshBusy) return` → `if (cadence.isRefreshBusy()) return`；`void poll(true)` → `void cadence.poll(true)` |
  | mount 尾部启动（L1842） | `startPolling()` → `cadence.startPolling()` |
  | dispose（L1846） | `stopPolling()` → `cadence.stopPolling()`（dispose 契约与顺序逐语句不变） |

  时序注：cadence 构造点在 `dataHidden`（L884）之后——`applySnapshot`/`onTransportError`/`onBusyRender` 引用的 `render`/`showTransportError`/`renderAll`/`syncPop` 都是后置 const，仅经闭包惰性调用（poll 运行时才解引用），mount 体内无同步触发路径；`resetCards` 的 `refresh: () => cadence.poll()` 同理（用户交互才解引用）。构造本身无副作用（不注册监听、不设 timer）。

- [ ] Step 1: 按 清单 执行改写
- Change: 仅上表所列；其余闭包内容一字不动
- [ ] Step 2: 重建 bundle
- Run: `npm run build`
- Expected: `wrote lib/client.js`，且产物含 poll-cadence 代码（`grep -c "createPollCadence" lib/client.js` ≥ 2——定义+调用；grep 计数禁入 `&&` 链，独立执行）
- [ ] Step 3: 全量验证 + 冻结面复核
- Run: `npm test`；`git diff --stat -- tests/ src/client/embed.mjs src/client/reset-cards.mjs src/host.mjs`（期望空）；`git status --porcelain`（期望恰 2 项）
- Expected: `tests 287 / pass 287 / fail 0`；冻结面 diff 为空；porcelain 恰 `M src/client.mjs`、`M lib/client.js` 两项。**任何既有用例红 = 立即停下上报，不得改测试、不得改冻结文件。**
- [ ] Step 4: checkpoint commit（接线 + 重建产物，仿先例 820924d）
- Run: `git add src/client.mjs lib/client.js && git commit -m "refactor(client): wire mountQuotaCard to the poll-cadence internal seam; rebuild bundle"`
- Expected: commit 成功；`git status --porcelain` 为空

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项、矛盾、锚点不存在或验证命令无效，先停下修计划，不猜。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每任务跑完其定义的验证再进下一任务。
- 冻结面（测试文件与源码冻结清单）任何 diff 出现即停：要么是执行错误，要么是计划与现实不符——上报裁决，不自行绕过。
- 红灯前提纪律：Task 2 的红灯是「模块缺失」型（ERR_MODULE_NOT_FOUND），红因唯一性由 Step 2 断言；Task 3 之后不存在红灯步骤，等价迁移以「既有 272 例全绿 + 冻结面空 diff」验证，不硬凑红。
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明。
- 回退路径：Task 4 中途失败 → `git restore src/client.mjs lib/client.js` 回到 Task 3 checkpoint（unwired 态，全绿）；checkpoint 已提交后需整笔撤销 → `git revert` 对应提交，不手改历史。
- 本计划不改 `package.json`（无版本 bump），不触发发版链；推送由主人在复核后自行决定（pre-push 钩子会跑全量 + 新鲜度门禁）。
- 若当前分支非 `main` 或工作树不洁，先向主人确认再动手。

## 最终验证

- Run: `npm test`
- Expected: `tests 287 / pass 287 / fail 0`（基线 272 + 新增 15，阶段计数：Task 2 后 fail 1 红 → Task 3 后 287 绿 → Task 4 后 287 绿不变）
- Run: `npm run build && git diff --exit-code lib/client.js`
- Expected: 无输出（产物新鲜，与源码同笔）
- Run: `git status --porcelain && git log --oneline -3`
- Expected: 工作树洁；最近两笔 = Task 3/4 的 checkpoint commit
- Run: `git config core.hooksPath`
- Expected: `.githooks`（clone 后一次性配置已在位；若输出为空，先 `git config core.hooksPath .githooks` 再推送）

## 审阅 Checkpoint

- 计划正文结束后，交由独立评审代理按章程（基线覆盖/可行性/Consumes-Produces 闭合/冻结面清点/判据可执行性）对抗复核；评审通过前不进入实现。
