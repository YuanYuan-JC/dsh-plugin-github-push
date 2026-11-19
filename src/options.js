/**
 * Validation and normalization of the model/tool and slash-command inputs.
 * Raw JSON-Schema tools own their input validation, so this module checks
 * every field the tool schema declares.
 *
 * @module dsh-plugin-github-push/options
 */

import { normalizeMessage } from './util.js'

/**
 * Validate a boolean option.
 * @param {unknown} value candidate.
 * @param {string} name field name.
 * @returns {boolean | undefined} effective value.
 */
function optionalBoolean(value, name) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

/**
 * Validate a string option.
 * @param {unknown} value candidate.
 * @param {string} name field name.
 * @returns {string | undefined} effective value.
 */
function optionalString(value, name) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  const text = value.trim()
  return text.length === 0 ? undefined : text
}

/**
 * Normalize one tool invocation's arguments.
 * @param {unknown} input raw model arguments.
 * @returns {{ action: 'plan' | 'apply' | 'status', message?: string, repo?: string, visibility?: 'private' | 'public', branch?: string, createPr?: boolean, draft?: boolean, force?: boolean }} options.
 */
export function normalizeOptions(input) {
  const args = input !== null && typeof input === 'object' ? input : {}
  const dryRun = optionalBoolean(args.dryRun, 'dryRun')
  const requestedAction = optionalString(args.action, 'action') ?? (dryRun === true ? 'plan' : 'apply')
  if (requestedAction !== 'plan' && requestedAction !== 'apply' && requestedAction !== 'status') {
    throw new Error('action must be one of plan, apply, status')
  }
  const message = optionalString(args.message, 'message')
  const repo = optionalString(args.repo, 'repo')
  const visibility = optionalString(args.visibility, 'visibility')
  if (visibility !== undefined && visibility !== 'private' && visibility !== 'public') {
    throw new Error('visibility must be private or public')
  }
  const branch = optionalString(args.branch, 'branch')
  if (branch !== undefined && (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..'))) {
    throw new Error('branch must be a plain branch name')
  }
  const options = { action: dryRun === true ? 'plan' : requestedAction }
  if (message !== undefined) options.message = normalizeMessage(message)
  if (repo !== undefined) options.repo = repo
  if (visibility !== undefined) options.visibility = visibility
  if (branch !== undefined) options.branch = branch
  const createPr = optionalBoolean(args.createPr, 'createPr')
  if (createPr !== undefined) options.createPr = createPr
  const tag = optionalString(args.tag, 'tag')
  if (tag !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(tag) || tag.includes('..') || tag.endsWith('/') || tag.endsWith('.lock')) {
      throw new Error('tag must be a simple ASCII tag name without spaces, "..", or a leading "-"')
    }
    options.tag = tag
  }
  const tagMessage = optionalString(args.tagMessage, 'tagMessage')
  if (tagMessage !== undefined) options.tagMessage = normalizeMessage(tagMessage)
  const release = optionalBoolean(args.release, 'release')
  if (release !== undefined) options.release = release

  const branchPolicy = optionalString(args.branchPolicy, 'branchPolicy')
  if (branchPolicy !== undefined) {
    if (branchPolicy !== 'current' && branchPolicy !== 'feature') {
      throw new Error('branchPolicy must be current or feature')
    }
    options.branchPolicy = branchPolicy
  }
  const draft = optionalBoolean(args.draft, 'draft')
  if (draft !== undefined) options.draft = draft
  const force = optionalBoolean(args.force, 'force')
  if (force !== undefined) options.force = force
  return options
}

/**
 * Build options for a slash-command invocation. Human input is free text and
 * becomes the commit message; dangerous flags stay at their configured defaults.
 * @param {unknown} rawInput text after the command name.
 * @returns {{ action: 'apply', message?: string }} options.
 */
export function optionsFromCommand(rawInput) {
  const text = typeof rawInput === 'string' ? normalizeMessage(rawInput) : ''
  return text.length === 0 ? { action: 'apply' } : { action: 'apply', message: text }
}
