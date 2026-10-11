# DSH Quota Watch README 与截图刷新实施计划

## 目标

- 为即将发布的 `@iasiv5/dsh-quota-watch` 更新公开 README：中文主体、精简英文摘要，按用户任务组织内容，并保留重置卡不可逆消费的完整安全边界。
- 更新 README 当前引用的 4 张界面图：使用用户提供并确认可公开的合成 overview 截图，重新截取 GLM、Copilot 与侧栏三个状态；统一压缩为 WebP 并沿用现有资产文件名。
- 只改 `README.md` 与 `docs/assets/` 下 4 张图片，不改源码、包版本、市场 registry、发布工作流；不打 tag、不发布。

## 架构快照

- `README.md` 是本包唯一的公开使用文档；`package.json` 的 `files` 白名单已包含 `README.md` 与 `docs/assets`，因此更新后的截图会随 npm 包发布。
- GLM、Copilot 与侧栏截图使用未纳入发布内容的静态客户端预览 fixture 和硬编码合成响应，不连接真实 DSH 服务或读取凭据；overview 截图由用户提供并确认是合成/演示数据。重拍界面可用无头 Chromium 渲染，WebP 转换使用 ffmpeg `libwebp` 编码器。
- README 的 UI 用语以 `GLOSSARY.md` 为准：`provider-reported quota snapshot`、`reset card`、`card redemption`、`automatic card use`、`capsule`、`panel`、`sidebar card`；不称为实时 token 账本，也不声称 edge docking。
- 四张截图中的额度均为用户确认可公开的合成/演示数据：overview 使用用户提供的预览截图；GLM 详情、Copilot 详情与侧栏卡片由静态预览重新截取。各图注明示例数据，不代表真实账号状态。

## 全局约束

- 包声明的要求照原值呈现：Node `>=20`、DSH `>=0.1.7-rc.2`、peer `@deepseek-ai/cordis ^4.0.2`；最低要求与人工验证版本分开，CI 不得表述为 DSH 运行时兼容性测试。
- README 不保留无证据的 `0.2.0-rc.2 verified` 徽章；DSH client 声明的 `platform: web` 如实写明。用户确认插件已在 DSH Web 与 Desktop profile 上完成人工适配验证；同时明确该运行时验证不由 CI 自动化覆盖，不把 package 的 Web client target 与 profile 验证混为一谈。
- 包版本维持 `0.1.24`；不改 `package.json`、`src/**`、`cordis.patch.yml`、`.github/workflows/**` 或 `dsh-m/registry.json`。
- 重置卡内容必须保留：仅国内站个人版；手动消费不可撤销且面板要求二次确认；自动用卡按窗口分别授权、默认关闭；默认阈值 `99.9%`、范围 `50–99.9%`；只依据新鲜额度数据；默认轮询不能保证不断流；不明确的 POST 结果可能已扣卡，核实前不要重试；上游接口未公开且可能变化。
- 精确版本锁定与 integrity 校验可保留；market 镜像同步延迟不作无依据保证。
- 执行环境使用 Bash、Node.js `>=20`、Playwright Core、Chromium 与 ffmpeg；不安装依赖，不启动替代 DSH 服务，不使用真实账号数据。

## 输入工件

- 用户在本会话确认的设计：中文优先、英文简述；Web/Desktop profile 均已人工验证；配置章节仅列自动用卡两个开关；侧边栏卡片由独立开关控制且默认关闭；README 当前图片全部可以重截为 WebP。
- `README.md`、`package.json`、`cordis.patch.yml`、`src/host.mjs`、`src/client.mjs`、`src/core/reset.mjs`、`src/client/prefs.mjs`、`GLOSSARY.md`。
- 用户提供的合成 overview 截图；一份未纳入版本库的 UI 预览 fixture；`docs/assets/` 下的既有图片。
- dsh-m 对精确 npm 版本与 integrity 的说明；只用它确认市场安装表述，不改市场仓库。

## 文件结构与职责

