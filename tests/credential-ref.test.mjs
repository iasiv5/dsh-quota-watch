/**
 * vendored 凭据引用命名函数的行为契约（源：@deepseek-ai/dsh-credentials@0.2.1-rc.2；
 * 语义对照 docs/reports/2026-10-17-dsh-0.2.1-rc.2-compat-audit.md）。
 * 运行：node --test tests/credential-ref.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { credentialKey, credentialRef, isCredentialRefName } from '../src/credential-ref.mjs'

test('credentialRef：合法 POSIX 标识符原样通过（运行时恒等，宿主消费普通字符串）', () => {
  const ref = credentialRef('GLM_QUOTA_KEY_A')
  assert.equal(ref, 'GLM_QUOTA_KEY_A')
  assert.equal(typeof ref, 'string')
})

test('credentialRef：非法形态抛 TypeError 且消息带文法（含 "/" 的路径形态被拒）', () => {
  assert.throws(() => credentialRef('llm-pi-ai/github-copilot'), /credential ref ".*" must match/)
  assert.throws(() => credentialRef('1STARTS-WITH-DIGIT'), /must match/)
  assert.throws(() => credentialRef('has space'), /must match/)
})

test('isCredentialRefName：文法内 true、文法外 false（未知形态读作未设置而非抛错）', () => {
  assert.equal(isCredentialRefName('GLM_QUOTA_KEY_A'), true)
  assert.equal(isCredentialRefName('_UNDERSCORE_OK'), true)
  assert.equal(isCredentialRefName('llm-pi-ai/github-copilot'), false)
  assert.equal(isCredentialRefName(''), false)
})

test('credentialKey：scope/id 合成 "<scope>/<id>"（宿主 readRecord 的键形态）', () => {
  assert.equal(credentialKey('llm-pi-ai', 'github-copilot'), 'llm-pi-ai/github-copilot')
  assert.equal(credentialKey('llm-pi-ai', 'zai-coding-cn'), 'llm-pi-ai/zai-coding-cn')
})

test('credentialKey：任一段非法抛 TypeError（大写/下划线/斜杠/空段均不容）', () => {
  assert.throws(() => credentialKey('llm-pi-ai', 'GitHubCopilot'), /credential key segment/)
  assert.throws(() => credentialKey('llm_pi_ai', 'copilot'), /must match/)
  assert.throws(() => credentialKey('llm-pi-ai', 'a/b'), /must match/)
  assert.throws(() => credentialKey('', 'copilot'), /must match/)
})
