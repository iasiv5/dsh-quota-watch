import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCopilotOAuthToken,
  resolveGlmCredential,
} from '../src/host.mjs'

function settingsFor(apiKeyEnv) {
  return {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: { providers: { 'zai-coding-cn': { apiKeyEnv } } },
    }],
  }
}

test('GLM resolver re-reads both apiKeyEnv and the current credential value per operation', async () => {
  let apiKeyEnv = 'GLM_QUOTA_KEY_A'
  const resolvedRefs = []
  const values = new Map([
    ['GLM_QUOTA_KEY_A', 'synthetic-glm-key-a'],
    ['GLM_QUOTA_KEY_B', 'synthetic-glm-key-b'],
  ])
  const ctx = {
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {
      'zai-coding-cn': { get apiKeyEnv() { return apiKeyEnv } },
    } } }] },
    credentials: {
      resolve: async (ref) => {
        const name = String(ref)
        resolvedRefs.push(name)
        return values.has(name) ? { value: values.get(name) } : undefined
      },
    },
  }

  assert.equal(await resolveGlmCredential(ctx, 'zai-coding-cn'), 'synthetic-glm-key-a')
  apiKeyEnv = 'GLM_QUOTA_KEY_B'
  assert.equal(await resolveGlmCredential(ctx, 'zai-coding-cn'), 'synthetic-glm-key-b')
  assert.deepEqual(resolvedRefs, ['GLM_QUOTA_KEY_A', 'GLM_QUOTA_KEY_B'])
})

test('GLM resolver ignores literal apiKey and unknown provider routes', async () => {
  let resolves = 0
  const ctx = {
    settings: settingsFor(undefined),
    credentials: { resolve: async () => { resolves += 1; return { value: 'should-not-be-read' } } },
  }
  assert.equal(await resolveGlmCredential(ctx, 'zai-coding-cn'), undefined)
  assert.equal(await resolveGlmCredential(ctx, 'unknown-provider'), undefined)
  assert.equal(resolves, 0)
})

test('Copilot resolver re-reads the current OAuth grant refresh field, never access', async () => {
  let refresh = 'synthetic-github-oauth-a'
  let reads = 0
  const ctx = {
    credentials: {
      readRecord: async (key) => {
        reads += 1
        assert.equal(String(key), 'llm-pi-ai/github-copilot')
        return { kind: 'grant', payload: { type: 'oauth', refresh, access: 'synthetic-copilot-api-token' } }
      },
    },
  }

  assert.equal(await resolveCopilotOAuthToken(ctx), 'synthetic-github-oauth-a')
  refresh = 'synthetic-github-oauth-b'
  assert.equal(await resolveCopilotOAuthToken(ctx), 'synthetic-github-oauth-b')
  assert.equal(reads, 2)
})

test('Copilot resolver does not fall back to a short-lived access token', async () => {
  const ctx = {
    credentials: {
      readRecord: async () => ({ kind: 'grant', payload: { type: 'oauth', access: 'synthetic-short-token' } }),
    },
  }
  assert.equal(await resolveCopilotOAuthToken(ctx), undefined)
})