- Modify: `README.md` —— 简化首页说明、修正兼容与安全措辞、重排安装/配置/截图/数据限制，并更新图片 alt 与示例数据说明。
- Modify: `docs/assets/panel-overview.webp` —— 将用户提供的合成 overview 截图转为优化后的 WebP。
- Modify: `docs/assets/panel-glm-detail.webp` —— GLM 窗口、模型用量、重置卡与展开的自动用卡设置状态；图注指出展开开关仅显示设置，两个每窗口授权均关闭。
- Modify: `docs/assets/panel-copilot-detail.webp` —— Copilot 可用额度、已用额度与重置时间。
- Modify: `docs/assets/sidebar-card.webp` —— 合成 DSH sidebar footer 中的 Quota Watch 卡片。
- 临时工件（不提交）： 一次性截图 runner、自包含预览页和 GLM、Copilot、侧栏三张 PNG 中间图保存在仓库外临时目录；复核后删除，不纳入提交。
- 临时工件（不提交）：用户提供的合成 overview PNG 用作输入，不写入 Git；其余 3 张中间 PNG 由 runner 生成，复核后删除。
- No changes: `package.json`、`lib/client.js`、源代码、测试、市场 registry、发布配置或 npm 版本。

## 任务清单

### Task 1: 安全准备 overview 源图并截取三个 UI 状态

- 目标：保留用户提供并确认可公开的 synthetic overview 截图；从静态合成预览生成 GLM 详情、Copilot 详情与侧栏卡片三张 PNG，供 WebP 转换和复核。
- 涉及文件：输入 `本地合成预览 fixture`；临时的一次性截图 runner；输出 `$capture_dir/{panel-glm-detail,panel-copilot-detail,sidebar-card}.png`。
- 接口契约：
  - Consumes: 预览中的 `QuotaWatchPR.mountQuotaCard`、固定 `fetchImpl` 合成响应、选择器 `[data-dsh-quota-watch-float]`、`[data-action="back-to-overview"]`、`[data-dsh-quota-watch-row="copilot"]`、`[data-action="toggle-card"]`。
  - Produces: 3 张 PNG；与用户提供的 overview PNG 一并组成 4 张图。`panel-overview` 为胶囊 + 概览；`panel-glm-detail` 为 GLM 详情和重置卡设置展开态，两个 per-window 授权均 off；`panel-copilot-detail` 为 Copilot 详情；`sidebar-card` 在 mock `.sidebarCol > .footArea` 中显示卡片。
- 验证范围：页面标题到 `READY`；四种状态文字/卡片均存在；无外部网络请求；截图裁切只保留控件和约 12 px 留白；不含真实 key、OAuth grant、账号标识或真实额度。

- [x] Step 1: 在仓库外创建一次性 runner。runner 以 `esbuild.build({ entryPoints: ['src/client.mjs'], bundle: true, platform: 'browser', format: 'iife', globalName: 'QuotaWatchPR', target: 'es2022', write: false, minify: false })` 从当前源码生成内存 bundle；mock `fetchImpl` 直接使用 `本地合成预览 fixture` 中的固定响应 JSON，不发网络请求；复制其中的 `<html lang="zh-CN">`、主题变量与背景样式，runner 在首轮 mock 数据到达且可见控件断言通过后设置 `document.title = 'READY'`。runner 写出 `base-preview.html` 与 `sidebar-preview.html` 到临时目录；Playwright 通过 `file://` 导航打开（不用 `page.setContent`，opaque `about:blank` 会拒绝 localStorage）；每页导航前清空临时浏览器 context 的 localStorage，避免 auto-open 与卡片显隐状态跨截图继承。两个页面 viewport 固定 `860×920`；sidebar preview 在 mount 前注入 `.sidebarCol > .footArea`。先等待首个 mock 快照，再点 `[data-dsh-quota-watch-capsule]` 打开面板、点 GLM 行进入详情并点 `.dqw-auto-master input` 展开设置，截 GLM 图；从该详情点 `[data-action="back-to-overview"]` 返回概览；返回概览后点 `[data-dsh-quota-watch-row="copilot"]` 截 Copilot 图。侧栏图另生成 `$capture_dir/sidebar-preview.html`：将 `.sidebarCol > .footArea` 与 mock 菜单注入预览 HTML 的 `<body>` 开头，写成临时 `file://` 文档后再导航，确保 mount 时能发现 sidebar；打开面板后先点 `[data-action="back-to-overview"]`（自动用卡设置详情没有底部动作），再点 `[data-action="toggle-card"]` 让 mock 卡片显现后截侧栏卡片，不用 `page.setContent`（opaque `about:blank` 会阻止 localStorage）。三张重拍图均按可见 surface bounding box + 12 px 留白裁切，写入 `$capture_dir/`。
- 执行记录：截图由一次性 runner 完成；runner 未纳入 GitHub 提交。
- Expected: 退出码 0，恰有 3 张非空 PNG；三个 runner 截图状态通过内容/可见性断言，overview 源图为用户确认的合成数据；标题为 `READY`；浏览器控制台无未捕获错误；无真实账号值或外部网络请求。runner 和 PNG 都不写入仓库。
- [x] Step 2: 用 `read_image` 检查用户提供的 overview 源图及 3 张 runner 截图。
- Expected: 四图文字清楚、构图一致、边缘无裁切；GLM 图明确显示自动设置虽展开但两个授权开关仍关闭；mock 时间/额度标为示例，不冒充真实快照。

