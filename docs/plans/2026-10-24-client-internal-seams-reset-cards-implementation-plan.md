# 客户端内部 seam 化一期实施计划（Step 0 门禁 + reset-cards 簇）

## 目标

- 落地 ADR 0007 的第一与第二个承诺：CI 漂移门禁（Step 0）+ 把 Manual redemption flow 从 `mountQuotaCard` 闭包抽成内部模块 `src/client/reset-cards.mjs`（Step 1）。
- 外部 interface（`mountQuotaCard` 选项包、dispose 语义、包 `./client` export）字节不变；未触碰簇的既有测试零修改通过。
- 完成判据：本机 `npm test` 失败集恰为环境白名单（Task 5 后由 5 条缩减为 4 条，见全局约束），push 后 CI 全绿为最终裁判；`npm run build && git diff --exit-code lib/client.js` 通过；`npm run security:check` 通过（本机为弱信号，见全局约束）。

## 架构快照

- `mountQuotaCard`（src/client.mjs）保持唯一外部 seam 与 `renderAll` 漏斗；新增内部 seam：`createResetCards` 模块，宿主编排层通过注入与之通信。
- 模块契约（含计划期事实核查后的一处修正——`clearPending()` 是 Q10 终稿之外新增的必需方法，因闭包外有 4 个 `resetPending` 清除点）：

```js
// src/client/reset-cards.mjs
createResetCards({
  doc, win, fetchImpl,
  copy: () => copyDict,     // 拉取式：locale 翻转后 renderAll 重新取词
  routes,                   // CLIENT_ROUTES（src/shared.mjs）
  refresh,                  // async () => poll()：花卡/回执后拉权威快照
  onDirty,                  // () => void：宿主回调内保留 openKey === 'glm' 的 syncPop 门控
  outcomeNoticeMs = 5_000,  // 沿用 mountQuotaCard 现有同名参数
})
// → {
//   renderSection(snapshot): Node,            // GLM 详情 domestic 段（内含 outcome block）
//   renderOutcomeBlock(snapshot): Node|null,  // 概览面板持久 outcome block（原 appendOutcomeBlock 调用点）
//   clearPending(): boolean,                  // 清掉一个待确认项时返回 true（Esc 门控用）
//   dispose(): void,                          // 清 outcomeNoticeTimer
// }
```

- 模块私有：状态 `resetPending/resetBusy/resetNotice/outcomeBusy/outcomeNoticeTimer`、`lastSnapshot`（每次 render 调用时留存，供点击守卫）、`fetchResetEnvelope` + `RESET_FETCH_TIMEOUT_MS`（随迁，全仓仅此流消费）、`manualLocked()`（无外部使用者，取证完毕）。
- 留守 `client.mjs`：force watermark（`normalSequence`/force generation）、轮询、胶囊（只读快照，`renderFloatFace` 不读任何模块状态）。
- 宿主接线点（符号锚点 + 当前行段）：渲染调用 `appendOutcomeBlock(panel)`（~1028）→ `renderOutcomeBlock`；`renderResetSection()`（~1390，renderDetail 内）→ `renderSection(snapshot)`；清除点 4 处 → `clearPending()`（panel-close ~1948、back-to-overview ~1954、outside pointerdown ~1995、Esc ~2020-2021）。

## 全局约束

