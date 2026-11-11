# quota-watch 访客侧重嵌入与手势水印修复实施计划（dsh-quota-watch）

## 目标

- 修复合并胶囊「偶尔点不出二级卡片 / 双胶囊叠影」的访客侧（quota-watch guest）成因：
  1. 外点关闭水印只在「被 open-panel 消费」时清零——外点关闭后 500ms 内的**新一次**点击
     （新 pointerdown 之后到达的 open-panel）被旧水印误吞，表现为额度一半偶尔点不开（P1）
  2. 看门狗超时自恢复后，独立态访客**忽略**心跳且只有 `embed-engage` 能回到嵌入态——
     宿主仍认为合并中时形成「宿主 engaged / 访客 standalone」永久分脑：qw 胶囊重新出现、
     与 sk 胶囊同位叠影，心跳不再被理睬，只有手动关/开合并开关或刷新才能恢复（P1）
- 配套：CEP v1 协议文档（宿主仓 dsh-stock-kanban 持有）与 ADR 0008 的语义行同步、版本 0.1.39 准备。
- 不在本计划内：dsh-stock-kanban 宿主侧修复（姊妹计划
  `dsh-stock-kanban/docs/plans/2026-11-11-quota-segment-reliability-implementation-plan.md`；
  其 Task 3「guest 替换重握手」与本计划 Task 2 互不依赖、互为兜底）、npm 发版动作。

## 架构快照

- **水印手势边界**：外点关闭水印的唯一用途是吞掉「同一手势」的 open-panel（外点 pointerdown
  关面板 → 该手势 pointerup → sk 派发 open-panel）。同一手势的 pointerup 必然先于下一个
  pointerdown，因此：`onDocPointerDown` 在面板已关（`openKey === undefined`）早退时顺手把
  水印清零，即可精确地把抑制范围收敛到原手势，之后的任何新点击都正常开面板。
  既有 500ms 窗口保留不动，作为非手势路径（如未来新宿主直接派发 open-panel）的兜底。
- **心跳重嵌入**：心跳只在宿主 engage 期间发送（sk `stopEngage` 同步清心跳定时器后再派发
  disengage，窗口级 CustomEvent 同步派发、无迟到心跳）。因此独立态访客收到心跳即证明
  存在一个仍认为合并中的宿主——直接 `setEmbedded(true)` 回嵌入态并重置看门狗。这同时覆盖
  「看门狗超时误恢复」（后台标签页定时器节流 / 主线程长冻结 >15s）与「guest 重挂后旧宿主
  心跳未断」两类分脑入口；watchdog 的孤儿保护语义不变。
- 两处改动均为**行为语义修订，协议报文不变**：`EMBED_PROTOCOL_VERSION` 保持 1，
  open-panel / heartbeat 的 detail 结构零改动。

## 全局约束

- `EMBED_PROTOCOL_VERSION` 保持 `1`（无报文结构变更；修订仅为行为语义）。
- `EMBED_GUEST_VERSION` 与 package.json 版本锁步（`tests/package-shape.test.mjs:157` 断言持有），
  Task 4 必须同步改两处。
- 零新增依赖；不引入 `@deepseek-ai/*` 运行时依赖（vendor 红线，know-how 041）。
- 命令环境：bash + Node >= 20；测试命令 `npm test`（即 `node --test`）。

## 输入工件

- 诊断结论（本会话 2026-11-11 排查）：分脑机制链（心跳 5s / 看门狗 15s / MutationObserver
  只看 body childList 而访客自恢复仅翻 `hidden` 属性）与水印误吞机制链。
- 既有测试模式：外点关闭抑制用例 `tests/client.test.mjs:565`（`t.mock.method(Date, 'now', ...)`
  时间mock）；心跳看门狗用例 `tests/client-embed.test.mjs`（`heartbeatTimeoutMs: 100` 真实定时器、
  `fire(win, "embed-heartbeat", { v: 1 })` 辅助）。
