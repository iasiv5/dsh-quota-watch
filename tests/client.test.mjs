import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountQuotaCard } from '../src/client.mjs'
import { FLOAT_DOCK_KEY, SURFACE_FLAGS_KEY } from '../src/client/prefs.mjs'

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function glmProvider(overrides = {}) {
  return {
    key: 'glm',
    displayName: 'GLM Coding Plan',
    status: 'ready',
    credential: 'configured',
    updatedAt: Date.parse('2026-10-01T12:00:00.000Z'),
    plan: {
      planName: 'GLM-Code-Plan',
      windows: [
        { key: '5h', percent: 12.5, resetsAt: '2026-10-01T13:00:00.000Z' },
        { key: 'mcp', percent: 1, resetsAt: '2026-11-01T00:00:00.000Z' },
      ],
    },
    usage: {
      status: 'ready',
      totalTokens: 8300000,
      totalCalls: 152,
      models: [{ name: 'GLM-5.3', tokens: 21400 }, { name: 'GLM-5.3-Flash', tokens: 8278600 }],
    },
    ...overrides,
  }
}

function copilotProvider(overrides = {}) {
  return {
    key: 'copilot',
    displayName: 'GitHub Copilot',
    status: 'ready',
    credential: 'configured',
    updatedAt: Date.parse('2026-10-01T12:00:00.000Z'),
    quota: {
      planName: 'enterprise',
      tokenBasedBilling: true,
      balanceAvailable: true,
      remaining: 7600,
      entitlement: 10000,
      percentRemaining: 76,
      creditsUsed: 2400,
      resetsAt: '2026-11-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

function snapshot(providers) {
  return { updatedAt: Date.parse('2026-10-01T12:00:00.000Z'), providers }
}

function dom({ locale, footless = false, collapsed = false } = {}) {
  const sidebar = footless ? '' : '<div class="sidebarCol"><div class="footArea"><div class="settingsArea"><button class="settings-trigger" type="button"><svg width="16" height="16"></svg></button></div></div></div>'
  const frameAttrs = collapsed ? ' data-sidebar-collapsed' : ''
  const { window } = new JSDOM(
    `<!doctype html><html><body><div class="frame"${frameAttrs}>${sidebar}</div></body></html>`,
    { url: 'https://dsh.example/', pretendToBeVisual: true },
  )
  if (locale) {
    Object.defineProperty(window.navigator, 'language', { value: locale, configurable: true })
  }
  return window
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))
// Task 5 Step 0 fixture probe: rAF=function, matchMedia=undefined — drag-frame
// assertions align on one animation frame; the animation path needs a stub.
const frame = (window) => new Promise((resolve) => window.requestAnimationFrame(() => resolve()))

async function mounted(window, payload) {
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    requests.push({ path, method: init.method ?? 'GET' })
    return response(typeof payload === 'function' ? payload() : payload)
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  await turn()
  return { dispose, requests }
}

test('summary rows replace the expanded card and keep refresh and self-healing', async () => {
  const window = dom()
  const { dispose, requests } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.ok(container)
  const footArea = window.document.querySelector('.footArea')
  assert.equal(footArea.firstElementChild, container, 'card claims the top of the sidebar footer')
  assert.deepEqual(requests[0], { path: 'api/dsh-quota-watch/overview', method: 'GET' })

  assert.equal(container.shadowRoot.querySelector('[data-action="collapse"]'), null)
  assert.equal(container.shadowRoot.querySelector('.dqw-head'), null, 'header with title and refresh button is removed')

  const glmRow = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.ok(glmRow)
  assert.match(glmRow.textContent, /GLM/)
  assert.match(glmRow.textContent, /13%/)
  assert.match(glmRow.textContent, /8\.3M/)
  assert.match(glmRow.textContent, /▸/)
  const copilotRow = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]')
  assert.ok(copilotRow)
  assert.match(copilotRow.textContent, /Copilot/)
  assert.match(copilotRow.textContent, /24%/)
  const copilotExtra = copilotRow.querySelector('[data-dsh-quota-watch-extra]')
  assert.ok(copilotExtra, 'copilot row shows compact credits used after the percent')
  assert.match(copilotExtra.textContent, /2\.4K/)

  const updatedLine = container.shadowRoot.querySelector('[data-role="updated"]')
  assert.ok(updatedLine)
  assert.equal(updatedLine.hidden, true, 'outer updated line hides once data renders')
  const pop = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  assert.ok(pop)
  assert.equal(pop.hidden, true)
  assert.equal(pop.children.length, 0)

  assert.equal(requests.length, 1, 'no manual refresh request exists')
  assert.deepEqual(requests[0], { path: 'api/dsh-quota-watch/overview', method: 'GET' })

  container.remove()
  await turn()
  assert.ok(window.document.querySelector('[data-dsh-quota-watch-card]'), 'observer re-seats a removed card')
  dispose()
  assert.equal(window.document.querySelector('[data-dsh-quota-watch-float]'), null, 'dispose removes the float shell together with the panel')
  window.close()
})

test('provider-derived text is written via textContent, never markup', async () => {
  const window = dom()
  const hostile = glmProvider()
  hostile.plan.planName = '<img src=x onerror=alert(1)>'
  const { dispose } = await mounted(window, snapshot([hostile, copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.equal(container.shadowRoot.querySelector('img'), null)
  dispose()
  window.close()
})

test('rows hide per provider state and the card hides when nothing is visible', async () => {
  const cases = [
    {
      name: 'both missing hides the whole card',
      providers: [
        { key: 'glm', status: 'missing', credential: 'none', displayName: 'GLM Coding Plan' },
        { key: 'copilot', status: 'missing', credential: 'none', displayName: 'GitHub Copilot' },
      ],
      check(container) {
        assert.equal(container.hidden, true)
        assert.equal(container.shadowRoot.querySelector('[data-dsh-quota-watch-row]'), null)
      },
    },
    {
      name: 'copilot missing leaves only the glm row',
      preseed: '{"cardHidden":false}',
      providers: [glmProvider(), { key: 'copilot', status: 'missing', credential: 'none', displayName: 'GitHub Copilot' }],
      check(container) {
        assert.equal(container.hidden, false)
        assert.ok(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]'))
        assert.equal(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]'), null)
      },
    },
    {
      name: 'copilot without a reported remaining percent stays hidden',
      providers: [glmProvider(), copilotProvider({
        quota: { balanceAvailable: true, remaining: 7600, entitlement: 10000 },
      })],
      check(container) {
        assert.equal(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]'), null)
      },
    },
    {
      name: 'glm failure without data renders a non-interactive error row',
      providers: [glmProvider({ status: 'error', error: 'HTTP 503', plan: undefined, usage: undefined }), copilotProvider()],
      check(container) {
        const glmRow = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
        assert.ok(glmRow)
        assert.match(glmRow.textContent, /Query failed/)
        assert.equal(glmRow.querySelector('.dqw-bar'), null)
        assert.equal(glmRow.getAttribute('aria-expanded'), null)
        assert.ok(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]'))
      },
    },
  ]
  for (const item of cases) {
    const window = dom()
    if (item.preseed) window.localStorage.setItem(SURFACE_FLAGS_KEY, item.preseed)
    const { dispose } = await mounted(window, snapshot(item.providers))
    const container = window.document.querySelector('[data-dsh-quota-watch-card]')
    item.check(container)
    dispose()
    window.close()
  }
})

test('summary bars switch color classes past usage thresholds', async () => {
  const cases = [
    { percent: 50, cls: null },
    { percent: 80, cls: null },
    { percent: 80.1, cls: 'warn' },
    { percent: 95, cls: 'warn' },
    { percent: 95.1, cls: 'danger' },
  ]
  for (const item of cases) {
    const window = dom()
    const provider = glmProvider()
    provider.plan.windows = [{ key: '5h', percent: item.percent }]
    const { dispose } = await mounted(window, snapshot([provider]))
    const fill = window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"] .dqw-bar-fill')
    assert.ok(fill, `fill for ${item.percent}`)
    if (item.cls === null) {
      assert.equal(fill.classList.contains('warn'), false)
      assert.equal(fill.classList.contains('danger'), false)
    } else {
      assert.equal(fill.classList.contains(item.cls), true, `class for ${item.percent}`)
    }
    dispose()
    window.close()
  }
})

test('stale rows keep last-good values with a warning marker', async () => {
  const window = dom()
  const stale = glmProvider({ status: 'stale', error: 'HTTP 503' })
  stale.usage = { ...stale.usage, status: 'stale' }
  const { dispose } = await mounted(window, snapshot([stale, copilotProvider()]))
  const glmRow = window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.match(glmRow.textContent, /⚠/)
  assert.equal(glmRow.querySelector('[data-dsh-quota-watch-stale]').title, 'HTTP 503')
  assert.match(glmRow.textContent, /13%/)
  assert.match(glmRow.textContent, /8\.3M/)
  dispose()
  window.close()
})

test('token extras follow the interface locale with compact notation', async () => {
  const english = dom()
  const { dispose: disposeEnglish } = await mounted(english, snapshot([glmProvider()]))
  assert.match(english.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').textContent, /8\.3M/)
  disposeEnglish()
  english.close()

  const chinese = dom({ locale: 'zh-CN' })
  const { dispose: disposeChinese } = await mounted(chinese, snapshot([glmProvider()]))
  assert.match(chinese.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').textContent, /830万/)
  disposeChinese()
  chinese.close()
})

test('clicking a row opens only that provider in the side popover and toggles closed on repeat', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const pop = () => window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const glmRow = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.equal(glmRow.getAttribute('aria-expanded'), 'false')

  const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  click(glmRow)
  await turn()
  const openedGlm = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.equal(openedGlm.getAttribute('aria-expanded'), 'true')
  assert.match(openedGlm.querySelector('.dqw-chev').textContent, /▾/)
  assert.equal(pop().hidden, false)
  assert.equal(pop().dataset.dshQuotaWatchPanelDetail, 'glm')
  assert.ok(pop().children.length > 0)
  assert.ok(pop().style.left, 'popover is positioned next to the row')

  click(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]'))
  await turn()
  assert.equal(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]').getAttribute('aria-expanded'), 'true')
  assert.equal(pop().dataset.dshQuotaWatchPanelDetail, 'copilot')
  assert.ok(pop().children.length > 0)
  assert.equal(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').getAttribute('aria-expanded'), 'false')

  click(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]'))
  await turn()
  assert.equal(pop().hidden, true)
  assert.equal(pop().children.length, 0)
  dispose()
  window.close()
})

test('outside pointerdown and Escape close the detail popover', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const pop = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(pop.hidden, false)

  window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
  await turn()
  assert.equal(pop.hidden, true)

  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(pop.hidden, false)
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await turn()
  assert.equal(pop.hidden, true)
  dispose()
  window.close()
})

test('panel header close button closes the panel', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false)
  const close = panel.querySelector('[data-action="panel-close"]')
  assert.ok(close, 'header exposes a close affordance')
  close.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true)
  dispose()
  window.close()
})

const floatSurface = (window) =>
  window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')

test('float shell mounts the capsule under <body> for theme-token inheritance', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.ok(host, 'float host is appended to body')
  assert.equal(host.parentElement, window.document.body, 'direct child of <body> (inherits body-level theme tokens)')
  const capsule = host.shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')
  assert.ok(capsule, 'capsule is the only floating surface')
  assert.equal(host.shadowRoot.querySelector('[data-dsh-quota-watch-ball]'), null, 'the round ball is retired')
  assert.equal(capsule.getAttribute('role'), 'button')
  assert.equal(capsule.getAttribute('tabindex'), '0')
  assert.equal(capsule.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(capsule.getAttribute('aria-expanded'), 'false')
  assert.ok(capsule.querySelector('.dqw-capsule-glm'), 'glm summary span renders')
  assert.ok(capsule.querySelector('.dqw-capsule-copilot'), 'copilot summary span renders')
  dispose()
  window.close()
})

test('capsule spans reflect both providers', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const capsule = floatSurface(window)
  assert.match(capsule.querySelector('.dqw-capsule-glm').textContent, /GLM 13%/)
  assert.match(capsule.querySelector('.dqw-capsule-copilot').textContent, /Copilot 24%/)
  dispose()
  window.close()
})

test('capsule spans switch color classes past usage thresholds', async () => {
  const cases = [
    { percent: 50, cls: null },
    { percent: 80, cls: null },
    { percent: 80.1, cls: 'warn' },
    { percent: 95, cls: 'warn' },
    { percent: 95.1, cls: 'danger' },
  ]
  for (const item of cases) {
    const window = dom()
    const provider = glmProvider()
    provider.plan.windows = [{ key: '5h', percent: item.percent }]
    const { dispose } = await mounted(window, snapshot([provider]))
    const span = floatSurface(window).querySelector('.dqw-capsule-glm')
    assert.ok(span, `span for ${item.percent}`)
    if (item.cls === null) {
      assert.equal(span.classList.contains('warn'), false)
      assert.equal(span.classList.contains('danger'), false)
    } else {
      assert.equal(span.classList.contains(item.cls), true, `class for ${item.percent}`)
    }
    dispose()
    window.close()
  }
})

test('capsule sets data-alert when any provider passes 95%', async () => {
  const alertWindow = dom()
  const alertProvider = copilotProvider({ quota: { ...copilotProvider().quota, percentRemaining: 4.9 } })
  const alertMounted = await mounted(alertWindow, snapshot([glmProvider(), alertProvider]))
  assert.equal(floatSurface(alertWindow).getAttribute('data-alert'), 'true')
  alertMounted.dispose()
  alertWindow.close()

  const calmWindow = dom()
  const calmProvider = copilotProvider({ quota: { ...copilotProvider().quota, percentRemaining: 50 } })
  const calmMounted = await mounted(calmWindow, snapshot([glmProvider(), calmProvider]))
  assert.equal(floatSurface(calmWindow).getAttribute('data-alert'), null)
  calmMounted.dispose()
  calmWindow.close()
})

test('capsule click toggles the overview panel with 0.0.18-style summary rows', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const capsule = floatSurface(window)
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false)
  assert.notEqual(panel.dataset.dshQuotaWatchPanelOverview, undefined, 'capsule opens the overview')
  assert.equal(capsule.getAttribute('aria-expanded'), 'true')
  assert.ok(panel.style.left, 'panel positions beside the capsule')
  const glmRow = panel.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.ok(glmRow, 'overview reuses the 0.0.18 row-summary renderer')
  assert.ok(glmRow.querySelector('.dqw-bar'), 'overview row carries its usage bar')
  assert.match(glmRow.textContent, /13%/)
  assert.match(glmRow.textContent, /8\.3M/)
  assert.equal(glmRow.getAttribute('data-dsh-quota-watch-panel-provider'), 'glm')
  glmRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.dataset.dshQuotaWatchPanelDetail, 'glm', 'overview row opens the detail')
  assert.ok(panel.querySelector('[data-action="back-to-overview"]'), 'panel nav shows the back affordance')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true)
  assert.equal(capsule.getAttribute('aria-expanded'), 'false')
  dispose()
  window.close()
})

