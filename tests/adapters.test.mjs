import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  buildCopilotProbe,
  buildGlmProbe,
  parseCopilotUser,
  parseGlmPlan,
} from '../src/core/adapters.mjs'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const glmFixture = JSON.parse(await readFile(resolve(fixtureDir, 'glm-plan-response.json'), 'utf8'))
const copilotFixture = JSON.parse(await readFile(resolve(fixtureDir, 'copilot-user-response.json'), 'utf8'))

test('GLM route adapters use their fixed origins and raw-key authorization', () => {
  assert.deepEqual(buildGlmProbe({ provider: 'zai-coding-cn', apiKey: 'synthetic-glm-key' }), {
    url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    headers: { authorization: 'synthetic-glm-key', 'accept-language': 'en-US,en' },
  })
  assert.equal(buildGlmProbe({ provider: 'zai', apiKey: 'synthetic-glm-key' }).url,
    'https://api.z.ai/api/monitor/usage/quota/limit')
  assert.equal(buildGlmProbe({ provider: 'zai-coding', apiKey: 'synthetic-glm-key' }).url,
    'https://api.z.ai/api/monitor/usage/quota/limit')
  assert.equal(buildGlmProbe({ provider: 'unrelated', apiKey: 'synthetic-glm-key' }), undefined)
})

test('GLM windows are keyed by provider unit, clamp percentages, and skip MCP limits', () => {
  const parsed = parseGlmPlan(200, glmFixture)
  assert.equal(parsed.planName, 'GLM-Code-Plan')
  assert.deepEqual(parsed.windows.map(({ key, percent }) => ({ key, percent })), [
    { key: 'week', percent: 72 },
    { key: 'month', percent: 25 },
    { key: '5h', percent: 12.5 },
  ])
  assert.equal(parsed.windows.length, 3)
  assert.equal(parsed.windows[2].resetsAt, '2026-10-03T10:40:00.000Z')
})

test('GLM credit windows use the exact currentValue/usage ratio', () => {
  const parsed = parseGlmPlan(200, {
    success: true,
    data: {
      limits: [
        { type: 'CREDIT_LIMIT', unit: 6, currentValue: 500, usage: 2000, percentage: 0.1 },
        { type: 'CREDIT_LIMIT', unit: 3, percentage: 25 },
      ],
    },
  })
  assert.deepEqual(parsed.windows.map(({ key, percent }) => ({ key, percent })), [
    { key: 'week', percent: 25 },
    { key: '5h', percent: 25 },
  ])
})

test('GLM parser rejects bad responses and does not invent unknown windows', () => {
  assert.equal(parseGlmPlan(401, glmFixture), undefined)
  assert.equal(parseGlmPlan(200, { success: false, data: { limits: [] } }), undefined)
  const parsed = parseGlmPlan(200, {
    success: true,
    data: { limits: [
      { type: 'TIME_LIMIT', unit: 3, percentage: 99 },
      { type: 'TOKENS_LIMIT', unit: 999, percentage: 5 },
    ] },
  })
  assert.equal(parsed, undefined)
})

test('Copilot quota adapter uses the raw GitHub OAuth grant for the user snapshot endpoint', () => {
  assert.deepEqual(buildCopilotProbe({ githubOAuthToken: 'synthetic-github-oauth' }), {
    url: 'https://api.github.com/copilot_internal/user',
    headers: {
      authorization: 'Bearer synthetic-github-oauth',
      accept: 'application/json',
      'user-agent': 'GitHubCopilotChat/0.35.0',
      'editor-version': 'vscode/1.107.0',
      'editor-plugin-version': 'copilot-chat/0.35.0',
      'copilot-integration-id': 'vscode-chat',
    },
  })
})

test('Copilot parser exposes a finite provider-reported remaining quota and separate usage', () => {
  const parsed = parseCopilotUser(200, copilotFixture)
  assert.equal(parsed.planName, 'enterprise')
  assert.equal(parsed.tokenBasedBilling, true)
  assert.equal(parsed.balanceAvailable, true)
  assert.equal(parsed.remaining, 7600)
  assert.equal(parsed.entitlement, 10000)
  assert.equal(parsed.percentRemaining, 76)
  assert.equal(parsed.creditsUsed, 2400)
  assert.equal(parsed.resetsAt, '2026-11-01T00:00:00.000Z')
})

test('Copilot parser never treats unlimited zero-entitlement placeholders as a balance', () => {
  const parsed = parseCopilotUser(200, {
    token_based_billing: true,
    quota_reset_date: '2026-11-01',
    quota_snapshots: {
      premium_interactions: {
        unlimited: true,
        entitlement: 0,
        remaining: 0,
        percent_remaining: 100,
        credits_used: 37,
      },
    },
  })
  assert.equal(parsed.balanceAvailable, false)
  assert.equal(parsed.remaining, undefined)
  assert.equal(parsed.creditsUsed, 37)
  assert.equal(parsed.resetsAt, '2026-11-01T00:00:00.000Z')
})

test('Copilot parser does not infer remaining from entitlement and credits_used', () => {
  const parsed = parseCopilotUser(200, {
    token_based_billing: true,
    quota_snapshots: {
      premium_interactions: {
        unlimited: false,
        entitlement: 10000,
        credits_used: 2400,
      },
    },
  })
  assert.equal(parsed.balanceAvailable, false)
  assert.equal(parsed.remaining, undefined)
  assert.equal(parsed.creditsUsed, 2400)
})

test('Copilot parser rejects missing premium-interaction snapshots and non-200 responses', () => {
  assert.equal(parseCopilotUser(401, copilotFixture), undefined)
  assert.equal(parseCopilotUser(200, { quota_snapshots: { chat: { credits_used: 1 } } }), undefined)
})

test('legacy request quotas are not mislabeled as AI Credits', () => {
  const parsed = parseCopilotUser(200, {
    copilot_plan: 'pro',
    token_based_billing: false,
    quota_snapshots: {
      premium_interactions: {
        unlimited: false,
        entitlement: 300,
        remaining: 200,
        credits_used: 100,
      },
    },
  })
  assert.equal(parsed.balanceAvailable, false)
  assert.equal(parsed.remaining, undefined)
  assert.equal(parsed.creditsUsed, undefined)
})
