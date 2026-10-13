# GLM 详情面板与手动重置卡安全收敛实施计划

## 目标

在 `@iasiv5/dsh-quota-watch` 的下一版中退役自动用卡，保留国内站个人版的十分钟查卡与经二次确认的手动用卡；将无卡/失败/有卡状态固定展示于 GLM 详情卡区，补齐不可撤销 POST 的写前记录和跨重启待核实提醒，同时保持现有「今日 Tokens／调用次数 → 额度窗口 → 分模型用量」正常态顺序、主题和视觉层级。本文只规划，不实施、不发布。

## 架构快照

- 宿主现有 `createQuotaService()` 每轮探测 GLM/Copilot，并按独立十分钟门控查询国内站重置卡；`view()` 向浏览器提供归一化快照。下一版删去 `maybeAutoReset()` 与可授权自动消费的路由，但保留 `listResetCards()`、`useResetCard()` 的手动复核/串行/消费后重探，以及 `refresh(true)` 强制查卡。
- 新增两个相互独立的宿主数据职责：一次性退役旧自动授权设置；一笔手动消耗的写前持久日志。旧 `settings.json` 的关闭覆盖保护回退安全，新的 `manual-outcome.json` 仅存不含凭据的单笔待核实事件。宿主先持久写入 `in-flight` 再发不可撤销 POST；上游结果已知时先持久写成 `known-success | known-refused` 回执，只有浏览器确认收到回执后才清除；上游超时/崩溃则以 `unknown` 呈现。宿主→浏览器响应丢失时，已知回执跨重启保留并阻止下一次手动消费，直至用户重新看到并确认；上游未知则须官方核查与 fresh 查询后明确解除。
- 浏览器继续使用现有浮动 GLM 详情面板与影子 DOM：国内站卡区始终保留分隔线/标题，按 `loading | ready-empty | ready-available | error` 呈现；“查询失败”不显示旧的可操作库存。浏览器的钱包信息只从 overview/force-refresh 快照读取，详情不再并发发独立卡列表 GET，避免旧/新结果相互覆盖；手动结果未知独立于钱包状态持久显示并提供明确核实入口。今日用量故障按一次连续失败片段计时，正常周期缓存不加警告。

## 全局约束

- 包名 `@iasiv5/dsh-quota-watch`；`package.json` 当前版本 `0.1.27`，本计划不预先指定未发布的下一版本号。保留 `engines.node: ">=20"`、`dsh.engines.dsh: ">=0.1.7-rc.2"`、`@deepseek-ai/dsh-credentials: "0.1.7-rc.2"`、`@deepseek-ai/cordis` peer `"^4.0.2"`、`dsh.client.platform: "web"`；Web/Desktop 均需人工验证，不新增运行时依赖。
- 保持服务商口径：今日统计按宿主本地日历日查询、额度重置绝对时间由浏览器本地展示、无时区卡到期值暂按北京时区解读；不得声称上游官方已确认其时区契约。正常态顶部两大数字/额度窗口/分模型顺序不动；zh/en 文案同时维护，DSH 深浅主题 token 与窄屏 bottom sheet 保留。
- 国内个人版 provider `zai-coding-cn` 才展示重置卡区；国际站 `zai` / `zai-coding` 不把“不支持”显示成“无可用”。卡片查询与「立即刷新」是只读操作；唯一消费路径是配对/同源保护的手动 POST，在卡区二次确认后才发出，消费前重列、默认选同卡种最早到期卡、不可自动重试。
- “持久”意指记录在 POST 前安全落盘，并能在进程崩溃/宿主重启后恢复；写盘失败禁止 POST。记录只含 opaque attemptId、卡种、开始时间、`in-flight | unknown | known-success | known-refused` 状态，不得含凭据、服务商卡编号或原始上游响应；文件以限制权限原子替换并尽可能同步写入。若目标平台不能保证该门槛，执行者停止并报告，不降级为内存警告后继续花卡。
- 保持 know-how 017 已收编的 `attachShadow`、`retryNoDataMs`、`coldRetryMs`、`errorKind`、`.dqw-capsule [hidden]`、`span.hidden = !visible` 等回归锚点；不修改运行中的 DSH 宿主、系统服务、反代或 profile 下的 node_modules。测试仅用合成上游响应，service 测试经每实例独立临时设置/日志路径隔离，不读写真实 `$DSH_HOME`，不对真实账号执行手动用卡。
- 发布与部署不属于本计划的默认执行：npm tag/OIDC 公开发版、`dshm_upgrade` 装机、`dshm_restart` 均需用户分别确认。旧进程未重启前仍可能运行旧版自动用卡；若以后获批发布，先核验旧宿主两项授权关闭并成功落盘，再安装、获准重启、最后验证新宿主无自动消费路径。npm staged 版本不能因暂时 404 而重推相同 tag。

## 输入工件

- 已逐题确认的设计：[GLM 详情面板设计](./glm-detail-alignment-draft.md)（Q1–Q23）。
- 自动用卡退役：[ADR 0004](../adr/0004-retire-automatic-card-redemption.md)；不明手动结果持久化：[ADR 0005](../adr/0005-persist-unknown-manual-redemption.md)。
- 既有运行时入口：`src/host.mjs` 的 `createQuotaService`、`refresh`、`listResetCards`、`useResetCard`、`apply`；`src/client.mjs` 的 `mountQuotaCard`、`renderDetail`、`renderResetSection`、`poll`；`src/core/reset.mjs` 的查询/消耗纯函数。构建/测试命令来自 `package.json`。

## 文件结构与职责（先于任务）

