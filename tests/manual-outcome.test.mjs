import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManualOutcomeJournal, ManualOutcomeStorageError } from '../src/core/manual-outcome.mjs'

/**
 * Task 2: the single-entry write-ahead journal for one manual card redemption.
 * Every case writes only inside its own mkdtemp directory — never the real
 * $DSH_HOME — and uses synthetic attempt ids only.
 */

function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-outcome-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

function journalPath(home) {
  return join(home, 'glm-quota-reset', 'manual-outcome.json')
}

function diskRecord(home) {
  return JSON.parse(readFileSync(journalPath(home), 'utf8'))
}

function writeRawRecord(home, record) {
  mkdirSync(join(home, 'glm-quota-reset'), { recursive: true })
  writeFileSync(journalPath(home), `${JSON.stringify(record, null, 2)}\n`)
}

test('begin durably persists one in-flight record that a fresh journal instance can read', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'WEEK' })

  assert.equal(record.version, 1)
  assert.equal(record.resetType, 'WEEK')
  assert.equal(record.status, 'in-flight')
  assert.equal(typeof record.attemptId, 'string')
  assert.ok(record.attemptId.length > 0)
  assert.equal(typeof record.startedAt, 'number')

  // Exact disk schema: only the five approved fields — never credentials,
  // provider record ids, request bodies or raw upstream responses.
  assert.deepEqual(
    Object.keys(diskRecord(home)).sort(),
    ['attemptId', 'resetType', 'startedAt', 'status', 'version'],
  )

  // "Restart": a brand-new journal over the same path cannot prove this POST is
  // still alive, so the disk in-flight projects to unknown; the originating
  // instance still reports its own live attempt truthfully.
  const restarted = createManualOutcomeJournal(journalPath(home))
  const reread = restarted.read()
  assert.equal(reread.attemptId, record.attemptId)
  assert.equal(reread.resetType, record.resetType)
  assert.equal(reread.startedAt, record.startedAt)
  assert.equal(reread.status, 'unknown', 'disk in-flight after restart presents as unknown')
  assert.equal(journal.read().status, 'in-flight', 'the originating instance sees its live attempt as in-flight')
})

test('begin enforces the single-entry lock until the record is fully acknowledged', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))

  const first = journal.begin({ resetType: 'WEEK' })
  assert.throws(() => journal.begin({ resetType: 'FIVE_HOUR' }), ManualOutcomeStorageError)

  // A known receipt is still unresolved: it must keep blocking new entries.
  journal.finishKnown(first.attemptId, 'success')
  assert.throws(() => journal.begin({ resetType: 'WEEK' }), ManualOutcomeStorageError)

  // Only clearing the acknowledged receipt reopens the journal.
  journal.acknowledgeReceipt(first.attemptId)
  assert.equal(journal.read(), null)
  const second = journal.begin({ resetType: 'FIVE_HOUR' })
  assert.notEqual(second.attemptId, first.attemptId)
})

test('begin reports a deterministic storage failure instead of a phantom record', (t) => {
  const home = tempHome(t)
  const blocker = join(home, 'blocker')
  writeFileSync(blocker, 'i am a plain file')

  const journal = createManualOutcomeJournal(join(blocker, 'manual-outcome.json'))
  assert.throws(() => journal.begin({ resetType: 'WEEK' }), ManualOutcomeStorageError)
  // The failed begin must not be mistaken for a spendable, unlocked state by
  // the caller: reading still fails closed instead of returning null.
  assert.throws(() => journal.read(), ManualOutcomeStorageError)
})

test('a crash-leftover in-flight record presents as unknown and clears via acknowledgeUnknown after restart', (t) => {
  const home = tempHome(t)
  writeRawRecord(home, {
    version: 1, attemptId: 'crashed-attempt', resetType: 'FIVE_HOUR', startedAt: 1234, status: 'in-flight',
  })

  const restarted = createManualOutcomeJournal(journalPath(home))
  const projected = restarted.read()
  assert.equal(projected.attemptId, 'crashed-attempt')
  assert.equal(projected.status, 'unknown', 'disk in-flight after a restart is an unknown outcome')

  restarted.acknowledgeUnknown('crashed-attempt')
  assert.equal(restarted.read(), null)
})

test('acknowledgeUnknown never clears the POST that is still in flight in this process', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'WEEK' })

  assert.throws(() => journal.acknowledgeUnknown(record.attemptId), ManualOutcomeStorageError)
  assert.equal(diskRecord(home).status, 'in-flight', 'the live attempt stays locked')
})

