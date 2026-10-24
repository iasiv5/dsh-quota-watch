import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountQuotaCard } from '../src/client.mjs'
import { FLOAT_POSITION_KEY, SURFACE_FLAGS_KEY } from '../src/client/prefs.mjs'

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

test('steady-state app mutations cost zero seat-discovery scans; displacement still heals', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const document = window.document
  // Every place() discovery opens with doc.querySelector('[class*="sidebarCol"]');
  // count those full-document scans while the seat is stable.
  const realQuerySelector = document.querySelector.bind(document)
  let docScans = 0
  document.querySelector = (selector) => {
    if (selector.includes('sidebarCol')) docScans += 1
    return realQuerySelector(selector)
  }
  // Streaming-style chatter: small nodes appended deep inside the app frame.
  const frame = document.querySelector('.frame')
  for (let i = 0; i < 30; i += 1) {
    frame.append(document.createElement('p'))
    await turn()
  }
  assert.equal(docScans, 0, 'seated steady state never rescans the document')

  // A real displacement inside the live foot fails the seat check and heals.
  const foot = document.querySelector('.footArea')
  const container = document.querySelector('[data-dsh-quota-watch-card]')
  foot.append(container)
  await turn()
  assert.ok(docScans > 0, 'a displacement triggers discovery')
  assert.equal(foot.firstElementChild, container, 'displaced card re-claims the first slot')
  dispose()
  window.close()
})

test('a footless page skips discovery entirely until a sidebar appears', async () => {
  const window = dom({ footless: true })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const document = window.document
  assert.equal(document.querySelector('[data-dsh-quota-watch-card]'), null, 'no card without footArea')
  const realQuerySelector = document.querySelector.bind(document)
  let docScans = 0
  document.querySelector = (selector) => {
    if (selector.includes('sidebarCol')) docScans += 1
    return realQuerySelector(selector)
  }
  const frame = document.querySelector('.frame')
  for (let i = 0; i < 20; i += 1) {
    frame.append(document.createElement('p'))
    await turn()
  }
  assert.equal(docScans, 0, 'footless steady state never rescans the document')

  // A sidebar appearing IS a seat-introducing batch: discovery runs at once.
  const sidebar = document.createElement('div')
  sidebar.className = 'sidebarCol'
  sidebar.innerHTML = '<div class="footArea"></div>'
  frame.append(sidebar)
  await turn()
  assert.ok(docScans > 0, 'a seat-introducing batch triggers discovery')
  const foot = document.querySelector('.footArea')
  const container = document.querySelector('[data-dsh-quota-watch-card]')
  assert.ok(container, 'card mounts when the sidebar appears')
  assert.equal(foot.firstElementChild, container, 'card claims the first slot of the new foot')
  dispose()
  window.close()
})

test('sidebar teardown and rebuild re-seats the card in the new foot', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const document = window.document
  const oldFoot = document.querySelector('.footArea')
  const container = document.querySelector('[data-dsh-quota-watch-card]')
  assert.equal(oldFoot.firstElementChild, container)

  document.querySelector('.sidebarCol').remove()
  await turn()
  const fresh = document.createElement('div')
  fresh.className = 'sidebarCol'
  fresh.innerHTML = '<div class="footArea"><div class="settingsArea"></div></div>'
  document.querySelector('.frame').append(fresh)
  await turn()
  const newFoot = document.querySelector('.footArea')
  assert.notEqual(newFoot, oldFoot)
  assert.equal(newFoot.firstElementChild, container, 'card re-seats as the first child of the rebuilt foot')
  dispose()
  window.close()
})

test('a new earlier sidebar wins the seat even while the old foot stays connected', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const document = window.document
  const frame = document.querySelector('.frame')
  const container = document.querySelector('[data-dsh-quota-watch-card]')
  const earlier = document.createElement('div')
  earlier.className = 'sidebarCol'
  earlier.innerHTML = '<div class="footArea"></div>'
  frame.insertBefore(earlier, frame.firstChild)
  await turn()
  const feet = document.querySelectorAll('.footArea')
  assert.equal(feet.length, 2)
  assert.equal(feet[0].firstElementChild, container, 'card migrates to the doc-order-first foot')
  dispose()
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

test('0.1.24: inactive provider spans are hidden so single-provider capsule text stays centered', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const capsule = floatSurface(window)
  const glm = capsule.querySelector('.dqw-capsule-glm')
  const copilot = capsule.querySelector('.dqw-capsule-copilot')
  const sep = capsule.querySelector('.dqw-capsule-sep')
  assert.match(glm.textContent, /GLM 13%/)
  assert.equal(glm.hidden, false, 'the visible provider span stays mounted')
  assert.equal(copilot.hidden, true, 'an emptied span must not linger as a flex item: the 6px gap beside it made single-provider text off center')
  assert.equal(copilot.textContent, '', 'the inactive span is also emptied')
  assert.equal(sep.hidden, true, 'separator stays hidden with a single provider')
  const floatStyle = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('style').textContent
  assert.match(floatStyle, /\.dqw-capsule \[hidden\]\s*{\s*display: none/, 'capsule child spans honor hidden even if a future author display rule lands (0.1.2 lesson)')
  dispose()
  window.close()

  const both = dom()
  const { dispose: disposeBoth } = await mounted(both, snapshot([glmProvider(), copilotProvider()]))
  const bothCapsule = floatSurface(both)
  assert.equal(bothCapsule.querySelector('.dqw-capsule-glm').hidden, false)
  assert.equal(bothCapsule.querySelector('.dqw-capsule-copilot').hidden, false)
  assert.equal(bothCapsule.querySelector('.dqw-capsule-sep').hidden, false, 'separator returns with both providers')
  disposeBoth()
  both.close()
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
  assert.equal(panel.dataset.dshQuotaWatchPanelDetail, undefined, 'overview state carries no detail marker (width pin keys off this attr)')
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
  assert.equal(panel.dataset.dshQuotaWatchPanelOverview, undefined, 'detail state drops the overview width pin (0.0.18 width strategy applies)')
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

test('capsule restores the persisted position and clamps off-screen offsets', async () => {
  const seeded = dom()
  seeded.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":120,"y":80}')
  const seededMounted = await mounted(seeded, snapshot([glmProvider(), copilotProvider()]))
  const seededHost = seeded.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(seededHost.style.left, '120px')
  assert.equal(seededHost.style.top, '80px')
  seededMounted.dispose()
  seeded.close()

  const window = dom()
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":-500,"y":99999}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(host.style.left, '8px')
  assert.ok(parseFloat(host.style.top) <= 600 - 8 - 26, `top clamped to 600-8-26 band, got ${host.style.top}`)
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_POSITION_KEY))
  assert.deepEqual(saved, { x: -500, y: 99999 }, 'mount clamps visually but never clobbers the stored position')
  dispose()
  window.close()

  const corrupted = dom()
  corrupted.localStorage.setItem(FLOAT_POSITION_KEY, 'not-json')
  const corruptedMounted = await mounted(corrupted, snapshot([glmProvider(), copilotProvider()]))
  const corruptedHost = corrupted.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(corruptedHost.style.left, `${corrupted.innerWidth - 8 - 38}px`, 'corrupt position falls back to the right-bottom default with the fallback width')
  assert.equal(corruptedHost.style.top, `${corrupted.innerHeight - 8 - 26}px`)
  corruptedMounted.dispose()
  corrupted.close()
})

test('capsule position respects measured width when clamping', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":9999,"y":80}')
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
    assert.equal(host.style.left, `${window.innerWidth - 8 - 120}px`, 'right-edge clamped x = viewport - margin - measured width')
    assert.equal(host.style.top, '80px')
    dispose()
  } finally {
    window.Element.prototype.getBoundingClientRect = original
  }
  window.close()
})

