# DSH Quota Watch 0.1.0 悬浮球浮动化 实施计划

## 目标

- 把 quota-watch 的界面从「侧边栏卡片 + 行旁锚定弹层」改造为 B+ 混合形态：**悬浮球 (ball) 为唯一被保证的界面**（可拖拽、可切胶囊、位置与模式持久化），**浮动面板 (panel) 为唯一详情面**（球 / 胶囊 / 卡片行三入口共用），**侧边栏卡片 (card) 降级为渐进增强**（footArea 在则显示，Desktop 塌缩态自然缺席）。
- 全部 UI 迁入 open Shadow DOM（ADR 0001），退役 document 级样式机器与 Web 专属塌缩逻辑，使插件对 Web / Desktop 双 profile 与宿主改版鲁棒。
- 以 `0.1.0` 发布，并完成 dsh-m registry 文案同步与 know-how 017 改写两项发布义务。

## 架构快照

- **两个 shadow host**：
  - **浮层 host**：`div[data-dsh-quota-watch-float]`，`position:fixed; z-index:2147483000`，挂在 `doc.documentElement` 下（规避祖先 `transform` 使 `position:fixed` 失效的坑，同 dsh-todo-float-ball 的做法）。shadow root 内含 `<style>` + 球 + 胶囊 + 面板 + 右键菜单。
  - **卡片 host**：现有 `container`（`data-dsh-quota-watch-card`）原位留在 footArea，变成 shadow host；shadow root 内含 `<style>` + `.dqw-card` + 球显隐切换按钮。
- **渲染复用**：`glmRowModel` / `copilotRowModel` / `renderOverview` / `renderDetail` / `formatXxx` / `COPY` 全部保留；面板只是换容器与锚定（锚点从「卡片行」推广为「任意元素 ref」）。
- **删除**：`.dqw-rail-trigger`、`[data-sidebar-collapsed]` CSS 与 `syncSidebarMode` 监听、`positionPop` 锚定计算、`ensureStyleAlive` / document `adoptedStyleSheets` 镜像（0.0.18 自愈机器）。
- **偏好持久化**：全部走 localStorage，无宿主设置页依赖。会话级隐藏（藏球）存内存（mount 闭包），刷新即恢复。
- **host 端零改动**：`src/host.mjs`、`cordis.patch.yml`、`/api/dsh-quota-watch/*` 路由、60s 宿主探测、30s 客户端视图轮询全部不动。

## 全局约束

- DSH 引擎下限不变：`dsh.engines.dsh: ">=0.1.7-rc.2"`；Node `>=20`；**不新增任何运行时依赖**（esbuild 仍为 devDependency）。
- 命名规则：CSS 类前缀 `dqw-`；dataset 前缀 `data-dsh-quota-watch-*`；localStorage key 前缀 `dsh-quota-watch:`（三条：`dsh-quota-watch:float-geometry` / `dsh-quota-watch:float-mode` / `dsh-quota-watch:surface-flags`）。
- 主题规则：所有颜色经 `--dsw-alias-*` 变量 + 硬编码 fallback（沿用现有写法）；shadow host 用显式最小重置，**不用 `all:initial`**（ADR 0001：保住 `font: inherit` 一族继承）。
- 文案规则：COPY 保持 zh / en 双语；zh 文案被测试逐字断言（如 `Token额度`）。
- 安全规则：provider 数据一律 `textContent` 写入，不拼 markup；`npm run security:check` 必须通过；不得引入真实凭据。
- 领域词按 [GLOSSARY.md](../../GLOSSARY.md)：ball / capsule / panel / card；`pop` 只是遗留实现名，新代码一律用 panel。

## 输入工件

- 设计决议：ADR `docs/adr/0001-shadow-dom-ui-isolation.md`；`/grill-with-docs` 两轮共识（2026-10-01/02 会话记录）。
- 术语表：`GLOSSARY.md`（UI surfaces 四词）。
- 相关 know-how：`~/workspace/01_docs/dsh-intall-know-how/017-quota-watch-style-strip-selfheal.md`（被本次收编替代的 remedy）、`008`（registry 同步流程）、`018`（npm OIDC 发布假绿/409 注意事项）。

## 文件结构与职责

- Create: `src/client/prefs.mjs` — 浮层偏好纯逻辑模块（几何钳位、读写、模式与表面旗标），无 DOM 依赖，可独立单测。
- Modify: `src/client.mjs` — 主战场：卡片 shadow 化、塌缩态退役、panel 统一、球/胶囊/菜单/拖拽。
- Create: `tests/prefs.test.mjs` — prefs 模块单测。
- Modify: `tests/client.test.mjs` — 查询迁入 shadowRoot、删塌缩/自愈旧测试、新增球/胶囊/菜单/拖拽测试。
- Modify: `README.md` — 功能、兼容与配置、English summary 三节重写。
- Modify: `package.json` — 版本 `0.0.18 → 0.1.0`（仅发布任务动它）。
- Modify（跨仓库）: `~/workspace/dsh-m/registry.json` — `id: dsh-quota-watch` 条目（约 149 行起）。
- Modify（跨仓库）: `~/workspace/01_docs/dsh-intall-know-how/017-quota-watch-style-strip-selfheal.md` 与同目录 `AGENTS.md` 索引行。
- 边界稳定：`src/host.mjs`、`src/shared.mjs`、`src/core/adapters.mjs`、`cordis.patch.yml`、`scripts/build-client.mjs` 不改（esbuild 会自动打包 `src/client/prefs.mjs` 的相对导入）。

## 接口契约总表（后续任务的 Consumes 在此定义）

