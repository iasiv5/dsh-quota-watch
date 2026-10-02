# 胶囊手感与移动端适配 实施计划

## 目标

- 把胶囊拖拽改为跟手的标准管线：抓取点偏移保持、拖拽中 `transform` 位移 + rAF 合帧、松手才提交坐标并持久化；退役「左上角钉光标」与每帧 `left/top` 写入。
- 位置记忆从自由 `{x,y}` 改为磁性贴边 `{edge, offsetY}`：横向坐标永远按实测宽度从边推导（数据文本变宽、窄窗、转屏自愈）；退役 38px 定值钳位盒（0.1.7 capsule-first 遗留错误，默认落点会让胶囊右半截出屏）。
- 手机浏览器一等公民：`touch-action:none` + `pointercancel`、分级拖拽阈值（桌面 6px / 触摸 10px）、长按 500ms 呼出菜单（补 iOS 无 contextmenu）、热区扩到 ≥44px（视觉保持 26px）、safe-area 避让、≤480px 面板底部弹层。
- 性能卫生：拖拽期挂起 `backdrop-filter`、`will-change` 仅拖拽期存在、滚动监听 rAF 合帧、document 级 move/up 监听按需挂载。
- 视觉微交互：`cursor:grab/grabbing`、hover 阴影/描边、`:active` 按压、贴边 150ms spring 过渡；一切动画尊重 `prefers-reduced-motion`。
- **明确不做**（2026-10-02 grill 三轮共识出界项）：状态点与正常态百分比染蓝（主人目视确认现配色 >80 黄 / >95 红可接受）、fling 惯性、pinch-zoom visualViewport 跟随、半隐藏 peek 贴边、dsh-m registry 任何改动（`verified` 是 DSH 运行时代际清单，本次引擎下限不变）。

## 架构快照

- 改动全部在 client 侧：`src/client/prefs.mjs`（dock 偏好）、新建 `src/client/drag.mjs`（拖拽/贴边纯逻辑，无 DOM 依赖）、`src/client.mjs`（接线 + `FLOAT_STYLE_TEXT` 增补）。`src/host.mjs`、`src/shared.mjs`、`src/core/adapters.mjs`、`cordis.patch.yml`、`scripts/build-client.mjs` 不动；esbuild 打包 `lib/client.js` 时自动收进 drag.mjs 的相对导入。
- 几何不变式：**host `style.left/top` 只在静止态有意义**（= 贴边停靠位）；拖拽中的位移全部走胶囊 `style.transform`（`translate3d(dx,dy,0) scale(1.03)`，内联优先级天然压住 `:hover/:active` 规则）；松手先把最终钳位值写回 `left/top`，再清 transform。尺寸在 `pointerdown` 时 `getBoundingClientRect()` 实测一次（jsdom 返回 0 → 回退 `FALLBACK_SIZE={width:38,height:26}`）。
- 每轮渲染重推导横向位置：`renderFloatFace()`（client.mjs:789，paint 之后）末尾调 `applyDock()`，x = `dockX(edge, 实测宽)`，y = 持久化 offsetY 的视觉钳位（不回写存储）。`onWinResize` 改为调 `applyDock()`（client.mjs:1049 的手工钳位段删除）。
- rAF/matchMedia：统一走 `scheduleFrame(fn)`（rAF 或同步兜底）；拖拽释放的动画路径以 `typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: no-preference)').matches` 守卫——**jsdom 29 无 matchMedia（实测 undefined），无守卫即 TypeError**，undefined 时直接提交；CSS 层的 reduced-motion 由媒体查询独立兜底。评审探针实测（pretendToBeVisual:true fixture）：`requestAnimationFrame` 为 function、`matchMedia` 为 undefined——Task 5 Step 0 对仓库 fixture 复核后据此写断言。
- 长按与原生 contextmenu 竞态：Android 长按会先触发定时器、后触发原生 `contextmenu`，`onSurfaceContext`（client.mjs:860）加 `if (!menu.hidden) return` 幂等守卫。
- 版面切换：`placePanel()`（client.mjs:734）在 `win.innerWidth <= 480` 时清空内联 left/top 并加 `.dqw-panel--sheet` 类，位置交给 CSS（含 `env(safe-area-inset-bottom)` 与 `100dvh` 渐进行）。

## 全局约束（自设计共识逐字继承）

- 不新增任何运行时依赖；`engines.node >= 20`；`dsh.engines.dsh: ">=0.1.7-rc.2"` 不变。
- 命名规则：CSS 类前缀 `dqw-`；dataset 前缀 `data-dsh-quota-watch-*`；localStorage key 前缀 `dsh-quota-watch:`。本次新增 key 仅一个：`dsh-quota-watch:float-dock`；`dsh-quota-watch:float-geometry` 退役（值不迁移、不删除，留在用户存储里无害）。
- 主题规则：所有新颜色走 `--dsw-alias-*` 变量 + 硬编码 fallback；不引入新颜色语义（维持现有 warn/danger 编码，不改正常态配色）。
- 文案规则：COPY 无新增（长按复用现有菜单文案）；zh/en 双语结构不动。
- 安全规则：provider 数据一律 `textContent` 写入，不拼 markup；`npm run security:check` 必须通过；不引入真实凭据。
- 动画规则：只允许 `transform/opacity` 参与动画；一切动画与过渡包裹在 `@media (prefers-reduced-motion: no-preference)` 内。
- a11y 底线：现有 `role="button"`、`tabIndex=0`、`aria-haspopup="dialog"`、`aria-expanded`、`:focus-visible` 轮廓全部保持，不低于现状。
- 发布口径：版本 `0.1.11` 只发不宣；**不动 `dsh-m/registry.json`**（verified 为 DSH 运行时代际 `["0.1.7-rc.2","0.1.0"]`，本次不改引擎下限；registry description 的「悬浮球」措辞漂移是 0.1.7 遗留，留待下次文案刷新）；know-how 无义务（`attachShadow` 判据不变）。

## 输入工件