| 动作 | 精确路径 | 唯一职责 |
|---|---|---|
| Create | `src/core/legacy-auto-settings.mjs` | 解析 `$DSH_HOME/glm-quota-reset/settings.json` 并原子写入双窗口 `enabled:false` 的回退安全覆盖；无自动花卡能力。 |
| Create | `src/core/manual-outcome.mjs` | 管理 `$DSH_HOME/glm-quota-reset/manual-outcome.json` 单笔写前/上游未知/上游已知但浏览器未确认回执/结清记录；提供受 attemptId 保护的状态迁移。 |
| Modify | `src/host.mjs` | 调用一次性迁移、彻底拆除自动花卡、串接手动写前记录/锁定/核实、暴露安全快照与同源 POST 核实路由、记录今日用量首次失败时间。 |
| Modify | `src/shared.mjs` | 删除 `autoReset` 客户端/宿主路由常量；新增 `resetAcknowledge: /api/dsh-quota-watch/reset-cards/acknowledge`（上游未知后用户核实）与 `resetReceipt: /api/dsh-quota-watch/reset-cards/receipt`（浏览器确认收到上游已知结果），客户端均用去掉前导 `/` 的相对路径。 |
| Modify | `src/core/reset.mjs` | 保留卡列表/消费请求、解析、最早到期选择与 `resetWindow`；提供供宿主选卡和客户端到期展示共用的 `parseResetExpiryTime`；删除仅用于自动阈值/重试的计算与配置。 |
| Modify | `cordis.patch.yml` | 只保留 `quota-watch` 宿主条目与 `pollIntervalSec: 60`，移除可重新授权自动用卡的 `autoReset` 初值。 |
| Modify | `src/client.mjs` | 删除自动用卡文案/设置/事件，呈现固定卡区、手动结果与核实动作，处理两大数字/模型同步降级、刷新忙碌态、确认取消和卡区窄屏可读性。 |
| Modify | `src/client/prefs.mjs` | 删除已无界面的 `AUTO_OPEN_KEY`、`loadAutoOpen`、`saveAutoOpen`；保留胶囊坐标及侧栏卡片显隐偏好，不复用旧键。 |
| Generated | `lib/client.js` | 只能由 `npm run build` 从 `src/client.mjs` 构建，不手改。 |
| Create | `tests/support/isolated-service.mjs` | 以每测试独立临时目录包装 `createQuotaService(ctx,{legacyAutoSettingsPath,manualOutcomePath,...})`，注册清理，避免任何合成测试读写真实 `$DSH_HOME`。 |
| Create | `tests/legacy-auto-settings.test.mjs`、`tests/manual-outcome.test.mjs`、`tests/manual-redemption.test.mjs` | 分别验证回退迁移、写前日志状态机、宿主手动消费/核实与竞争条件；测试使用隔离路径和合成上游响应。 |
| Modify | `tests/host.test.mjs`、`tests/client.test.mjs`、`tests/reset-cards.test.mjs`、`tests/prefs.test.mjs`、`tests/package-shape.test.mjs` | 宿主轮询与失败计时、UI 四态和手动反馈、纯函数、偏好清理、公开包形状。 |
| Modify then Retire | `tests/auto-reset.test.mjs` | Task 3 先把所有 service 构造改用隔离路径；Task 6 将仍有效的手动/钱包竞争用例迁走，核对路径后再删除已退役的自动消费断言。 |
| Modify | `README.md`、`GLOSSARY.md`、`docs/adr/0003-opt-in-reset-card-redemption.md`、`docs/adr/0004-retire-automatic-card-redemption.md`、`docs/adr/0005-persist-unknown-manual-redemption.md` | 用户说明、术语和历史决策退役记录；保留 ADR 0003 作为历史，不抹掉原因。 |
| Conditional | `docs/assets/panel-glm-detail.webp` | 只有取得合成数据的新 UI 真实浏览器预览并通过脱敏复核后，才替换旧截图；无法验证时先移除 README 对旧自动用卡截图的引用，资产保留历史，发布前报告视觉验证缺口。 |

任务依赖的稳定接口：

- `createIsolatedQuotaService(ctx, options={})`（`tests/support/isolated-service.mjs`）为每次构造创建独立临时目录，自动注入 `legacyAutoSettingsPath` 与 `manualOutcomePath`，测试文件结束时清理；需要持久重建的用例显式共享本测试自建的临时路径。`tests/host.test.mjs`、`tests/auto-reset.test.mjs` 和新手动测试中禁止直接用无隔离选项的 `createQuotaService()`。
- `retireLegacyAutoResetSettings(path) -> {ok:true} | {ok:false,error:string}`；仅 `service.start()` 在 `schedule(0)` 前调用，`createQuotaService` 构造期不写盘；所有调用 start 的测试都经隔离 helper 注入路径，不能误写真实 DSH_HOME；失败日志只报告回退风险，不重新授权自动消费。
- `createManualOutcomeJournal(path)` 提供 `read() -> null | record`、`begin({resetType}) -> record`、`finishKnown(attemptId, outcome:'success'|'refused') -> record`、`markUnknown(attemptId)`、`acknowledgeUnknown(attemptId)`、`acknowledgeReceipt(attemptId)`。`record = {version:1,attemptId:string,resetType:'WEEK'|'FIVE_HOUR',startedAt:number,status:'in-flight'|'unknown'|'known-success'|'known-refused'}`；begin 遇既存记录或写入失败必须抛错；坏记录/不可读文件不能当作“无记录”，须拒绝消费；磁盘残留 `in-flight` 在宿主重启后作为 unknown 呈现。`finishKnown` 只原子转换为已知回执，不立刻清除；只有相同 attemptId 的 unknown 用户核实或已知回执确认才能清除，清除写盘失败须保留记录和消费锁。
- `createQuotaService` 保留 `overview()/refresh()/listResetCards()/useResetCard()`，新增 `acknowledgeManualOutcome({attemptId})`（unknown 需 fresh 国内计划+卡）与 `acknowledgeKnownReceipt({attemptId})`（只确认已知结果已到浏览器，不再次查卡）。公开快照在任何未结清记录时带 `manualOutcome: {attemptId,resetType,startedAt,status:'unknown'|'known-success'|'known-refused'}`；日志损坏/不可读时另带 `manualOutcomeError:'storage-unavailable'` 并禁手动消费。无论上游 POST 已知与否，宿主在浏览器确认之前始终拒绝新的手动消费。待核实告警在国内卡区展示；若 provider 临时切换到国际站或两 provider 都缺凭据，卡区仍按适用范围隐藏，但持久告警必须让浮动胶囊作为可键盘进入的独立入口保持可见，并在概览展示；只有既无 provider 数据又无待核实告警时才保持现有整体隐藏行为。
- `parseResetExpiryTime(expireTime)`（`src/core/reset.mjs`）返回可比的 epoch 毫秒或 undefined：无时区墙钟暂按 `+08:00`，显式 `Z`/offset 保留上游时区解释；宿主 `pickResetCard` 与客户端最早到期显示必须消费同一个解析函数。
- 浏览器钱包展示仅消费 `overview/refresh` 返回的 `snapshot.reset`：详情打开不再单独调用 `CLIENT_ROUTES.resetCards`，初始未就绪时显示「查询中」并触发一次 `poll(true)`；手动用卡响应后以 GET overview 读取宿主已更新的 `resetState`，不将 `resetInfo/knownResetCards` 作为第二权威源。`poll()` 对强制 POST 使用独立 `forceGeneration`/`forceBusy` 与普通 GET 的 `normalSequence` 截止水位：force 进行时普通 GET 可照常请求但不得把旧钱包快照用于渲染；force 成功响应即使后发 GET 已先返回也必须被应用，force 完成前启动而迟到的 GET 均不得回滚它，只有 force 完成后新发起的 GET 才可更新界面。不能仅沿用当前全局 `requestSequence`，因为后发普通 GET 会错误地丢弃仍在进行的 force 结果。宿主 `/reset-cards` GET 路由可保留给其他只读调用者，但客户端不再读取它。
- `ROUTES.resetAcknowledge`/`CLIENT_ROUTES.resetAcknowledge` 为 `/api/dsh-quota-watch/reset-cards/acknowledge`（unknown 用户核实），`ROUTES.resetReceipt`/`CLIENT_ROUTES.resetReceipt` 为 `/api/dsh-quota-watch/reset-cards/receipt`（known 已送达确认）；两者同源配对 POST `{attemptId}`，只能清各自允许的状态且必须匹配当前记录。旧 `/api/dsh-quota-watch/auto-reset` 在 `src/host.mjs` 以私有兼容常量短期返回 410，不进入新共享路由常量，不解析/保存旧授权。

