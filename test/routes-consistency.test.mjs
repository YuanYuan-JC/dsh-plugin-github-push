import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { ROUTES } from '../src/routes.js'

test('the browser half declares every Host route it calls', () => {
  const client = fs.readFileSync(path.join(import.meta.dirname, '..', 'client.js'), 'utf8')
  for (const [action, route] of Object.entries(ROUTES)) {
    assert.ok(client.includes(`'${route}'`), `client.js is missing the ${action} route ${route}`)
  }
  // The Client must never build a request for a route the Host does not serve.
  const referenced = [...client.matchAll(/'(\/api\/github-push\/[a-z-]+)'/g)].map(match => match[1])
  assert.deepEqual([...new Set(referenced)].sort(), [...new Set(Object.values(ROUTES))].sort())
})
