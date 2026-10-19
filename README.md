# DSH Quota Watch

[![CI](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-quota-watch/ci.yml?branch=main&label=CI)](https://github.com/iasiv5/dsh-quota-watch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@iasiv5/dsh-quota-watch?label=npm)](https://www.npmjs.com/package/@iasiv5/dsh-quota-watch)
[![License](https://img.shields.io/github/license/iasiv5/dsh-quota-watch?label=License)](./LICENSE)

[English summary](#english-summary) · 中文

在 DSH 中查看 **GLM Coding Plan** 与 **GitHub Copilot** 的服务商额度快照。Quota Watch 不读取 DSH 会话 token；凭据由 DSH 宿主解析，浏览器只接收整理后的额度数据。

![额度概览：悬浮胶囊与额度面板（示例数据）](docs/assets/panel-overview.webp)

## 功能

- **悬浮胶囊与详情面板**：胶囊显示 GLM、Copilot 已用百分比；点击查看额度窗口、重置时间及服务商报告的用量统计。胶囊可拖动，位置会记忆并保持在可视区域内。
- **GLM 详情**：显示今日 tokens、调用次数、额度窗口及分模型用量。额度窗口与今日用量是不同的服务商统计口径。
- **重置卡（仅国内站个人版）**：只读查询与二次确认的手动使用；消费前写前记录，结果不确定或未送达浏览器时持久提醒并锁定，绝不自动重试。
- **Copilot 详情**：显示服务商报告的可用额度、本期已用额度与重置时间；插件不会从已用 credits 推算剩余额度。
- **侧边栏卡片（可选开启，占侧栏 footer 第一槽位）**：由面板底部的显示/隐藏开关控制，默认关闭；悬浮胶囊始终是主要入口。
- **容错与语言适配**：界面跟随 DSH 语言设置。探测失败时保留最后一次成功的快照并标记为过期；缺少服务商凭据时不显示对应额度行。今日用量连续失败超过约 5 分钟时，两个大数与分模型一起降级为不可用，额度窗口照常显示。

## 兼容性与前置要求

| 项目 | 要求或声明 |
|---|---|
| DSH | `>=0.2.0-rc.1`（包元数据声明的最低版本）；`0.2.1-rc.2` 已完成静态源码适配审计（`docs/reports/2026-10-17-dsh-0.2.1-rc.2-compat-audit.md`，含 2026-10-19 复核附记），并已在 DSH Web `0.2.1-rc.2` 实例上运行时实测 |
| Node.js | `>=20` |
| Cordis | peer dependency `^4.0.2` |
| 客户端平台 | 包元数据声明 `web` |

该插件已分别在 DSH Web 与 Desktop profile 上完成人工适配验证；这项运行时验证不由 CI 自动化覆盖。CI 运行 Node 测试、构建和安全检查，不包含 DSH Web / Desktop 运行时矩阵。

## 安装

### DSH 插件市场

在 DSH 的「插件市场」搜索 **Quota Watch** 或「额度」，从市场安装。dsh-m 对 npm 包使用精确版本并校验 integrity；后续更新也可在市场中管理。

### 命令行（Web / Desktop profile）

```sh
dsh plugin --profile web add @iasiv5/dsh-quota-watch
dsh plugin --profile desktop add @iasiv5/dsh-quota-watch
```

Web 与 Desktop profile 均已实测适配。按 DSH 插件管理器提示完成安装与生效；宿主侧 patch 发生变化时，Web 重启 DSH Web，Desktop 退出并重新打开应用，之后刷新页面加载客户端界面。

## 配置

本插件不再包含任何自动用卡配置。宿主首次启动时会一次性把历史版本保存的自动用卡开关**持久覆写为关闭**（即使设置文件不存在也会写入全关覆盖），因此回退到旧版本也不会让旧授权复活；覆写失败仅报告回退风险，新宿主本身没有任何自动消费路径。可配置项仅剩 profile patch 中的 `pollIntervalSec`（默认 60 秒，只读额度轮询节奏；无任何插件路由请求持续 2 个轮询周期时宿主暂停计划轮询——空闲暂停，下一次请求立即恢复，先答缓存、后台补一轮新数据；暂停不算刷新失败、不标记数据过期）。

## 重置卡与手动用卡

> **重置卡是可消耗、不可撤销的订阅权益。** 使用前请确认适用范围、卡种与额度窗口。

仅支持配置为 `zai-coding-cn` 的**国内站个人版**。国际站 `zai` / `zai-coding` 不提供此入口；团队版未验证、不在支持范围内。宿主启动时查询重置卡，此后最多每 10 分钟周期查询一次（只读）；卡种、可用张数与最早到期日随最新快照更新，首次打开尚未取得快照时显示「查询中」。两种卡都无可用时，卡区收成保留分隔线的一行「无可用」；查询失败会如实显示「查询失败」并移除旧的可操作库存。概览底部或详情标题栏的「立即刷新」会同时更新额度和重置卡，不会消费卡。

![GLM 详情：额度窗口、分模型用量与重置卡手动用卡区（示例数据）](docs/assets/panel-glm-detail.webp)

手动用卡流程：选择卡种 → 面板内二次确认（写明卡种、影响窗口与不可撤销提醒）→ 宿主在发出不可撤销 POST **之前**，先把本次尝试持久写入宿主侧单笔记录，写入失败则直接拒绝发卡请求。消费请求串行执行，默认使用同卡种最早到期的卡；确认提交后只能等待结果，不能撤销。5 小时卡重置 5 小时窗口；每周卡同时重置每周与 5 小时窗口。

结果呈现遵循两条不确定性的安全默认：

- **上游结果未知**（超时、非 200、响应无法判定）：界面显示「结果未确认，请核对服务商官方卡数和额度」，并持久锁定下一次手动用卡，直到你在面板中明确点「我已核实」——核实需要宿主重新成功读取国内站计划与卡列表。该提示跨面板关闭、页面刷新与宿主重启。
- **上游结果已知但浏览器未收到**（响应丢失、断连、宿主重启）：宿主保存的已知结果回执会跨重启显示真实结果（已确认成功，或上游明确拒绝），并锁定后续用卡；你点「我已了解结果」确认送达后，插件才清除该回执并解除锁定。
- 插件不会自动重试任何一次消费；浏览器请求断连**不能**断言消费失败。

手动用卡仍须特别留意：国内站重置卡接口未公开且可能变化。使用前请核对智谱 Coding Plan 的适用工具与服务条款；不接受消耗型操作或未公开接口风险时，请勿使用重置卡功能。

## Copilot 与侧边栏界面

![Copilot 详情：服务商报告的可用额度、本期已用与重置时间（示例数据）](docs/assets/panel-copilot-detail.webp)

![侧边栏卡片：GLM 与 Copilot 摘要（示例数据）](docs/assets/sidebar-card.webp)

## 数据、隐私与安全

- **额度是快照，不是会话账本**：GLM 的额度窗口、今日 tokens / 调用次数，以及 Copilot 的额度视图都来自服务商报告；网络或上游处理可能造成延迟。
- **Copilot 额度语义**：插件只采用 GitHub 报告的 `remaining` 与 `percent_remaining`；不会用 `credits_used` 推算余额。组织管理的 seat 可能使用共享计费池，个人额度视图不等于组织剩余余额。
- **凭据与存储**：GLM 的 `llm-pi-ai` `apiKeyEnv` 引用和 Copilot OAuth grant 由 DSH 宿主解析并用于 HTTPS 请求。浏览器只接收归一化额度字段；插件不把 key、OAuth grant 或原始服务商响应写入磁盘，也不保存额度历史。两处已知的宿主侧落盘例外：历史版本自动用卡开关文件仅作为退役覆盖保留（恒为全关）；手动用卡的结果记录只含尝试标识、卡种、时间与状态，不含任何凭据或服务商卡编号。
- **路由保护**：API 路由只接受 loopback 或已配对浏览器的同源请求，并禁用缓存。
- **公开包检查**：npm 包使用显式 `files` allowlist；CI 的 `npm run security:check` 扫描工作树与由 allowlist 推导的候选打包文件，诊断仅报告路径和规则名，不打印匹配值。
- **服务商限制**：Copilot quota endpoint 和 GLM 重置卡接口均不是稳定的公开契约，字段或行为可能变化；无法确认额度含义时，插件会显示不可用，而不会自行推算。

401/403 等授权错误出现时，请在 DSH 中重新授权相应服务商；若某一行标记为过期，显示值是最近一次成功快照，而非当前实时余额。

## English summary

DSH Quota Watch displays provider-reported quota snapshots for GLM Coding Plan and GitHub Copilot in a floating capsule, detail panel, and optional sidebar card that is hidden by default and toggled from the panel. It does not read DSH session tokens or derive Copilot remaining credits from credits used. The declared requirements are DSH `>=0.2.0-rc.1`, Node.js `>=20`, and Cordis peer `^4.0.2`; the package declares a Web client target. Compatibility with DSH `0.2.1-rc.2` has been reviewed by a static source audit (`docs/reports/2026-10-17-dsh-0.2.1-rc.2-compat-audit.md`); runtime verification follows host upgrades. The plugin has been manually verified with both DSH Web and Desktop profiles; CI does not run host-profile integration tests.

Install for a DSH Web or Desktop profile from the DSH plugin marketplace. Both profiles have been manually verified; the CLI install commands are shown above.

**Reset cards are optional, irreversible spending.** They are supported only for domestic `zai-coding-cn` personal plans, and only through an explicitly confirmed manual flow. Automatic card use has been removed: at startup the host durably retires any legacy saved authorization, so rolling back to an older release cannot revive it. The host journals every attempt before the irreversible POST; an ambiguous result (timeout, non-200, lost response) keeps manual use locked until you explicitly verify, and a known outcome that fails to reach the browser persists as a receipt until you acknowledge it — a lost browser request is never reported as a confirmed failure. The upstream reset-card APIs are undocumented and may change.

All screenshots contain synthetic example data.