test('capsule drag follows the pointer via transform and stays at released position', async () => {
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
  assert.match(host.style.transform, /translate3d\(-338px, -247px, 0\)/, 'floatHost moves via transform relative to the rest position')
  assert.equal(host.style.left, `${restLeft}px`, 'host rest position is untouched during the gesture')
  assert.equal(host.style.top, `${restTop}px`)
  assert.ok(capsule.className.includes('dqw-capsule--dragging'), 'dragging class suspends the glass affordance')
  // jsdom's synthetic MouseEvents are not composed: dispatch move/up on the
  // document so the doc-level drag listeners actually receive them (real
  // browsers bubble these out of the shadow root).
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 700, clientY: 500, button: 0 }))
  await turn()
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_POSITION_KEY))
  assert.deepEqual(saved, { x: 640, y: 487 }, 'released at exact grab point: x = 700 - 60, y = 500 - 13')
  assert.equal(host.style.left, '640px', 'host position committed to exact released point')
  assert.equal(host.style.top, '487px')
  assert.equal(host.style.transform, '', 'transform on host is cleared once committed')
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

test('capsule drag persists position', async () => {
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
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_POSITION_KEY))
  assert.deepEqual(saved, { x: 240, y: 187 }, 'released at exact grab point: x = 300 - 60, y = 200 - 13')
  assert.equal(host.style.left, '240px')
  assert.equal(host.style.top, '187px')
  dispose()
  window.close()
})

test('the grab point stays under the cursor while dragging', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":8,"y":80}')
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
  assert.match(host.style.transform, /translate3d\(30px, 0px, 0\)/, 'floatHost shifts +30px with the pointer (grab point preserved, not top-left-pinned)')
  dispose()
  window.close()
})

test('touch pointers get the larger drag slop, mouse keeps 6px', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":8,"y":80}')
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
  assert.equal(host.style.transform, '', '8px is under the touch slop (10px)')
  // 12px: past the touch slop → dragging.
  const move12 = new window.MouseEvent('pointermove', { bubbles: true, clientX: restLeft + 72, clientY: restTop + 13 })
  Object.defineProperty(move12, 'pointerType', { value: 'touch' })
  window.document.dispatchEvent(move12)
  await frame(window)
  assert.match(host.style.transform, /translate3d\(12px, 0px, 0\)/, '12px crosses the touch slop')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: restLeft + 72, clientY: restTop + 13, button: 0 }))
  await turn()
  dispose()
  window.close()

  const mouse = dom()
  mouse.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":8,"y":80}')
  await mounted(mouse, snapshot([glmProvider(), copilotProvider()]))
  const mouseHost = mouse.document.querySelector('[data-dsh-quota-watch-float]')
  const mouseCapsule = floatSurface(mouse)
  mouseCapsule.getBoundingClientRect = () => ({
    left: 8, top: 80, right: 128, bottom: 106, width: 120, height: 26, x: 8, y: 80, toJSON() {},
  })
  mouseCapsule.dispatchEvent(new mouse.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 68, clientY: 93 }))
  mouse.document.dispatchEvent(new mouse.MouseEvent('pointermove', { bubbles: true, clientX: 76, clientY: 93 }))
  await frame(mouse)
  assert.ok(mouseHost.style.transform.includes('translate3d(8px'), '8px crosses the mouse slop (6px)')
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
  assert.ok(host.style.transform.includes('translate3d'), 'drag is active before the cancel')
  // doc-level listener relies on bubbling: jsdom events default composed:false.
  window.document.dispatchEvent(new window.Event('pointercancel', { bubbles: true }))
  await turn()
  assert.equal(host.style.transform, '', 'cancel clears the gesture transform on host')
  assert.ok(!capsule.className.includes('dqw-capsule--dragging'))
  assert.equal(window.document.body.style.userSelect, '', 'userSelect is restored')
  assert.equal(window.localStorage.getItem(FLOAT_POSITION_KEY), null, 'cancel never persists a position')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false, 'cancel does not suppress the click')
  dispose()
  window.close()
})

test('a long touch press opens nothing — the actions live in the panel footer', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const down = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 })
  Object.defineProperty(down, 'pointerType', { value: 'touch' })
  capsule.dispatchEvent(down)
  await new Promise((resolve) => setTimeout(resolve, 520))
  assert.equal(host.shadowRoot.querySelector('[data-dsh-quota-watch-menu]'), null, 'the context menu machinery is gone')
  assert.equal(panel.hidden, true, 'a held touch opens nothing by itself')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 500, clientY: 500, button: 0 }))
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false, 'the trailing click still opens the panel')
  dispose()
  window.close()
})

test('contextmenu on the capsule is left to the browser — no menu machinery', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const capsule = floatSurface(window)
  // Twice, like Android firing the native contextmenu after its long-press
  // timer: nothing must appear and nothing must throw.
  capsule.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  capsule.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await turn()
  assert.equal(host.shadowRoot.querySelector('[data-dsh-quota-watch-menu]'), null, 'no menu element exists at all')
  assert.equal(panel.hidden, true)
  dispose()
  window.close()
})

test('safe-area insets shift the default capsule position away from the notch', async () => {
  const window = dom()
  window.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '20px' })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  // default position is right-bottom; clamp honors left inset if pushed to the left
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":0,"y":80}')
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  assert.equal(host.style.left, '28px', 'x clamped to margin 8 + inset 20')
  assert.equal(host.style.top, '80px')
  dispose()
  window.close()
})

// --- Windows Desktop titlebar band (0.1.20, same contract as dsh-m 0.9.4) ---
// The desktop shell draws its caption (— □ ✕) over a full-width
// -webkit-app-region:drag strip at the top of the window; hits are decided by
// layout, so a capsule dropped there stops receiving pointer events entirely —
// it can neither be grabbed nor clicked, and its persisted position kept
// re-parking it on every boot. The shell exposes the band as
// data-windows-titlebar + --dsh-windows-titlebar-height on <html>.

test('a capsule parked in the shell titlebar band re-clamps below it on mount', async () => {
  const window = dom()
  const html = window.document.documentElement
  html.setAttribute('data-windows-titlebar', '')
  html.style.setProperty('--dsh-windows-titlebar-height', '40px')
  // The stuck state from the bug report: dragged to the DSH menu row (y≈8) and
  // saved there; 0.1.19 restored it into the band on every start.
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":500,"y":8}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(host.style.top, '48px', 'restored position clamps to margin 8 + band 40 — outside the drag strip')
  assert.equal(host.style.left, '500px', 'x is untouched')
  dispose()
  window.close()
})

test('drag release above the shell titlebar band docks below it instead', async () => {
  const window = dom()
  const html = window.document.documentElement
  html.setAttribute('data-windows-titlebar', '')
  html.style.setProperty('--dsh-windows-titlebar-height', '40px')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const capsule = floatSurface(window)
  capsule.getBoundingClientRect = () => ({
    left: 100, top: 100, right: 220, bottom: 126,
    width: 120, height: 26, x: 100, y: 100, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 160, clientY: 113 }))
  // A pointer path whose unclamped pill top-left would be (640, 8) — inside the band.
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 700, clientY: 21 }))
  await frame(window)
  assert.match(host.style.transform, /translate3d\(-338px, -686px, 0\)/, 'live drag frames are clamped below the band too')
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 700, clientY: 21, button: 0 }))
  await turn()
  const saved = JSON.parse(window.localStorage.getItem(FLOAT_POSITION_KEY))
  assert.deepEqual(saved, { x: 640, y: 48 }, 'release docks at margin 8 + band 40')
  assert.equal(host.style.top, '48px')
  dispose()
  window.close()
})

