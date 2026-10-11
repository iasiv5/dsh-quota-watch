# 重置卡宿主安全事务与自动用卡状态实施计划

## 目标

在 `@iasiv5/dsh-quota-watch` 宿主侧实现用户确认的写前安全记录、跨重启“结果未知”全局保护、两窗口独立状态、无卡待命与卡到账唤醒，以及启用授权时的服务器端风险门禁。本计划可先于[客户端计划](./2026-10-12-reset-card-panel-ux-implementation-plan.md)独立实施、独立跑宿主测试；**本计划只供审阅，不授权执行或发版**。

## 架构快照

当前 `src/host.mjs` 的 `refresh()` 每轮探测额度并运行 `maybeAutoReset()`，`probeResetCards()` 对卡列表另设 10 分钟节奏门；`view()` 已提供浏览器安全的 `reset` 与 `autoReset` 切片。`performResetCard()` 在发出不可撤销的 POST 后才知道是否成功，网络超时只有进程内告警和解除自动重试，没有跨崩溃保护。新安全边界由宿主持有：先写最小 pending 记录，再发 POST；无确定结果则保持全局锁，直到用户核实并明确解除。两个窗口分别投影当前状态，但共用一把“结果未知”消费锁。

## 全局约束

- 设计输入：[设计决策记录](./2026-10-12-reset-card-design-decisions.md)（用户逐项确认的 D1–D34，评审与实施的需求基准）；领域术语见 [`GLOSSARY.md`](../../GLOSSARY.md)；跨重启安全取舍见 [`ADR 0004`](../adr/0004-write-ahead-reset-card-guard.md)。
- 保留现有版本/依赖下限：`engines.node: ">=20"`、`dsh.engines.dsh: ">=0.1.7-rc.2"`、`@deepseek-ai/dsh-credentials: "0.1.7-rc.2"`、`@deepseek-ai/cordis: "^4.0.2"`；不新增运行时依赖。
- 仅 `zai-coding-cn` 国内站个人版可列卡、用卡；国际站和缺凭据路径绝不发送国内站消费请求。保留已有 60 秒默认额度轮询、10 分钟卡列表节奏门与自动花卡失败退避；无卡到账后的提前唤醒只在**确认该类型卡从无到有**时发生，网络故障或结果未知不清退避。
- 任何真实消费仍须通过 `POST`、配对/loopback 与同源守卫、二次确认、花卡前实时重列、串行与周卡优先；周卡会同时影响 5 小时窗口。结果未知期间**两种卡的手动和自动消费全部禁止**；成功解锁绝不重新启用自动授权。
- 持久文件只能保存版本、卡种、请求标识、时间与状态，不保存密钥/OAuth/原始上游响应；原子写入失败时不发送消费 POST。腐坏/不可读记录在启动时失效关闭（fail-closed），不能按“不存在记录”放行。
- 本仓库发布配置为 Web 客户端 `platform: web`，Web/Desktop profile 均需保持宿主语义；`~/.dsh/profiles/**` 在 Agent 会话中只读，不进行本地热替换；不创建监听 3080 的进程。文案需中英双语一致。保持 `coldRetryMs`、`retryNoDataMs`、`errorKind`、`attachShadow` 与胶囊隐藏守卫等既有版本判据。
- 在用户确认计划和另行确认发版前，不升级 `package.json` 版本、不打 tag、不推送、不安装或重启 DSH。

## 输入工件

- 已接受的安全决策：[`docs/adr/0004-write-ahead-reset-card-guard.md`](../adr/0004-write-ahead-reset-card-guard.md)。
- 术语：[`GLOSSARY.md`](../../GLOSSARY.md) 中的 Reset-card availability、Uncertain redemption、Awaiting reset card、Automatic-use window state。
- 接口基线：`src/host.mjs` 的 `createQuotaService` / `performResetCard` / `updateAutoResetConfig` / `makeResetUseRoute` / `makeAutoResetRoute`，以及 `src/shared.mjs` 的 `ROUTES` / `CLIENT_ROUTES`。

## 文件结构与职责（先于任务）