- 设计共识：2026-10-02 `/grill-with-docs` 三轮（本文「目标」「全局约束」即其固化）。
- ADR：`docs/adr/0002-magnetic-edge-docking.md`（本次产出，Task 1 入库）；`docs/adr/0001-shadow-dom-ui-isolation.md`（约束不动摇）。
- 术语表：`GLOSSARY.md`（capsule / edge docking / panel；ball 已退役，本次已修订）。
- 现状锚点（client.mjs @ 0.1.10，行号为辅助定位）：`SURFACE_SIZE=38`/`SURFACE_MARGIN=16`（L11-12）、`FLOAT_STYLE_TEXT`（L118）、`buildCapsule`（L402）、`applyFloatGeometry`（L431-446）、`attachDrag`（L460-506）、`placePanel`（L734）、`renderFloatFace`（L789-820）、`renderAll`（L903，:924 调 renderFloatFace）、`onSurfaceContext`（L860）、`onWinResize`（L1049-1063）、监听装/卸（L1087-1118）；`src/client/prefs.mjs` 全文（68 行）。
- 待迁移测试（tests/client.test.mjs，以测试名为准）：`capsule restores persisted geometry and clamps off-screen positions`（L456）、`capsule drag persists clamped geometry and suppresses the trailing click`（L480）、`a press-release without movement keeps the click behavior`（L502）、`capsule drag persists geometry`（L571）。
- jsdom 29 实测事实（float-ball 计划遗留 + 2026-10-02 评审探针复核）：`requestAnimationFrame` 为 function、`matchMedia` **不存在**（fixture pretendToBeVisual:true；无 matchMedia）；`innerWidth/innerHeight` 可直接赋值（先例 tests/client.test.mjs:975 用 defineProperty）；`setPointerCapture` 不存在（实现可选调用）；`MouseEvent` 构造器无 pointerType 入参（派发后 `Object.defineProperty(event,'pointerType',{value:'touch'})` 可补）；`new Event(type)` 默认 `bubbles:false`；`getBoundingClientRect` 返回 0；事件统一用 `MouseEvent('pointermove', {clientX, clientY, bubbles:true})` 派发到 `document`；storage 测试用带 url 的 JSDOM 或 Map stub。

## 文件结构与职责

- Modify: `src/client/prefs.mjs` — Task 2 新增 dock 偏好 API 与 insets 感知 `clampPoint`；Task 4 移除 geometry 三件套。纯逻辑、无 DOM import，可独立单测。
- Create: `src/client/drag.mjs` — Task 3 产出拖拽/贴边全部纯函数（阈值、抓取偏移、拖拽中钳位、释放贴边、贴边 x 推导）。无 DOM import。
- Modify: `src/client.mjs` — Task 4/5 接线 dock 渲染与拖拽管线；Task 6 触摸可用性；Task 7 长按菜单；Task 8 safe-area；Task 9 面板弹层；Task 10 性能卫生；Task 11 视觉微交互。全部 UI 文本样式改动集中在 `FLOAT_STYLE_TEXT`。
- Test: `tests/prefs.test.mjs`（Task 2 扩充、Task 4 删旧几何用例）、Create `tests/drag.test.mjs`（Task 3）、`tests/client.test.mjs`（Task 4-11 重度迁移/新增）。
- Modify: `package.json`（Task 12 版本号）、`README.md`（Task 12，仅 L9 中文功能条目与 L50 English summary 两处措辞）。
- 边界稳定：`src/host.mjs`、`src/shared.mjs`、`src/core/adapters.mjs`、`cordis.patch.yml`、`scripts/build-client.mjs`，以及除 `tests/client.test.mjs`（Task 4-11 重度修改，不在稳定区）外的既有测试文件（`tests/host.test.mjs`、`tests/adapters.test.mjs`、`tests/credentials.test.mjs`、`tests/security-scan.test.mjs`、`tests/package-shape.test.mjs`）。

## 接口契约总表

prefs 模块（Task 2 产出；Task 4 删除带 ⛔ 的旧件）：

```js
export const FLOAT_DOCK_KEY = 'dsh-quota-watch:float-dock'
export const MARGIN = 8                                  // 现有模块私有 MARGIN 转导出
export function clampPoint(point, viewport, size, insets)
// size: number | {width,height}（number 视为正方形，兼容旧调用）；insets 可缺省 = {left:0,right:0,top:0,bottom:0}
// 可用区：x ∈ [insets.left+MARGIN, viewport.width−insets.right−MARGIN−w]，y 同理；区间退化时取 MARGIN 下限（沿用现有 Math.max 守卫）
export function loadFloatDock(storage)   // → {edge:'left'|'right', offsetY:number} | null
// 缺失/空串/损坏 JSON/edge 非法/offsetY 非有限数 → null（try/catch 全包）
export function saveFloatDock(storage, dock)
// edge ∉ {'left','right'} 或 offsetY 非有限数 → TypeError；内部 try/catch setItem
⛔ FLOAT_GEOMETRY_KEY / loadFloatGeometry / saveFloatGeometry   // Task 4 连同引用一并删除
```

drag 模块（Task 3 产出；全 DOM 无关）：

```js
export const DRAG_SLOP_MOUSE = 6
export const DRAG_SLOP_TOUCH = 10
export const LONG_PRESS_MS = 500
export function dragSlop(pointerType)        // 'touch'|'pen' → DRAG_SLOP_TOUCH，其余（含 undefined）→ DRAG_SLOP_MOUSE
export function grabOffset(point, rect)      // → {dx: point.x−rect.left, dy: point.y−rect.top}
export function clampFrame(point, grab, size, viewport, insets)
// 拖拽中实时钳位：→ {x,y} 为胶囊 top-left，= clampPoint((point.x−grab.dx, point.y−grab.dy), viewport, size, insets)
export function releaseDock(point, grab, size, viewport, insets)
// → {edge:'left'|'right', offsetY:number}：以 (point.x−grab.dx + size.width/2) 是否过视口中线判边；
//   offsetY = clampPoint 纵向钳位后的 top-y
export function dockX(edge, width, viewport, insets)
// 'left' → insets.left + MARGIN；'right' → viewport.width − insets.right − MARGIN − width
export function parseInset(computedValue)    // → parseFloat || 0（''/'auto'/NaN → 0；Task 8 消费）
```

client.mjs 内部契约（不导出，测试经 DOM/storage 观察）：

```js
const FALLBACK_SIZE = { width: 38, height: 26 }      // 替代 SURFACE_SIZE；rect.width 为 0 时使用
const scheduleFrame = (fn) => (typeof win.requestAnimationFrame === 'function'
  ? win.requestAnimationFrame.call(win, fn) : fn())   // Task 5 起，拖拽与滚动合帧共用
const applyDock = () => { … }                         // Task 4：渲染静止位（renderFloatFace paint 后调用；onWinResize 复用）
// Task 8 增：readInsets() — 浮层 shadow 内探针 div（pointer-events:none; visibility:hidden; position:fixed;
//   padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)），
//   getComputedStyle 读四边 parseFloat，NaN → 0；resize 时重探
```

CSS 契约（进 `FLOAT_STYLE_TEXT`）：

```css
.dqw-capsule { position:relative; touch-action:none; -webkit-tap-highlight-color:transparent;
  -webkit-touch-callout:none; cursor:grab; }            /* Task 6/11 */
.dqw-capsule::before { content:''; position:absolute; inset:-9px; }   /* 26px 视觉 → 44px 热区，Task 6 */
.dqw-capsule--dragging { cursor:grabbing; backdrop-filter:none; -webkit-backdrop-filter:none;
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #1f1f1f));
  will-change:transform; transition:none; }             /* Task 5 */
.dqw-capsule--snapping { transition: transform 150ms cubic-bezier(.2,.8,.2,1); }  /* Task 5，仅 no-preference 内 */
.dqw-panel--sheet { left:8px; right:8px; top:auto; bottom:calc(8px + env(safe-area-inset-bottom, 0px));
  width:auto; max-width:none; max-height:calc(100dvh - 24px); }  /* Task 9，追加在基类 100vh 行后 */
```

