# AGENTS.md — dsh-quota-watch

DSH 侧栏插件（GLM Coding Plan + GitHub Copilot 额度监视胶囊）。host+client 双侧（`src/host.mjs` 路由 + `src/client.mjs` 界面）；运行时零 npm 依赖；devDeps：jsdom。

## 每轮生效

- clone 后一次性：`git config core.hooksPath .githooks`（pre-push：全套 `npm test` + 产物新鲜度门禁，红灯不得落进远端历史）。
- build/test 前：`test -d node_modules`，缺失先 `npm ci`。测试直测 `src/`，跑测试不需要 build。
- 改 `src/client.mjs` / `src/client/*.mjs` 后必跑 `npm run build` 且 **`lib/client.js` 随源码同笔提交**——CI（ci.yml verify job）会重建后 `git diff --exit-code lib/client.js`，stale 产物直接红（2026-11-12 实录：v0.1.39 首发 tag 因 stale lib CI 红，npm 侧无恙）。

## 发版链

bump（package.json + `src/client/embed.mjs` 的 `EMBED_GUEST_VERSION` + **package-lock 根字段两处**，三处锁步由 `tests/package-shape.test.mjs` 持有）→ build → `chore(release)` → tag `v*` push → Publish workflow（OIDC，CI 现建后发布）→ `../../01_docs/dsh-intall-know-how/tools/release-monitor.sh iasiv5/dsh-quota-watch <tag> @iasiv5/dsh-quota-watch <版本> publish.yml`。

- Publish workflow 自己会 `npm run build`——npm tarball 总是 CI 现建；仓库侧 lib 新鲜度由 verify 门禁与 pre-push 钩子保证，两者都不红才能推。
- 本仓双 workflow（CI + Publish，同由 push 触发）：release-monitor 第 5 参必须传 `publish.yml`，否则会抓到 CI 的 run 误判发版失败（2026-11-12 实录）。

## 仓库事实（易踩）

- `grep -c` 计 0 即 exit 1，禁入 `&&` 链；产物/版本核证以 npmjs 直查与 tarball 内容为准（dist-tags 有 processing 延迟，见 know-how 018）。
- 协议文档（CEP v1）在姊妹仓：`../dsh-stock-kanban/docs/interop/capsule-embed-protocol.md`；本仓 `docs/adr/0008` 记访客侧决策。
- npmjs 直查口径、409 铁律、两阶段监视见 know-how 018（dsh-workspace 01_docs）。
