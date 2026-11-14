/**
 * The poll-cadence cluster of mountQuotaCard: the self-scheduling GET chain,
 * its cold-start backoff, the force/ordinary refresh watermark, and the CEP v1
 * poll-pause exemption (embedded guests keep their background chain parked
 * while no data surface is visible — 0.1.41).
 *
 * Internal seam of mountQuotaCard (ADR 0007): the external mountQuotaCard
 * interface is frozen; this module is wired only by src/client.mjs and is
 * tested directly by tests/poll-cadence.test.mjs. Zero imports — doc, fetch,
 * routes and every cross-cluster read arrive as injected getters — and zero
 * DOM access, so the engage/pause/resume/exemption matrix stays unit-testable
 * with mock timers and without jsdom. The timer source is injectable: the
 * default resolves bare setTimeout/clearTimeout (the Node timers node --test
 * mocks), while the mount wiring passes the window's own timers so a chain
 * dies with its jsdom window exactly as the pre-carve code did — a window
 * close() must stop an undisposed mount's chain, which bare Node timers never
 * would (leaked chains re-arm forever and starve the test runner).
 */

const FETCH_TIMEOUT_MS = 15_000

async function fetchJson(fetchImpl, path, method) {
  const response = await fetchImpl(path, {
    ...(method === 'POST' ? { method: 'POST' } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function createPollCadence({
  doc,
  fetchImpl,
  routes,
  pollIntervalMs,
  retryNoDataMs,
  retryBackoff,
  isDisposed,
  isEmbedded,
  isDataHidden,
  isDataSurfaceOpen,
  applySnapshot,
  onTransportError,
  onBusyRender,
  // Timer source: default = bare global timers (intercepted by t.mock.timers
  // under node --test); the mount wiring passes the window's own timers so an
  // undisposed mount's chain dies with its jsdom window, as before the carve.
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
}) {
  let timer
  let noDataRetries = 0
  let normalSequence = 0
  // Force/ordinary refresh watermark. An ordinary GET may only apply when it
  // started while NO force was in flight AND under the current force
  // generation — so a force result can neither be dropped by a later-started
  // GET that returned first, nor rolled back by a GET that started during the
  // force and returned late. Only a GET started after the force completed may
  // update the UI.
  let forceBusy = false
  let forceGeneration = 0
  // The ONE shared 立即刷新 busy state: the detail header button, the overview
  // action and every refresh click all honor this single flag.
  let refreshBusy = false
  // Ordinary-GET in-flight marker: render cascades (syncPop/syncCardVisibility →
  // syncEmbeddedPolling) must not fire an extra poll while one is landing —
  // a microtask-level poll storm would starve timers (0.1.41 regression guard).
  let ordinaryPollInFlight = false

  /** Cold-start cadence: while no provider has rendered any data, re-poll on
   * a shortening backoff (retryNoDataMs × retryBackoffⁿ, capped at
   * pollIntervalMs) so a desktop cold start surfaces the capsule in seconds
   * instead of waiting out the fixed interval. A successful render resets the
   * chain to the normal cadence; a transport error keeps the previous
   * dataHidden state, so a cold client keeps retrying fast and a warm one
   * stays calm. */
  const nextPollDelay = () => {
    if (!isDataHidden()) {
      noDataRetries = 0
      return pollIntervalMs
    }
    const delay = retryNoDataMs * (retryBackoff ** noDataRetries)
    noDataRetries += 1
    return Math.min(delay, pollIntervalMs)
  }

  const poll = async (force) => {
    if (isDisposed()) return
    if (force === true) {
      // One refresh at a time; its response always wins over any ordinary GET.
      if (refreshBusy) return
      refreshBusy = true
      forceBusy = true
      const generation = ++forceGeneration
      // Flip the shared busy state before the request: header button, overview
      // action and label clicks all re-render against it.
      onBusyRender()
      try {
        const next = await fetchJson(fetchImpl, routes.refresh, 'POST')
        if (generation === forceGeneration && !isDisposed()) applySnapshot(next)
      } catch {
        if (!isDisposed()) onTransportError()
      } finally {
        forceBusy = false
        refreshBusy = false
        if (!isDisposed()) onBusyRender()
      }
      return
    }
    const sequence = ++normalSequence
    ordinaryPollInFlight = true
    // Watermark captured at start: a GET that started during a force is never
    // applied, and neither is one started under an older force generation.
    const startedDuringForce = forceBusy
    const genAtStart = forceGeneration
    try {
      const next = await fetchJson(fetchImpl, routes.overview, 'GET')
      const applicable = !startedDuringForce && genAtStart === forceGeneration
      if (sequence === normalSequence && applicable && !isDisposed()) applySnapshot(next)
    } catch {
      if (sequence === normalSequence && !isDisposed()) onTransportError()
    } finally {
      ordinaryPollInFlight = false
      // Self-scheduling chain (replaces the fixed interval): every completed
      // poll — success OR transport error — arms the next one, so the no-data
      // backoff also covers a cold start whose first request fails outright.
      // The force path never arms a second chain: only the latest ordinary
      // GET may re-arm the timer. While merged (CEP v1) the guest keeps its
      // background chain parked — a landing GET may only revive it when a
      // guest data surface is visible (panel/pop/sidebar card, 0.1.41);
      // disengage / heartbeat-timeout restore always does.
      if (timer === undefined && sequence === normalSequence && !isDisposed() && (!isEmbedded() || isDataSurfaceOpen()) && doc.visibilityState !== 'hidden') {
        timer = setTimer(() => {
          timer = undefined
          if (!isDisposed() && doc.visibilityState !== 'hidden') void poll()
        }, nextPollDelay())
      }
    }
  }

  const startPolling = () => {
    // 嵌入态仅在无可见数据面时拦截：面板/弹卡/副栏卡片可见 ⇒ 访客按自身节奏拉取（0.1.41）
    if (timer !== undefined || doc.visibilityState === 'hidden' || isDisposed() || (isEmbedded() && !isDataSurfaceOpen())) return
    void poll()
  }
  const stopPolling = () => {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }
  /** 嵌入态轮询随数据面升降：任一数据面开 ⇒ 立即拉取并续排常规链；全关 ⇒ 恢复停链。
   *  豁免面由 mount 经 isDataSurfaceOpen 注入（openKey 或副栏卡片可见）；胶囊小脸
   *  嵌入态恒隐藏，不计入——后台停链语义保持。 */
  const syncEmbeddedPolling = () => {
    if (!isEmbedded() || isDisposed()) return
    if (isDataSurfaceOpen()) {
      // 在飞 GET 的级联渲染不补发即时拉取（settle 会按常规节奏续排），防微任务风暴
      if (!ordinaryPollInFlight && timer === undefined) startPolling()
    } else {
      stopPolling()
    }
  }
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') stopPolling()
    else startPolling()
  }

  return {
    poll,
    startPolling,
    stopPolling,
    syncEmbeddedPolling,
    isRefreshBusy: () => refreshBusy,
    onVisibilityChange,
  }
}
