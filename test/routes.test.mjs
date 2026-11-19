import assert from 'node:assert/strict'
import test from 'node:test'

import { ROUTES, registerRoutes } from '../src/routes.js'

/**
 * Build a fake Host context that records registered route handlers.
 * @param {{ agent?: object | null, connection?: boolean }} [options] context facts.
 * @returns {{ ctx: object, handlers: Map<string, Function> }} context and handlers.
 */
function fakeContext(options = {}) {
  const handlers = new Map()
  const agent = options.agent === undefined ? { id: 'session-test' } : options.agent
  const ctx = {
    get(key) {
      if (key === 'connection') {
        if (options.connection === false) return undefined
        return {
          fetch: {
            register(route) {
              handlers.set(route.path, route.fetch)
              return () => handlers.delete(route.path)
            },
          },
        }
      }
      if (key === 'agents') {
        return { get: id => (id === 'session-test' ? agent : undefined) }
      }
      return undefined
    },
  }
  return { ctx, handlers }
}

/**
 * Build one JSON POST request for a route.
 * @param {string} path route path.
 * @param {unknown} body request body.
 * @returns {Request} request.
 */
function post(path, body) {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Create a fake service recording calls.
 * @returns {{ service: object, calls: object[] }} service and call log.
 */
function fakeService() {
  const calls = []
  const service = {
    ctx: undefined,
    async plan(agent, options) {
      calls.push({ op: 'plan', agent, options })
      return { ok: true, action: 'plan', branch: 'main' }
    },
    async apply(agent, options) {
      calls.push({ op: 'apply', agent, options })
      return { ok: true, action: 'apply', branch: 'main' }
    },
    async status(agent) {
      calls.push({ op: 'status', agent })
      return { ok: true, action: 'status', branch: 'main', changeRequests: [] }
    },
    async checks(agent) {
      calls.push({ op: 'checks', agent })
      return { ok: true, action: 'checks', checks: { state: 'none' } }
    },
    async graph(agent) {
      calls.push({ op: 'graph', agent })
      return { ok: true, action: 'graph', commits: [] }
    },
  }
  return { service, calls }
}

test('routes register five browser endpoints and dispatch to the service', async () => {
  const { ctx, handlers } = fakeContext()
  const { service, calls } = fakeService()
  service.ctx = ctx
  const dispose = registerRoutes(ctx, service)
  assert.deepEqual([...handlers.keys()].sort(), Object.values(ROUTES).sort())

  const planResponse = await handlers.get(ROUTES.plan)(post(ROUTES.plan, { sessionId: 'session-test', action: 'apply' }))
  assert.equal(planResponse.status, 200)
  const planBody = await planResponse.json()
  assert.equal(planBody.ok, true)
  assert.equal(planBody.result.action, 'plan')
  assert.equal(calls[0].op, 'plan')
  assert.equal(calls[0].options.action, 'plan')

  const applyResponse = await handlers.get(ROUTES.apply)(post(ROUTES.apply, { sessionId: 'session-test', message: 'feat: x' }))
  assert.equal(applyResponse.status, 200)
  const applyBody = await applyResponse.json()
  assert.equal(applyBody.result.action, 'apply')
  assert.equal(calls[1].op, 'apply')
  assert.equal(calls[1].options.message, 'feat: x')

  const statusResponse = await handlers.get(ROUTES.status)(post(ROUTES.status, { sessionId: 'session-test' }))
  assert.equal(statusResponse.status, 200)
  assert.equal((await statusResponse.json()).result.action, 'status')
  assert.equal(calls[2].op, 'status')

  const checksResponse = await handlers.get(ROUTES.checks)(post(ROUTES.checks, { sessionId: 'session-test' }))
  assert.equal(checksResponse.status, 200)
  assert.equal((await checksResponse.json()).result.action, 'checks')
  assert.equal(calls[3].op, 'checks')

  const graphResponse = await handlers.get(ROUTES.graph)(post(ROUTES.graph, { sessionId: 'session-test' }))
  assert.equal(graphResponse.status, 200)
  assert.equal((await graphResponse.json()).result.action, 'graph')
  assert.equal(calls[4].op, 'graph')

  dispose()
  assert.equal(handlers.size, 0)
})

test('routes reject invalid bodies and unknown sessions', async () => {
  const { ctx, handlers } = fakeContext()
  const { service } = fakeService()
  service.ctx = ctx
  registerRoutes(ctx, service)

  const badBody = new Request(`http://127.0.0.1${ROUTES.plan}`, { method: 'POST', body: 'not-json' })
  assert.equal((await handlers.get(ROUTES.plan)(badBody)).status, 400)

  const badSession = await handlers.get(ROUTES.plan)(post(ROUTES.plan, { sessionId: '../escape' }))
  assert.equal(badSession.status, 400)

  const missingAgent = await handlers.get(ROUTES.plan)(post(ROUTES.plan, { sessionId: 'session-other' }))
  assert.equal(missingAgent.status, 409)
  const missingBody = await missingAgent.json()
  assert.equal(missingBody.error, 'session-not-live')
})

test('routes stay unregistered without a connection service', () => {
  const { ctx, handlers } = fakeContext({ connection: false })
  const { service } = fakeService()
  service.ctx = ctx
  const dispose = registerRoutes(ctx, service)
  assert.equal(handlers.size, 0)
  dispose()
})