- ADR 0001：shadow-root 隔离保持——模块渲染的 DOM 仍进既有 shadow 树，不新建 shadow root。
- ADR 0004/0005：手动核销语义零改动（journal/receipt/acknowledge 行为由既有测试钉住）。
- ADR 0007：外部 interface 冻结；未触碰簇测试零修改；每笔提交同笔携带重建的 `lib/client.js`。
- 依赖红线：`dependencies` 禁 `@deepseek-ai/*`、`src/` 零该 scope import（`tests/package-shape.test.mjs` 守卫，红即停）；本计划零依赖变更。
- 命名：文件 `src/client/reset-cards.mjs`、测试 `tests/client-reset-cards.test.mjs`；模块内部词汇沿用 `reset*` 系；领域术语 **Manual redemption flow**（GLOSSARY.md 已定稿）。
- 提交纪律：核准邮箱（`26645513+iasiv5@users.noreply.github.com` 或 `iasi@163.com`）；conventional commits；直推 main 小步；不为纯重构发版。
- 环境与命令：Windows，仓库用 npm（`package-lock.json`）；所有命令在仓库根 `dsh-quota-watch/` 下执行。
- **本机环境基线（Windows）与失败白名单**：本机 `npm test` 存在 5 条已核证的环境性失败（同一 HEAD 的 GitHub CI conclusion=success；机理：`scripts/check-public-package.mjs:130` 的 `relative()` 在 Windows 产生反斜杠路径致 filePatternMatcher 漏配，另几条为 POSIX errno 失败模拟在本机不复现）。本地一切 `npm test` 判据 =「失败集合与白名单**精确相等**」，push 后 **CI 必绿为最终裁判**；B2 的「未触碰测试零修改通过」在本机按白名单语义执行（除白名单外零失败且零修改）。白名单（仅此 5 条）：
  1. tests/client.test.mjs 'a confirmed success notice clears after about five seconds; refusals persist'（**本机时序敏感项：允许失败或通过**——2026-10-24 执行期实录其在两轮间翻转；Task 5 迁移删除后白名单固化为 4 条）
  2. tests/manual-outcome.test.mjs 'begin reports a deterministic storage failure instead of a phantom record'
  3. tests/manual-redemption.test.mjs 'a failed journal write sends no POST at all'
  4. tests/manual-redemption.test.mjs 'a known receipt write failure keeps the disk in-flight and the wallet locked'
  5. tests/security-scan.test.mjs 'pack manifest derivation expands the package.json files allowlist offline'
- **标准白名单判据命令**（各任务复用，`<K>` 为任务号）：`npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task<K>.log`，随后 `grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task<K>.log | grep -v "failing tests:" | sort -u`。说明：本机 spec 报告每个失败标题在运行段与末尾汇总段各出现一次，另有「✖ failing tests:」标题行——直接 `grep "^✖"` 出 2N+1 行，必须去重并剔除标题行。断言：失败标题集必须是白名单的**子集**（白名单外零失败），且 4 条稳定项（manual-outcome.test.mjs:82、manual-redemption.test.mjs:130、manual-redemption.test.mjs:200、security-scan.test.mjs:39 对应标题）必现；2044 为时序敏感项允许红或绿，故 Task 5 前提取行数为 4 或 5、Task 5 删除后恰 4；标题与白名单按子串对照（行尾 ms 耗时后缀不参与）。注意：`npm test` 经管道 tee 后退出码被吞，判定只认提取命令的集合断言，**不得**将 `npm test` 直接放入 `&&` 链（本机非零退出会掐断）；提取管道居 `&&` 链首属恒命中（预期非空输出），安全。提取命令自证：首跑（Task 1 Step 4）先在评审落盘的 `probe-npmtest-baseline.log` 上运行同一管道，核对恰 5 行、恰为白名单 5 标题（评审 probe-whitelist-extract-selftest.log 已亲证 dedup-count=5）；若未来 node 版本变更输出格式致 `^✖` 失配，以实际 log 固定等价提取命令后复用，白名单本身不改。
- `npm run security:check` 本机绿但 pack 面匹配在 Windows 缩水（同路径分隔符根因，本机漏扫只作弱信号）；CI 侧完整。

## 输入工件

- 设计共识：本会话 Q1–Q13 共识清单 + ADR `docs/adr/0007-client-internal-seams.md`（已写入，随 Task 1 提交）。
- 术语：`GLOSSARY.md` 的 "Manual redemption flow"（已写入）。
- 源锚点：`src/client.mjs`（mountQuotaCard 571–2079；核销簇 1035–1300；清除点 1948/1954/1995/2020）、`src/shared.mjs`（CLIENT_ROUTES）、`tests/client.test.mjs`。

