# DSH Quota Watch 实施计划

## 目标

- 构建公开 npm 包 `@iasiv5/dsh-quota-watch`，适配 DSH `0.1.7-rc.2` 或更高版本。
- 只在侧边栏显示 GLM Coding Plan 的套餐窗口和 GitHub Copilot 的可用额度；不创建一级设置页、不实现会话 token 台账或历史图表。
- 每轮探测都从 DSH 当前凭据服务重新解析凭据；不在客户端、配置文件、持久化快照、日志、测试样例或发布制品中保存密钥。
- 在用户创建的公开仓库 `https://github.com/iasiv5/dsh-quota-watch` 准备可运行的正式插件内容；通过真实 `0.0.1` 首次 bootstrap 发布后，配置 npm Trusted Publishing，供后续 tag 发布使用。

## 架构快照

宿主半区按配置周期探测 GLM 与 Copilot，保留本进程内的最新成功快照及独立错误状态，并仅通过 loopback / 已配对请求可访问的同源 JSON 路由向浏览器提供脱敏视图。GLM 从 `llm-pi-ai` profile 的 `apiKeyEnv` 引用解析当前 API key；Copilot 从 `llm-pi-ai/github-copilot` grant 的 `payload.refresh` 读取 GitHub OAuth token，再调用 `https://api.github.com/copilot_internal/user`。两者均在每轮探测时重新读取，不缓存凭据。

浏览器半区只挂载一个可折叠侧栏卡片：展开时展示完整信息，侧栏可见时约每 30 秒拉取快照，隐藏时暂停；单独的刷新按钮触发宿主立即探测。GLM 展示沿用 `dsh-usage` 套餐卡口径：计划名称、窗口名、已用百分比、进度条与重置时间。Copilot 只展示接口报告的有效 `premium_interactions.remaining`；不从 `credits_used` 计算余额，不把组织共享账单池称为个人账单余额。

## 全局约束

- 包名固定为 `@iasiv5/dsh-quota-watch`；仓库为 `iasiv5/dsh-quota-watch`；host 插件行 id 为 `quota-watch`。
- DSH 最低版本：`>=0.1.7-rc.2`。Node.js engine 设为 `>=20`；宿主实际运行版本由 DSH 要求保证。
- 使用 GitHub Copilot OAuth grant 的 `payload.refresh` 调用 `/copilot_internal/user`；不得使用 `payload.access` 或 `COPILOT_GITHUB_TOKEN` 环境引用作为该配额 API 凭据。每次 poll 都调用 `readRecord` / `credentials.resolve` 获取当前记录，以支持用户重登录或轮换。
- GLM 只通过 `apiKeyEnv` credential reference 解析 API key；不得读取或传输 profile 中的 literal `apiKey` 字段。
- Copilot 的内部端点未公开稳定 schema。仅当 `premium_interactions.unlimited === false`、`entitlement` 为正有限数且 `remaining` 为有限非负数时，把直接返回的 `remaining` 作为“GitHub 返回的可用额度”；可另列 `credits_used`，但不作余额推算。无限额、零 entitlement、字段缺失或解析失败时显示额度不可用，不显示伪余额。
- 同时容忍 `token_based_billing` 位于响应根部或 quota snapshot 内；使用 `quota_reset_date` / `quota_reset_date_utc` 中实际存在且有效的重置时间。只读 `premium_interactions`，不把 `chat` / `completions` 当作 AI Credits。
- GLM 适配 `zai-coding-cn`（`open.bigmodel.cn`）和 `zai` / `zai-coding`（`api.z.ai`）；按 `unit` 识别 5 小时、每周、每月窗口，兼容 `TOKENS_LIMIT` / `CREDIT_LIMIT`，跳过 `TIME_LIMIT`。鉴权使用原始 key，不加 Bearer。
- 默认宿主探测周期 60 秒，可在 profile patch 将 `pollIntervalSec` 调至 30–3600 秒；浏览器刷新周期 30 秒并受页面可见性控制。
- 缺凭据时保留 provider 行并显示“未配置”；刷新失败时保留最后成功值并明确标为错误/过期。快照仅驻留内存，不持久化历史。
- API 响应使用白名单字段；所有 provider fetch 设置超时并请求 identity encoding；host 路由保护个人数据并使用 `cache-control: no-store`。
- 开发期间不安装到当前 DSH profile、不改 profile 依赖、不重启或打扰正在运行的 DSH 服务。浏览器验证使用隔离 DOM 测试与 bundle 检查。
- 敏感信息门禁：GitHub push 前扫描全部待提交文件与完整 Git commit author/committer metadata；提交身份必须使用 GitHub noreply 地址。npm publish 前检查 `npm pack` 文件清单并扫描实际包内容。发现疑似 secret 时只报告文件路径与规则名，不打印匹配值。`.npmrc`、`.credentials.yaml`、`.env`、备份/日志、原始 API 响应与真实余额都不得进入 Git 或 npm tarball。
- CI 与 publish workflow 固定 npm CLI `12.1.0`；security scanner 同时解析 npm 11 数组式和 npm 12 keyed-object 式 `npm pack --json` 清单。
- 按用户选定的方案 2 保留已发布的 `0.0.1`；后续版本经 GitHub Actions OIDC 发布，版本 publisher 身份为 GitHub Actions。OIDC 不改写 `0.0.1` 或 Registry 级 maintainer metadata。
- 发布顺序：先将完整可用项目以 `0.0.1` 人工 bootstrap；包建立后配置 npm Trusted Publishing；后续使用 GitHub Actions tag workflow 发布并带 provenance。初次发布不是空壳占位包；仓库内不得存静态 npm token。
- 许可证暂按 MIT（与现有 `@inventec/dsh-copilot-auth` 一致）；不逐字复制 `dsh-usage` 的实现代码，仅实现兼容的数据契约与行为。