### Task 2: 将四张截图替换为优化后的 WebP

- 目标：将用户提供的 overview PNG 和 Task 1 捕获的三张界面图统一转换为 WebP，替换现有四个 README 资产，保持引用路径稳定。
- 涉及文件：仅 `docs/assets/panel-overview.webp`、`panel-glm-detail.webp`、`panel-copilot-detail.webp`、`sidebar-card.webp`；临时 PNG 来自 Task 1。
- 接口契约：
  - Consumes: Task 1 的 3 张 runner PNG，以及用户提供的 overview PNG（统一临时命名为 `panel-overview.png`）。
  - Produces: 同名 4 张 WebP；README 中的相对路径无需改名。
- 验证范围：每张输出为可读 WebP，边缘无裁切，四张合计不超过 150 KiB；超限时降低编码质量或缩小留白区域，仍以文字可读为门槛。

- [x] Step 1: 先记录现有 4 张资产大小；将用户提供的 overview PNG 复制到临时 capture 目录并命名为 `panel-overview.png`，再转换它与三张 runner PNG。
- Run（工作目录：仓库根目录）：
  ```bash
  wc -c docs/assets/panel-overview.webp docs/assets/panel-glm-detail.webp docs/assets/panel-copilot-detail.webp docs/assets/sidebar-card.webp
  for name in panel-overview panel-glm-detail panel-copilot-detail sidebar-card; do
    ffmpeg -hide_banner -loglevel error -y \
      -i "$capture_dir/${name}.png" \
      -frames:v 1 -c:v libwebp -quality 82 \
      "docs/assets/${name}.webp"
  done
  ```
- Expected: 4 个目标路径均为非空 WebP 文件；没有新增依赖或改动其他资产。
- [x] Step 2: 复核格式、尺寸、总大小和视觉可读性。
- Run: `wc -c docs/assets/panel-overview.webp docs/assets/panel-glm-detail.webp docs/assets/panel-copilot-detail.webp docs/assets/sidebar-card.webp`
- Expected: 总字节数不超过 150 KiB；用 `read_image` 打开四图均正常，文字清楚。若在质量 82 下超过上限，先重调 crop/分辨率与 `-quality`，不得以不可读文本换取体积。

### Task 3: 按用户旅程重写 README

- 目标：保留可信的功能与风险信息，删除阻碍扫描的实现史/像素细节，让读者先找到用途、安装、要求和危险操作边界。
- 涉及文件：仅 `README.md`。
- 接口契约：
  - Consumes: Task 2 的 4 个稳定资产路径；包声明与 source-backed 行为事实；GLOSSARY 术语；用户确认的中文优先与英文摘要策略。
  - Produces: README 结构包含简短首页、安装与前置要求、用户可见功能、配置表、单独的重置卡与自动用卡安全章节、数据语义/隐私/限制、精简 English summary；删除旧 DSH `verified` 徽章，增加声明兼容要求的表格和真实兼容章节，不留下死链接。
- 验证范围：README 每项行为与包/代码一致；所有图片链接落到 Task 2 的 WebP；英文摘要不与中文风险说明矛盾。