test('float shell hides when both providers are missing', async () => {
  const empty = dom()
  const { dispose: disposeEmpty } = await mounted(empty, snapshot([
    { key: 'glm', status: 'missing', credential: 'none', displayName: 'GLM Coding Plan' },
    { key: 'copilot', status: 'missing', credential: 'none', displayName: 'GitHub Copilot' },
  ]))
  const host = empty.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(host.hidden, true, 'no providers hides the float shell')
  disposeEmpty()
  empty.close()
})

test('without a sidebar footer the floating capsule is the only surface', async () => {
  const window = dom({ footless: true })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  assert.equal(window.document.querySelector('[data-dsh-quota-watch-card]'), null, 'no card without footArea')
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.ok(host, 'float shell still mounts')
  const capsule = floatSurface(window)
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  assert.equal(panel.hidden, false)
  dispose()
  window.close()
})

test('capsule restores the persisted dock and clamps off-screen offsets', async () => {
  const seeded = dom()
  seeded.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  const seededMounted = await mounted(seeded, snapshot([glmProvider(), copilotProvider()]))
  const seededHost = seeded.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(seededHost.style.left, '8px')
  assert.equal(seededHost.style.top, '80px')
  seededMounted.dispose()
  seeded.close()

  const window = dom()
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":99999}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.ok(parseFloat(host.style.top) <= 600 - 8 - 26, `top clamped to 600-8-26 band, got ${host.style.top}`)
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_DOCK_KEY))
  assert.deepEqual(saved, { edge: 'left', offsetY: 99999 }, 'mount clamps visually but never clobbers the stored dock')
  dispose()
  window.close()

  const corrupted = dom()
  corrupted.localStorage.setItem(FLOAT_DOCK_KEY, 'not-json')
  const corruptedMounted = await mounted(corrupted, snapshot([glmProvider(), copilotProvider()]))
  const corruptedHost = corrupted.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(corruptedHost.style.left, `${corrupted.innerWidth - 8 - 38}px`, 'corrupt dock falls back to the right-edge default with the fallback width')
  assert.equal(corruptedHost.style.top, `${corrupted.innerHeight - 8 - 26}px`)
  corruptedMounted.dispose()
  corrupted.close()
})

