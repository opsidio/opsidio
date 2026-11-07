import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import demo from '../../../../contracts/examples/coldplay-gbk-demo-plan.json' with { type: 'json' }

registerHooks({
  resolve(specifier, context, next) {
    const name = specifier.split('/').at(-1)
    if (specifier.startsWith('.') && !name.includes('.') && context.parentURL?.endsWith('.ts')) return next(`${specifier}.ts`, context)
    return next(specifier, context)
  },
})

const { expansionPlans } = await import('./entranceExpansion.ts')
const { optimizeEntrance } = await import('./entranceExpansion.worker.ts')
const { editableGates, applyGateInputs } = await import('./operatingInputs.ts')
const { projectExpansionCorridor } = await import('../des/corridorPlan.ts')

const west = 'proposed_gate_plaza_barat'
const southeast = 'proposed_gate_plaza_tenggara'
const gate = (plan, id) => editableGates(plan).find(gate => gate.id === id)

test('finds and simulates wider layouts starting at a fully staffed Plaza Barat', () => {
  const result = optimizeEntrance({ activePlan: demo, authoredPlan: demo, gateId: west })
  assert.deepEqual(result.proposals.map(item => item.lanes), [5, 6])
  const candidate = result.proposals.find(item => item.lanes === result.recommendedLanes)
  assert.ok(candidate.metrics.admittedByShowtime > result.baseline.admittedByShowtime)
  assert.equal(candidate.metrics.arrivals, result.baseline.arrivals)
  assert.equal(gate(demo, west).lanes, 4)
  assert.equal(gate(candidate.plan, west).lanes, candidate.lanes)
  assert.equal(candidate.staffAdded, 2 * (candidate.lanes - 4))
  assert.ok(candidate.extraWidthM > 0)
  assert.ok(candidate.review.some(item => item.includes('recorded stock')))
  assert.deepEqual(candidate.plan.behavior_context, demo.behavior_context)
  assert.deepEqual(gate(candidate.plan, southeast), gate(demo, southeast))
})

test('evaluates smaller steps for an imported plan with fewer staffed lanes', () => {
  const baseline = applyGateInputs(demo, { [west]: { ...gate(demo, west), lanes: 2, opens: '16:00' } }, 1)
  const { proposals, skipped } = expansionPlans(baseline, baseline, west)
  assert.deepEqual(skipped, [])
  assert.deepEqual(proposals.map(item => item.lanes), [3, 4, 5, 6])
  assert.equal(gate(proposals[0].plan, west).opens, '16:00')
  assert.equal(proposals[0].extraWidthM, 0)
})

test('projects a proposal over eight lanes to Doni without cutting the arrival count', () => {
  const { proposals } = expansionPlans(demo, demo, southeast)
  const proposal = proposals.find(item => item.lanes === 10)
  const { document, gateAttendees } = projectExpansionCorridor(demo, demo, southeast, proposal.plan)
  assert.equal(document.scan.lanes, 8)
  assert.equal(document.scan.physical_slots, 10)
  assert.equal(document.scan.available_staff, 10)
  assert.equal(document.scan.available_scanners, 10)
  assert.equal(document.arrivals.count, gateAttendees)
  assert.ok(gateAttendees > 500)
})

test('retains custom geometry by withholding template replacements for that entrance', () => {
  const custom = structuredClone(demo)
  const tent = custom.spatial_context.placements.find(item => item.id === 'plaza_barat_scan_tent')
  tent.position_m[0] += 0.25
  const { proposals, skipped } = expansionPlans(custom, custom, west)
  assert.deepEqual(proposals, [])
  assert.equal(skipped.length, 2)
  assert.match(skipped[0], /custom equipment positions/)
})