- 协议文档：`../dsh-stock-kanban/docs/interop/capsule-embed-protocol.md`（heartbeat 行 :35、
  降级矩阵行 :50-51）；`docs/adr/0008-capsule-embed-protocol.md`（孤儿保护句 :22）。

## 文件结构与职责

- Modify: `src/client.mjs`（Task 1：`onDocPointerDown` 手势边界清水印，:1751-1762）
- Modify: `src/client/embed.mjs`（Task 2：`onHeartbeat` 重嵌入，:72-75；Task 4：`EMBED_GUEST_VERSION`，:19）
- Modify: `../dsh-stock-kanban/docs/interop/capsule-embed-protocol.md`（Task 3：heartbeat 语义行；**跨仓编辑，见任务说明**）
- Modify: `docs/adr/0008-capsule-embed-protocol.md`（Task 3：孤儿保护句）
- Modify: `package.json`（Task 4：`"version": "0.1.38"` → `"0.1.39"`）
- Test: `tests/client.test.mjs`（Task 1 新用例，追加在 :595 抑制窗用例之后）
- Test: `tests/client-embed.test.mjs`（Task 2 新用例）
- Test: `tests/package-shape.test.mjs`（Task 4 的红绿驱动，断言本体不动）

## 任务清单

### Task 1: 外点关闭水印的手势边界（P1）

- 目标：面板已关状态下到达的任何 pointerdown 都清除外点关闭水印，使外点关闭后 500ms 内的
  新一次点击（新 pointerdown → open-panel）正常开面板；同一手势的 open-panel 仍被吞（既有
  `tests/client.test.mjs:565` 用例语义不变）。
- 涉及文件
  - Modify: `src/client.mjs`（`onDocPointerDown`，:1751）
  - Modify: `tests/client.test.mjs`（新用例，:595 之后）
- 接口契约
  - Consumes: 既有测试辅助 `dom()` / `mounted(window, snapshot([...]))` / `floatSurface(window)` /
    `glmProvider()` / `copilotProvider()` / `turn()`（tests/client.test.mjs 既有导入）。
  - Produces: 无对外接口变化（`lastOutsideCloseAt` / `OUTSIDE_CLOSE_GESTURE_MS` 常量与符号名不变）。
- 验证范围：`node --test tests/client.test.mjs`

- [ ] Step 1: 写失败测试（照 ：565 用例的时间 mock 与事件派发模式）

  ```js
  test('新手势 pointerdown 清除外点关闭水印：随后的 open-panel 正常开面板', async (t) => {
    const window = dom()
    const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
    t.after(() => { dispose(); window.close() })
    const capsule = floatSurface(window)
    const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
    const openPanel = () => window.dispatchEvent(new window.CustomEvent('dsh-quota-watch:open-panel', {
      detail: { v: 1, anchor: { left: 300, top: 40, right: 340, bottom: 60, width: 40, height: 20 } },
      composed: true,
      bubbles: true,
    }))
    let now = Date.now()
    t.mock.method(Date, 'now', () => now)

    capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    assert.equal(panel.hidden, false, '胶囊打开面板')

    window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    await turn()
    assert.equal(panel.hidden, true, '外点关闭面板（盖章，本手势无 open-panel）')

    now += 100
    window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    await turn()
    openPanel()
    await turn()
    assert.equal(panel.hidden, false, '外点关闭后的新手势点击（<500ms）正常开面板')
  })
  ```

  场景对应实机：用户在页面别处点了一下（外点关闭，该手势不产生 open-panel），随即点额度
  一半——第二次手势的 pointerdown 应当终结上一个手势的水印。
