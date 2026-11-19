/**
 * Model-facing `github_push` tool: the only model path that can commit and
 * push. Full behavior lives in the shared service; this module owns the wire
 * schema, argument validation, and model-facing rendering.
 *
 * @module dsh-plugin-github-push/tool
 */

import { normalizeOptions } from './options.js'
import { summarizeResult } from './service.js'

/** Model-facing description; the first sentence states the explicit-use contract. */
const DESCRIPTION = [
  'Commit the current project and push it to GitHub. Call this only when the user explicitly asks to push the project or a branch to GitHub; never call it automatically after editing files.',
  'The call surveys the working tree, creates exactly one commit when there are changes, initializes the repository when needed, creates the GitHub repository and origin remote when needed, pushes the checked-out branch, opens a pull request when the branch is not the default branch, and binds that pull request to this conversation for tracking.',
  'On the repository default branch, pass branchPolicy "feature" to create a dsh/<package-name> branch first so a pull request can be opened; the result reports the combined checks of the pushed commit. Pass tag to create and push an annotated tag on the pushed commit, and release (default true with tag) to create the GitHub release; set release false for a tag-only push.',
  'Use action "plan" to preview, "status" to read the change requests bound to this conversation plus the checked-out commit checks, or "apply" (default) to commit and push. Repeating an apply is safe: it does not create a second commit for the same changes.',
].join(' ')

/**
 * Build the tool definition for one service instance.
 * @param {import('./service.js').GithubPushService} service shared service.
 * @returns {object} raw ToolDefinition.
 */
export function createTool(service) {
  return {
    name: 'github_push',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'apply', 'status'],
          description: 'plan previews without writing; apply commits and pushes; status lists the change requests bound to this conversation.',
        },
        message: {
          type: 'string',
          description: 'Commit message for this push. Write a Conventional-Commits style subject and an optional body; when omitted a deterministic fallback subject is used.',
        },
        repo: {
          type: 'string',
          description: 'Target repository as owner/name. Omit to use the existing origin remote, or the signed-in account with the project directory name when creating a repository.',
        },
        visibility: {
          type: 'string',
          enum: ['private', 'public'],
          description: 'Visibility for a repository this call creates. Defaults to private; public must be explicit.',
        },
        branch: {
          type: 'string',
          description: 'Branch to push. Defaults to the checked-out branch; required when HEAD is detached (the branch is then created at HEAD).',
        },
        createPr: {
          type: 'boolean',
          description: 'Whether to create or reuse a pull request when the branch is not the default branch. Defaults to the plugin configuration (feature).',
        },
        draft: {
          type: 'boolean',
          description: 'Create the pull request as a draft.',
        },
        tag: {
          type: 'string',
          description: 'Optional Git tag to create at the pushed commit, for example v1.2.0. The tag is pushed to the remote checkout.',
        },
        tagMessage: {
          type: 'string',
          description: 'Annotated tag message. Defaults to the commit subject when omitted.',
        },
        release: {
          type: 'boolean',
          description: 'Create a GitHub release for the pushed tag. Defaults to true when tag is set; set false to push the tag only.',
        },
        branchPolicy: {
          type: 'string',
          enum: ['current', 'feature'],
          description: 'Branch strategy for a push made on the repository default branch: current pushes it directly, feature first creates a dsh/<package-name> branch so a pull request can be opened. Defaults to the plugin configuration (feature).',
        },
        force: {
          type: 'boolean',
          description: 'Push with --force-with-lease. Defaults to false; plain force is never used.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Alias for action "plan".',
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: summarizeResult(value) }]
      },
    },
    timeoutMs: 240000,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('github_push needs a calling Session')
      const options = normalizeOptions(args)
      if (options.action === 'plan') return service.plan(exec.agent, options, exec.signal)
      if (options.action === 'status') return service.status(exec.agent)
      return service.apply(exec.agent, options, exec.signal)
    },
  }
}