| 文件 | 动作 | 唯一职责 |
|---|---|---|
| `src/core/redemption-guard.mjs` | 新建 | 纯 Node 文件安全边界：解析路径、读取并校验 journal、原子写 pending/uncertain、清除已确认记录；没有 HTTP、额度或 UI 逻辑 |
| `tests/redemption-guard.test.mjs` | 新建 | 临时目录与故障注入验证无文件/坏文件/写盘失败/原子替换/重启恢复 |
| `src/host.mjs` | 修改 | 在消费流程接入 journal、全局锁、确认解锁、两窗口状态、无卡唤醒、开启授权门禁；保持宿主路由访问栅栏 |
| `src/core/reset.mjs` | 修改 | 纯决策函数：`no-card` 区别于故障，按窗口推导状态与卡到账的唤醒条件；不做 IO |
| `src/shared.mjs` | 修改 | 新增 `ROUTES.guardAcknowledge` 与 `CLIENT_ROUTES.guardAcknowledge`；保留既有路由名 |
| `tests/auto-reset.test.mjs` | 修改 | 自动用卡待阈值/待卡/卡到账/双窗口/确认门禁与未知结果互斥的宿主测试 |
| `tests/host.test.mjs` | 修改 | 路由 POST、配对/同源守卫、journal 启动恢复与 fail-closed 回归 |
| `tests/reset-cards.test.mjs` | 修改 | H5 状态推导纯函数的直测（Task H5 文件清单所列） |

`src/client.mjs`、`src/client/prefs.mjs`、`lib/client.js` 的产品交互改动归**客户端计划**；宿主计划不修改它们。`cordis.patch.yml`、凭据格式与 provider 请求适配器不动。

## 版本共存与回退边界

- 基本假设：宿主与客户端 bundle 随同一 npm 包同版本发布（`files` 含 `src/**` 与 `lib/client.js`），升级后刷新页面即加载配套客户端；计划与测试均以此为前提。
- 旧客户端 + 新宿主（升级瞬间未刷新的页面）：旧客户端启用达阈值授权会收到 409/503 并显示通用「未能保存」——安全方向的假失败，刷新即恢复；宿主侧锁与门禁不依赖客户端版本。旧客户端无 ack 入口，但保护由宿主持有，不受影响。
- 新客户端 + 旧宿主（理论上的降级/混装）：`guardAcknowledge` 404、`state`/`redemptionGuard` 字段缺失——客户端按字段缺失降级为现有展示（不新增告警、不解除任何保护），不执行任何不安全动作。
- 回退：宿主计划全部改动位于插件包内，回退 = 降级安装上一版本包（经用户确认）；journal 文件 (`~/.dsh/glm-quota-reset/uncertain-redemption.json`) 与宿主设置文件独立于插件包，回退后残留的 `uncertain-redemption.json` 会让旧版宿主忽略（旧版不读该文件），不会造成锁死——但重装新版前应人工核实并清理。
- `storage-error` 锁死的人工恢复（D25/D27 的可用性代价）：停 DSH → 用户核实官方卡数与额度 → 删除 `glm-quota-reset/uncertain-redemption.json` → 重启。此路径写入 README（客户端计划 C9）。

## 跨计划接口契约

