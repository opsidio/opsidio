import assert from 'node:assert/strict'
import test from 'node:test'
import { Color } from 'three'
import { createOperatorQueueStates, prepareJourneySampler, sampleJourneyPosition, sampleJourneyWaitSeconds, sampleOperatorQueueStates, sampleWalkingCrowd } from './sampling.ts'
import { QUEUE_BAR_MAX_COUNT, WAIT_ORANGE_SECONDS, WAIT_RED_SECONDS, queueBarHeightM, writeWaitColor } from './wait-visuals.ts'

const stop = (queueIndex, arrivalSeconds, startSeconds, endSeconds, stationId = 'scan', operatorId = 'scan-op') => ({
  stationId, operatorId, distanceM: 10, queueIndex, arrivalSeconds, startSeconds, endSeconds,
})
const journey = (id, serviceStops) => ({
  id, cohortId: 'test', groupId: id, onsiteArrivalSeconds: 0, checkpointArrivalSeconds: 10,
  routeNodeIds: ['start', 'scan', 'end'], points: [[0, 0, 0], [10, 0, 0], [100, 0, 0]],
  walkSeconds: 100, serviceStops, completionSeconds: serviceStops.at(-1).endSeconds === null ? null : 200,
})
const pennedJourney = (id, queueIndex, arrival, start, end, speed = 1) => ({
  ...journey(id, [{ ...stop(queueIndex, arrival, start, end), queueStartDistanceM: 2, queueEndDistanceM: 8 }]),
  onsiteArrivalSeconds: arrival - 2 / speed,
  walkSeconds: 100 / speed,
})

test('operator queues separate waiting from processing at exact boundaries and retain unserved people', () => {
  const sampler = prepareJourneySampler([
    journey('a', [stop(0, 10, 20, 30)]), journey('b', [stop(1, 10, 30, 40)]),
    journey('c', [stop(2, 11, 40, 50)]), journey('pending', [stop(3, 12, null, null)]),
    journey('other', [stop(0, 5, 5, 15, 'security', 'security-op')]),
  ])
  const states = createOperatorQueueStates(sampler, ['scan-op', 'security-op', 'idle-help'])
  const sample = seconds => {
    assert.equal(sampleOperatorQueueStates(sampler, seconds, states), states)
    return states[0]
  }
  assert.deepEqual(sample(9), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 0, overflowCount: 0, oldestWaitSeconds: 0, processing: false })
  assert.equal(states[1].processing, true)
  assert.deepEqual(sample(10), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 2, overflowCount: 2, oldestWaitSeconds: 0, processing: false })
  assert.deepEqual(sample(20), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 3, overflowCount: 3, oldestWaitSeconds: 10, processing: true })
  assert.deepEqual(sample(30), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 2, overflowCount: 2, oldestWaitSeconds: 19, processing: true })
  assert.deepEqual(sample(50), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 1, overflowCount: 1, oldestWaitSeconds: 38, processing: false })
  assert.equal(sample(1000).oldestWaitSeconds, 988)
  assert.equal(sample(15).queuedCount, 4, 'scrubbing backwards recomputes rather than retaining future state')
  assert.deepEqual(states[2], { operatorId: 'idle-help', stationId: null, queuedCount: 0, overflowCount: 0, oldestWaitSeconds: 0, processing: false })
  assert.throws(() => sample(NaN), /finite/)
})

test('person shading uses only the current station wait and resets at service start', () => {
  const sampler = prepareJourneySampler([
    journey('two-stops', [stop(0, 10, 20, 30), { ...stop(0, 60, 70, 80, 'security', 'security-op'), distanceM: 40 }]),
    journey('unserved', [stop(1, 15, null, null)]),
  ])
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 5), 0)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 10), 0)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 19), 9)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 20), 0)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 55), 0)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 65), 5)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 70), 0)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 100), 0)
  assert.equal(sampleJourneyWaitSeconds(sampler, 1, 1000), 985)
  assert.equal(sampleJourneyWaitSeconds(sampler, 0, 15), 5)
})

test('crowd holds only as many attendees as the authored pen fits and counts overflow', () => {
  const sampler = prepareJourneySampler(Array.from({ length: 100 }, (_, index) => pennedJourney(String(index), index, index + 2, null, null)))
  const positions = new Float32Array(300), indices = new Uint32Array(100)
  const stats = sampleWalkingCrowd(sampler, 200, positions, indices)
  const states = createOperatorQueueStates(sampler)
  sampleOperatorQueueStates(sampler, 200, states)
  assert.equal(stats.visibleCount, 8)
  assert.equal(stats.visibleWaitingCount, 8)
  assert.equal(stats.overflowWaitingCount, 92)
  assert.equal(stats.waitingCount, 100)
  assert.equal(states[0].queuedCount, 100)
  assert.equal(states[0].overflowCount, 92)
  assert.equal(states[0].oldestWaitSeconds, 198)
  assert.deepEqual([...indices.subarray(0, 8)], [0, 1, 2, 3, 4, 5, 6, 7])
  for (let index = 0; index < stats.visibleCount; index++) {
    const distance = positions[index * 3]
    assert.ok(distance >= 2 && distance <= 8)
    if (index > 0) assert.ok(positions[(index - 1) * 3] - distance >= 0.799)
  }
})