- [x] Step 1: 改写首页、徽章与安装/兼容性信息。
- Change: 标题改为 DSH Quota Watch 通用产品名；删除 `0.2.0-rc.2 verified` 固定徽章；加入 `## 兼容性与前置要求`，列 Node `>=20`、Cordis `^4.0.2`、DSH 最低 `>=0.1.7-rc.2` 与包声明的 Web client target，并明确 Web/Desktop profile 均已人工验证但不属于 CI 运行时矩阵；市场 npm 精确版本/integrity 文案按 dsh-m 已确认事实保留；安装列出 Web 与 Desktop CLI 命令及各自重启要求，不保留未经验证的镜像及时同步承诺。
- [x] Step 2: 重排功能、配置、截图和重置卡风险说明。
- Change: 将用户可见行为压缩为易扫读要点；“配置”章节仅说明 GLM 详情中两个独立自动用卡开关且默认关闭，不写 Cordis row 或字段；侧边栏卡片注明可选开启、由面板底部开关控制、默认关闭并占 footer 第一槽位；保留国内个人版限制、手动确认不可撤销、两个授权默认关闭并持久化于宿主、设置损坏时 fail-closed、`99.9%` 默认触发阈值、周卡同时重置 5 小时、快照过期不消费、轮询不保证不断流、未知 POST 结果可能已扣卡等警示；标注截图为合成示例数据。
- [x] Step 3: 精简数据/隐私/英文摘要并校正实现细节。
- Change: 用“额度快照”表达非实时 provider observation；保留 Copilot remaining 不从 credits used 推算、组织共享计费限制、凭据只在宿主解析、浏览器只接收规范化字段、不保存额度历史；把冷启动写成 5 秒起步、封顶指数退避且不承诺总在数秒出现；把 `security:check` 写成扫描工作树与 allowlist 推导的候选包文件，不称扫描实际 tarball；删除 CSS/rAF、历史版本修复过程和维护者发版机制长段；English summary 只保留用途、安装/要求及 reset-card 核心风险。
- [x] Step 4: 检查文档结构与差异。
- Run: `git diff --check`
- Expected: 无空白错误；改动仅涉及 README、计划文件与 Task 2 的 4 张 WebP；所有图片路径、alt/caption 与新资产一致；兼容章节标题存在且无死锚点。

### Task 4: 执行发布前文档与包验证

- 目标：确认 README、资产和 npm 包内容可发布，但不执行发布。
- 涉及文件：读取整个 `dsh-quota-watch` 仓库；不改包版本或发布配置。
- 接口契约：
  - Consumes: Task 2 的 4 个 WebP 与 Task 3 的 README。
  - Produces: 全量测试/构建/安全扫描/打包 dry-run 结果，最终允许的 Git diff 文件清单。
- 验证范围：README 图链都存在；npm dry-run 包含 README 与 4 张 WebP；构建产物没有意外变化；无源码、依赖、版本、registry、tag 或发布改动。

- [x] Step 1: 在仓库根运行单测、构建、安全检查。
- Run: `npm test && npm run build && npm run security:check`
- Expected: 三条全通过；若 `lib/client.js` 因构建产生差异，检查后不得把该代码产物纳入本次文档变更。
- [x] Step 2: 检查 npm 包清单但不发布。
- Run: `npm pack --dry-run --json`
- Expected: 命令成功；输出清单包含 `README.md` 与 `docs/assets/` 下 4 张 WebP；没有执行 `npm publish`。
- [x] Step 3: 收口差异与状态。
- Run: `git diff --check && git status --short && git diff --stat`
- Expected: 只有本计划、`README.md` 和 4 张目标 WebP 有变化；`package.json`、源码、测试、工作流、市场 registry 与版本号不变；无 tag/push/publish。

## 执行纪律

- 开始实现前先复核此计划和当前 main 状态；若文件布局、截图源或声明事实与计划不符，停止并先更新计划。
- 用户已要求仓库只保留 `main`；不创建额外 Git 分支，不提交、不 push、不发版。
- 每个任务完成后运行该任务规定的验证；每次 screenshot 只用静态合成数据，绝不登录真实账号或读取宿主凭据。
- 如 Chromium 状态切换失败、sidebar mock 与当前 mount contract 不符、截图体积与可读性无法同时达标，停止并向用户报告具体失败，不伪造结果。
- 计划经用户审阅批准前，不修改 README 或 `docs/assets`。

## 最终验证

- `npm test`、`npm run build`、`npm run security:check`、`npm pack --dry-run --json` 与 `git diff --check` 全通过。
- 4 张 WebP 每张可用 `read_image` 正常读取、图注明确为示例数据、合计不超过 150 KiB。
- `git status --short` 仅显示计划、README、4 张 WebP；包版本仍 `0.1.24`；无源代码/配置/发布操作。

## 审阅 Checkpoint

- 状态：README 与截图刷新已按计划完成，文档任务的基线版本为 `0.1.24`。
- 后续 release：版本号更新与 OIDC 发版独立于本文记录的文档范围。