/**
 * Small pure helpers: shell quoting, bounded text handling, JSON safety, and
 * redaction. No Harness imports; unit-testable with plain Node.
 *
 * @module dsh-plugin-github-push/util
 */

/**
 * Quote one value for a POSIX shell command string.
 * @param {string} value raw value.
 * @returns {string} single-quoted shell word.
 */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/**
 * Clamp a string and mark truncation instead of silently cutting it.
 * @param {string} text source text.
 * @param {number} maxBytes UTF-8 byte budget.
 * @returns {{ text: string, truncated: boolean }} bounded text.
 */
export function clip(text, maxBytes) {
  const source = String(text ?? '')
  if (Buffer.byteLength(source, 'utf8') <= maxBytes) return { text: source, truncated: false }
  const buffer = Buffer.from(source, 'utf8').subarray(0, Math.max(0, maxBytes))
  return { text: `${buffer.toString('utf8')}\n…[truncated]`, truncated: true }
}

/**
 * Escape a string for a `git log --pretty` / `--format` argument.
 * @param {string} format literal format.
 * @returns {string} shell word.
 */
export function prettyFormat(format) {
  return shellQuote(format)
}

/**
 * Mask token-shaped substrings before text can reach a model, log, or UI.
 * @param {string} text arbitrary command output.
 * @returns {string} text with credential-looking values replaced.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
    .replace(/(https?:\/\/)([^/@\s]+):([^/@\s]+)@/g, '$1[redacted]@')
    .replace(/\b(x-access-token:)[^\s]+/gi, '$1[redacted]')
}

/**
 * Keep a canonical result value within lossless JSON: drop `undefined`
 * object members recursively and replace non-finite numbers with null.
 * @param {unknown} value candidate value.
 * @returns {unknown} JSON-safe value.
 */
export function jsonSafe(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (typeof value === 'object') {
    const out = {}
    for (const [key, member] of Object.entries(value)) {
      if (member === undefined) continue
      out[key] = jsonSafe(member)
    }
    return out
  }
  return null
}

/**
 * Parse integers defensively from command output.
 * @param {string} text digits with surrounding whitespace.
 * @returns {number | undefined} parsed value.
 */
export function parseInteger(text) {
  const match = /^\s*(-?\d+)\s*$/.exec(String(text ?? ''))
  return match === null ? undefined : Number.parseInt(match[1], 10)
}

/**
 * Split NUL-delimited command output into non-empty entries.
 * @param {string} text NUL-delimited output.
 * @returns {string[]} entries.
 */
export function splitNul(text) {
  return String(text ?? '').split('\0').filter(part => part.length > 0)
}

/**
 * Trim a message to a bounded single value, preserving internal newlines.
 * @param {string} value candidate message.
 * @param {number} maxLength characters allowed.
 * @returns {string} trimmed message.
 */
export function normalizeMessage(value, maxLength = 4000) {
  const text = String(value ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

/**
 * Human summary of changed-file counts.
 * @param {{ files: number, insertions: number, deletions: number }} stat staged stat.
 * @returns {string} such as "3 files, +42, -7".
 */
export function describeStat(stat) {
  if (stat.files === 0) return 'no staged changes'
  const insertions = stat.insertions === 0 ? '' : `, +${stat.insertions}`
  const deletions = stat.deletions === 0 ? '' : `, -${stat.deletions}`
  return `${stat.files} file${stat.files === 1 ? '' : 's'}${insertions}${deletions}`
}
