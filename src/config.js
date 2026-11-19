/**
 * Effective configuration for one github-push plugin row. The plugin keeps all
 * tunables here so the tool, command, and service share one validated view.
 *
 * @module dsh-plugin-github-push/config
 */

/** Default deny patterns checked against staged paths before a commit. */
export const DEFAULT_DENY_PATHS = Object.freeze([
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  'id_rsa*',
  'id_ed25519*',
  '.npmrc',
  '.netrc',
  'credentials.json',
])

/** Defaults applied when the bundle row carries no override. */
export const DEFAULT_CONFIG = Object.freeze({
  hosts: Object.freeze(['github.com']),
  ghCommand: 'gh',
  gitCommand: 'git',
  remoteName: 'origin',
  initRepo: true,
  createRemote: true,
  visibility: 'private',
  branchPolicy: 'feature',
  branchNaming: 'public',
  createPullRequest: true,
  draftPullRequest: false,
  commitMode: 'all',
  configureIdentity: true,
  secretScan: true,
  denyPaths: DEFAULT_DENY_PATHS,
  allowSecretPaths: Object.freeze([]),
  allowedOwners: Object.freeze([]),
  timeoutMs: 120000,
  pushTimeoutMs: 180000,
  maxOutputBytes: 1048576,
})

/**
 * Read a boolean override.
 * @param {unknown} value candidate.
 * @param {boolean} fallback default.
 * @returns {boolean} effective value.
 */
function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Read a positive integer override.
 * @param {unknown} value candidate.
 * @param {number} fallback default.
 * @returns {number} effective value.
 */
function positive(value, fallback) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/**
 * Read a string override.
 * @param {unknown} value candidate.
 * @param {string} fallback default.
 * @returns {string} effective value.
 */
function text(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

/**
 * Read a string-array override.
 * @param {unknown} value candidate.
 * @param {readonly string[]} fallback default.
 * @returns {string[]} effective value.
 */
function strings(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const kept = value.filter(entry => typeof entry === 'string' && entry.trim().length > 0).map(entry => entry.trim())
  return kept.length > 0 ? kept : [...fallback]
}

/**
 * Merge a raw bundle-row config with the defaults.
 * @param {unknown} raw row config, possibly absent.
 * @returns {{ config: object, warnings: string[] }} effective config and validation notes.
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const warnings = []
  const visibility = text(input.visibility, DEFAULT_CONFIG.visibility).toLowerCase()
  if (visibility !== 'private' && visibility !== 'public') {
    warnings.push(`visibility "${visibility}" is not private/public; using private`)
  }
  const branchPolicy = text(input.branchPolicy, DEFAULT_CONFIG.branchPolicy)
  if (branchPolicy !== 'current' && branchPolicy !== 'feature') {
    warnings.push(`branchPolicy "${branchPolicy}" is not current/feature; using feature`)
  }
  const branchNaming = text(input.branchNaming, DEFAULT_CONFIG.branchNaming)
  if (branchNaming !== 'public' && branchNaming !== 'bilingual') {
    warnings.push(`branchNaming "${branchNaming}" is not public/bilingual; using public`)
  }
  const commitMode = text(input.commitMode, DEFAULT_CONFIG.commitMode)
  if (commitMode !== 'all' && commitMode !== 'staged') {
    warnings.push(`commitMode "${commitMode}" is not all/staged; using all`)
  }
  const config = {
    hosts: strings(input.hosts, DEFAULT_CONFIG.hosts).map(host => host.toLowerCase()),
    ghCommand: text(input.ghCommand, DEFAULT_CONFIG.ghCommand),
    gitCommand: text(input.gitCommand, DEFAULT_CONFIG.gitCommand),
    remoteName: text(input.remoteName, DEFAULT_CONFIG.remoteName),
    initRepo: bool(input.initRepo, DEFAULT_CONFIG.initRepo),
    createRemote: bool(input.createRemote, DEFAULT_CONFIG.createRemote),
    visibility: visibility === 'public' ? 'public' : 'private',
    branchPolicy: branchPolicy === 'current' ? 'current' : 'feature',
    branchNaming: branchNaming === 'bilingual' ? 'bilingual' : 'public',
    createPullRequest: bool(input.createPullRequest, DEFAULT_CONFIG.createPullRequest),
    draftPullRequest: bool(input.draftPullRequest, DEFAULT_CONFIG.draftPullRequest),
    commitMode: commitMode === 'staged' ? 'staged' : 'all',
    configureIdentity: bool(input.configureIdentity, DEFAULT_CONFIG.configureIdentity),
    secretScan: bool(input.secretScan, DEFAULT_CONFIG.secretScan),
    denyPaths: strings(input.denyPaths, DEFAULT_CONFIG.denyPaths),
    allowSecretPaths: Array.isArray(input.allowSecretPaths)
      ? input.allowSecretPaths.filter(entry => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    allowedOwners: Array.isArray(input.allowedOwners)
      ? input.allowedOwners
        .filter(entry => typeof entry === 'string' && entry.trim().length > 0)
        .map(entry => entry.trim().toLowerCase())
      : [],
    timeoutMs: positive(input.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    pushTimeoutMs: positive(input.pushTimeoutMs, DEFAULT_CONFIG.pushTimeoutMs),
    maxOutputBytes: positive(input.maxOutputBytes, DEFAULT_CONFIG.maxOutputBytes),
  }
  return { config, warnings }
}