## 输入工件

- [领域词汇表](../../CONTEXT.md)
- 用户已确认的范围：个人使用、仅侧栏卡片、GLM 窗口遵循现有 `dsh-usage` 显示、60 秒宿主 / 30 秒可见浏览器刷新、无 PAT 路线、公开 npm 包及 bootstrap → OIDC 发布流程。
- [dsh-usage GLM adapter](../../../.dsh-research/dsh-web/packages/dsh-usage/src/core/adapters.ts) 与 [dsh-usage PlanCard](../../../.dsh-research/dsh-web/packages/dsh-usage/src/client/UsageSectionCard.tsx)：只作行为参考，不复制实现代码。
- [dsh-copilot-auth package pattern](../../../dsh-copilot-auth/package.json) 与 [client build wrapper](../../../dsh-copilot-auth/scripts/build-client.mjs)：独立 DSH 插件包与 browser module wrapper 的本机可运行范式。
- GitHub REST API AI Credits usage / metric 文档与 `copilot_internal/user` 的公开样例；后者只作非稳定 schema 证据。

## 文件结构与职责

- Create: `package.json` — npm 元数据、DSH host/client manifest、build/test/pack scripts、`files` 白名单与 engine 范围。
- Create: `package-lock.json` — 固定 build/test tooling 依赖，支持 CI `npm ci`。
- Create: `cordis.patch.yml` — 只插入 `quota-watch` host entry，并提供默认 `pollIntervalSec: 60`；不挂载设置页。
- Create: `.gitignore` — 忽略 `node_modules/`、包级 `.npmrc`、临时测试产物；不忽略发布所需的生成 client bundle。
- Create: `src/shared.mjs` — host/client 共用 API 路径与稳定 wire-field 名称。
- Create: `src/core/adapters.mjs` — 纯 GLM / Copilot request builder 与宽容但严格的响应解析器；不得读取文件或全局凭据。
- Create: `src/host.mjs` — Cordis host plugin；按 poll 周期动态解析凭据、串行探测、保留最后成功视图、注册 overview / refresh routes、执行 loopback / paired-access 与 same-origin 检查。
- Create: `src/client.mjs` — 无持久 credential 的 browser plugin；安装可自愈侧栏卡、可见性轮询、手动刷新、折叠状态与错误/无凭据显示。
- Create: `scripts/build-client.mjs` — 用 esbuild 将 client entry 编译成 DSH `window.__ModuleLoader__.load(...)` 工厂 wrapper。
- Create: `lib/client.js` — 由 build script 生成并提交的 client 产物。
- Create: `tests/fixtures/glm-plan-response.json`、`tests/fixtures/copilot-user-response.json` — 完全合成的 provider 样例，不包含本机响应或账号数值。
- Create: `scripts/check-public-package.mjs` — 检查 Git staged 文件、敏感文件名与 npm pack 内容；命中只打印路径和规则名，不打印 secret 值。
- Create: `tests/security-scan.test.mjs` — 用合成 secret markers 验证扫描器命中、脱敏诊断与敏感文件路径拒绝。
- Create: `tests/package-shape.test.mjs` — package manifest、Cordis patch、测试/构建脚本、CI/OIDC workflow 元数据检查。
- Create: `tests/adapters.test.mjs` — GLM 窗口分类、积分/Token 百分比、Copilot 有效/占位额度解析测试。
- Create: `tests/credentials.test.mjs` — grant/API key 动态重新读取、正确字段选择、轮换后下一 poll 采用新值的 mock 测试。
- Create: `tests/host.test.mjs` — poll 单飞、超时/失败保留 last-good、路由授权与 wire 白名单测试。
- Create: `tests/client.test.mjs` — 卡片 view model、展开/折叠、错误/无凭据状态、隐藏页暂停轮询的 DOM 测试。
- Create: `README.md` — 中文优先、附英文摘要；安装、配置、数据来源、凭据轮换、非官方 Copilot endpoint 限制与 OIDC 流程。
- Create: `LICENSE` — MIT。
- Create: `.github/workflows/ci.yml` — push/PR 的 `npm ci`, tests, client build, pack check。
- Create: `.github/workflows/publish.yml` — tag `v*` 触发；`id-token: write`、npm 11+、`npm publish --provenance --access public`。
- Local-only: `docs/plans/2026-09-28-dsh-quota-watch-implementation-plan.md` — 本计划含维护环境命令/路径，由 package `.gitignore` 排除，不推送到公开 GitHub，也不进入 npm tarball。
- Modify: `CONTEXT.md` — 补充“接口报告的 Copilot 剩余额度”与组织共享 billing pool 的术语边界；不加入账户数值。