## 任务清单

### Task 1：隔离旧自动授权的关闭覆盖

- **Files**：Create `src/core/legacy-auto-settings.mjs`、`tests/legacy-auto-settings.test.mjs`。
- **Consumes**：`$DSH_HOME/glm-quota-reset/settings.json` 的既有 `autoReset.fiveHour/week.enabled` 结构及“保存文件优先于 profile config”的旧版读取规则。
- **Produces**：`retireLegacyAutoResetSettings(path)`：文件缺失也原子写入双 `enabled:false`；原文件其他非授权字段尽可能保留；返回失败分类而非把写盘失败说成已停用。幂等、权限限制、坏 JSON 恢复为全关闭。
- **Step 1（写检查）**：在 `tests/legacy-auto-settings.test.mjs` 写四例：旧文件双 true→false、文件缺失创建 false、坏 JSON 恢复 false、目标父级是普通文件时确定性写入失败（不用 chmod 模拟权限）。
- **Step 2（确认红）**：运行 `node --test tests/legacy-auto-settings.test.mjs`；预期缺 `retireLegacyAutoResetSettings` 导入或上述新断言失败。
- **Step 3（最小实现）**：在 `src/core/legacy-auto-settings.mjs` 实现可注入路径、临时文件 + 原子替换、POSIX 0600/Windows 等效权限、失败清理临时文件和 `{ok:false,error}` 返回。
- **Step 4（确认绿）**：运行 `node --test tests/legacy-auto-settings.test.mjs`；预期四种合成文件状态均通过、只写临时目录。

### Task 2：实现单笔手动结果写前日志

- **Files**：Create `src/core/manual-outcome.mjs`、`tests/manual-outcome.test.mjs`。
- **Consumes**：设计 Q18/Q22/Q23 与 ADR 0005 的不明结果跨重启、单笔锁定、写盘失败拒绝 POST；Node `fs`/`crypto`（Node >=20，无新依赖）。
- **Produces**：`createManualOutcomeJournal(path)` 的 `read/begin/finishKnown/markUnknown/acknowledgeUnknown/acknowledgeReceipt`；磁盘 schema `{version:1,attemptId,resetType,startedAt,status}`，status 含 `in-flight | unknown | known-success | known-refused`；begin 原子持久写入并禁止覆写未结事件，`finishKnown` 先持久化已知回执而不清除，重启时 in-flight 投影 unknown；两个 ack 只能分别处理自身状态且都按 attemptId CAS。文件不含 key、请求体、recordId 或原始响应。
- **Step 1（写检查）**：在 `tests/manual-outcome.test.mjs` 写 begin 后重启可读、确定性写盘失败、遗留 in-flight→unknown、单笔锁定、旧 attemptId 不能清新记录、已知成功/明确拒绝先写持久 receipt 且重启可读、只有对应 acknowledgeReceipt 才清、unknown 只能经 acknowledgeUnknown 清且两个 ack 不可互用、坏 JSON/不可读文件 fail-closed 等测试。
- **Step 2（确认红）**：运行 `node --test tests/manual-outcome.test.mjs`；预期缺 `createManualOutcomeJournal` 导入或状态迁移断言失败。
- **Step 3（最小实现）**：在 `src/core/manual-outcome.mjs` 实现 schema 校验、原子替换、POSIX 0600/Windows 等效权限、文件同步与可行的目录同步；无法证明安全落盘时抛明确错误，不能降级成“写不成但可花卡”。
- **Step 4（确认绿）**：运行 `node --test tests/manual-outcome.test.mjs && node --check src/core/manual-outcome.mjs`；预期状态迁移测试全过且语法正确。

### Task 3：让宿主轮询不再触发自动消费