## 文件结构与职责

- Create: `src/client/reset-cards.mjs` — Manual redemption flow 模块（状态 + 渲染 + 流程 + 私有传输）。
- Create: `tests/client-reset-cards.test.mjs` — 模块直测（jsdom document + 真 COPY 词典 + stub fetch/refresh）。
- Modify: `src/client.mjs` — 删除迁出的状态与函数；接线注入与 6 个调用点；追加 `export const COPY`（供直测取真词典；加法导出，不触碰 mountQuotaCard 契约）。
- Modify: `tests/client.test.mjs` — 删除 15 条已迁直测的旧集成测试（清单见 Task 5），保留 5 条集成。
- Modify: `.github/workflows/ci.yml` — `npm run build` 后插入漂移门禁。
- Modify: `docs/developers.md` — 补一句门禁纪律。
- 随 Task 1 首笔提交的既有新文件：`GLOSSARY.md`（词条）、`docs/adr/0007-client-internal-seams.md`。

## 任务清单

### Task 1: Step 0 — CI 漂移门禁 + 文档纪律 + 首笔提交

- 目标：堵住 `lib/client.js` 静默漂移；ADR 0007 与 GLOSSARY 词条入库。
- 涉及文件：`.github/workflows/ci.yml`、`docs/developers.md`、`GLOSSARY.md`、`docs/adr/0007-client-internal-seams.md`。
- 接口契约：Produces — CI 中的门禁步骤（后续所有任务依赖其本地等价命令 `npm run build && git diff --exit-code lib/client.js`）。
- 验证范围：门禁在漂移时非零退出、干净时零退出；全量测试不受影响。

- [ ] Step 1: 演示失败信号（本地等价门禁）
  - Run: `cd dsh-quota-watch && echo "export const __dqwDriftProbe = 1" >> src/client.mjs && npm run build 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/probe-task1-step1.log; git diff --exit-code lib/client.js; echo "exit=$?"; git checkout -- src/client.mjs lib/client.js && npm run build`
  - Expected: `exit=1`——追加 `export` 语句必改产物；纯注释探针无效（esbuild 剥离注释，bundle 字节不变），禁用注释探针。回滚后工作树干净。
- [ ] Step 2: 修改 `.github/workflows/ci.yml`
  - Change: 在 `- run: npm run build` 与 `- run: npm run security:check` 之间插入一行 `- run: git diff --exit-code lib/client.js`。
- [ ] Step 3: 修改 `docs/developers.md` 与 ADR 0007 措辞自洽
  - Change: 「门禁语义」节末追加一行：「bundle 漂移门禁：凡动 `src/client.mjs`（或任何进 bundle 的文件）的提交必须同笔带上 `npm run build` 重建的 `lib/client.js`；CI 在 build 后 `git diff --exit-code lib/client.js`，非零即红（ADR 0007）」。
  - Change: `docs/adr/0007-client-internal-seams.md` 条 2 的 "a small real interface (render + dispose)" 微调为 "a small real interface (two renderers, a clear, and dispose)"，与 reset-cards 实际方法集（renderSection/renderOutcomeBlock/clearPending/dispose）自洽。
- [ ] Step 4: 确认干净态通过（白名单语义首跑 + 提取命令自证）
  - Run: `grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/probe-npmtest-baseline.log | grep -v "failing tests:" | sort -u`（自证：恰 5 行、恰为白名单 5 标题）
  - Run: `cd dsh-quota-watch && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task1.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task1.log | grep -v "failing tests:" | sort -u | wc -l && npm run build && git diff --exit-code lib/client.js && npm run security:check`
  - Expected: 自证恰 5 行；任务 log 提取行数为 4 或 5、全属白名单且 4 条稳定项必现；build/diff/security:check 零退出（security:check 本机弱信号）。
