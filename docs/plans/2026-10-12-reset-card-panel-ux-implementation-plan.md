# 重置卡面板折叠与自动用卡设置实施计划

## 目标

完成用户确认的无卡折叠、设置披露按钮、按窗口状态和告警展示、确认式授权、结果未知保护解除与信息可达性。**先完成并验证[宿主安全计划](./2026-10-12-reset-card-host-safety-implementation-plan.md)的跨计划接口**，再执行本计划；两份计划分别可审阅、分别可测。本计划不是执行授权。

## 架构快照

目前 `src/client.mjs` 的 `autoOpen` 用 `src/client/prefs.mjs` 的 localStorage 键恢复；`resetCollapsed()` 把 `autoOpen`、持久授权、最近事件和手动通知混成一个“是否展开”布尔值。宿主快照已经带 `reset` 卡列表与 `autoReset` 开关，客户端可据此分别投影**库存、设置披露、当前风险、历史消息**。本轮保留虚线分隔线及宿主 10 分钟查卡节奏：库存为零时收成紧凑行，设置可独立展开，错误提示与授权状态不能强行钉开面板。消费/授权安全规则由前置宿主计划执行，客户端负责提示、确认和防误触，不把客户端开关当安全边界。

## 全局约束

- 设计来源：[设计决策记录](./2026-10-12-reset-card-design-decisions.md)（用户逐项确认的 D1–D34）及 [`GLOSSARY.md`](../../GLOSSARY.md)；宿主契约逐项以[宿主安全计划](./2026-10-12-reset-card-host-safety-implementation-plan.md)的“跨计划接口契约”为准；`ADR 0004` 的结果未知保护不可降级。
- 保留 `engines.node: ">=20"`、`dsh.engines.dsh: ">=0.1.7-rc.2"`、`@deepseek-ai/dsh-credentials: "0.1.7-rc.2"` 与 `@deepseek-ai/cordis: "^4.0.2"`；无新运行时依赖。客户端 Web 平台、DOM Shadow Root、既有 `CLIENT_ROUTES` 相对路径不变；`lib/client.js` 只能由 `npm run build` 生成，不手改。
- 中文/英文 `COPY` 同步改动；“无卡”必须来自成功空列表，“查询失败/上次成功数据”与零库存不能混称；独立两窗口的已启用状态永远可见。“自动用卡设置”只负责展示，不授权、不落 localStorage；仍仅支持国内个人版 `zai-coding-cn`。
- 用户特定决策：**设置打开时要恢复两条空卡库存行**（D7，不能按常见建议把它们继续隐藏）；收起时保留虚线分隔线并以一行为先，极窄视口可换两行但绝不截断警示/设置按钮。现有界面不支持调整触发阈值，本计划不新增该输入控件。
- 未经用户同意不在 `main`/`master` 上开工；未经单独同意不升版本、push/tag、发布 OIDC、升级装机或重启 DSH；Agent 会话不得热改只读的 profile `node_modules`，不得创建监听 3080 的进程。
- 版本共存与回退遵循宿主计划的「版本共存与回退边界」：宿主与客户端同包同版本发布为基本假设；客户端对 `state`/`redemptionGuard`/`guardAcknowledge` 等新字段与路由的**缺失**一律按现状降级渲染（不新增告警、不解除保护、不发非常规请求），不因字段缺失崩溃或误显示“已启用”。

## 输入工件

- [`docs/plans/2026-10-12-reset-card-host-safety-implementation-plan.md`](./2026-10-12-reset-card-host-safety-implementation-plan.md) 的 H1–H8 和明确的 snapshot/API 形状。
- [`docs/adr/0004-write-ahead-reset-card-guard.md`](../adr/0004-write-ahead-reset-card-guard.md)。
- 当前实现锚点：`src/client.mjs` 的 `fetchResetEnvelope`、`loadResetCards`、`saveAutoReset`、`renderAutoResetRow`、`resetCollapsed`、`renderResetSection`、`renderDetail`、`onPanelClick` 与 `onDocPointerDown`；`src/client/prefs.mjs` 的 `AUTO_OPEN_KEY` / `loadAutoOpen` / `saveAutoOpen`。

## 文件结构与职责（先于任务）

