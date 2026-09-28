import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

test('package metadata identifies the approved DSH plugin and release target', () => {
  assert.equal(packageJson.name, '@iasiv5/dsh-quota-watch')
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/)
  assert.equal(packageJson.repository.url, 'https://github.com/iasiv5/dsh-quota-watch')
  assert.equal(packageJson.dsh.engines.dsh, '>=0.1.7-rc.2')
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh.client.platform, 'web')
})

test('public lockfile resolves dependencies over HTTPS npmjs URLs', async () => {
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const resolved = Object.values(lock.packages).map((entry) => entry.resolved).filter(Boolean)
  assert.ok(resolved.length > 0)
  for (const url of resolved) assert.match(url, /^https:\/\/registry\.npmjs\.org\//)
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