prefs 模块 `src/client/prefs.mjs` 导出（Task 1 产出，Task 5/6/7/8 消费）：

```js
export const FLOAT_GEOMETRY_KEY = 'dsh-quota-watch:float-geometry'
export const FLOAT_MODE_KEY = 'dsh-quota-watch:float-mode'
export const SURFACE_FLAGS_KEY = 'dsh-quota-watch:surface-flags'
export function clampPoint(point, viewport)   // ({x,y}, {width,height}) → 视口内 {x,y}，四边留 8px
export function loadFloatGeometry(storage)    // → {x:number,y:number} | null（缺失/损坏 JSON → null；x/y 任一非有限数 → null）
export function saveFloatGeometry(storage, point)
export function loadFloatMode(storage)        // → 'ball' | 'capsule'（非法值/缺失 → 'ball'）
export function saveFloatMode(storage, mode)  // 仅接受 'ball'|'capsule'，否则抛 TypeError
export function loadSurfaceFlags(storage)     // → { cardHidden:boolean }（缺失/损坏 → { cardHidden:false }）
export function saveSurfaceFlags(storage, flags)
```

- 所有 `storage` 参数是 `localStorage` 同构对象（测试注入 `win.localStorage`），实现内部 try/catch 所有 JSON.parse / setItem。
- DOM 契约（Task 4/5/7 产出，测试与后续任务消费）：
  - 浮层 host：`[data-dsh-quota-watch-float]`；球：`button.dqw-ball[data-dsh-quota-watch-ball]`；胶囊：`div.dqw-capsule[data-dsh-quota-watch-capsule][role="button"][tabindex="0"]`（子元素 `.dqw-capsule-glm` / `.dqw-capsule-sep` / `.dqw-capsule-copilot`）。
  - 面板：`div.dqw-panel[data-dsh-quota-watch-panel][role="dialog"]`；概览态 dataset `data-dsh-quota-watch-panel-overview`；详情态 `data-dsh-quota-watch-panel-detail="<key>"`；provider 按钮 `[data-dsh-quota-watch-panel-provider="glm|copilot"]`；返回 `[data-action="back-to-overview"]`；关闭 `[data-action="panel-close"]`。
  - 菜单：`div.dqw-menu[role="menu"][hidden]`，项 `button[role="menuitem"][data-menu="toggle-mode|toggle-card|refresh|hide-ball"]`。
  - 归属时序：Task 4 阶段 panel 暂挂 `doc.body`（样式文本仍在卡片 shadow 的 STYLE_TEXT 内）；**Task 5 起 panel 与 menu 一并迁入浮层 shadow root**，`.dqw-panel*` 样式段同步自 STYLE_TEXT 拆出，此后一切 panel 查询走 `floatHost.shadowRoot`（ADR 0001 的 shadowRoot-only 查询义务以此为落点）。
  - a11y：球与胶囊常置 `aria-haspopup="dialog"`，并随 panel 开合同步 `aria-expanded`（对齐被退役 railTrigger 的语义水位，不低于旧实现）。
  - 卡片内球开关：`button.dqw-ball-toggle[data-action="toggle-ball"]`。
- 环形进度（Task 5）：SVG `viewBox="0 0 38 38"`，`r=15`，周长 C≈94.25；GLM 弧 `circle.dqw-ring-glm` 起 `rotate(-90 19 19)`，Copilot 弧 `circle.dqw-ring-copilot` 起 `rotate(90 19 19)`；每 provider 占半环，弧长 `dasharray="${fill} ${C-fill}"`，`fill = (pct/100) × (C/2 − 2)`（留 2 单位缺口）；`stroke-dasharray` 前先置 `pathLength` 不用，直接算数值。中心叠 `quotaIcon(doc)` 16px。
- 阈值：>80 加 `warn`、>95 加 `danger`（沿用现有 `fillClass` 语义），作用于弧、胶囊百分比 span；任一 provider >95 时球加 `data-alert="true"`；脉动 keyframes 仅在 `@media (prefers-reduced-motion: no-preference)` 下生效。
- stale 约定：⚠ 过期标记不上球 / 胶囊，只在面板与卡片行内（现状保留）；球 / 胶囊弧使用 last-good 数据照常渲染。
- 隐藏优先级：`ballSessionHidden === true` 时浮层 host 强制 `hidden`，`renderBallFace` 的数据可见性条件不得覆写它（Task 8 用例钉死）。
- 颜色：GLM 弧 `var(--dsw-alias-button-primary-fill,#5b8def)`、Copilot 弧 `var(--dsw-alias-label-success,#3fb950)`；warn `var(--dsw-alias-label-warning,#d29922)`、danger `var(--dsw-alias-label-danger,#c93c3c)`；轨道 `var(--dsw-alias-bg-tertiary,rgba(128,128,128,.2))`。
- COPY 新增（zh / en，测试用 zh 逐字断言）：`menu: { toggleToBall: '切为悬浮球'/'Switch to ball', toggleToCapsule: '切为胶囊'/'Switch to capsule', showCard: '显示侧边栏卡片'/'Show sidebar card', hideCard: '隐藏侧边栏卡片'/'Hide sidebar card', refreshNow: '立即刷新'/'Refresh now', hideBall: '隐藏悬浮球'/'Hide floating ball', showBall: '显示悬浮球'/'Show floating ball' }`；`ariaLabel` 用现有 `copy.title` + 实时摘要。
- jsdom 能力实测（29.x，写测试时以此为准）：`window.PointerEvent` 构造器**存在**、`HTMLElement.prototype.setPointerCapture` **不存在**（实现里 `el.setPointerCapture?.(e.pointerId)` 可选调用）、`composedPath()` 可用、裸 `new JSDOM()`（无 url）访问 `localStorage` 抛 `SecurityError`。事件派发统一用 `MouseEvent('pointermove', {clientX, clientY, bubbles:true})`——这是风格选择而非能力限制；`getBoundingClientRect` 返回 0 → 面板定位断言只断 `style.left` 非空，钳位逻辑用 `clampPoint` 单测覆盖。