test('dock x derives from the measured capsule width, not the fallback box', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"right","offsetY":80}')
  const original = window.Element.prototype.getBoundingClientRect
  window.Element.prototype.getBoundingClientRect = function () {
    if (this?.dataset?.dshQuotaWatchCapsule === '') {
      return { left: 0, top: 0, right: 120, bottom: 26, width: 120, height: 26, x: 0, y: 0, toJSON() {} }
    }
    return original.call(this)
  }
  try {
    const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
    const host = window.document.querySelector('[data-dsh-quota-watch-float]')
    assert.equal(host.style.left, `${window.innerWidth - 8 - 120}px`, 'right dock x = viewport - margin - measured width')
    assert.equal(host.style.top, '80px')
    dispose()
  } finally {
    window.Element.prototype.getBoundingClientRect = original
  }
  window.close()
})

test('capsule drag follows the pointer via transform and docks on release', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const restLeft = window.innerWidth - 8 - 38
  const restTop = window.innerHeight - 8 - 26
  assert.equal(host.style.left, `${restLeft}px`)
  capsule.getBoundingClientRect = () => ({
    left: restLeft, top: restTop, right: restLeft + 120, bottom: restTop + 26,
    width: 120, height: 26, x: restLeft, y: restTop, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: restLeft + 60, clientY: restTop + 13 }))
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 700, clientY: 500 }))
  await frame(window)
  assert.match(capsule.style.transform, /translate3d\(-338px, -247px, 0\) scale\(1\.03\)/, 'pill moves via transform relative to the rest position')
  assert.equal(host.style.left, `${restLeft}px`, 'host rest position is untouched during the gesture')
  assert.equal(host.style.top, `${restTop}px`)
  assert.ok(capsule.className.includes('dqw-capsule--dragging'), 'dragging class suspends the glass affordance')
  // jsdom's synthetic MouseEvents are not composed: dispatch move/up on the
  // document so the doc-level drag listeners actually receive them (real
  // browsers bubble these out of the shadow root).
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 700, clientY: 500, button: 0 }))
  await turn()
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_DOCK_KEY))
  assert.deepEqual(saved, { edge: 'right', offsetY: 487 }, 'pill center 700 > midline 512 docks right; offsetY = 500-13')
  assert.equal(host.style.left, `${window.innerWidth - 8 - 120}px`, 'rest x re-derived with the measured width')
  assert.equal(host.style.top, '487px')
  assert.equal(capsule.style.transform, '', 'transform is cleared once committed')
  assert.ok(!capsule.className.includes('dqw-capsule--dragging'))
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true, 'drag suppresses the trailing click')
  dispose()
  window.close()
})

