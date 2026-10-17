import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse } from 'yaml'
import { CLIENT_ROUTES, ROUTES } from '../src/shared.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

test('package metadata identifies the approved DSH plugin and release target', () => {
  assert.equal(packageJson.name, '@iasiv5/dsh-quota-watch')
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/)
  assert.equal(packageJson.repository.url, 'https://github.com/iasiv5/dsh-quota-watch')
  assert.equal(packageJson.dsh.engines.dsh, '>=0.2.0-rc.1')
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh.client.platform, 'web')
})

test('public lockfile resolves dependencies over HTTPS npmjs URLs', async () => {
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const resolved = Object.values(lock.packages).map((entry) => entry.resolved).filter(Boolean)
  assert.ok(resolved.length > 0)
  for (const url of resolved) assert.match(url, /^https:\/\/registry\.npmjs\.org\//)
})

test('lockfile root version stays in sync with package.json', async () => {
  // 2026-10-18 retro: the root version fields drifted to 0.1.27 across three
  // shipped releases (0.1.28–0.1.30) before anyone noticed — same failure
  // mode dsh-m fixed in its release discipline (know-how 031). Pin both.
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  assert.equal(lock.version, packageJson.version)
  assert.equal(lock.packages[''].version, packageJson.version)
})

test('bundle patch mounts exactly the quota-watch host row', async () => {
  const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id:\s*quota-watch\b/)
  assert.match(patch, /name:\s*['"]?@iasiv5\/dsh-quota-watch['"]?\b/)
})

test('client export and quality scripts are defined', () => {
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(packageJson.scripts.build, 'node scripts/build-client.mjs')
  assert.equal(packageJson.scripts.test, 'node --test')
  assert.equal(packageJson.scripts['security:check'], 'node scripts/check-public-package.mjs')
  assert.equal(packageJson.scripts.prepack, 'npm run build && npm run security:check')
  assert.ok(!packageJson.files.some((path) => path.includes('.npmrc') || path.includes('credentials')))
})

test('service-constructing tests build exclusively through the isolated helper', async () => {
  const testsDir = resolve(root, 'tests')
  for (const name of ['host.test.mjs', 'manual-redemption.test.mjs']) {
    const content = await readFile(resolve(testsDir, name), 'utf8')
    assert.ok(
      !content.includes('createQuotaService('),
      `${name} must construct services via createIsolatedQuotaService, never the bare factory`,
    )
  }
  const helper = await readFile(resolve(testsDir, 'support', 'isolated-service.mjs'), 'utf8')
  assert.ok(helper.includes('createQuotaService('), 'the helper is the only test-side importer of the bare factory')
  assert.ok(helper.includes('legacyAutoSettingsPath'), 'the helper injects the legacy settings path')
  assert.ok(helper.includes('manualOutcomePath'), 'the helper injects the manual outcome path')
})

test('runtime source has zero automatic-strategy code paths', async () => {
  const runtimeSources = [
    'src/host.mjs',
    'src/shared.mjs',
    'src/access.mjs',
    'src/core/adapters.mjs',
    'src/core/reset.mjs',
    'src/core/manual-outcome.mjs',
    'src/core/legacy-auto-settings.mjs',
  ]
  for (const name of runtimeSources) {
    const content = await readFile(resolve(root, name), 'utf8')
    assert.ok(
      !/maybeAutoReset|evaluateAutoReset|normalizeAutoResetConfig|autoResetConfigFor|windowKeyForResetType|readAutoResetSettings|writeAutoResetSettings|updateAutoResetConfig/.test(content),
      `${name} still contains retired automatic-strategy code`,
    )
    assert.ok(!content.includes('ROUTES.autoReset'), `${name} still maps the retired endpoint through the shared contract`)
  }
})

test('the retired auto-reset endpoint survives only as a host-private 410 tombstone', async () => {
  assert.ok(!('autoReset' in ROUTES), 'the shared route contract must not carry the retired endpoint')
  assert.ok(!('autoReset' in CLIENT_ROUTES))
  const shared = await readFile(resolve(root, 'src/shared.mjs'), 'utf8')
  assert.ok(!shared.includes('autoReset'), 'src/shared.mjs mentions the retired endpoint')
  const host = await readFile(resolve(root, 'src/host.mjs'), 'utf8')
  assert.ok(host.includes("'/api/dsh-quota-watch/auto-reset'"), 'the private tombstone path lives in the host only')
})

test('cordis patch keeps the read-only quota-watch row without autoReset initial values', async () => {
  const patch = parse(await readFile(resolve(root, 'cordis.patch.yml'), 'utf8'))
  const row = patch[0].insert[0]
  assert.equal(row.id, 'quota-watch')
  assert.deepEqual(Object.keys(row.config), ['pollIntervalSec'])
  assert.equal(row.config.pollIntervalSec, 60)
  const raw = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
  assert.ok(!raw.includes('autoReset'), 'no automatic-use authorization remains in the shipped profile patch')
})

test('Cordis patch and GitHub workflows parse and enforce OIDC publishing', async () => {
  const patch = parse(await readFile(resolve(root, 'cordis.patch.yml'), 'utf8'))
  assert.equal(patch[0].insert[0].id, 'quota-watch')

  const ci = parse(await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'))
  assert.equal(ci.jobs.verify.steps.find((step) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0)
  assert.ok(Object.hasOwn(ci.on, 'push'))
  assert.ok(Object.hasOwn(ci.on, 'pull_request'))
  assert.ok(ci.jobs.verify.steps.some((step) => step.run === 'npm run security:check'))
  assert.ok(ci.jobs.verify.steps.some((step) => step.run === 'npm install --global npm@12.1.0'))

  const publish = parse(await readFile(resolve(root, '.github/workflows/publish.yml'), 'utf8'))
  assert.equal(publish.jobs.publish.steps.find((step) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0)
  assert.deepEqual(publish.on.push.tags, ['v*'])
  assert.ok(publish.jobs.publish.steps.some((step) => step.run === 'npm install --global npm@12.1.0'))
  assert.equal(publish.jobs.publish.steps.some((step) => step.name === 'Require public-safe npm account email'), false)
  assert.equal(publish.jobs.publish.steps.some((step) => step.env?.NPM_PUBLIC_EMAIL_CONFIRMED), false)
  assert.equal(publish.permissions['id-token'], 'write')
  assert.ok(publish.jobs.publish.steps.some((step) => typeof step.run === 'string' && step.run.includes('--provenance')))
  assert.equal(publish.jobs.publish.steps.some((step) => step.env?.NODE_AUTH_TOKEN), false)
})

test('the client declares every service it touches (cordis inject contract; 2026-10-13 boot failure)', async () => {
  // ctx.slots access without `inject: ['slots']` throws
  // "cannot get property 'slots' without inject" and kills the whole
  // activation — the declaration must exist in BOTH the module export and
  // the package manifest, in lockstep.
  const { inject } = await import('../src/client.mjs')
  assert.ok(Array.isArray(inject) && inject.includes('slots'), 'client touches ctx.slots → inject must declare "slots"')
  assert.deepEqual(packageJson.dsh?.client?.inject, inject, 'package.json dsh.client.inject must mirror the client inject declaration')
})