- `POST /api/dsh-quota-watch/auto-reset` 仍接受完整 `{fiveHour:{enabled,threshold},week:{enabled,threshold}}`。**风险变更判据（状态迁移口径）**：以「触发态」= 该窗口已启用且新鲜已用百分比 ≥ 生效阈值（生效阈值 = `normalizeAutoResetConfig` 归一后的值，含 clamp）为比较基准；仅当**该窗口自身配置变化**（off→on、或生效阈值因下调/clamp 而下移）使其**由旧配置的『非触发态』迁移为新配置的『触发态』**，才算该窗口的风险变更。**配置未变化的窗口永不触发 409**（即使它正处于触发态——那已是既有授权的运行中状态）；纯禁用、阈值上调、迁移后仍非触发态的调整都直接保存、不请求上游。（D24：本轮不提供阈值编辑 UI，但 API 仍可提交阈值，宿主必须同一门禁。）风险变更请求先 `probeGlm()` 取新鲜额度，再按新配置复评迁移；已达触发态强制 `listResetCards()`，卡列表未知返回 HTTP 503 `{ok:false,error:'preflight-unavailable'}`，不得改授权。单个风险窗口返回 HTTP 409 JSON `{ok:false,error:'confirmation-required',window:'5h'|'week',availability:'available'|'none',used:number,threshold:number}`；确认请求附加 `confirmation:{window:'5h'|'week',availability:'available'|'none'}`，宿主重新核对，卡可用性变更时重新返回 409，不能拿旧确认套到另一窗口。**一次请求造成两个窗口风险变更**返回 HTTP 409 `{ok:false,error:'multi-window-confirmation',windows:['5h','week']}`，不做任何状态变更，客户端须分窗口逐一提交确认。`src/client.mjs` 直接消费此 JSON；现有 `fetchResetEnvelope()` 会解析非 2xx JSON。
- `view().autoReset.fiveHour.state` 与 `.week.state` 各为 `{kind:'disabled'|'standby'|'triggered'|'holding'|'awaiting-card'|'error'|'recent-success'|'guarded',at?:number,message?:string}`；`enabled` / `threshold` / `armed` 原字段保留。语义：`standby` = 已授权且未达触发态；`triggered` = 已授权、达触发态、有对应可用卡且仍布防——宿主将在下一轮额度探测（默认 ≤60 秒）尝试消费；`holding` = 已授权、达触发态但已解除布防（本周期已消费，等待已用回落重新布防），**不会**再次消费；`awaiting-card` = 达触发态且成功确认无对应卡。错误不得当作无卡。若保留兼容性 `lastEvent`，新客户端不得把它当作当前两窗口状态。
- `view().redemptionGuard` 为无凭据投影：`{status:'clear'|'locked'|'storage-error',resetType?:'WEEK'|'FIVE_HOUR',at?:number,reason?:'pending'|'request-unknown'}`。词表映射固定：journal `state:'pending'` → 视图 `reason:'pending'`；journal `state:'uncertain'` → 视图 `reason:'request-unknown'`；`storage-error` 只作为 `status`，不作为 `reason`。客户端 C8 断言使用视图词表，不直接消费 journal 词表。旧客户端未知此字段时也不得绕过宿主锁。
- 新 `POST /api/dsh-quota-watch/reset-cards/ack-unknown`（`ROUTES.guardAcknowledge` / `CLIENT_ROUTES.guardAcknowledge`）仅接受 `{verified:true}`、沿用 `requestAllowed` 与 POST-only。成功返回 `{ok:true,redemptionGuard:{status:'clear'}}`；若其他已授权会话已先解除，重复核实仍返回相同的幂等成功且不修改授权；读写异常返回 `{ok:false,error:'guard-storage-error'}` 且继续锁定。浏览器负责“先看官方卡数/额度”提示与二次确认；此路由**只清保护，不改变授权或发消费 POST**。
- 卡片列表投影与现状一致：`reset.status:'ready'` 时经 `reset.cards.fiveHour/week` 给出成功列表；**`reset.status:'error'` 的视图不含 cards**（现行 `resetView()` 错误分支本就不带，本计划不改变该形状）。"错误后保留上次成功卡数供展示" 由**客户端** `knownResetCards` 本地留存承担（src/client.mjs 现有行为）；按钮可否消费的判据见客户端计划 C5（最近一次卡列表查询成功与否，与宿主视图错误状态无关地禁用）。

## 任务清单

### Task H1：建立写前 journal 的文件边界

- 文件：新建 `src/core/redemption-guard.mjs`、`tests/redemption-guard.test.mjs`。
- Consumes：`ADR 0004` 的“POST 前写入、失效关闭”；现有 `resolveAutoResetSettingsPath()` 的 `DSH_HOME` 路径规则。
- Produces：`resolveRedemptionGuardPath(env)` → `join(DSH_HOME 或 homedir()/.dsh,'glm-quota-reset','uncertain-redemption.json')`；`readRedemptionGuard(path)` → `{status:'clear'|'locked'|'storage-error',record?}`；`writeRedemptionGuard(path,record)` 与 `clearRedemptionGuard(path)` 抛写盘错误。`record` 固定 `{version:1,state:'pending'|'uncertain',resetType:'WEEK'|'FIVE_HOUR',requestId:string,at:number}`，绝不含凭据。
- [ ] 先写 `tests/redemption-guard.test.mjs`：用 `mkdtempSync(tmpdir())` 对无文件、合法 pending、损坏 JSON、未知版本、写入/删除失败及重启重读分别断言；检查落盘文本不含模拟 key，路径位于 `glm-quota-reset`。运行 `node --test tests/redemption-guard.test.mjs`，预期新模块缺失或断言失败。
- [ ] 用 Node `fs` 在同目录建立 mode 0600 临时文件并原子 rename；任何中间失败清理临时文件并抛出。只把 `ENOENT` 当无记录，损坏/不可读都返回 `storage-error`；Windows 目录同步不可用不得把本可用的原子替换误判为失败，跨进程重启时以原子 rename 后结果为准。运行同一命令，预期全绿。