## 任务清单

### Task 1: feature 分支 + prefs 偏好模块

- 目标：建立 `feat/float-ball` 分支；以 TDD 产出 `src/client/prefs.mjs` 纯逻辑模块。
- Files: Create `tests/prefs.test.mjs`, `src/client/prefs.mjs`
- 验证范围: `node --test tests/prefs.test.mjs` 全绿
- 接口契约: Consumes: 无。Produces: 「接口契约总表」中 prefs 模块全部导出。
- [ ] Step 1: `git -C ~/workspace/dsh-quota-watch checkout -b feat/float-ball`（当前在 `main`，本计划获批即视为同意建分支）；紧接 `git add GLOSSARY.md docs/adr && git commit -m "docs: float-ball ADR + UI glossary terms"`——grill 阶段产物先行入库，避免后续 `-am` 把它们误卷进 refactor commit，也让 know-how 012 横幅引用的 `docs/adr/0001` 真实存在。
- [ ] Step 2: 写失败测试 `tests/prefs.test.mjs`：① `clampPoint({x:-5,y:9999},{width:800,height:600})` → `{x:8,y:600-8-1}` 附近（断言 `x===8` 且 `y <= 592`）；② `loadFloatGeometry` 缺失/损坏 JSON（`'{'`）→ `null`，合法 roundtrip；③ `loadFloatMode('crap')` → `'ball'`，`'capsule'` 原样返回；④ `saveFloatMode(storage,'nope')` 抛 TypeError；⑤ `loadSurfaceFlags` 缺失/损坏 → `{cardHidden:false}`。storage 用**带 `url` 的** JSDOM（`new JSDOM('<body></body>', { url: 'https://dsh.example/' })`）取 `window.localStorage`，或手写 `Map` stub（实现只调 `getItem/setItem`；裸 `new JSDOM()` 无 url 会因 opaque origin 抛 SecurityError，禁止）。
- Run: `node --test tests/prefs.test.mjs` — Expected: 模块不存在，测试文件加载失败（红）。
- [ ] Step 3: 按「接口契约总表」实现 `src/client/prefs.mjs`（无 DOM import，纯函数 + try/catch）。
- [ ] Step 4: Run `node --test tests/prefs.test.mjs` — Expected: 全绿。
- [ ] Step 5: checkpoint commit：`git add src/client/prefs.mjs tests/prefs.test.mjs && git commit -m "feat(client): float prefs module (geometry/mode/surface flags)"`

### Task 2: 卡片迁入 shadow root，document 级样式机器退役

- 目标：卡片内容与样式进 open shadow root；删 `ensureStyleAlive` / document adoptedStyleSheets 镜像 / `<style>` 随 DOM 插入。
- Files: Modify `src/client.mjs`（`mountQuotaCard` 内 container 构造段，原 lib/client.js:362-404 对应源码）、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿（已迁移查询）
- 接口契约: Consumes: 无新依赖。Produces: 卡片 host 契约——`container`（`[data-dsh-quota-watch-card]`）为 shadow host，内容经 `container.shadowRoot.querySelector` 访问；卡片行选择器（`[data-dsh-quota-watch-row]`、`.dqw-label[data-action="refresh"]`、`[data-role="updated"]`）语义不变。
- [ ] Step 1: 迁移测试查询：所有 `container.querySelector` → `container.shadowRoot.querySelector`（`container` 仍取自 `document.querySelector('[data-dsh-quota-watch-card]')`）；删除测试 `card restyles itself when an external actor strips the style tag`（017 自愈退役），替换为新测试 `card styles live inside the shadow root, not the document`：断言 `[...document.querySelectorAll('style')].every(s => !s.textContent.includes('.dqw-row-summary'))` 且 `container.shadowRoot.querySelector('style').textContent.includes('.dqw-row-summary')`。
- Run: `node --test tests/client.test.mjs` — Expected: 红（实现仍插 document `<style>`、行内查询走 light DOM）。
- [ ] Step 2: 实现：`container` 创建后 `container.attachShadow({mode:'open'})`；`STYLE_TEXT`、`.dqw-card`、`body` 全部 append 进 `shadowRoot`；删除 `ensureStyleAlive`、`styleAlive`、adoptedSheet 三段与 `renderAll` 里的 `ensureStyleAlive()` 调用；cleanup 里删 adoptedSheet 摘除逻辑（保留 `container.remove()` / `pop.remove()`）。守卫：`typeof container.attachShadow !== 'function'` 时整体返回 noop（与现 stub 行为一致）。`doc.querySelectorAll(CARD_SELECTOR)` 去重守卫不变。
- [ ] Step 3: Run `node --test tests/client.test.mjs` — Expected: 全绿。
- [ ] Step 4: Run `npm test` — Expected: 全仓测试绿（host/adapters/credentials 等不受影响）。
- [ ] Step 5: checkpoint commit：`git commit -am "refactor(client): move card into shadow root, retire document style machinery (ADR 0001)"`

### Task 3: 塌缩态退役（rail trigger / collapsed 同步）

