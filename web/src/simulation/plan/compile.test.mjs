import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { catalogue } from '../model.ts'
import { validateLayout } from '../layout/core.ts'
import { generateAbm } from '../abm/generator.ts'
import { scheduleAdmission } from '../abm/admission.ts'
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
  assert.deepEqual(Object.fromEntries(fixture.venue.layout.gates.map(gate => [gate.id, gate.lanes[0].count])), {
    proposed_gate_plaza_tenggara: 8, proposed_gate_plaza_barat: 4, proposed_gate_pintu_kuning: 5,
    proposed_gate_plaza_utara: 5, proposed_gate_plaza_timur: 8,
  })
  assert.equal(plan.operators.length, 65)
  const queueStations = plan.config.serviceStations.filter(station => station.queueStartNodeId)
  assert.equal(queueStations.length, 30)
  assert.ok(queueStations.every(station => station.admissionStage === 'security'))
  const firstJourney = result.journeys.find(journey => journey.serviceStops[0].queueStartDistanceM !== undefined)
  const firstStop = firstJourney.serviceStops[0]
  assert.ok(firstStop.queueStartDistanceM < firstStop.queueEndDistanceM)
  assert.ok(firstStop.queueEndDistanceM < firstStop.distanceM)
  assert.ok(firstStop.arrivalSeconds < firstJourney.checkpointArrivalSeconds)
  const stages = new Map(plan.config.serviceStations.map(station => [station.nodeId, station.admissionStage]))
  const cohorts = new Map(plan.config.cohorts.map(cohort => [cohort.id, cohort]))
  let helpVisits = 0
  for (const journey of result.journeys) {
    const { helpDesk, destinationNodeId } = cohorts.get(journey.cohortId)
    const passed = journey.routeNodeIds.indexOf(helpDesk.passNodeId)
    const security = journey.routeNodeIds.findIndex(id => stages.get(id) === 'security')
    assert.ok(passed >= 0 && passed < security)
    const stops = journey.routeNodeIds.map(id => stages.get(id)).filter(Boolean)
    if (stops[0] === 'help') helpVisits++
    assert.deepEqual(stops, stops[0] === 'help' ? ['help', 'security', 'scan'] : ['security', 'scan'])
    assert.equal(journey.routeNodeIds.at(-1), destinationNodeId)
  }
  assert.ok(helpVisits > 0 && helpVisits < result.generatedCount)
  const venue = JSON.parse(readFileSync(new URL('../venue/gbk.json', import.meta.url)))
  const validation = validateLayout(plan.northLayout, { bounds: venue.editBounds, catalogue })
  assert.deepEqual(validation.issues, [])
  assert.equal(validation.valid, true)
  assert.equal(plan.placements.filter(item => item.presetId === 'barrier-230').length, 105)
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
  assert.equal(result.config.cohorts.length, fixture.spatial_context.arrival_origins ? 228 : 76)
  for (const category of fixture.event.ticket_categories) {
    const cohorts = result.config.cohorts.filter(item => item.categoryId === category.id)
    assert.equal(cohorts.reduce((sum, item) => sum + item.count, 0), category.sold)
    assert.ok(cohorts.every(cohort => result.nodes.find(node => node.id === cohort.destinationNodeId).entryAreaId === category.entry_area_id))
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
  const cohort = config.cohorts.find(item => item.categoryId === 'cat5' && item.segmentId === 'early_fan')
  const count = cohort.laneCheckpointIds.length * cohort.groupSize
  return { ...config, cohorts: [{ ...cohort, helpDesk: { ...cohort.helpDesk, visitPercent: 0 }, count, windows: [{ startSeconds: 0, endSeconds: .01, sharePercent: 100 }] }] }
}
test('all authored lanes are used, groups stay together, and one person per operator is processed', () => {
  const config = smallAdmissionConfig()
  const result = generateAbm(config)
  assert.deepEqual(result.issues, [])
  const laneCount = config.cohorts[0].laneCheckpointIds.length
  const securityStops = result.journeys.map(journey => journey.serviceStops[0])
  assert.equal(new Set(securityStops.map(stop => stop.operatorId)).size, laneCount)
  for (const journey of result.journeys) {
    const group = result.journeys.filter(item => item.groupId === journey.groupId)
    assert.ok(group.every(member => member.serviceStops[0].operatorId === journey.serviceStops[0].operatorId))
  }
  const sampler = prepareJourneySampler(result.journeys)
  const stats = sampleWalkingCrowd(sampler, 30601, new Float32Array(120), new Uint32Array(40))
  assert.equal(stats.processingCount, laneCount)
  assert.equal(stats.waitingCount, result.generatedCount - laneCount)
  assert.equal(stats.completedCount, 0)
  const phases = result.journeys.map((_, index) => sampleJourneyPosition(sampler, index, 30601, new Float32Array(3)))
  assert.equal(phases.filter(phase => phase === 'processing').length, laneCount)
  assert.equal(phases.filter(phase => phase === 'waiting').length, result.generatedCount - laneCount)
  for (const operator of new Set(securityStops.map(stop => stop.operatorId))) {
    const stops = securityStops.filter(stop => stop.operatorId === operator).sort((a, b) => a.startSeconds - b.startSeconds)
    assert.ok(stops[0].endSeconds <= stops[1].startSeconds)
  }
})
test('closed processing leaves people pending in the queue, while security clearance continues to ticket scan', () => {
  const config = smallAdmissionConfig()
  const normal = generateAbm(config)
  assert.ok(normal.journeys.every(journey => journey.serviceStops.length === 2 && journey.completionSeconds !== null))
  const sampler = prepareJourneySampler(normal.journeys)
  const completed = sampleWalkingCrowd(sampler, 31000, new Float32Array(120), new Uint32Array(40))
  assert.equal(completed.completedCount, normal.generatedCount)
  assert.equal(completed.processingCount, 0)
  assert.equal(completed.waitingCount, 0)
  const closed = generateAbm({ ...config, serviceStations: config.serviceStations.map(station => ({ ...station, closesSeconds: 30605 })) })
  assert.ok(closed.journeys.every(journey => journey.completionSeconds === null && journey.serviceStops[0].startSeconds === null))
  const pending = sampleWalkingCrowd(prepareJourneySampler(closed.journeys), 30700, new Float32Array(120), new Uint32Array(40))
  assert.equal(pending.waitingCount, closed.generatedCount)
  assert.equal(pending.processingCount, 0)
})

