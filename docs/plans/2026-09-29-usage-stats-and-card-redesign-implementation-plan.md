# GLM 用量统计与侧栏卡片改造 实施计划

## 目标

- 补齐 GLM Coding Plan 的"今日 Tokens / 调用次数"两栏（provider monitor `model-usage` 端点），版本 `0.0.2 → 0.0.3`。
- 侧栏卡片改造：GLM 与 Copilot 各占一行**常显摘要**（统一已用%），点击行内手风琴展开全量详情；移除折叠按钮。
- 状态机对齐设计共识：未配置隐藏、失败保留 last-good + 过期角标、双未配置整卡不渲染。

## 架构快照

宿主每轮 poll（默认 60s）对 GLM 串行发两个请求：既有 `GET /api/monitor/usage/quota/limit`（窗口百分比）与新增 `GET /api/monitor/usage/model-usage?startTime=…&endTime=…`（自然日用量，宿主本地时区 `00:00:00 → now`，时间格式 `yyyy-MM-dd HH:mm:ss`、空格按 `encodeURIComponent` 编码为 `%20`）。鉴权不变：原始 key 放 `authorization` 头、不加 Bearer、`accept-encoding: identity`、10s 超时。`quota` 探测仍是 provider 主状态来源；`usage` 作为 glm provider 内的子块（`usage.status` 独立于 provider 主状态），usage 失败不拖垮窗口百分比展示。

浏览器半区卡片重排为"摘要行 + 手风琴"：每行 `标签 + 4px 进度条 + 已用% +（GLM 行尾今日 tokens 小字）+ chevron`；点击展开该 provider 详情，同时只开一个。Copilot 摘要已用% 由 `100 − percentRemaining` 单值反转（唯一允许的推导，词表红线：禁止 `entitlement − creditsUsed` 类拼合推导）。

## 全局约束

- 逐字继承 2026-09-28 计划的安全与发布约束：任何真实 key、OAuth grant、原始 provider 响应、账号余额/真实用量数值不得进入代码、fixture、文档、Git 或 npm tarball；push 前 `npm run security:check` 必须通过；发布走 GitHub Actions OIDC（tag `v*`），仓库不存静态 npm token。
- DSH 最低版本 `>=0.1.7-rc.2`；Node `>=20`；包名 `@iasiv5/dsh-quota-watch`；host row id `quota-watch`；client module id `quota-watch-client`；`API_PREFIX='/api/dsh-quota-watch'` 不变。
- GLM 路由：`zai-coding-cn → open.bigmodel.cn`、`zai` / `zai-coding → api.z.ai`；凭据每轮经 `apiKeyEnv` credential reference 重新解析，不读 literal `apiKey`。
- 探测周期配置不变：默认 60s，`pollIntervalSec` 30–3600；浏览器可见时 30s 拉取、隐藏暂停；快照仅驻内存，不持久化历史。
- 设计共识（2026-09-29 grill 会话裁决，D1–D13）：摘要统一已用%；GLM 摘要固定 5h 窗口；今日 tokens 小字在 GLM 摘要行尾、调用次数进详情；同频 60s 探测；自然日=宿主本地时区；无折叠按钮；行内手风琴同时只开一个；详情五块（双大数字/5h/MCP月/分模型/更新时间），MCP 按工具细分不做；tokens 跟随界面语言 Intl compact；阈值 >80% 橙、>95% 红；凭据缺失=隐藏行（GLM/Copilot 对称，双缺整卡隐藏）；探测失败=保留 last-good + "数据可能已过期"角标；Copilot 无 `percentRemaining` 则该行不渲染。
- 文案语言沿用现状：中文为主、`COPY.en` 同步提供英文。

## 输入工件

- 设计共识：本会话 grill-with-docs 结论（D1–D13 见上）；`CONTEXT.md` 已含 **Used percentage** 与 **Provider usage statistic** 词条。
- 视觉稿：`docs/plans/2026-09-29-card-redesign-mockup.html`（示例数值为合成值）。
- 端点事实（已实测验证）：`model-usage` 返回 `data.totalUsage.totalTokensUsage / totalModelCallCount / modelSummaryList[{modelName,totalTokens,sortOrder}]` 与逐时数组（插件不消费逐时数组，本次范围外）。

## 文件结构与职责