- 目标：删除 Web 专属塌缩逻辑，为 Desktop 收起态让位给悬浮球。
- Files: Modify `src/client.mjs`（`railTrigger` 构造、`STYLE_TEXT` 中 `[data-sidebar-collapsed]` 两条规则、`syncSidebarMode` / `sidebarCollapsed` / MutationObserver 的 `attributeFilter`、`onRailClick`、`popOrigin` 分支）、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿，且源码 grep 无 `data-sidebar-collapsed` / `dqw-rail-trigger` 残留
- 接口契约: Consumes: Task 2 的 shadow host 契约。Produces: 卡片只剩「展开态卡片」一种形态；`popOrigin` / `openKey === 'overview'` 的 rail 分支从状态机中移除（panel 统一在 Task 4 重构这部分）。
- [ ] Step 1: 删除测试 `collapsed rail matches the settings control and opens quota summaries` 与 `changing the sidebar mode closes a rail-anchored popover`；`dom()` fixture 的 `collapsed` 参数与 `data-sidebar-collapsed` 属性一并移除。
- Run: `node --test tests/client.test.mjs` — Expected: 绿（删除的是测试；实现暂未动）。
- [ ] Step 2: 实现：删 `railTrigger` 及其 append / 事件 / aria；删 `STYLE_TEXT` 里 `[data-sidebar-collapsed]` 两条与 `.dqw-rail-trigger` 一族；删 `syncSidebarMode`、`sidebarCollapsed`、observer 的 `attributes/attributeFilter` 配置（MutationObserver 保留 `childList+subtree` 服务 `schedulePlace`）；`onRailClick` 删除，`popOrigin === 'rail'` 分支随 Task 4 一并消失（本任务先把 rail 相关引用摘除，允许 `popOrigin` 暂时只剩 `'row'`）。
- [ ] Step 3: Run `node --test tests/client.test.mjs && grep -n "data-sidebar-collapsed\|dqw-rail-trigger\|syncSidebarMode" src/client.mjs` — Expected: 测试全绿，grep 无输出。
- [ ] Step 4: checkpoint commit：`git commit -am "refactor(client): retire sidebar-collapsed rail mode"`

### Task 4: panel 统一——三入口共面，positionPop 一族退役

- 目标：详情面改名 panel 并常驻浮层侧；卡片行 / 键盘入口打开同一 panel；删除 `positionPop` 行锚定计算。
- Files: Modify `src/client.mjs`（`pop` 构造、`syncPop` / `positionPop` / `onPopClick` / `onDocPointerDown` / `onDocScroll` / `onWinResize` / `onDocKeydown`）、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿；grep `dqw-pop|dshQuotaWatchPop|positionPop` 无残留
- 接口契约: Consumes: Task 2 shadow host；Task 3 状态机简化。Produces: 「接口契约总表」的 panel DOM 契约（dataset / provider 按钮 / back / panel-close）；`placePanel(anchorEl)` 内部函数——锚定任意元素（`rect.right+8` 优先右侧，溢出翻左侧，上下钳位 ≥8 / `innerHeight-8`），Task 5 将把球作为新锚点传入；scroll/resize 用 `lastAnchor` 重锚。
- [ ] Step 1: 测试改名与迁移：`[data-dsh-quota-watch-pop]` → `[data-dsh-quota-watch-panel]`；`dataset.dshQuotaWatchDetail/Overview` → `dshQuotaWatchPanelDetail/PanelOverview`（dataset 键 `data-dsh-quota-watch-panel-detail` / `...-panel-overview`）；`[data-dsh-quota-watch-pop-provider]` → `[data-dsh-quota-watch-panel-provider]`；`.dqw-pop*` 类名 → `.dqw-panel*`。行点击测试追加断言 `panel.style.left` 非空（jsdom 下 rect 为 0，只验非空）。外部 pointerdown 关闭测试改用 `composedPath` 语义（保持 `body.dispatchEvent(pointerdown)` 关闭路径）。新增测试：panel 头部 `[data-action="panel-close"]` 点击关闭。
- Run: `node --test tests/client.test.mjs` — Expected: 红（实现未改名）。
- [ ] Step 2: 实现：`pop` → `panel`（类 `.dqw-panel`，样式文本沿用毛玻璃底，宽改 `min-width:166px; width:min(320px, calc(100vw - 24px)); max-height:calc(100vh - 24px); overflow-y:auto`）；`positionPop` → `placePanel(anchorEl)` + `lastAnchor`；卡片行/键盘 toggle 调 `toggleRow(key, rowEl)`（anchor=rowEl）；`onPopClick` → `onPanelClick`（back 逻辑不变，新增 panel-close → 关闭）；`onDocPointerDown` 内 `pop.contains(target)` 改为 `event.composedPath().some(t => t === panel || t === container)`，jsdom 兜底 `target.getRootNode?.() === panelRoot || … === cardRoot` 视为内部；`onDocKeydown` Esc 关闭顺序：menu（Task 8 接入）→ panel。`syncPop` 中 `fromRail` 分支删除，详情态 `renderDetail` 的 `fromRail` 参数改为「入口是否为 panel 内导航」（back 按钮仍需要 header，保留参数但只由 panel 内部导航置 true）。
- [ ] Step 3: Run `node --test tests/client.test.mjs && grep -n "dqw-pop\|dshQuotaWatchPop\|positionPop" src/client.mjs` — Expected: 全绿 + grep 无输出。
- [ ] Step 4: checkpoint commit：`git commit -am "refactor(client): unify detail surface into anchored panel (ball/capsule/row entries)"`

### Task 5: 悬浮球壳与进度环

