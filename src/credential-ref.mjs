/**
 * vendor 自 @deepseek-ai/dsh-credentials@0.2.1-rc.2（MIT）的凭据引用命名三函数。
 *
 * 为什么 vendor（dsh-quota-watch 侧与 dsh-m#7 同类遮蔽修复）：dependencies 携带
 * `@deepseek-ai/*` 包会被 profile pnpm（nodeLinker: hoisted）提升到顶层并按「同名
 * 目录必赢」遮蔽应用自带核心包——本插件 0.1.7-rc.2 曾把应用 0.2.1-rc.x 的
 * dsh-credentials（连同其传递依赖 dsh-brand）遮在 profile 顶层，同进程两套实现。
 *
 * 协议保真说明：`credentialRef`/`credentialKey` 的返回值经上游 `brandString`
 * 品牌化，而 `@deepseek-ai/dsh-brand` 的 brandString 是**运行时恒等函数**
 * （其模块自述："keeps no runtime identity… independently installed copies
 * produce interchangeable values"），brand 仅存在于类型层——本文件直接返回
 * 原字符串，宿主 `ctx.credentials`（resolve/readRecord）消费的正是普通字符串。
 * 语义对照锚：本仓库 docs/reports/2026-10-17-dsh-0.2.1-rc.2-compat-audit.md
 * （三符号跨 0.1.7-rc.2 → 0.2.1-rc.2 语义不变）。升级后 diff 上游 vendor。
 */

/** POSIX shell 语法的环境变量名（凭据引用的合法形态，如 `DEEPSEEK_API_KEY`）。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** CredentialKey 两段的合法形态；段间的 `/` 正是它容不下的字符。 */
const KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * 把原始字符串品牌化为 {@link CredentialRef}。
 * @param value - 候选引用；POSIX shell 标识符形态的环境变量名，如 `DEEPSEEK_API_KEY`。
 * @returns 同值字符串（品牌仅存在于类型层）。
 * @throws TypeError 当值不匹配引用文法。
 */
export function credentialRef(value) {
  if (!isCredentialRefName(value)) throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`)
  return value
}

/**
 * 原始字符串是否可能构成引用名。文法之外的名字应读作「未设置」而非抛错。
 * @param value - 候选引用。
 * @returns credentialRef 是否会接受该值。
 */
export function isCredentialRefName(value) {
  return REF_PATTERN.test(value)
}

/**
 * 把 scope 与 id 品牌化为 {@link CredentialKey}（`<scope>/<id>`）。
 * @param scope - 拥有方插件的注册名，如 `llm-pi-ai`。
 * @param id - 该插件自己的寻址单元，如 provider 路由键。
 * @returns 同值字符串（品牌仅存在于类型层）。
 * @throws TypeError 当任一段不是小写连字符标识符。
 */
export function credentialKey(scope, id) {
  for (const segment of [scope, id]) {
    if (!KEY_SEGMENT_PATTERN.test(segment)) throw new TypeError(`credential key segment "${segment}" must match ${String(KEY_SEGMENT_PATTERN)}`)
  }
  return `${scope}/${id}`
}
