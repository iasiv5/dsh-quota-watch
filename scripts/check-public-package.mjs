import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.npm-cache', '.npm-logs'])
const LOCAL_SECRET_FILES = new Set(['.npmrc', '.credentials.yaml', '.credentials.json'])
/**
 * 主人核准的公开提交身份（2026-10-24 裁决：`iasi@163.com` 是有意的公开邮箱）。
 * 门禁语义从「仅 GitHub noreply」放宽为「noreply 或本名单」——两台发版机
 * （web 机 noreply / Windows 机 163）从此同一口径，发布不再需要改写身份。
 */
const APPROVED_PUBLIC_EMAILS = new Set(['iasi@163.com'])
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

export function isGitHubNoreplyEmail(value) {
  return typeof value === 'string' && /^[^@\s]+@users\.noreply\.github\.com$/i.test(value)
}

/** 提交元数据门禁的核准身份：GitHub noreply，或主人核准的公开邮箱（APPROVED_PUBLIC_EMAILS）。 */
export function isApprovedCommitEmail(value) {
  return isGitHubNoreplyEmail(value) || (typeof value === 'string' && APPROVED_PUBLIC_EMAILS.has(value.trim().toLowerCase()))
}

function currentGitRoot() {
  try {
    const output = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return resolve(output.trim())
  } catch {
    return undefined
  }
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
  if (currentGitRoot() !== ROOT) return undefined
  try {
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

function commitMetadataFinding() {
  if (currentGitRoot() !== ROOT) return undefined
  try {
    const output = execFileSync('git', ['log', '--format=%ae%n%ce'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const emails = output.split(/\r?\n/).filter(Boolean)
    return emails.some((email) => !isApprovedCommitEmail(email))
      ? { path: 'Git commit metadata', rule: 'unapproved-public-identity' }
      : undefined
  } catch {
    return { path: 'Git commit metadata', rule: 'metadata-unavailable' }
  }
}

/** Match one package.json `files` entry (exact path, directory, or glob) against a repo-relative path. */
export function filePatternMatcher(pattern) {
  if (!/[*?]/.test(pattern)) {
    return (rel) => rel === pattern || rel.startsWith(`${pattern}/`)
  }
  const regex = new RegExp(`^${pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')}$`)
  return (rel) => regex.test(rel)
}

/** Derive the would-be npm pack file list from the package.json `files` allowlist.
 * npm ≥11 emits no manifest at all for `pack --dry-run --ignore-scripts` (the only
 * way to run pack inside this check without recursing through prepack), so the list
 * is derived offline instead. Scanning a superset is safe: the worktree scan above
 * already covers every file. */
export function derivePackFiles(worktreeFiles, pkg) {
  const patterns = [
    ...(Array.isArray(pkg?.files) ? pkg.files : []),
    'package.json',
    'README.md',
    'LICENSE',
  ]
  const matchers = patterns.map(filePatternMatcher)
  return worktreeFiles
    .map((absolute) => (isAbsolute(absolute) ? relative(ROOT, absolute) : absolute))
    .filter((rel) => matchers.some((matcher) => matcher(rel)))
}

async function check() {
  const worktreeFiles = gitFiles() ?? await walk(ROOT)
  const findings = []
  const metadataFinding = commitMetadataFinding()
  if (metadataFinding !== undefined) findings.push(metadataFinding)
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
    const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'))
    packFiles = derivePackFiles(worktreeFiles, pkg)
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