test('a press-release without movement keeps the click behavior', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 12, clientY: 10, button: 0 }))
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false)
  dispose()
  window.close()
})

test('capsule renders a one-line summary and toggles the panel', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = host.shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')
  assert.ok(capsule, 'capsule renders by default')
  assert.equal(host.shadowRoot.querySelector('[data-dsh-quota-watch-ball]'), null, 'the round ball is retired')
  assert.match(capsule.textContent, /GLM 13%/)
  assert.match(capsule.textContent, /Copilot 24%/)
  assert.ok(capsule.querySelector('.dqw-capsule-sep'))
  assert.equal(capsule.getAttribute('role'), 'button')
  assert.equal(capsule.getAttribute('tabindex'), '0')
  assert.equal(capsule.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(capsule.getAttribute('aria-expanded'), 'false')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false)
  assert.equal(capsule.getAttribute('aria-expanded'), 'true')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true)
  assert.equal(capsule.getAttribute('aria-expanded'), 'false')
  dispose()
  window.close()
})

test('capsule omits a missing provider and its separator', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const capsule = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')
  assert.match(capsule.textContent, /GLM 13%/)
  assert.equal(capsule.querySelector('.dqw-capsule-copilot').textContent, '')
  assert.equal(capsule.querySelector('.dqw-capsule-sep').hidden, true)
  dispose()
  window.close()
})

test('capsule keyboard activation opens the panel', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = host.shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  capsule.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false)
  capsule.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true)
  dispose()
  window.close()
})

test('capsule drag persists the dock', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = host.shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')
  const restLeft = window.innerWidth - 8 - 38
  const restTop = window.innerHeight - 8 - 26
  capsule.getBoundingClientRect = () => ({
    left: restLeft, top: restTop, right: restLeft + 120, bottom: restTop + 26,
    width: 120, height: 26, x: restLeft, y: restTop, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: restLeft + 60, clientY: restTop + 13 }))
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 200 }))
  await frame(window)
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: 200, button: 0 }))
  await turn()
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_DOCK_KEY))
  assert.deepEqual(saved, { edge: 'left', offsetY: 187 }, 'pill center 300 < midline 512 docks left')
  assert.equal(host.style.left, '8px')
  assert.equal(host.style.top, '187px')
  dispose()
  window.close()
})

test('the grab point stays under the cursor while dragging', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const restLeft = 8
  const restTop = 80
  capsule.getBoundingClientRect = () => ({
    left: restLeft, top: restTop, right: restLeft + 120, bottom: restTop + 26,
    width: 120, height: 26, x: restLeft, y: restTop, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: restLeft + 60, clientY: restTop + 13 }))
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: restLeft + 90, clientY: restTop + 13 }))
  await frame(window)
  assert.match(capsule.style.transform, /translate3d\(30px, 0px, 0\) scale\(1\.03\)/, 'pill shifts +30px with the pointer (grab point preserved, not top-left-pinned)')
  dispose()
  window.close()
})

test('touch pointers get the larger drag slop, mouse keeps 6px', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const restLeft = 8
  const restTop = 80
  capsule.getBoundingClientRect = () => ({
    left: restLeft, top: restTop, right: restLeft + 120, bottom: restTop + 26,
    width: 120, height: 26, x: restLeft, y: restTop, toJSON() {},
  })
  const down = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: restLeft + 60, clientY: restTop + 13 })
  Object.defineProperty(down, 'pointerType', { value: 'touch' })
  capsule.dispatchEvent(down)
  // 8px: under the 10px touch slop → still a tap, not a drag.
  const move8 = new window.MouseEvent('pointermove', { bubbles: true, clientX: restLeft + 68, clientY: restTop + 13 })
  Object.defineProperty(move8, 'pointerType', { value: 'touch' })
  window.document.dispatchEvent(move8)
  await frame(window)
  assert.equal(capsule.style.transform, '', '8px is under the touch slop (10px)')
  // 12px: past the touch slop → dragging.
  const move12 = new window.MouseEvent('pointermove', { bubbles: true, clientX: restLeft + 72, clientY: restTop + 13 })
  Object.defineProperty(move12, 'pointerType', { value: 'touch' })
  window.document.dispatchEvent(move12)
  await frame(window)
  assert.match(capsule.style.transform, /translate3d\(12px, 0px, 0\) scale\(1\.03\)/, '12px crosses the touch slop')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: restLeft + 72, clientY: restTop + 13, button: 0 }))
  await turn()
  dispose()
  window.close()

  const mouse = dom()
  mouse.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  await mounted(mouse, snapshot([glmProvider(), copilotProvider()]))
  const mouseCapsule = floatSurface(mouse)
  mouseCapsule.getBoundingClientRect = () => ({
    left: 8, top: 80, right: 128, bottom: 106, width: 120, height: 26, x: 8, y: 80, toJSON() {},
  })
  mouseCapsule.dispatchEvent(new mouse.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 68, clientY: 93 }))
  mouse.document.dispatchEvent(new mouse.MouseEvent('pointermove', { bubbles: true, clientX: 76, clientY: 93 }))
  await frame(mouse)
  assert.ok(mouseCapsule.style.transform.includes('translate3d(8px'), '8px crosses the mouse slop (6px)')
  mouse.document.dispatchEvent(new mouse.MouseEvent('pointerup', { bubbles: true, clientX: 76, clientY: 93, button: 0 }))
  await turn()
  dispose()
  mouse.close()
})