| 文件 | 动作 | 唯一职责 |
|---|---|---|
| `src/client.mjs` | 修改 | 卡区与设置分离、双语文案、披露控件、当前状态摘要、手动刷新/用卡禁用、风险确认与告警入口 |
| `src/client/prefs.mjs` | 修改 | 移除仅供自动用卡设置展示使用的 localStorage 键/读写；保留胶囊位置与侧栏显示偏好 |
| `tests/client.test.mjs` | 修改 | jsdom 场景矩阵：空/有/未知/过期卡、窗口授权与告警、窄宽、交互与消费确认 |
| `tests/prefs.test.mjs` | 修改 | 保留位置与显示偏好用例；旧 `auto-open` 持久化测试改为“不恢复旧键”的客户端用例 |
| `README.md` | 修改 | 用户文档说明新设置按钮、无卡/失败语义、可能立即消费、结果未知人工核实 |
| `lib/client.js` | 构建 | `npm run build` 从源生成的可发布浏览器产物 |

不在本计划更改 `src/host.mjs` 或 `src/shared.mjs` 的宿主协议；若宿主契约与计划不一致，应先修两份计划并重新请求审阅，不在客户端擅自编造新路由。

## 跨计划接口契约

- Consumes `view().reset` 的 `{status:'ready',cards:{fiveHour:[],week:[]}}` 或 `{status:'error',error,...}`；浏览器保留上次成功卡列表作展示，错误时禁用旧数据的「重置」按钮。`view().autoReset.fiveHour.state` / `.week.state` 按宿主计划中 `kind:'disabled'|'standby'|'triggered'|'holding'|'awaiting-card'|'error'|'recent-success'|'guarded'` 投影（`triggered` = 已达标有卡且布防、宿主下一轮将消费；`holding` = 已消费等待额度回落、不再消费），`lastEvent` 只作历史参考而不决定折叠。`view().redemptionGuard` 的 `status:'locked'|'storage-error'` 无论何种库存状态都高优先级展示。
- Consumes `POST /api/dsh-quota-watch/auto-reset`：无风险变更（纯禁用、阈值上调、未迁移入触发态的调整）直接保存但明确告知未来可能花卡；风险变更采用宿主契约的**状态迁移口径**——仅当某窗口自身配置变化（off→on、生效阈值因下调/clamp 下移）使其由非触发态迁移入「已启用且新鲜已用 ≥ 生效阈值」，配置未变的窗口永不 409（本轮 UI 不提供阈值编辑）时，宿主先查新鲜额度/卡，首次回 HTTP 409 `{ok:false,error:'confirmation-required',window,availability,used,threshold}` 不修改授权；一次请求造成两个窗口风险变更回 HTTP 409 `{ok:false,error:'multi-window-confirmation',windows:[...]}`，客户端提示分窗口逐一设置（C2 的 UI 一次只拨一个开关，正常流程不会触发，仅为直连 API 场景兜底）；预检失败回 HTTP 503 `{ok:false,error:'preflight-unavailable'}`。客户端分别显示“有卡可能立即消耗”或“暂无卡，卡到账后即使浏览器关闭也可能自动消耗”；用户确认后提交同一完整配置加 `confirmation:{window,availability}`。卡列表/额度失败时保持原开关值，错误反馈可读。
- Consumes `POST /api/dsh-quota-watch/reset-cards/ack-unknown`：请求 `{verified:true}`；只有用户明确看过核实说明、又做第二次确认才调用。此动作仅清保护，**不重新开启自动授权，不发送消费请求**。`fetchResetEnvelope` 已能解析非 2xx JSON；route 名称须采用宿主计划给出的 `CLIENT_ROUTES.guardAcknowledge`。

## 任务清单

### Task C1：移除设置披露的本地持久化