### Task H2a：宿主启动时恢复结果未知保护

- 文件：`src/host.mjs` 的 `createQuotaService` / `view`、`tests/host.test.mjs`。
- Consumes：H1 的 `readRedemptionGuard(path)`；现有 `options.autoResetSettingsPath ?? resolveAutoResetSettingsPath()` 的注入先例（src/host.mjs `createQuotaService`）。
- Produces：`createQuotaService` 新增 `options.redemptionGuardPath ?? resolveRedemptionGuardPath()` 注入项（与 autoResetSettingsPath 同构）；服务启动先读取 `redemptionGuard`，`pending`、`uncertain`、`storage-error` 都视为锁定，`view().redemptionGuard` 按"跨计划接口契约"的词表投影；未知/损坏记录绝不按不存在处理。
- [ ] 为无文件、合法 pending、合法 uncertain、损坏/不可读文件分别写服务启动与 overview 测试（全部经 `redemptionGuardPath` 注入临时目录），断言锁定时 `service.useResetCard` 返回 `guard-locked` 且零消费 POST；同时断言不注入时解析到的默认路径仍位于 `glm-quota-reset`（仅路径断言，不实际写读）；**并改造两份既有宿主测试的全部 `createQuotaService` 调用点统一注入临时 `redemptionGuardPath`**：`tests/host.test.mjs`（13 处，连同同类隐患 `autoResetSettingsPath` 一并注入）与 `tests/auto-reset.test.mjs`（24 处，已注入 `autoResetSettingsPath`、补注入 `redemptionGuardPath`，均与 tempSettingsPath 同法；route 级 fake-service 用例不涉路径无需注入）——保证套件结果与机器真实 `~/.dsh` 状态无关，且 H2b 后测试绝不向真实用户目录读写 journal；运行 `node --test tests/host.test.mjs tests/auto-reset.test.mjs`，预期新增断言失败。
- [ ] 在 `createQuotaService` 先读 H1 journal 并在消费入口拒绝锁定状态，投影不含凭据；运行同一命令，预期全绿。

### Task H2b：消费 POST 前写 pending 并按确定性结算

- 文件：`src/host.mjs` 的 `performResetCard` / `useResetCard`、`tests/auto-reset.test.mjs`。
- Consumes：H1 的 `writeRedemptionGuard(path,record)` / `clearRedemptionGuard(path)`；H2a 的全局锁；原 `resetSpendInFlight` 串行守卫。
- Produces：取得实时卡与 requestId 后、`postJson(spec)` 前先写 pending；写失败返回 `guard-write-failed` 且零 POST。确定成功/明确拒绝只在清理成功后解锁，清理失败继续锁定；超时/非 JSON/非 200 保留锁。确认成功后先处理 journal，再做后续 list/plan GET，避免“消费已成功但后续 GET 失败”误判未知。
- [ ] 在 `tests/auto-reset.test.mjs` 写写前失败零 POST、POST 未决时第二个服务读到 pending、成功清理、超时/非 JSON/非 200 留锁、清理失败继续锁定、并发手动/自动至多一次测试；运行 `node --test tests/auto-reset.test.mjs tests/redemption-guard.test.mjs`，预期新增断言失败。
- [ ] 接入写前记录与确定结果清理；手动/自动入口均先过 H2a 锁判定，消费全过程沿用串行守卫；运行同一命令，预期全绿。

### Task H3：结果未知时失效关闭两项授权