test('pointercancel aborts the drag cleanly without persisting', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const restLeft = window.innerWidth - 8 - 38
  const restTop = window.innerHeight - 8 - 26
  capsule.getBoundingClientRect = () => ({
    left: restLeft, top: restTop, right: restLeft + 120, bottom: restTop + 26,
    width: 120, height: 26, x: restLeft, y: restTop, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: restLeft + 60, clientY: restTop + 13 }))
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 700, clientY: 500 }))
  await frame(window)
  assert.ok(capsule.style.transform.includes('translate3d'), 'drag is active before the cancel')
  // doc-level listener relies on bubbling: jsdom events default composed:false.
  window.document.dispatchEvent(new window.Event('pointercancel', { bubbles: true }))
  await turn()
  assert.equal(capsule.style.transform, '', 'cancel clears the gesture transform')
  assert.ok(!capsule.className.includes('dqw-capsule--dragging'))
  assert.equal(window.document.body.style.userSelect, '', 'userSelect is restored')
  assert.equal(window.localStorage.getItem(FLOAT_DOCK_KEY), null, 'cancel never persists a dock')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false, 'cancel does not suppress the click')
  dispose()
  window.close()
})

test('a long touch press opens the context menu and suppresses the trailing click', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const menu = host.shadowRoot.querySelector('[data-dsh-quota-watch-menu]')
  const down = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 })
  Object.defineProperty(down, 'pointerType', { value: 'touch' })
  capsule.dispatchEvent(down)
  await new Promise((resolve) => setTimeout(resolve, 520))
  assert.equal(menu.hidden, false, '500ms long press opens the menu (iOS parity for contextmenu)')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 500, clientY: 500, button: 0 }))
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true, 'the trailing click after a long press is suppressed')
  dispose()
  window.close()
})

test('long-press edges: quick tap, movement cancel and mouse stay untouched', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const menu = host.shadowRoot.querySelector('[data-dsh-quota-watch-menu]')

  // Quick tap: up well inside 500ms → click still opens the panel.
  const tapDown = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 })
  Object.defineProperty(tapDown, 'pointerType', { value: 'touch' })
  capsule.dispatchEvent(tapDown)
  await new Promise((resolve) => setTimeout(resolve, 50))
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 500, clientY: 500, button: 0 }))
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false, 'a quick tap keeps the click behavior')
  assert.equal(menu.hidden, true, 'a quick tap does not open the menu')
  window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
  await turn()

  // Movement past the slop cancels the pending long press.
  const dragDown = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 })
  Object.defineProperty(dragDown, 'pointerType', { value: 'touch' })
  capsule.dispatchEvent(dragDown)
  const dragMove = new window.MouseEvent('pointermove', { bubbles: true, clientX: 560, clientY: 520 })
  Object.defineProperty(dragMove, 'pointerType', { value: 'touch' })
  window.document.dispatchEvent(dragMove)
  await new Promise((resolve) => setTimeout(resolve, 520))
  assert.equal(menu.hidden, true, 'movement past the slop cancels the long press')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 560, clientY: 520, button: 0 }))
  await turn()

  // Mouse long press does nothing (desktop has the real contextmenu).
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 }))
  await new Promise((resolve) => setTimeout(resolve, 520))
  assert.equal(menu.hidden, true, 'mouse presses never trigger the long-press menu')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 500, clientY: 500, button: 0 }))
  dispose()
  window.close()
})

test('repeat contextmenu on an open menu is a no-op', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const menu = host.shadowRoot.querySelector('[data-dsh-quota-watch-menu]')
  capsule.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
  await turn()
  assert.equal(menu.hidden, false)
  const first = menu.children[0]
  // Android fires the native contextmenu after the long-press timer — the
  // guard must keep the already-open menu untouched (identity, not structure:
  // a rebuilt menu is structurally identical).
  capsule.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
  await turn()
  assert.equal(menu.hidden, false)
  assert.ok(menu.children[0] === first, 'menu children are not rebuilt')
  dispose()
  window.close()
})

test('safe-area insets shift the dock away from the notch', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  window.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '20px' })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(host.style.left, '28px', 'left dock x = margin 8 + inset 20')
  assert.equal(host.style.top, '80px')
  dispose()
  window.close()
})

test('scroll re-anchors the panel through the coalesced frame', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const capsule = floatSurface(window)
  let rect = { left: 100, top: 50, right: 220, bottom: 76, width: 120, height: 26, x: 100, y: 50, toJSON() {} }
  capsule.getBoundingClientRect = () => rect
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.style.left, '228px', 'anchored at rect.right + 8')
  // A scroll burst moves the anchor; one coalesced frame must be enough to
  // re-anchor (the lock fails if scroll handling ever stops updating).
  rect = { ...rect, left: 200, right: 320, x: 200 }
  window.document.dispatchEvent(new window.Event('scroll', { bubbles: true }))
  window.document.dispatchEvent(new window.Event('scroll', { bubbles: true }))
  window.document.dispatchEvent(new window.Event('scroll', { bubbles: true }))
  await frame(window)
  assert.equal(panel.style.left, '328px', 're-anchored after the coalesced frame')
  dispose()
  window.close()
})