- 文件：`src/client/prefs.mjs`、`src/client.mjs` 的 `autoOpen` 初始化/保存处、`tests/prefs.test.mjs`、`tests/client.test.mjs`。
- Consumes：已确认 D1/D2（页面重新加载、离开 GLM 详情再进入均默认收起）；现有 `AUTO_OPEN_KEY='dsh-quota-watch:auto-open'`。
- Produces：只在当前 GLM 详情生命周期存在的 `settingsOpen`，初始 false；离开 GLM 详情（返回概览、关闭面板、外部点击、切换 provider）一律 false；旧 localStorage key 即使为 `'1'` 也不再读取，更不写入。真实授权从宿主 snapshot 读取、不随此状态变化。
- [ ] 在 `tests/client.test.mjs` 增加旧键设 `'1'` 仍收起、同页关闭/返回后再进收起、实际 `autoReset.fiveHour.enabled` 不变的断言；移除 `tests/prefs.test.mjs` 对披露存储读写的旧期望。运行 `node --test tests/client.test.mjs tests/prefs.test.mjs`，预期新断言失败。
- [ ] 删除 `src/client/prefs.mjs` 中仅服务此披露的常量/函数及客户端 import，增加统一离开详情时重置 `settingsOpen` 的逻辑，确保按钮点击不发授权 POST。运行同一命令，预期全绿。

### Task C2：将“总复选框”改为设置披露按钮

- 文件：`src/client.mjs` 的 `buildAutoMaster` / `.dqw-auto-master` CSS、`tests/client.test.mjs`。
- Consumes：C1 的 `settingsOpen`，宿主 `autoReset.<window>.enabled` 仅作为授权状态；原两条真实 `<input type=checkbox>` 不变。
- Produces：「自动用卡设置 ▸／▾」`<button type="button">`，`aria-expanded` 与 `aria-controls` 指向始终存在的 `id="dqw-auto-settings"` 容器；收起时容器 `hidden` 且有作者样式 `[hidden]{display:none}` 守卫，按钮独立显示当前“自动用卡已启用”摘要，不以披露状态冒充授权。
- [ ] 测试存在按钮而非头部复选框、Enter/Space 激活、`aria-expanded` 翻转、无 `POST /auto-reset`、真实开关仍逐窗独立；运行 `node --test tests/client.test.mjs`，预期新断言失败。
- [ ] 实现语义化按钮及中英文名称、Chevron、焦点样式，保持两个授权复选框现有语义；运行同一命令，预期全绿。

### Task C3：把库存呈现与设置披露拆成两个条件

- 文件：`src/client.mjs` 的 `resetCollapsed` / `renderResetSection` / `knownResetCards`、`tests/client.test.mjs`。
- Consumes：C1 `settingsOpen`、宿主 `view().reset` 成功/错误投影、用户 D4/D5/D7。
- Produces：无卡 + 设置关闭 → 保留虚线分隔线的一行；**无卡 + 设置打开 → 两条原有空卡库存行 + 两窗口设置行**；有卡则库存行正常显示，设置仍可独立关；首次查询失败输出“查询失败”而非“无可用”，有 last-good 时标为“上次数据”；任何 `lastEvent`/授权开启/通知都不能强迫设置展开。
- [ ] 在 `tests/client.test.mjs` 用成功空卡、成功有卡、首次错误、旧成功后错误、授权仍开、历史失败、手动通知构造状态矩阵，专门断言“打开设置时两行无卡库存恢复”，收起断言使用 `hidden`/可见性而非简单 DOM 行数（C2 的 aria-controls 容器始终存在）；运行 `node --test tests/client.test.mjs`，预期新矩阵失败。
- [ ] 将卡列表条件与 `settingsOpen` 条件分开，保留 `.dqw-reset` 虚线与“立即刷新”入口；运行同一命令，预期全绿。

### Task C4a：投影双窗口状态与风险优先级

