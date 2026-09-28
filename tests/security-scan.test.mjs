import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { findSecretRules, isSensitivePath } from '../scripts/check-public-package.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('secret scanner detects synthetic credential-shaped strings without returning values', () => {
  const githubToken = ['gho', 'A'.repeat(36)].join('_')
  const glmKeyShape = `${'a'.repeat(32)}.${'B'.repeat(28)}`
  const rules = findSecretRules(`github=${githubToken}\nglm=${glmKeyShape}`)
  assert.deepEqual(rules, ['github-token', 'provider-key-shape'])
  assert.equal(JSON.stringify(rules).includes(githubToken), false)
  assert.equal(JSON.stringify(rules).includes(glmKeyShape), false)
})

test('secret scanner permits synthetic fixtures and ordinary source text', () => {
  assert.deepEqual(findSecretRules('synthetic-oauth-token-for-tests, GLM_Code_Plan, 12345'), [])
})

test('sensitive local credential and backup paths are forbidden from public files', () => {
  assert.equal(isSensitivePath('.npmrc'), true)
  assert.equal(isSensitivePath('.credentials.yaml'), true)
  assert.equal(isSensitivePath('.env.local'), true)
  assert.equal(isSensitivePath('tmp/provider-response.log'), true)
  assert.equal(isSensitivePath('src/host.mjs'), false)
})

test('project ignore rules protect local npm credentials and maintainer plans', async () => {
  const ignore = await readFile(resolve(root, '.gitignore'), 'utf8')
  assert.match(ignore, /^\.npmrc$/m)
  assert.match(ignore, /^\.credentials\.yaml$/m)
  assert.match(ignore, /^docs\/plans\/$/m)
})