- 目标：浮层 host 落地，球渲染双 provider 半环 + 中心仪表图标，点击开 panel，几何默认右下 16/16。
- Files: Modify `src/client.mjs`（新增浮层 host 构建 + `renderBallFace(snapshot)`）、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿（含 panel 迁移、footless 变体与新增球测试）
- 接口契约: Consumes: prefs 模块（Task 1，本期只用默认几何——几何持久化在 Task 6 接）、panel 契约（Task 4）。Produces: 浮层 host `[data-dsh-quota-watch-float]`（append 到 `doc.documentElement`，inline `position:fixed; z-index:2147483000`）；**panel 自本任务起归属浮层 shadow root**（契约总表「归属时序」）；球 `button.dqw-ball`（含 `aria-haspopup` / `aria-expanded` 契约）；`renderBallFace(snapshot)` 内部函数（Task 7 胶囊复用其百分比摘要）。
- [ ] Step 1: 测试先行（三组，全部先红）：
  - **panel 查询迁移（红）**：把 Task 4 遗留的全部 `window.document.querySelector('[data-dsh-quota-watch-panel…]')`、`document.querySelector('[data-dsh-quota-watch-panel-detail…]')` 查询改为经 `floatHost.shadowRoot.querySelector(...)`（`floatHost` 取自 `document.documentElement`）——此时实现未动、panel 仍在 `doc.body`，这批断言必须先红；
  - **footless 变体（红）**：`dom()` 增加 `dom({ footless: true })`（fixture 省略 `.sidebarCol` 整段）；新用例「无 footArea：mount 后 `[data-dsh-quota-watch-card]` 为 null、浮层 host 存在、球可见且 click 能开面板」；
  - **球本体（红）**：① mount 后浮层 host 存在（append 到 `doc.documentElement`），shadow 内 `.dqw-ball` 存在，内含 `.dqw-ring-glm` / `.dqw-ring-copilot` 两个 circle 与中心 `svg`（`aria-hidden`）；球带 `aria-haspopup="dialog"`；② 默认数据（GLM 13% / Copilot 24%）下两弧 `stroke-dasharray` 首值 > 0 且互不相同；③ 阈值表 `{50:null, 80:null, 80.1:'warn', 95:'warn', 95.1:'danger'}` 驱动 GLM 弧 class（复用现有阈值用例结构）；④ Copilot 95.1% 时球 `data-alert="true"`，50% 时无；⑤ 球 click → panel 打开（overview 态）且球 `aria-expanded === 'true'`；再 click → 关闭且 `'false'`；⑥ 两 provider 均 missing → float host `hidden === true`；仅 GLM 有数据 → `.dqw-ring-copilot` dasharray 首值为 `"0 …"`。
- Run: `node --test --test-name-pattern "ball|ring|float" tests/client.test.mjs` — Expected: 红（panel 查询迁移与球均未实现）。
- [ ] Step 2: 实现：`mountQuotaCard` 内新建 `floatHost`（`attachShadow` 同款守卫）append 到 `doc.documentElement`；**panel re-parent**：`floatHost.shadowRoot.append(panel)`，`doc.body` 不再持有 panel，`.dqw-panel*` 样式段自卡片 shadow 的 STYLE_TEXT 拆出、与球/环样式一并收进浮层 shadow 的 `<style>`；shadow 内再建 `.dqw-ball`；`renderAll` 末尾调 `renderBallFace(snapshot)` 同步弧长/class/`data-alert`/host hidden（数据条件与卡片 `container.hidden` 同源，但不得覆写 `ballSessionHidden`——契约总表「隐藏优先级」）；球 click → `toggleOverview(ball)`（打开 panel，anchor=ball）并同步 `aria-expanded`。几何：默认 `clampPoint({x: innerWidth-16-38, y: innerHeight-16-38}, viewport)` 施加到 host `style.left/top`（持久化 Task 6 接）。
- [ ] Step 3: Run `node --test tests/client.test.mjs` — Expected: 全绿。
- [ ] Step 4: checkpoint commit：`git commit -am "feat(client): floating ball shell with segmented quota ring"`

### Task 6: 拖拽与几何持久化

- 目标：球可整体拖拽，位置钳位并持久化，重启/HMR 恢复。
- Files: Modify `src/client.mjs`、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约: Consumes: `clampPoint` / `loadFloatGeometry` / `saveFloatGeometry`（Task 1）；浮层 host（Task 5）。Produces: 拖拽处理函数 `attachDrag(surfaceEl)`（Task 7 胶囊复用同一函数）；拖后点击抑制标志。
- [ ] Step 1: 新增测试：① mount 前预置 `localStorage[FLOAT_GEOMETRY_KEY]='{"x":120,"y":80}'` → mount 后 host `style.left === '120px'`、`style.top === '80px'`；② 预置越界 `{"x":-500,"y":99999}`（合法 JSON）→ mount 后坐标被钳入视口：断言 `8 <= parseFloat(left) <= innerWidth-8-38` 且 `8 <= parseFloat(top) <= innerHeight-8-38`，并断言回写 `localStorage` 的几何即钳位后坐标（`saveFloatGeometry` 存钳位值）；另加一例 `{"x":"a","y":1}`（形状非法）→ 走默认右下几何（钉死 `loadFloatGeometry` 对非法形状返回 null）；③ 拖拽：球 `pointerdown`（`button:0`）→ window `pointermove`（Δ≥6px）→ `pointerup` → `localStorage` 几何更新且 host 坐标变化；随后派发 `click` → panel **不**打开（拖后点击抑制）；④ 反例：pointerdown 后直接 pointerup（Δ<6）→ click 正常开 panel。
- Run: `node --test --test-name-pattern "drag|geometry" tests/client.test.mjs` — Expected: 红。
- [ ] Step 2: 实现 `attachDrag(surfaceEl)`：`pointerdown`（button 0，记录起点，`surfaceEl.setPointerCapture?.(e.pointerId)`）→ `pointermove`（Δ≥6 进入拖拽：`doc.body.style.userSelect='none'`，实时更新 host left/top）→ `pointerup`（拖拽态：`clampPoint` 收尾 + `saveFloatGeometry`，恢复 `userSelect`，置 `suppressNextClick=true`）。click 处理器首行 `if (suppressNextClick) { suppressNextClick=false; return }`。mount 时 `loadFloatGeometry` → 有则钳位后施用，无则 Task 5 默认值。
- [ ] Step 3: Run `node --test tests/client.test.mjs` — Expected: 全绿。
- [ ] Step 4: checkpoint commit：`git commit -am "feat(client): ball drag with viewport clamping and persisted geometry"`