- 文件：`src/client.mjs` 的 `COPY.zh/en` / `renderResetSection`、`tests/client.test.mjs`。
- Consumes：C3 的折叠行；宿主 `autoReset.fiveHour.state` / `.week.state`、`redemptionGuard`、`autoReset.persistError`（D17「设置未保存」的唯一宿主载体，src/host.mjs 现有字段；清除条件 = 下一次成功写盘）。
- Produces：已授权但未达触发态为“待阈值”（standby），已达触发态、有卡且布防为“已达标 · 下一轮自动消费”（triggered，如实提示即将消费），已达触发态但已解除布防为“已消费 · 等待额度回落”（holding），达触发态且确认无卡为琥珀色“待卡”（awaiting-card），真实失败为错误，近 10 秒成功短暂绿色反馈；两窗口状态独立。摘要优先级在 D14 六级框架内归层：`结果未知保护 > 设置未保存 > 当前真实故障 > 待卡与即将消费（同层，取更靠左者） > 已启用待阈值与等待回落（同层） > 最近成功`；其他当前状态计数显示“另有 N 项”；普通历史失败在双关时不占主行。
- [ ] 用双窗口不同状态、单/多重风险、历史失败、结果未知锁与中英文写文案和 DOM 状态断言，并覆盖 persistError 场景（提示在用户随后关掉授权后仍持续显示、一次成功保存后消失）；运行 `node --test tests/client.test.mjs`，预期新增断言失败。
- [ ] 实现纯摘要选择逻辑与 zh/en 文案；展开设置后的详细状态仍逐窗呈现；运行同一命令，预期全绿。

### Task C4b：呈现窄屏状态入口并隔离查看动作

- 文件：`src/client.mjs` 的浮层样式 / 状态按钮 / `renderResetSection`、`tests/client.test.mjs`。
- Consumes：C4a 的摘要优先级与“另有 N 项”；C2 的 `settingsOpen` 按钮。
- Produces：294px 面板优先一行，空间不足才允许两行；警示与设置入口不可截断。点击状态标记只展开设置并聚焦对应窗口，不等于确认失败、授权消费或解除安全锁；状态按钮键盘可聚焦且有可读名称。
- [ ] 用 294px 与更窄容器的模拟宽度信号、状态标记点击/键盘激活、`aria-expanded`/焦点与不发送消费或 ack POST 写 DOM/CSS 结构断言；jsdom 不计算真实排版，不能把这些断言当作像素验收；运行 `node --test tests/client.test.mjs`，预期新增断言失败。
- [ ] 实现状态按钮及响应式布局，必要时用带标注的两行布局而不是截断；运行同一命令，预期全绿。

### Task C5：错误卡数只读显示并禁止旧数据消费

- 文件：`src/client.mjs` 的 `renderResetRow` / `renderResetSection`、`tests/client.test.mjs`。
- Consumes：C3 的 last-good 展示、宿主 `reset.status:'error'`。
- Produces：曾有卡、最新查卡失败时展示最近成功卡数（数据源：客户端 `knownResetCards`，与宿主错误视图无关）和“可能过期”，但所有对应「重置」按钮 `disabled=true`；**解禁判据（单一口径）= 跨通道按时间最近一次卡列表查询尝试成功才解禁**（宿主快照与客户端 `loadResetCards()` 记入同一条时间线，最近一次尝试失败即禁用，无论更早的另一通道是否成功过）。**时间线对齐判据（不做跨时钟数值比较）**：宿主通道仅当 `reset.checkedAt` **值发生变化**时记为一次新尝试，打点时刻用**客户端接收时刻**（宿主/浏览器时钟偏差不参与先后判定）；懒加载以其完成时刻记录；`checkedAt` 未变化的 ready 重放（10 分钟节奏门内的重复快照）**不构成新尝试**，不得覆盖更晚的懒加载失败；无成功列表时不得伪造 0 张。
- [ ] 写“上一轮一张卡→本轮宿主快照 error→按钮置灰且点击不发 `/reset-cards/use`→懒加载 `loadResetCards()` 成功后恢复→再失败再禁用→宿主快照随后 ready 但 `checkedAt` 值未变（重放）→保持禁用；`checkedAt` 变化的新 ready 才算新尝试并解禁”测试（覆盖两个混合时序方向，宿主侧以 `checkedAt` 值变化+客户端接收顺序构造，不做跨时钟比较）；运行 `node --test tests/client.test.mjs`，预期新断言失败。
- [ ] 将“最近一次查询是否成功（任一通道）”与 last-good 库存分开传给行按钮，失败时保持文本不保持可消费动作；运行同一命令，预期全绿。

### Task C6a：呈现授权前消费风险确认