test('ticket issue routing uses an independent group draw and the help desk service window', () => {
  const config = smallAdmissionConfig()
  const cohort = config.cohorts[0]
  const issueConfig = { ...config, cohorts: [{ ...cohort, helpDesk: { ...cohort.helpDesk, visitPercent: 100 } }] }
  const regular = generateAbm(config), issue = generateAbm(issueConfig)
  assert.deepEqual(issue.issues, [])
  assert.deepEqual(issue.journeys.map(journey => [journey.groupId, journey.onsiteArrivalSeconds]), regular.journeys.map(journey => [journey.groupId, journey.onsiteArrivalSeconds]))
  const helpStation = config.serviceStations.find(station => station.nodeId === cohort.helpDesk.checkpointNodeId)
  assert.equal(helpStation.opensSeconds, 4 * 3600)
  for (const journey of issue.journeys) {
    const [help, security, scan] = journey.serviceStops
    assert.equal(help.stationId, helpStation.id)
    assert.ok(help.startSeconds >= helpStation.opensSeconds && help.endSeconds <= helpStation.closesSeconds)
    assert.ok(security.arrivalSeconds > help.endSeconds && scan.arrivalSeconds > security.endSeconds)
  }
  assert.ok(regular.journeys.every(journey => !journey.routeNodeIds.includes(cohort.helpDesk.checkpointNodeId)))
  const closed = generateAbm({ ...issueConfig, serviceStations: config.serviceStations.map(station => station.id === helpStation.id ? { ...station, opensSeconds: 0, closesSeconds: 1 } : station) })
  assert.ok(closed.journeys.every(journey => journey.serviceStops.length === 1 && journey.serviceStops[0].stationId === helpStation.id && journey.completionSeconds === null))
})