test('release snaps to the dock through the animation path when motion is allowed', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"left","offsetY":80}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true }), configurable: true })
  const restLeft = 8
  const restTop = 80
  capsule.getBoundingClientRect = () => ({
    left: restLeft, top: restTop, right: restLeft + 120, bottom: restTop + 26,
    width: 120, height: 26, x: restLeft, y: restTop, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: restLeft + 60, clientY: restTop + 13 }))
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 200 }))
  await frame(window)
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 400, clientY: 200, button: 0 }))
  await turn()
  assert.ok(capsule.className.includes('dqw-capsule--snapping'), 'animation path engages the snapping transition')
  assert.ok(!capsule.className.includes('dqw-capsule--dragging'))
  // jsdom never fires real transitions: the synthetic event proves the
  // transitionend branch commits; the later timer window proves first-wins.
  capsule.dispatchEvent(new window.Event('transitionend'))
  await turn()
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_DOCK_KEY))
  assert.deepEqual(saved, { edge: 'left', offsetY: 187 })
  assert.equal(host.style.left, '8px')
  assert.equal(host.style.top, '187px')
  assert.equal(capsule.style.transform, '')
  assert.ok(!capsule.className.includes('dqw-capsule--snapping'))
  const storageAfterCommit = window.localStorage.getItem(FLOAT_DOCK_KEY)
  await new Promise((resolve) => setTimeout(resolve, 260))
  assert.equal(window.localStorage.getItem(FLOAT_DOCK_KEY), storageAfterCommit, 'fallback timer after the transitionend is a no-op (first one wins)')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true, 'the trailing click after a snap is suppressed')
  dispose()
  window.close()
})

test('float style text carries the drag and touch affordances', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const css = host.shadowRoot.querySelector('style').textContent
  assert.match(css, /dqw-capsule--dragging/)
  assert.match(css, /dqw-capsule--snapping/)
  assert.match(css, /will-change:\s*transform/)
  assert.match(css, /backdrop-filter:\s*none/)
  assert.match(css, /prefers-reduced-motion: no-preference/)
  assert.match(css, /touch-action:\s*none/, 'touch panning must not steal the drag gesture')
  assert.match(css, /-webkit-tap-highlight-color:\s*transparent/)
  assert.match(css, /-webkit-touch-callout:\s*none/)
  assert.match(css, /\.dqw-capsule::before[^}]*inset:\s*-9px/, 'hit area padded to 44px around the 26px pill')
  assert.match(css, /\.dqw-panel--sheet/, 'narrow viewports dock the panel to the bottom')
  assert.match(css, /safe-area-inset-bottom/)
  assert.match(css, /100dvh/)
  assert.match(css, /\.dqw-capsule \{[^}]*cursor:\s*grab/, 'rest cursor advertises draggability')
  assert.match(css, /cursor:\s*grabbing/)
  assert.match(css, /\.dqw-capsule:active[^}]*scale\(\.98\)/, 'press feedback')
  assert.match(css, /\.dqw-capsule:hover[^}]*box-shadow/, 'hover lift deepens the shadow')
  dispose()
  window.close()
})

test('narrow viewports get the bottom-sheet panel', async () => {
  const window = dom()
  window.innerWidth = 400
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.classList.contains('dqw-panel--sheet'), true, '≤480px engages the sheet')
  assert.equal(panel.style.left, '', 'inline anchor positioning is dropped in sheet mode')
  window.innerWidth = 800
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  assert.equal(panel.classList.contains('dqw-panel--sheet'), false, 'widening restores the anchored panel')
  assert.notEqual(panel.style.left, '')
  dispose()
  window.close()
})

test('capsule percent spans switch color classes past thresholds', async () => {
  const window = dom()
  const provider = glmProvider()
  provider.plan.windows = [{ key: '5h', percent: 95.1 }]
  const { dispose } = await mounted(window, snapshot([provider]))
  const glmSpan = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('.dqw-capsule-glm')
  assert.equal(glmSpan.classList.contains('danger'), true)
  dispose()
  window.close()
})

test('context menu exposes the actions', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  const menu = root.querySelector('[data-dsh-quota-watch-menu]')
  assert.ok(menu, 'menu element lives in the float shadow root')
  assert.equal(menu.hidden, true)
  floatSurface(window).dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await turn()
  assert.equal(menu.hidden, false)
  const items = [...menu.querySelectorAll('[data-menu]')].map((item) => item.dataset.menu)
  assert.deepEqual(items, ['toggle-card', 'refresh'])
  dispose()
  window.close()
})

