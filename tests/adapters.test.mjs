import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  buildCopilotProbe,
  buildGlmProbe,
  buildGlmUsageProbe,
  formatGlmIntervalTime,
  parseCopilotUser,
  parseGlmPlan,
  parseGlmUsage,
  remainingToUsed,
  usageDayWindow,
} from '../src/core/adapters.mjs'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const glmFixture = JSON.parse(await readFile(resolve(fixtureDir, 'glm-plan-response.json'), 'utf8'))
const glmUsageFixture = JSON.parse(await readFile(resolve(fixtureDir, 'glm-model-usage-response.json'), 'utf8'))
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

test('GLM windows are keyed by provider unit, clamp percentages, and map MCP limits to mcp', () => {
  const parsed = parseGlmPlan(200, glmFixture)
  assert.equal(parsed.planName, 'GLM-Code-Plan')
  assert.deepEqual(parsed.windows.map(({ key, percent }) => ({ key, percent })), [
    { key: 'week', percent: 72 },
    { key: 'month', percent: 25 },
    { key: '5h', percent: 12.5 },
    { key: 'mcp', percent: 99 },
  ])
  assert.equal(parsed.windows.length, 4)
  assert.equal(parsed.windows[2].resetsAt, '2026-10-03T10:40:00.000Z')
  assert.equal(parsed.windows[3].resetsAt, '2026-11-01T00:00:00.000Z')
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
      { type: 'TOKENS_LIMIT', unit: 999, percentage: 5 },
    ] },
  })
  assert.equal(parsed, undefined)
})

test('GLM MCP TIME_LIMIT rows map to an mcp window with a currentValue/usage fallback', () => {
  const parsed = parseGlmPlan(200, {
    success: true,
    data: { limits: [
      { type: 'TIME_LIMIT', unit: 5, currentValue: 1, usage: 100 },
      { type: 'TIME_LIMIT', unit: 5, percentage: 12.5 },
    ] },
  })
  assert.deepEqual(parsed.windows.map(({ key, percent }) => ({ key, percent })), [
    { key: 'mcp', percent: 1 },
    { key: 'mcp', percent: 12.5 },
  ])
})

test('GLM usage probes target the model-usage endpoint with encoded interval params', () => {
  assert.deepEqual(
    buildGlmUsageProbe({ provider: 'zai-coding-cn', apiKey: 'synthetic-glm-key', startTime: '2026-09-29 00:00:00', endTime: '2026-09-29 09:13:08' }),
    {
      url: 'https://open.bigmodel.cn/api/monitor/usage/model-usage?startTime=2026-09-29%2000%3A00%3A00&endTime=2026-09-29%2009%3A13%3A08',
      headers: { authorization: 'synthetic-glm-key', 'accept-language': 'en-US,en' },
    },
  )
  assert.equal(buildGlmUsageProbe({ provider: 'zai', apiKey: 'k', startTime: 'a', endTime: 'b' }).url,
    'https://api.z.ai/api/monitor/usage/model-usage?startTime=a&endTime=b')
  assert.equal(buildGlmUsageProbe({ provider: 'unrelated', apiKey: 'k', startTime: 'a', endTime: 'b' }), undefined)
  assert.equal(buildGlmUsageProbe({ provider: 'zai-coding-cn', apiKey: '  ', startTime: 'a', endTime: 'b' }), undefined)
  assert.equal(buildGlmUsageProbe({ provider: 'zai-coding-cn', apiKey: 'k', startTime: ' ', endTime: 'b' }), undefined)
})

test('GLM usage parser normalizes totals and per-model summaries from synthetic responses', () => {
  const parsed = parseGlmUsage(200, glmUsageFixture)
  assert.equal(parsed.totalTokens, 8300000)
  assert.equal(parsed.totalCalls, 152)
  assert.deepEqual(parsed.models, [
    { name: 'GLM-5.3', tokens: 21400 },
    { name: 'GLM-5.3-Flash', tokens: 8278600 },
  ])
})

test('GLM usage parser omits empty model lists and skips invalid model rows', () => {
  const parsed = parseGlmUsage(200, {
    success: true,
    data: { totalUsage: { totalTokensUsage: 10, totalModelCallCount: 2, modelSummaryList: [
      { modelName: '  ', totalTokens: 5 },
      { modelName: 'GLM-5.3', totalTokens: -1 },
      { modelName: 'GLM-5.3', totalTokens: 'oops' },
      { modelName: 'GLM-5.3-Flash', totalTokens: 10 },
    ] } },
  })
  assert.deepEqual(parsed.models, [{ name: 'GLM-5.3-Flash', tokens: 10 }])
  const noModels = parseGlmUsage(200, {
    success: true,
    data: { totalUsage: { totalTokensUsage: 0, totalModelCallCount: 0, modelSummaryList: [] } },
  })
  assert.deepEqual(noModels, { totalTokens: 0, totalCalls: 0 })
  assert.equal('models' in noModels, false)
})

test('GLM usage parser rejects bad statuses, failed flags and invalid totals', () => {
  assert.equal(parseGlmUsage(404, glmUsageFixture), undefined)
  assert.equal(parseGlmUsage(200, { success: false, data: { totalUsage: {} } }), undefined)
  assert.equal(parseGlmUsage(200, { success: true, data: {} }), undefined)
  assert.equal(parseGlmUsage(200, { success: true, data: { totalUsage: { totalTokensUsage: -1, totalModelCallCount: 2 } } }), undefined)
  assert.equal(parseGlmUsage(200, { success: true, data: { totalUsage: { totalTokensUsage: 1, totalModelCallCount: 'x' } } }), undefined)
  assert.equal(parseGlmUsage(200, { success: true, data: { totalUsage: { totalTokensUsage: '8300000', totalModelCallCount: 152 } } }).totalTokens, 8300000)
})

test('interval helpers format host-local calendar days', () => {
  assert.equal(formatGlmIntervalTime(new Date(2026, 8, 29, 9, 13, 8)), '2026-09-29 09:13:08')
  assert.equal(formatGlmIntervalTime(new Date(2026, 10, 3, 23, 59, 59)), '2026-11-03 23:59:59')
  assert.equal(formatGlmIntervalTime(new Date('nope')), undefined)
  const window = usageDayWindow(new Date(2026, 8, 29, 9, 13, 8))
  assert.deepEqual(window, { startTime: '2026-09-29 00:00:00', endTime: '2026-09-29 09:13:08' })
  assert.deepEqual(usageDayWindow(new Date(2026, 8, 29, 0, 0, 30)), { startTime: '2026-09-29 00:00:00', endTime: '2026-09-29 00:00:30' })
  assert.deepEqual(usageDayWindow(new Date(2026, 9, 1, 23, 59, 59)), { startTime: '2026-10-01 00:00:00', endTime: '2026-10-01 23:59:59' })
})

test('remaining percentages invert to used percentages only inside 0-100', () => {
  assert.equal(remainingToUsed(62), 38)
  assert.equal(remainingToUsed(76.4), 23.6)
  assert.equal(remainingToUsed(0), 100)
  assert.equal(remainingToUsed(100), 0)
  assert.equal(remainingToUsed('12.5'), 87.5)
  assert.equal(remainingToUsed(undefined), undefined)
  assert.equal(remainingToUsed('nope'), undefined)
  assert.equal(remainingToUsed(-1), undefined)
  assert.equal(remainingToUsed(150), undefined)
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
