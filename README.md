# DSH Quota Watch

[English summary](#english-summary)

个人版 DSH Web 侧栏配额监控插件，集中显示 GLM Coding Plan 窗口与 GitHub Copilot 的 GitHub 返回额度快照。它不统计 DSH 会话 token、不保存历史，也不需要在浏览器输入任何 provider 密钥。

## 功能

- 在侧栏 Settings 行上方显示一个可折叠卡片；没有单独的设置分区。
- GLM Coding Plan：展示套餐名、5 小时 / 每周 / 每月窗口、已用百分比、进度条和重置时间；兼容 Token / Credit 套餐，忽略 MCP `TIME_LIMIT`。
- GitHub Copilot：读取 `premium_interactions` quota snapshot；只有 GitHub 返回有限、有效的 `remaining` 时才显示可用额度和百分比。若余额字段无效或账号被标记为 unlimited，则显示“余额暂不可用”；`credits_used` 如存在会单独标为已用量，绝不用于推算余额。
- 宿主默认每 60 秒探测；profile patch 可将 `pollIntervalSec` 设置在 30–3600 秒。浏览器页签可见时每 30 秒刷新视图，隐藏时暂停；刷新按钮可立即请求宿主探测。
- 探测失败时保留最后一次成功数据并标记可能过期；缺少凭据时显示未配置状态。

## 兼容与配置

- 要求 DSH `0.1.7-rc.2` 或更高。
- GLM 从 `llm-pi-ai` profile 中配置的 provider `apiKeyEnv` credential reference 解析当前 key。支持 `zai-coding-cn`（国内）与 `zai` / `zai-coding`（国际）路由。每次探测都重新解析引用，用户轮换凭据后下一轮读取新值。
- Copilot 使用内置 `llm-pi-ai/github-copilot` OAuth grant 的 `payload.refresh` 访问用户配额快照；不使用给模型请求的短期 `payload.access`，不使用 `COPILOT_GITHUB_TOKEN` 环境引用。每轮重新读取 grant，以支持用户重新授权或轮换。
- 如需修改宿主周期，在 profile 的 `quota-watch` row 配置 `pollIntervalSec`；禁用插件请使用 DSH 插件管理器。

## 数据来源与语义

- GLM 查询 `https://open.bigmodel.cn/api/monitor/usage/quota/limit` 或 `https://api.z.ai/api/monitor/usage/quota/limit`。该接口按 raw API key 鉴权，不加 Bearer 前缀。
- Copilot 查询 `https://api.github.com/copilot_internal/user`。这是 GitHub Copilot 内部、非公开稳定契约的端点，字段可能变更；插件在无法确认额度含义时显示不可用，不猜测或计算余额。
- 对企业 / 组织管理的 Copilot seat，GitHub AI Credits 可能属于共享计费池。侧栏呈现的是 GitHub 用户 quota snapshot 中的可用额度，不保证等同组织账单的总余额。
- 凭据只在 DSH 宿主进程解析并用于 HTTPS 请求；浏览器只接收规范化后的额度字段。插件不把 key、OAuth grant 或原始 provider 响应写入磁盘，也不保存额度历史。

## 安全

- API 路由只允许 loopback 或已配对的浏览器访问；响应禁用缓存。
- 本仓库、测试 fixtures 与 npm 包不得包含任何真实 key、OAuth grant、临时 token、原始账号响应或个人余额。测试仅使用合成响应。
- npm 包采用显式 `files` 白名单；`npm run security:check` 会扫描工作树和实际 pack 文件，诊断只报告路径和规则名，不打印匹配值。
- 首次 bootstrap 发布真实插件 `0.0.1` 后配置 npm Trusted Publishing；后续 tag release 使用 GitHub Actions OIDC 与 provenance，不保存长期 npm token。

## 安装

安装到 `web` profile：

```sh
dsh plugin --profile web add @iasiv5/dsh-quota-watch
```

插件管理器会应用包内 `cordis.patch.yml`。宿主半区的插件变更需要重启 `dsh web` 后生效；客户端 bundle 随插件加载。禁用插件请使用 DSH 插件管理器。默认探测周期为 60 秒；需要调整时，在 profile 的 `quota-watch` Cordis row 设置 `config.pollIntervalSec`（30–3600）。

## English summary

DSH Quota Watch is a personal DSH Web sidebar card for GLM Coding Plan windows and GitHub Copilot's provider-reported quota snapshot. It resolves credentials on every host-side probe, sends only normalized values to the browser, keeps no usage history, and never infers a Copilot balance from credits used. The Copilot endpoint is undocumented and may change; invalid or unlimited quota snapshots are shown as unavailable rather than guessed.
