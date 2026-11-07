import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { executeAbmRequest, generateAbm } from './generator.ts'
import { createConfigHash, isCurrentAbmResponse } from './worker-protocol.ts'
import { prepareJourneySampler, sampleJourneyPosition, sampleWalkingCrowd } from './sampling.ts'

// node --experimental-strip-types --test web/src/simulation/abm/abm.test.mjs
const node = (id, role, x, z = 0) => ({ id, role, position: [x, 0, z] })
const edge = (from, to) => ({ id: `${from}-${to}`, from, to })
const cohort = (id = 'cat5', count = 11, groupSize = 4) => ({
  id, count, groupSize, arrivalNodeId: 'arrival', destinationNodeId: 'end',
  windows: [{ startSeconds: 0, endSeconds: 900, sharePercent: 25 }, { startSeconds: 900, endSeconds: 3600, sharePercent: 75 }],
})
const config = (overrides = {}) => ({
  seed: 42, timeOrigin: '2026-11-14T09:00:00+07:00', horizonSeconds: 3600, walkSpeedMps: 1.2,
  nodes: [node('arrival', 'arrival', 0), node('scan', 'checkpoint', 120), node('end', 'destination', 240)],
  edges: [edge('arrival', 'scan'), edge('scan', 'end')], cohorts: [cohort()], ...overrides,
})
const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('seeded results repeat exactly, preserve input, and differ with another seed', () => {
  const input = config()
  const before = structuredClone(input)
  const first = generateAbm(input)
  assert.deepEqual(first.issues, [])
  assert.deepEqual(generateAbm(input), first)
  assert.deepEqual(input, before)
  assert.notDeepEqual(generateAbm({ ...input, seed: 43 }).journeys.map(journey => journey.onsiteArrivalSeconds),
    first.journeys.map(journey => journey.onsiteArrivalSeconds))
})

test('graph, cohort and window ordering does not change journeys or buckets', () => {
  const input = config({ cohorts: [cohort('zeta', 13), cohort('alpha', 21)] })
  const reversed = { ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse(),
    cohorts: [...input.cohorts].reverse().map(item => ({ ...item, windows: [...item.windows].reverse() })) }
  assert.deepEqual(generateAbm(input), generateAbm(reversed))
  assert.deepEqual(generateAbm(input).journeys.filter(item => item.cohortId === 'zeta'),
    generateAbm(config({ cohorts: [cohort('zeta', 13)] })).journeys)
})

test('groups arrive together, final residual group preserves exact attendance and stable IDs', () => {
  const result = generateAbm(config())
  assert.equal(result.generatedCount, 11)
  assert.equal(new Set(result.journeys.map(item => item.id)).size, 11)
  const groups = Map.groupBy(result.journeys, item => item.groupId)
  assert.deepEqual([...groups.values()].map(items => items.length), [4, 4, 3])
  for (const group of groups.values()) {
    assert.equal(new Set(group.map(item => item.onsiteArrivalSeconds)).size, 1)
    assert.equal(new Set(group.map(item => item.checkpointArrivalSeconds)).size, 1)
    assert.equal(new Set(group.map(item => item.points)).size, 1)
  }
  const second = generateAbm(config({ seed: 99 }))
  assert.deepEqual(result.journeys.map(item => [item.id, item.groupId]), second.journeys.map(item => [item.id, item.groupId]))
  assert.equal(generateAbm(config({ cohorts: [cohort('small', 2, 100)] })).generatedCount, 2)
})

test('walk duration uses route distance / explicit speed; checkpoint means first checkpoint', () => {
  const input = config()
  input.nodes.splice(2, 0, node('security', 'checkpoint', 180))
  input.edges = [edge('arrival', 'scan'), edge('scan', 'security'), edge('security', 'end')]
  const result = generateAbm(input)
  for (const journey of result.journeys) {
    almost(journey.walkSeconds, 200)
    almost(journey.checkpointArrivalSeconds - journey.onsiteArrivalSeconds, 100)
    assert.deepEqual(journey.routeNodeIds, ['arrival', 'scan', 'security', 'end'])
  }
})