## 任务清单

### Task 1: 建立独立 DSH/npm 包与 client build 边界

- 目标：建立可被 DSH host/client loader 与 npm pack 识别的 package 骨架。
- 涉及文件：`package.json`、`package-lock.json`、`cordis.patch.yml`、`.gitignore`、`src/shared.mjs`、`src/client.mjs`、`scripts/build-client.mjs`、生成的 `lib/client.js`。
- 接口契约：
  - Consumes: 包名 `@iasiv5/dsh-quota-watch`、host row id `quota-watch`、最低 DSH `>=0.1.7-rc.2`。
  - Produces: `name='quota-watch'` 的 host entry、`name='quota-watch-client'` 的 client module、共享常量 `API_PREFIX='/api/dsh-quota-watch'`、可由 build script 重建的 `lib/client.js`。
- 验证范围：package manifest 可解析、bundle wrapper 的 module id 正确且可通过 Node 语法检查。
- [ ] Step 1: 写 package/manifest/build-wrapper 的最小结构检查。
- Run: `node --test tests/package-shape.test.mjs`
- Expected: 首次测试因 `package.json`、patch 或生成 bundle 不存在而失败。
- [ ] Step 2: 运行并确认失败。
- Run: `node --test tests/package-shape.test.mjs`
- Expected: 至少一个断言明确报告缺少包名、patch id 或 module wrapper。
- [ ] Step 3: 创建 package metadata、host row patch、shared constants 与 esbuild wrapper，并安装测试/构建依赖。
- Change: `package.json` 声明 `dsh.engines.dsh >=0.1.7-rc.2`、`dsh.bundle.patch`、web client entry、`build`/`test`/`prepack`，以及 `@deepseek-ai/cordis` peer、`@deepseek-ai/dsh-credentials@0.1.7-rc.2` runtime dependency 与 `esbuild` / `yaml` / `jsdom` dev dependencies；patch row 默认 `pollIntervalSec: 60`。
- Run: `npm install`
- Expected: 生成 `package-lock.json` 并安装 build/test dependencies。
- [ ] Step 4: 生成并验证 client bundle。
- Run: `npm run build && node --check lib/client.js && node --test tests/package-shape.test.mjs`
- Expected: 所有命令 exit 0，bundle 含正确 module-loader id，metadata 测试全绿。