- **Files**：Modify `src/host.mjs`（`refresh`、`apply`、`createQuotaService`）、`tests/host.test.mjs`、`tests/auto-reset.test.mjs`、`tests/package-shape.test.mjs`；Create `tests/support/isolated-service.mjs`。
- **Consumes**：Task 1 的 `retireLegacyAutoResetSettings(path)`；现有 `refresh()` 的 plan/usage/Copilot 探测与十分钟 `probeResetCards` 门控。
- **Produces**：`refresh()` 不再调用 `maybeAutoReset()`；首次宿主启动先尝试持久关闭旧授权，失败仅报告回退风险但新宿主仍不能自动花卡。手动 `useResetCard` 暂保留原接口待 Task 4 收敛；`refresh(true)` 仍强制只读查卡。
- **Step 1（写检查）**：先创建 `tests/support/isolated-service.mjs`，让每次 service 构造注入独立临时 `legacyAutoSettingsPath/manualOutcomePath` 并在文件级 after 清理；将 `tests/host.test.mjs`、`tests/auto-reset.test.mjs` 的全部直接构造替换为该 helper，先运行 `node --test tests/host.test.mjs tests/auto-reset.test.mjs` 确认隔离改动下旧测试仍可运行。`tests/package-shape.test.mjs` 增静态断言：上述测试和新手动测试不能直接调用无隔离参数的 `createQuotaService`。然后在 host 测试加旧双开关 true+高用量仍零 POST、启动迁移成功/失败均可观测的新断言。
- **Step 2（确认红）**：运行 `node --test tests/host.test.mjs tests/package-shape.test.mjs`；预期隔离断言先通过，但现版达到阈值仍自动消费，零 POST 新断言失败。严禁测试在 `$DSH_HOME` 写入真实设置。
- **Step 3（最小实现）**：在 `src/host.mjs` 停止从轮询调用 `maybeAutoReset()`；在 `service.start()` 内、`schedule(0)` 之前运行 Task 1 迁移，注入的 `legacyAutoSettingsPath` 供测试安全使用；失败仅记录回退风险，新宿主依然不会自动花卡。`createQuotaService` 构造期不执行用户数据迁移。
- **Step 4（确认绿）**：运行 `node --test tests/host.test.mjs tests/legacy-auto-settings.test.mjs tests/package-shape.test.mjs`；预期全部通过，静态测试隔离守卫通过。旧自动消费专属用例由 Task 6 迁移/退役，不得以其旧期望评判新功能。

### Task 4：在手动 POST 前接入写前日志

- **Files**：Modify `src/host.mjs`（`useResetCard`、`performResetCard`、`view`）、Create `tests/manual-redemption.test.mjs`；Reuse `tests/support/isolated-service.mjs`。
- **Consumes**：Task 2 的 `createManualOutcomeJournal(path)`；Task 3 的无自动消费 `refresh()` 与 `createIsolatedQuotaService(ctx, options)`；既有手动 `normalizeResetType`、`pickResetCard`、`postJson`、`resetSpendInFlight`。
- **Produces**：`useResetCard` 在实时重列、选卡、构造 POST 后调用 `journal.begin({resetType})`，成功才执行上游 POST；只有 HTTP 200 且明确 `success:true` 或 `success:false` 才经 `finishKnown(attemptId,'success'|'refused')` 从上游 in-flight 转为持久 `known-success | known-refused` 回执，**不在宿主返回浏览器响应前清除**；超时、非 200、无可解释 JSON 或 `success` 类型不明经 `markUnknown(attemptId)`（写失败仍保留磁盘 in-flight）继续锁定。`begin`/journal 失败一律不发 POST；无论记录是 unknown 还是 known 未送达，都阻止下一笔手动消费；已知结果的 use 响应包含相同 attemptId 供浏览器送达确认，所有快照投影不含凭据。
- **Step 1（写检查）**：在 `tests/manual-redemption.test.mjs` 用临时 `manualOutcomePath` 与合成响应覆盖 begin 写失败→零 POST、坏日志锁定、超时/非 200/非 JSON→unknown 且禁止再用、HTTP 200 明确成功/拒绝→持久 known receipt 且重启后可从 overview 恢复、known receipt 写盘失败→保留 in-flight 并锁定、旧 in-flight 恢复、两个并发请求仅一笔消费；所有 service 用 Task 3 的 `createIsolatedQuotaService` 工厂构造，每实例路径独立，不读取真实 `$DSH_HOME`。
- **Step 2（确认红）**：运行 `node --test tests/manual-redemption.test.mjs`；预期现有 `useResetCard` 尚未调用 journal，写前和锁定断言失败。
- **Step 3（最小实现）**：在 `src/host.mjs` 于选卡与构造请求后、POST 前 `begin`；明确的 HTTP 200 结果先持久写为 known receipt（不清除），模糊结果持久 unknown，任何写盘失败均维持锁定或零 POST；宿主快照投影最小 `manualOutcome/manualOutcomeError`，供浏览器重连核对。
- **Step 4（确认绿）**：运行 `node --test tests/manual-redemption.test.mjs tests/host.test.mjs`；预期全部通过，测试日志不含合成凭据值。

### Task 5：新增用户核实结果的受保护入口

- **Files**：Modify `src/shared.mjs`、`src/host.mjs`（`acknowledgeManualOutcome`、`acknowledgeKnownReceipt`、`makeResetAcknowledgeRoute`、`makeResetReceiptRoute`、`apply`）、`tests/manual-redemption.test.mjs`、`tests/host.test.mjs`。
- **Consumes**：Task 4 的单笔 `manualOutcome` 投影和 `createManualOutcomeJournal(path).acknowledgeUnknown(attemptId)/acknowledgeReceipt(attemptId)`；现有 `requestAllowed`、`methodAllowed`、`readJsonBody`。
- **Produces**：`resetAcknowledge`（unknown 用户核实）与 `resetReceipt`（known 送达确认）两条同源/配对 POST `{attemptId}`；unknown 必须先成功重查国内 GLM 计划与卡列表且用户明确核实，才能清 unknown；known receipt 仅在相同 attemptId 的浏览器确认收到成功/拒绝结果后清除，无需把已知结果伪装成 unknown。错误状态/旧 id/查询失败均保持锁定并返回明确错误，不会再发用卡 POST；国际站/缺凭据时 overview 仍暴露待核实记录。
- **Step 1（写检查）**：在 `tests/manual-redemption.test.mjs`/`tests/host.test.mjs` 为两条路由加 GET→405、非同源/未配对→403、错 attemptId→冲突、in-flight 不可确认、unknown 计划/卡查询失败→锁定、国内站两项 fresh 成功后 unknown 可解；HTTP 200 上游已知成功但宿主→浏览器响应被模拟丢弃时，重建服务仍可从 overview 取得 known-success receipt、第二笔用卡被锁；receipt route 同 id 确认后方可再用，unknown/known 交叉使用错误路由必须拒绝。
- **Step 2（确认红）**：运行 `node --test tests/manual-redemption.test.mjs tests/host.test.mjs`；预期 ack 路由未注册或核实断言失败。
- **Step 3（最小实现）**：在 `src/shared.mjs` 定义 `resetAcknowledge/resetReceipt` 两路径，在 `src/host.mjs` 注册各自同源/配对 POST `{attemptId}`；unknown 需 fresh 国内 plan+wallet 后 CAS 清，known receipt 只做同 id 送达确认；`view()` 仅暴露允许的非敏感状态，绝不把旧客户端网络错误当确定失败。
- **Step 4（确认绿）**：重跑 `node --test tests/manual-redemption.test.mjs tests/host.test.mjs`；预期全过，响应 JSON 不含合成凭据。