test('directed shortest paths use geometric distance and stable ties', () => {
  const input = config({
    nodes: [node('arrival', 'arrival', 0), node('a', 'waypoint', 3, 4), node('b', 'waypoint', 3, -4),
      node('long', 'waypoint', -50), node('scan', 'checkpoint', 6), node('end', 'destination', 12)],
    edges: [edge('arrival', 'b'), edge('b', 'scan'), edge('arrival', 'long'), edge('long', 'scan'),
      edge('arrival', 'a'), edge('a', 'scan'), edge('scan', 'end')],
  })
  const result = generateAbm(input)
  assert.deepEqual(result.journeys[0].routeNodeIds, ['arrival', 'a', 'scan', 'end'])
  almost(result.journeys[0].walkSeconds, 16 / 1.2)
  input.nodes.reverse()
  input.edges.reverse()
  assert.deepEqual(generateAbm(input), result)
})

test('onsite and checkpoint buckets preserve attendance separately, including beyond horizon', () => {
  const input = config({ cohorts: [{ ...cohort('late', 7, 3), windows: [{ startSeconds: 3599, endSeconds: 3600, sharePercent: 100 }] }] })
  const result = generateAbm(input)
  assert.deepEqual(result.arrivalBuckets, [
    { cohortId: 'late', startSeconds: 2700, endSeconds: 3600, onsiteArrivals: 7, checkpointArrivals: 0 },
    { cohortId: 'late', startSeconds: 3600, endSeconds: 4500, onsiteArrivals: 0, checkpointArrivals: 7 },
  ])
})

test('70,000 fictional attendees across all 12 scenario cohorts retain exact counts', async () => {
  const scenario = JSON.parse(await readFile(new URL('../../../../data/scenarios/coldplay-gbk-demo.json', import.meta.url), 'utf8'))
  // Shared authored fixture route tests generator scale, not validated all-area venue routing.
  const input = config({ cohorts: scenario.cohorts.map(item => cohort(item.id, item.expected_attendees, 4)) })
  const result = generateAbm(input)
  assert.deepEqual(result.issues, [])
  assert.equal(result.generatedCount, 70000)
  assert.equal(new Set(result.journeys.map(item => item.id)).size, 70000)
  for (const demand of input.cohorts) {
    assert.equal(result.journeys.filter(item => item.cohortId === demand.id).length, demand.count)
    const buckets = result.arrivalBuckets.filter(item => item.cohortId === demand.id)
    assert.equal(buckets.reduce((sum, item) => sum + item.onsiteArrivals, 0), demand.count)
    assert.equal(buckets.reduce((sum, item) => sum + item.checkpointArrivals, 0), demand.count)
  }
  const sampler = prepareJourneySampler(result.journeys)
  assert.equal(sampler.count, 70000)
  assert.equal(sampler.routes.length, 1)
  const positions = new Float32Array(300)
  const indices = new Uint32Array(100)
  const stats = { visibleCount: 0, walkingCount: 0 }
  assert.equal(sampleWalkingCrowd(sampler, 1800, positions, indices, stats), stats)
  assert.equal(stats.visibleCount, 100)
  assert.ok(stats.walkingCount > 100)
  assert.ok(new Set([...indices].map(index => result.journeys[index].cohortId)).size > 5)
})

test('invalid arrival windows reject only affected cohorts', () => {
  const badWindows = [
    [], [{ startSeconds: NaN, endSeconds: 900, sharePercent: 100 }],
    [{ startSeconds: 0, endSeconds: Infinity, sharePercent: 100 }],
    [{ startSeconds: 0, endSeconds: 900, sharePercent: NaN }],
    [{ startSeconds: -1, endSeconds: 900, sharePercent: 100 }],
    [{ startSeconds: 900, endSeconds: 900, sharePercent: 100 }],
    [{ startSeconds: 0, endSeconds: 3601, sharePercent: 100 }],
    [{ startSeconds: 0, endSeconds: 900, sharePercent: 99 }],
    [{ startSeconds: 0, endSeconds: 900, sharePercent: -1 }, { startSeconds: 900, endSeconds: 1800, sharePercent: 101 }],
    [{ startSeconds: 0, endSeconds: 900, sharePercent: 50 }, { startSeconds: 899, endSeconds: 1800, sharePercent: 50 }],
  ]
  for (const windows of badWindows) {
    const result = generateAbm(config({ cohorts: [{ ...cohort('bad'), windows }, cohort('valid', 3)] }))
    assert.equal(result.generatedCount, 3)
    assert.ok(result.issues.length > 0)
    assert.ok(result.issues.every(issue => issue.includes('bad')))
    assert.ok(result.journeys.every(item => item.cohortId === 'valid'))
  }
})

