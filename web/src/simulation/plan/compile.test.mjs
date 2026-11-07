import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { catalogue } from '../model.ts'
import { validateLayout } from '../layout/core.ts'
import { generateAbm } from '../abm/generator.ts'
const source = readFileSync(new URL('./compile.ts', import.meta.url), 'utf8')
const compiledSource = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace("'../model'", JSON.stringify(new URL('../model.ts', import.meta.url).href))
  .replace("'../abm/generator'", JSON.stringify(new URL('../abm/generator.ts', import.meta.url).href))
  .replace("'../layout/core'", JSON.stringify(new URL('../layout/core.ts', import.meta.url).href))
const { compileSimulationPlan, projectNorthLayout } = await import(`data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`)
const fixture = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))

test('the actual JSON produces 70,000 journeys across all five authored entry areas', () => {
  const plan = compileSimulationPlan(fixture)
  const result = generateAbm(plan.config)
  assert.equal(result.generatedCount, 70000)
  assert.deepEqual(result.issues, [])
  assert.equal(plan.entryAreas.length, 5)
  assert.equal(plan.operators.length, 45)
  const venue = JSON.parse(readFileSync(new URL('../venue/gbk.json', import.meta.url)))
  const validation = validateLayout(plan.northLayout, { bounds: venue.editBounds, catalogue })
  assert.deepEqual(validation.issues, [])
  assert.equal(validation.valid, true)
  assert.equal(plan.placements.filter(item => item.presetId === 'barrier-230').length, 75)
  assert.equal(plan.entryAreas.reduce((sum, item) => sum + item.attendees, 0), 70000)
})
test('JSON ticket edits drive attendance and no-show rounding conserves the expected total', () => {
  const changed = structuredClone(fixture)
  changed.event.ticket_categories[0].sold += 10
  changed.event.capacity.no_show_percent_estimate = 3.5
  const result = compileSimulationPlan(changed)
  assert.equal(result.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0), Math.round(70010 * .965))
})
test('moving a tent projects its attached checkpoint and operators into the same plan snapshot', () => {
  const original = compileSimulationPlan(fixture)
  const layout = structuredClone(original.northLayout)
  layout.revision++
  layout.placements.find(item => item.id === 'scan_tent').position[0] += 2
  const projected = projectNorthLayout(fixture, layout)
  const result = compileSimulationPlan(projected)
  assert.equal(result.nodes.find(node => node.id === 'scan_checkpoint').position[0], original.nodes.find(node => node.id === 'scan_checkpoint').position[0] + 2)
  const before = original.operators.find(item => item.roleId === 'plaza_utara_scan').position[0]
  assert.equal(result.operators.find(item => item.roleId === 'plaza_utara_scan').position[0], before + 2)
  assert.equal(fixture.spatial_context.revision, original.layoutRevision)
})
test('a partial plan, disconnected binding, bad coordinate frame or staffing mismatch fails explicitly', () => {
  const draft = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-plan-draft.json', import.meta.url)))
  assert.throws(() => compileSimulationPlan(draft), /spatial_context/)
  for (const change of [
    plan => { plan.spatial_context.navigation.edges[0].to_node_id = 'missing' },
    plan => { plan.spatial_context.coordinate_frame.axes.z = 'north' },
    plan => { plan.staff.roles[0].count++ },
    plan => { plan.demand.arrival_windows_percent.cat1['09:00-13:00'] = 20 },
  ]) {
    const plan = structuredClone(fixture)
    change(plan)
    assert.throws(() => compileSimulationPlan(plan))
  }
})

test('behavior cohorts conserve every category and retain its assigned entry area', () => {
  const result = compileSimulationPlan(fixture)
  assert.equal(result.segments.length, 5)
  assert.equal(result.config.cohorts.length, 76)
  for (const category of fixture.event.ticket_categories) {
    const identifiers = new Set(fixture.behavior_context.cohorts.filter(item => item.category_id === category.id).map(item => item.id))
    const cohorts = result.config.cohorts.filter(item => identifiers.has(item.id))
    assert.equal(cohorts.reduce((sum, item) => sum + item.count, 0), category.sold)
    assert.ok(cohorts.every(cohort => result.nodes.find(node => node.id === cohort.arrivalNodeId).entryAreaId === category.entry_area_id))
  }
  assert.equal(result.segments.reduce((sum, item) => sum + item.attendees, 0), 70000)
})
test('cohort walking speed changes travel time while retaining the route and seeded arrivals', () => {
  const result = compileSimulationPlan(fixture)
  const cohort = { ...result.config.cohorts[0], count: 2 }
  const slow = generateAbm({ ...result.config, cohorts: [{ ...cohort, walkSpeedMps: .6 }] }).journeys[0]
  const regular = generateAbm({ ...result.config, cohorts: [{ ...cohort, walkSpeedMps: 1.2 }] }).journeys[0]
  assert.equal(slow.walkSeconds, regular.walkSeconds * 2)
  assert.equal(slow.onsiteArrivalSeconds, regular.onsiteArrivalSeconds)
  assert.deepEqual(slow.routeNodeIds, regular.routeNodeIds)
})