- Modify: `src/core/adapters.mjs` — 新增 `buildGlmUsageProbe` / `parseGlmUsage` / `formatGlmIntervalTime` / `usageDayWindow` / `remainingToUsed`；`parseGlmPlan` 不再跳过 `TIME_LIMIT`（解析为 `key:'mcp'` 窗口）。
- Modify: `src/host.mjs` — `probeGlm` 双探测（quota + usage）、glm provider 记录新增 `usage` 子块并进入 `view()` 白名单。
- Modify: `src/client.mjs` — 摘要行 + 手风琴重构、可见性状态机、阈值配色、compact 格式化、移除折叠按钮、挂载选择器修正（去掉已失效的 `[data-pane="sidebar"]`）。
- Modify: `tests/fixtures/glm-plan-response.json` — `data.limits` 增加 `TIME_LIMIT` 合成行。
- Create: `tests/fixtures/glm-model-usage-response.json` — 完全合成的 model-usage 响应样例。
- Modify: `tests/adapters.test.mjs`、`tests/host.test.mjs`、`tests/client.test.mjs` — 对应新契约用例。
- Modify: `README.md` — 功能、端点表（+`model-usage`）、已用%归一化语义、隐私说明。
- Modify: `package.json` — `version: 0.0.3`。
- Build artifact: `lib/client.js` — `npm run build` 重新生成并提交。
- Modify: `CONTEXT.md` — 已完成（本计划执行前已提交，无后续改动）。

## 任务清单

### Task 1: GLM usage 适配器与 plan 解析扩展

- 目标：纯函数层补齐 usage 探测构造/解析、自然日窗口、剩余%反转、`TIME_LIMIT → mcp` 窗口。
- 涉及文件：`src/core/adapters.mjs`、`tests/fixtures/glm-plan-response.json`、`tests/fixtures/glm-model-usage-response.json`、`tests/adapters.test.mjs`。
- 接口契约：
  - Consumes: 既有 `GLM_HOSTS`、`asNumber`/`asString`/`clampPercent`/`toIso` 内部工具（同文件私有，不改签名）。
  - Produces（后续任务按这些名字消费）:
    - `buildGlmUsageProbe({ provider, apiKey, startTime, endTime })` → `{ url: 'https://<host>/api/monitor/usage/model-usage?startTime=<enc>&endTime=<enc>', headers: { authorization: <raw key>, 'accept-language': 'en-US,en' } }`；provider 不在 `GLM_HOSTS` 或 key 为空 → `undefined`。
    - `parseGlmUsage(status, body)` → 仅当 `status===200 && body.success===true && data.totalUsage` 为对象且 `totalTokensUsage`、`totalModelCallCount` 均为有限非负数时返回 `{ totalTokens, totalCalls, models? }`；`models` 由 `totalUsage.modelSummaryList` 映射为 `[{ name, tokens }]`（`modelName` 非空串、`totalTokens` 有限非负，无效项跳过，空数组则省略键）；否则返回 `undefined`。
    - `formatGlmIntervalTime(date)` → 宿主本地时区 `yyyy-MM-dd HH:mm:ss`。
    - `usageDayWindow(now)` → `{ startTime: '<今日> 00:00:00', endTime: formatGlmIntervalTime(now) }`（本地自然日，跨日/跨月边界正确）。
    - `remainingToUsed(percentRemaining)` → 有限且 0–100 时返回 `clampPercent(100 − percentRemaining)`，否则 `undefined`。
    - `parseGlmPlan` 变更：`type:'TIME_LIMIT'` 行不再跳过，产出 `{ key:'mcp', percent?, resetsAt? }`；`percent` 优先取行内 `percentage`，缺失时按 `currentValue/usage`（`usage>0`）计算；`TOKENS_LIMIT`/`CREDIT_LIMIT` 行为与既有 `unit` 映射（3→`'5h'`、5→`'month'`、6→`'week'`）完全不变。