### Task 7: 胶囊态与模式记忆

- 目标：`loadFloatMode` 驱动球 / 胶囊二选一渲染；胶囊摘要行可拖拽、可开 panel。
- Files: Modify `src/client.mjs`、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约: Consumes: `loadFloatMode` / `saveFloatMode`（Task 1）；`attachDrag`（Task 6）；`renderBallFace` 的百分比摘要（Task 5）。Produces: 胶囊 DOM 契约（接口契约总表）；`setFloatMode(mode)` 内部函数（Task 8 菜单消费）。
- [ ] Step 1: 新增测试：① 预置 `FLOAT_MODE_KEY='capsule'` → mount 后 shadow 内有 `.dqw-capsule` 无 `.dqw-ball`，文本匹配 `/GLM 13%/` 与 `/Copilot 24%/`，包含 `.dqw-capsule-sep`；② Copilot missing → 无 `.dqw-capsule-copilot` 与 `.dqw-capsule-sep`；③ 胶囊 click → panel 打开（anchor=胶囊）且胶囊 `aria-haspopup="dialog"` 常置、`aria-expanded` 随开关为 `'true'`/`'false'`；④ 胶囊拖拽复用 Task 6 用例模式（Δ≥6 → 几何持久化）；⑤ Enter 键（keydown）开 panel；⑥ 阈值 95.1% 时胶囊对应 span 带 `danger` class。
- Run: `node --test --test-name-pattern "capsule" tests/client.test.mjs` — Expected: 红。
- [ ] Step 2: 实现：mount 时 `const mode = loadFloatMode(win.localStorage)`；按 mode 渲染 ball 或 capsule（两者都绑 `attachDrag` + click/keydown → panel + contextmenu 预留 Task 8）；`setFloatMode(mode)`：`saveFloatMode` + 重建浮层内表面 + 关闭 panel（共识：切模式先收面板）。
- [ ] Step 3: Run `node --test tests/client.test.mjs` — Expected: 全绿。
- [ ] Step 4: checkpoint commit：`git commit -am "feat(client): capsule mode with persisted ball/capsule switch"`

### Task 8: 右键菜单、会话隐藏与卡片切换按钮

- 目标：右键菜单四项落地；藏球会话级生效；卡片 meta 区加球显隐切换，双入口互不锁死。
- Files: Modify `src/client.mjs`（COPY、菜单构建、卡片 shadow 内加 `.dqw-ball-toggle`）、`tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约: Consumes: `setFloatMode`（Task 7）；`loadSurfaceFlags` / `saveSurfaceFlags`（Task 1）；`CLIENT_ROUTES.refresh`（现有）。Produces: 菜单 DOM 契约与 `.dqw-ball-toggle`（验收清单消费）；`ballSessionHidden` 为 mount 闭包内状态（非模块级，dispose 即重置）。
- [ ] Step 1: 新增测试：① 球 `contextmenu` → `.dqw-menu` 打开且 `preventDefault`（断言 `menu.hidden === false`）；② `toggle-mode` 点击 → 表面切换 + `FLOAT_MODE_KEY` 持久化 + panel 关闭；③ `toggle-card` 点击 → `SURFACE_FLAGS_KEY` 写入 `{cardHidden:true}` 且卡片 host `hidden===true`；重新 mount → 卡片 host 仍 `hidden`（持久）；菜单内切回 → 恢复；④ `refresh` 点击 → 最后一个请求为 `POST api/dsh-quota-watch/refresh`；⑤ `hide-ball` 点击 → float host `hidden===true` 且 panel 关闭；隐藏后触发一次 `renderAll`（等下一轮 poll 或点一次卡片行）→ float host **仍** `hidden===true`（会话隐藏不被数据条件覆写）；同窗口卡片 `.dqw-ball-toggle` click → 球恢复；⑥ 防锁死路径：预置 `SURFACE_FLAGS_KEY` 为 `{cardHidden:false}` mount 后，先经菜单 `hide-ball` 隐藏球（会话级），再断言卡片 host 仍渲染、其 shadow 内 `.dqw-ball-toggle` 存在且 click 后球恢复显示；⑦ Esc：menu 开 → Esc 只关 menu；再 Esc → 关 panel；⑧ 无 footArea 变体（复用 Task 5 的 `dom({footless:true})`）打开菜单 → `toggle-card` 菜单项不渲染或自带 `hidden`。
- Run: `node --test --test-name-pattern "menu|toggle-ball|hide" tests/client.test.mjs` — Expected: 红。
- [ ] Step 2: 实现：COPY 增 `menu` 段（接口契约总表原文）；菜单构建进浮层 shadow（`role="menu"`，四项 `data-menu` 契约）；`toggle-card` 项在 `footArea` 探测不到时隐藏该项（Desktop 无卡片场景无意义）；`toggle-ball` 逻辑：`ballSessionHidden` 置位 → float host hidden + panel 关；卡片 `.dqw-ball-toggle`（`.dqw-card` 内 absolute 右上，hover/focus 可见，球隐藏时常显）标题按 `copy.menu.hideBall/showBall` 切换，click 翻转 `ballSessionHidden`；Esc 分层关闭；`onDocPointerDown` 的 composedPath 判断加入 `.dqw-menu`；`renderBallFace` 的 host 可见性改为 `ballSessionHidden || (数据条件)`。
- [ ] Step 3: Run `node --test tests/client.test.mjs` — Expected: 全绿。
- [ ] Step 4: checkpoint commit：`git commit -am "feat(client): context menu, session-scoped ball hide, card toggle button"`

### Task 9: README 更新

- 目标：文档与 0.1.0 实际形态一致。
- Files: Modify `README.md`（`## 功能`、`## 兼容与配置`、`## English summary` 三节）
- 验证范围: 人工比对 + `grep -n "rail\|收起时改为" README.md` 无残留
- 接口契约: Consumes: 任务 2–8 的最终行为。Produces: 无（发布任务的对外口径）。
- [ ] Step 1: 重写 `## 功能`：悬浮球（右下 16/16 起步、可拖拽、位置记忆、分段双弧 + 阈值变色 + 脉动 respects reduced-motion）、胶囊（右键互切、`GLM 13% · Copilot 24%`）、面板（三入口、宽 min(320px,100vw−24px)、Esc/外点/✕ 关闭）、卡片（渐进增强、跟随可用性、右上角球显隐切换）、右键菜单四项、藏球会话级。删除塌缩态 rail 描述（原 9 行「侧栏收起时改为 36×36px…」句）。
- [ ] Step 2: `## 兼容与配置` 补一句：适配 web 与 desktop profile；desktop 侧栏收起（整体消失）时由悬浮球承载入口。
- [ ] Step 3: `## English summary` 同步重写（ball/capsule/panel/card 术语与 GLOSSARY 一致）。
- [ ] Step 4: Run `grep -n "rail\|收起时改为" README.md; npm test` — Expected: grep 仅允许「不再收起…」类新表述（本计划口径为无残留，命中即改写），测试全绿。
- [ ] Step 5: checkpoint commit：`git commit -am "docs: rewrite README for floating ball release"`

