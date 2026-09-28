import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountQuotaCard } from '../src/client.mjs'

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function fullSnapshot(planName = 'GLM-Code-Plan') {
  return {
    updatedAt: Date.parse('2026-10-01T12:00:00.000Z'),
    providers: [
      {
        key: 'glm',
        displayName: 'GLM Coding Plan',
        status: 'ready',
        credential: 'configured',
        updatedAt: Date.parse('2026-10-01T12:00:00.000Z'),
        plan: { planName, windows: [{ key: '5h', percent: 12.5, resetsAt: '2026-10-01T13:00:00.000Z' }] },
      },
      {
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
      },
    ],
  }
}

function dom() {
  return new JSDOM('<!doctype html><html><body><div data-pane="sidebar"><div class="footArea"><div class="settingsArea"></div></div></div></body></html>', {
    url: 'https://dsh.example/',
    pretendToBeVisual: true,
  })
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

test('sidebar card mounts above Settings, renders provider facts safely, and refreshes explicitly', async () => {
  const { window } = dom()
  const requests = []
  const fetchImpl = async (path, init = {}) => {
    requests.push({ path, method: init.method ?? 'GET' })
    return response(fullSnapshot('<img src=x onerror=alert(1)>'))
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl, pollIntervalMs: 60_000 })
  await turn()

  const container = window.document.querySelector('[data-dsh-quota-watch-card]')
  const settings = window.document.querySelector('.settingsArea')
  assert.ok(container)
  assert.equal(container.nextElementSibling, settings)
  assert.equal(container.getAttribute('data-dsh-plugin'), 'quota-watch')
  assert.equal(container.querySelector('img'), null)
  assert.match(container.textContent, /<img src=x onerror=alert\(1\)>/)
  assert.match(container.textContent, /76%/)
  assert.match(container.textContent, /2,400/)
  assert.deepEqual(requests[0], { path: 'api/dsh-quota-watch/overview', method: 'GET' })

  const collapse = container.querySelector('[data-action="collapse"]')
  collapse.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(container.querySelector('.dqw-body').hidden, true)
  assert.equal(window.localStorage.getItem('dsh-quota-watch:collapsed'), '1')

  container.querySelector('[data-action="refresh"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await turn()
  assert.equal(requests.at(-1).path, 'api/dsh-quota-watch/refresh')
  assert.equal(requests.at(-1).method, 'POST')

  container.remove()
  await turn()
  assert.ok(window.document.querySelector('[data-dsh-quota-watch-card]'), 'observer re-seats a removed card')
  dispose()
  window.close()
})

test('missing credentials and invalid Copilot balance are rendered as distinct states', async () => {
  const { window } = dom()
  const snapshot = {
    providers: [
      { key: 'glm', status: 'missing', credential: 'none', displayName: 'GLM Coding Plan' },
      { key: 'copilot', status: 'ready', credential: 'configured', quota: {
        balanceAvailable: false, creditsUsed: 37,
      } },
    ],
  }
  const dispose = mountQuotaCard({ doc: window.document, win: window, fetchImpl: async () => response(snapshot), pollIntervalMs: 60_000 })
  await turn()
  const card = window.document.querySelector('[data-dsh-quota-watch-card]')
  assert.match(card.textContent, /Not configured/)
  assert.match(card.textContent, /Balance unavailable/)
  assert.match(card.textContent, /Used this cycle: 37/)
  dispose()
  window.close()
})

test('hidden pages pause the client poll timer and visibility resumes it', async () => {
  const { window } = dom()
  let calls = 0
  const dispose = mountQuotaCard({
    doc: window.document,
    win: window,
    fetchImpl: async () => { calls += 1; return response(fullSnapshot()) },
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