- 验证范围：usage URL 参数编码（空格→`%20`、跨平台 host 选择）；合成响应解析、负数/缺失/非 200/`success!==true` 拒绝；`usageDayWindow` 在 `00:00:30` 与 `23:59:59` 的边界；`remainingToUsed(62)===38`、`remainingToUsed(undefined)===undefined`、越界钳制；`TIME_LIMIT` 行产出 `mcp` 窗口且不影响既有窗口。
- [ ] Step 1: 更新 `tests/fixtures/glm-plan-response.json`（加合成 `TIME_LIMIT` 行）、新建 `tests/fixtures/glm-model-usage-response.json`（合成：`totalTokensUsage: 8300000`、`totalModelCallCount: 152`、`modelSummaryList` 两条），并在 `tests/adapters.test.mjs` 增加上述全部断言。
- Run: `node --test tests/adapters.test.mjs`
- Expected: 失败于缺少 `buildGlmUsageProbe` / `parseGlmUsage` / `usageDayWindow` / `remainingToUsed` 导出及 `mcp` 窗口断言。
- [ ] Step 2: 确认失败仅命中待实现行为。
- Run: `node --test tests/adapters.test.mjs`
- Expected: 无网络请求；报错为 export 缺失或断言 mismatch。
- [ ] Step 3: 在 `src/core/adapters.mjs` 实现 5 个新导出并修改 `parseGlmPlan` 的 `TIME_LIMIT` 分支（删除该 `continue`，新增 `mcp` 分支）。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/adapters.test.mjs`
- Expected: 全绿；既有 TOKENS/CREDIT 用例不受影响。

### Task 2: 宿主双探测与 wire 白名单扩展

- 目标：`probeGlm` 串行探测 quota + usage，glm provider 记录新增 `usage` 子块；usage 失败不改变 provider 主状态。
- 涉及文件：`src/host.mjs`、`tests/host.test.mjs`。
- 接口契约：
  - Consumes: Task 1 的 `buildGlmUsageProbe` / `parseGlmUsage` / `usageDayWindow`；既有 `markSuccess` / `markFailure` / `fetchBody` / `resolveGlmCredential`。
  - Produces: glm provider 对象新增可选 `usage` 字段进入 `view()` 输出：`usage: { status: 'ready'|'stale'|'error', totalTokens?, totalCalls?, models?, updatedAt?, error? }`。语义：quota 与 usage 均成功 → `status:'ready'` + 数据；quota 成功、usage 失败 → provider 主状态仍 `ready`/保持 last-good，`usage` 有 last-good 则 `status:'stale'` 保留旧值 + `error`，无 last-good 则 `status:'error'` + `error`；quota 失败 → 现有 `markFailure` 语义完全不变（usage 块原样保留）。`view()` 白名单新增该字段，响应仍不含原始 provider body 与凭据。
- 验证范围：双成功；usage HTTP 500 / 超时 / 坏响应时 plan 仍 ready 且 usage 子状态正确；usage last-good 保留；missing credential 行为不变；`view()` 快照含 `usage` 且 mock key 不出现在响应。
- [ ] Step 1: 在 `tests/host.test.mjs` 增加上述用例（mock `fetchImpl` 按 URL 区分 quota/usage 响应）。
- Run: `node --test tests/host.test.mjs`
- Expected: 新用例失败于 `usage` 字段缺失。
- [ ] Step 2: 确认失败信号。
- Run: `node --test tests/host.test.mjs`
- Expected: 仅新用例失败，既有用例全绿。
- [ ] Step 3: 实现 `probeGlm` 双探测：quota 成功后用 `usageDayWindow(new Date())` 构造 usage 请求；新增 `markGlmUsage` 内部助手维护子块；`view()` 白名单加 `usage`。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/host.test.mjs tests/credentials.test.mjs`
- Expected: 全绿；单飞/last-good/路由守卫用例不回归。

### Task 3: 客户端摘要行、可见性状态机与配色

- 目标：卡片改为"标题行 + 各 provider 一行常显摘要"；实现可见性/隐藏/阈值/compact/选择器修正。
- 涉及文件：`src/client.mjs`、`tests/client.test.mjs`、`lib/client.js`（构建产物）。
- 接口契约：
  - Consumes: Task 2 的 `usage` wire 字段；既有 overview/refresh 路由与 `mountQuotaCard` 骨架、`MutationObserver` 自愈挂载。
  - Produces（Task 4 消费）:
    - 摘要行 DOM：`[data-dsh-quota-watch-row="<key>"]`，内部 `label / bar / percent / extra(tokens 仅 glm) / chevron`；可展开行为 Task 4 实现，本任务先渲染 chevron 为 `▸` 且点击无操作。
    - 摘要百分比取值：glm 固定取 `plan.windows` 中 `key==='5h'` 项的 `percent`（设计共识 D7）；该项缺失时显示 `—` 且不渲染条，行仍可见。copilot 取 `remainingToUsed(quota.percentRemaining)`。
    - stale 角标：`status==='stale'` 的行在 percent 前渲染 `⚠`（`title` 取 provider `error`），行数据仍为 last-good。
    - 可见性函数（内部）：`rowVisible(provider)` — glm：`status∈{ready,stale}` 且 `plan.windows.length>0`；copilot：`status∈{ready,stale}` 且 `quota.balanceAvailable===true` 且 `percentRemaining` 为有限数。`missing` → 隐藏；`error` 且无数据 → 行渲染为错误态（label + 内联 `查询失败` 文案，无条无 chevron，不可点击）。两行均不可见 → 整卡 `container.hidden = true`。
    - 格式化：`formatCompact(value, locale)` = `Intl.NumberFormat(locale==='zh'?'zh-CN':'en-US', { notation:'compact', maximumFractionDigits:1 })`；摘要 GLM 行尾 `extra` = `formatCompact(usage.totalTokens)`，`usage` 缺失或非 ready/stale 时省略（行仍显示）。
    - 配色：fill 基础色沿用主题蓝；`usedPercent > 80` 加 `warn`（橙）、`> 95` 加 `danger`（红）；Copilot 摘要 percent = `remainingToUsed(quota.percentRemaining)`。
    - 移除折叠按钮与 `COLLAPSE_KEY` 读写；移除挂载选择器中已失效的 `[data-pane="sidebar"]`（保留 `[class*="sidebarCol"]` 与 `[class*="footArea"]`）。