test('one-way plans reject bypasses and paths back to pre-entry after scan', () => {
  const change = (from, to) => {
    const plan = structuredClone(fixture)
    plan.spatial_context.navigation.edges.push({ id: 'invalid-admission-edge', from_node_id: from, to_node_id: to, directed: true })
    return plan
  }
  const route = fixture.spatial_context.cohort_routes.find(route => route.category_id === 'cat5')
  assert.throws(() => compileSimulationPlan(change('scan_checkpoint', 'arrival')), /must not lead back to pre-entry/)
  assert.throws(() => compileSimulationPlan(change('arrival', route.destination_node_id)), /bypasses the help passage/)
  assert.throws(() => compileSimulationPlan(change(route.lane_checkpoint_ids[0], route.destination_node_id)), /through security and one ticket scan/)
  assert.throws(() => compileSimulationPlan(change(route.destination_node_id, 'scan_checkpoint')), /must not lead back|terminal handover/)
})
test('changing open lane options preserves seeded onsite demand', () => {
  const config = smallAdmissionConfig()
  const full = generateAbm(config)
  const two = generateAbm({ ...config, cohorts: config.cohorts.map(cohort => ({ ...cohort, laneCheckpointIds: cohort.laneCheckpointIds.slice(0, 2) })) })
  assert.deepEqual(full.journeys.map(item => item.onsiteArrivalSeconds), two.journeys.map(item => item.onsiteArrivalSeconds))
  assert.equal(new Set(two.journeys.map(item => item.serviceStops[0].operatorId)).size, 2)
})

test('scan queues start at the pen entrance and preserve FIFO through the gate closing time', () => {
  const routeNodeIds = ['origin', 'tail', 'head', 'scan', 'security', 'handover']
  const points = [0, 10, 30, 40, 60, 70].map(distance => [distance, 0, 0])
  const visits = () => [
    { id: 'earlier', cohortId: 'slow', groupId: 'first', onsiteArrivalSeconds: 1, checkpointArrivalSeconds: 41, walkSeconds: 70, routeNodeIds, points },
    { id: 'later', cohortId: 'fast', groupId: 'second', onsiteArrivalSeconds: 12, checkpointArrivalSeconds: 32, walkSeconds: 35, routeNodeIds, points },
  ]
  const scan = { id: 'scan-station', nodeId: 'scan', operatorId: 'scanner', serviceSeconds: 9, opensSeconds: 0, closesSeconds: 120, queueStartNodeId: 'tail', queueEndNodeId: 'head' }
  const security = { id: 'security-station', nodeId: 'security', operatorId: 'guard', serviceSeconds: 8, opensSeconds: 0, closesSeconds: 120 }
  const journeys = visits()
  scheduleAdmission(journeys, [scan, security])
  const [first, second] = journeys.map(journey => journey.serviceStops[0])
  assert.deepEqual([first.arrivalSeconds, first.queueStartDistanceM, first.queueEndDistanceM, first.startSeconds, first.endSeconds], [11, 10, 30, 41, 50])
  assert.deepEqual([second.arrivalSeconds, second.startSeconds, second.endSeconds], [17, 50, 59])
  assert.equal(journeys[0].serviceStops[1].arrivalSeconds, 70)
  assert.equal(journeys[0].serviceStops[1].queueStartDistanceM, undefined)
  const late = visits()
  scheduleAdmission(late, [{ ...scan, closesSeconds: 45 }, security])
  assert.ok(late.every(journey => journey.serviceStops.length === 1 && journey.serviceStops[0].startSeconds === null && journey.completionSeconds === null))
  assert.throws(() => scheduleAdmission(visits(), [{ ...scan, queueEndNodeId: 'missing' }]), /queue entrance and end in order/)
})