- 文件：`src/host.mjs` 的 `unknownOutcome` / `updateAutoResetConfig` / `autoResetView`、`tests/auto-reset.test.mjs`。
- Consumes：H2a 的启动锁与 H2b 的未知消费结果；现有 `writeAutoResetSettings` 原子配置写法。
- Produces：任一卡种未知结果后把 `fiveHour.enabled` 与 `week.enabled` 都设 false 并写盘；若配置写盘失败，内存仍双关、暴露 `persistError`，H2a/H2b 的 journal 锁跨重启仍阻止任何消费；服务启动读到 pending/uncertain 时同样修复已保存的旧授权（不可写则本进程失效关闭）。锁仍在时任何开启授权请求都拒绝，解锁不会隐式恢复两项授权。
- [ ] 写测试：WEEK 与 FIVE_HOUR 结果未知均关闭两项、重启后仍锁定、设置写盘失败后仍零消费、尝试越锁启用被拒、已确认拒绝与正常成功不误关授权。运行 `node --test tests/auto-reset.test.mjs`，预期新断言失败。
- [ ] 实现 `forceDisableAutoResetOnUnknown` 及启动恢复，锁检查放在配置变更入口与消费入口；运行同一命令，预期全绿。

### Task H4：提供人工解除保护路由

- 文件：`src/shared.mjs`、`src/host.mjs` 的 `makeGuardAcknowledgeRoute` 与插件 route 注册处、`tests/host.test.mjs`。
- Consumes：H1 的 `clearRedemptionGuard`、H2a/H2b/H3 的保护状态；`requestAllowed` / `methodAllowed` / `readJsonBody`。
- Produces：`ROUTES.guardAcknowledge`、`CLIENT_ROUTES.guardAcknowledge` 与跨计划契约中的 `POST /api/dsh-quota-watch/reset-cards/ack-unknown`；清锁但不重新授权/重试。
- [ ] 为 GET、跨站、未配对、`verified` 缺失、清锁失败、重复确认幂等成功、成功确认后仍双关且不发消费 POST 写路由/服务测试；运行 `node --test tests/host.test.mjs tests/auto-reset.test.mjs`，预期新增路由或断言失败。
- [ ] 在 route 注册表中注册精确 POST 路由；只在服务成功清除 journal 后回 `{ok:true}`，失败保锁，`verified:true` 是唯一接受的核实声明。运行同一命令，预期全绿。

### Task H5：按窗口输出当前自动状态

- 文件：`src/core/reset.mjs`、`src/host.mjs` 的 `autoResetView` / `maybeAutoReset`、`tests/reset-cards.test.mjs`、`tests/auto-reset.test.mjs`。
- Consumes：H2–H4 的 guard 投影；现有 `autoResetConfigFor` / `evaluateAutoReset` 与 `autoResetEvent`。
- Produces：`deriveAutoUseWindowState({ config, usedPercent, cardAvailable, armed, lastOutcome, guard })` 纯决策函数（`config` = 该窗口归一后配置，`usedPercent` = 该窗口新鲜成功探测的已用百分比或 undefined，`cardAvailable` = 最近一次**成功**卡列表中该窗口卡种是否有可用卡或 undefined，`armed` = 该窗口布防状态，`lastOutcome` = 本进程内该窗口最近一次自动结果（含 `no-card`/真实故障/时间），`guard` = `view().redemptionGuard`）。**判定优先级（自上而下取首个匹配；与 D14/D15 及客户端 C4a 层序一致，故障不被运行态掩盖）**：
  1. `guard.status !== 'clear'` → `guarded`（安全锁最高，D25–D31）
  2. 未启用 → `disabled`（停用后旧故障不占状态位，D12/D15）
  3. 本进程内该窗口有**未恢复的真实故障**（网络/授权/消费失败）→ `error` 带 `message`，持续至该窗口**被禁用或下一次成功尝试**为止——离开触发态不再单独清除，以覆盖「失败后退避期内已用回落再重触发」的角落（D15 授权启用未恢复期间持续警示；此优先于一切运行态，含 triggered）
  4. `usedPercent` 缺失 → `error`（数据不可用）
  5. 达触发态且 `cardAvailable === undefined` → `error`（卡可用性未知：未知既不当无卡也不当有卡，D5）
  6. 本进程 10 秒内成功消费 → `recent-success`
  7. 达触发态且 `cardAvailable === false` → `awaiting-card`
  8. 达触发态、有卡且 `armed === true` → `triggered`（仅在第 3/5 条未命中时给出——退避或故障阻拦期由 error/awaiting-card 呈现，故「宿主下一轮将尝试消费」的文案始终属实）
  9. 达触发态但 `armed === false` → `holding`（本周期已消费、等待回落重新布防，不再消费）
  10. 未达触发态 → `standby`
  重启后无 `lastOutcome`：首轮探测成功即可重算 standby/triggered/holding/awaiting-card（`armed` 初值 true），`recent-success` 与普通 `error` 不跨重启（后者由新一轮失败重新产生；结果未知走 `guarded`）。`autoReset.fiveHour.state` / `.week.state` 按此投影；`no-card` 尝试仍保留原 10 分钟重试，不记红色失败，不留永久账本。