test('zero-share windows do not receive arrivals; default singleton and zero demand work', () => {
  const demand = { ...cohort('solo', 13), groupSize: undefined, windows: [
    { startSeconds: 0, endSeconds: 900, sharePercent: 0 }, { startSeconds: 900, endSeconds: 1800, sharePercent: 100 },
  ] }
  const result = generateAbm(config({ cohorts: [demand, cohort('none', 0)] }))
  assert.equal(result.generatedCount, 13)
  assert.equal(new Set(result.journeys.map(item => item.groupId)).size, 13)
  assert.ok(result.journeys.every(item => item.onsiteArrivalSeconds >= 900 && item.onsiteArrivalSeconds < 1800))
})

test('invalid counts, group sizes and duplicate cohort IDs never invent attendance', () => {
  for (const patch of [{ count: -1 }, { count: 1.5 }, { count: NaN }, { groupSize: 0 }, { groupSize: 2.5 }]) {
    const result = generateAbm(config({ cohorts: [{ ...cohort(), ...patch }] }))
    assert.equal(result.generatedCount, 0)
    assert.ok(result.issues.length)
  }
  const duplicated = generateAbm(config({ cohorts: [cohort('same'), cohort('same'), cohort('good', 5)] }))
  assert.equal(duplicated.generatedCount, 5)
  assert.ok(duplicated.issues.some(issue => issue.includes('duplicate cohort')))
})

test('unreachable or missing destinations and routes without checkpoints produce no affected journeys', () => {
  const input = config()
  input.nodes.push(node('isolated', 'destination', 500))
  input.cohorts.push({ ...cohort('unreachable'), destinationNodeId: 'isolated' }, { ...cohort('missing'), destinationNodeId: 'absent' })
  const result = generateAbm(input)
  assert.equal(result.generatedCount, 11)
  assert.ok(result.issues.some(issue => issue.includes('unreachable')))
  assert.ok(result.issues.some(issue => issue.includes('missing')))
  const reversed = generateAbm(config({ edges: [edge('scan', 'arrival'), edge('end', 'scan')] }))
  assert.equal(reversed.generatedCount, 0)
  assert.ok(reversed.issues.some(issue => issue.includes('unreachable')))
  const noCheckpoint = config()
  noCheckpoint.nodes[1].role = 'waypoint'
  const without = generateAbm(noCheckpoint)
  assert.equal(without.generatedCount, 0)
  assert.ok(without.issues.some(issue => issue.includes('no checkpoint')))
})

test('duplicate or malformed graph is rejected as ambiguous rather than partially routed', () => {
  const mutate = [
    input => input.nodes.push(input.nodes[0]),
    input => input.edges.push(input.edges[0]),
    input => input.edges.push({ ...input.edges[0], id: 'parallel' }),
    input => input.nodes[0].position[0] = Infinity,
    input => input.edges.push(edge('arrival', 'absent')),
    input => input.nodes[0].role = 'imaginary',
  ]
  for (const change of mutate) {
    const input = config()
    change(input)
    const result = generateAbm(input)
    assert.equal(result.generatedCount, 0)
    assert.deepEqual(result.arrivalBuckets, [])
    assert.ok(result.issues.length > 0)
  }
})

test('invalid global time, speed, seed and impractical demand fail explicitly', () => {
  for (const patch of [{ seed: NaN }, { seed: 1.1 }, { horizonSeconds: 0 }, { horizonSeconds: Infinity },
    { walkSpeedMps: 0 }, { walkSpeedMps: NaN }, { timeOrigin: '2026-11-14T09:00:00' },
    { cohorts: [cohort('huge', 1_000_001)] }]) {
    const result = generateAbm(config(patch))
    assert.equal(result.generatedCount, 0)
    assert.ok(result.issues.length > 0)
  }
})

test('worker result preserves request identity; stale request, revision and hash are rejected', () => {
  const input = config()
  const identity = { requestId: 'run-1', layoutRevision: 4, configHash: createConfigHash(input) }
  const response = executeAbmRequest({ type: 'generate', ...identity, config: input })
  assert.equal(response.type, 'result')
  assert.deepEqual(response.result, generateAbm(input))
  assert.equal(isCurrentAbmResponse(response, identity), true)
  for (const patch of [{ requestId: 'run-2' }, { layoutRevision: 5 }, { configHash: 'other' }]) {
    assert.equal(isCurrentAbmResponse(response, { ...identity, ...patch }), false)
  }
  assert.equal(isCurrentAbmResponse(response, null), false)
  assert.equal(executeAbmRequest({ type: 'generate', ...identity, layoutRevision: -1, config: input }).type, 'error')
  assert.equal(createConfigHash({ ...input, seed: 43 }) === identity.configHash, false)
  assert.equal(createConfigHash({ cohorts: input.cohorts, ...input }), identity.configHash)
})