const { prepareJourneySampler, sampleJourneyPosition, sampleWalkingCrowd } = await import('../abm/sampling.ts')
function smallAdmissionConfig() {
  const config = compileSimulationPlan(fixture).config
  const cohort = config.cohorts.find(item => item.id === 'cat5__early_fan')
  return { ...config, cohorts: [{ ...cohort, count: 8, windows: [{ startSeconds: 0, endSeconds: .01, sharePercent: 100 }] }] }
}
test('four lanes are used, groups stay together, and one person per operator is processed', () => {
  const config = smallAdmissionConfig()
  const result = generateAbm(config)
  assert.deepEqual(result.issues, [])
  const scanStops = result.journeys.map(journey => journey.serviceStops[0])
  assert.equal(new Set(scanStops.map(stop => stop.operatorId)).size, 4)
  for (const journey of result.journeys) {
    const group = result.journeys.filter(item => item.groupId === journey.groupId)
    assert.ok(group.every(member => member.serviceStops[0].operatorId === journey.serviceStops[0].operatorId))
  }
  const sampler = prepareJourneySampler(result.journeys)
  const stats = sampleWalkingCrowd(sampler, 30601, new Float32Array(120), new Uint32Array(40))
  assert.equal(stats.processingCount, 4)
  assert.equal(stats.waitingCount, 4)
  assert.equal(stats.completedCount, 0)
  const phases = result.journeys.map((_, index) => sampleJourneyPosition(sampler, index, 30601, new Float32Array(3)))
  assert.equal(phases.filter(phase => phase === 'processing').length, 4)
  assert.equal(phases.filter(phase => phase === 'waiting').length, 4)
  for (const operator of new Set(scanStops.map(stop => stop.operatorId))) {
    const stops = scanStops.filter(stop => stop.operatorId === operator).sort((a, b) => a.startSeconds - b.startSeconds)
    assert.ok(stops[0].endSeconds <= stops[1].startSeconds)
  }
})
test('closed processing leaves people pending in the queue, while completed service continues to security', () => {
  const config = smallAdmissionConfig()
  const normal = generateAbm(config)
  assert.ok(normal.journeys.every(journey => journey.serviceStops.length === 2 && journey.completionSeconds !== null))
  const sampler = prepareJourneySampler(normal.journeys)
  const completed = sampleWalkingCrowd(sampler, 31000, new Float32Array(120), new Uint32Array(40))
  assert.equal(completed.completedCount, 8)
  assert.equal(completed.processingCount, 0)
  assert.equal(completed.waitingCount, 0)
  const closed = generateAbm({ ...config, serviceStations: config.serviceStations.map(station => ({ ...station, closesSeconds: 30605 })) })
  assert.ok(closed.journeys.every(journey => journey.completionSeconds === null && journey.serviceStops[0].startSeconds === null))
  const pending = sampleWalkingCrowd(prepareJourneySampler(closed.journeys), 30700, new Float32Array(120), new Uint32Array(40))
  assert.equal(pending.waitingCount, 8)
  assert.equal(pending.processingCount, 0)
})
test('changing open lane options preserves seeded onsite demand', () => {
  const config = smallAdmissionConfig()
  const four = generateAbm(config)
  const two = generateAbm({ ...config, cohorts: config.cohorts.map(cohort => ({ ...cohort, laneCheckpointIds: cohort.laneCheckpointIds.slice(0, 2) })) })
  assert.deepEqual(four.journeys.map(item => item.onsiteArrivalSeconds), two.journeys.map(item => item.onsiteArrivalSeconds))
  assert.equal(new Set(two.journeys.map(item => item.serviceStops[0].operatorId)).size, 2)
})