## 任务清单

### Task 1: feat/capsule-polish 分支 + grill 产物入库

- 目标：开分支，把 ADR 0002、GLOSSARY 修订与本计划文档先行定向入库（避免后续 `-am` 误卷）。
- Files: 无新增（`GLOSSARY.md`、`docs/adr/0002-magnetic-edge-docking.md`、本计划文档已在工作树）
- 验证范围: `git log --oneline -1` 显示 docs commit 且 `git status` 干净
- 接口契约: Consumes: 工作树中已写入的 `GLOSSARY.md`、`docs/adr/0002-magnetic-edge-docking.md`、`docs/plans/2026-10-02-capsule-polish-implementation-plan.md`。Produces: 分支 `feat/capsule-polish`；三份文档入库。
- [ ] Step 1: 确认分支与游离文件
  - Run: `git -C ~/workspace/dsh-quota-watch status --short && git branch --show-current`
  - Expected: 当前在 `main`，游离文件恰为三项：` M GLOSSARY.md`、`?? docs/adr/0002-magnetic-edge-docking.md`、`?? docs/plans/2026-10-02-capsule-polish-implementation-plan.md`（若出现其他游离文件，停下说明，不盲目提交）
- [ ] Step 2: 建分支并定向提交
  - Run: `git -C ~/workspace/dsh-quota-watch checkout -b feat/capsule-polish && git add GLOSSARY.md docs/adr/0002-magnetic-edge-docking.md docs/plans/2026-10-02-capsule-polish-implementation-plan.md && git commit -m "docs: edge-docking ADR + glossary rewrite + 0.1.11 implementation plan"`
  - Expected: commit 成功
- [ ] Step 3: 确认
  - Run: `git -C ~/workspace/dsh-quota-watch log --oneline -1 && git status --short`
  - Expected: 顶部为 `docs: edge-docking …`，status 干净

### Task 2: prefs.mjs 新增 float-dock 偏好 API

- 目标：TDD 新增 dock 读写与 insets 感知钳位；旧 geometry 三件套本任务不动（先加后删，保持每任务全绿）。
- Files: Modify `src/client/prefs.mjs`；Test: `tests/prefs.test.mjs`
- 验证范围: `node --test tests/prefs.test.mjs` 全绿（新旧用例都在）
- 接口契约:
  - Consumes: 无（现有 `clampPoint(point, viewport, size = 0)` 向后兼容扩展；现有 `MARGIN = 8` 私有常量转导出）。
  - Produces: `FLOAT_DOCK_KEY`、`MARGIN`、`clampPoint(point, viewport, size, insets)`（size: number|{width,height}，insets 缺省全 0）、`loadFloatDock(storage)`、`saveFloatDock(storage, dock)`（签名与语义见「接口契约总表」prefs 段）。
- [ ] Step 1: 写失败测试。在 `tests/prefs.test.mjs` 追加：① `loadFloatDock` 对缺失/`''`/`'{'`/`'{"edge":"top","offsetY":1}'`/`'{"edge":"left","offsetY":"a"}'` 均 → `null`，`'{"edge":"left","offsetY":80}'` roundtrip → `{edge:'left',offsetY:80}`；② `saveFloatDock(stub,{edge:'top',offsetY:0})` 与 `{edge:'left',offsetY:NaN}` 均 抛 `TypeError`，合法值写入 `FLOAT_DOCK_KEY`；③ `clampPoint({x:-5,y:9999},{width:800,height:600},{width:120,height:26})` → `x===8` 且 `y<=566`；④ insets：`clampPoint({x:0,y:0},{width:800,height:600},{width:120,height:26},{left:20,top:10,right:0,bottom:0})` → `{x:28,y:18}`；⑤ number size 兼容：`clampPoint({x:-5,y:-5},{width:800,height:600},38)` → `{x:8,y:8}`（现有用例继续通过）。
  - Run: `node --test tests/prefs.test.mjs`
  - Expected: 红——`FLOAT_DOCK_KEY`/`loadFloatDock`/`saveFloatDock` 不存在（import 报错或断言失败）
- [ ] Step 2: 运行确认失败
  - Run: `node --test tests/prefs.test.mjs`
  - Expected: 新增用例失败，既有用例全绿
- [ ] Step 3: 最小实现。prefs.mjs：导出 `MARGIN`；`clampPoint` 把 size 归一化为 `{width,height}`（number → 正方形）、insets 缺省全 0，min/max 区间按「接口契约总表」公式；新增 `FLOAT_DOCK_KEY`/`loadFloatDock`/`saveFloatDock`（结构仿现有 `loadSurfaceFlags`/`saveSurfaceFlags` 的 try/catch 与类型校验风格）。
  - Change: 仅 prefs.mjs，无 DOM import