- Run: `node --test tests/client.test.mjs`
- Expected: 新用例红（当前实现水印不被新 pointerdown 清零，`Date.now() - lastOutsideCloseAt = 100 < 500`，panel 仍 hidden）。
- [ ] Step 2: 运行并确认失败
- Run: `node --test tests/client.test.mjs`
- Expected: 最后一条 `panel.hidden === false` 断言失败。
- [ ] Step 3: 写最小实现
  - Change: `onDocPointerDown` 的首个早退分支（:1752）改为：

    ```js
    const onDocPointerDown = (event) => {
      if (openKey === undefined) {
        // 手势边界：上一外点关闭手势的 open-panel 此时必然已送达（被吞）或不会再有
        // （同一手势的 pointerup 先于任何后续 pointerdown），水印清零，新点击恢复正常开关。
        lastOutsideCloseAt = 0
        return
      }
      // ……以下既有逻辑不动：面板内命中放行、cardRoot/floatRoot 放行、盖章 + 关面板
    ```

    既有 `:565` 用例不受影响：其序列是 click 开面板 → pointerdown（面板开，走盖章分支，
    不进新早退分支）→ open-panel 被吞 → 500ms 后 open-panel 正常开。
- [ ] Step 4: 运行并确认通过
- Run: `node --test tests/client.test.mjs`
- Expected: 全文件绿（含 `:565`「同一手势：外点关闭后的 open-panel 不重开」）。
- [ ] Step 5: checkpoint commit
- Run: `git add src/client.mjs tests/client.test.mjs && git commit -m "fix(client): 外点关闭水印收敛到单一手势——后续新手势点击不再被 500ms 窗口误吞"`
- Expected: commit 成功。

### Task 2: 独立态收到心跳直接回嵌入（P1）

- 目标：访客在 standalone 态收到 `embed-heartbeat` 时直接 `setEmbedded(true)` 并重置看门狗，
  消灭「宿主 engaged / 访客 standalone」永久分脑；看门狗孤儿保护与既有 engage 路径不变。
- 涉及文件
  - Modify: `src/client/embed.mjs`（`onHeartbeat`，:72-75）
  - Modify: `tests/client-embed.test.mjs`（新用例，照既有 `heartbeatTimeoutMs: 100` 真实定时器模式）
- 接口契约
  - Consumes: 既有测试辅助（该文件的 win 工厂与 `fire(win, "embed-heartbeat", { v: 1 })`）。
  - Produces: 心跳语义修订（独立态心跳 = 重嵌入信号），供 Task 3 文档表述引用。
- 验证范围：`node --test tests/client-embed.test.mjs`

- [ ] Step 1: 写失败测试（`fakeWin` / `fire` / `sleep` 为该文件既有辅助，tests/client-embed.test.mjs:21-33）

  ```js
  test('embed · 独立态收到心跳 → 直接回嵌入态（分脑自愈）', async () => {
    const win = fakeWin()
    const changes = []
    const embed = createEmbed({ win, heartbeatTimeoutMs: 100, onEmbeddedChange: (v) => changes.push(v) })
    try {
      fire(win, 'embed-heartbeat', { v: 1 })
      assert.equal(embed.isEmbedded(), true, '独立态心跳即重嵌入')
      assert.deepEqual(changes, [true])
      await sleep(150)
      assert.equal(embed.isEmbedded(), false, '心跳停止后看门狗仍恢复独立态（孤儿保护不变）')
    } finally {
      embed.dispose()
    }
  })
  ```
- Run: `node --test tests/client-embed.test.mjs`
- Expected: 新用例红（当前实现 `onHeartbeat` 对独立态直接 return，`isEmbedded()` 仍 false）。
- [ ] Step 2: 运行并确认失败
- Run: `node --test tests/client-embed.test.mjs`
- Expected: `isEmbedded() === true` 断言失败。
- [ ] Step 3: 写最小实现
  - Change: `embed.mjs` 的 `onHeartbeat` 改为：

    ```js
    const onHeartbeat = () => {
      // 心跳只在宿主 engage 期间发出（stopEngage 同步清心跳定时器后才派发 disengage）。
      // 独立态收到心跳＝宿主仍认为合并中（看门狗超时误恢复 / 访客重挂后旧宿主心跳未断），
      // 直接回嵌入并武装看门狗——心跳兼作重嵌入信号，消灭永久分脑。
      setEmbedded(true)
      armWatchdog()
    }
    ```

    `onEngage` / `onDisengage` / 看门狗本体不动；既有「心跳重置看门狗」（嵌入态）与
    「孤儿保护」用例语义不变。