### Task 10: 版本 0.1.0 发布准备

- 目标：版本号、构建、全量验证、tag。
- Files: Modify `package.json`（`"version": "0.1.0"`）
- 验证范围: `npm test` + `npm run build` + `npm run security:check` 全绿
- 接口契约: Consumes: Task 1–9 全部。Produces: `lib/client.js` 新 bundle；tag `v0.1.0`。
- [ ] Step 1: 改 `package.json` version → `0.1.0`。
- [ ] Step 2: Run `npm run build && npm test && npm run security:check` — Expected: build 输出 `wrote lib/client.js`；测试全绿；security 无告警。
- [ ] Step 3: 抽查 bundle：`grep -c "attachShadow" lib/client.js` ≥ 1；`grep -c "ensureStyleAlive" lib/client.js` → `0`（自愈机器已退役的硬证据）。
- [ ] Step 4: commit + tag：`git commit -am "chore: release v0.1.0" && git tag v0.1.0 && git push origin feat/float-ball --tags`（合并 main 与 npm 发布由 GitHub Actions OIDC 线完成；**注意 know-how 018**：publish 绿 ≠ 已上架，先查 `Your package is being processed`，约 17 分钟 staged 延迟，勿因假绿重推 tag）。

### Task 11: dsh-m registry 条目同步

- 目标：市场卡片文案与 verified 数组反映 0.1.0。
- Files: Modify `~/workspace/dsh-m/registry.json`（`id: "dsh-quota-watch"` 条目，约 149–166 行）
- 验证范围: `node scripts/validate-registry.mjs`（在 `~/workspace/dsh-m` 下）全绿
- 接口契约: Consumes: Task 10 已发 0.1.0 **且 npm 已实际可解析**（Step 0 验证）。Produces: 无。
- [ ] Step 0（前置门）: Run `npm view @iasiv5/dsh-quota-watch@0.1.0 version` — Expected: 输出 `0.1.0`；未命中（know-how 018 的 staged 假绿窗口，publish 绿后约 17 分钟才上架）则等待后重试，**未实际上架不得把 0.1.0 写入 verified**。
- [ ] Step 1: 改 `description` 为：「GLM 与 Copilot 额度悬浮球：胶囊、详情面板与侧栏卡片，宿主解析凭据，适配 web 与 desktop。」（约 45 全角当量，≤60 上限，guide §2；能力细节归 homepage 与仓库 README）；`tags` 将「监控」**替换**为「悬浮球」→ `["配额","悬浮球","GLM","Copilot"]`（维持 4 个，guide §5 上限）；`verified` 追加 `"0.1.0"`（**只追加 0.1.0**；`0.2.0-rc.1/rc.2` 的 verified 欠账按 know-how 008/016 流程留给主人目视确认后另补，不在本任务混做）。
- [ ] Step 2: Run `cd ~/workspace/dsh-m && node scripts/validate-registry.mjs` — Expected: exit 0 **且输出中无针对 quota-watch 的 warn**（validator 对 description 超长 / tags 超限只 warn 不阻断，出现相关 warn 即视为本任务未通过，回 Step 1 收敛文案）。
- [ ] Step 3: 按仓库惯例提交（push 前经主人确认，know-how 008 规则）。

### Task 12: know-how 017 改写与索引更新

