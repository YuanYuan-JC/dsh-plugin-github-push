/**
 * Browser-callable routes for the github-push UI. The Client half calls these
 * through the same-origin connection; each route resolves the live Agent for
 * the posted Session and delegates to the shared Host service, so the button
 * and the model tool never maintain separate operation logic.
 *
 * @module dsh-plugin-github-push/routes
 */

import { PushError } from './errors.js'
import { normalizeOptions } from './options.js'

/** Same Session-id shape the Host uses for durable ids. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

/** Largest accepted JSON request body. */
const MAX_BODY_BYTES = 64 * 1024

/** Routes served to the browser half. */
export const ROUTES = Object.freeze({
  plan: '/api/github-push/plan',
  apply: '/api/github-push/apply',
  status: '/api/github-push/status',
  checks: '/api/github-push/checks',
  graph: '/api/github-push/graph',
})

/**
 * Build one JSON response.
 * @param {number} status HTTP status.
 * @param {unknown} payload JSON body.
 * @returns {Response} response.
 */
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Read a JSON object body within the size bound.
 * @param {Request} request incoming request.
 * @returns {Promise<Record<string, unknown> | undefined>} body or undefined when invalid.
 */
async function readBody(request) {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  try {
    const value = await request.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the live Agent for one posted Session id.
 * @param {object} ctx Host context with optional `agents`.
 * @param {unknown} sessionId posted id.
 * @returns {object} live Agent.
 * @throws {PushError} `invalid-session` or `session-not-live`.
 */
function agentFor(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new PushError('invalid-session', 'The request does not name a valid Session id.')
  }
  const agent = ctx.get('agents')?.get?.(sessionId)
  if (agent === undefined || agent === null) {
    throw new PushError('session-not-live', 'That Session is not live in this Host.', 'Open the conversation again, then retry.')
  }
  return agent
}

/**
 * Map one thrown failure to an HTTP status.
 * @param {unknown} error caught failure.
 * @returns {number} status.
 */
function statusOf(error) {
  if (error instanceof PushError) {
    if (error.code === 'invalid-session') return 400
    if (error.code === 'session-not-live') return 409
    return 400
  }
  return 500
}

/**
 * Build the route handler for one operation.
 * @param {object} service github-push service.
 * @param {'plan' | 'apply' | 'status' | 'checks' | 'graph'} action operation to run.
 * @returns {(request: Request) => Promise<Response>} route handler.
 */
function handlerFor(service, action) {
  return async request => {
    const body = await readBody(request)
    if (body === undefined) return json(400, { ok: false, error: 'invalid-body' })
    try {
      const ctx = service.ctx
      const agent = agentFor(ctx, body.sessionId)
      let result
      if (action === 'status' || action === 'checks' || action === 'graph') {
        result = action === 'status'
          ? await service.status(agent)
          : action === 'checks'
            ? await service.checks(agent)
            : await service.graph(agent)
      } else {
        const options = normalizeOptions({ ...body, action })
        result = action === 'plan'
          ? await service.plan(agent, options, request.signal)
          : await service.apply(agent, options, request.signal)
      }
      return json(200, { ok: true, result })
    } catch (error) {
      const failure = error instanceof PushError
        ? { code: error.code, message: error.message, ...error.hint === undefined ? {} : { hint: error.hint } }
        : { code: 'internal', message: error instanceof Error ? error.message : String(error) }
      return json(statusOf(error), { ok: false, error: failure.code, ...failure })
    }
  }
}

/**
 * Register every browser route on the connection service.
 * @param {object} ctx Host context carrying `connection` and `agents`.
 * @param {object} service github-push service.
 * @returns {() => void} disposer removing every route.
 */
export function registerRoutes(ctx, service) {
  const connection = ctx.get('connection')
  if (connection === undefined || connection === null) return () => {}
  const disposers = []
  for (const [action, path] of Object.entries(ROUTES)) {
    disposers.push(connection.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handlerFor(service, /** @type {'plan' | 'apply' | 'status' | 'checks' | 'graph'} */ (action)),
    }))
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // A route already removed by plugin teardown is fine.
      }
    }
  }
}