### Task 6：清退自动策略的其余接口与测试

- **Files**：Modify `src/host.mjs`、`src/shared.mjs`、`src/core/reset.mjs`、`cordis.patch.yml`、`tests/reset-cards.test.mjs`、`tests/package-shape.test.mjs`；Retire `tests/auto-reset.test.mjs`；补全 `tests/manual-redemption.test.mjs` 中从旧测试迁移的有效手动/钱包竞争用例。
- **Consumes**：Task 3 无自动消费轮询，Task 4/5 的手动 use 与 ack 接口；旧测试中的手动串行、钱包十分钟门控、国际站拒用场景。
- **Produces**：无 `autoReset` 配置/授权路由/快照字段/宿主 `maybeAutoReset` 或自动阈值代码；旧客户端 POST `/api/dsh-quota-watch/auto-reset` 由私有退役路由明确返回 410，绝不读取请求体、修改设置或消费卡；该路由不出现在 `src/shared.mjs` 的新公开契约中。手动 `resetWindow` 与卡查询/选择/使用纯函数保留；十分钟只读卡门控不变。
- **Step 1（写检查）**：先把旧自动测试中仍有效的手动串行/钱包门控/国际站拦截断言迁移到 `tests/manual-redemption.test.mjs`/`tests/host.test.mjs`，再写 `cordis.patch.yml` 不含 autoReset、快照无 auto 字段、旧授权 POST 必返 410 且无副作用的新断言。
- **Step 2（确认红）**：运行 `node --test tests/manual-redemption.test.mjs tests/host.test.mjs tests/package-shape.test.mjs`；预期当前自动字段/旧授权接口违反新断言。
- **Step 3（最小实现）**：清理 `src/host.mjs` 自动策略与旧可写路由、`src/shared.mjs` auto 常量、`src/core/reset.mjs` 自动专属函数、`cordis.patch.yml` auto 初值；保留只读钱包和手动串行。删除旧测试前运行 `realpath tests/auto-reset.test.mjs` 并确认目标为本仓库测试文件、有效用例已迁移，再移除它，并将 `tests/package-shape.test.mjs` 的隔离路径静态守卫目标更新为仍存在的 host/manual-redemption 测试文件。
- **Step 4（确认绿）**：运行 `node --test tests/reset-cards.test.mjs tests/manual-redemption.test.mjs tests/host.test.mjs tests/package-shape.test.mjs`；预期全过；`tests/package-shape.test.mjs` 的静态断言证明 `maybeAutoReset`、`evaluateAutoReset` 和 `ROUTES.autoReset` 在运行源码零命中。

### Task 7：记录今日用量连续失败起点

- **Files**：Modify `src/host.mjs`（`markGlmUsageFailure`、`markGlmUsageSuccess`、`view` 的 usage 投影）、`tests/host.test.mjs`。
- **Consumes**：已存在 `usage.status` 的 `ready | stale | error` 与 `updatedAt`；宿主可注入 `now()`，正常轮询间隔 `pollIntervalSec` 可配置。
- **Produces**：`providers[].usage.failureSince` 仅在首次真实失败设为毫秒时间戳，连续失败不改，今日用量成功后清除；`view()` 根据宿主 `now()` 在旧值持续失败达到 5 分钟时额外投影 `usage.staleTooLong:true`，无需依赖浏览器时钟或等待另一轮宿主探测。计划探测成功不能清掉独立 usage 的失败片段，正常等待轮询不会产生失败片段。
- **Step 1（写检查）**：在 `tests/host.test.mjs` 用注入时钟覆盖 ready→stale→stale 的 failureSince 恒定、首次失败满 5 分钟只 GET overview 即 staleTooLong:true、usage 恢复清两字段、无失败只等待不触发、从无成功值首次失败为 error。
- **Step 2（确认红）**：运行 `node --test tests/host.test.mjs`；预期目前没有 failureSince/staleTooLong，新增断言失败。
- **Step 3（最小实现）**：改写 `markGlmUsageFailure`/`markGlmUsageSuccess` 保留连续片段起点，在 `view()` 以宿主 `now()` 投影 staleTooLong；不改 plan/Copilot 错误分型。
- **Step 4（确认绿）**：重跑 `node --test tests/host.test.mjs`；预期全部通过。

### Task 8：同步降级今日两数与分模型展示

- **Files**：Modify `src/client.mjs`（`glmRowModel`、`renderDetail`）、`tests/client.test.mjs`。
- **Consumes**：Task 7 的 `usage.status` 与宿主投影 `usage.staleTooLong`；正常态现有两大数字、窗口和模型顺序。阈值由宿主根据首次真实失败起约 5 分钟判定，客户端不自行读取本机时钟。
- **Produces**：复用一个内部 `displayableGlmUsage(usage)` 判定：ready 显真实数，stale 且 `staleTooLong!==true` 沿用旧数，首次 error 或 `staleTooLong===true` 时两数为 `—` 且分模型为「今日分模型数据暂不可用」；摘要中的今日 token 附加值与详情同一判定，额度窗口独立照常显示。
- **Step 1（写检查）**：在 `tests/client.test.mjs` 用合成快照覆盖正常态顶部顺序不变、usage error 为 `—`、短暂 stale 沿用旧数、staleTooLong:true 时两数与模型一起降级、ready 恢复，以及只有普通缓存不降级。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs`；预期现有详情继续展示 stale 老值而违反降级断言。
- **Step 3（最小实现）**：在 `src/client.mjs` 的 `glmRowModel`、`renderDetail` 复用 `displayableGlmUsage(usage)`，只改变异常展示，不移动正常的两大数字、窗口和模型顺序。
- **Step 4（确认绿）**：重跑 `node --test tests/client.test.mjs`；预期全部通过。

### Task 9：移除浏览器自动用卡入口

- **Files**：Modify `src/client.mjs`（自动设置/COPY/CSS/事件）、`src/client/prefs.mjs`、`tests/client.test.mjs`、`tests/prefs.test.mjs`。
- **Consumes**：Task 6 的宿主不再返回 `autoReset`，且旧 `/auto-reset` 只剩无副作用 410；现有 `mountQuotaCard` 与卡片渲染结构。
- **Produces**：无 `autoOpen`、两窗口授权开关、旧自动事件和自动用卡文案；删除 `AUTO_OPEN_KEY`、`loadAutoOpen`、`saveAutoOpen`，不复用旧 localStorage 键；胶囊位置和侧栏卡片偏好保持。
- **Step 1（写检查）**：更新 `tests/client.test.mjs`/`tests/prefs.test.mjs`：即使快照带旧 autoReset 也不出现两窗口授权开关、旧事件或 auto 文案，prefs 不再导出 auto-open。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs tests/prefs.test.mjs`；预期当前自动 UI/偏好违反新断言。
- **Step 3（最小实现）**：从 `src/client.mjs` 删除自动设置/COPY/CSS/事件，从 `src/client/prefs.mjs` 删除 AUTO_OPEN_KEY 及读写函数，不复用旧 key。
- **Step 4（确认绿）**：重跑 `node --test tests/client.test.mjs tests/prefs.test.mjs`；预期全过且胶囊/侧栏偏好仍在。