- [ ] Step 4: 运行确认通过
  - Run: `node --test tests/prefs.test.mjs && node --test`
  - Expected: prefs 全绿 + 全仓测试绿（client.mjs 旧调用不受影响）
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/prefs.mjs tests/prefs.test.mjs && git commit -m "feat(prefs): float-dock preference API with insets-aware clamping"`

### Task 3: 新建 src/client/drag.mjs 拖拽纯逻辑模块

- 目标：DOM 无关的阈值/偏移/钳位/贴边纯函数，TDD 全覆盖。
- Files: Create `src/client/drag.mjs`；Test: Create `tests/drag.test.mjs`
- 验证范围: `node --test tests/drag.test.mjs` 全绿
- 接口契约:
  - Consumes: `import { clampPoint, MARGIN } from './prefs.mjs'`（Task 2：`clampPoint(point, viewport, size, insets)`、`MARGIN=8`）。
  - Produces: `DRAG_SLOP_MOUSE=6`、`DRAG_SLOP_TOUCH=10`、`LONG_PRESS_MS=500`、`dragSlop(pointerType)`、`grabOffset(point, rect)`、`clampFrame(point, grab, size, viewport, insets)`、`releaseDock(point, grab, size, viewport, insets)`、`dockX(edge, width, viewport, insets)`（语义见「接口契约总表」drag 段；`clampFrame`/`releaseDock` 均以 `grab` 修正 top-left 后过 `clampPoint`）。
- [ ] Step 1: 写失败测试。`tests/drag.test.mjs`：① `dragSlop('touch')===10`、`dragSlop('pen')===10`、`dragSlop('mouse')===6`、`dragSlop(undefined)===6`；② `grabOffset({x:100,y:50},{left:80,top:40,right:200,bottom:66,width:120,height:26})` → `{dx:20,dy:10}`；③ `clampFrame({x:-50,y:9999},{dx:20,dy:10},{width:120,height:26},{width:800,height:600},{left:0,right:0,top:0,bottom:0})` → `{x:8,y:566}`（=(−70, 9989) 钳位后，纵向 max = 600−8−26）；④ `releaseDock({x:210,y:100},{dx:0,dy:0},{width:120,height:26},{width:400,height:800})` → `edge==='right'`（中心 270 过中线 200）、`offsetY===100`；`releaseDock({x:30,…同参…})` → `edge==='left'`；y=9999 → `offsetY===766`（800−8−26）；⑤ `dockX('left',120,{width:400,height:800},{left:0,right:0,top:0,bottom:0})===8`、`dockX('right',120,…)===272`、带 insets `{left:20,right:10}` 时分别为 `28`/`262`。
  - Run: `node --test tests/drag.test.mjs`
  - Expected: 红——模块不存在，加载失败
- [ ] Step 2: 运行确认失败
  - Run: `node --test tests/drag.test.mjs`
  - Expected: `Cannot find module` 类失败
- [ ] Step 3: 最小实现。`src/client/drag.mjs`：三常量 + 五函数，无 DOM import；`clampFrame`/`releaseDock` 内部 `import { clampPoint, MARGIN } from './prefs.mjs'` 复用钳位。
  - Change: 仅新模块
- [ ] Step 4: 运行确认通过
  - Run: `node --test tests/drag.test.mjs && node --test`
  - Expected: drag 全绿 + 全仓绿
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/drag.mjs tests/drag.test.mjs && git commit -m "feat(client): dom-free drag state machine with edge docking"`

### Task 4: client.mjs 贴边位置记忆落地 + float-geometry 退役

- 目标：静止位语义切换为 `{edge, offsetY}`——mount 读取、渲染重推导、resize 复用、拖拽释放分支持久化 dock（本任务拖拽的**移动方式**仍是旧行为，Task 5 才改）；删 geometry 三件套与 `SURFACE_SIZE`/`SURFACE_MARGIN`。
- Files: Modify `src/client.mjs`（`applyFloatGeometry`→`applyDock`、`renderFloatFace` 末尾挂 `applyDock()`、`onWinResize`、`attachDrag` 的 `onPointerUp` 持久化分支、import 行、`SURFACE_SIZE`/`SURFACE_MARGIN` 常量）；Test: `tests/client.test.mjs`（迁移 L456、L480、L571 的存储断言；L502 不动）
- 验证范围: `node --test tests/client.test.mjs` 全绿，且 `grep -n "loadFloatGeometry\|saveFloatGeometry\|FLOAT_GEOMETRY_KEY\|SURFACE_SIZE\|SURFACE_MARGIN" src/client.mjs` 无输出
- 接口契约:
  - Consumes: Task 2 的 `FLOAT_DOCK_KEY`/`loadFloatDock(storage)`/`saveFloatDock(storage, dock)`/`clampPoint`；Task 3 的 `releaseDock(point, grab, size, viewport, insets)`、`dockX(edge, width, viewport, insets)`。
  - Produces: client.mjs 内部 `applyDock()`（renderFloatFace paint 后与 onWinResize 共用）、`FALLBACK_SIZE={width:38,height:26}`；storage key `dsh-quota-watch:float-dock` 的读/写路径。
- [ ] Step 1: 迁移测试（存储与静止位断言）：① L456 改为预置 `localStorage[FLOAT_DOCK_KEY]='{"edge":"left","offsetY":80}'` → mount 后 `floatHost.style.top === '80px'` 且 `style.left === '8px'`；预置越界 `'{"edge":"left","offsetY":99999}'`（**用例前置**：mount 前 `Object.defineProperty(window,'innerHeight',{value:600,configurable:true})`，沿先例 tests/client.test.mjs:975；用后还原）→ `top` 钳到 `<=566`（600−8−26）且 **storage 原值不变**（视觉钳位不回写，保留现语义）；损坏 JSON → 默认 `{edge:'right'}`，`left === innerWidth−8−width` 量级（jsdom rect=0 → 用 FALLBACK 宽 38 断言 `left === innerWidth−8−38`）。② L480/L571 的持久化断言改为：拖拽释放后 `localStorage[FLOAT_DOCK_KEY]` 为合法 `{edge, offsetY}`（**本任务 grab={0,0}，指针即胶囊左上角，edge 与释放点半屏一致**；Task 5 起不变式改为「edge 跟随胶囊释放中心」），且 host `left/top` 与该 dock 一致；「钳回」断言删去 38 字面量、改用 FALLBACK 常量推导的界。③ 新增：预置 `{"edge":"right","offsetY":80}` 且 stub `getBoundingClientRect` 返回 `width:120` → mount 后 `style.left === (innerWidth−8−120)px`（实测宽度参与推导）。
  - Run: `node --test --test-name-pattern "geometry|drag|persist" tests/client.test.mjs`
  - Expected: 红（实现仍是 geometry + 38 钳位）
- [ ] Step 2: 运行确认失败
  - Run: `node --test --test-name-pattern "geometry|drag|persist" tests/client.test.mjs`
  - Expected: 迁移后的用例红，其余绿
- [ ] Step 3: 最小实现。client.mjs：import 行换 dock API 与 drag 的 `releaseDock`/`dockX`；`FALLBACK_SIZE` 替代 `SURFACE_SIZE`；`applyFloatGeometry` 重写为 `applyDock()`：`const dock = loadFloatDock(storage) ?? {edge:'right', offsetY: viewHeight − MARGIN − FALLBACK_SIZE.height}`，x=`dockX(dock.edge, surface.getBoundingClientRect().width || FALLBACK_SIZE.width, viewport, ZERO_INSETS)`，y=`clampPoint 纵向钳位`，写 host left/top（不回写）；`renderFloatFace` 末尾（paint 之后，client.mjs:820 前）调 `applyDock()`；`onWinResize` 删手工钳位段改调 `applyDock()`；`attachDrag.onPointerUp` 的钳位+持久化段改为 `releaseDock({x:clientX,y:clientY},{dx:0,dy:0},实测尺寸||FALLBACK_SIZE,viewport,ZERO_INSETS)` → 施用 dock（left/top）+ `saveFloatDock`；删 geometry 三件套 import 与实现、`SURFACE_MARGIN` 常量（client.mjs:12，默认落点语义已由 dock 默认值取代）；prefs.mjs 里同步删除（连同 tests/prefs.test.mjs 对应用例——与 Step 1 同 commit）。
  - Change: client.mjs / prefs.mjs / 两测试文件
