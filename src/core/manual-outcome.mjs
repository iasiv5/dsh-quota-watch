import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { normalizeResetType } from './reset.mjs'

/**
 * Write-ahead journal for exactly one manual reset-card redemption.
 *
 * The upstream POST that spends a reset card is irreversible: once sent, a
 * timeout, crash or lost host→browser response can leave the user not knowing
 * whether a card was burned. This journal closes that gap for one attempt at a
 * time:
 *
 *   begin()            — durably record `in-flight` BEFORE the POST is sent.
 *                        A failed write means no POST may be sent at all.
 *   finishKnown()      — the upstream answered definitively: persist a
 *                        `known-success` / `known-refused` receipt. It is NOT
 *                        cleared here: the browser must first confirm delivery.
 *   markUnknown()      — the POST outcome could not be interpreted (timeout,
 *                        non-200, unparseable body): persist `unknown`.
 *   acknowledgeUnknown()   — the user verified against the provider; clear.
 *   acknowledgeReceipt()   — the browser confirmed it received the known
 *                        outcome; clear.
 *
 * The on-disk record holds only `{version, attemptId, resetType, startedAt,
 * status}` — never credentials, provider record ids, request bodies or raw
 * upstream responses. Every failure fails CLOSED: a corrupt or unreadable file
 * is never read as "no record", and a failed clear keeps the record and its
 * spend lock. Nothing in this module can spend a card; it only remembers.
 */

const RECORD_VERSION = 1
const RECORD_STATUSES = new Set(['in-flight', 'unknown', 'known-success', 'known-refused'])
const RECORD_KEYS = new Set(['version', 'attemptId', 'resetType', 'startedAt', 'status'])