### Task 10：以单一快照驱动国内卡区四态

- **Files**：Modify `src/client.mjs`（`loadResetCards`/`renderResetSection`/`renderResetRow`/`poll`）、`tests/client.test.mjs`。
- **Consumes**：Task 9 的无自动设置面板；宿主 `snapshot.reset.status/cards/error`、`refresh(true)` 和 `PROVIDER_IDS.glmDomestic`。
- **Produces**：客户端只以最新 `snapshot.reset` 驱动国内固定虚线/标题及四态；删除详情单独 GET `/reset-cards` 与本地 `resetInfo/knownResetCards` 第二数据源。未取得宿主卡快照时显示「查询中」，详情首次打开至多触发一次 `poll(true)`；ready 空→「无可用」、error→「查询失败」且无旧按钮、ready 非空→只显示非零卡种；国际站无卡区。用卡返回后通过 GET overview 获取宿主已更新的钱包快照；强制刷新进行中或完成前启动的普通 GET 无论先返/后返均不能吞掉或回滚 force 的最终结果。
- **Step 1（写检查）**：在 `tests/client.test.mjs` 增中英文四态、国内未初始化钱包只一次强制刷新且零单独 GET、旧 snapshot 空→新强制刷新有卡时出现操作、旧 snapshot 有卡→新刷新失败时立即移除旧按钮、force POST 已启动但尚未返回时，后发 GET 先返回旧钱包也不能令随后 force 新钱包被丢弃；force 完成前启动而后返回的旧 GET 不得回滚它；用卡后从 overview 取新库存、国际站无区域的合成响应断言。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs`；预期现有双来源 `knownResetCards`/`loadResetCards` 在失败/先后竞态和零行断言中失败。
- **Step 3（最小实现）**：在 `src/client.mjs` 仅保留 `snapshot.reset` 钱包投影，移除详情独立列表 GET；实现独立 `forceGeneration/forceBusy` 与普通 GET `normalSequence` 截止水位，force in-flight 时普通 GET 仍可请求但不应用旧钱包，force 完成后仅允许新启动的 GET 更新界面；初始化缺卡快照时对单次强制刷新加重入守卫；用卡完成后普通 GET overview 读宿主新快照。
- **Step 4（确认绿）**：运行 `node --test tests/client.test.mjs`；预期四态、正反竞态、单次刷新和国际站门禁全过。

### Task 11：允许卡行在窄屏折行

- **Files**：Modify `src/client.mjs`（`.dqw-reset-lines`/卡行样式）、`tests/client.test.mjs`。
- **Consumes**：Task 10 的非零卡种行和现有 `≤480px` bottom sheet 规则。
- **Produces**：约 280px 容器与窄屏 sheet 中卡种、到期日及重置按钮可换行增高、不横向截断，不改变已认可的今日统计/额度窗口/模型正常态排布。
- **Step 1（写检查）**：在 `tests/client.test.mjs` 新增卡区独立换行与按钮结构/CSS 规则断言，不依赖 jsdom 虚假的像素尺寸。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs`；预期当前五列 max-content 无换行守卫，断言失败。
- **Step 3（最小实现）**：只调整 `src/client.mjs` 的卡行布局规则，使到期日/按钮在窄处折行且可聚焦，不变动顶部区域。
- **Step 4（确认绿）**：运行 `node --test tests/client.test.mjs`；预期新增规则测试通过，真实像素仍待最终人工核对。

### Task 12：统一最早到期的消费排序与可访问展示

- **Files**：Modify `src/core/reset.mjs`（`expiryRank`/`pickResetCard`）、`src/client.mjs`（`earliestExpiryLabel` 与到期信息节点）、`tests/reset-cards.test.mjs`、`tests/client.test.mjs`。
- **Consumes**：Task 6 保留下来的手动 `pickResetCard`；Task 10 按卡种汇总行；无时区 `expireTime` 暂按北京解释，显式 Z/offset 使用原字段指定时区。
- **Produces**：核心导出 `parseResetExpiryTime(expireTime) -> number | undefined`，宿主选择最早卡和客户端 `MM/DD`/完整原始时间都基于同一时间戳；键盘焦点与 ARIA 给出无时区字段的北京解释假设，不称官方已验证。无效到期值排序最后、显式 offset 不拼双 offset。
- **Step 1（写检查）**：在 `tests/reset-cards.test.mjs` 用“无时区 11/02 00:30 北京”和“带 Z 的 11/01 15:00 UTC”两卡，断言后者才是同卡种真正先到期的默认消费卡；在 `tests/client.test.mjs` 同一数据断言显示 11/01 且可聚焦说明含被选中卡的原始 Z 时间。再测无效值排序最后。
- **Step 2（确认红）**：运行 `node --test tests/reset-cards.test.mjs tests/client.test.mjs`；预期现有宿主 `expiryRank` 与前端解析均给显式 offset 拼 `+08:00`，选卡/可见到期断言失败。
- **Step 3（最小实现）**：在纯函数模块 `src/core/reset.mjs` 实现共享 `parseResetExpiryTime`，让 `pickResetCard` 和客户端最早到期显示共同调用；可见仍为 MM/DD，附可键盘操作的完整原始值与推定时区说明。
- **Step 4（确认绿）**：重跑 `node --test tests/reset-cards.test.mjs tests/client.test.mjs`；预期选中的 recordId、可见日期和完整原始时间对应同一张最早到期卡。