test('crowd omits unbound waiters but retains processing people and full queue totals', () => {
  const sampler = prepareJourneySampler([
    journey('being-processed', [stop(0, 10, 10, 30)]),
    journey('waiting-off-scene', [stop(1, 10, null, null)]),
  ])
  const indices = new Uint32Array(2)
  const stats = sampleWalkingCrowd(sampler, 15, new Float32Array(6), indices)
  assert.equal(stats.visibleCount, 1)
  assert.equal(stats.processingCount, 1)
  assert.equal(stats.waitingCount, 1)
  assert.equal(stats.visibleWaitingCount, 0)
  assert.equal(stats.overflowWaitingCount, 1)
  assert.equal(indices[0], 0)
})

test('pen entry, FIFO advancement, call-up, and departure follow one continuous route', () => {
  const sampler = prepareJourneySampler([
    pennedJourney('first', 0, 2, 30, 39),
    pennedJourney('faster-follower', 1, 2.2, 39, 48, 1.2),
    pennedJourney('third', 2, 2.4, null, null),
  ])
  const output = new Float64Array(3)
  const expectPosition = (index, seconds, phase, x) => {
    assert.equal(sampleJourneyPosition(sampler, index, seconds, output), phase)
    assert.ok(Math.abs(output[0] - x) < 1e-6, `position at ${seconds}: ${output[0]} != ${x}`)
  }
  expectPosition(0, 1.99, 'walking', 1.99)
  expectPosition(0, 2, 'waiting', 2)
  expectPosition(0, 3, 'waiting', 3)
  expectPosition(1, 3, 'waiting', 2.2)
  expectPosition(0, 28, 'waiting', 8)
  expectPosition(1, 28, 'waiting', 7.2)
  expectPosition(0, 28.375, 'waiting', 8.375)
  expectPosition(1, 28.375, 'waiting', 7.575)
  expectPosition(0, 29.99, 'waiting', 9.99)
  expectPosition(0, 30, 'processing', 10)
  expectPosition(0, 39, 'walking', 10)
  expectPosition(0, 39.1, 'walking', 10.1)
  expectPosition(0, 2, 'waiting', 2)
  const indices = new Uint32Array(3)
  const stats = sampleWalkingCrowd(sampler, 2.4, new Float32Array(9), indices)
  assert.equal(stats.visibleCount, 1, 'faster arrivals wait off scene until they can follow with separation')
  assert.equal(stats.waitingCount, 3)
  assert.equal(stats.overflowWaitingCount, 2)
  assert.equal(indices[0], 0)
})

test('an uncongested visitor keeps walking at free-flow speed through the pen to service', () => {
  const sampler = prepareJourneySampler([pennedJourney('alone', 0, 2, 10, 19)])
  const output = new Float64Array(3)
  for (const seconds of [1.99, 2, 2.01, 5, 7.99, 8, 8.01, 9.99, 10]) {
    sampleJourneyPosition(sampler, 0, seconds, output)
    assert.ok(Math.abs(output[0] - seconds) < 1e-6, `position at ${seconds}: ${output[0]}`)
  }
})

test('wait color continuously reddens through the editable visual thresholds and saturates', () => {
  const output = new Color()
  let previousRedShare = 0, previousGreen = Infinity
  for (let seconds = 0; seconds <= WAIT_RED_SECONDS; seconds += 5) {
    assert.equal(writeWaitColor(seconds, output), output)
    const redShare = output.r / (output.r + output.g + output.b)
    assert.ok(redShare >= previousRedShare)
    assert.ok(output.g <= previousGreen)
    previousRedShare = redShare; previousGreen = output.g
  }
  assert.equal(writeWaitColor(0, output).getHexString(), 'f4cf4b')
  assert.equal(writeWaitColor(WAIT_ORANGE_SECONDS, output).getHexString(), 'ef8c2f')
  assert.equal(writeWaitColor(WAIT_RED_SECONDS, output).getHexString(), 'db302c')
  assert.equal(writeWaitColor(WAIT_RED_SECONDS * 10, output).getHexString(), 'db302c')
  assert.equal(writeWaitColor(-10, output).getHexString(), 'f4cf4b')
})

test('bar height rises monotonically with the full queue and caps its geometry only', () => {
  let previous = 0
  assert.equal(QUEUE_BAR_MAX_COUNT, 5000)
  for (const count of [0, 1, 10, 100, 500, 1000, 2000, 4000, QUEUE_BAR_MAX_COUNT]) {
    const height = queueBarHeightM(count)
    assert.ok(height > previous)
    previous = height
  }
  assert.equal(queueBarHeightM(QUEUE_BAR_MAX_COUNT * 10), queueBarHeightM(QUEUE_BAR_MAX_COUNT))
  assert.equal(queueBarHeightM(-10), queueBarHeightM(0))
})