### Task 2: 实现 GLM 与 Copilot provider adapter

- 目标：以纯函数测试 provider URL、鉴权头和归一化解析，不依赖真实账号。
- 涉及文件：`src/core/adapters.mjs`、`tests/fixtures/glm-plan-response.json`、`tests/fixtures/copilot-user-response.json`、`tests/adapters.test.mjs`。
- 接口契约：
  - Consumes: `src/shared.mjs` 中的 provider route / snapshot wire vocabulary。
  - Produces: `buildGlmProbe({provider, apiKey})`、`parseGlmPlan(status, body)`、`buildCopilotProbe({githubOAuthToken})`、`parseCopilotUser(status, body)`。
  - Copilot parser 返回 `remaining`、`entitlement`、`percentRemaining`、`creditsUsed`、`resetsAt`、`balanceAvailable` 与 provider `updatedAt`；只有有效有限配额才令 `balanceAvailable=true`。绝不从 `entitlement - creditsUsed` 推算。
- 验证范围：provider unit 字段乱序、新增未知 unit、`TOKENS_LIMIT` / `CREDIT_LIMIT`、MCP `TIME_LIMIT`、Copilot unlimited/零 entitlement placeholder、缺失字段、坏时间戳与非 200 响应。
- [ ] Step 1: 添加使用合成 JSON 的 adapter 测试并断言预期契约。
- Run: `node --test tests/adapters.test.mjs`
- Expected: 在 adapter 尚未实现时以缺少 export / mismatch 失败。
- [ ] Step 2: 运行并确认失败。
- Run: `node --test tests/adapters.test.mjs`
- Expected: 失败仅命中待实现 parser / request-builder 行为，不依赖网络。
- [ ] Step 3: 实现 GLM 与 Copilot adapter。
- Change: GLM 按 unit 3/6/5 识别窗口，raw key header，不输出 TIME_LIMIT；Copilot 只读 `premium_interactions`，透传有限的 provider `remaining`，仅作为 GitHub 返回的额度快照。
- [ ] Step 4: 运行测试并验证通过。
- Run: `node --test tests/adapters.test.mjs`
- Expected: 所有合成样例通过；token-billed placeholder 不生成伪余额。

### Task 3: 实现动态凭据解析、host poll 与个人数据路由

- 目标：在 host 侧安全取得 provider 凭据并把最新脱敏快照通过受保护路由提供给 client。
- 涉及文件：`src/host.mjs`、`src/core/adapters.mjs`、`src/shared.mjs`、`tests/credentials.test.mjs`、`tests/host.test.mjs`。
- 接口契约：
  - Consumes: `buildGlmProbe` / `parseGlmPlan` / `buildCopilotProbe` / `parseCopilotUser`。
  - Produces: `GET /api/dsh-quota-watch/overview`、`POST /api/dsh-quota-watch/refresh`，JSON 只包含归一化 quota snapshot、状态、错误与时间戳；响应中不存在 API key、OAuth token、原始 credential record 或完整 provider body。
  - `resolveGlmCredential(provider)` 每轮通过 `settings.describe()` 获取该路由当前 `apiKeyEnv`，再 `credentials.resolve(credentialRef(apiKeyEnv))`；`resolveCopilotOAuthToken()` 每轮重新 `readRecord(credentialKey('llm-pi-ai','github-copilot'))` 并仅取 `payload.refresh`。