- [ ] Step 4: 运行确认通过
  - Run: `node --test && grep -n "loadFloatGeometry\|saveFloatGeometry\|FLOAT_GEOMETRY_KEY\|SURFACE_SIZE\|SURFACE_MARGIN" src/client.mjs; echo "grep-exit:$?"`
  - Expected: 测试全绿；grep 无输出（exit 1）
- [ ] Step 5: checkpoint commit
  - Run: `git commit -am "feat(client): edge-docked position memory (retires float-geometry)"`
  - Expected: commit 成功（Step 0 已确认无游离文件）

### Task 5: client.mjs transform 拖拽管线（grab-offset + rAF + 贴边动画）

- 目标：拖拽移动改为跟手管线——抓取点偏移保持、`transform` 位移、rAF 合帧、松手贴边动画后提交；退役「左上角钉光标」。
- Files: Modify `src/client.mjs`（`attachDrag` 整体重写、`FLOAT_STYLE_TEXT` 增 `--dragging`/`--snapping`、`scheduleFrame`）；Test: `tests/client.test.mjs`（迁移 L480/L571 的**移动断言**）
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约:
  - Consumes: Task 3 全部导出（`dragSlop` 本任务只接 `dragSlop(event.pointerType)` 于阈值比较；`grabOffset`、`clampFrame`、`releaseDock`、`dockX`）；Task 4 的 `applyDock()`、`FALLBACK_SIZE`、`saveFloatDock`。
  - Produces: `scheduleFrame(fn)`（rAF 或同步兜底）；CSS 类 `.dqw-capsule--dragging`、`.dqw-capsule--snapping`（语义见 CSS 契约）。
- [ ] Step 0: fixture 能力复核（评审探针已给参考值，此步对仓库 dom() fixture 确认）：`console.log(typeof window.requestAnimationFrame, typeof window.matchMedia)`。预期 `function` / `undefined`。据实决定：① 拖拽断言前是否需要 `await new Promise(r => scheduleFrame(r))` 对齐一帧；② 动画路径用例（⑥）是否必须 stub matchMedia（undefined 时必须）。结论写进本任务测试注释。
  - Run: `node --test --test-name-pattern "drag" tests/client.test.mjs`（带临时探针）
  - Expected: 获得确定的 'function' | 'undefined'，随后删除探针
- [ ] Step 1: 迁移测试（移动断言）：① L480/L571 拖拽序列改为——`pointerdown`（含 rect stub，**left/top 设为静止位**、`{width:120,height:26}`，记录 `host.style.left/top` 为静止位）→ `pointermove` Δ≥slop → 断言 `surface.style.transform` 匹配 `/translate3d\(/` 且 **host `style.left/top` 未变**；rAF 异步则先对齐一帧；② `pointermove` 到右半屏 `pointerup` → 断言 host `style.left/top` 更新为贴边值、`surface.style.transform === ''`、`--dragging`/`--snapping` class 移除、storage 为 dock 且 **edge 跟随胶囊释放中心**（= 静止位 + 位移，非指针位置；rect stub left/top 已设为静止位使 grabOffset 语义真实）、尾随 `click` 被抑制（panel 不开）——jsdom 默认无 matchMedia，本用例同时覆盖「守卫直提交」分支；③ 新增：`pointerdown` 时抓取点在胶囊中部（`grab.dx=60`）→ 指针**右移 30px** → 对齐一帧后 transform 的 dx ≈ `+30`（胶囊整体随指右移 30，抓取点保持在指下；非左上角钉指针）；④ 新增：drag 中断言 `surface.className` 含 `dqw-capsule--dragging`（挂起毛玻璃的载体存在）；⑤ `FLOAT_STYLE_TEXT` 字符串断言含 `--dragging`、`--snapping`、`will-change:transform`、`backdrop-filter:none`；⑥ 动画提交路径（stub）：`Object.defineProperty(win,'matchMedia',{value:() => ({matches:true}),configurable:true})` 后走一次释放 → 断言 `--snapping` 出现、200ms 兜底到时后提交完成（host 贴边、transform 清空、class 全移除、storage 为 dock）且**提交恰好一次**（transitionend 与 timer 先到先清，不双写；jsdom 验证手段：释放后立即向 `surface` 派发 `new Event('transitionend')`——监听在 surface 自身，无需冒泡——对齐一帧后断言已提交且 class 已清，再等 >200ms 断言 storage/transform 无二次变化，先到先清得证）。
  - Run: `node --test --test-name-pattern "drag" tests/client.test.mjs`
  - Expected: 红（实现仍是 left/top 跟随）
- [ ] Step 2: 运行确认失败
  - Run: `node --test --test-name-pattern "drag" tests/client.test.mjs`
  - Expected: ①③④⑤⑥ 红，② 绿（② 的贴边/存储/click 抑制断言在 Task 4 已落地；--dragging/--snapping 的「移除」断言对尚不存在的类恒真）
- [ ] Step 3: 最小实现。重写 `attachDrag(surfaceEl)`：`onPointerDown`（button 0）→ 实测 rect（0 → FALLBACK_SIZE）+ `grabOffset` + `setPointerCapture?.` + 加 `--dragging` class + 记录静止位；`onPointerMove` → 过 `dragSlop(event.pointerType)` 后置 `moved`、`doc.body.style.userSelect='none'`、暂存最新 point 并 `scheduleFrame` 内 `surfaceEl.style.transform = translate3d(dx,dy,0) scale(1.03)`（dx/dy = `clampFrame(point,grab,size,…)` 减静止位）；`onPointerUp` → `releaseDock` 得 `{edge,offsetY}`：动画路径（`typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: no-preference)').matches`——**jsdom 无 matchMedia，必须带 typeof 守卫**，undefined 时直提交；CSS 层 reduced-motion 由媒体查询独立兜底）加 `--snapping` 并把 transform 设为贴边终态偏移，`transitionend` **或** 200ms timer（先到先清，防双触发）后提交；提交 = host `left=dockX(edge,…)`、`top=offsetY`、清 transform 与 class、`saveFloatDock`、`suppressNextClick=true`；非动画路径直接提交。`doc.body.style.userSelect` 恢复。`scheduleFrame` 定义落位。阈值比较改 `dragSlop(event.pointerType)`（Task 6 前行为等价：mouse 6px）。
  - Change: client.mjs 的 attachDrag 与 FLOAT_STYLE_TEXT
- [ ] Step 4: 运行确认通过
  - Run: `node --test`
  - Expected: 全仓绿
- [ ] Step 5: checkpoint commit
  - Run: `git commit -am "feat(client): grab-offset transform drag with snap-to-edge release"`

### Task 6: 触摸拖拽可用性（touch-action / pointercancel / 44px 热区）

