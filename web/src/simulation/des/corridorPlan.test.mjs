import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { applyGateInputs } from '../plan/operatingInputs.ts'

function moduleUrl(path, aliases = {}) {
  const url = new URL(path, import.meta.url)
  const source = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from '([^']+)'/g, (_, path) => `from '${aliases[path] ?? new URL(path + '.ts', url).href}'`)
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

const compiledUrl = moduleUrl('../plan/compile.ts')
const { compileSimulationPlan } = await import(compiledUrl)
const { projectCorridorPlan, applyCorridorCandidate } = await import(moduleUrl('./corridorPlan.ts', { '../plan/compile': compiledUrl }))
const authored = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))
const gateId = 'proposed_gate_plaza_tenggara'
const westId = 'proposed_gate_plaza_barat'
const edits = {
  [gateId]: { lanes: 3, opens: '17:00', closes: '21:00' },
  [westId]: { lanes: 2, opens: '17:15', closes: '20:30' },
}
const active = applyGateInputs(authored, edits, 2)
active.spatial_context.playback.seed = 123456
const projection = projectCorridorPlan({ authoredPlan: authored, activePlan: active, gateId })

test('projects an actual selected route and a deterministic V1 forecourt arrival wave', () => {
  const { document } = projection
  const repeated = projectCorridorPlan({ authoredPlan: authored, activePlan: active, gateId })
  assert.deepEqual(repeated.document, document)
  assert.equal(projection.gateAttendees, 16500)
  assert.equal(projection.startingLanes, 3)
  assert.equal(projection.authoredLanes, 8)
  assert.deepEqual(document.arrivals, { count: 500, start_seconds: 0, end_seconds: projection.sampleEndSeconds - projection.sampleStartSeconds })
  assert.ok(document.arrivals.end_seconds > 0)
  assert.ok(document.horizon_seconds >= document.arrivals.end_seconds && document.horizon_seconds <= 86400)
  assert.deepEqual(document.scan, {
    lanes: 3, physical_slots: 8, available_staff: 8, available_scanners: 8, service_seconds: 9,
    staff_cost_per_lane: { amount: '840000.00', currency: 'IDR' },
    scanner_cost_per_lane: { amount: '250000.00', currency: 'IDR' },
  })
  assert.equal(document.route.nodes[0].id, 'plaza_tenggara_arrival')
  assert.match(document.route.nodes.at(-1).id, /^destination_/)
  assert.ok(document.route.nodes.length <= 32)
  assert.ok(document.route.nodes.slice(1, -1).some(node => node.id === document.route.scan_node_id))
  const compiled = compileSimulationPlan(active)
  const graph = new Map(compiled.nodes.map(node => [node.id, node.position]))
  for (const [index, node] of document.route.nodes.entries()) {
    assert.deepEqual([node.position.x, node.position.y, node.position.z], graph.get(node.id))
    if (index) assert.ok(compiled.edges.some(edge => edge.from === document.route.nodes[index - 1].id && edge.to === node.id))
  }
})

test('reactivates paired lanes from the authored plan and preserves other gate edits and seed', () => {
  const candidate = { ...projection.document, scan: { ...projection.document.scan, lanes: 5 } }
  const applied = applyCorridorCandidate(projection, candidate)
  const gate = id => applied.venue.layout.gates.find(gate => gate.id === id)
  assert.deepEqual([gate(gateId).lanes[0].count, gate(gateId).opens], [5, '17:00'])
  assert.deepEqual([gate(westId).lanes[0].count, gate(westId).opens, gate(westId).closes], [2, '17:15', '20:30'])
  assert.equal(applied.spatial_context.playback.seed, 123456)
  assert.equal(applied.spatial_context.revision, active.spatial_context.revision + 1)
  const compiled = compileSimulationPlan(applied)
  assert.equal(compiled.operators.length, 55)
  assert.equal(compiled.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0), 70000)
  assert.equal(authored.venue.layout.gates[0].lanes[0].count, 8)
  assert.equal(active.venue.layout.gates[0].lanes[0].count, 3)
})

test('rejects unchanged, reduced, beyond-capacity and unsupported returned changes', () => {
  const { document } = projection
  for (const lanes of [2, 3, 4.5, 9]) {
    assert.throws(() => applyCorridorCandidate(projection, { ...document, scan: { ...document.scan, lanes } }), /must add staffed lanes/)
  }
  const unrelated = { ...document, scan: { ...document.scan, lanes: 5, service_seconds: 12 } }
  assert.throws(() => applyCorridorCandidate(projection, unrelated), /changes more than its active scan lanes/)
  const candidate = { ...document, scan: { ...document.scan, lanes: 5 } }
  assert.throws(() => applyCorridorCandidate({ ...projection }, candidate), /original submitted corridor/)
  assert.doesNotThrow(() => applyCorridorCandidate(projection, Object.fromEntries(Object.entries(candidate).reverse())))
})

test('rejects active plans whose non-gate edits are absent from the authored snapshot', () => {
  const stale = structuredClone(active)
  stale.process_steps.steps.find(step => step.id === 'eticket_scan').time_per_person_seconds.typical = 7
  assert.throws(() => projectCorridorPlan({ authoredPlan: authored, activePlan: stale, gateId }), /must match the authored layout/)
})