const sampledJourney = (id, points, arrival = 10, duration = 20) => ({
  id, cohortId: id, groupId: id, onsiteArrivalSeconds: arrival, checkpointArrivalSeconds: arrival + duration / 2,
  routeNodeIds: points.map((_, index) => String(index)), points, walkSeconds: duration,
})

test('position sampling follows cumulative metre distance and clamps outside travel interval', () => {
  const sampler = prepareJourneySampler([sampledJourney('a', [[0, 0, 0], [3, 0, 4], [18, 0, 4]])])
  const output = new Float64Array(6)
  assert.equal(sampleJourneyPosition(sampler, 0, 0, output, 3), 'not-arrived')
  assert.deepEqual([...output.slice(3)], [0, 0, 0])
  assert.equal(sampleJourneyPosition(sampler, 0, 12.5, output), 'walking')
  assert.deepEqual([...output.slice(0, 3)], [1.5, 0, 2])
  sampleJourneyPosition(sampler, 0, 15, output)
  assert.deepEqual([...output.slice(0, 3)], [3, 0, 4])
  sampleJourneyPosition(sampler, 0, 20, output)
  assert.deepEqual([...output.slice(0, 3)], [8, 0, 4])
  assert.equal(sampleJourneyPosition(sampler, 0, 30, output), 'arrived')
  assert.deepEqual([...output.slice(0, 3)], [18, 0, 4])
  assert.equal(sampleJourneyPosition(sampler, 0, 1e6, output), 'arrived')
  assert.throws(() => sampleJourneyPosition(sampler, -1, 20, output), /out of range/)
  assert.throws(() => sampleJourneyPosition(sampler, 0, NaN, output), /finite/)
  assert.throws(() => sampleJourneyPosition(sampler, 0, 20, new Float64Array(2)), /three coordinates/)
})

test('repeated points and zero-distance routes sample without NaN', () => {
  const sampler = prepareJourneySampler([
    sampledJourney('repeated', [[0, 0, 0], [0, 0, 0], [10, 0, 0], [10, 0, 0]], 0, 10),
    sampledJourney('zero', [[3, 0, 4], [3, 0, 4]], 0, 0),
  ])
  const out = new Float32Array(3)
  sampleJourneyPosition(sampler, 0, 0, out)
  assert.deepEqual([...out], [0, 0, 0])
  sampleJourneyPosition(sampler, 0, 5, out)
  assert.deepEqual([...out], [5, 0, 0])
  assert.equal(sampleJourneyPosition(sampler, 1, 0, out), 'arrived')
  assert.deepEqual([...out], [3, 0, 4])
})

test('crowd sampling hides before/after travel, handles scrubbing, and spans capped population', () => {
  const points = [[0, 0, 0], [100, 0, 0]]
  const journeys = Array.from({ length: 100 }, (_, index) => sampledJourney(`person-${index}`, points, index, 1000))
  const sampler = prepareJourneySampler(journeys)
  const positions = new Float32Array(30)
  const indices = new Uint32Array(10)
  const stats = { visibleCount: 0, walkingCount: 0 }
  sampleWalkingCrowd(sampler, 100, positions, indices, stats)
  assert.deepEqual(stats, { visibleCount: 10, walkingCount: 100 })
  assert.deepEqual([...indices], [5, 15, 25, 35, 45, 55, 65, 75, 85, 95])
  sampleWalkingCrowd(sampler, -1, positions, indices, stats)
  assert.deepEqual(stats, { visibleCount: 0, walkingCount: 0 })
  sampleWalkingCrowd(sampler, 0, positions, indices, stats)
  assert.deepEqual(stats, { visibleCount: 1, walkingCount: 1 })
  sampleWalkingCrowd(sampler, 1100, positions, indices, stats)
  assert.deepEqual(stats, { visibleCount: 0, walkingCount: 0 })
  sampleWalkingCrowd(sampler, 10, positions, indices, stats)
  assert.deepEqual(stats, { visibleCount: 10, walkingCount: 11 })
  sampleWalkingCrowd(sampler, 10, new Float32Array(0), new Uint32Array(0), stats)
  assert.deepEqual(stats, { visibleCount: 0, walkingCount: 11 })
})