test('the panel header clears the shell titlebar band when anchored beside a high capsule', async () => {
  const window = dom()
  const html = window.document.documentElement
  html.setAttribute('data-windows-titlebar', '')
  html.style.setProperty('--dsh-windows-titlebar-height', '40px')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const capsule = floatSurface(window)
  capsule.getBoundingClientRect = () => ({
    left: 100, top: 8, right: 220, bottom: 34,
    width: 120, height: 26, x: 100, y: 8, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.style.left, '228px', 'anchor side is unchanged')
  assert.equal(panel.style.top, '48px', 'panel top clamps to margin 8 + band 40 — the ✕ stays clickable')
  dispose()
  window.close()
})

test('without the shell titlebar attributes nothing moves — Web behavior is byte-identical', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const panel = host.shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  const capsule = floatSurface(window)
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":500,"y":8}')
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  assert.equal(host.style.top, '8px', 'no band → no extra clamp on the capsule')
  capsule.getBoundingClientRect = () => ({
    left: 100, top: 8, right: 220, bottom: 34,
    width: 120, height: 26, x: 100, y: 8, toJSON() {},
  })
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.style.top, '8px', 'no band → no extra clamp on the panel')
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

test('disposing mid-drag restores the body user-select', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const capsule = floatSurface(window)
  capsule.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 }))
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 560, clientY: 520 }))
  await frame(window)
  assert.equal(window.document.body.style.userSelect, 'none', 'drag sets the body user-select')
  dispose()
  assert.equal(window.document.body.style.userSelect, '', 'dispose restores it even mid-gesture')
  window.close()
})

test('float style text carries the drag and touch affordances', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  const css = host.shadowRoot.querySelector('style').textContent
  assert.match(css, /dqw-capsule--dragging/)
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
  assert.match(css, /\.dqw-capsule--dragging[^}]*scale\(1\.04\)/, 'lift feedback when dragging')
  assert.equal(host.style.willChange, '')
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

test('the panel overview footer exposes the actions', async () => {
  const window = dom({ locale: 'zh-CN' })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const actions = root.querySelector('.dqw-panel-actions')
  assert.ok(actions, 'the footer grid lives in the float shadow root next to the panel')
  const buttons = [...actions.querySelectorAll('button')].map((button) => button.dataset.action)
  assert.deepEqual(buttons, ['toggle-card', 'panel-refresh'])
  assert.equal(actions.querySelector('[data-action="toggle-card"]').textContent, '显示侧边栏卡片', 'the card is opt-in, so the footer offers to reveal it')
  assert.equal(actions.querySelector('[data-action="panel-refresh"]').textContent, '立即刷新')
  dispose()
  window.close()
})

