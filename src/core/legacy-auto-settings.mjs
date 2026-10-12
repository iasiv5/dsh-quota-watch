import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
 * One-shot retirement of the legacy automatic card-use authorization.
 *
 * The pre-retirement plugin stored its panel switches in
 * `$DSH_HOME/glm-quota-reset/settings.json` as
 * `{ autoReset: { fiveHour: { enabled, threshold }, week: { enabled, threshold } } }`,
 * and a saved file won over the profile config on every boot. Retiring the
 * feature therefore must persistently force both switches to `enabled:false`:
 * if the file were merely ignored, rolling the package back to an old version
 * would silently revive an authorization the user no longer has.
 *
 * Failure direction is always "off": a missing or corrupt file is rebuilt
 * all-off, and a write that cannot be completed is reported as a classified
 * failure instead of being claimed as deactivated. This module has no ability
 * to enable anything anywhere.
 */

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/**
 * Retire the saved switches at `path`.
 * Idempotent; preserves every non-authorization field (thresholds, metadata) it
 * can read; recovers a corrupt/unreadable file to an all-off document.
 * Returns `{ ok: true }` or `{ ok: false, error: '<classification>' }` — it
 * never throws for an environment problem and never reports success without a
 * completed atomic replace.
 */
export function retireLegacyAutoResetSettings(path) {
  if (typeof path !== 'string' || path.trim() === '') return { ok: false, error: 'invalid-path' }
  let original
  try {
    original = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Missing (ENOENT) or corrupt/unreadable: rebuild from scratch. Both shapes
    // fail closed to both switches off.
    original = undefined
  }
  const base = asRecord(original) ?? {}
  const saved = asRecord(base.autoReset) ?? {}
  // Only the two switches are the authorization; anything else in the window
  // records (e.g. thresholds) is inert and kept for transparency.
  const window = (entry) => ({ ...(asRecord(entry) ?? {}), enabled: false })
  const document = {
    ...base,
    autoReset: { ...saved, fiveHour: window(saved.fiveHour), week: window(saved.week) },
  }
  const directory = dirname(path)
  const tempPath = join(directory, `.quota-reset-retire-${randomUUID()}.tmp`)
  try {
    mkdirSync(directory, { recursive: true })
    // Atomic replace: write a fresh temp file (mode 0600 on POSIX at creation;
    // on Windows mode is ignored and the file inherits the user profile's ACLs,
    // which is that platform's equivalent restriction), then rename over the
    // target so no crash can leave a half-written switch file behind.
    writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(tempPath, path)
    return { ok: true }
  } catch (error) {
    try { unlinkSync(tempPath) } catch { /* temp file was never created */ }
    return { ok: false, error: classifyWriteError(error) }
  }
}

/** Stable classification for the caller's log; the caller must not re-enable anything on failure. */
function classifyWriteError(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code === 'ENOTDIR' || code === 'EISDIR' || code === 'EEXIST' || code === 'EINVAL') return `invalid-path:${code}`
  if (code !== '') return `write-failed:${code}`
  return 'write-failed'
}