- [ ] Step 5: checkpoint commit
  - Run: `git config user.email` 确认是核准邮箱后：`git add .github/workflows/ci.yml docs/developers.md GLOSSARY.md docs/adr/0007-client-internal-seams.md && git commit -m "chore(ci): gate lib/client.js freshness after build (ADR 0007, glossary term)"`

### Task 2: reset-cards 模块骨架 + 四态渲染直测

- 目标：模块文件落地，`renderSection` 的纯渲染行为直测全绿（此任务不接线，旧代码不动）。
- 涉及文件：Create `src/client/reset-cards.mjs`、Create `tests/client-reset-cards.test.mjs`。
- 接口契约：
  - Consumes: `CLIENT_ROUTES`（src/shared.mjs）、`parseResetExpiryTime`（src/core/reset.mjs）、`text()` 辅助（从 client.mjs 内联复制为模块私有，不改 client.mjs）。
  - Produces: `createResetCards`（完整签名见架构快照）与 `renderSection` 实现；直测样板（jsdom + COPY 词典 + stub 依赖）。
- 验证范围：新文件单测绿 + 全量测试仍绿（旧路径未动）。

- [ ] Step 1: 写失败直测（四态渲染）
  - Change: `tests/client-reset-cards.test.mjs` 新建：JSDOM document、`copy: () => COPY['zh']`（此时从 client.mjs import COPY 会失败——先断言 `import { COPY } from '../src/client.mjs'`），断言 `renderSection` 对 `snapshot.reset` 的 loading / error / ready-empty（折叠行）/ ready-available（含行与 expiry 标签）四态 DOM（断言值从原测试 'the card section renders four states purely from snapshot.reset' 原样复制）。
  - Run: `cd dsh-quota-watch && node --test tests/client-reset-cards.test.mjs`
  - Expected: 失败——`Cannot find module '../src/client/reset-cards.mjs'`（或 COPY 未导出）。
- [ ] Step 2: 写最小实现
  - Change: 新建 `src/client/reset-cards.mjs`：导出 `createResetCards`（签名见架构快照），实现内部状态、`lastSnapshot`、私有 `fetchResetEnvelope`/`RESET_FETCH_TIMEOUT_MS`（自 client.mjs 548-569 原样迁入）、私有 `text()`、`renderSection(snapshot)`（自 `renderResetSection`/`renderResetRow`/`earliestExpiryCard`/`earliestExpiryLabel` 迁入渲染部分；读 `copy()` 取词；返回 Node）；`renderOutcomeBlock/clearPending/dispose` 先落为最小桩（返回 `null`/`false`/空）。同时在 `src/client.mjs` 追加 `export const COPY`（仅追加导出，原 const 声明不变）。记录：esbuild cjs 产物会在 `lib/client.js` 的 exports 对象上新增 `COPY` 键——这是包 `./client` 导出面的**加法扩展**；基线 B1 冻结的是既有导出不变，新增键不构成违反，特此记录以免字面冲突。
- [ ] Step 3: 迁纯渲染直测
  - Change: 逐条把下列旧测试的断言改写为直测（DOM 断言原样复制，不放宽）：'the card section renders four states purely from snapshot.reset'、'the earliest expiry label, its focusable detail and host picking share one time source'、'a reported weekly window renders real data in fixed order without the placeholder'、'Chinese reset and unlimited notes use spaced parentheses and padded dates'、'domestic reset section stays two card lines with Beijing expiry and no auto-use controls'、'English empty reset section collapses to one row and keeps its separator'（后两条分别用 `COPY['zh']`/`COPY['en']`）。
  - Run: `cd dsh-quota-watch && node --test tests/client-reset-cards.test.mjs && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task2.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task2.log | grep -v "failing tests:" | sort -u | wc -l`
  - Expected: 直测文件零失败（单文件命令未过链即停）；提取行数为 4 或 5、全属白名单且 4 条稳定项必现（client.test.mjs 未动）。
