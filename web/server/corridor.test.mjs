import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'
import health from '../api/simulation/corridor/health.js'
import optimize from '../api/simulation/corridor/optimize.js'

const variable = 'OPSIDIO_CORRIDOR_API_KEY'
const oldKey = process.env[variable]
const mockKey = 'fixture-credential'
const site = 'https://opsidio.example.test'
const doni = 'https://opsidio-api-production.up.railway.app'
const document = JSON.parse(readFileSync(new URL('../../api/algorithm/api/examples/corridor-plan.json', import.meta.url), 'utf8'))
document.route.nodes[0].position.x = -0.000001

const id = (prefix, digit) => prefix + digit.repeat(32)
const baselinePlan = {
  id: id('pln_', '1'),
  parent_id: null,
  document,
  // The Python engine serializes this coordinate as -1e-06.
  snapshot_hash: 'ccfc5567f0a2b4de6fbb0e7a3e98c14912a4cdf99d38e9cd98967778e4aaa7c8',
}
const candidate = {
  id: id('pln_', '2'),
  parent_id: baselinePlan.id,
  document: { ...document, scan: { ...document.scan, lanes: 2 } },
  snapshot_hash: 'a5cf80837d7034b209e7e9f72f386b13649adef97fa4db7f7539144ebb00ce28',
}
const run = (plan, digit) => ({
  id: id('run_', digit),
  plan_id: plan.id,
  snapshot_hash: plan.snapshot_hash,
  model_id: 'corridor_v1',
  output: {
    population: { total: 2, admitted: 2, unfinished: 0 }, walking: {},
    scan: { lanes: plan.document.scan.lanes, peak_queue: 1, wait_p90_seconds: 10 },
    costs: {}, checks: {},
  },
})
const baseline = run(baselinePlan, '3')
const best = run(candidate, '4')
const comparison = {
  id: id('opt_', '5'),
  plan_id: baselinePlan.id,
  baseline_run_id: baseline.id,
  best_run_id: best.id,
  candidate_plan_id: candidate.id,
  improved: true,
  stop_reason: 'completed',
  evaluations: [],
}

beforeEach(() => { process.env[variable] = mockKey })
afterEach(() => {
  if (oldKey === undefined) delete process.env[variable]
  else process.env[variable] = oldKey
})

const request = (body = JSON.stringify({ plan: document }), headers = {}) => new Request(
  `${site}/api/simulation/corridor/optimize`,
  { method: 'POST', body, headers: { 'content-type': 'application/json', origin: site, ...headers } },
)

test('hosted health and request guards avoid upstream calls', async ({ mock }) => {
  const upstream = mock.method(globalThis, 'fetch', () => assert.fail('Unexpected upstream call'))
  const healthRequest = new Request(`${site}/api/simulation/corridor/health`)
  const status = await health.fetch(healthRequest).json()
  assert.equal(status.configured, true)
  assert.equal(JSON.stringify(status).includes(mockKey), false)

  assert.equal((await optimize.fetch(request(undefined, { origin: 'https://other.example.test' }))).status, 403)
  assert.equal((await optimize.fetch(request(undefined, { 'content-type': 'text/plain' }))).status, 415)
  assert.equal((await optimize.fetch(request('x'.repeat(32 * 1024 + 1)))).status, 413)
  assert.equal((await optimize.fetch(request('{"plan":1e1000}'))).status, 400)
  assert.equal((await optimize.fetch(request(JSON.stringify({ plan: { ...document, arrivals: { count: 501 } } })))).status, 422)

  delete process.env[variable]
  assert.equal((await health.fetch(healthRequest).json()).configured, false)
  assert.equal((await optimize.fetch(request())).status, 503)
  assert.equal(upstream.mock.callCount(), 0)
})

test('hosted route compares only linked Doni resources and retries with stable keys', async ({ mock }) => {
  const responses = [baselinePlan, comparison, baseline, candidate, best]
  let responseIndex = 0
  const upstream = mock.method(globalThis, 'fetch', async () => Response.json(responses[responseIndex++ % responses.length]))
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await optimize.fetch(request())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { plan: baselinePlan, optimization: comparison, baseline, best, candidate })
  }
  const requests = upstream.mock.calls.map(call => call.arguments)
  assert.deepEqual(requests.slice(0, 5).map(([url]) => url), [
    `${doni}/v3/plans`, `${doni}/v3/plans/${baselinePlan.id}/optimize`,
    `${doni}/v3/runs/${baseline.id}`, `${doni}/v3/plans/${candidate.id}`, `${doni}/v3/runs/${best.id}`,
  ])
  assert.deepEqual(requests[0][1].headers, {
    Accept: 'application/json',
    'X-API-Key': mockKey,
    'Content-Type': 'application/json',
    'Idempotency-Key': `opsidio-corridor-plan-v1-${baselinePlan.snapshot_hash}`,
  })
  assert.equal(requests[0][1].headers['Idempotency-Key'], requests[5][1].headers['Idempotency-Key'])
  assert.equal(requests[1][1].headers['Idempotency-Key'], requests[6][1].headers['Idempotency-Key'])
  assert.ok(requests.every(([, options]) => options.redirect === 'manual'))
})

test('hosted route rejects substituted snapshots and suppresses upstream error contents', async ({ mock }) => {
  const responses = [
    Response.json({ ...baselinePlan, snapshot_hash: '0'.repeat(64) }),
    Response.json({ error: { message: mockKey } }, { status: 422 }),
  ]
  const upstream = mock.method(globalThis, 'fetch', async () => responses.shift())
  const substituted = await optimize.fetch(request())
  assert.equal(substituted.status, 502)
  assert.equal((await substituted.json()).error.code, 'upstream_invalid_response')
  const invalid = await optimize.fetch(request())
  assert.equal(invalid.status, 422)
  assert.equal((await invalid.text()).includes(mockKey), false)
  assert.equal(upstream.mock.callCount(), 2)
})