- 文件：`src/client.mjs` 的 `saveAutoReset` / `renderAutoResetRow` / `COPY`、`tests/client.test.mjs`。
- Consumes：宿主 `POST /auto-reset` 的 409 `confirmation-required`、409 `multi-window-confirmation`、503 `preflight-unavailable`；H7 风险变更判据（UI 阈值只读，正常流程一次只拨一个开关）；当前界面阈值只读。
- Produces：初次点击仍向宿主提交完整两窗口配置；到阈值有卡时展示“下一轮可能立即消耗一张”的确认面，到阈值无卡时展示“卡到账后无需浏览器在线仍可能自动消耗”的确认面；取消、预检失败都保持原授权；低于阈值直接启用但设置中说明未来消费，关闭授权永远无需确认。
- [ ] 模拟 200、409(available)、409(none)、503 与用户取消，断言确认前宿主授权不变、两窗口不互相覆盖，警示文案中英都有；运行 `node --test tests/client.test.mjs`，预期新增断言失败。
- [ ] 实现可聚焦的确认组件和不乐观更新的 `saveAutoReset` 首次请求，暂不在本任务提交确认请求；运行同一命令，预期全绿。

### Task C6b：确认后提交授权并处理风险变化

- 文件：`src/client.mjs` 的 `saveAutoReset` / 确认组件、`tests/client.test.mjs`。
- Consumes：C6a 的待确认窗口及卡状态；宿主 H8 的 `confirmation:{window,availability}`、变化时重发 409、`multi-window-confirmation` 与 503 预检失败响应。
- Produces：用户明确确认才发送带匹配 `confirmation` 的第二次完整配置；卡可用性发生变化则更新文案重新确认，失败保持旧授权；收到 `multi-window-confirmation` 时显示“请逐个窗口设置”且不发确认请求（兜底，正常 UI 不会触发）；成功后通过 overview 拉取宿主权威状态，不自动连带启用另一窗口。
- [ ] 模拟正确确认、错窗口、用户取消、两次请求间 availability 改变、确认时接口 503、`multi-window-confirmation` 兜底与跨窗口保持，断言只有正确确认才导致 POST 保存；运行 `node --test tests/client.test.mjs`，预期新增断言失败。
- [ ] 实现第二次请求、变化重确认与权威回读；运行同一命令，预期全绿。

### Task C7：让手动反馈按风险时效展示

- 文件：`src/client.mjs` 的 `resetNotice` / `renderResetSection` / 定时器清理、`tests/client.test.mjs`。
- Consumes：C4a 的状态摘要与 C4b 的紧凑状态区；宿主已确认/失败/结果未知的消费响应。
- Produces：手动成功反馈约 10 秒后消退；普通失败的可读摘要留到用户点击独立的「知道了」确认按钮或下一次手动尝试；`request-unknown` 由宿主 `redemptionGuard` 的跨重启锁承载，不依赖浏览器内存的 `resetNotice`，不得因关闭/刷新面板消失。三者都不强制展开设置。
- [ ] 用可控计时验证成功 10 秒消退、普通失败在关闭设置后可达且只能由独立的「知道了」按钮/下一次手动尝试消除、结果未知刷新组件后从宿主快照恢复、卸载组件清理计时器；运行 `node --test tests/client.test.mjs`，预期新增断言失败。
- [ ] 实现反馈时效与清理；普通失败状态标记点击仅看详情，不能作为解除保护；运行同一命令，预期全绿。

### Task C8：为结果未知保护提供双确认解除

- 文件：`src/client.mjs` 的状态区/确认组件/`COPY.zh/en`、`tests/client.test.mjs`。
- Consumes：宿主 `redemptionGuard`（视图词表 `reason:'pending'|'request-unknown'`，`storage-error` 仅作 `status`，与宿主契约一致）与 `CLIENT_ROUTES.guardAcknowledge`；C4a 风险优先级、C7 通知区。
- Produces：高优先级“结果未知，核实官方卡数和额度”提示；点击只打开详情；明确的「已核实，解除保护」按钮先出说明，再由用户第二次确认后 `POST {verified:true}`；成功后拉取权威 snapshot，确保两项自动授权仍关闭、不会触发消费；失败时保护仍显著可见。
- [ ] 模拟组件卸载/重挂、POST 失败/成功、点击警示但未确认、两次确认及解除后双关，断言无 `/reset-cards/use` 自动调用；运行 `node --test tests/client.test.mjs`，预期新断言失败。
- [ ] 实现单独的确认组件及请求，保持网络失败时按钮可重试但保护不消失；运行同一命令，预期全绿。

