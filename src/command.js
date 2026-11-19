/**
 * Human-facing `/github-push` slash command. It runs the same Host service as
 * the model tool without creating a model request, so a push costs no model
 * tokens and depends on no model decision.
 *
 * @module dsh-plugin-github-push/command
 */

import { describeFailure } from './errors.js'
import { optionsFromCommand } from './options.js'
import { summarizeResult } from './service.js'

/**
 * Build the command definition for one service instance.
 * @param {import('./service.js').GithubPushService} service shared service.
 * @returns {object} command definition.
 */
export function createCommand(service) {
  return {
    name: 'github-push',
    description: 'Commit and push the current project to GitHub only when you ask, creating the repository and pull request when needed',
    input: { hint: 'Optional commit message, for example: fix: repair the login callback' },
    async handler(invocation) {
      const options = optionsFromCommand(invocation.rawInput)
      try {
        const result = await service.apply(invocation.agent, options, invocation.signal)
        if (result.ok === true) return { kind: 'success', text: summarizeResult(result) }
        return { kind: 'error', text: `GitHub push failed (${result.stage ?? 'unknown stage'}): ${describeFailure(result.error)}` }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'error', text: `GitHub push failed: ${message}` }
      }
    },
  }
}