### Task 13：收敛手动用卡的确认取消语义

- **Files**：Modify `src/client.mjs`（`resetPending`、`onDocKeydown`、`onPanelClick`、卡区确认框）、`tests/client.test.mjs`。
- **Consumes**：Task 10 的卡区、Task 4 的手动 use 返回；当前 inline 确认与 `resetBusy`。
- **Produces**：卡区内显示卡种、影响窗口、不可撤销提醒；取消/Esc/关闭只清未提交确认，已发送 POST 只可等待结果，确认请求中禁重复点击。
- **Step 1（写检查）**：在 `tests/client.test.mjs` 写关闭/Esc 后重进不复现旧确认且零 POST、每周卡影响 5h、确认连点只一笔请求的 jsdom 场景。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs`；预期当前关闭仍保留 resetPending，新增断言失败。
- **Step 3（最小实现）**：在 `src/client.mjs` 修正确认状态生命周期和按钮锁，不引入第二模态窗口、不称已提交请求可取消。
- **Step 4（确认绿）**：重跑 `node --test tests/client.test.mjs`；预期全部通过。

### Task 14：呈现手动消费结果与送达核实入口

- **Files**：Modify `src/client.mjs`（`spendResetCard`、两类确认入口、`renderFloatFace`、`syncFloatVisibility`、`renderAll`）、`tests/client.test.mjs`。
- **Consumes**：Task 4 的 use 返回，Task 5 的 `manualOutcome`（unknown/known-success/known-refused）与 `manualOutcomeError`、`CLIENT_ROUTES.resetAcknowledge/resetReceipt`，Task 10 固定卡区和 Task 13 确认状态。
- **Produces**：宿主已知结果的 HTTP 响应正常到达时，先在界面显示成功约 5 秒或确定拒绝，再用相同 attemptId 自动发 `resetReceipt` 清宿主回执；若回执确认失败，继续显示持久已知回执并锁定下一笔。若宿主→浏览器 use 响应断连/超时，客户端不得说“重置失败”或盲重试，应显示「结果未确认，请核对服务商官方卡数和额度」并刷新 overview：宿主快照若带 known-success/known-refused，则跨重启显示真实已知结果、锁定后续用卡，用户明确「我已了解结果」才发 resetReceipt；宿主快照若是 unknown/in-flight，则 zh/en 持久警告明确「可能已消耗卡、不可自动重试、先核对官方卡数与额度」，用户「我已核实」才经 fresh 国内查询调用 resetAcknowledge。无论何种待确认状态，两 provider 都 missing 时胶囊保持可聚焦警告入口且概览可读；全 missing 不能核实 unknown，恢复国内凭据并成功复查后才允许 ack，pending 清除且再全 missing 才复隐。日志故障显示「手动用卡暂不可用」。
- **Step 1（写检查）**：在 `tests/client.test.mjs` 覆盖正常 HTTP 200 已知成功/拒绝→显示结果后自动发 resetReceipt；模拟上游确实成功、宿主已存 known-success，但浏览器 use fetch 拒绝/超时→不是确定失败、不再次 POST、重开面板/刷新后仅靠 manualOutcome 快照显示持久已知成功与用户确认按钮；unknown 快照双语官方核对文案与用户核实；错 id/复查失败不解锁；两 provider 全 missing 时胶囊可键盘进入且 unknown ack 失败，恢复国内 fresh 后 ack 才成功，清记录再全 missing 才复隐；日志故障锁按钮。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs`；预期当前 use 传输失败被误写为“重置失败”，且无 known receipt 路由/持久界面，新增断言失败。
- **Step 3（最小实现）**：在 `src/client.mjs` 区分浏览器传输不确定与宿主业务结果，对已知回执送达做自动确认或重连后的显式确认，对真正 unknown 仅走人工核实；反馈不能随零卡行消失，任何未结回执都锁住手动重置。
- **Step 4（确认绿）**：重跑 `node --test tests/client.test.mjs`；预期正常送达/丢失响应/重启/全 missing/双语核对各路径全过。

### Task 15：统一「立即刷新」忙碌态

- **Files**：Modify `src/client.mjs`（`panelHeader`、`overviewActions`、`poll(force)`、点击守卫）、`tests/client.test.mjs`。
- **Consumes**：Task 10 的卡区查询状态、Task 14 的手动消费状态；现有宿主 `refresh(true)` 强制只读查卡。
- **Produces**：详情标题栏/概览动作共用一份刷新中状态；请求期间显示「刷新中」并禁重复请求，结束恢复「立即刷新」；不增加单独的刷新成功/失败 toast，卡查询失败仍由固定卡区表达。
- **Step 1（写检查）**：在 `tests/client.test.mjs` 用 deferred fetch 覆盖连续点击只一条 POST refresh、等待中按钮禁用且显示「刷新中」、成功/传输失败后恢复、无额外 toast，普通 GET 轮询仍可继续；force 未返回时后发 GET 即使先回旧钱包，也不能覆盖最终 force 新钱包，force 完成前启动的迟到 GET 也不得回滚。
- **Step 2（确认红）**：运行 `node --test tests/client.test.mjs`；预期当前没有共享忙碌锁，重复请求/文案断言失败。
- **Step 3（最小实现）**：在 `src/client.mjs` 为详情标题栏和概览动作接入同一个 force-refresh 单飞与 finally 恢复，不阻断普通 GET。
- **Step 4（确认绿）**：重跑 `node --test tests/client.test.mjs`；预期全部通过。

### Task 16：同步公开说明与历史决策