- 验证范围：每轮读取、轮换后读到新值、首轮无凭据、请求超时、单飞、防重叠、最后成功快照保留、错误状态、loopback/paired guard、跨源拒绝、无缓存响应头。
- [ ] Step 1: 添加 credential resolver 与 host service 的 mock 测试。
- Run: `node --test tests/credentials.test.mjs tests/host.test.mjs`
- Expected: 在 host resolver/service 尚未实现时失败于预期 exports/behaviors。
- [ ] Step 2: 运行并确认失败。
- Run: `node --test tests/credentials.test.mjs tests/host.test.mjs`
- Expected: 无任何外网请求；错误清楚指向缺少 resolver、poll 或 route contract。
- [ ] Step 3: 实现 host entry、每轮动态 credential resolution、串行 poll 与受保护 exact routes。
- Change: `inject` 仅声明需要的 `webServer`、`settings`、`credentials`；provider `fetch` 使用 10 秒 timeout 与 `accept-encoding: identity`；失败保留内存 last-good，并设置单 provider 错误。
- [ ] Step 4: 运行 host tests。
- Run: `node --test tests/credentials.test.mjs tests/host.test.mjs`
- Expected: 所有测试通过；mock 证明第二轮从变更后的 credential service 读新值；response JSON 不含 mock secret。

### Task 4: 实现侧栏卡片与客户端刷新生命周期

- 目标：只在侧栏显示可折叠 quota card，不注册 `settings.section`。
- 涉及文件：`src/client.mjs`、`src/shared.mjs`、`scripts/build-client.mjs`、`tests/client.test.mjs`、`lib/client.js`。
- 接口契约：
  - Consumes: host overview / refresh routes 与归一化 wire schema。
  - Produces: self-healing sidebar card；展开态展示 GLM plan card 语义与 Copilot GitHub-reported remaining；分开的刷新按钮、折叠按钮、最近更新时间、错误/未配置/余额不可用态。
- 验证范围：文案与 percent formatter、DOM seat 在 sidebar rebuild 后恢复、用户输入/服务响应以 `textContent` 写入、折叠可访问性、仅页面可见时每 30 秒 poll、隐藏页面暂停、卸载时清理 observer/timer/listener。
- [ ] Step 1: 添加纯 view-model / DOM lifecycle 测试。
- Run: `node --test tests/client.test.mjs`
- Expected: 初始失败于缺少 client view model/mount contract。
- [ ] Step 2: 运行并确认失败。
- Run: `node --test tests/client.test.mjs`
- Expected: 失败可复现，不依赖运行中的 DSH 服务。
- [ ] Step 3: 实现客户端卡片与 self-healing mount。
- Change: 默认展开；刷新按钮独立；折叠状态只存本地 UI 偏好，不存 provider data；DOM 写入对 provider 字符串使用 `textContent`。
- [ ] Step 4: 构建并运行客户端测试。
- Run: `npm run build && node --test tests/client.test.mjs && node --check lib/client.js`
- Expected: bundle 生成成功，生命周期测试全部通过，客户端产物可解析。

### Task 5: 完成包文档、质量门与 OIDC workflow

- 目标：让公开包可安装、可审计、可通过 CI 检查并为后续 OIDC 发版做好准备。
- 涉及文件：`README.md`、`LICENSE`、`.gitignore`、`scripts/check-public-package.mjs`、`tests/security-scan.test.mjs`、`.github/workflows/ci.yml`、`.github/workflows/publish.yml`、`package.json`、合成 `tests/fixtures/*`。
- 接口契约：
  - Consumes: 完成的 host/client/adapter exports 与发布包文件清单。
  - Produces: 中文优先文档（含英文摘要）、MIT license、PR CI、tag `v*` 发布 workflow；workflow 只用 GitHub OIDC，不使用长期 npm token。