test('menu actions persist flags and refresh', async () => {
  const window = dom()
  const { dispose, requests } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const menu = root.querySelector('[data-dsh-quota-watch-menu]')
  const surfaceEl = () => root.querySelector('[data-dsh-quota-watch-capsule]')
  const openMenu = async () => {
    surfaceEl().dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await turn()
  }
  const clickItem = async (action) => {
    await openMenu()
    menu.querySelector(`[data-menu="${action}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
  }
  // toggle-card: the card is opt-in — first click reveals it, second hides it
  assert.equal(container.hidden, true, 'card is opt-in and hidden by default')
  await clickItem('toggle-card')
  assert.deepEqual(JSON.parse(window.localStorage.getItem(SURFACE_FLAGS_KEY)), { cardHidden: false })
  assert.equal(container.hidden, false)
  await clickItem('toggle-card')
  assert.deepEqual(JSON.parse(window.localStorage.getItem(SURFACE_FLAGS_KEY)), { cardHidden: true })
  assert.equal(container.hidden, true)
  // refresh: host probe POST
  await clickItem('refresh')
  assert.deepEqual(requests.at(-1), { path: 'api/dsh-quota-watch/refresh', method: 'POST' })
  dispose()
  window.close()
})

test('card hidden flag persists across remounts', async () => {
  const window = dom()
  window.localStorage.setItem(SURFACE_FLAGS_KEY, '{"cardHidden":true}')
  const first = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.equal(container.hidden, true, 'card stays hidden after a fresh mount')
  first.dispose()
  window.close()
})

test('escape closes the menu first and the panel second', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  const capsule = root.querySelector('[data-dsh-quota-watch-capsule]')
  const menu = root.querySelector('[data-dsh-quota-watch-menu]')
  const panel = root.querySelector('[data-dsh-quota-watch-panel]')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  capsule.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await turn()
  assert.equal(menu.hidden, false)
  assert.equal(panel.hidden, false)
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await turn()
  assert.equal(menu.hidden, true, 'first escape closes the menu')
  assert.equal(panel.hidden, false, 'panel survives the first escape')
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true, 'second escape closes the panel')
  dispose()
  window.close()
})

test('footless profiles hide the toggle-card menu item', async () => {
  const window = dom({ footless: true })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  floatSurface(window).dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await turn()
  const items = [...root.querySelectorAll('[data-menu]')].map((item) => item.dataset.menu)
  assert.deepEqual(items, ['refresh'])
  dispose()
  window.close()
})

test('clicking the provider label re-probes without toggling the row', async () => {
  const window = dom()
  const { dispose, requests } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const glmRow = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  const label = glmRow.querySelector('.dqw-label[data-action="refresh"]')
  assert.ok(label, 'provider label carries the refresh action')
  label.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.deepEqual(requests.at(-1), { path: 'api/dsh-quota-watch/refresh', method: 'POST' })
  assert.equal(container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').getAttribute('aria-expanded'), 'false', 'label click does not expand the row')
  assert.equal(window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]').hidden, true)
  dispose()
  window.close()
})

test('rows toggle with keyboard activation', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const glmRow = container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.equal(glmRow.getAttribute('tabindex'), '0')
  glmRow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await turn()
  assert.equal(window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]').hidden, false)
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }))
  await turn()
  assert.equal(window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]').hidden, true)
  dispose()
  window.close()
})

test('GLM detail renders big numbers, all windows, models and the updated time', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
  assert.match(detail.textContent, /8\.3M/)
  assert.match(detail.textContent, /Today tokens/)
  assert.match(detail.textContent, /152/)
  assert.match(detail.textContent, /Calls/)
  const wins = detail.querySelector('.dqw-wins')
  assert.ok(wins, 'windows render as one aligned grid')
  const cells = [...wins.children]
  assert.equal(cells.length, 15, 'three window rows × five columns (name · used value note)')
  assert.equal(cells[0].textContent, 'MCP (month)')
  assert.equal(cells[1].textContent, '·')
  assert.equal(cells[2].textContent, 'used')
  assert.match(cells[3].textContent, /1%/)
  assert.match(cells[4].textContent, /^（ Resets: .+ ）$/)
  assert.match(cells[4].textContent, /2026\/11\/01/)
  assert.equal(cells[5].textContent, '5-hour quota')
  assert.match(cells[8].textContent, /13%/)
  assert.equal(cells[10].textContent, 'Weekly quota')
  assert.equal(cells[11].textContent, '·')
  assert.match(cells[12].textContent, /♾️/, 'unlimited mark aligns with the used column')
  assert.equal(cells[14].textContent, ' ( unlimited )')
  for (const index of [4, 9]) {
    assert.ok(cells[index].classList.contains('dqw-kv-sub'), 'reset time renders as weakened text')
  }
  assert.equal(detail.querySelector('.dqw-bar-fill'), null, 'window bars are dropped from the detail')
  assert.equal(detail.querySelector('.dqw-updated'), null, 'per-provider updated line is removed')
  const modelRows = detail.querySelectorAll('.dqw-model-row')
  assert.equal(modelRows.length, 2)
  assert.match(modelRows[0].textContent, /^GLM-5\.3/)
  assert.match(modelRows[0].textContent, /21\.4K/)
  assert.match(modelRows[1].textContent, /GLM-5\.3-Flash/)
  assert.match(modelRows[1].textContent, /8\.3M/)
  dispose()
  window.close()
})

test('Chinese reset and unlimited notes use spaced parentheses and padded dates', async () => {
  const window = dom({ locale: 'zh-CN' })
  const provider = glmProvider()
  provider.plan.windows.find((item) => item.key === 'mcp').resetsAt = '2026-01-01T00:00:00.000Z'
  const { dispose } = await mounted(window, snapshot([provider]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
  const cells = [...detail.querySelector('.dqw-wins').children]
  assert.match(cells[4].textContent, /^（ 重置: .+ ）$/)
  assert.match(cells[4].textContent, /2026\/01\/01/)
  assert.equal(cells[14].textContent, '（ 无限 ）')
  dispose()
  window.close()
})

test('a reported weekly window renders real data in fixed order without the placeholder', async () => {
  const window = dom()
  const provider = glmProvider()
  provider.plan.windows = [
    { key: 'mcp', percent: 1, resetsAt: '2026-11-01T00:00:00.000Z' },
    { key: 'month', percent: 8, resetsAt: '2026-11-01T00:00:00.000Z' },
    { key: 'week', percent: 72, resetsAt: '2026-10-04T00:00:00.000Z' },
    { key: '5h', percent: 12.5, resetsAt: '2026-10-01T13:00:00.000Z' },
  ]
  const { dispose } = await mounted(window, snapshot([provider]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
  const wins = detail.querySelector('.dqw-wins')
  assert.ok(wins)
  const cells = [...wins.children]
  assert.equal(cells.length, 20, 'no placeholder when the provider reports a weekly window')
  assert.equal(cells[0].textContent, 'MCP (month)')
  assert.match(cells[3].textContent, /1%/)
  assert.equal(cells[5].textContent, '5-hour quota')
  assert.match(cells[8].textContent, /13%/)
  assert.equal(cells[10].textContent, 'Monthly quota')
  assert.match(cells[13].textContent, /8%/)
  assert.equal(cells[15].textContent, 'Weekly quota')
  assert.match(cells[18].textContent, /72%/)
  assert.doesNotMatch(wins.textContent, /♾️/)
  dispose()
  window.close()
})

test('Copilot detail renders simplified balance, used and reset rows without a bar', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="copilot"]')
  const kvRows = detail.querySelectorAll('.dqw-kv')
  assert.equal(kvRows.length, 3)
  assert.match(kvRows[0].textContent, /Available credits/)
  assert.match(kvRows[0].textContent, /7,600 \/ 10,000/)
  assert.match(kvRows[1].textContent, /Used this cycle/)
  assert.match(kvRows[1].textContent, /2,400/)
  assert.match(kvRows[1].textContent, /24%/)
  const usedSub = kvRows[1].querySelector('.dqw-kv-sub')
  assert.ok(usedSub, 'duplicate used percent renders weakened')
  assert.match(usedSub.textContent, /24%/)
  assert.match(kvRows[2].textContent, /Reset time/)
  assert.match(kvRows[2].textContent, /2026\/11\/01/)
  assert.equal(detail.querySelector('.dqw-bar-fill'), null, 'used bar is dropped from the detail')
  dispose()
  window.close()
})

test('stale detail leads with the degradation banner', async () => {
  const window = dom()
  const stale = glmProvider({ status: 'stale', error: 'HTTP 503' })
  stale.usage = { ...stale.usage, status: 'stale' }
  const { dispose } = await mounted(window, snapshot([stale]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
  assert.match(detail.querySelector('.dqw-error').textContent, /Data may be stale: HTTP 503/)
  dispose()
  window.close()
})

test('hidden pages pause the client poll timer and visibility resumes it', async () => {
  const window = dom()
  let calls = 0
  const dispose = mountQuotaCard({
    doc: window.document,
    win: window,
    fetchImpl: async () => { calls += 1; return response(snapshot([glmProvider(), copilotProvider()])) },
    pollIntervalMs: 15,
  })
  await turn()
  const afterInitial = calls
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'hidden' })
  window.document.dispatchEvent(new window.Event('visibilitychange'))
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.equal(calls, afterInitial)

  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'visible' })
  window.document.dispatchEvent(new window.Event('visibilitychange'))
  await turn()
  assert.ok(calls > afterInitial)
  dispose()
  window.close()
})

test('card styles live inside the shadow root, not the document', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const documentStyles = [...window.document.querySelectorAll('style')]
  assert.equal(documentStyles.length, 0, 'no plugin style tag leaks into the document')
  const shadowStyle = container.shadowRoot.querySelector('style')
  assert.ok(shadowStyle, 'style ships inside the shadow root')
  assert.match(shadowStyle.textContent, /\.dqw-row-summary/)
  dispose()
  window.close()
})

test('collapsed web rail hides the card; the capsule keeps the entry', async () => {
  const window = dom({ collapsed: true })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.equal(container.hidden, true, 'card hides instead of clipping into garbled text')
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false, 'capsule still opens the panel in the collapsed rail')
  dispose()
  window.close()
})

test('collapsed web rail hides the card even when opted in; the capsule keeps the entry', async () => {
  const window = dom({ locale: 'zh-CN', collapsed: true })
  window.localStorage.setItem(SURFACE_FLAGS_KEY, '{"cardHidden":false}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  // The collapsed rail keeps the footArea but squeezes it (~55px, measurable) —
  // the width guard hides the card; no collapse attribute is consulted at all.
  const foot = window.document.querySelector('.footArea')
  Object.defineProperty(foot, 'clientWidth', { configurable: true, value: 55 })
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  assert.equal(container.hidden, true, 'card hides instead of clipping into garbled text')
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false, 'capsule still opens the panel in the collapsed rail')
  dispose()
  window.close()
})

test('0.1.2 regression guards: hidden-attr display rules and 0.0.18 panel sizing', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const floatStyle = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('style').textContent
  const cardStyle = container.shadowRoot.querySelector('style').textContent
  assert.match(floatStyle, /\.dqw-capsule\[hidden\]\s*{\s*display: none/, 'a hidden capsule must actually disappear (author display beats the UA [hidden] rule)')
  assert.match(cardStyle, /@media print\s*{\s*:host { display: none !important; }/, 'card hides in print')
  assert.match(floatStyle, /min-width: 166px/, 'panel width strategy matches the 0.0.18 pop (content-driven, capped)')
  assert.doesNotMatch(floatStyle, /max-width: 240px/, 'overview rows keep the 0.0.18 full-row width (bars ≈112px)')
  assert.match(floatStyle, /\.dqw-bar { display: block; flex: 0 0 auto; width: 100px;/, 'panel bars match the sidebar card bar length')
  assert.match(cardStyle, /\.dqw-bar { display: block; flex: 1;/, 'card rows keep the adaptive flex bar')
  assert.match(cardStyle, /@media print\s*{\s*:host { display: none !important; }/, 'card hides in print')
  dispose()
  window.close()
})

test('the float shell is mounted at most once even without a card', async () => {
  const window = dom({ footless: true })
  const first = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const second = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  assert.equal(window.document.querySelectorAll('[data-dsh-quota-watch-float]').length, 1, 'no duplicate float shell on re-mount')
  first.dispose()
  second.dispose()
  window.close()
})

test('a narrow foot hides the card on any profile, without any collapse signal', async () => {
  const window = dom()
  window.localStorage.setItem(SURFACE_FLAGS_KEY, '{"cardHidden":false}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const foot = window.document.querySelector('.footArea')
  assert.equal(container.hidden, false, 'card visible at unknown width')
  Object.defineProperty(foot, 'clientWidth', { configurable: true, value: 126 })
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  assert.equal(container.hidden, true, 'narrow foot hides the card (capsule carries the entry)')
  assert.equal(floatSurface(window).hidden, false, 'capsule unaffected by the narrow foot')
  Object.defineProperty(foot, 'clientWidth', { configurable: true, value: 400 })
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  assert.equal(container.hidden, false, 'wide foot restores the card')
  dispose()
  window.close()
})

test('shrinking the viewport re-docks the capsule without clobbering the stored dock', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_DOCK_KEY, '{"edge":"right","offsetY":100}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(host.style.left, `${window.innerWidth - 8 - 38}px`)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  // x re-derives from the stored edge at the new viewport; offsetY clamps visually only.
  assert.equal(host.style.left, `${400 - 8 - 38}px`)
  assert.ok(parseFloat(host.style.top) <= 300 - 8 - 26, `top clamped into the small viewport: ${host.style.top}`)
  assert.deepEqual(JSON.parse(window.localStorage.getItem(FLOAT_DOCK_KEY)), { edge: 'right', offsetY: 100 }, 'storage keeps the preferred dock')
  dispose()
  window.close()
})

test('panel keeps its position across row re-renders and scrolls', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const leftBefore = panel.style.left
  const topBefore = panel.style.top
  // The label click forces a re-probe; renderAll re-creates the anchor rows.
  window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('.dqw-label[data-action="refresh"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  window.document.dispatchEvent(new window.Event('scroll'))
  await turn()
  assert.equal(panel.dataset.dshQuotaWatchPanelDetail, undefined, 'overview stays open across the re-render')
  assert.equal(panel.style.left, leftBefore, 'scroll does not teleport the panel sideways')
  assert.equal(panel.style.top, topBefore, 'scroll does not teleport the panel vertically')
  dispose()
  window.close()
})