### Task C9：更新重置卡用户说明

- 文件：`README.md`。
- Consumes：C1–C5、C6a/C6b、C7/C8 的已测行为与 H1–H8 的宿主契约。
- Produces：README 说明“设置不是授权”“无卡时展开仍显示两条空卡行”“待卡/待阈值/查询失败”“立即消费确认”“跨重启结果未知保护”“`storage-error` 锁死的人工恢复路径（停 DSH → 核实官方卡数与额度 → 删除 `~/.dsh/glm-quota-reset/uncertain-redemption.json` → 重启）”；现有示意图片标为示例，不能伪称新版实机截图。
- [ ] 对照现有 `README.md` 的“重置卡与自动用卡”段落，逐项检查上述六点：原文仍把顶端复选框当设置入口，且缺少跨重启安全锁与恢复路径；运行 `npm run security:check` 记录修改前公开包扫描基线应通过，内容核对仍缺六点。
- [ ] 只更新 README 文字和图注，不造新图；再逐项人工核对六点均有明确表述；运行 `npm run security:check`，预期公开包扫描通过。

### Task C10：生成并验证客户端发布产物

- 文件：`lib/client.js`（构建生成）、`src/client.mjs`（若构建报语法错，仅修本计划直接引入的问题）。
- Consumes：C1–C5、C6a/C6b、C7/C8 的客户端代码与 C9 的公开说明；`scripts/build-client.mjs` / `package.json` 既有构建脚本。
- Produces：与 `src/client.mjs` 同步的 `lib/client.js`，并完成全套测试与安全检查；不升版本、不打 tag。
- [ ] 构建前检查 `lib/client.js` 的旧 auto-open 读写与旧披露控件（当前发布基线仍存在），执行 `node --check src/client.mjs`，预期语法检查通过但产物尚未反映新源码。
- [ ] 执行 `npm run build`、`node --check lib/client.js`、`node --test tests/client.test.mjs tests/prefs.test.mjs`、`npm test`、`npm run security:check` 与 `git diff --check`，预期全部通过；新产物含“自动用卡设置”及安全锁交互、不再读取/写入 auto-open localStorage 键。

## 执行纪律

1. 开始实现前批判性复查两份计划；有矛盾、缺项、接口偏差或无效命令先修计划并请求重新审阅。若当前在 `main`/`master` 且用户未同意直接在主分支实现，先确认分支选择。
2. 按 C1→C2→C3→C4a→C4b→C5→C6a→C6b→C7→C8→C9→C10 执行；每项先看到新断言失败再做最小实现，立即运行该项验证；不得跳过或把风险确认退化为纯文案。遇测试重复失败、宿主接口不符合跨计划契约或实际部署不可用即停下说明。
3. 公开仓库不得加入本机域名/IP/凭据或原始服务商响应；测试仅用模拟 provider 响应与 jsdom，不触发真实消耗。既有 `README.md` 示例图可能仍反映旧版样式，必须在文案中标注示意图；需要更换图片时先获用户实图或单独确认，不伪造真实截图。
4. 不热改只读 profile，不开第二个 3080 服务；全部任务完成后做最终门禁和修改摘要。版本、OIDC tag、安装与重启必须另行获用户确认。

## 最终验证

在仓库根目录的 Node.js >=20 环境运行：`node --test tests/client.test.mjs tests/prefs.test.mjs` → 全通过；`npm run build` → `lib/client.js` 更新；`node --check lib/client.js` → 零语法错误；`npm test` → 全通过；`npm run security:check` → 安全扫描通过；`git diff --check` → 零空白错误。Windows 可用 PowerShell 运行同样的 `node`/`npm` 命令；`git diff --check` 用已安装 Git 的 PowerShell。真实 GUI 目视验收需在获得部署与重启许可后于**既有** DSH Web 地址刷新查看，不另起替代服务器。

## 审阅 Checkpoint

本计划及宿主安全计划需先经用户审阅并批准；默认执行方为后续普通编码 agent 或人工，写计划阶段不直接开始编码。
