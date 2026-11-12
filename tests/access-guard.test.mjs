// 官方信任检查委派（2026-11-12 围栏统一）：requestAllowed 在既有 pairing/loopback +
// 同源栅栏之前，先过官方 connection.requestRejection（缺席回落、抛错 fail-closed）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { officialRejection } from '../src/access.mjs'
import { makeOverviewRoute } from '../src/host.mjs'
import { ROUTES } from '../src/shared.mjs'

const res = () => { const r = { code: 0, body: null }; r.writeHead = (c) => { r.code = c }; r.end = (b) => { r.body = b ? JSON.parse(b) : null }; return r }
const req = (over = {}) => ({
  headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', ...over },
  socket: { remoteAddress: '127.0.0.1' },
  method: 'GET',
  url: ROUTES.overview,
})

test('officialRejection：拒绝/放行/缺席/抛错 四态', () => {
  assert.equal(officialRejection({ get: () => ({ requestRejection: () => 403 }) }, req()), 403)
  assert.equal(officialRejection({ get: () => ({ requestRejection: () => 401 }) }, req()), 401)
  assert.equal(officialRejection({ get: () => ({ requestRejection: () => undefined }) }, req()), undefined)
  assert.equal(officialRejection({ get: () => undefined }, req()), undefined)
  assert.equal(officialRejection({}, req()), undefined)
  assert.equal(officialRejection({ get: () => ({ requestRejection: () => { throw new Error('boom') } }) }, req()), 403)
})

test('overview 路由：官方拒绝 → 403 forbidden（读路由不豁免）', async () => {
  const ctx = { get: (n) => (n === 'connection' ? { requestRejection: () => 403 } : undefined) }
  const route = makeOverviewRoute(ctx, {})
  const r = res()
  await route.handler(req(), r)
  assert.equal(r.code, 403)
  assert.equal(r.body?.error, 'forbidden')
})

test('overview 路由：DNS rebinding 形态（Origin=Host=攻击者域、官方缺席）→ pairing/loopback 栅栏仍拒绝', async () => {
  const ctx = { get: () => undefined }
  const route = makeOverviewRoute(ctx, {})
  const r = res()
  await route.handler(req({ host: 'attacker.example', origin: 'http://attacker.example' }), r)
  assert.equal(r.code, 403)
})
