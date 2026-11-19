/**
 * Host half of the github-push bundle.
 *
 * Exposes one explicit operation to three callers: the model-facing
 * `github_push` tool, the human `/github-push` command, and the composer
 * button served by the Client half through same-origin routes. All of them
 * call the same Host service. No timer, hook, or turn listener commits
 * anything: a commit is produced only while handling an explicit push
 * request.
 *
 * @module dsh-plugin-github-push
 */

import { createCommand } from './src/command.js'
import { registerRoutes } from './src/routes.js'
import { GithubPushService } from './src/service.js'
import { createTool } from './src/tool.js'

export const name = 'github-push'

/** Services required before this plugin activates. */
export const inject = ['tools', 'commands', 'shell']

/**
 * Register the tool, the command, and the browser routes for this plugin fiber.
 * @param {object} ctx Cordis plugin context.
 * @param {unknown} [config] bundle-row configuration.
 * @returns {void}
 */
export function apply(ctx, config) {
  const service = new GithubPushService(ctx, config)
  ctx.effect(() => ctx.tools.register(createTool(service)))
  ctx.effect(() => ctx.commands.register(createCommand(service)))
  ctx.inject(['connection'], scope => {
    scope.effect(() => registerRoutes(scope, service), 'github-push: browser routes')
  })
}