- 验证范围：可见性矩阵（missing/error-no-data/stale/ready、copilot 无 percentRemaining）；glm 5h 窗口缺失时 `—` 无条；双 missing 整卡隐藏；error 行渲染与不可点击；stale 行 `⚠` 与 title；阈值类名边界（80/95 用 80.0/80.1、95.0/95.1 探测）；zh/en compact 输出；无折叠按钮；选择器仅剩 `sidebarCol`。
- [ ] Step 1: 重写 `tests/client.test.mjs` 中卡片结构断言并新增上述用例（jsdom，合成 wire 快照）。
- Run: `node --test tests/client.test.mjs`
- Expected: 失败于摘要行/可见性/新格式化行为缺失。
- [ ] Step 2: 确认失败。
- Run: `node --test tests/client.test.mjs`
- Expected: 既有"折叠按钮"断言被删除后无残留；新断言失败清晰。
- [ ] Step 3: 实现 Task 3 全部客户端变更（详情面板暂渲染占位空 `div[data-dsh-quota-watch-detail]`，由 Task 4 填充）。
- [ ] Step 4: 构建并验证。
- Run: `npm run build && node --test tests/client.test.mjs && node --check lib/client.js`
- Expected: 全绿。

### Task 4: 手风琴详情面板与过期角标

- 目标：点摘要行展开/收起该 provider 详情，同时只开一个；详情五块 + Copilot 详情 + stale 角标。
- 涉及文件：`src/client.mjs`、`tests/client.test.mjs`、`lib/client.js`。
- 接口契约：
  - Consumes: Task 3 的摘要行 DOM 与可见性函数；`formatCompact`；wire 的 `plan.windows`（含 `mcp`）、`usage`、`quota`。
  - Produces: 交互契约——行元素 `role="button"`、`tabindex="0"`、`aria-expanded`，点击/Enter/Space 切换；`openKey`（`'glm'|'copilot'|null`，默认 `null`）单开；详情容器 `[data-dsh-quota-watch-detail="<key>"]`。GLM 详情：双大数字（`formatCompact(totalTokens)` / `formatNumber(totalCalls)`）→ 全部 `plan.windows` 行（label 按 `COPY.windows`：`'5h'→'5 小时窗口 · 已用'`、`week→'每周窗口 · 已用'`、`month→'每月窗口 · 已用'`、`mcp→'MCP（月）· 已用'`；条+百分比+`重置 <formatTime>`）→ 分模型行 `models.map(m => \`\${m.name} \${formatCompact(m.tokens)}\`).join(' · ')` → `更新 <formatTime>`。Copilot 详情：`可用额度 <remaining> / <entitlement>`、已用%条（反转值）、`本期已用` creditsUsed（如返回）、`重置`。`provider.status==='stale'` 时详情顶部渲染 `数据可能已过期: <error>`。
- 验证范围：单开互斥（开 glm 后点 copilot，glm 收起）；再点收起；键盘 Enter/Space；aria-expanded 同步；GLM/Copilot 详情各字段与合成快照一致；stale 角标出现且文案含 error；数据更新后详情重渲染。
- [ ] Step 1: 在 `tests/client.test.mjs` 增加上述交互与渲染断言。
- Run: `node --test tests/client.test.mjs`
- Expected: 失败于详情容器为占位空 div、无交互。
- [ ] Step 2: 确认失败。
- Run: `node --test tests/client.test.mjs`
- Expected: 仅新交互用例失败。
- [ ] Step 3: 实现手风琴与详情渲染（替换 Task 3 占位）。
- [ ] Step 4: 构建并验证。
- Run: `npm run build && node --test tests/client.test.mjs && node --check lib/client.js`
- Expected: 全绿。

