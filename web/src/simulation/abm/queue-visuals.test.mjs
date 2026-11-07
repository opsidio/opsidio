import assert from 'node:assert/strict'
import test from 'node:test'
import { Color } from 'three'
import { createOperatorQueueStates, prepareJourneySampler, sampleJourneyWaitSeconds, sampleOperatorQueueStates, sampleWalkingCrowd } from './sampling.ts'
import { QUEUE_BAR_MAX_COUNT, WAIT_ORANGE_SECONDS, WAIT_RED_SECONDS, queueBarHeightM, writeWaitColor } from './wait-visuals.ts'

const stop = (queueIndex, arrivalSeconds, startSeconds, endSeconds, stationId = 'scan', operatorId = 'scan-op') => ({
  stationId, operatorId, distanceM: 10, queueIndex, arrivalSeconds, startSeconds, endSeconds,
})
const journey = (id, serviceStops) => ({
  id, cohortId: 'test', groupId: id, onsiteArrivalSeconds: 0, checkpointArrivalSeconds: 10,
  routeNodeIds: ['start', 'scan', 'end'], points: [[0, 0, 0], [10, 0, 0], [100, 0, 0]],
  walkSeconds: 100, serviceStops, completionSeconds: serviceStops.at(-1).endSeconds === null ? null : 200,
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
  assert.deepEqual(sample(9), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 0, oldestWaitSeconds: 0, processing: false })
  assert.equal(states[1].processing, true)
  assert.deepEqual(sample(10), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 2, oldestWaitSeconds: 0, processing: false })
  assert.deepEqual(sample(20), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 3, oldestWaitSeconds: 10, processing: true })
  assert.deepEqual(sample(30), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 2, oldestWaitSeconds: 19, processing: true })
  assert.deepEqual(sample(50), { operatorId: 'scan-op', stationId: 'scan', queuedCount: 1, oldestWaitSeconds: 38, processing: false })
  assert.equal(sample(1000).oldestWaitSeconds, 988)
  assert.equal(sample(15).queuedCount, 4, 'scrubbing backwards recomputes rather than retaining future state')
  assert.deepEqual(states[2], { operatorId: 'idle-help', stationId: null, queuedCount: 0, oldestWaitSeconds: 0, processing: false })
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

test('bar count includes the whole queue when the crowd display shows only its front 32', () => {
  const sampler = prepareJourneySampler(Array.from({ length: 100 }, (_, index) => journey(String(index), [stop(index, index, null, null)])))
  const stats = sampleWalkingCrowd(sampler, 100, new Float32Array(300), new Uint32Array(100))
  const states = createOperatorQueueStates(sampler)
  sampleOperatorQueueStates(sampler, 100, states)
  assert.equal(stats.visibleCount, 32)
  assert.equal(stats.waitingCount, 100)
  assert.equal(states[0].queuedCount, 100)
  assert.equal(states[0].oldestWaitSeconds, 100)
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