- [ ] 测试 disabled/standby/triggered/holding/awaiting-card/error/recent-success/guarded（含 armed=true→triggered 与 armed=false→holding 的区分），两个窗口同时不同状态不互相覆盖；尤其“5 小时无卡、每周接口失败”不能由一条 `lastEvent` 互相覆盖；**优先级断言：达触发态+有卡+armed=true 但本进程内有未恢复真实故障 → error（不是 triggered）；达触发态+cardAvailable 缺失 → error（卡可用性未知）；未启用+历史故障 → disabled；失败后退避期内已用回落再重触发+有卡+armed=true → 仍 error（不显示 triggered）**；新建服务实例的首轮探测可重算待阈值/即将消费/等待回落/待卡状态，普通历史成功事件不落盘。运行 `node --test tests/reset-cards.test.mjs tests/auto-reset.test.mjs`，预期新断言失败。
- [ ] 在纯函数内判状态优先级并由 host 投影；`no-card` 仍保留原 10 分钟重试，不将它当作成功消费，也不记红色失败；运行同一命令，预期全绿。

### Task H6：确认卡到账后解除无卡退避

- 文件：`src/host.mjs` 的 `probeResetCards` / `maybeAutoReset`、`tests/auto-reset.test.mjs`。
- Consumes：H5 的按窗口 `awaiting-card` 与现有 `autoResetLastAttempt`；10 分钟卡列表门，60 秒默认额度轮询。
- Produces：只在成功查卡且对应卡种从零张变为正数时，清除此窗口因 `no-card` 导致的退避标记；下一轮额度探测再由原 `evaluateAutoReset` 决定是否消费，保持每周优先。不清网络错误退避、未知结果安全锁，也不额外提高卡列表查询频率。
- [ ] 用注入时钟与变化的 LIST fixture 写“无卡→对应卡到账”“无卡仍无卡”“仅另一类型到账”“网络错误后恢复”“guard locked”测试；运行 `node --test tests/auto-reset.test.mjs`，预期新增唤醒断言失败。
- [ ] 实现仅针对 `no-card` 的状态标记和零→正 transition；运行同一命令，预期下一轮恢复尝试、其他状态无额外 POST。

### Task H7：授权前返回新鲜的消费风险判定