- 目标：017 的 remedy 与升级必查反映「Shadow DOM 收编」，避免失效判据残留。
- Files: Modify `~/workspace/01_docs/dsh-intall-know-how/017-quota-watch-style-strip-selfheal.md`、同目录 `AGENTS.md`（索引表 017 行）
- 验证范围: Step 4 的 grep 命令与命中计数（新判据在位、旧单版本判据已不在独立语境残留）
- 接口契约: Consumes: Task 10 的 bundle 事实（`ensureStyleAlive` = 0，`attachShadow` ≥ 1）。Produces: 无。
- [ ] Step 1: 017 标题状态行下追加横幅：`> 🔄 部分收编（2026-10-02）：@iasiv5/dsh-quota-watch@0.1.0 起全部 UI 迁入 Shadow DOM（见插件仓库 docs/adr/0001），document 级 style 自愈机器（§3）退役；本文 §1/§2/§4 诊断知识仍适用于 ≤0.0.18 装机。`
- [ ] Step 2: 改写 §5 升级必查为双版本判据（两行都带版本锚字样）：「≥0.1.0 → `grep -c attachShadow <profile>/node_modules/@iasiv5/dsh-quota-watch/lib/client.js` ≥ 1 且 `grep -c ensureStyleAlive …` = 0」「≤0.0.18 → 沿用旧判据 `grep -c ensureStyleAlive …` ≥ 1」；§3 三层防御清单中 `ensureStyleAlive()` 条目行内补注「（≤0.0.18 机制，0.1.0 起由 Shadow DOM 替代）」；§3 末尾加一段「0.1.0 起样式由 Shadow DOM 承载，样式剥离类症状应不再复现；若复发按 §4 取证并升级为独立 know-how」。
- [ ] Step 3: `AGENTS.md` 索引表 017 行「升级/重装后必查」列替换为：「按 §5 双版本判据核对（≥0.1.0 查 attachShadow=1/ensureStyleAlive=0；≤0.0.18 查 ensureStyleAlive ≥1）」。
- [ ] Step 4: Run `grep -c "attachShadow" ~/workspace/01_docs/dsh-intall-know-how/017-quota-watch-style-strip-selfheal.md; grep -c "attachShadow" ~/workspace/01_docs/dsh-intall-know-how/AGENTS.md; grep -n "ensureStyleAlive" ~/workspace/01_docs/dsh-intall-know-how/017-quota-watch-style-strip-selfheal.md` — Expected: 前两条计数均 ≥ 1；第三条每个命中行都含 `0.0.18` 或 `0.1.0` 版本锚字样（`ensureStyleAlive` 判据只存在于带版本锚的语境，无裸残留）。

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项、矛盾或验证命令与仓库现实不符，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并或改任务目标；每任务完成即跑其验证。
- Task 2/4/7 是行为等价性风险最高的三处（查询迁移、状态机重构、防锁死），如遇 jsdom 行为与预期不符（如 `composedPath` 支持度），停下记录并按兜底方案（`getRootNode()` 判断）实现，不猜。
- 全程在 `feat/float-ball` 分支；checkpoint commit 为自然边界，不要求微步提交。
- 遇阻塞或重复失败立即停下说明。
- checkpoint 提交用 `git commit -am` 前确认工作树无计划外游离文件（ADR/GLOSSARY 已在 Task 1 Step 1 定向入库）；出现即先处置再提交。

## 最终验证

- Run: `cd ~/workspace/dsh-quota-watch && npm run build && npm test && npm run security:check` — Expected: 三条全绿。
- Run: `grep -c "ensureStyleAlive" lib/client.js; grep -c "attachShadow" lib/client.js` — Expected: `0` 与 `≥1`。
- Run: `cd ~/workspace/dsh-m && node scripts/validate-registry.mjs` — Expected: 全绿。

### 人工验收清单（计划执行完后执行）

**Web（执行者本机，127.0.0.1:3080 + HMR 或装机后）：**
1. 刷新页面 → 右下 16/16 出现球，双弧比例与卡片数字一致；>80% 黄、>95% 红。
2. 拖拽到任意角落 → 刷新页面 → 位置保持；拖出屏幕松手 → 钳回。
3. 右键 → 切胶囊 → 文本 `GLM x% · Copilot y%`；重启后仍为胶囊；右键切回球。
4. 球 / 胶囊 / 卡片行三处入口都能开面板；面板靠右时向左翻侧；✕ / Esc / 点外可关。
5. 右键隐藏侧栏卡片 → 卡片消失；刷新后仍隐藏；菜单切回恢复。
6. 右键隐藏悬浮球 → 球消失，卡片右上切换按钮可唤回；刷新后球自动回来。
7. Web 侧栏收起（窄栏）→ 卡片消失（不再有 rail 图标），球仍在。
8. dsh-skins 切换深浅主题 → 球 / 面板 / 卡片配色跟随；无裸样式（017 场景换主题 / 装插件 / 重启后观察一轮）。
9. 修改插件文件触发 HMR → 球位置与模式无感恢复。

**Desktop（主人执行）：**
1. Desktop 端安装 0.1.0 → 球出现且可拖拽、位置记忆。
2. 收起侧栏（整体消失）→ 卡片自然缺席、无报错，球仍在且可开面板。
3. 小窗口下球不丢失（钳位），胶囊模式可用。
4. `grep -c attachShadow …/lib/client.js` ≥ 1 且无 console 报错。

## 审阅 Checkpoint

- 计划正文到此为止。请先审阅；确认后即可交由普通编码 agent 或人工按任务顺序执行（默认从 Task 1 的 `feat/float-ball` 分支开始）。
