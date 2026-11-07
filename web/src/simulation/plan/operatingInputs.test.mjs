import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { generateAbm } from '../abm/generator.ts'
import { validateLayout } from '../layout/core.ts'
import { catalogue } from '../model.ts'
import { applyGateInputs, editableGates } from './operatingInputs.ts'

// Use the same extension mapping as compile.test.mjs on Node's TypeScript runner.
let compiler = ts.transpileModule(readFileSync(new URL('./compile.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
for (const path of ['../model', '../abm/generator', '../layout/core']) {
  compiler = compiler.replace(`'${path}'`, JSON.stringify(new URL(`${path}.ts`, import.meta.url).href))
}
const compilerUrl = `data:text/javascript;base64,${Buffer.from(compiler).toString('base64')}`
const { compileSimulationPlan } = await import(compilerUrl)
let adapter = ts.transpileModule(readFileSync(new URL('../layout/planAdapter.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
for (const [path, url] of Object.entries({
  '../plan/compile': compilerUrl,
  '../abm/generator': new URL('../abm/generator.ts', import.meta.url).href,
  './core': new URL('../layout/core.ts', import.meta.url).href,
})) {
  adapter = adapter.replace(`'${path}'`, JSON.stringify(url))
}
const { createPlanEditorLayout, planEditorOptions, projectPlanEditorLayout } = await import(`data:text/javascript;base64,${Buffer.from(adapter).toString('base64')}`)
const fixture = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))
const northId = 'plaza_utara'
const gateId = `proposed_gate_${northId}`
const draft = { lanes: 3, opens: '17:45', closes: '20:20' }
const removedOperators = new Set([`${northId}_security_4`, `${northId}_scan_4`])
const removedStations = fixture.spatial_context.service_stations.filter(station => removedOperators.has(station.operator_id))
const source = compileSimulationPlan(fixture)

test('editing one entrance filters exactly its inactive security and scan bindings and applies gate hours', () => {
  assert.equal(removedStations.length, 2)
  const before = structuredClone(fixture)
  const reduced = applyGateInputs(fixture, { [gateId]: draft }, 1)
  const compiled = compileSimulationPlan(reduced)
  assert.deepEqual(fixture, before)
  assert.equal(compiled.layoutRevision, source.layoutRevision + 1)
  assert.deepEqual(compiled.entryAreas, source.entryAreas)
  assert.deepEqual(compiled.placements, source.placements)
  assert.deepEqual(compiled.operators, source.operators.filter(operator => !removedOperators.has(operator.id)))
  assert.deepEqual(reduced.venue.layout.gates.filter(gate => gate.id !== gateId), fixture.venue.layout.gates.filter(gate => gate.id !== gateId))

  const affectedOperators = new Set(compiled.operators.filter(operator => operator.pointId === gateId).map(operator => operator.id))
  assert.equal(affectedOperators.size, 6)
  const stations = source.config.serviceStations.filter(station => !removedOperators.has(station.operatorId))
  assert.deepEqual(compiled.config.serviceStations, stations.map(station => affectedOperators.has(station.operatorId)
    ? { ...station, opensSeconds: 31_500, closesSeconds: 40_800 }
    : station))

  const northCategoryIds = new Set(fixture.event.ticket_categories.filter(category => category.entry_gate === gateId).map(category => category.id))
  assert.deepEqual(compiled.config.cohorts, source.config.cohorts.map(cohort => northCategoryIds.has(cohort.categoryId)
    ? { ...cohort, laneCheckpointIds: cohort.laneCheckpointIds.slice(0, 3) }
    : cohort))
  const cohort = compiled.config.cohorts.find(item => northCategoryIds.has(item.categoryId))
  const result = generateAbm({
    ...compiled.config,
    cohorts: [{ ...cohort, count: 3 * (cohort.groupSize ?? 1), windows: [{ startSeconds: 31_500, endSeconds: 31_600, sharePercent: 100 }] }],
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.generatedCount, 3 * (cohort.groupSize ?? 1))
  assert.deepEqual(new Set(result.journeys.flatMap(journey => journey.serviceStops.map(stop => stop.operatorId)).filter(id => affectedOperators.has(id))), affectedOperators)
  for (const { routeNodeIds } of result.journeys) {
    assert.ok(removedStations.every(station => !routeNodeIds.includes(station.node_id)))
  }
})

test('reopening the authored fourth lane reuses its stations, positions, and route', () => {
  const reopened = compileSimulationPlan(applyGateInputs(fixture, { [gateId]: { ...draft, lanes: 4 } }, 2))
  assert.deepEqual(reopened.operators, source.operators)
  assert.deepEqual(reopened.config.cohorts, source.config.cohorts)
  const affectedOperators = new Set(source.operators.filter(operator => operator.pointId === gateId).map(operator => operator.id))
  assert.equal(affectedOperators.size, 8)
  assert.deepEqual(reopened.config.serviceStations, source.config.serviceStations.map(station => affectedOperators.has(station.operatorId)
    ? { ...station, opensSeconds: 31_500, closesSeconds: 40_800 }
    : station))
})

test('lane choices follow authored pairs even when the native limit is higher', () => {
  const plan = structuredClone(fixture)
  plan.venue.layout.gates.find(gate => gate.id === gateId).max_lanes = 9
  const gates = editableGates(plan)
  assert.equal(gates.length, 5)
  assert.equal(gates.find(gate => gate.id === gateId).maxLanes, 4)
  assert.throws(() => applyGateInputs(plan, { [gateId]: { ...draft, lanes: 5 } }, 1), /authored layout/)
  assert.throws(() => applyGateInputs(plan, { new_gate: draft }, 1), /authored layout/)
  assert.throws(() => applyGateInputs(plan, { [gateId]: { ...draft, closes: draft.opens } }, 1), /closing time must be later/)
})

for (const lanes of [1, 3]) {
  test(`a saved ${lanes}-lane plan reopens in the editor and preserves all arrivals`, () => {
    const reduced = applyGateInputs(fixture, { [gateId]: { ...draft, lanes } }, 1)
    const saved = JSON.parse(JSON.stringify(reduced))
    const layout = createPlanEditorLayout(saved), options = planEditorOptions(saved)
    const validation = validateLayout(layout, { ...options, catalogue })
    assert.equal(validation.valid, true, JSON.stringify(validation.issues.filter(issue => issue.severity === 'error')))

    const original = fixture.spatial_context, edited = saved.spatial_context
    const northNodes = new Set(original.navigation.nodes.filter(node => node.entry_area_id === northId).map(node => node.id))
    const outsideNorth = edge => !northNodes.has(edge.from_node_id) || !northNodes.has(edge.to_node_id)
    assert.deepEqual(edited.navigation.nodes.filter(node => !northNodes.has(node.id)), original.navigation.nodes.filter(node => !northNodes.has(node.id)))
    assert.deepEqual(edited.navigation.edges.filter(outsideNorth), original.navigation.edges.filter(outsideNorth))
    assert.deepEqual(edited.placements, original.placements)
    assert.deepEqual(edited.arrival_origins, original.arrival_origins)
    assert.deepEqual(saved.event.ticket_categories, fixture.event.ticket_categories)
    const retainedIds = new Set(layout.nodes.map(node => node.id))
    assert.ok(options.protectedNodeIds.every(id => retainedIds.has(id)))
    if (lanes === 1) {
      for (const kind of ['security', 'scan']) {
        const marker = edited.operational_bindings.find(binding => binding.point_id === gateId && binding.placement_id === `${kind}_tent`)
        assert.equal(marker.node_id, `lane_1_${kind}_checkpoint`)
      }
    }
    assert.doesNotThrow(() => projectPlanEditorLayout(saved, layout))
    const result = generateAbm(compileSimulationPlan(saved).config)
    assert.deepEqual(result.issues, [])
    assert.equal(result.generatedCount, 70_000)
  })
}