- 文件：`src/host.mjs` 的 `updateAutoResetConfig` / `makeAutoResetRoute`、`tests/auto-reset.test.mjs`、`tests/host.test.mjs`。
- Consumes：H3 guard 检查、现有 `probeGlm` / `listResetCards`；`fetchResetEnvelope()` 可消费非 2xx JSON 的现有客户端契约。
- Produces：`updateAutoResetConfig` 改为异步，按契约的**风险变更判据（状态迁移口径）**决定路径：比较同一窗口旧配置与新配置的「触发态」（已启用且新鲜已用 ≥ 生效阈值，生效阈值 = 归一含 clamp），仅当该窗口自身配置变化（off→on、生效阈值因下调/clamp 下移）且由非触发态迁移为触发态才算风险变更；**配置未变化的窗口不参与判定**。无风险变更直接保存（纯禁用、阈值上调、迁移后仍非触发态，均不请求上游）；风险变更先 `probeGlm()` 取新鲜额度并按新配置复评迁移，已达触发态强制 `listResetCards()`，卡列表未知返回 HTTP 503 `{ok:false,error:'preflight-unavailable'}`；单个风险窗口返回 409 `confirmation-required`；两个窗口同时风险变更返回 409 `multi-window-confirmation`（带 `windows` 数组）。所有拒绝分支零状态变更。
- [ ] 测试未到阈值直接启用、两种卡可用性分别 409、额度/卡片探测失败返回 503 preflight-unavailable、锁定时拒绝开启、纯禁用与阈值上调不请求上游、已启用窗口阈值下调触发 409、clamp 后触发线跨越当前已用同样触发 409、**关闭一个窗口时另一窗口已启用且达触发态 → 200 保存且零 409（配置未变窗口不参与判定）**、**已启用达触发态窗口的阈值上调（仍达触发态）→ 直接保存且不请求上游**、双窗口同时风险变更返回 multi-window-confirmation、跨站 POST 被拒；运行 `node --test tests/auto-reset.test.mjs tests/host.test.mjs`，预期新增断言失败。
- [ ] 实现异步预检与路由 `await service.updateAutoResetConfig(payload)`，按结果回 200/409/503，拒绝路径不改内存或文件；运行同一命令，预期全绿。

### Task H8：校验风险确认后提交单窗口授权

- 文件：`src/host.mjs` 的 `updateAutoResetConfig`、`tests/auto-reset.test.mjs`、`tests/host.test.mjs`。
- Consumes：H7 的 409 `confirmation-required` 与 `preflight-unavailable`；跨计划请求字段 `confirmation:{window:'5h'|'week',availability:'available'|'none'}`。
- Produces：只有确认窗口和最新卡可用性均与服务端第二次新鲜复查一致才写配置；可用性变化重新回 409 `confirmation-required`；`multi-window-confirmation` 请求不做任何状态变更，要求分窗口逐一提交（客户端 C2 的 UI 一次只拨一个开关，天然满足）。原 API 虽允许提交阈值、界面仍不提供阈值编辑。
- [ ] 写测试：确认错窗口、multi-window-confirmation 全拒且零状态变更、确认前后卡数变化重新 409、后端调低阈值（含 clamp 跨越已用）未确认前零状态变更、确认正确但保护锁已激活仍拒绝；运行 `node --test tests/auto-reset.test.mjs tests/host.test.mjs`，预期新增断言失败。
- [ ] 加入对 `confirmation` 的验证与第二次新鲜复查，确认正确才写宿主设置；运行同一命令，预期全绿。

## 执行纪律

1. 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或无效验证命令时先修计划。若当前位于 `main`/`master` 且用户未同意直接在主分支实现，先确认工作分支。
2. 按 H1→H2a→H2b→H3→H4→H5→H6→H7→H8 顺序执行；每项先看到新测试失败，再实现并运行该项验证。不得无声跳步、合并任务或改变消费安全目标；如果计划与代码现实不符，立即停下说明，不猜。
3. 写前 journal 涉及不可撤销消费：测试只使用模拟凭据、模拟上游与临时目录，**绝不向真实服务商发测试 POST**；不得将本机路径、私有域名或凭据写入公开仓库。发布、安装与重启均另行请求用户许可。
4. 完成本计划后先让客户端计划按“跨计划接口契约”对接；全部任务完成再跑最终门禁并给出修改摘要。

## 最终验证

在仓库根目录、Node.js >=20 的 shell 中运行：`node --test tests/redemption-guard.test.mjs tests/auto-reset.test.mjs tests/host.test.mjs tests/reset-cards.test.mjs` → 全通过；`npm test` → 全通过；`npm run security:check` → 安全检查通过；`node --check src/host.mjs` → 零语法错误；`git diff --check` → 零空白错误。Windows 执行者用 PowerShell 调用同样的 `node`/`npm` 命令；`git diff --check` 可在安装 Git 的 PowerShell 下运行。不开真实服务商消费链路验收，不改 3080 进程。

## 审阅 Checkpoint

本计划与客户端计划均须由用户审阅并批准后才能交普通编码 agent 或人工执行；本计划自身不授权编码、打包发布或重启。