- [ ] Step 4: checkpoint commit
  - Run: `git add src/client/reset-cards.mjs tests/client-reset-cards.test.mjs src/client.mjs && git commit -m "refactor(client): add reset-cards internal module with rendering tests (unwired)"`

### Task 3: 流程逻辑直测（按钮状态机、花卡、回执、clearPending）

- 目标：模块行为完整：确认框、双确认单 POST、outcome 分类呈现、acknowledge/receipt、Q16 定时器、`renderOutcomeBlock`、`clearPending`。
- 涉及文件：`src/client/reset-cards.mjs`、`tests/client-reset-cards.test.mjs`。
- 接口契约：
  - Consumes: Task 2 的骨架与直测样板；`COPY`（已导出）。
  - Produces: 完整 `createResetCards` 行为（含 `clearPending(): boolean` 布尔语义——仅在确有待确认项并清掉时 true）。
- 验证范围：流程直测绿 + 全量绿（仍未接线）。

- [ ] Step 1: 写失败直测（流程）
  - Change: 追加直测（断言自旧测试原样复制；fetch 用 stub 记录调用，`refresh` 用 stub，`win.setTimeout` 用真实 JSDOM window + `outcomeNoticeMs: 20`）：'the confirm box names the card type, both affected windows and irreversibility'（1705）、'a known success answer shows the result and auto-confirms delivery once'（1850）、'a known refusal shows the upstream message and confirms delivery too'（1861）、'a lost use answer never claims failure; the snapshot receipt persists until acknowledged'（1871）、'the unknown warning also reads in English'（1945，`COPY['en']`）、'an unreadable outcome journal shows manual use as unavailable and offers no button'（1966）、'a confirmed success notice clears after about five seconds; refusals persist'（2044；直测标题改为与注入参数一致，如 'a confirmed success notice clears after the configured delay; refusals persist'；`outcomeNoticeMs: 20` + `await new Promise(r => setTimeout(r, 50))`）、'after a manual spend the wallet comes from the overview snapshot, not a second list'（1609，refresh stub 断言恰好一次）、'reset rows wrap on narrow widths and keep the spend button focusable'（1648）、双确认恰好一次 spend POST（核心断言取自 1763：stub 记录 POST 次数 === 1 且 notice 落地）、`clearPending` 布尔语义（有待确认 → true 并清除；无 → false）。
  - Run: `cd dsh-quota-watch && node --test tests/client-reset-cards.test.mjs`
  - Expected: 流程相关新断言失败（桩未实现）。
- [ ] Step 2: 写最小实现
  - Change: 迁入 `spendResetCard`/`acknowledgeOutcome`/`renderManualOutcomeBlock`/`manualLocked`（自 client.mjs 1035-1159、1047-1098、1105-1115 原样迁入；`syncPop()` 改 `onDirty()`，`poll()` 改 `await refresh()`，`openKey` 判断删除——门控已由宿主 onDirty 承担；`win.clearTimeout/setTimeout` 沿用注入的 win）；实现 `renderOutcomeBlock`、`clearPending`、`dispose`（清 timer）；确认框取消按钮内 `resetPending = undefined` 后调 `onDirty()`。
- [ ] Step 3: 确认通过
  - Run: `cd dsh-quota-watch && node --test tests/client-reset-cards.test.mjs && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task3.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task3.log | grep -v "failing tests:" | sort -u | wc -l`
  - Expected: 直测文件零失败；提取行数为 4 或 5、全属白名单且 4 条稳定项必现（client.test.mjs 仍未动）。专项护栏：直测版 '…clears after the configured delay…' 若在本机红（即白名单外新增失败），**立即停下上报，不得为迁绿放宽断言**。
- [ ] Step 4: checkpoint commit
  - Run: `git add src/client/reset-cards.mjs tests/client-reset-cards.test.mjs && git commit -m "refactor(client): complete reset-cards flow behaviour with direct tests (unwired)"`

