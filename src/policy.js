/**
 * Pure policy helpers: repository-remote parsing, owner allowlists, workspace
 * containment, and staged-path denial. No filesystem or Harness access.
 *
 * @module dsh-plugin-github-push/policy
 */

import path from 'node:path'

/**
 * Parse a Git remote URL into its GitHub coordinates.
 * Supports https, http, ssh, git, and scp-like forms.
 * @param {string} url remote URL.
 * @returns {{ host: string, owner: string, name: string, webUrl: string, httpsUrl: string } | null} coordinates.
 */
export function parseRemote(url) {
  const source = String(url ?? '').trim()
  if (source.length === 0) return null
  let host
  let pathname
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(source)
  if (!source.includes('://') && scp !== null) {
    host = scp[1]
    pathname = scp[2]
  } else {
    let parsed
    try {
      parsed = new URL(source)
    } catch {
      return null
    }
    host = parsed.hostname
    pathname = parsed.pathname
  }
  const parts = pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/')
  if (parts.length < 2) return null
  const owner = parts[0]
  const name = parts.slice(1).join('/')
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null
  const hostname = host.toLowerCase()
  return {
    host: hostname,
    owner,
    name,
    webUrl: `https://${hostname}/${owner}/${name}`,
    httpsUrl: `https://${hostname}/${owner}/${name}.git`,
  }
}

/**
 * Decide whether a host is configured for this plugin.
 * @param {string} host remote hostname.
 * @param {readonly string[]} hosts configured hosts.
 * @returns {boolean} guarded decision.
 */
export function hostAllowed(host, hosts) {
  return hosts.some(entry => entry.toLowerCase() === String(host).toLowerCase())
}

/**
 * Decide whether this plugin may create or push to an owner.
 * An empty allowlist trusts only the signed-in account.
 * @param {string} owner repository owner.
 * @param {readonly string[]} allowedOwners configured allowlist.
 * @param {string} login signed-in GitHub login.
 * @returns {boolean} guarded decision.
 */
export function ownerAllowed(owner, allowedOwners, login) {
  const candidate = String(owner).toLowerCase()
  if (candidate === String(login).toLowerCase()) return true
  return allowedOwners.some(entry => entry.toLowerCase() === candidate)
}

/**
 * Decide whether `target` is `root` or lies inside it, after string
 * normalization. Callers pass real paths where symlinks matter.
 * @param {string} root absolute root.
 * @param {string} target absolute candidate.
 * @returns {boolean} containment.
 */
export function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Convert a simple glob to a regular expression. Supports `*`, `**`, `?`, and
 * character classes are treated literally. Used only when Node lacks
 * `path.matchesGlob`.
 * @param {string} pattern glob pattern.
 * @returns {RegExp} matcher.
 */
function globToRegExp(pattern) {
  let out = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1
        out += '.*'
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${out}$`)
}

/**
 * Test one path against one pattern.
 * @param {string} candidate relative path.
 * @param {string} pattern glob.
 * @returns {boolean} match.
 */
export function matchesGlob(candidate, pattern) {
  if (typeof path.matchesGlob === 'function') {
    return path.matchesGlob(candidate, pattern)
  }
  return globToRegExp(pattern).test(candidate)
}

/**
 * Return the deny pattern a staged path violates, if any.
 * @param {string} relativePath repository-relative path.
 * @param {readonly string[]} denyPaths configured patterns.
 * @param {readonly string[]} allowSecretPaths explicitly allowed paths.
 * @returns {string | undefined} matched pattern.
 */
export function deniedBy(relativePath, denyPaths, allowSecretPaths) {
  const normalized = relativePath.replaceAll('\\', '/')
  const base = normalized.split('/').pop() ?? normalized
  for (const allowed of allowSecretPaths) {
    if (matchesGlob(normalized, allowed) || matchesGlob(base, allowed)) return undefined
  }
  for (const pattern of denyPaths) {
    if (matchesGlob(normalized, pattern) || matchesGlob(base, pattern)) return pattern
  }
  return undefined
}

/**
 * Clean one display-name part into a Git branch segment. Unicode letters such
 * as CJK are kept; separators, control characters, and Git-ref-unsafe
 * sequences become single dashes.
 * @param {string} value raw display-name part.
 * @returns {string} branch-safe segment, possibly empty.
 */
function cleanSegment(value) {
  let text = String(value ?? '').normalize('NFKC')
  text = text.replace(/[\s/\\:*?"'`<>|~^[\]{}]+/g, '-')
  text = text.replace(/\.{2,}/g, '.')
  text = text.replace(/-+/g, '-')
  text = text.replace(/^[-.]+|[-.]+$/g, '')
  text = text.replace(/@\{/g, '-')
  return text.slice(0, 80)
}

/**
 * Sanitize one display name into a Git branch segment.
 * @param {string} value raw display name.
 * @returns {string} branch-safe segment, never empty.
 */
export function branchSegment(value) {
  const text = cleanSegment(value)
  return text.length > 0 ? text : 'project'
}

/**
 * Derive the feature branch for a push made on the default branch.
 *
 * The default naming is `dsh/<Chinese name>/<English name>`: the project's
 * locale titles are joined with `/`, each part is sanitized separately, and a
 * project without locale titles falls back to its package or directory name.
 * No date is included.
 * @param {string} displayName project display name, optionally joined with `/`.
 * @param {string} [prefix] branch prefix.
 * @returns {string} branch name such as `dsh/推送到-GitHub/Push-to-GitHub`.
 */
export function featureBranchName(displayName, prefix = 'dsh') {
  const parts = String(displayName ?? '').split('/').map(cleanSegment).filter(part => part.length > 0)
  return `${prefix}/${parts.length > 0 ? parts.join('/') : 'project'}`
}

/**
 * Derive a GitHub-safe repository name from a directory name.
 * @param {string} directory absolute or plain directory path.
 * @returns {string} sanitized name.
 */
export function repositoryName(directory) {
  const base = path.basename(directory)
  const sanitized = base.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[.-]+/, '').slice(0, 90)
  return sanitized.length > 0 ? sanitized : 'project'
}