- 验证范围：文档不含本机密钥/账户快照；YAML 可解析；CI 命令可本地复现；npm tarball 只包含 allowlist 文件。
- [ ] Step 1: 添加 README、license、CI 与 publish workflow 检查。
- Run: `node --test tests/package-shape.test.mjs`
- Expected: 当前缺少文档/workflow 元数据时测试失败。
- [ ] Step 2: 运行并确认失败。
- Run: `node --test tests/package-shape.test.mjs`
- Expected: 失败指出缺少的 package files / OIDC permission / tag trigger。
- [ ] Step 3: 实现文档与 workflow。
- Change: README 说明 GLM endpoint、Copilot 内部 API 的不稳定性、API-reported remaining 的语义、凭据轮换行为、无历史留存、安装/禁用方式；CI 执行 `npm ci`, `npm test`, `npm run build`, `npm run security:check`, `npm pack --dry-run --json`；secret scanner 扫描 staged/worktree 文件及实际 pack 文件清单，诊断不打印匹配值。
- [ ] Step 4: 运行 package-shape tests 与 YAML/pack 检查。
- Run: `npm test && npm run build && npm run security:check && npm pack --dry-run --json`
- Expected: 全绿；扫描器检查 Git worktree 与 npm pack 内容，pack 清单不含 `.npmrc`、node_modules、临时日志、凭据文件、真实响应或个人余额。

### Task 6: 完成最终验证并推送公开仓库

- 目标：提交经过验证的真实插件内容到用户创建的空仓库，为 npm bootstrap 使用同一源码。
- 涉及文件：本计划列出的项目文件；Git remote `https://github.com/iasiv5/dsh-quota-watch`。
- 接口契约：
  - Consumes: Tasks 1–5 的通过结果与本地 `main` 分支。
  - Produces: `main` 分支上可审查的正式包源码与 CI workflow；不包含 npm credentials。
- 验证范围：全部测试、构建、pack dry-run；remote branch 与本地提交一致。
- [ ] Step 1: 运行最终本地验证。
- Run: `npm ci && npm test && npm run build && npm run security:check && node --check lib/client.js && npm pack --dry-run --json`
- Expected: 全部命令 exit 0；scanner 检查 worktree / pack 清单；tarball 只含 package allowlist。
- [ ] Step 2: 初始化本地 `main`，只 stage 明确允许的项目路径并推送。
- Run (from `/home/ubuntu/workspace/dsh-quota-watch`): `git init -b main && git remote add origin https://github.com/iasiv5/dsh-quota-watch && npm run security:check && git add package.json package-lock.json cordis.patch.yml .gitignore CONTEXT.md README.md LICENSE src scripts lib tests .github && git diff --cached --check && npm run security:check && git commit -m "feat: add DSH quota watch plugin" && git push -u origin main`
- Expected: GitHub 接收首个 `main` commit；staged scan 与 pack scan 均通过；`.npmrc`、`node_modules`、凭据文件、真实 API 响应与余额不进入提交。
- [ ] Step 3: 验证 GitHub 状态。
- Run (from project root): `git status --short --branch && git ls-remote --heads origin main`
- Expected: 工作树干净；远端 `main` 指向刚推送的提交。

### Task 7: Bootstrap npm 并配置后续 OIDC 发布

- 目标：发布含真实插件实现的 `0.0.1`，随后建立 npm Trusted Publishing，供后续 tag 自动发布。
- 涉及文件：`package.json`、`.github/workflows/publish.yml`；registry package `@iasiv5/dsh-quota-watch`。
- 接口契约：
  - Consumes: 已推送的 `main`、通过 pack 检查的 npm package、`publish.yml` workflow filename。
  - Produces: registry 上的 `@iasiv5/dsh-quota-watch@0.0.1`、npm trust 配置 `iasiv5/dsh-quota-watch :: publish.yml`、后续 `v*` tag 的 OIDC 发布能力。