// A compact transport extension exercises the wire independently of the full mapped approach artifact.
function transportFixture() {
  const plan = structuredClone(fixture)
  if (plan.spatial_context.arrival_origins) return plan
  const origins = [
    { id: 'origin_mrt', label: 'MRT', mode: 'mrt', position_m: [900, 0, 700] },
    { id: 'origin_parking', label: 'Parking', mode: 'parking', position_m: [-800, 0, -700] },
    { id: 'origin_dropoff', label: 'Taxi / ride-hailing', mode: 'taxi_ride_hailing', position_m: [700, 0, -900] },
  ]
  plan.spatial_context.arrival_origins = origins.map(origin => ({ ...origin, source_url: 'https://www.openstreetmap.org', basis: 'test fixture only' }))
  const navigation = plan.spatial_context.navigation
  for (const origin of origins) {
    navigation.nodes.push({ id: origin.id, role: 'arrival', entry_area_id: 'shared_origins', position_m: [...origin.position_m] })
    const approach = `${origin.id}_approach`
    navigation.nodes.push({ id: approach, role: 'waypoint', entry_area_id: 'approach_network', position_m: origin.position_m.map(value => value / 2) })
    navigation.edges.push({ id: `${origin.id}_approach_edge`, from_node_id: origin.id, to_node_id: approach, directed: true })
    for (const arrivalId of new Set(plan.spatial_context.cohort_routes.map(route => route.arrival_node_id))) navigation.edges.push({ id: `${origin.id}_to_${arrivalId}`, from_node_id: approach, to_node_id: arrivalId, directed: true })
  }
  const mixes = { early_fan: [60, 15, 25], regular_attendee: [45, 25, 30], late_arrival: [20, 10, 70], premium_package: [10, 40, 50], social_group: [25, 45, 30] }
  for (const profile of plan.behavior_context.profiles) profile.origin_share_percent = Object.fromEntries(origins.map((origin, index) => [origin.id, mixes[profile.id][index]]))
  return plan
}

test('behavior-only legacy plans still compile without transport origins', () => {
  const input = transportFixture()
  delete input.spatial_context.arrival_origins
  for (const profile of input.behavior_context.profiles) delete profile.origin_share_percent
  const navigation = input.spatial_context.navigation
  navigation.nodes = navigation.nodes.filter(node => !['shared_origins', 'approach_network'].includes(node.entry_area_id))
  const retained = new Set(navigation.nodes.map(node => node.id))
  navigation.edges = navigation.edges.filter(edge => retained.has(edge.from_node_id) && retained.has(edge.to_node_id))
  const compiled = compileSimulationPlan(input)
  assert.equal(compiled.config.cohorts.length, 76)
  assert.deepEqual(compiled.arrivalOrigins, [])
  assert.equal(compiled.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0), 70000)
})

test('transport cohorts preserve all 70,000 people by category, segment and origin, and reach the category gate', () => {
  const input = transportFixture(), compiled = compileSimulationPlan(input)
  assert.equal(input.behavior_context.cohorts.length, 76)
  assert.equal(compiled.config.cohorts.length, 228)
  assert.equal(compiled.arrivalOrigins.reduce((sum, origin) => sum + origin.attendees, 0), 70000)
  assert.equal(compiled.segments.reduce((sum, segment) => sum + segment.attendees, 0), 70000)
  const journeys = generateAbm(compiled.config)
  assert.equal(journeys.generatedCount, 70000)
  assert.deepEqual(journeys.issues, [])
  for (const category of input.event.ticket_categories) assert.equal(compiled.config.cohorts.filter(cohort => cohort.categoryId === category.id).reduce((sum, cohort) => sum + cohort.count, 0), category.sold)
  for (const segment of compiled.segments) assert.equal(segment.attendees, compiled.config.cohorts.filter(cohort => cohort.segmentId === segment.id).reduce((sum, cohort) => sum + cohort.count, 0))
  for (const origin of compiled.arrivalOrigins) {
    assert.equal(origin.attendees, compiled.config.cohorts.filter(cohort => cohort.originId === origin.id).reduce((sum, cohort) => sum + cohort.count, 0))
    assert.deepEqual(origin.position, input.spatial_context.arrival_origins.find(item => item.id === origin.id).position_m)
  }
  const byId = new Map(compiled.config.cohorts.map(cohort => [cohort.id, cohort]))
  for (const journey of journeys.journeys) {
    const cohort = byId.get(journey.cohortId)
    const category = input.event.ticket_categories.find(item => item.id === cohort.categoryId)
    assert.equal(journey.routeNodeIds[0], cohort.originId)
    assert.equal(compiled.nodes.find(node => node.id === journey.routeNodeIds.at(-1)).entryAreaId, category.entry_area_id)
    assert.ok(journey.routeNodeIds.some(id => cohort.laneCheckpointIds.includes(id)))
    assert.ok(cohort.id.endsWith(`__${cohort.originId}`))
  }
  for (const row of input.behavior_context.cohorts) {
    const split = compiled.config.cohorts.filter(cohort => cohort.id.startsWith(`${row.id}__`))
    assert.equal(split.length, 3)
    assert.ok(split.filter(cohort => cohort.count % cohort.groupSize !== 0).length <= 1)
  }
  const changed = structuredClone(input)
  changed.event.ticket_categories[0].sold += 11
  changed.event.capacity.no_show_percent_estimate = 3.5
  const updated = compileSimulationPlan(changed)
  const total = Math.round(70011 * .965)
  assert.equal(updated.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0), total)
  assert.equal(updated.arrivalOrigins.reduce((sum, origin) => sum + origin.attendees, 0), total)
  assert.equal(updated.segments.reduce((sum, segment) => sum + segment.attendees, 0), total)
})