/** Distinguishable failure type so the host can map storage trouble to a locked, "storage-unavailable" state. */
export class ManualOutcomeStorageError extends Error {
  constructor(code, cause) {
    super(`manual outcome storage: ${code}`)
    this.name = 'ManualOutcomeStorageError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function isValidRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && value.version === RECORD_VERSION
    && typeof value.attemptId === 'string' && value.attemptId !== ''
    && (value.resetType === 'WEEK' || value.resetType === 'FIVE_HOUR')
    && typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
    && RECORD_STATUSES.has(value.status)
    && Object.keys(value).every((key) => RECORD_KEYS.has(key))
}

/**
 * Create the journal bound to one file path.
 * `path` lives under the plugin's user-data directory; callers pass an
 * isolated test path so tests never touch the real `$DSH_HOME`.
 */
export function createManualOutcomeJournal(path, options = {}) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new TypeError('createManualOutcomeJournal requires a non-empty file path')
  }
  const now = options.now ?? Date.now
  // The attempt begun (and not yet finished) by THIS instance. It keeps a live
  // POST from being "acknowledged" while it is still running, and it lets the
  // same instance report its own in-flight record truthfully while a fresh
  // instance (a restart) projects the same disk state as unknown.
  let activeAttemptId

  /** Read and validate the disk record; `null` only when genuinely absent. */
  function readOnDiskRecord() {
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw new ManualOutcomeStorageError(`unreadable:${error?.code ?? 'unknown'}`, error)
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new ManualOutcomeStorageError('corrupt-record', error)
    }
    if (!isValidRecord(parsed)) throw new ManualOutcomeStorageError('corrupt-record')
    return parsed
  }

  /** The public projection: a record this instance cannot prove is still live reads as unknown. */
  function projected(record) {
    if (record !== null && record.status === 'in-flight' && record.attemptId !== activeAttemptId) {
      return { ...record, status: 'unknown' }
    }
    return record
  }

  function encode(record) {
    return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
  }

  /** fsync the file's directory so the rename/link itself survives a crash; infeasible platforms (e.g. Windows) skip silently. */
  function syncDirectory(directory) {
    let handle
    try {
      handle = openSync(directory, 'r')
      try { fsyncSync(handle) } finally { closeSync(handle) }
    } catch { /* best effort by design */ }
  }

  /** Write the record durably, then hard-link it into place create-if-absent. */
  function persistNew(path_, record) {
    const directory = dirname(path_)
    const tempPath = join(directory, `.manual-outcome-${randomUUID()}.tmp`)
    let handle
    try {
      mkdirMaybe(directory)
      handle = openSync(tempPath, 'wx', 0o600)
      try {
        const buffer = encode(record)
        let offset = 0
        while (offset < buffer.length) offset += writeSync(handle, buffer, offset)
        fsyncSync(handle)
      } finally {
        closeSync(handle)
        handle = undefined
      }
      try {
        linkSync(tempPath, path_)
      } catch (error) {
        cleanupTemp(tempPath)
        if (error?.code === 'EEXIST') throw new ManualOutcomeStorageError('record-exists', error)
        throw new ManualOutcomeStorageError(`write-failed:${error?.code ?? 'unknown'}`, error)
      }
      cleanupTemp(tempPath)
      syncDirectory(directory)
    } catch (error) {
      if (handle !== undefined) { try { closeSync(handle) } catch { /* already closed */ } }
      cleanupTemp(tempPath)
      if (error instanceof ManualOutcomeStorageError) throw error
      throw new ManualOutcomeStorageError(`write-failed:${error?.code ?? 'unknown'}`, error)
    }
  }

  /** Replace the record durably; used for state transitions on a record this attempt already owns. */
  function persistReplace(path_, record) {
    const directory = dirname(path_)
    const tempPath = join(directory, `.manual-outcome-${randomUUID()}.tmp`)
    let handle
    try {
      mkdirMaybe(directory)
      handle = openSync(tempPath, 'wx', 0o600)
      try {
        const buffer = encode(record)
        let offset = 0
        while (offset < buffer.length) offset += writeSync(handle, buffer, offset)
        fsyncSync(handle)
      } finally {
        closeSync(handle)
        handle = undefined
      }
      renameSync(tempPath, path_)
      syncDirectory(directory)
    } catch (error) {
      if (handle !== undefined) { try { closeSync(handle) } catch { /* already closed */ } }
      cleanupTemp(tempPath)
      throw new ManualOutcomeStorageError(`write-failed:${error?.code ?? 'unknown'}`, error)
    }
  }

  function cleanupTemp(tempPath) {
    try { unlinkSync(tempPath) } catch { /* nothing to clean */ }
  }

  function mkdirMaybe(directory) {
    try {
      mkdirSync(directory, { recursive: true })
    } catch (error) {
      throw new ManualOutcomeStorageError(`write-failed:${error?.code ?? 'unknown'}`, error)
    }
  }

  function clearRecord() {
    try {
      unlinkSync(path)
    } catch (error) {
      // A failed clear must keep the record and its spend lock: surface the failure.
      throw new ManualOutcomeStorageError(`clear-failed:${error?.code ?? 'unknown'}`, error)
    }
  }

  return {
    /** `null` when no record exists; otherwise the validated record, with a non-active disk in-flight projected to unknown. Throws on corrupt/unreadable. */
    read() {
      const record = readOnDiskRecord()
      if (record === null && activeAttemptId !== undefined) {
        // We began an attempt and its record vanished: storage cannot be trusted
        // to answer "no record", so refuse instead of unlocking.
        throw new ManualOutcomeStorageError('record-lost')
      }
      return projected(record)
    },

    /** Persist a fresh in-flight record BEFORE the POST. Throws if any unresolved record exists or the write fails. */
    begin({ resetType } = {}) {
      const type = normalizeResetType(resetType)
      if (type === undefined) throw new ManualOutcomeStorageError('invalid-reset-type')
      const existing = readOnDiskRecord()
      if (existing !== null) throw new ManualOutcomeStorageError('record-exists')
      const record = {
        version: RECORD_VERSION,
        attemptId: randomUUID(),
        resetType: type,
        startedAt: now(),
        status: 'in-flight',
      }
      persistNew(path, record)
      activeAttemptId = record.attemptId
      return record
    },

    /** A definitive upstream answer for the live attempt: durable receipt first, clearing happens only via acknowledgeReceipt. */
    finishKnown(attemptId, outcome) {
      if (outcome !== 'success' && outcome !== 'refused') {
        throw new TypeError(`finishKnown outcome must be 'success' or 'refused', got ${String(outcome)}`)
      }
      const record = requireRecord(attemptId)
      if (record.status !== 'in-flight') throw new ManualOutcomeStorageError('invalid-transition')
      const next = { ...record, status: outcome === 'success' ? 'known-success' : 'known-refused' }
      persistReplace(path, next)
      if (activeAttemptId === attemptId) activeAttemptId = undefined
      return next
    },

    /** The POST outcome could not be interpreted: persist unknown and keep the lock. */
    markUnknown(attemptId) {
      const record = requireRecord(attemptId)
      if (record.status !== 'in-flight') throw new ManualOutcomeStorageError('invalid-transition')
      const next = { ...record, status: 'unknown' }
      persistReplace(path, next)
      if (activeAttemptId === attemptId) activeAttemptId = undefined
      return next
    },

    /** The user verified the outcome against the provider: clear an unknown (or restart-leftover in-flight) record. */
    acknowledgeUnknown(attemptId) {
      const record = requireRecord(attemptId)
      if (record.status === 'in-flight' && record.attemptId === activeAttemptId) {
        throw new ManualOutcomeStorageError('invalid-transition')
      }
      if (record.status !== 'unknown' && record.status !== 'in-flight') {
        throw new ManualOutcomeStorageError('invalid-transition')
      }
      clearRecord()
      if (activeAttemptId === attemptId) activeAttemptId = undefined
      return { ok: true }
    },

    /** The browser confirmed it received the known outcome: clear a known receipt only. */
    acknowledgeReceipt(attemptId) {
      const record = requireRecord(attemptId)
      if (record.status !== 'known-success' && record.status !== 'known-refused') {
        throw new ManualOutcomeStorageError('invalid-transition')
      }
      clearRecord()
      if (activeAttemptId === attemptId) activeAttemptId = undefined
      return { ok: true }
    },
  }

  /** The current record must exist and carry exactly this attemptId. */
  function requireRecord(attemptId) {
    if (typeof attemptId !== 'string' || attemptId === '') throw new ManualOutcomeStorageError('attempt-mismatch')
    const record = readOnDiskRecord()
    if (record === null) throw new ManualOutcomeStorageError('no-record')
    if (record.attemptId !== attemptId) throw new ManualOutcomeStorageError('attempt-mismatch')
    return record
  }
}