### Task 4: 接线 client.mjs（删旧、注入、清除点改写、重建 bundle）

- 目标：编排层改用模块；闭包五状态与迁出函数删除；行为字节不变。
- 涉及文件：`src/client.mjs`、`lib/client.js`（重建）。
- 接口契约：
  - Consumes: Task 3 的完整模块；6 个接线点（架构快照所列：2 渲染 + 4 清除）。
  - Produces: 瘦身后的 `mountQuotaCard`（外部契约不变）；供 Task 5 收口的全绿基线。
- 验证范围：**全量失败集恰为白名单 5 标题且 `tests/client.test.mjs` 零修改**（此时 15 条旧集成测试与直测并存；白名单内 2044 旧测试保持环境性红，其余并存测试零新失败——重复是本任务的可观察护栏）。

- [ ] Step 1: 注入与调用点改写
  - Change: `mountQuotaCard` 内新建 `const resetCards = createResetCards({ doc, win, fetchImpl, copy: () => copy, routes: CLIENT_ROUTES, refresh: () => poll(), onDirty: () => { if (openKey === 'glm') syncPop() }, outcomeNoticeMs })`；~1028 `appendOutcomeBlock(panel)` 改为 `const block = resetCards.renderOutcomeBlock(snapshot); if (block !== null) panel.append(block)`；~1390 `renderResetSection()` 改 `resetCards.renderSection(snapshot)`；1948/1954/1995 三处 `resetPending = undefined` 改 `resetCards.clearPending()`（忽略返回值）；2020-2021 改 `if (openKey === 'glm' && resetCards.clearPending()) { renderAll(); return }`；dispose 链追加 `resetCards.dispose()`。
- [ ] Step 2: 删除迁出代码
  - Change: 删除闭包状态声明（857-861 五个）、`manualLocked`/`spendResetCard`/`acknowledgeOutcome`/`renderManualOutcomeBlock`/`appendOutcomeBlock`/`renderResetRow`/`renderResetSection`/`earliestExpiryCard`/`earliestExpiryLabel` 函数与 `fetchResetEnvelope`/`RESET_FETCH_TIMEOUT_MS`。引用面已闭合（earliestExpiry* 定义于 374/384，引用 385/1165/1173 全部位于迁出函数体内），无需兜底分支——不允许「改由模块导出补充」的临场改道。删除后判据：`grep -n "earliestExpiry" src/client.mjs` 零命中（grep 零命中退出码为 1，属预期，单独运行、不入 && 链），`npm test` 兜底。
- [ ] Step 3: 验证（含硬护栏）
  - Run: `cd dsh-quota-watch && git diff --stat tests/client.test.mjs && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task4.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task4.log | grep -v "failing tests:" | sort -u | wc -l`
  - Expected: `git diff --stat tests/client.test.mjs` 输出为空（零修改）；提取行数为 4 或 5、全属白名单且 4 条稳定项必现。
- [ ] Step 4: 重建 bundle 并提交
  - Run: `cd dsh-quota-watch && npm run build && git diff --stat lib/client.js && git add src/client.mjs lib/client.js && git commit -m "refactor(client): wire mountQuotaCard to the reset-cards internal seam; rebuild bundle"`
  - Expected: bundle diff 非空且同笔提交；提交后 `git status` 干净。

### Task 5: 测试迁移收口（client.test.mjs 删 15 条旧集成）

- 目标：消除 Task 4 后的测试双份；集成层只留真跨界合同。
- 涉及文件：`tests/client.test.mjs`。
- 接口契约：Consumes — Task 4 的全绿基线与 15 条清单；Produces — 最终测试布局（直测 + 5 条集成）。
- 验证范围：删除后全量绿；保留 5 条集成零改动。