test('unknown origins, invalid modal shares, coordinates, unreachable lanes and duplicate service capacity reject explicitly', () => {
  for (const mutate of [
    plan => { plan.behavior_context.profiles[0].origin_share_percent.origin_rogue = 1 },
    plan => { plan.behavior_context.profiles[0].origin_share_percent.origin_mrt += 1 },
    plan => { delete plan.behavior_context.profiles[0].origin_share_percent.origin_mrt },
    plan => { plan.spatial_context.arrival_origins[0].position_m[0] += 1 },
    plan => { plan.spatial_context.arrival_origins.push(structuredClone(plan.spatial_context.arrival_origins[0])) },
    plan => { plan.spatial_context.navigation.edges = plan.spatial_context.navigation.edges.filter(edge => edge.from_node_id !== 'origin_mrt') },
    plan => { plan.spatial_context.cohort_routes[0].lane_checkpoint_ids[0] = 'scan_checkpoint' },
    plan => { plan.spatial_context.service_stations[1].operator_id = plan.spatial_context.service_stations[0].operator_id },
    plan => { plan.spatial_context.service_stations[0].step_ids = ['security_inspection'] },
  ]) {
    const input = transportFixture()
    mutate(input)
    assert.throws(() => compileSimulationPlan(input))
  }
})

test('North edits retain the shared origin prefix and exclude it from native walking distance', () => {
  const input = transportFixture(), original = compileSimulationPlan(input)
  const layout = structuredClone(original.northLayout)
  layout.revision++
  layout.placements.find(item => item.id === 'scan_tent').position[0] += 2
  const projected = projectNorthLayout(input, layout), result = compileSimulationPlan(projected)
  const publicEdges = input.spatial_context.navigation.edges.filter(edge => {
    const from = original.nodes.find(node => node.id === edge.from_node_id), to = original.nodes.find(node => node.id === edge.to_node_id)
    return from.entryAreaId === 'approach_network' || to.entryAreaId === 'approach_network' || from.entryAreaId === 'shared_origins'
  })
  for (const edge of publicEdges) assert.ok(projected.spatial_context.navigation.edges.some(item => item.id === edge.id))
  assert.equal(result.nodes.find(node => node.id === 'scan_checkpoint').position[0], original.nodes.find(node => node.id === 'scan_checkpoint').position[0] + 2)
  assert.equal(result.operators.find(operator => operator.id === 'plaza_utara_scan_2').position[0], original.operators.find(operator => operator.id === 'plaza_utara_scan_2').position[0] + 2)
  const remote = structuredClone(input)
  const origin = remote.spatial_context.arrival_origins[0]
  origin.position_m[0] += 10000
  remote.spatial_context.navigation.nodes.find(node => node.id === origin.id).position_m = [...origin.position_m]
  const farther = projectNorthLayout(remote, layout)
  const nativeDistance = plan => plan.venue.layout.walking_paths.find(path => path.from === 'queue_plaza_utara' && path.to === 'proposed_gate_plaza_utara').distance_m
  assert.ok(Math.abs(nativeDistance(projected) - nativeDistance(farther)) < 1e-8)
  assert.ok(nativeDistance(projected) < 500)
  const slowService = structuredClone(input)
  for (const step of slowService.process_steps.steps) step.time_per_person_seconds.typical *= 100
  assert.ok(Math.abs(nativeDistance(projected) - nativeDistance(projectNorthLayout(slowService, layout))) < 1e-8)
  const deleted = structuredClone(layout)
  deleted.nodes = deleted.nodes.filter(node => node.id !== 'arrival')
  assert.throws(() => projectNorthLayout(input, deleted), /public approach network/)
})