- 目标：触摸设备上拖拽可用且不与滚动竞争；`pointercancel` 干净收场；热区达标。
- Files: Modify `src/client.mjs`（`FLOAT_STYLE_TEXT` 增补 + `attachDrag` 增 pointercancel 分支）；Test: `tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿，且 `grep -c "touch-action" src/client.mjs` ≥ 1
- 接口契约:
  - Consumes: Task 5 的重写后 `attachDrag`（挂载点：`surfaceEl.addEventListener('pointerdown', …)` 与 doc 级 move/up）；CSS 契约 `.dqw-capsule` 与 `::before` 段。
  - Produces: `pointercancel` 处理路径（恢复 userSelect、清 transform/class、不持久化）；`::before` 热区（inset:-9px）。
- [ ] Step 1: 写失败测试：① `FLOAT_STYLE_TEXT` 字符串断言含 `touch-action:none`、`-webkit-tap-highlight-color:transparent`、`-webkit-touch-callout:none`、`::before` 与 `inset:-9px`（jsdom 不可断言计算样式，样式按文本断言——本仓先例：样式自愈测试）；② 分级 slop 行为：`pointerType:'touch'`（MouseEvent 无 pointerType → 用 `Object.defineProperty(event,'pointerType',{value:'touch'})` 或派发后补赋值，以 jsdom 实测可行者为准）位移 8px → transform 为空（未达 10px 阈值）；位移 12px → 进入拖拽；同位移在默认 pointerType 下 8px 已拖拽（6px 阈值）；③ pointercancel：drag 中向 `surface` 派发 `new Event('pointercancel', {bubbles:true})`（move/up/cancel 挂在 doc，依赖冒泡）→ transform 清空、storage 不变、`doc.body.style.userSelect === ''`、class 移除。
  - Run: `node --test --test-name-pattern "touch|cancel|slop" tests/client.test.mjs`
  - Expected: 红（无 touch-action 文本、slop 恒 6、无 cancel 处理）
- [ ] Step 2: 运行确认失败
  - Run: `node --test --test-name-pattern "touch|cancel|slop" tests/client.test.mjs`
  - Expected: ①②③ 红
- [ ] Step 3: 最小实现。CSS 按契约补 `.dqw-capsule` 四项与 `::before`；`attachDrag`：`onPointerDown` 记 `slop = dragSlop(event.pointerType)`（替代 Task 5 的直接调用）；挂 `pointercancel` 监听（与 move/up 同生命周期）→ 处理函数置 `dragging=false`、清 transform/class、恢复 userSelect、**不持久化不抑制 click**。
  - Change: client.mjs 的 attachDrag 与 FLOAT_STYLE_TEXT
- [ ] Step 4: 运行确认通过
  - Run: `node --test && grep -c "touch-action" src/client.mjs`
  - Expected: 全仓绿；计数 ≥ 1
- [ ] Step 5: checkpoint commit
  - Run: `git commit -am "feat(client): touch drag usability (touch-action, pointercancel, 44px hit area)"`

### Task 7: 长按菜单（500ms + 振动 + contextmenu 幂等守卫）

- 目标：触摸长按呼出右键菜单，补 iOS 无 contextmenu 的入口缺口；与 Android 原生 contextmenu 双路径互斥。
- Files: Modify `src/client.mjs`（`attachDrag` 增长按定时器、`onSurfaceContext` 守卫、`navigator.vibrate` 消费）；Test: `tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约:
  - Consumes: Task 3 的 `LONG_PRESS_MS=500`、`dragSlop`；现有 `openMenu()`（client.mjs:841）、`suppressNextClick` 标志（client.mjs:456）；`attachDrag` 的 pointerdown/move/up 生命周期（Task 5/6 后形态）。
  - Produces: 长按触发路径——菜单经现有 `openMenu()` 打开、`menu.hidden === false`；`onSurfaceContext` 幂等语义（菜单已开 → 仅 `preventDefault`）。
- [ ] Step 1: 写失败测试：① touch `pointerdown` 后推进 520ms（`await new Promise(r => setTimeout(r, 520))`）→ `menu.hidden === false`；随后的 `pointerup` → panel 不开（长按抑制尾随 click）；② down 后 50ms 内 up → 菜单不开、click 正常开 panel；③ down → 位移超 slop → up → 菜单不开（移动取消定时器）；④ 菜单已开时再向 surface 派发 contextmenu → `menu` 子节点引用不变（`replaceChildren` 未重播，幂等守卫生效）；⑤ mouse `pointerdown` 推进 520ms → 菜单不开（长按仅 touch/pen）。
  - Run: `node --test --test-name-pattern "long.?press|menu" tests/client.test.mjs`
  - Expected: ①③④ 红（无长按、无守卫），⑤ 红，② 视现行为绿
- [ ] Step 2: 运行确认失败
  - Run: `node --test --test-name-pattern "long.?press|menu" tests/client.test.mjs`
  - Expected: 红
- [ ] Step 3: 最小实现。`attachDrag.onPointerDown`：`pointerType` 为 touch/pen 时起 `setTimeout(LONG_PRESS_MS)` 定时器；`onPointerMove`（超 slop）与 `onPointerUp`/`onPointerCancel` 先 `clearTimeout`；定时器触发 → `try { win.navigator.vibrate?.(10) } catch {}` → `openMenu()` → `suppressNextClick = true`；`onSurfaceContext` 改为 `event.preventDefault(); if (!menu.hidden) return; openMenu()`。
  - Change: client.mjs
- [ ] Step 4: 运行确认通过
  - Run: `node --test`
  - Expected: 全仓绿
- [ ] Step 5: checkpoint commit
  - Run: `git commit -am "feat(client): long-press context menu for touch (iOS parity)"`

### Task 8: safe-area 探针与 insets 接线