- [ ] Step 4: 运行并确认通过
- Run: `node --test tests/client-embed.test.mjs`
- Expected: 全文件绿。
- [ ] Step 5: checkpoint commit
- Run: `git add src/client/embed.mjs tests/client-embed.test.mjs && git commit -m "fix(client): 独立态心跳兼作重嵌入信号——宿主/访客合并态分歧不再永久化"`
- Expected: commit 成功。

### Task 3: 协议文档与 ADR 语义行同步

- 目标：文档与 Task 2 的新语义一致；本任务为纯文档改动，无 TDD，以「改动前后可 grep 的
  语义句」为前后观察点。
- 涉及文件（**含一处跨仓编辑**：CEP 协议文档由 dsh-stock-kanban 仓持有，本计划经主人评审
  授权后在该仓内修改；两计划的合并顺序不限，本任务只描述 Task 2 的访客侧语义，不依赖
  姊妹计划的实施状态）
  - Modify: `../dsh-stock-kanban/docs/interop/capsule-embed-protocol.md`（heartbeat 行 ：35、降级矩阵行 :50-51）
  - Modify: `docs/adr/0008-capsule-embed-protocol.md`（孤儿保护句 ：22）
  - Modify: `src/client/embed.mjs`（文件头注释 ：5-8 的 lifecycle 描述顺带覆盖，随 Task 2 已部分完成则核对即可）
- 接口契约
  - Consumes: Task 2 的实现注释（语义表述以此为准）。
  - Produces: 无代码接口。
- 验证范围：grep 前后状态

- [ ] Step 1: 改动前检查
- Run: `grep -n "self-restores\|3 consecutive missed beats" ../dsh-stock-kanban/docs/interop/capsule-embed-protocol.md && grep -n "15 s heartbeat timeout restores" docs/adr/0008-capsule-embed-protocol.md`
- Expected: 两条旧语义句在场（「3 拍未达自恢复」未提及独立态心跳重嵌入）。
- [ ] Step 2: 改语义句
  - Change 1（协议文档 ：35 heartbeat 行）：在既有「Guest self-restores … orphan protection」
    之后追加一句（保持表格单行格式）：`A heartbeat received while standalone doubles as
    re-engage: the guest re-enters embedded directly (a standalone guest can only receive
    beats from a host that still considers the merge active).`
  - Change 2（协议文档 ：50-51 降级矩阵）：矩阵行「Host vanishes while merged」保持不变；
    追加一行 `Standalone guest receives a heartbeat | Re-enter embedded directly (split-brain self-heal)`。
  - Change 3（ADR 0008 :22）：孤儿保护句后补 `and a heartbeat arriving while standalone
    re-enters embedded (ADR 0008 §心跳语义修订, 0.1.39)`。
- [ ] Step 3: 改动后验证
- Run: `grep -n "re-enters embedded" ../dsh-stock-kanban/docs/interop/capsule-embed-protocol.md docs/adr/0008-capsule-embed-protocol.md`
- Expected: 两文件各至少一处命中。
- [ ] Step 4: checkpoint commit（R2-4：跨仓落点前置检查——若 sk 工作树不在其默认分支或存在未提交改动，停下向主人确认本笔 docs commit 落点后再执行，避免混入姊妹计划的 feature 分支）
- Run: `git -C ../dsh-stock-kanban branch --show-current && git -C ../dsh-stock-kanban status --porcelain`（前置检查，状态如实记录）
- Run: `git add docs/adr/0008-capsule-embed-protocol.md && git -C ../dsh-stock-kanban add docs/interop/capsule-embed-protocol.md && git commit -m "docs(adr): 心跳兼作重嵌入语义入 ADR 0008" && git -C ../dsh-stock-kanban commit -m "docs(interop): heartbeat 重嵌入与降级矩阵行更新（qw 0.1.39）"`
- Expected: 两仓 commit 各成功（跨仓两笔提交分开落）。