test('stale or wrong attempt ids cannot mutate or clear the current record', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'FIVE_HOUR' })

  assert.throws(() => journal.finishKnown('stale-id', 'success'), ManualOutcomeStorageError)
  assert.throws(() => journal.markUnknown('stale-id'), ManualOutcomeStorageError)
  assert.throws(() => journal.acknowledgeUnknown('stale-id'), ManualOutcomeStorageError)
  assert.throws(() => journal.acknowledgeReceipt('stale-id'), ManualOutcomeStorageError)

  const onDisk = diskRecord(home)
  assert.equal(onDisk.attemptId, record.attemptId)
  assert.equal(onDisk.status, 'in-flight')
})

test('finishKnown persists a known-success receipt before any acknowledgement; only acknowledgeReceipt clears it', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'WEEK' })

  const receipt = journal.finishKnown(record.attemptId, 'success')
  assert.equal(receipt.status, 'known-success')
  assert.equal(diskRecord(home).status, 'known-success', 'the receipt is durable before the browser hears anything')

  const restarted = createManualOutcomeJournal(journalPath(home))
  assert.equal(restarted.read().status, 'known-success')

  assert.throws(() => restarted.acknowledgeUnknown(record.attemptId), ManualOutcomeStorageError, 'the acks are not interchangeable')

  restarted.acknowledgeReceipt(record.attemptId)
  assert.equal(restarted.read(), null)
  assert.throws(() => restarted.acknowledgeReceipt(record.attemptId), ManualOutcomeStorageError)
})

test('finishKnown records an explicit upstream refusal as known-refused, not as an unknown', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'FIVE_HOUR' })

  journal.finishKnown(record.attemptId, 'refused')
  assert.equal(diskRecord(home).status, 'known-refused')

  const restarted = createManualOutcomeJournal(journalPath(home))
  assert.equal(restarted.read().status, 'known-refused')
  assert.throws(() => restarted.acknowledgeUnknown(record.attemptId), ManualOutcomeStorageError)
  restarted.acknowledgeReceipt(record.attemptId)
  assert.equal(restarted.read(), null)
})

test('markUnknown persists an unresolved outcome; only acknowledgeUnknown clears it', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'WEEK' })

  const marked = journal.markUnknown(record.attemptId)
  assert.equal(marked.status, 'unknown')
  assert.equal(diskRecord(home).status, 'unknown', 'the unknown state itself survives a crash')

  // An unknown outcome can never be retroactively claimed as known.
  assert.throws(() => journal.finishKnown(record.attemptId, 'success'), ManualOutcomeStorageError)
  assert.throws(() => journal.acknowledgeReceipt(record.attemptId), ManualOutcomeStorageError)

  journal.acknowledgeUnknown(record.attemptId)
  assert.equal(journal.read(), null)
})

test('a storage failure mid-state-machine fails closed instead of pretending the record is gone', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  const record = journal.begin({ resetType: 'WEEK' })

  rmSync(home, { recursive: true, force: true })

  assert.throws(() => journal.finishKnown(record.attemptId, 'success'), ManualOutcomeStorageError)
  assert.throws(() => journal.read(), ManualOutcomeStorageError, 'an unresolved record that cannot be read must never read as "no record"')
})

test('corrupt or invalid records fail closed and refuse new entries', (t) => {
  const home = tempHome(t)
  mkdirSync(join(home, 'glm-quota-reset'), { recursive: true })
  const journal = createManualOutcomeJournal(journalPath(home))

  writeFileSync(journalPath(home), '{"autoReset": broken')
  assert.throws(() => journal.read(), ManualOutcomeStorageError)
  assert.throws(() => journal.begin({ resetType: 'WEEK' }), ManualOutcomeStorageError, 'cannot prove the garbage hides no unresolved record')
  assert.throws(() => journal.acknowledgeUnknown('any'), ManualOutcomeStorageError)

  // A schema-valid-looking record with an unknown status is also corrupt.
  writeRawRecord(home, {
    version: 1, attemptId: 'x', resetType: 'WEEK', startedAt: 1, status: 'totally-bogus',
  })
  assert.throws(() => createManualOutcomeJournal(journalPath(home)).read(), ManualOutcomeStorageError)
})

test('begin rejects an unknown reset type and writes nothing', (t) => {
  const home = tempHome(t)
  const journal = createManualOutcomeJournal(journalPath(home))
  assert.throws(() => journal.begin({ resetType: 'bogus' }))
  assert.throws(() => journal.begin({}))
  assert.equal(journal.read(), null)
})