- 目标：iPhone 刘海/小黑条不遮挡胶囊——clamp 与贴边推导吃进 `env(safe-area-inset-*)`。
- Files: Modify `src/client.mjs`（探针 div、`readInsets()`、`applyDock`/`attachDrag` 传 insets）；Test: `tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约:
  - Consumes: Task 2 的 `clampPoint(point, viewport, size, insets)`；Task 3 的 `dockX(edge, width, viewport, insets)`、`releaseDock(point, grab, size, viewport, insets)`；Task 4 的 `applyDock()`。
  - Produces: client.mjs 内部 `readInsets()`（→ `{left,right,top,bottom}`，NaN → 0）与浮层 shadow 内探针 div（`pointer-events:none; visibility:hidden; position:fixed`）。
- [ ] Step 1: 写失败测试：① 纯解析：在 drag.mjs **永久导出** `parseInset`（契约总表 drag 段）并在 `tests/drag.test.mjs` 增补用例：`parseInset('20px')===20`、`parseInset('')===0`、`parseInset('auto')===0`（NaN → 0）；② 接线：stub 探针路径——jsdom `getComputedStyle` 返回空 → insets 全 0，现测试全部不受影响（回归断言：Task 4 的贴边用例值不变）；stub `getComputedStyle` 返回 `paddingLeft:'20px'`（探针方向）→ 预置 `{"edge":"left","offsetY":80}` mount 后 `style.left === '28px'`（MARGIN 8 + inset 20）。
  - Run: `node --test --test-name-pattern "inset|safe" tests/client.test.mjs && node --test tests/drag.test.mjs`
  - Expected: 红（parseInset 不存在、insets 未接线时 stub 无效果）
- [ ] Step 2: 运行确认失败
  - Run: `node --test --test-name-pattern "inset|safe" tests/client.test.mjs`
  - Expected: ② 红（①若先实现则绿——两 Step 顺序允许对调，红信号以 ② 为准）
- [ ] Step 3: 最小实现。drag.mjs 加 `parseInset`；client.mjs 建 `readInsets()`（探针 div 四边 env()，`getComputedStyle` 读取，`parseInset` 归一，resize 时重探缓存），`applyDock` 与 `attachDrag` 释放路径的 insets 实参从 `ZERO_INSETS` 换成 `readInsets()`。
  - Change: drag.mjs + client.mjs
- [ ] Step 4: 运行确认通过
  - Run: `node --test`
  - Expected: 全仓绿
- [ ] Step 5: checkpoint commit
  - Run: `git commit -am "feat(client): safe-area insets in clamp and dock placement"`

### Task 9: 面板底部弹层（≤480px）

- 目标：窄视口面板从「锚在胶囊旁」改为底部居中弹层，不再遮死胶囊。
- Files: Modify `src/client.mjs`（`placePanel` 分支 + `FLOAT_STYLE_TEXT` 增 `--sheet`）；Test: `tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约:
  - Consumes: 现有 `placePanel()`/`lastAnchor`（client.mjs:731-758）；`win.innerWidth`（jsdom 可直接赋值）；CSS 契约 `.dqw-panel--sheet` 段。
  - Produces: `.dqw-panel--sheet` 类语义——`placePanel` 窄视口时加类并清空内联 left/top，宽视口移除类并走内联定位。
- [ ] Step 1: 写失败测试：① `win.innerWidth = 400` → 开面板后 `panel.classList.contains('dqw-panel--sheet') === true` 且 `panel.style.left === ''`；② `innerWidth = 800` → class 为 false 且 `style.left` 非空；③ 400 → resize 到 800（派发 `win` 的 resize）→ class 移除；④ `FLOAT_STYLE_TEXT` 断言含 `--sheet`、`safe-area-inset-bottom`、`100dvh`。
  - Run: `node --test --test-name-pattern "sheet|panel" tests/client.test.mjs`
  - Expected: ①③④ 红
- [ ] Step 2: 运行确认失败
  - Run: `node --test --test-name-pattern "sheet|panel" tests/client.test.mjs`
  - Expected: 红
- [ ] Step 3: 最小实现。`placePanel()` 开头：`win.innerWidth <= 480` → 加 `--sheet`、`panel.style.left = ''; panel.style.top = ''`、return（保 `lastAnchor` 不动）；否则移除类、走现有锚定。CSS 按契约追加（`--sheet` 规则里 `max-height:calc(100dvh - 24px)` 写在基类 `100vh` 之后靠层叠覆盖，旧引擎忽略 dvh 行）。
  - Change: client.mjs 的 placePanel 与 FLOAT_STYLE_TEXT
- [ ] Step 4: 运行确认通过
  - Run: `node --test`
  - Expected: 全仓绿
- [ ] Step 5: checkpoint commit
  - Run: `git commit -am "feat(client): bottom-sheet panel under 480px viewports"`

### Task 10: 性能卫生（滚动合帧 + 按需监听）

