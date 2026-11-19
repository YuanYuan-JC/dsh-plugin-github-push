/**
 * Commit-message construction for the push operation. The model or the slash
 * command normally supplies the message; this module only provides a stable
 * deterministic fallback so the operation never blocks on message generation.
 *
 * @module dsh-plugin-github-push/message
 */

import { normalizeMessage } from './util.js'

/**
 * Build the fallback commit subject for one push.
 * @param {{ files: number, branch: string }} input staged file count and branch.
 * @returns {string} one-line commit subject.
 */
export function templateMessage(input) {
  const files = Number(input.files) || 0
  if (files <= 0) return 'chore: sync branch with GitHub'
  const noun = files === 1 ? 'file' : 'files'
  return `chore: update ${files} ${noun}`
}

/**
 * Choose the commit message for a push.
 * @param {{ message?: unknown, files: number, branch: string }} input caller message and staged counts.
 * @returns {string} bounded commit message.
 */
export function chooseMessage(input) {
  const provided = normalizeMessage(input.message)
  if (provided.length > 0) return provided
  return templateMessage({ files: input.files, branch: input.branch })
}

/**
 * Build a pull-request title from the commit subject.
 * @param {string} subject commit subject.
 * @returns {string} PR title, at most 120 characters.
 */
export function prTitle(subject) {
  const text = normalizeMessage(subject, 120)
  return text.length === 0 ? 'Update project from DeepSeek Harness' : text
}

/**
 * Build a pull-request body from the push facts.
 * @param {{ subject: string, stat: { files: number, insertions: number, deletions: number }, branch: string }} input push facts.
 * @returns {string} Markdown body.
 */
export function prBody(input) {
  const { stat } = input
  const lines = [
    'Pushed from DeepSeek Harness.',
    '',
    `- Branch: \`${input.branch}\``,
    `- Files: ${stat.files}`,
    `- Lines: +${stat.insertions} / -${stat.deletions}`,
    '',
    input.subject,
  ]
  return `${lines.join('\n')}\n`
}
