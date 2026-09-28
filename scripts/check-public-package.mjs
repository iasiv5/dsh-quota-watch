import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.npm-cache', '.npm-logs'])
const LOCAL_SECRET_FILES = new Set(['.npmrc', '.credentials.yaml', '.credentials.json'])
const SECRET_PATTERNS = [
  ['private-key', /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9_-]{20,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['provider-key-shape', /\b[0-9a-f]{32}\.[A-Za-z0-9_-]{20,}\b/i],
  ['copilot-session-token', /\btid=[0-9a-f]{32};exp=\d{8,};iat=\d{8,}/i],
  ['opaque-session-secret', /\bq_[A-Za-z0-9_-]{32,}\b/],
  ['tavily-key', /\btvly-[A-Za-z0-9_-]{20,}\b/i],
]

export function findSecretRules(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

export function isSensitivePath(path) {
  const name = path.split(/[\\/]/).pop() ?? path
  return LOCAL_SECRET_FILES.has(name)
    || /^\.env(?:\.|$)/.test(name)
    || /^\.credentials(?:\.|$)/i.test(name)
    || /\.(?:bak|log|pem|key)$/i.test(name)
}

async function walk(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) output.push(...await walk(absolute))
    else if (entry.isFile()) output.push(absolute)
  }
  return output
}

function gitFiles() {
  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    // A nested workspace may resolve to an enclosing Git repository. Only trust
    // Git enumeration when the discovered root is this package's own repository.
    if (resolve(gitRoot) !== ROOT) return undefined
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split(/\r?\n/).filter(Boolean).map((path) => resolve(ROOT, path))
  } catch {
    return undefined
  }
}

export function parseNpmPackManifest(output) {
  const parsed = JSON.parse(output)
  const candidates = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {})
  const manifest = candidates.find((candidate) => Array.isArray(candidate?.files))
  if (manifest === undefined) throw new Error('npm pack did not return a file manifest')
  return manifest.files.map((file) => file.path).filter((path) => typeof path === 'string')
}

function npmPackFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=silent'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseNpmPackManifest(output)
}

async function check() {
  const worktreeFiles = gitFiles() ?? await walk(ROOT)
  const findings = []
  for (const absolute of worktreeFiles) {
    const rel = relative(ROOT, absolute)
    if (isSensitivePath(rel)) {
      findings.push({ path: rel, rule: 'sensitive-filename' })
      continue
    }
    try {
      const content = await readFile(absolute)
      if (content.includes(0)) continue
      for (const rule of findSecretRules(content.toString('utf8'))) findings.push({ path: rel, rule })
    } catch {
      findings.push({ path: rel, rule: 'unreadable-public-file' })
    }
  }

  let packFiles
  try {
    packFiles = npmPackFiles()
  } catch {
    findings.push({ path: 'npm pack manifest', rule: 'pack-manifest-unavailable' })
    packFiles = []
  }
  for (const rel of packFiles) {
    if (isSensitivePath(rel)) findings.push({ path: rel, rule: 'sensitive-pack-path' })
    try {
      const content = await readFile(resolve(ROOT, rel))
      if (content.includes(0)) continue
      for (const rule of findSecretRules(content.toString('utf8'))) findings.push({ path: rel, rule: `pack:${rule}` })
    } catch {
      findings.push({ path: rel, rule: 'unreadable-pack-file' })
    }
  }

  if (findings.length > 0) {
    for (const finding of findings) console.error(`${finding.path}: ${finding.rule}`)
    console.error(`public-package security check failed (${findings.length} finding(s)); secret values were not printed`)
    process.exitCode = 1
    return
  }
  console.log(`public-package security check passed (${worktreeFiles.length} worktree file(s), ${packFiles.length} pack file(s))`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await check()
}
