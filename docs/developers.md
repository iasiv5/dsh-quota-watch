# developers.md — dsh-quota-watch 开发与发版纪律

发版序列的唯一权威文档。历史版本走查（谁在何时怎么发的）看 `git log --grep "chore(release)"`。

## 发版序列（每次发版照抄，勿即兴）

1. **身份前置**：`git config user.email` 必须是核准公开身份——GitHub noreply
   （`26645513+iasiv5@users.noreply.github.com`）或 `iasi@163.com`（主人 2026-10-24
   裁决：163 是有意的公开邮箱）。两台机器（web 机 / Windows 机）同一口径；
   `scripts/check-public-package.mjs` 的 `isApprovedCommitEmail` 是同一名单的唯一事实源。
2. **改动提交**：`fix(...)`/`feat(...)` 常规提交；测试先行（TDD），全量 `npm test` 过。
3. **版本三处同步**：`package.json` + `package-lock.json` 根两字段（`lockfile root
   version stays in sync` 测试钉着）→ `chore(release): v<版本>` 单独一笔。
4. **tag 前等 main CI 绿**：push main 后先看 `gh run list --branch main` 的 CI 结论，
   **绿了再推 tag**（2026-10-24 实录：身份门禁在 tag push 后才开火，白烧一个发版轮次
   + 一次 force 重写）。
5. `git tag v<版本> && git push origin main && git push origin v<版本>` →
   `publish.yml`（OIDC trusted publishing，`--provenance`）。
6. **绿 ≠ 已上架**（know-how 018）：`@iasiv5` scoped 包 staged 定稿实测 17–59 分钟；
   轮询一律 npmjs 直查 per-version（`--registry=https://registry.npmjs.org`），
   **窗口内绝不重推同一 tag**；入账后 PUT npmmirror sync。

## 依赖红线（dsh-m#7 同类遮蔽防御）

- `dependencies` **禁止出现 `@deepseek-ai/*`**：profile pnpm（nodeLinker: hoisted）
  会把它提升到顶层、按同名目录遮蔽应用自带核心包（实证：0.1.33 的
  `dsh-credentials@0.1.7-rc.2` 连同传递依赖 `dsh-brand` 遮蔽应用 0.2.1-rc.x）。
- 上游包确需其纯函数时，vendor 进 `src/`（先例：`src/credential-ref.mjs`，头锚上游
  版本号 + MIT 标注；`brandString` 为运行时恒等函数的论证见该文件头）。
- 守卫：`tests/package-shape.test.mjs` 的依赖卫生测试（dependencies 零
  `@deepseek-ai/*` + src 零 import + vendor 头锚），红即停。

## 门禁语义

- `security:check`（prepack + CI）：worktree/pack 双面密钥扫描 + 提交元数据身份
  核准（`unapproved-public-identity` = 存在非核准邮箱的 author/committer）。
- 版本守卫语义（宿主对插件的兼容判定）与本地门禁是两回事，见 know-how 033；
  本包声明门槛首选 `dsh.engines.dsh`（2026-10-19 修订口径）。
- bundle 漂移门禁：凡动 `src/client.mjs`（或任何进 bundle 的文件）的提交必须同笔带上
  `npm run build` 重建的 `lib/client.js`；CI 在 build 后 `git diff --exit-code lib/client.js`，
  非零即红（ADR 0007）。
