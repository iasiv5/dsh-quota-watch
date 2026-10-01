# DSH Quota Watch

[English summary](#english-summary)

个人版 DSH 额度监控插件，以常驻悬浮球集中显示 GLM Coding Plan 窗口与 GitHub Copilot 的 provider 上报额度快照。它不统计 DSH 会话 token、不保存历史，也不需要在浏览器输入任何 provider 密钥。

## 功能

- **悬浮球**：常驻屏幕右下角（距边 16px 起步），可整体拖拽到任意位置，位置跨重启记忆，越界自动钳回视口。球面为分段进度环——GLM 占上半环、Copilot 占下半环，已用超过 80% 转橙、超过 95% 转红，任一 provider 超 95% 时整球轻微脉动（尊重系统「减少动态效果」设置，开启时不脉动）；环心保留配额仪表盘图标，颜色使用 DSH 主题语义变量，自动适配浅色 / 深色主题。悬停提示与 aria-label 实时给出「GLM x% · Copilot y%」摘要。
- **胶囊**：右键悬浮球可切换为一行式胶囊（`GLM 13% · Copilot 24%`），阈值变色规则相同；右键胶囊切回悬浮球。球 / 胶囊形态跨重启记忆。
- **面板**：点击球或胶囊展开浮动详情面板（半透明毛玻璃底，宽 `min(320px, 100vw−24px)`，靠边自动翻侧，滚动 / 缩放跟随），头部带标题与 ✕，Esc 或点击面板外关闭。概览列两个 provider 行，点击进入详情：GLM 为今日 Tokens / 调用次数双大数字 + 五列对齐窗口网格（MCP（月）→ 5 小时 → 每月 → 每周固定排序，周窗口未下发时显示「每周额度 · ♾️（无限）」占位）+ 分模型用量行；Copilot 为可用额度、本期已用（credits 消耗 + 弱化百分比）、重置时间三行。接口未下发有效 `remaining` / `percent_remaining` 时该行不渲染，`credits_used` 绝不用于推算余额。
- **侧边栏卡片（渐进增强）**：Web profile 侧栏底部区块存在时，卡片照常显示（摘要行 + 行点击开面板 + 行首 provider 名称点击立即探测），卡片右上角有一个悬浮球切换按钮（悬停显形），可在卡片上隐藏 / 唤回悬浮球；侧栏收起（Web 窄栏）或侧栏整体不存在（Desktop 收起态）时卡片自然缺席、无报错，由悬浮球承载入口。
- **右键菜单**：切为胶囊 / 切为悬浮球 · 显示 / 隐藏侧边栏卡片 · 立即刷新 · 隐藏悬浮球。菜单项随上下文增减（无侧栏卡片挂载点时不显示卡片项）。「隐藏悬浮球」为**会话级**——刷新页面即恢复，卡片上的切换按钮可在会话内直接唤回，任何时刻都至少有一条找回路径。
- 凭据缺失的 provider 不渲染摘要行、环弧塌缩为零（两者皆缺时悬浮球与卡片一并隐藏）；探测失败时保留最后一次成功数据并在行上加 ⚠ 过期标记（⚠ 只出现在面板与卡片行内，不上球）。
- 宿主默认每 60 秒探测（窗口 + 用量 + Copilot）；profile patch 可将 `pollIntervalSec` 设置在 30–3600 秒。浏览器页签可见时每 30 秒刷新视图，隐藏时暂停。

## 兼容与配置

- 要求 DSH `0.1.7-rc.2` 或更高；适配 `web` 与 `desktop` 两种 profile——Desktop 收起侧栏（整体消失）时由悬浮球承载入口，卡片为 Web 渐进增强。
- GLM 从 `llm-pi-ai` profile 中配置的 provider `apiKeyEnv` credential reference 解析当前 key。支持 `zai-coding-cn`（国内）与 `zai` / `zai-coding`（国际）路由。每次探测都重新解析引用，用户轮换凭据后下一轮读取新值。
- Copilot 使用内置 `llm-pi-ai/github-copilot` OAuth grant 的 `payload.refresh` 访问用户配额快照；不使用给模型请求的短期 `payload.access`，不使用 `COPILOT_GITHUB_TOKEN` 环境引用。每轮重新读取 grant，以支持用户重新授权或轮换。
- 如需修改宿主周期，在 profile 的 `quota-watch` row 配置 `pollIntervalSec`；禁用插件请使用 DSH 插件管理器。

## 数据来源与语义

- GLM 查询 `https://open.bigmodel.cn/api/monitor/usage/quota/limit` 或 `https://api.z.ai/api/monitor/usage/quota/limit`（窗口百分比），以及同域 `/api/monitor/usage/model-usage?startTime=…&endTime=…`（今日 tokens 与调用次数，时间格式 `yyyy-MM-dd HH:mm:ss`）。两个接口均按 raw API key 鉴权，不加 Bearer 前缀。
- Copilot 查询 `https://api.github.com/copilot_internal/user`。这是 GitHub Copilot 内部、非公开稳定契约的端点，字段可能变更；插件在无法确认额度含义时显示不可用，不猜测或计算余额。
- 对企业 / 组织管理的 Copilot seat，GitHub AI Credits 可能属于共享计费池。侧栏呈现的是 GitHub 用户 quota snapshot 中的可用额度，不保证等同组织账单的总余额。
- 凭据只在 DSH 宿主进程解析并用于 HTTPS 请求；浏览器只接收规范化后的额度字段。插件不把 key、OAuth grant 或原始 provider 响应写入磁盘，也不保存额度历史。

## 安全

- API 路由只允许 loopback 或已配对的浏览器访问；响应禁用缓存。
- 本仓库、测试 fixtures 与 npm 包不得包含任何真实 key、OAuth grant、临时 token、原始账号响应或个人余额。测试仅使用合成响应。
- npm 包采用显式 `files` 白名单；`npm run security:check` 会扫描工作树和实际 pack 文件，诊断只报告路径和规则名，不打印匹配值。
- 首次 bootstrap 发布真实插件 `0.0.1` 使用 npm web-login；后续 tag release 使用 GitHub Actions OIDC 与 provenance，版本发布者身份为 GitHub Actions，不保存长期 npm token。
- OIDC 不会改写已发布的 `0.0.1` 元数据，也不负责移除 Registry 级 maintainer 字段；源码和 npm tarball 不写入发布账号邮箱。

## 安装

安装到 `web` profile：

```sh
dsh plugin --profile web add @iasiv5/dsh-quota-watch
```

插件管理器会应用包内 `cordis.patch.yml`。宿主半区的插件变更需要重启 `dsh web` 后生效；客户端 bundle 随插件加载。禁用插件请使用 DSH 插件管理器。默认探测周期为 60 秒；需要调整时，在 profile 的 `quota-watch` Cordis row 设置 `config.pollIntervalSec`（30–3600）。

## English summary

DSH Quota Watch is a personal DSH quota monitor built around a persistent floating ball: a segmented dual-arc ring (GLM top half, Copilot bottom half) that turns amber past 80% and red past 95%, draggable anywhere with position remembered across restarts. Right-click toggles a compact capsule showing `GLM x% · Copilot y%`; clicking the ball or capsule opens a floating glass panel with provider summaries and details, closable via ✕, Esc or an outside click. A sidebar card remains an opportunistic extra entry on web profiles (with a corner button to hide or restore the ball) and silently disappears whenever the sidebar does — collapsed web sidebars and the desktop profile are covered by the floating ball alone. A right-click menu offers mode switch, card visibility, an immediate provider re-probe and a session-scoped ball hide. Credentials are resolved on every host-side probe, only normalized values reach the browser, no usage history is kept, and a Copilot balance is never inferred from credits used. Colors ride DSH semantic theme tokens with hardcoded fallbacks; all UI lives inside a shadow root (ADR 0001).
