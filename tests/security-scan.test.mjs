import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { derivePackFiles, filePatternMatcher, findSecretRules, isApprovedCommitEmail, isGitHubNoreplyEmail, isSensitivePath } from '../scripts/check-public-package.mjs'

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

test('project ignore rules protect local npm credentials', async () => {
  const ignore = await readFile(resolve(root, '.gitignore'), 'utf8')
  assert.match(ignore, /^\.npmrc$/m)
  assert.match(ignore, /^\.credentials\.yaml$/m)
  assert.match(ignore, /^\.env(\.\*)?$/m)
  assert.doesNotMatch(ignore, /^docs\/plans\/$/m)
})

test('pack manifest derivation expands the package.json files allowlist offline', () => {
  const worktree = [
    resolve(root, 'package.json'),
    resolve(root, 'README.md'),
    resolve(root, 'LICENSE'),
    resolve(root, 'src/host.mjs'),
    resolve(root, 'src/client.mjs'),
    resolve(root, 'src/core/adapters.mjs'),
    resolve(root, 'lib/client.js'),
    resolve(root, 'docs/assets/panel.png'),
    resolve(root, 'cordis.patch.yml'),
    resolve(root, 'tests/host.test.mjs'),
  ]
  const pkg = { files: ['src/**/*.mjs', 'lib/client.js', 'docs/assets', 'cordis.patch.yml', 'README.md', 'LICENSE'] }
  const files = derivePackFiles(worktree, pkg)
  for (const expected of ['package.json', 'README.md', 'LICENSE', 'src/host.mjs', 'src/core/adapters.mjs', 'lib/client.js', 'docs/assets/panel.png', 'cordis.patch.yml']) {
    assert.ok(files.includes(expected), `expected ${expected} in the derived pack list`)
  }
  assert.equal(files.includes('tests/host.test.mjs'), false, 'tests are not packed')
  assert.deepEqual(derivePackFiles(['src/host.mjs'], pkg).includes('src/host.mjs'), true, 'already-relative paths pass through')
})

test('file pattern matcher treats directory entries as prefixes and globs as minimatch', () => {
  const dir = filePatternMatcher('docs/assets')
  assert.equal(dir('docs/assets/panel.png'), true)
  assert.equal(dir('docs/assets-backup/panel.png'), false)
  const glob = filePatternMatcher('src/**/*.mjs')
  assert.equal(glob('src/host.mjs'), true, 'minimatch ** matches zero segments')
  assert.equal(glob('src/core/adapters.mjs'), true)
  assert.equal(glob('lib/client.js'), false)
})

test('commit privacy matcher accepts GitHub noreply addresses only', () => {
  assert.equal(isGitHubNoreplyEmail('26645513+iasiv5@users.noreply.github.com'), true)
  assert.equal(isGitHubNoreplyEmail('developer@example.invalid'), false)
})

test('commit metadata gate approves noreply and the owner-declared public identity', () => {
  // 2026-10-24 主人裁决：iasi@163.com 是有意的公开邮箱——web 机（noreply）与
  // Windows 机（163）两台发版机同一口径，发布不再需要改写身份。
  assert.equal(isApprovedCommitEmail('26645513+iasiv5@users.noreply.github.com'), true)
  assert.equal(isApprovedCommitEmail('iasi@163.com'), true)
  assert.equal(isApprovedCommitEmail('IASI@163.com'), true, '大小写不敏感（git 邮箱语义）')
  assert.equal(isApprovedCommitEmail('developer@example.invalid'), false)
  assert.equal(isApprovedCommitEmail(undefined), false)
})