- **Files**：Modify `README.md`、`GLOSSARY.md`、`docs/adr/0003-opt-in-reset-card-redemption.md`、`docs/adr/0004-retire-automatic-card-redemption.md`、`docs/adr/0005-persist-unknown-manual-redemption.md`；Verify `tests/package-shape.test.mjs`（静态断言已由 Task 6 加入）。
- **Consumes**：Tasks 1–15 的最终接口及 Q1–Q23 已批准设计。
- **Produces**：README 不再描述自动开关或“刷新在旧版授权下绝不消费卡”的过时保证；ADR 0003 的自动用卡条款标记被 ADR 0004 接替；ADR 0005 须解释上游不明与宿主→浏览器响应丢失两种不确定性、已知结果送达回执及单笔锁定；ADR 0004/0005 状态按实际实现更新，README 明示浏览器请求断连不能断言消费失败；GLOSSARY 保留监控/手动消费的精确术语而不把自动用卡描述为现役能力。
- **Step 1（缺口检查）**：读取 README 自动用卡章节、GLOSSARY 术语、ADR 0003/0004/0005 状态与旧 GLM 截图，逐字记录仍声称自动用卡现役的句子。
- **Step 2（确认缺口）**：运行 `node --test tests/package-shape.test.mjs`；预期 Task 6 已使包形状测试通过，但文档中记录的旧文案仍存在，属于非代码任务的明确前置缺口，不伪造红测。
- **Step 3（修正）**：更新公开说明、词汇表和 ADR 的“源码已实现/尚未装机”状态；旧 `docs/assets/panel-glm-detail.webp` 若仍展示自动开关，则先移除 README 对其作为现役界面的引用，保留资产文件供历史追溯，不假造新截图。
- **Step 4（验证）**：运行 `node --test tests/package-shape.test.mjs && npm run security:check && git diff --check`；预期包元数据/Cordis patch 可解析、安全扫描通过，逐项复读 README/ADR 确认没有把未重启运行时写成已退役。

### Task 17：重建客户端产物

- **Files**：Generated `lib/client.js`（仅构建生成，不手改）。
- **Consumes**：Tasks 1–16 已通过的源码/测试/公开文案；`scripts/build-client.mjs` 的现有 esbuild 包装格式。
- **Produces**：构建产物与 `src/client.mjs` 的已验证逻辑一致，可供仓库测试和后续受控视觉验证。
- **Step 1（现状检查）**：运行 `git status --short --branch` 与 `node --check lib/client.js`；记录旧 bundle 可能仍语法正确但不能证明含新源码，确认 `scripts/build-client.mjs` 是唯一生成方式。
- **Step 2（构建）**：运行 `npm run build`；预期输出 `wrote lib/client.js`，生成文件与本任务前的旧产物相比体现新的客户端模块。
- **Step 3（质量验证）**：运行 `npm test && npm run security:check && node --check lib/client.js && git diff --check`；预期全部成功，测试只用合成数据、bundle 语法正确、diff 无空白错误。
- **Step 4（产物核对）**：运行 `git status --short --branch` 并审查 `git diff -- lib/client.js`；预期只有计划内文件且 bundle 包含新卡区/手动核实逻辑、不含可授权自动用卡客户端代码。视觉质量另受最终验证门槛约束，不以 jsdom 文本断言伪称像素检查。

## 执行纪律

1. 开始实现前先批判性复查整份计划；如发现遗漏、矛盾、接口名称不一致或验证命令在当前环境无效，**先修计划再动代码**。从当前 `main`/`master` 开始实现前，须先获用户同意采用独立分支或直接在该分支修改。
2. 严格按 Task 顺序执行；每任务先观察缺口/红测、再做最小改动、运行该任务指定验证。若某任务测试需要适配既有旧断言，明确记录旧断言被何种新契约取代，不以删测试冒充通过。Task 3–5 期间旧 `tests/auto-reset.test.mjs` 尚未迁移，可能按退役前行为变红：只在其用例完成 Task 6 迁移/删除且全量 `npm test` 通过后才允许该自然边界的 checkpoint；其他 targeted 测试失败仍须停下排查。
3. 遇连续失败、平台持久化能力不足、用户数据迁移不可安全完成或计划与仓库现实不符，立即停下来说明，不猜路径、不降级安全约束、不继续发不可撤销 POST。
4. 一次性 checkpoint commit 只在安全数据模块、宿主接口、客户端 UI 等自然边界使用；不要求每个小步骤提交。实施阶段无权自动发版、升级或重启 DSH。

## 最终验证

- Linux/Node >=20（当前开发环境 Node v24）在 `dsh-quota-watch/` 运行：`npm run build && npm test && npm run security:check && node --check lib/client.js && git diff --check`；预期全部成功，测试只用合成凭据/响应，零真实用卡 POST。
- 回归重点：默认 60 秒额度轮询与十分钟钱包查询完全不调用上游 `/customer-package-reset/use`；旧 `enabled:true` 设置或 profile 初值在新宿主无自动消费能力、写入 false 覆盖后回退旧版也不复活授权；手动 POST 写前失败则零消费，崩溃后持久提示，重复请求锁定，核实失败不清提示；卡区四态/国际站门禁；今日用量 5 分钟累计失败计时；窄面板深浅主题/中英文/键盘操作。
- 运行前检查 `git status --short --branch`：只有本计划涉及的预期文件；任何运行时 profile、凭据目录或系统服务配置不属于本计划的写入范围。
- **视觉验证与发布分离**：jsdom 不做像素布局证明；在获准安装新包并重启前，当前正在服务的 DSH Web GUI 仍运行旧宿主/旧客户端。若实施者找不到可信的合成数据浏览器预览途径，须向用户报告“发布前未完成像素验证”，由用户决定是否延后公开发版；不得把另起的替代服务冒充正在服务的 GUI。未来获准装机后，在现有 URL 页面刷新后人工核对 Web 深浅主题、zh/en、窄屏底部 sheet 与按钮焦点；Desktop 环境不可用时明确记录未验证，不声称双平台实测通过。
- 如需未来公开发版，另行经用户确认版本号/tag/OIDC，并按 npm 官方注册表核实入账后再走 `dshm_upgrade`；宿主生效需**另获用户同意**才能调用 `dshm_restart`，随后刷新既有 DSH 页面验证。不得启动替代当前 DSH Web 的服务。

## 审阅 Checkpoint

实施计划已写好；请用户先审阅本文，**重点确认评审新增的 host→browser 响应丢失保护**：除 ADR 0005 原有的上游 unknown 记录外，计划增加一笔宿主已知但客户端尚未确认收到的持久 receipt 与受保护 `resetReceipt` 路由。若用户不同意这项扩展，须先重审 Q18/Q22 安全边界而不能静默删掉。若需调整，先改计划并重新自检；明确批准计划且另行确认实施分支后，才由普通编码 agent 或人工按任务执行。本 writing-plans 阶段到此停止，不进入编码。