### Task 4: 版本 0.1.39 发版准备

- 目标：package.json 与 `EMBED_GUEST_VERSION` 锁步 bump，全量测试收口，形成可发版状态。
- 涉及文件
  - Modify: `package.json`（`"version": "0.1.38"` → `"0.1.39"`）
  - Modify: `src/client/embed.mjs`（`EMBED_GUEST_VERSION = '0.1.38'` → `'0.1.39'`，:19）
- 接口契约
  - Consumes: Task 1–3 全部合入；`tests/package-shape.test.mjs:157` 的锁步断言（红绿驱动）。
  - Produces: 0.1.39 可发版工作树。publish / tag / 轮询不在本计划内，按既有发版 runbook 执行
    （know-how 018：OIDC staged 发布窗口内不重推 tag；装机侧升级走 dshm 渠道）。
- 验证范围：`npm test` 全量

- [ ] Step 1: 只 bump package.json，确认锁步断言红
- Run: `sed -i 's/"version": "0.1.38"/"version": "0.1.39"/' package.json && node --test tests/package-shape.test.mjs`
- Expected: `EMBED_GUEST_VERSION stays in lockstep` 用例失败（红）。
- [ ] Step 2: 同步 `EMBED_GUEST_VERSION`，确认断言绿
- Run: `sed -i "s/EMBED_GUEST_VERSION = '0.1.38'/EMBED_GUEST_VERSION = '0.1.39'/" src/client/embed.mjs && node --test tests/package-shape.test.mjs`
- Expected: package-shape 全绿。
- [ ] Step 3: 全量测试
- Run: `npm test`
- Expected: 全量绿（0 失败）。
- [ ] Step 4: checkpoint commit
- Run: `git add package.json src/client/embed.mjs && git commit -m "chore(release): v0.1.39"`
- Expected: commit 成功。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾或验证命令无效先修计划再动手。
- Task 1 与 Task 2 改不同文件、相互独立，可并行；Task 3 依赖 Task 2 的实现注释定稿；
  Task 4 收口。
- 每完成一个任务运行该任务定义的验证；不无声跳步、不合并任务。
- Task 3 的跨仓提交（dsh-stock-kanban 协议文档）单独成笔，不与 qw 仓提交混用；
  若姊妹计划同批执行，该文件以本任务的语义句为准，姊妹计划不得重复改同一行。
- 遇阻、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 当前不在 main/master 单独分支要求：若工作树在 main 且未获明确同意，开分支再动手。

## 最终验证

- Run: `npm test`
- Expected: 全量绿（0 失败），其中含三个新用例（水印手势边界、心跳重嵌入、锁步 0.1.39）。
- 收尾核对（人工）：`git log --oneline -4`（qw 仓）应见 Task 1/2/4 三条 commit；
  `git -C ../dsh-stock-kanban log --oneline -1` 应见协议文档 commit。

## 审阅 Checkpoint

- 本计划为「合并胶囊额度段可靠性」双计划中的访客侧（dsh-quota-watch）一份；姊妹篇为
  `dsh-stock-kanban/docs/plans/2026-11-11-quota-segment-reliability-implementation-plan.md`。
- 两份计划相互独立、可分别评审与发版；本计划的 Task 2 是看门狗分脑（后台节流 / 主线程冻结
  >15s 后双胶囊叠影、点击命中错位）的唯一根治位，姊妹计划的 Task 3 为其加速兜底。
- 审阅通过前不进入实现。