### Task 5: 文档、版本、构建与全量门禁

- 目标：`0.0.3` 就绪：README 更新、版本号、全量测试与安全扫描通过。
- 涉及文件：`README.md`、`package.json`、`lib/client.js`、全量 `tests/`。
- 接口契约：
  - Consumes: Task 1–4 全部产物。
  - Produces: `package.json` `version: 0.0.3`；README 含三端点表（`quota/limit`、`model-usage`、`tool-usage` 仅文档说明未消费）、"摘要统一已用%（Copilot 为单值反转）"、"usage 子块失败不拖垮窗口展示"、自然日语义、无历史留存声明。
- [ ] Step 1: 更新 README 与 `package.json` 版本号。
- [ ] Step 2: 全量验证。
- Run: `npm ci && npm test && npm run build && npm run security:check && node --check lib/client.js && npm pack --dry-run --json`
- Expected: 全部 exit 0；pack 清单仅含 `files` 白名单；扫描器对 worktree 与 pack 内容无命中。

### Task 6: 提交推送、tag 发布与本地升级（用户闸门）

- 目标：推送 `main`、`v0.0.3` tag 触发 OIDC 发布、升级本机插件。
- 涉及文件：Git 分支 `main`；registry `@iasiv5/dsh-quota-watch`。
- 接口契约：
  - Consumes: Task 5 全绿；GitHub Actions `publish.yml`（已存在，OIDC + provenance）。
  - Produces: 远端 `main` 新提交；npm `0.0.3`；本机 web profile 插件升级到 `0.0.3`。
- [ ] Step 1: 提交并推送（提交信息 `feat: glm usage stats and summary-card redesign (0.0.3)`）。
- Run: `git add -A && git diff --cached --check && npm run security:check && git commit && git push origin main`
- Expected: 远端 main 前进；扫描通过；`docs/plans/` 内容全部为合成数值（无真实账号数据）。
- [ ] Step 2: 打 tag 触发发布并监视 CI。
- Run: `git tag v0.0.3 && git push origin v0.0.3`，随后 `gh run watch` 或 GitHub 页面确认 publish workflow 成功。
- Expected: npm registry 出现 `@iasiv5/dsh-quota-watch@0.0.3`（provenance 发布）。
- [ ] Step 3: 🔴 用户闸门——升级本机插件并重启 dsh web 需用户明确同意后执行：插件管理器升级 `@iasiv5/dsh-quota-watch` → `0.0.3`，再重启 dsh web 使宿主半区生效。
- Expected: 侧栏出现新摘要卡；GLM 行显示 5h 已用% + 今日 tokens 小字；点开详情可见今日双大数字。

## 执行纪律

- 本机 DSH 沙箱内 `~/.npm` 为只读，所有 `npm` 验证命令前先 `export npm_config_cache=/tmp/npmcache-dqw && mkdir -p "$npm_config_cache"`，否则 `npm pack`/`npm ci` 以 `EROFS` 失败（维护者普通 shell 无此问题）。
- 开始实现前批判性复查本计划；发现与仓库现实不符（如宿主 API 签名变化）先修计划再动代码。
- 按任务顺序执行，每任务跑其验证；不无声跳步。
- 遇到接口语义不明、测试连败或需改动 DSH 宿主行为时，停下报告证据。
- 不把真实 provider 响应、账号用量、凭据写入任何文件；fixture 只用合成值。
- Task 6 Step 3 涉及重启本机 dsh web，必须先获用户同意。

## 最终验证

```sh
npm ci
npm test
npm run build
npm run security:check
node --check lib/client.js
npm pack --dry-run --json
```

全部 exit 0；tarball 仅含白名单文件。功能验收（Task 6 Step 3 后）：侧栏两行常显摘要、GLM 行尾今日 tokens、单开手风琴详情、阈值变色、无折叠按钮、双未配置时整卡隐藏。

## 审阅 Checkpoint

计划基于 2026-09-29 grill 共识（D1–D13）与已实测的 `model-usage` 端点事实编写。请审阅；确认后按任务清单由编码 agent 执行。`docs/plans/` 取消 gitignore 的仓库整理（旧计划审查无敏感信息）随本计划文件一并提交。
