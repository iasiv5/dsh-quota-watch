# DSH Quota Watch

[English summary](#english-summary)

个人版 DSH Web 侧栏配额监控插件，集中显示 GLM Coding Plan 窗口与 GitHub Copilot 的 GitHub 返回额度快照。它不统计 DSH 会话 token、不保存历史，也不需要在浏览器输入任何 provider 密钥。

## 功能

- 在侧栏 Settings 行上方显示一张常显摘要卡（无标题、无刷新按钮）：GLM 与 GitHub Copilot 各占一行，统一显示**已用百分比**（Copilot 为 `100 − percent_remaining` 的单值反转），已用超过 80% 进度条转橙、超过 95% 转红；点击行首的 GLM / Copilot 名称立即触发一次宿主探测（等同原刷新按钮），点击行其余区域展开详情。
- GLM 摘要行固定显示 5 小时窗口已用百分比，行尾等宽小字为当日 token 用量；点击行在侧栏右侧弹出详情面板（半透明毛玻璃底，深浅主题均可读，不改变卡片高度）：今日 tokens / 调用次数双大数字、全部窗口单行显示（标签左对齐，右侧为定宽百分比槽 + 弱色「（重置: …）」，上下对齐）、虚线分隔的分模型用量行（名称左对齐、token 数右对齐）。窗口按 5 小时 → 每周 → 每月 → MCP（月）固定排序。同一时间至多展开一个详情；点击面板外或按 Esc 关闭。
- GitHub Copilot 摘要行仅在 GitHub 返回有限、有效的 `remaining` 且带 `percent_remaining` 时显示；行尾等宽小字显示本期 credits 消耗的紧凑值。点击在侧栏右侧弹出精简详情（标签左对齐、数值右对齐的三行）：可用额度、本期已用（含已用百分比）、重置时间。`credits_used` 绝不用于推算余额，缺失有效百分比时该行不渲染。
- 卡片顶部不显示全局更新时间；仅在等待首个快照或刷新失败时显示一行状态文字（读取中 / 刷新失败 / 查询失败）。
- 今日 tokens / 调用次数按宿主本地时区的自然日（`00:00:00 → 当前时刻`）查询；不带滚动窗口语义。
- 凭据缺失的 provider 不渲染摘要行（两者皆缺时整卡隐藏）；探测失败时保留最后一次成功数据并在行上加 ⚠ 过期标记。
- 宿主默认每 60 秒探测（窗口 + 用量 + Copilot）；profile patch 可将 `pollIntervalSec` 设置在 30–3600 秒。浏览器页签可见时每 30 秒刷新视图，隐藏时暂停；点击行首 provider 名称可立即请求宿主探测。

## 兼容与配置

- 要求 DSH `0.1.7-rc.2` 或更高。
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

DSH Quota Watch is a personal DSH Web sidebar card for GLM Coding Plan windows and GitHub Copilot's provider-reported quota snapshot. It resolves credentials on every host-side probe, sends only normalized values to the browser, keeps no usage history, and never infers a Copilot balance from credits used. The Copilot endpoint is undocumented and may change; invalid or unlimited quota snapshots are shown as unavailable rather than guessed.