test('panel footer actions persist flags and refresh', async () => {
  const window = dom()
  const { dispose, requests } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const panel = root.querySelector('[data-dsh-quota-watch-panel]')
  assert.equal(panel.hidden, false)
  const clickAction = async (action) => {
    panel.querySelector(`[data-action="${action}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
  }
  // toggle-card: the card is opt-in — first click reveals it, second hides it
  assert.equal(container.hidden, true, 'card is opt-in and hidden by default')
  await clickAction('toggle-card')
  assert.deepEqual(JSON.parse(window.localStorage.getItem(SURFACE_FLAGS_KEY)), { cardHidden: false })
  assert.equal(container.hidden, false)
  assert.equal(panel.hidden, false, 'the panel stays open across the toggle')
  assert.ok(panel.querySelector('[data-action="toggle-card"]'), 'the toggle re-renders inside the still-open panel')
  await clickAction('toggle-card')
  assert.deepEqual(JSON.parse(window.localStorage.getItem(SURFACE_FLAGS_KEY)), { cardHidden: true })
  assert.equal(container.hidden, true)
  // refresh: host probe POST
  await clickAction('panel-refresh')
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

test('escape closes the panel directly', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  const capsule = root.querySelector('[data-dsh-quota-watch-capsule]')
  const panel = root.querySelector('[data-dsh-quota-watch-panel]')
  capsule.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.hidden, false)
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await turn()
  assert.equal(panel.hidden, true, 'escape closes the panel')
  dispose()
  window.close()
})

test('footless profiles render only the refresh action in the footer', async () => {
  const window = dom({ footless: true })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const actions = root.querySelector('.dqw-panel-actions')
  assert.ok(actions, 'the footer renders even without a sidebar mount point')
  const buttons = [...actions.querySelectorAll('button')].map((button) => button.dataset.action)
  assert.deepEqual(buttons, ['panel-refresh'])
  dispose()
  window.close()
})

test('switching the host language re-renders the UI without a reload', async () => {
  const window = dom({ locale: 'zh-CN' })
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const root = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(root.querySelector('[data-action="panel-refresh"]').textContent, '立即刷新', 'mounted with the zh dictionary')
  // The DSH locale feature mirrors its resolved preference onto <html lang>;
  // the langObserver must pick the flip up and re-render with the new copy.
  window.document.documentElement.lang = 'en-US'
  await turn()
  assert.equal(root.querySelector('[data-action="panel-refresh"]').textContent, 'Refresh now', 'the en dictionary applies without a reload')
  dispose()
  window.close()
})

test('0.1.14 regression guards: footer buttons match the muted extra style', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const floatStyle = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('style').textContent
  assert.match(floatStyle, /\.dqw-panel-actions \{ display: grid; grid-template-columns: 1fr 1fr;/, 'footer buttons stay equal-width regardless of label length')
  assert.match(floatStyle, /\.dqw-panel-action \{[^}]*font-size: 10px; line-height: 14px; opacity: \.72/, 'button text rests at the same size and opacity as .dqw-extra')
  assert.match(floatStyle, /\.dqw-panel-action:hover \{[^}]*opacity: 1/, 'hover restores full strength')
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
  assert.match(cells[4].textContent, /^\( Resets: .+ \)$/)
  assert.match(cells[4].textContent, /2026\/11\/01/)
  assert.equal(cells[5].textContent, '5-hour quota')
  assert.match(cells[8].textContent, /13%/)
  assert.equal(cells[10].textContent, 'Weekly quota')
  assert.equal(cells[11].textContent, '·')
  assert.match(cells[12].textContent, /♾️/, 'unlimited mark aligns with the used column')
  assert.equal(cells[14].textContent, '( unlimited )')
  // Alignment invariant: every note in the grid starts with the SAME paren
  // glyph and no leading whitespace, so the 1fr note column's left edges line
  // up across rows (0.1.15 mixed （ Resets with ' ( unlimited )' in en).
  for (const index of [4, 9, 14]) {
    assert.match(cells[index].textContent, /^\(/, `en note ${index} starts with the ASCII paren`)
    assert.doesNotMatch(cells[index].textContent, /^\s/, `en note ${index} carries no leading whitespace`)
  }
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

// --- Task 8: one degradation decision for today's usage ----------------------

async function openGlmDetail(window) {
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  container.shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  return window.document
    .querySelector('[data-dsh-quota-watch-float]')
    .shadowRoot
    .querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
}

test('GLM detail keeps the fixed normal order: today numbers, windows, per-model rows', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider()]))
  const detail = await openGlmDetail(window)
  const order = [...detail.children]
    .map((el) => el.className)
    .filter((name) => name !== '' && name !== 'dqw-panel-header')
  assert.deepEqual(order, ['dqw-bignums', 'dqw-wins', 'dqw-models'])
  dispose()
  window.close()
})

test('a short stale episode keeps the last-good today values everywhere', async () => {
  const window = dom()
  const provider = glmProvider()
  provider.usage = { ...provider.usage, status: 'stale', error: 'HTTP 500', errorKind: 'server' }
  const { dispose } = await mounted(window, snapshot([provider]))
  const detail = await openGlmDetail(window)
  assert.match(detail.textContent, /8\.3M/)
  assert.match(detail.textContent, /152/)
  assert.ok(detail.querySelector('.dqw-model-row'), 'per-model rows survive a short stale episode')
  assert.doesNotMatch(detail.textContent, /Per-model data unavailable today/)
  const row = window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
  assert.match(row.textContent, /8\.3M/, 'the summary appendix follows the same rule')
  dispose()
  window.close()
})

test('staleTooLong and first errors degrade both big numbers and the model rows together', async () => {
  for (const usage of [
    { ...glmProvider().usage, status: 'stale', staleTooLong: true, error: 'HTTP 500', errorKind: 'server' },
    { status: 'error', error: 'HTTP 500', errorKind: 'server' },
  ]) {
    const window = dom()
    const provider = glmProvider()
    provider.usage = usage
    const { dispose } = await mounted(window, snapshot([provider]))
    const detail = await openGlmDetail(window)
    const bigs = [...detail.querySelectorAll('.dqw-big-value')].map((el) => el.textContent)
    assert.deepEqual(bigs, ['—', '—'], String(usage.status))
    assert.equal(detail.querySelector('.dqw-model-row'), null, String(usage.status))
    assert.match(detail.textContent, /Per-model data unavailable today/, String(usage.status))
    const row = window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="glm"]')
    assert.doesNotMatch(row.textContent, /8\.3M/, `summary appendix degrades too: ${usage.status}`)
    dispose()
    window.close()
  }
})

test('the degraded model note speaks Chinese under a zh locale', async () => {
  const window = dom({ locale: 'zh-CN' })
  const provider = glmProvider()
  provider.usage = { status: 'error', error: 'HTTP 500', errorKind: 'server' }
  const { dispose } = await mounted(window, snapshot([provider]))
  const detail = await openGlmDetail(window)
  assert.match(detail.textContent, /今日分模型数据暂不可用/)
  dispose()
  window.close()
})

test('a ready usage snapshot restores the real values after a degraded episode', async () => {
  const window = dom()
  const provider = glmProvider()
  provider.usage = { ...provider.usage, status: 'stale', staleTooLong: true, error: 'HTTP 500', errorKind: 'server' }
  const { dispose } = await mounted(window, snapshot([provider]))
  let detail = await openGlmDetail(window)
  assert.deepEqual([...detail.querySelectorAll('.dqw-big-value')].map((el) => el.textContent), ['—', '—'])
  dispose()
  window.close()

  const recovered = dom()
  const { dispose: dispose2 } = await mounted(recovered, snapshot([glmProvider()]))
  detail = await openGlmDetail(recovered)
  assert.match(detail.textContent, /8\.3M/)
  assert.match(detail.textContent, /152/)
  assert.ok(detail.querySelector('.dqw-model-row'))
  dispose2()
  recovered.close()
})

// --- Task 9: the browser auto-use entry is gone ------------------------------

test('a legacy snapshot carrying autoReset renders no auto-use UI and calls no auto endpoint', async () => {
  const window = dom({ locale: 'zh-CN' })
  const provider = glmProvider({ providerId: 'zai-coding-cn' })
  const payload = snapshot([provider, copilotProvider()])
  payload.autoReset = {
    fiveHour: { enabled: true, threshold: 90, armed: true },
    week: { enabled: true, threshold: 90, armed: true },
    source: 'saved',
    lastEvent: { kind: 'auto', resetType: 'WEEK', window: 'week', recordId: 9001, at: 1 },
  }
  const { dispose, requests } = await mounted(window, payload)
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.doesNotMatch(container.shadowRoot.textContent, /自动用卡/)

  const detail = await openGlmDetail(window)
  assert.doesNotMatch(detail.textContent, /自动用卡/)
  assert.equal(detail.querySelector('.dqw-auto'), null)
  assert.equal(detail.querySelector('.dqw-auto-master'), null)
  assert.equal(detail.querySelector('.dqw-reset-notice'), null, 'retired auto events never render')
  assert.equal(detail.querySelectorAll('input[type="checkbox"]').length, 0, 'no authorization switches anywhere')
  assert.equal(requests.some((request) => String(request.path).includes('auto-reset')), false,
    'the retired endpoint is never called from the client')
  dispose()
  window.close()
})

// --- Task 10: one snapshot drives the domestic card section ------------------

function resetSnapshot(wallet) {
  return { ...snapshot([glmProvider({ providerId: 'zai-coding-cn' }), copilotProvider()]), reset: wallet }
}

function floatPanel(window) {
  return window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
}

// The panel-detail attribute sits on the panel element itself (syncPop).
function glmDetailText(window) {
  return window.document
    .querySelector('[data-dsh-quota-watch-float]')
    .shadowRoot
    .querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
    ?.textContent ?? ''
}

async function openPanelGlm(window) {
  let panel = floatPanel(window)
  // The capsule is a toggle: only click it when the panel is actually hidden.
  if (panel.hidden) {
    floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    panel = floatPanel(window)
  }
  // Already on the GLM detail (e.g. right after Esc cleared a confirm): done.
  if (panel.dataset.dshQuotaWatchPanelDetail === 'glm') return panel
  panel.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  await turn()
  return floatPanel(window)
}

// glmDetailText is the hoisted function declared beside the Task 10 helpers.



test('the first detail open without a wallet snapshot forces one refresh and never lists separately', async () => {
  const window = dom({ locale: 'zh-CN' })
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    requests.push({ path: String(path), method: init?.method ?? 'GET' })
    return response(snapshot([glmProvider({ providerId: 'zai-coding-cn' })]))
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  try {
    await turn()
    await openPanelGlm(window)
    await turn(); await turn()
    assert.match(glmDetailText(window), /查询中/)
    assert.equal(requests.filter((row) => row.path.endsWith('/refresh')).length, 1, 'at most one forced refresh')
    assert.equal(requests.some((row) => row.path.endsWith('/reset-cards')), false, 'no separate card-list GET')
  } finally { dispose(); window.close() }
})

test('a force result survives an ordinary GET that started later and returned earlier', async () => {
  const window = dom({ locale: 'zh-CN' })
  let releaseForce
  const forceGate = new Promise((resolve) => { releaseForce = resolve })
  let forceResolved = false
  const staleWallet = { status: 'ready', cards: { fiveHour: [{ recordId: 1, expireTime: '2026-11-01 09:00:00' }], week: [] } }
  const freshWallet = { status: 'ready', cards: { fiveHour: [{ recordId: 9, expireTime: '2026-12-01 09:00:00' }], week: [] } }
  const payloadFor = () => resetSnapshot(forceResolved ? freshWallet : staleWallet)
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    const target = String(path)
    requests.push({ path: target, method: init?.method ?? 'GET' })
    if (target.endsWith('/refresh')) {
      await forceGate
      forceResolved = true
      return response(payloadFor())
    }
    return response(payloadFor())
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 5 })
  try {
    await turn(); await turn()
    const panel = await openPanelGlm(window)
    assert.match(glmDetailText(window), /11\/01/, 'the stale wallet renders first')

    const getsBefore = requests.filter((row) => row.method === 'GET').length
    panel.querySelector('[data-action="panel-refresh"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    for (let hop = 0; hop < 10; hop += 1) await turn()
    const getsDuring = requests.filter((row) => row.method === 'GET').length - getsBefore
    assert.ok(getsDuring >= 1, 'ordinary GETs keep polling while the force is in flight')

    releaseForce()
    for (let hop = 0; hop < 6; hop += 1) await turn()
    assert.match(glmDetailText(window), /12\/01/,
      'the force payload is applied even though a later-started GET returned first')
    const resetText = floatPanel(window).querySelector('.dqw-reset').textContent
    assert.doesNotMatch(resetText, /11\/01/, 'the stale card is gone from the card section')
  } finally { dispose(); window.close() }
})

test('a GET that started during a force cannot roll back the applied force result', async () => {
  const window = dom({ locale: 'zh-CN' })
  let releaseForce
  const forceGate = new Promise((resolve) => { releaseForce = resolve })
  let releaseGet
  const getGate = new Promise((resolve) => { releaseGet = resolve })
  let deferGets = false
  let forceResolved = false
  const staleWallet = { status: 'ready', cards: { fiveHour: [{ recordId: 1, expireTime: '2026-11-01 09:00:00' }], week: [] } }
  const freshWallet = { status: 'ready', cards: { fiveHour: [{ recordId: 9, expireTime: '2026-12-01 09:00:00' }], week: [] } }
  const payloadFor = () => resetSnapshot(forceResolved ? freshWallet : staleWallet)
  const fetchImpl = async (path, init = {}) => {
    const target = String(path)
    if (target.endsWith('/refresh')) {
      await forceGate
      forceResolved = true
      return response(payloadFor())
    }
    // The GET's data is fixed at request time: a parked GET stays stale even
    // though the world moved on while it waited.
    const planned = response(payloadFor())
    if (deferGets) await getGate
    return planned
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 5 })
  try {
    await turn(); await turn()
    const panel = await openPanelGlm(window)
    assert.match(glmDetailText(window), /11\/01/)

    deferGets = true
    panel.querySelector('[data-action="panel-refresh"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    for (let hop = 0; hop < 10; hop += 1) await turn()
    releaseForce()
    for (let hop = 0; hop < 6; hop += 1) await turn()
    assert.match(glmDetailText(window), /12\/01/, 'the force result applied')

    releaseGet()
    for (let hop = 0; hop < 8; hop += 1) await turn()
    assert.match(glmDetailText(window), /12\/01/, 'the parked stale GET must not roll the force back')
    const resetTextAfter = floatPanel(window).querySelector('.dqw-reset').textContent
    assert.doesNotMatch(resetTextAfter, /11\/01/, 'the stale card never comes back')
  } finally { dispose(); window.close() }
})



// --- Task 11: card rows wrap on narrow screens --------------------------------

test('reset rows wrap on narrow widths and keep the spend button focusable', async () => {
  const window = dom({ locale: 'zh-CN' })
  const wallet = { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } }
  const { dispose } = await mounted(window, resetSnapshot(wallet))
  await openPanelGlm(window)

  const styleText = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('style').textContent
  // The wide five-column alignment grid stays for floating panels...
  assert.match(styleText, /\.dqw-reset-lines \{ display: grid;/)
  // ...and a narrow-width block lets rows wrap instead of truncating.
  const mediaIndex = styleText.indexOf('@media (max-width: 480px)')
  assert.ok(mediaIndex >= 0, 'a narrow-width media block exists')
  const rowWrapIndex = styleText.indexOf('.dqw-reset-row { display: flex; flex-wrap: wrap;', mediaIndex)
  assert.ok(rowWrapIndex > mediaIndex, 'card rows wrap inside the narrow-width block')
  const expiryIndex = styleText.indexOf('white-space: normal', rowWrapIndex)
  assert.ok(expiryIndex > rowWrapIndex, 'expiry text grows to a second line instead of truncating')

  // Structure: the spend control is a real, enabled <button> — focusable by
  // construction; jsdom pixel geometry is not trusted here.
  const button = floatPanel(window).querySelector('.dqw-reset-use')
  assert.equal(button.type, 'button')
  assert.equal(button.textContent, '重置')
  assert.equal(button.disabled, false)
  dispose()
  window.close()
})

// --- Task 12: one expiry parser drives picking and display --------------------



// --- Task 13: confirm/cancel semantics ----------------------------------------

async function openConfirmBox(window) {
  await openPanelGlm(window)
  floatPanel(window).querySelector('.dqw-reset-use').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  return floatPanel(window).querySelector('.dqw-reset-confirm')
}



test('Esc and closing clear only an uncommitted confirmation; re-entry is clean and sends nothing', async () => {
  const window = dom({ locale: 'zh-CN' })
  const wallet = { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } }
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    requests.push({ path: String(path), method: init?.method ?? 'GET' })
    return response(resetSnapshot(wallet))
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  try {
    await turn()
    let confirmBox = await openConfirmBox(window)
    assert.ok(confirmBox, 'the inline confirm appears')

    window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await turn()
    assert.equal(floatPanel(window).querySelector('.dqw-reset-confirm'), null, 'Esc clears the uncommitted confirm')
    const detailAfterEsc = window.document
      .querySelector('[data-dsh-quota-watch-float]')
      .shadowRoot
      .querySelector('[data-dsh-quota-watch-panel-detail="glm"]')
    assert.ok(detailAfterEsc, 'the detail stays open')

    confirmBox = await openConfirmBox(window)
    assert.ok(confirmBox, 're-entering shows a fresh confirm, never the old one')

    floatPanel(window).querySelector('[data-action="panel-close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    assert.equal(floatPanel(window).querySelector('.dqw-reset-confirm'), null, 'closing clears it too')
    await openPanelGlm(window)
    assert.equal(floatPanel(window).querySelector('.dqw-reset-confirm'), null, 'nothing resurrects the old confirm')
    assert.equal(requests.filter((row) => row.method === 'POST').length, 0, 'cancelling never sends a POST')
  } finally { dispose(); window.close() }
})

test('double-confirming fires exactly one spend POST and the result still lands', async () => {
  const window = dom({ locale: 'zh-CN' })
  const wallet = { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } }
  let releaseUse
  const useGate = new Promise((resolve) => { releaseUse = resolve })
  let useCalls = 0
  const fetchImpl = async (path, init = {}) => {
    const target = String(path)
    if (target.endsWith('/reset-cards/use')) {
      useCalls += 1
      await useGate
      return response({ ok: true, message: '操作成功', attemptId: 'synthetic-attempt' })
    }
    return response(resetSnapshot(wallet))
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  try {
    await turn()
    await openConfirmBox(window)
    const confirmButton = floatPanel(window).querySelector('.dqw-reset-btn.is-primary')
    assert.ok(confirmButton)
    // Two synchronous clicks: only the first may reach the host.
    confirmButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    confirmButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    for (let hop = 0; hop < 3; hop += 1) await turn()
    assert.equal(useCalls, 1, 'the in-flight POST cannot be double-fired')
    releaseUse()
    for (let hop = 0; hop < 4; hop += 1) await turn()
    assert.equal(useCalls, 1, 'still exactly one spend after the answer arrives')
    assert.match(glmDetailText(window), /已重置/)
  } finally { dispose(); window.close() }
})

// --- Task 14: outcome presentation and delivery confirmation ------------------

function outcomeHarness(t, { providers = 'domestic', use = { ok: true, attemptId: 'att-x' }, receipt = 'ok', acknowledge = 'ok', overviewExtra, pollIntervalMs = 60_000, outcomeNoticeMs = 5_000 } = {}) {
  const window = dom({ locale: 'zh-CN' })
  const state = { providers, spent: false, cleared: false, recovered: false, receiptCalls: [], ackCalls: [], useCalls: 0 }
  const providerList = () => {
    if (state.providers === 'domestic') return [glmProvider({ providerId: 'zai-coding-cn' }), copilotProvider()]
    return [
      { key: 'glm', displayName: 'GLM Coding Plan', status: 'missing', credential: 'none' },
      { key: 'copilot', displayName: 'GitHub Copilot', status: 'missing', credential: 'none' },
    ]
  }
  const payloadFor = () => {
    const wallet = state.spent
      ? { status: 'ready', cards: { fiveHour: [], week: [] } }
      : { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } }
    const extra = typeof overviewExtra === 'function' ? overviewExtra(state) : (overviewExtra ?? {})
    return { ...snapshot(providerList()), reset: wallet, ...extra }
  }
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    const target = String(path)
    requests.push({ path: target, method: init?.method ?? 'GET', body: init?.body })
    if (target.endsWith('/reset-cards/use')) {
      state.useCalls += 1
      if (use === 'transport-lost') throw new Error('connection lost')
      return response(use)
    }
    if (target.endsWith('/reset-cards/receipt')) {
      state.receiptCalls.push(String(init?.body ?? ''))
      if (typeof receipt === 'function') return receipt(state) === 'ok' ? response({ ok: true }) : response({ ok: false }, 503)
      return receipt === 'fail' ? response({ ok: false }, 503) : response({ ok: true })
    }
    if (target.endsWith('/reset-cards/acknowledge')) {
      state.ackCalls.push(String(init?.body ?? ''))
      const verdict = typeof acknowledge === 'function' ? acknowledge(state) : acknowledge
      return verdict === 'ok' ? response({ ok: true }) : response({ ok: false, error: 'verify-failed', message: '核实失败' }, 502)
    }
    return response(payloadFor())
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs, outcomeNoticeMs })
  t.after(() => { dispose(); window.close() })
  return { window, state, requests }
}

async function confirmSpend(window) {
  await openConfirmBox(window)
  floatPanel(window).querySelector('.dqw-reset-btn.is-primary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  for (let hop = 0; hop < 5; hop += 1) await turn()
}

const outcomeBlock = (window) => floatPanel(window).querySelector('[data-dsh-quota-watch-outcome]')
const capsuleSurface = (window) => window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-capsule]')







test('an unknown outcome warns bilingually, keeps the capsule alive with zero credentials, and clears only after a verified recheck', async (t) => {
  const h = outcomeHarness(t, {
    providers: 'missing',
    acknowledge: (state) => (state.recovered ? 'ok' : 'fail'),
    overviewExtra: (state) => (state.cleared ? {} : { manualOutcome: { attemptId: 'att-4', resetType: 'FIVE_HOUR', startedAt: 1, status: 'unknown' } }),
    pollIntervalMs: 5,
  })
  await turn()
  // All providers missing, yet the capsule stays alive as the focusable warning entry.
  const surface = capsuleSurface(h.window)
  assert.equal(surface.hidden, false)
  assert.equal(surface.tabIndex, 0)
  assert.match(surface.getAttribute('aria-label') ?? '', /未确认/)
  assert.equal(surface.getAttribute('data-outcome'), 'true')

  // The overview reads: warning + verify button (no provider row is expandable).
  capsuleSurface(h.window).dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  await turn()
  const block = outcomeBlock(h.window)
  assert.ok(block, 'the overview shows the pending outcome block')
  assert.match(block.textContent, /可能已消耗/)
  assert.match(block.textContent, /我已核实/)

  // A failed recheck keeps the lock.
  block.querySelector('button').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  for (let hop = 0; hop < 6; hop += 1) await turn()
  assert.equal(h.state.ackCalls.length, 1)
  assert.match(h.requests.filter((row) => row.path.endsWith('/acknowledge'))[0].body ?? '', /att-4/)
  assert.ok(outcomeBlock(h.window), 'a failed recheck never unlocks')

  // Domestic credentials recover and the fresh recheck succeeds.
  h.state.providers = 'domestic'
  h.state.recovered = true
  h.state.cleared = true // with the ack succeeding, the host record is gone
  outcomeBlock(h.window).querySelector('button').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  for (let hop = 0; hop < 8; hop += 1) await turn()
  assert.equal(h.state.ackCalls.length, 2)
  assert.equal(outcomeBlock(h.window), null, 'the verified unknown clears')

  // Cleared AND everything missing again → the capsule may hide again.
  h.state.providers = 'missing'
  floatPanel(h.window).querySelector('[data-dsh-quota-watch-panel-header] [data-action="panel-refresh"]')
    ?? capsuleSurface(h.window)
  capsuleSurface(h.window).dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  await turn()
  capsuleSurface(h.window).dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(capsuleSurface(h.window).hidden, true, 'with nothing pending and nothing to show, the capsule hides again')
})





// --- Task 15: one shared 立即刷新 busy state ----------------------------------

test('立即刷新 shares one busy state: single flight, disabled button, no extra toast', async () => {
  const window = dom({ locale: 'zh-CN' })
  let releaseForce
  const gate = new Promise((resolve) => { releaseForce = resolve })
  let posts = 0
  let failNext = false
  const payload = resetSnapshot({ status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } })
  const fetchImpl = async (path, init = {}) => {
    const target = String(path)
    if (target.endsWith('/refresh')) {
      posts += 1
      if (failNext) throw new Error('connection lost')
      await gate
      return response(payload)
    }
    return response(payload)
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  try {
    await turn()
    await openPanelGlm(window)
    const refreshBtn = () => floatPanel(window).querySelector('[data-action="panel-refresh"]')
    assert.equal(refreshBtn().textContent, '立即刷新')

    refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    assert.equal(posts, 1)
    assert.equal(refreshBtn().disabled, true, 'the button disables while the force is in flight')
    assert.match(refreshBtn().textContent, /刷新中/)

    // A repeat click and the label-refresh affordance both stay inert while busy.
    refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    assert.equal(posts, 1, 'a busy refresh ignores repeat clicks')

    releaseForce()
    for (let hop = 0; hop < 5; hop += 1) await turn()
    assert.equal(refreshBtn().disabled, false)
    assert.equal(refreshBtn().textContent, '立即刷新', 'the label recovers after success')

    // A transport failure recovers the label too, and no toast appears.
    failNext = true
    refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    for (let hop = 0; hop < 4; hop += 1) await turn()
    assert.equal(posts, 2)
    assert.equal(refreshBtn().disabled, false)
    assert.equal(refreshBtn().textContent, '立即刷新')
    assert.equal(floatPanel(window).querySelector('.dqw-toast'), null, 'no extra toast is added')
  } finally { dispose(); window.close() }
})

// --- Review R1: success-notice pacing and capsule label wording ---------------



test('the capsule warning label matches the pending outcome kind', async (t) => {
  const h = outcomeHarness(t, {
    providers: 'missing',
    overviewExtra: { manualOutcome: { attemptId: 'att-7', resetType: 'WEEK', startedAt: 1, status: 'known-success' } },
  })
  await turn()
  const label = capsuleSurface(h.window).getAttribute('aria-label') ?? ''
  assert.match(label, /已确认成功/, 'a known receipt says so, not "unconfirmed"')
  assert.doesNotMatch(label, /未确认/)
})

// --- Review round-2 R1-2: the manual flow locks client-side too ----------------

test('an unreadable journal or pending outcome locks the spend buttons client-side', async (t) => {
  for (const extra of [
    { manualOutcomeError: 'storage-unavailable' },
    { manualOutcome: { attemptId: 'att-lock', resetType: 'WEEK', startedAt: 1, status: 'unknown' } },
  ]) {
    const window = dom({ locale: 'zh-CN' })
    const payload = {
      ...snapshot([glmProvider({ providerId: 'zai-coding-cn' }), copilotProvider()]),
      reset: { status: 'ready', cards: { fiveHour: [{ recordId: 7, expireTime: '2026-11-01 09:00:00' }], week: [] } },
      ...extra,
    }
    const requests = []
    const fetchImpl = async (path, init = {}) => {
      requests.push({ path: String(path), method: init?.method ?? 'GET' })
      return response(payload)
    }
    const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
    try {
      await turn()
      await openPanelGlm(window)
      const use = floatPanel(window).querySelector('.dqw-reset-use')
      assert.ok(use, String(JSON.stringify(extra)))
      assert.equal(use.disabled, true, `the spend button is locked: ${JSON.stringify(extra)}`)
      // Even a synthetic dispatch on the disabled control must not start a spend.
      use.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      await turn()
      await turn()
      // The unknown-outcome block legitimately reuses .dqw-reset-confirm as a
      // container; the confirm DIALOG is identified by its primary action.
      assert.equal(floatPanel(window).querySelector('.dqw-reset-confirm .dqw-reset-btn.is-primary'), null, 'no confirm dialog appears')
      assert.equal(floatPanel(window).querySelector('.dqw-reset-use').textContent, '重置', 'the use button never flipped to cancel')
      assert.equal(requests.some((row) => row.path.endsWith('/reset-cards/use')), false, 'zero spend POST')
    } finally { dispose(); window.close() }
  }
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
  for (const index of [4, 9, 14]) {
    assert.match(cells[index].textContent, /^（/, `zh note ${index} starts with the full-width paren`)
  }
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

test('auth-class failures lead with the re-authorize copy across banner and row tooltips', async () => {
  const window = dom()
  const copilotAuth = copilotProvider({ status: 'stale', error: 'HTTP 401', errorKind: 'auth' })
  const glmAuth = glmProvider({ status: 'stale', error: 'HTTP 403', errorKind: 'auth' })
  glmAuth.usage = { ...glmAuth.usage, status: 'stale' }
  const { dispose } = await mounted(window, snapshot([glmAuth, copilotAuth]))
  const card = window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot
  assert.equal(
    card.querySelector('[data-dsh-quota-watch-row="copilot"]').querySelector('[data-dsh-quota-watch-stale]').title,
    'Credential rejected by provider — re-authorize: HTTP 401',
  )
  assert.equal(
    card.querySelector('[data-dsh-quota-watch-row="glm"]').querySelector('[data-dsh-quota-watch-stale]').title,
    'Credential rejected by provider — re-authorize: HTTP 403',
  )
  card.querySelector('[data-dsh-quota-watch-row="copilot"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="copilot"]')
  assert.match(detail.querySelector('.dqw-error').textContent, /Credential rejected by provider — re-authorize: HTTP 401/)
  dispose()
  window.close()
})

test('non-auth failures keep the stale copy in banner and tooltip', async () => {
  const window = dom()
  const copilotServer = copilotProvider({ status: 'stale', error: 'HTTP 503' })
  const { dispose } = await mounted(window, snapshot([copilotServer]))
  const row = window.document.querySelector('[data-dsh-quota-watch-card]').shadowRoot.querySelector('[data-dsh-quota-watch-row="copilot"]')
  assert.equal(row.querySelector('[data-dsh-quota-watch-stale]').title, 'HTTP 503')
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  const detail = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel-detail="copilot"]')
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

test('0.1.2 regression guards: hidden-attr display rules and 240px panel sizing', async () => {
  const window = dom()
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const floatStyle = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('style').textContent
  const cardStyle = container.shadowRoot.querySelector('style').textContent
  assert.match(floatStyle, /\.dqw-capsule\[hidden\]\s*{\s*display: none/, 'a hidden capsule must actually disappear (author display beats the UA [hidden] rule)')
  assert.match(cardStyle, /@media print\s*{\s*:host { display: none !important; }/, 'card hides in print')
  assert.match(floatStyle, /\.dqw-panel\[data-dsh-quota-watch-panel-overview\]:not\(\.dqw-panel--sheet\) { width: min\(240px, calc\(100vw - 24px\)\)/, 'overview pin matches the sidebar card (240px); :not keeps the bottom sheet full-width')
  assert.match(floatStyle, /\.dqw-panel { position: fixed; z-index: 2147483000; min-width: 166px; max-width: min\(320px, calc\(100vw - 24px\)\)/, 'detail views keep the 0.0.18 content-driven width (capped at 320px)')
  assert.match(floatStyle, /\.dqw-bar { display: block; flex: 1 1 auto; width: auto; min-width: 36px;/, 'panel bars flex like the sidebar card so the 240px overview fits rows')
  assert.match(cardStyle, /\.dqw-bar { display: block; flex: 1;/, 'card rows keep the adaptive flex bar')
  assert.match(cardStyle, /@media print\s*{\s*:host { display: none !important; }/, 'card hides in print')
  dispose()
  window.close()
})

test('a cold mount hides the capsule until data arrives (no empty-capsule flash)', async () => {
  const window = dom()
  const fetchImpl = async () => {
    throw new Error('host routes not ready')
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000, retryNoDataMs: 4 })
  try {
    const host = window.document.querySelector('[data-dsh-quota-watch-float]')
    assert.equal(host.hidden, true, 'a cold shell starts hidden')
    await turn()
    assert.equal(host.hidden, true, 'a transport error on a cold client keeps the capsule hidden')
  } finally {
    dispose()
    window.close()
  }
})

test('no-data backoff re-polls fast, then returns to the long cadence once data lands', async () => {
  const window = dom()
  let calls = 0
  const loading = snapshot([])
  const warm = snapshot([glmProvider(), copilotProvider()])
  const fetchImpl = async (path, init = {}) => {
    calls += 1
    return response(calls <= 2 ? loading : warm)
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 400, retryNoDataMs: 4 })
  try {
    // A fixed 30ms wall-clock sleep flakes under concurrent jsdom suites; wait
    // for the third poll within a bound still shorter than the 400ms warm cadence.
    const deadline = Date.now() + 250
    while (calls < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const fastCount = calls
    assert.ok(fastCount >= 3, `initial poll plus backoff retries beat the 400ms warm cadence (got ${fastCount})`)
    await new Promise((resolve) => setTimeout(resolve, 40))
    const afterData = calls
    assert.ok(afterData >= fastCount, 'the poll that carries data has run')
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(calls, afterData, 'a warm client stays on the long cadence (no fast retries)')
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.ok(calls > afterData, 'the long cadence fires after its full interval')
  } finally {
    dispose()
    window.close()
  }
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

test('shrinking the viewport re-clamps the capsule without clobbering the stored position', async () => {
  const window = dom()
  window.localStorage.setItem(FLOAT_POSITION_KEY, '{"x":900,"y":100}')
  const { dispose } = await mounted(window, snapshot([glmProvider(), copilotProvider()]))
  const host = window.document.querySelector('[data-dsh-quota-watch-float]')
  assert.equal(host.style.left, '900px')
  assert.equal(host.style.top, '100px')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
  window.dispatchEvent(new window.Event('resize'))
  await turn()
  // x & y clamped visually to fit small viewport.
  assert.ok(parseFloat(host.style.left) <= 400 - 8 - 38, `left clamped into the small viewport: ${host.style.left}`)
  assert.ok(parseFloat(host.style.top) <= 300 - 8 - 26, `top clamped into the small viewport: ${host.style.top}`)
  assert.deepEqual(JSON.parse(window.localStorage.getItem(FLOAT_POSITION_KEY)), { x: 900, y: 100 }, 'storage keeps the preferred coordinates')
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

test('domestic reset section stays two card lines with Beijing expiry and no auto-use controls', async () => {
  const window = dom({ locale: 'zh-CN' })
  const data = {
    ...snapshot([glmProvider({ providerId: 'zai-coding-cn' }), copilotProvider()]),
    reset: { status: 'ready', cards: { fiveHour: [], week: [
      { recordId: 2, expireTime: '2026-11-01 09:00:00' },
      { recordId: 1, expireTime: '2026-01-02 00:30:00' },
    ] } },
  }
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    requests.push({ path, method: init.method ?? 'GET' })
    return response(data)
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  await turn()
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  panel.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  await turn()
  assert.equal(panel.querySelector('.dqw-reset-head .dqw-reset-title').textContent, '额度重置卡')
  assert.equal(panel.querySelector('.dqw-reset-reload'), null, '立即刷新 replaces the local button')
  const floatStyle = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('style').textContent
  assert.match(floatStyle, /\.dqw-reset \{ border-top: 1px dashed/, 'expanded reset block retains its divider')
  assert.doesNotMatch(floatStyle, /\.dqw-auto/, 'the retired auto-use styles are gone')
  // Only the non-zero card type renders a row: an empty type collapses away.
  const cardRows = [...panel.querySelectorAll('.dqw-reset-row')]
  assert.equal(cardRows.length, 1, 'only the type holding cards renders a row')
  assert.equal(cardRows[0].querySelector('.dqw-reset-kind').textContent, '每周重置卡')
  assert.deepEqual(cardRows.map((row) => row.querySelector('.dqw-reset-mid').textContent), ['·'])
  assert.equal(cardRows[0].querySelector('.dqw-reset-expiry').textContent, '01/02 前有效')
  assert.ok(panel.querySelector('.dqw-reset-lines'), 'both rows share one alignment grid')
  assert.equal(panel.querySelectorAll('.dqw-reset-use').length, 1, 'empty type has no button')
  assert.equal(panel.querySelectorAll('.dqw-auto-row').length, 0, 'legacy autoReset state renders nothing')
  assert.equal(panel.querySelector('.dqw-auto-master'), null)
  assert.equal(panel.querySelectorAll('input[type="checkbox"]').length, 0, 'no authorization switches anywhere')
  assert.doesNotMatch(panel.textContent, /自动用卡/)
  assert.equal(requests.filter((call) => call.method === 'POST').length, 0, 'rendering never writes any endpoint')
  dispose()
  window.close()
})

test('international GLM detail omits domestic reset section and never lists cards', async () => {
  const window = dom({ locale: 'zh-CN' })
  const requests = []
  const fetchImpl = async (path) => { requests.push(String(path)); return response(snapshot([glmProvider({ providerId: 'zai' }), copilotProvider()])) }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  await turn()
  const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
  floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  panel.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(panel.querySelector('.dqw-reset'), null)
  assert.equal(requests.some((path) => path.endsWith('/reset-cards')), false)
  dispose()
  window.close()
})

test('empty wallet collapses behind its divider and force-refresh reveals cards', async () => {
  const window = dom({ locale: 'zh-CN' })
  let wallet = { status: 'ready', cards: { fiveHour: [], week: [] } }
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    requests.push({ path: String(path), method: init.method ?? 'GET' })
    if (String(path).endsWith('/reset-cards')) return response({ ok: true, cards: wallet.cards })
    return response({ ...snapshot([glmProvider({ providerId: 'zai-coding-cn' })]), reset: wallet })
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  try {
    await turn()
    const panel = window.document.querySelector('[data-dsh-quota-watch-float]').shadowRoot.querySelector('[data-dsh-quota-watch-panel]')
    floatSurface(window).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    panel.querySelector('[data-dsh-quota-watch-row="glm"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await turn()
    await turn()
    assert.equal(panel.querySelector('.dqw-reset-collapsed .dqw-reset-title').textContent, '额度重置卡 · 无可用')
    assert.equal(panel.querySelector('.dqw-reset-lines'), null)
    assert.ok(panel.querySelector('.dqw-reset'), 'collapsed block keeps the dashed divider')
    assert.equal(requests.some(({ path }) => path.endsWith('/reset-cards')), false, 'empty host summary avoids a duplicate lazy list')
    assert.equal(panel.querySelector('.dqw-auto-master'), null, 'no auto controls remain on the empty state')

    wallet = { status: 'ready', cards: { fiveHour: [{ recordId: 8, expireTime: '2026-11-01 09:00:00' }], week: [] } }
    panel.querySelector('[data-action="panel-refresh"]').click()
    await turn()
    await turn()
    assert.equal(requests.filter(({ method }) => method === 'POST').length, 1, 'one 立即刷新 request updates quotas and cards')
    assert.equal(panel.querySelector('.dqw-reset-collapsed'), null)
    assert.equal(panel.querySelectorAll('.dqw-reset-row').length, 1, 'only the non-zero type renders a row')
    assert.equal(panel.querySelectorAll('.dqw-reset-use').length, 1)

    wallet = { status: 'error', error: 'HTTP 503' }
    panel.querySelector('[data-action="panel-refresh"]').click()
    await turn()
    await turn()
    assert.match(panel.textContent, /查询失败/, 'a failed refresh shows the error state')
    assert.equal(panel.querySelector('.dqw-reset-row'), null, 'an error never shows the stale spendable rows')
    assert.equal(panel.querySelectorAll('.dqw-reset-use').length, 0, 'and no stale buttons')
  } finally { dispose(); window.close() }
})



test('shell takeover yields the sidebar card (negative-priority workspaces occupant, 2026-10-13 ds-bot)', async () => {
  const window = dom()
  // The sidebar card is opt-in (surface flag defaults to hidden; the capsule
  // is the default surface) — turn it on like a real user would.
  window.localStorage.setItem(SURFACE_FLAGS_KEY, JSON.stringify({ cardHidden: false }))
  // ds-bot takes sidebar.workspaces at -10 for its native bot sidebar; the
  // official tree (ui-workspace) sits at default priority 0. A NEGATIVE
  // occupant means the foot is a takeover shell's native surface and the
  // injected card yields it entirely (same contract as skins/dsh-m rows).
  let occupants = [{ options: { name: 'sidebar.workspaces', priority: -10 } }]
  const listeners = new Set()
  const slots = {
    entries: (key) => (key === 'sidebar.workspaces' ? occupants : []),
    subscribe: (key, fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const fetchImpl = async () => response(snapshot([glmProvider(), copilotProvider()]))
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000, slots })
  await turn()
  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.ok(container)
  assert.equal(container.hidden, true, 'takeover shell live → the injected card yields the whole foot')
  assert.equal(container.shadowRoot.querySelector('.dqw-card').style.display, 'none')

  // Official-only ledger (ds-bot unloaded): the sentinel flips and the card returns.
  occupants = [{ options: { name: 'sidebar.workspaces', priority: 0 } }]
  for (const notify of [...listeners]) notify()
  assert.equal(container.hidden, false, 'official 0-priority tree → the card stays')

  // A racing latecomer occupying the seat again hides it without any reload —
  // order-symmetric: ds-bot may boot before or after quota-watch.
  occupants = [
    { options: { name: 'sidebar.workspaces', priority: 0 } },
    { options: { name: 'sidebar.workspaces', priority: -10 } },
  ]
  for (const notify of [...listeners]) notify()
  assert.equal(container.hidden, true, 'takeover flip is live in both directions')
  dispose()
  window.close()
})
