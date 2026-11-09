/**
 * The CEP v1 guest side (docs/interop/capsule-embed-protocol.md in
 * dsh-stock-kanban; ADR 0008 here): the embed protocol cluster of
 * mountQuotaCard. Listens for the host's window-level CustomEvents
 * (namespace `dsh-quota-watch:*`), answers probes with this guest's
 * capabilities, tracks the embedded lifecycle (engage / heartbeat watchdog /
 * disengage), and forwards open-panel anchors to the mount's own toggle
 * semantics.
 *
 * Internal seam of mountQuotaCard (ADR 0007): the external mountQuotaCard
 * interface is frozen; this module is wired only by src/client.mjs and is
 * tested directly by tests/client-embed.test.mjs. Pure win injection — no
 * DOM dependency — so the state machine stays unit-testable without jsdom.
 */

export const EMBED_PROTOCOL_VERSION = 1
export const EMBED_CAPABILITIES = ['hide-pill', 'anchored-panel', 'poll-pause']
/** 与 package.json version 同步（tests/package-shape.test.mjs 防漂移断言执有） */
export const EMBED_GUEST_VERSION = '0.1.37'

const NS = 'dsh-quota-watch'
const event = (type) => `${NS}:${type}`

export function createEmbed({ win, onEmbeddedChange, onOpenPanel, heartbeatTimeoutMs = 15000 }) {
  let embedded = false
  let watchdog = null

  const dispatch = (type, detail) => {
    try {
      win.dispatchEvent(new win.CustomEvent(event(type), { detail, composed: true, bubbles: true }))
    } catch {
      /* 无 CustomEvent 的环境静默：协议不可用不拖垮挂载 */
    }
  }

  const clearWatchdog = () => {
    if (watchdog !== null) {
      try { win.clearTimeout(watchdog) } catch { /* 同上 */ }
      watchdog = null
    }
  }
  const armWatchdog = () => {
    clearWatchdog()
    if (typeof win.setTimeout === 'function') {
      watchdog = win.setTimeout(() => {
        watchdog = null
        // 孤儿保护：宿主未及 disengage 消失（禁用/崩溃/HMR）→ 3 拍未达自恢复
        setEmbedded(false)
      }, heartbeatTimeoutMs)
    }
  }

  const setEmbedded = (next) => {
    if (embedded === next) return
    embedded = next
    if (typeof onEmbeddedChange === 'function') {
      try { onEmbeddedChange(next) } catch { /* 订阅者异常不扩散 */ }
    }
  }

  const onProbe = () => {
    dispatch('embed-capabilities', {
      v: EMBED_PROTOCOL_VERSION,
      capabilities: [...EMBED_CAPABILITIES],
      guestVersion: EMBED_GUEST_VERSION,
    })
  }
  const onEngage = () => {
    setEmbedded(true)
    armWatchdog()
  }
  const onHeartbeat = () => {
    if (!embedded) return // 只在合并态武装期内重置看门狗
    armWatchdog()
  }
  const onDisengage = () => {
    clearWatchdog()
    setEmbedded(false)
  }
  const onOpenPanelEvent = (ev) => {
    const anchor = ev?.detail?.anchor
    if (anchor === undefined) return
    if (typeof onOpenPanel === 'function') {
      try { onOpenPanel(anchor) } catch { /* 同上 */ }
    }
  }

  win.addEventListener(event('embed-probe'), onProbe)
  win.addEventListener(event('embed-engage'), onEngage)
  win.addEventListener(event('embed-heartbeat'), onHeartbeat)
  win.addEventListener(event('embed-disengage'), onDisengage)
  win.addEventListener(event('open-panel'), onOpenPanelEvent)

  return {
    isEmbedded: () => embedded,
    dispose() {
      clearWatchdog()
      win.removeEventListener(event('embed-probe'), onProbe)
      win.removeEventListener(event('embed-engage'), onEngage)
      win.removeEventListener(event('embed-heartbeat'), onHeartbeat)
      win.removeEventListener(event('embed-disengage'), onDisengage)
      win.removeEventListener(event('open-panel'), onOpenPanelEvent)
      embedded = false // 惰性化：isEmbedded 归 false（UI 恢复由挂载侧 teardown 负责，不通知）
    },
  }
}