- 验证范围：初次发布走 npm web login，不回显 token；发布后 `verify` 显示包可用；`.npmrc` 清理；trust 输出成功；未来 release workflow `id-token: write` 且 publish 使用 provenance。
- [ ] Step 1: 发布前重新查包名。
- Run: `bash /home/ubuntu/.agents/skills/npm-name-claim/scripts/claim.sh check @iasiv5/dsh-quota-watch`
- Expected: Registry 当前仍返回未注册；不进行占位发布。
- [ ] Step 2: 发起 npm web login 并由用户授权。
- Run: `bash /home/ubuntu/.agents/skills/npm-name-claim/scripts/claim.sh weblogin /home/ubuntu/workspace/dsh-quota-watch`（作为后台任务运行；将 `LOGIN_URL` 发给用户）。
- Expected: 用户完成浏览器授权后，包目录生成权限为 0600 的 `.npmrc`；token 不回显。
- [ ] Step 3: 发布真实可用的 `0.0.1`。
- Run: `npm run security:check && bash /home/ubuntu/.agents/skills/npm-name-claim/scripts/claim.sh publish /home/ubuntu/workspace/dsh-quota-watch`（作为后台任务运行；若出现 `AUTH_URL`，转交用户授权）。
- Expected: security scan 通过后才执行发布；出现 `PUBLISHED: @iasiv5/dsh-quota-watch@0.0.1`；Registry 返回包元数据。
- [ ] Step 4: 为已存在的 npm 包配置 GitHub Trusted Publishing。
- Run: `bash /home/ubuntu/.agents/skills/npm-name-claim/scripts/claim.sh trust /home/ubuntu/workspace/dsh-quota-watch --repo iasiv5/dsh-quota-watch --file publish.yml`（作为后台任务运行；如有授权链接，转交用户完成）。
- Expected: 输出 `TRUSTED`，目标是指定 GitHub repo 与 `.github/workflows/publish.yml`；配置过程中保留临时 `.npmrc` 直到验证通过。
- [ ] Step 5: 验证发布与 OIDC trust，再清理临时凭据。
- Run: `bash /home/ubuntu/.agents/skills/npm-name-claim/scripts/claim.sh verify @iasiv5/dsh-quota-watch`，并确认前一步 `claim.sh trust` 返回 `TRUSTED` 后运行 `bash /home/ubuntu/.agents/skills/npm-name-claim/scripts/claim.sh cleanup /home/ubuntu/workspace/dsh-quota-watch`
- Expected: `LIVE` 显示 `0.0.1`；前一步 `TRUSTED` 确认 repo/workflow trust；包目录中不存在 `.npmrc`。

## 执行纪律

- 先由用户审阅本计划；未获批准前不实现、不推送、不登录 npm、不发布、不创建 npm trust。
- 开始实现前再次批判性复查本计划，修正与当前仓库、DSH manifest 或 workflow 现实不符的步骤。
- 按任务顺序执行；每个 Task 运行其定义的验证并检查预期结果，不合并或跳过任务。
- 遇到计划与真实 DSH SDK/API 不符、Copilot 额度字段语义不明或测试失败时，停止并报告证据，不猜测并继续。
- 不安装到正在运行的本机 DSH profile，不重启或干扰 `deepseek-harness.service`。
- 不把真实 Copilot / GLM 响应、余额、OAuth grant、API key、临时 npm token 写入代码、fixture、日志或公开文档。
- GitHub push 与 npm bootstrap/OIDC 只在对应任务的验证门全部通过后进行；npm web authorization 由用户本人完成。

## 最终验证

本机 bootstrap/trust 使用 npm `>=11.10`；GitHub Actions 使用 Node.js `24` 与 npm `12.1.0`。本机最终验证在 Node.js `>=20` 环境运行：

```sh
npm ci
npm test
npm run build
npm run security:check
node --check lib/client.js
npm pack --dry-run --json
```

预期所有检查 exit 0，生成的 npm tarball 只含白名单源码/产物/文档；公开 GitHub 仓库不含凭据；npm 上 `0.0.1` 可安装；OIDC trust 指向正确仓库与 workflow。

本次不进行本机 DSH profile 安装、服务重启或浏览器 live GUI 验证，因为当前运行服务受本机 DSH 运维规则保护；客户端行为由 DOM 测试与 browser bundle 检查覆盖。

## 审阅 Checkpoint

计划已按当前证据采用以下默认值，供用户审阅时一并确认：Copilot 卡片显示符合 validity gate 的 GitHub quota snapshot `remaining`（不是组织账单总余额）；错误时显示额度不可用，`credits_used` 只作为独立已用数；测试通过后推送至目标仓库 `main`；许可证 MIT。若认可，请确认本计划；若有调整，请指出 Q14 额度标签/降级行为、Q15 GitHub push、license 或其他任务的改动。审阅通过前不进入实现。