- [ ] Step 1: 删除已迁直测的 11 条旧测试（执行期修正：原列 15 条中 4 条经测试正文核证留守，理由见 Step 2 与执行期偏差记录）
  - Change: 按 test 标题逐条删除：'the card section renders four states purely from snapshot.reset'、'after a manual spend the wallet comes from the overview snapshot, not a second list'、'the earliest expiry label, its focusable detail and host picking share one time source'、'the confirm box names the card type, both affected windows and irreversibility'、'a known success answer shows the result and auto-confirms delivery once'、'a known refusal shows the upstream message and confirms delivery too'、'a lost use answer never claims failure; the snapshot receipt persists until acknowledged'、'the unknown warning also reads in English'、'an unreadable outcome journal shows manual use as unavailable and offers no button'、'a confirmed success notice clears after about five seconds; refusals persist'、'English empty reset section collapses to one row and keeps its separator'。仅删除列出的 test 块；同时删除仅被这些块使用且再无引用的 helper（核证结论：resetSnapshot/openConfirmBox/glmDetailText 均仍被留守测试引用，全部保留）。
- [ ] Step 2: 确认保留集成零改动
  - Change: 不动以下 5 条：'a legacy snapshot carrying autoReset renders no auto-use UI and calls no auto endpoint'、'Esc and closing clear only an uncommitted confirmation; re-entry is clean and sends nothing'（clearPending 接线合同）、'double-confirming fires exactly one spend POST and the result still lands'、'an unknown outcome warns bilingually, keeps the capsule alive with zero credentials, and clears only after a verified recheck'、'an unreadable journal or pending outcome locks the spend buttons client-side'。执行期新增加入留守的原清单 4 条及理由：'reset rows wrap on narrow widths…'（核心断言打在宿主 FLOAT_STYLE_TEXT 样式表）、'Chinese reset and unlimited notes…' 与 'a reported weekly window…'（断言打在 GLM 详情 .dqw-wins 窗格，非重置卡簇）、'domestic reset section stays two card lines…'（宿主样式断言 + ADR 0004 退休 policing 断言）。
- [ ] Step 3: 验证并提交
  - Run: `cd dsh-quota-watch && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task5.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task5.log | grep -v "failing tests:" | sort -u | wc -l`
  - Run: `cd dsh-quota-watch && git add tests/client.test.mjs && git commit -m "test(client): move reset-cluster coverage to direct reset-cards tests"`
  - Expected: 提取行数恰 **4** 且标题对照白名单（2044 旧测试已随迁移删除，白名单相应缩减）；提交成功。

### Task 6: 最终验证与收尾

- 目标：仓库级收口检查，确认 ADR 0007 护栏全部成立。
- 涉及文件：无新改动（只读验证）。
- 验证范围：全量测试、门禁、安全检查、包形状、提交身份。

- [ ] Step 1: 全套验证
  - Run: `cd dsh-quota-watch && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-task6.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-task6.log | grep -v "failing tests:" | sort -u | wc -l && npm run build && git diff --exit-code lib/client.js && node --check lib/client.js && npm run security:check && npm pack --dry-run`
  - Expected: 提取行数恰 4 且标题对照白名单；其余全部零退出（`npm pack --dry-run` 仅核对打包清单，不产物；security:check 本机弱信号，CI 为准）。
- [ ] Step 2: 提交序列与身份核查
  - Run: `git log --format="%h %ae %s" -6`
  - Expected: 近 5 笔为本计划提交，author 邮箱均为核准名单；无发版提交（Q3：纯重构不发版）。
- [ ] Step 3: 输出修改摘要（对话内交付，不生成报告文件）

## 执行期偏差记录（随 Task 5 提交；全部有测试正文/仓库事实核证）

