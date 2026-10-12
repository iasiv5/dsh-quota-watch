import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { retireLegacyAutoResetSettings } from '../src/core/legacy-auto-settings.mjs'

/**
 * Task 1: the one-shot retirement of the legacy automatic card-use switches.
 * Every case writes only inside its own mkdtemp directory — never the real
 * $DSH_HOME — so a defect here cannot touch a live installation.
 */

function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-legacy-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

function assertAllDisabled(document, message) {
  assert.equal(document.autoReset.fiveHour.enabled, false, message)
  assert.equal(document.autoReset.week.enabled, false, message)
}

test('retire flips both saved enabled:true switches to false, keeps unrelated fields, idempotent', (t) => {
  const home = tempHome(t)
  const settingsPath = join(home, 'glm-quota-reset', 'settings.json')
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify({
    autoReset: {
      fiveHour: { enabled: true, threshold: 97 },
      week: { enabled: true },
    },
    savedAt: '2026-10-01',
  }, null, 2)}\n`)

  assert.deepEqual(retireLegacyAutoResetSettings(settingsPath), { ok: true })

  const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
  assertAllDisabled(saved, 'both legacy switches must be forced off')
  assert.equal(saved.autoReset.fiveHour.threshold, 97, 'threshold is not an authorization field; keep it')
  assert.equal(saved.savedAt, '2026-10-01', 'unrelated root fields are preserved')

  // Idempotent: retiring an already-retired file is still a clean success.
  assert.deepEqual(retireLegacyAutoResetSettings(settingsPath), { ok: true })
  assertAllDisabled(JSON.parse(readFileSync(settingsPath, 'utf8')), 'second run stays all-off')
})

test('retire creates an all-off file when nothing was saved yet', (t) => {
  const home = tempHome(t)
  const settingsPath = join(home, 'glm-quota-reset', 'settings.json')

  assert.deepEqual(retireLegacyAutoResetSettings(settingsPath), { ok: true })

  const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
  assertAllDisabled(saved, 'a missing saved file must still produce the off overrides')
  assert.deepEqual(saved.autoReset.fiveHour, { enabled: false })
  assert.deepEqual(saved.autoReset.week, { enabled: false })
})

test('retire recovers a corrupt saved file to all-off', (t) => {
  const home = tempHome(t)
  const settingsPath = join(home, 'glm-quota-reset', 'settings.json')
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, '{"autoReset": {broken')

  assert.deepEqual(retireLegacyAutoResetSettings(settingsPath), { ok: true })

  // Corrupt content fails CLOSED: rebuilt all-off, never read back as "enabled".
  assertAllDisabled(JSON.parse(readFileSync(settingsPath, 'utf8')), 'corrupt file recovered to all-off')
})

test('retire reports a deterministic failure when the target parent is a plain file', (t) => {
  const home = tempHome(t)
  const blocker = join(home, 'blocker')
  writeFileSync(blocker, 'i am a plain file')
  const settingsPath = join(blocker, 'settings.json')

  let result
  assert.doesNotThrow(() => { result = retireLegacyAutoResetSettings(settingsPath) })
  assert.equal(result.ok, false, 'a blocked write must be reported, never claimed as deactivated')
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error.length > 0)
  let second
  assert.doesNotThrow(() => { second = retireLegacyAutoResetSettings(settingsPath) })
  assert.deepEqual(second, result, 'the failure classification is deterministic')

  assert.equal(readFileSync(blocker, 'utf8'), 'i am a plain file', 'the blocking file is untouched')
  assert.deepEqual(readdirSync(home), ['blocker'], 'no temp files are left behind in the parent directory')
})