- 目标：滚动路径 rAF 合帧；document 级 move/up/cancel 监听仅拖拽期间存在。
- Files: Modify `src/client.mjs`（`onDocScroll`、`attachDrag` 监听生命周期、cleanup 对应段）
- Test: `tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿（既有拖拽用例不回归）
- 接口契约:
  - Consumes: Task 5 的 `scheduleFrame(fn)`；现有 `onDocScroll`（client.mjs:1048）与监听装/卸段（client.mjs:1090-1118）。
  - Produces: 无新接口（行为优化）。
- [ ] Step 1: 写失败/回归测试：① 回归锁——stub 面板锚点 rect（surface 的 `getBoundingClientRect` 临时返回 `{left:100,top:50,right:220,bottom:76,width:120,height:26}`）→ 开面板 → `panel.style.left === '228px'`（placePanel 公式 rect.right+8）；改 stub 为 `right:320` → 连发 3 次 `doc` 的 `scroll` → `await` 对齐一帧 → `panel.style.left === '328px'`（重锚真实发生——left 本就非空，必须断言到「随 anchor 变化而更新」；jsdom 无法 spy 内部调用次数，合帧结构靠 review）；② 拖拽监听生命周期改后，Task 5/6/7 的全部拖拽用例仍绿（防止按需挂载破坏既有序列）。
  - Run: `node --test --test-name-pattern "scroll|drag" tests/client.test.mjs`
  - Expected: ① 现（未合帧）也应绿——本步为回归保护；红仅当发现既有缺陷
- [ ] Step 2: 实现。`onDocScroll` → 暂存并经 `scheduleFrame` 合帧调 `placePanel()`；`attachDrag`：doc 级 move/up/cancel 改在 `onPointerDown` 内挂、up/cancel 处理尾部卸；dispose 返回的清理函数仍兜底卸载全部；**合帧回调与拖拽帧回调首行 `if (disposed) return`**（`disposed` 为 mount 闭包既有标志——dispose 后已排队的帧不得再做任何工作）。
  - Change: client.mjs
- [ ] Step 3: 运行确认通过
  - Run: `node --test`
  - Expected: 全仓绿（含 ① 的回归用例）
- [ ] Step 4: checkpoint commit
  - Run: `git commit -am "perf(client): rAF-coalesced scroll placement and on-demand drag listeners"`

### Task 11: 视觉微交互（grab 光标 / hover / 按压 / 过渡）

- 目标：静置态的手感细节；全部 transform/opacity 与 reduced-motion 包裹。
- Files: Modify `src/client.mjs`（`FLOAT_STYLE_TEXT`）；Test: `tests/client.test.mjs`
- 验证范围: `node --test tests/client.test.mjs` 全绿
- 接口契约:
  - Consumes: CSS 契约的 base `transition` 行；Task 5 的 `--dragging`（其 `transition:none` 必须压过 base transition）。
  - Produces: 无新接口（纯样式）。
- [ ] Step 1: 写失败测试：`FLOAT_STYLE_TEXT` 字符串断言含 `cursor:grab`、`cursor:grabbing`、`:active`、`scale(.98)`、`transition:` 且 `prefers-reduced-motion` 包裹过渡段（文本断言，先例同 Task 6①）。
  - Run: `node --test --test-name-pattern "capsule" tests/client.test.mjs`
  - Expected: 红
- [ ] Step 2: 实现。CSS：base 加 `transition: border-color .12s ease-out, box-shadow .12s ease-out`（连同 Task 5/6 的动画段一并放进 no-preference 媒体内）；hover 阴影加深 + border-primary（现有）保持；`:active { transform: scale(.98); }`；`--dragging` 的 `transition:none` 与内联 transform 优先级复核（内联 > 类规则）。
  - Change: client.mjs 的 FLOAT_STYLE_TEXT
- [ ] Step 3: 运行确认通过
  - Run: `node --test`
  - Expected: 全仓绿
- [ ] Step 4: checkpoint commit
  - Run: `git commit -am "feat(client): capsule micro-interactions (grab cursor, hover, press)"`

### Task 12: 版本 0.1.11 发布准备（README + 构建 + tag）

- 目标：发 0.1.11，只发不宣；registry 不动。
- Files: Modify `package.json`（version）、`README.md`（L9 中文功能条目、L50 English summary 的拖拽/贴边措辞）
- 验证范围: `npm run build && npm test && npm run security:check` 三连全绿
- 接口契约:
  - Consumes: Task 1-11 全部落地的行为；know-how 018（publish 绿 ≠ 上架，~17 分钟 staged 窗口）。
  - Produces: `lib/client.js` 新 bundle；tag `v0.1.11`。
- [ ] Step 1: `package.json` version → `0.1.11`
  - Run: `node -e "console.log(require('./package.json').version)"`
  - Expected: `0.1.11`
- [ ] Step 2: README 两处措辞。L9 条目改写：常驻**贴边停靠**（左右贴边、完整可见、距边 8px、位置跨重启记忆）替代「拖拽到任意位置」「距边 16px 起步」「越界自动钳回」旧口径；补触摸拖拽、长按菜单、≤480px 底部面板、safe-area 一句。L50 同步（edge-docking / long-press menu / bottom sheet on narrow viewports），并顺带清除该段 0.1.7 前遗留漂移：`corner button to hide or restore the capsule`、`session-scoped capsule hide`——按现状菜单如实描述（卡片显隐 + 立即重新探测，无藏球动作；事实对齐，非新增宣传）。另 L10「点击球或胶囊」、L13「不上球」的「球」字漂移顺带改为胶囊口径（grep 清单**不加**裸「球」——L9「圆球已退役」为合理史述，保留，避免误伤）。
  - Run: `grep -n "任意位置\|draggable anywhere\|距边 16px\|corner button\|session-scoped" README.md`
  - Expected: 无输出（旧口径清零）
- [ ] Step 3: 最终验证三连
  - Run: `npm run build && npm test && npm run security:check`
  - Expected: build 输出 `wrote lib/client.js`；测试全绿；security 无告警
- [ ] Step 4: bundle 抽查
  - Run: `grep -c "FLOAT_DOCK_KEY" lib/client.js; grep -c "touch-action" lib/client.js; grep -c "loadFloatGeometry" lib/client.js`
  - Expected: `≥1`、`≥1`、`0`
- [ ] Step 5: commit + tag + push（push 前经主人确认，仓库惯例）
  - Run: `git commit -am "chore: release v0.1.11" && git tag v0.1.11 && git push origin feat/capsule-polish --tags`
  - Expected: push 成功；GitHub Actions publish 启动；**不动 `dsh-m/registry.json`**（全局约束），npm 上架后按 know-how 018 等待 staged 窗口再验证 `npm view @iasiv5/dsh-quota-watch@0.1.11 version`

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令与仓库现实不符（尤其 jsdom 的 rAF / pointerType / setTimeout 行为），先修计划再动手，不猜。
- 按任务顺序执行，不无声跳步、合并或改变任务目标；每任务完成即跑其验证；checkpoint commit 前确认工作树无游离文件。
- 全程在 `feat/capsule-polish` 分支（Task 1 创建），不直接在 `main` 提交；push 与 tag 发布动作在 Step 级已标注需主人确认。
- 遇阻塞、重复失败或 jsdom 能力与假设不符，立即停下说明。
- 全部任务完成后运行「最终验证」并输出修改摘要。

## 最终验证

- Run: `cd ~/workspace/dsh-quota-watch && npm run build && npm test && npm run security:check`
  - Expected: 三条全绿。
- Run: `grep -c "loadFloatGeometry" src/client.mjs; grep -c "touch-action" src/client.mjs; grep -c "FLOAT_DOCK_KEY" src/client.mjs; grep -c "dqw-panel--sheet" src/client.mjs`
  - Expected: `0`、`≥1`、`≥1`、`≥1`。
- Run: `git log --oneline feat/capsule-polish ^main | wc -l`
  - Expected: ≥ 11（Task 2-12 各一 commit）。

### 人工验收清单（自动验证全绿后执行）

**桌面浏览器（执行本机，127.0.0.1:3080 + HMR）：**
1. 抓胶囊任意位置拖动 → 胶囊钉在抓取点下，无左上角瞬跳；拖动中无掉帧感。
2. 右半屏松手贴右边、左半屏贴左边，带 150ms 滑入；系统开「减少动态效果」→ 直落。
3. 刷新 → 贴边与纵向位置恢复；改窗口宽度 → 仍贴边完整可见（不再悬出屏外）；额度文本变宽 → 仍贴边。
4. hover/按压/光标手感；点开面板、Esc/点外关、右键菜单——全部不回归；>80 黄 / >95 红配色不变。
5. `prefers-reduced-motion` 下无任何动画（贴边直落、无脉动）。

**手机浏览器（iOS Safari + Android Chrome 访问 ob-harness.online）：**
6. 触摸拖动 → 页面不滚、胶囊跟手；轻点（<10px 位移）开面板不误拖。
7. 长按 500ms → 菜单弹出（Android 有轻振动；iOS 菜单可用）；Android 原生长按菜单不双开。
8. ≤480px：面板底部弹出、不遮死胶囊；iPhone 底部横条不遮挡胶囊与面板（safe-area）。
9. 指肚偏 9px 内仍可点中（44px 热区）；无灰色 tap 高亮、无长按选择/放大镜。
10. 松手贴边 → 转屏 → 仍贴边可见。

**Desktop profile（主人执行，仅回归）：**
11. 胶囊出现、可拖、贴边、面板可用；窄窗钳位不丢；console 无报错；`grep -c attachShadow lib/client.js` ≥ 1。

## 审阅 Checkpoint

- 计划正文到此为止。请先审阅（重点：Task 4/5 的测试迁移切分口径、Task 5 Step 0 的 rAF/matchMedia fixture 复核、Task 12 Step 5 的 push 确认点）；确认后按 Task 1 起执行。
