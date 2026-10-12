import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { createQuotaService } from '../../src/host.mjs'

/**
 * The ONLY test-side way to build a quota service (statically guarded by
 * tests/package-shape.test.mjs).
 *
 * Every construction gets a fresh private temp directory, and the service's
 * user-data paths (`legacyAutoSettingsPath`, `manualOutcomePath`) are injected
 * into it — so the start()-time legacy-settings migration and the manual
 * outcome journal can never touch the real `$DSH_HOME` from a test.
 *
 * Cases that must rebuild a service against shared durable state create their
 * own temp paths and pass them explicitly via `options.legacyAutoSettingsPath`
 * / `options.manualOutcomePath`; everything else stays per-instance isolated.
 * All temp directories are removed after the importing test file finishes.
 */

const homes = []

export function createIsolatedQuotaService(ctx, options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'quota-watch-service-'))
  homes.push(home)
  return createQuotaService(ctx, {
    ...options,
    legacyAutoSettingsPath: options.legacyAutoSettingsPath ?? join(home, 'glm-quota-reset', 'settings.json'),
    manualOutcomePath: options.manualOutcomePath ?? join(home, 'glm-quota-reset', 'manual-outcome.json'),
  })
}

/** Remove every per-construction temp directory; also registered as a file-level after() hook. */
export function cleanupIsolatedServiceHomes() {
  while (homes.length > 0) rmSync(homes.pop(), { recursive: true, force: true })
}

after(cleanupIsolatedServiceHomes)