1. 直测文件名 `tests/reset-cards.test.mjs` → `tests/client-reset-cards.test.mjs`：原名与既有的 `src/core/reset.mjs` 测试文件同名冲突（git ls-files 既有条目，计划立项时漏查）。
2. 迁移清单 15 → 11 条：'reset rows wrap on narrow widths…' 与 'domestic reset section stays two card lines…' 的核心断言打在宿主 FLOAT_STYLE_TEXT 样式表；'Chinese reset and unlimited notes…' 与 'a reported weekly window…' 的断言打在 GLM 详情 .dqw-wins 窗格（原清单按标题误分类）——四条留守集成层，零修改。
3. 白名单判据由「精确相等 5 条」改为「子集 + 4 条稳定项必现」：环境项 2044 在本机时序翻转（两轮间红绿交替），机理为 30ms notice 窗口 ≈ Windows 定时器粒度的采样混叠；直测版以注入参数 150ms + 墙钟期限轮询消除混叠，断言零放宽。
4. 模块私有辅助除 `text()` 外增补 `localeFor`/`formatNumber` 纯函数副本（renderResetRow 计数格式化所需；冻结的 createResetCards 签名无 locale 参数位，`win` 已注入故模块内自取，行为与宿主 locale 翻转路径等价）。
5. client.mjs 同步删除 `parseResetExpiryTime` import 行（随 earliestExpiry* 迁出的伴生依赖，全仓再无引用）；计划文档本身随 Task 1 入库并在执行期滚动修订。

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；直推 main，每笔 commit 前跑该任务验证。
- 每完成一个任务，运行该任务定义的验证；Task 4 的 `tests/client.test.mjs` 零修改是硬护栏，违反即停。
- 遇到阻塞、重复失败或计划与仓库现实不符（如行段漂移导致锚点失配——以符号锚点为准重新定位），立即停下说明，不猜。
- 当前分支即 main 且用户已确认直推（共识 Q12-B）；提交身份用核准邮箱。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

- 命令：`cd dsh-quota-watch && npm test 2>&1 | tee ../.dsh-research/dqw-plan-review-scratch/npmtest-final.log; grep -E "^✖" ../.dsh-research/dqw-plan-review-scratch/npmtest-final.log | grep -v "failing tests:" | sort -u | wc -l && npm run build && git diff --exit-code lib/client.js && node --check lib/client.js && npm run security:check`
- 预期：提取行数恰 4 且标题对照白名单；其余零退出；`tests/client.test.mjs` 相对 Task 1 基线仅删除 11 条列出的测试块。B1 冻结的可观测判据（基线定义：`BASE=$(git log --format=%h -n1 --grep "chore(ci): gate lib/client.js")`，即 Task 1 的 checkpoint commit）：
  - ① `mountQuotaCard` 形参块逐行一致：`diff <(git show $BASE:src/client.mjs | sed -n '/^export function mountQuotaCard(/,/^} = {}) {/p') <(sed -n '/^export function mountQuotaCard(/,/^} = {}) {/p' src/client.mjs)` 零输出、退出码 0。
  - ② `git diff $BASE -- src/client.mjs` 的删除行（`^-`，排除 `---` 头）只允许来自：被迁出函数体、五状态声明、`fetchResetEnvelope`/`RESET_FETCH_TIMEOUT_MS`，**及其随迁删除的邻接注释/文档行**（如 854-856 wallet 注释、1032-1034 manualLocked docstring、1386-1388 reset 段注释）；新增行（`^+`，排除 `+++` 头）只允许：`createResetCards` 注入块、6 个接线点改写、dispose 链追加的 `resetCards.dispose()` 一行、`export const COPY` 一行。
- 附带核查（依赖红线的精确口径，exec-review 记录 A 修订）：权威判据是 `tests/package-shape.test.mjs` 守卫——`dependencies` 段零 `@deepseek-ai/*` 键 + `src/` 零该 scope import。注意裸 `git grep "@deepseek-ai/" src/ package.json` 会合法命中两处、**不得**作为判据：package.json `peerDependencies` 的 `@deepseek-ai/cordis`（基线已有，红线只禁 dependencies 段）与 `src/credential-ref.mjs` 的 vendor 头锚注释（非 import，守卫测试强制要求保留）。
