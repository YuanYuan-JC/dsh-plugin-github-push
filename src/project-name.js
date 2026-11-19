/**
 * Project display name discovery for default feature-branch naming.
 *
 * The name prefers the plugin's localized titles (Chinese and English) that a
 * DSH bundle already exports for its Plugins page, then the package name, then
 * the checked-out directory name. Reading is best-effort: a malformed or
 * missing manifest never fails a push.
 *
 * @module dsh-plugin-github-push/project-name
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Read one JSON file without throwing.
 * @param {string} file absolute path.
 * @returns {any | undefined} parsed value when the file is valid JSON.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Read one locale's plugin-page title.
 * @param {string} root project root.
 * @param {string} language locale file stem.
 * @returns {string | null} trimmed title.
 */
function localeTitle(root, language) {
  const value = readJson(path.join(root, 'locale', `${language}.json`))
  const title = value?.meta?.title
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null
}

/**
 * Reduce a value to an ASCII branch slug suitable for a public repository.
 * Non-ASCII names fall back to `project` after this reduction.
 * @param {string} value raw name.
 * @returns {string} lowercase ASCII slug, possibly empty.
 */
export function asciiSlug(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
}

/**
 * Derive the project name used by the default feature branch.
 *
 * `public` naming (the default) is an ASCII slug from the package name and
 * suits public repositories; `bilingual` keeps the plugin-page Chinese and
 * English titles joined with `/` for personal projects.
 * @param {string} root project root.
 * @param {'public' | 'bilingual'} [naming] naming strategy.
 * @returns {string} display name, never empty.
 */
export function projectDisplayName(root, naming = 'public') {
  if (naming === 'bilingual') {
    const zh = localeTitle(root, 'zh')
    const en = localeTitle(root, 'en')
    if (zh !== null && en !== null) return `${zh}/${en}`
    if (zh !== null) return zh
    if (en !== null) return en
  }
  const pkg = readJson(path.join(root, 'package.json'))
  if (typeof pkg?.name === 'string' && pkg.name.trim().length > 0) {
    const name = pkg.name.trim()
    const slash = name.lastIndexOf('/')
    const unscoped = slash === -1 ? name : name.slice(slash + 1)
    const withoutPluginPrefix = unscoped.startsWith('dsh-plugin-') ? unscoped.slice('dsh-plugin-'.length) : unscoped
    const slug = asciiSlug(withoutPluginPrefix)
    if (slug.length > 0) return slug
  }
  const slug = asciiSlug(path.basename(root))
  return slug.length > 0 ? slug : 'project'
}
