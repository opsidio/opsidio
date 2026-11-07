import type { AgentJourney, ServiceStop } from '../runtime-types'

type PreparedQueue = {
  stationId: string; operatorId: string
  arrivals: Float64Array; starts: Float64Array; ends: Float64Array; indices: Uint32Array
  sampledAt: number; started: number
}
type PreparedMotions = { starts: Float64Array; ends: Float64Array; indices: Uint32Array; maxDuration: number }
type PreparedRoute = { coordinates: Float64Array; cumulativeM: Float64Array; totalM: number }
export type JourneySampler = {
  routes: PreparedRoute[]
  routeIndices: Uint32Array
  arrivalSeconds: Float64Array
  walkSeconds: Float64Array
  arrivalOrder: Uint32Array
  orderedArrivals: Float64Array
  maxWalkSeconds: number
  count: number
  stops?: readonly ServiceStop[][]
  queues?: Map<string, PreparedQueue>
  operatorQueues?: Map<string, PreparedQueue>
  motions?: PreparedMotions
  completed?: Float64Array
}
export type PositionTarget = { [index: number]: number; length: number }
export type JourneyPhase = 'not-arrived' | 'walking' | 'waiting' | 'processing' | 'arrived'
export type CrowdSampleStats = { visibleCount: number; walkingCount: number; waitingCount?: number; processingCount?: number; completedCount?: number }
export type OperatorQueueState = {
  operatorId: string
  /** Null means this operator has no authored service queue in this result. */
  stationId: string | null
  queuedCount: number
  oldestWaitSeconds: number
  processing: boolean
}

/** Compile once per result. Shared route geometry is stored only once. */
export function prepareJourneySampler(journeys: readonly AgentJourney[]): JourneySampler {
  const count = journeys.length
  const sampler: JourneySampler = {
    count, routes: [], routeIndices: new Uint32Array(count), arrivalSeconds: new Float64Array(count),
    walkSeconds: new Float64Array(count), arrivalOrder: new Uint32Array(count),
    orderedArrivals: new Float64Array(count), maxWalkSeconds: 0,
  }
  const referenceRoutes = new Map<AgentJourney['points'], number>()
  const geometryRoutes = new Map<string, number>()
  for (let index = 0; index < count; index++) {
    const journey = journeys[index]
    if (!Number.isFinite(journey.onsiteArrivalSeconds) || !Number.isFinite(journey.walkSeconds)
      || journey.walkSeconds < 0 || !Number.isFinite(journey.onsiteArrivalSeconds + journey.walkSeconds)) {
      throw new Error(`Journey "${journey.id}" has invalid movement timing.`)
    }
    let routeIndex = referenceRoutes.get(journey.points)
    if (routeIndex === undefined) {
      if (!Array.isArray(journey.points) || journey.points.length === 0
        || journey.points.some(point => !Array.isArray(point) || point.length !== 3 || point.some(value => !Number.isFinite(value)))) {
        throw new Error(`Journey "${journey.id}" has invalid route points.`)
      }
      const key = JSON.stringify(journey.points)
      routeIndex = geometryRoutes.get(key)
      if (routeIndex === undefined) {
        const coordinates = new Float64Array(journey.points.length * 3)
        const cumulativeM = new Float64Array(journey.points.length)
        for (let point = 0; point < journey.points.length; point++) {
          coordinates.set(journey.points[point], point * 3)
          if (point > 0) cumulativeM[point] = cumulativeM[point - 1] + Math.hypot(
            coordinates[point * 3] - coordinates[(point - 1) * 3],
            coordinates[point * 3 + 1] - coordinates[(point - 1) * 3 + 1],
            coordinates[point * 3 + 2] - coordinates[(point - 1) * 3 + 2],
          )
        }
        const totalM = cumulativeM[cumulativeM.length - 1]
        if (!Number.isFinite(totalM)) throw new Error(`Journey "${journey.id}" has non-finite route length.`)
        routeIndex = sampler.routes.length
        sampler.routes.push({ coordinates, cumulativeM, totalM })
        geometryRoutes.set(key, routeIndex)
      }
      referenceRoutes.set(journey.points, routeIndex)
    }
    sampler.routeIndices[index] = routeIndex
    sampler.arrivalSeconds[index] = journey.onsiteArrivalSeconds
    sampler.walkSeconds[index] = journey.walkSeconds
    sampler.maxWalkSeconds = Math.max(sampler.maxWalkSeconds, journey.walkSeconds)
    sampler.arrivalOrder[index] = index
  }
  sampler.arrivalOrder.sort((a, b) => sampler.arrivalSeconds[a] - sampler.arrivalSeconds[b] || a - b)
  for (let index = 0; index < count; index++) sampler.orderedArrivals[index] = sampler.arrivalSeconds[sampler.arrivalOrder[index]]
  if (journeys.some(journey => journey.serviceStops?.length)) prepareAdmission(sampler, journeys)
  return sampler
}

function prepareAdmission(sampler: JourneySampler, journeys: readonly AgentJourney[]) {
  const grouped = new Map<string, { stop: ServiceStop; index: number }[]>()
  const motionStarts: number[] = [], motionEnds: number[] = [], motionIndices: number[] = [], completed: number[] = []
  sampler.stops = journeys.map(journey => journey.serviceStops ?? [])
  let maxDuration = 0
  for (const [index, journey] of journeys.entries()) {
    const route = sampler.routes[sampler.routeIndices[index]]
    const speed = journey.walkSeconds > 0 ? route.totalM / journey.walkSeconds : 1
    let time = journey.onsiteArrivalSeconds, distance = 0
    function movement(end: number) {
      if (end > time) {
        motionStarts.push(time); motionEnds.push(end); motionIndices.push(index)
        maxDuration = Math.max(maxDuration, end - time)
      }
    }
    for (const stop of journey.serviceStops ?? []) {
      movement(stop.arrivalSeconds)
      const entries = grouped.get(stop.stationId) ?? []
      entries.push({ stop, index }); grouped.set(stop.stationId, entries)
      time = stop.endSeconds ?? Infinity
      distance = stop.distanceM
    }
    if (Number.isFinite(time)) movement(time + Math.max(0, route.totalM - distance) / speed)
    const completion = journey.completionSeconds ?? (journey.serviceStops?.length ? Infinity : journey.onsiteArrivalSeconds + journey.walkSeconds)
    if (Number.isFinite(completion)) completed.push(completion)
  }
  sampler.queues = new Map([...grouped].map(([id, entries]) => {
    entries.sort((a, b) => a.stop.queueIndex - b.stop.queueIndex)
    return [id, { stationId: id, operatorId: entries[0].stop.operatorId, arrivals: Float64Array.from(entries, item => item.stop.arrivalSeconds), starts: Float64Array.from(entries, item => item.stop.startSeconds ?? Infinity), ends: Float64Array.from(entries, item => item.stop.endSeconds ?? Infinity), indices: Uint32Array.from(entries, item => item.index), sampledAt: NaN, started: 0 }]
  }))
  sampler.operatorQueues = new Map([...sampler.queues.values()].map(queue => [queue.operatorId, queue]))
  const order = Uint32Array.from(motionStarts, (_, index) => index)
  order.sort((a, b) => motionStarts[a] - motionStarts[b] || motionIndices[a] - motionIndices[b])
  sampler.motions = { starts: Float64Array.from(order, index => motionStarts[index]), ends: Float64Array.from(order, index => motionEnds[index]), indices: Uint32Array.from(order, index => motionIndices[index]), maxDuration }
  sampler.completed = Float64Array.from(completed.sort((a, b) => a - b))
}

function upperBound(values: Float64Array, value: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = low + ((high - low) >>> 1)
    if (values[mid] <= value) low = mid + 1
    else high = mid
  }
  return low
}

/** Allocate once, including explicitly requested idle operators. Reuse with sampleOperatorQueueStates. */
export function createOperatorQueueStates(sampler: JourneySampler, operatorIds?: readonly string[]): OperatorQueueState[] {
  return [...(operatorIds ?? sampler.operatorQueues?.keys() ?? [])].map(operatorId => ({
    operatorId, stationId: sampler.operatorQueues?.get(operatorId)?.stationId ?? null,
    queuedCount: 0, oldestWaitSeconds: 0, processing: false,
  }))
}

/** Full FIFO queue counts, independent of the bounded crowd display. O(operators × log queue length). */
export function sampleOperatorQueueStates(
  sampler: JourneySampler, seconds: number, output: OperatorQueueState[],
): OperatorQueueState[] {
  if (!Number.isFinite(seconds)) throw new RangeError('Sample time must be finite.')
  for (const state of output) {
    const queue = sampler.operatorQueues?.get(state.operatorId)
    if (!queue) {
      state.stationId = null; state.queuedCount = 0; state.oldestWaitSeconds = 0; state.processing = false
      continue
    }
    const arrived = upperBound(queue.arrivals, seconds), started = upperBound(queue.starts, seconds)
    queue.started = started; queue.sampledAt = seconds
    state.stationId = queue.stationId
    state.queuedCount = Math.max(0, arrived - started)
    state.oldestWaitSeconds = state.queuedCount > 0 ? Math.max(0, seconds - queue.arrivals[started]) : 0
    state.processing = started > 0 && queue.ends[started - 1] > seconds
  }
  return output
}

/** Current uninterrupted wait only; returns zero before arrival, while processing, or after service. */
export function sampleJourneyWaitSeconds(sampler: JourneySampler, journeyIndex: number, seconds: number): number {
  if (!Number.isInteger(journeyIndex) || journeyIndex < 0 || journeyIndex >= sampler.count) throw new RangeError('Journey index is out of range.')
  if (!Number.isFinite(seconds)) throw new RangeError('Sample time must be finite.')
  for (const stop of sampler.stops?.[journeyIndex] ?? []) {
    if (seconds < stop.arrivalSeconds) break
    if (stop.startSeconds === null || seconds < stop.startSeconds) return Math.max(0, seconds - stop.arrivalSeconds)
  }
  return 0
}

function writePosition(sampler: JourneySampler, index: number, seconds: number, output: PositionTarget, offset: number): JourneyPhase {
  const route = sampler.routes[sampler.routeIndices[index]]
  const elapsed = seconds - sampler.arrivalSeconds[index]
  const duration = sampler.walkSeconds[index]
  let phase: JourneyPhase
  let distance: number
  if (elapsed < 0) { phase = 'not-arrived'; distance = 0 }
  else if (elapsed >= duration) { phase = 'arrived'; distance = route.totalM }
  else { phase = 'walking'; distance = route.totalM * elapsed / duration }
  if (elapsed >= 0 && sampler.queues && sampler.stops) {
    let delay = 0
    phase = 'walking'
    distance = route.totalM * elapsed / duration
    for (const stop of sampler.stops[index]) {
      if (seconds < stop.arrivalSeconds) break
      if (stop.startSeconds === null || seconds < stop.startSeconds) {
        const queue = sampler.queues.get(stop.stationId)!
        if (queue.sampledAt !== seconds) { queue.started = upperBound(queue.starts, seconds); queue.sampledAt = seconds }
        const rank = Math.max(0, stop.queueIndex - queue.started)
        phase = 'waiting'; distance = Math.max(0, stop.distanceM - (rank + 1) * 0.8)
        break
      }
      if (stop.endSeconds !== null && seconds < stop.endSeconds) {
        phase = 'processing'; distance = stop.distanceM
        break
      }
      delay += stop.endSeconds! - stop.arrivalSeconds
      distance = route.totalM * Math.max(0, elapsed - delay) / duration
    }
    if (phase === 'walking' && distance >= route.totalM) phase = 'arrived'
  }
  const last = route.cumulativeM.length - 1
  if (distance >= route.totalM || last === 0) {
    output[offset] = route.coordinates[last * 3]
    output[offset + 1] = route.coordinates[last * 3 + 1]
    output[offset + 2] = route.coordinates[last * 3 + 2]
  } else {
    // Upper bound skips repeated points / zero-length segments without dividing by zero.
    const end = Math.min(last, upperBound(route.cumulativeM, distance))
    const start = Math.max(0, end - 1)
    const length = route.cumulativeM[end] - route.cumulativeM[start]
    const fraction = length > 0 ? (distance - route.cumulativeM[start]) / length : 0
    for (let axis = 0; axis < 3; axis++) {
      const origin = route.coordinates[start * 3 + axis]
      output[offset + axis] = origin + (route.coordinates[end * 3 + axis] - origin) * fraction
    }
  }
  return phase
}

/** Allocation-free if the caller reuses output. Before/after travel clamps to endpoints. */
export function sampleJourneyPosition(
  sampler: JourneySampler, journeyIndex: number, seconds: number, output: PositionTarget, offset = 0,
): JourneyPhase {
  if (!Number.isInteger(journeyIndex) || journeyIndex < 0 || journeyIndex >= sampler.count) throw new RangeError('Journey index is out of range.')
  if (!Number.isFinite(seconds)) throw new RangeError('Sample time must be finite.')
  if (!Number.isInteger(offset) || offset < 0 || output.length < offset + 3) throw new RangeError('Position output needs three coordinates at the offset.')
  return writePosition(sampler, journeyIndex, seconds, output, offset)
}

function sampleAdmissionCrowd(sampler: JourneySampler, seconds: number, positions: Float32Array, indices: Uint32Array, stats: CrowdSampleStats): CrowdSampleStats {
  const capacity = Math.min(Math.floor(positions.length / 3), indices.length)
  let written = 0, waiting = 0, processing = 0, walking = 0
  for (const queue of sampler.queues!.values()) {
    const arrived = upperBound(queue.arrivals, seconds)
    const started = upperBound(queue.starts, seconds)
    queue.started = started; queue.sampledAt = seconds
    waiting += Math.max(0, arrived - started)
    for (let rank = started; rank < Math.min(arrived, started + 32) && written < capacity; rank++) {
      indices[written] = queue.indices[rank]
      writePosition(sampler, queue.indices[rank], seconds, positions, written * 3)
      written++
    }
    if (started > 0 && queue.ends[started - 1] > seconds) {
      processing++
      if (written < capacity) {
        indices[written] = queue.indices[started - 1]
        writePosition(sampler, queue.indices[started - 1], seconds, positions, written * 3)
        written++
      }
    }
  }
  const motions = sampler.motions!
  const first = upperBound(motions.starts, seconds - motions.maxDuration), last = upperBound(motions.starts, seconds)
  for (let order = first; order < last; order++) {
    if (motions.ends[order] <= seconds) continue
    walking++
    if (written < capacity) {
      indices[written] = motions.indices[order]
      writePosition(sampler, motions.indices[order], seconds, positions, written * 3)
      written++
    }
  }
  stats.visibleCount = written; stats.walkingCount = walking
  stats.waitingCount = waiting; stats.processingCount = processing
  stats.completedCount = upperBound(sampler.completed!, seconds)
  return stats
}

/**
 * Writes packed XYZ positions and original journey indices for walking people.
 * Uses a bounded, binary-searched arrival interval, not a full population scan.
 * If capped, samples evenly through active arrival order across cohorts and time.
 * Passing a reusable stats object makes the entire frame allocation-free.
 */
export function sampleWalkingCrowd(
  sampler: JourneySampler, seconds: number, positions: Float32Array, journeyIndices: Uint32Array,
  stats: CrowdSampleStats = { visibleCount: 0, walkingCount: 0 },
): CrowdSampleStats {
  if (!Number.isFinite(seconds)) throw new RangeError('Sample time must be finite.')
  if (sampler.queues) return sampleAdmissionCrowd(sampler, seconds, positions, journeyIndices, stats)
  const capacity = Math.min(Math.floor(positions.length / 3), journeyIndices.length)
  const first = upperBound(sampler.orderedArrivals, seconds - sampler.maxWalkSeconds)
  const last = upperBound(sampler.orderedArrivals, seconds)
  let walkingCount = 0
  for (let order = first; order < last; order++) {
    const index = sampler.arrivalOrder[order]
    if (sampler.arrivalSeconds[index] + sampler.walkSeconds[index] > seconds) walkingCount++
  }
  const visibleCount = Math.min(capacity, walkingCount)
  let written = 0
  let activeRank = 0
  let targetRank = visibleCount > 0 ? Math.floor(walkingCount / visibleCount / 2) : Infinity
  for (let order = first; order < last && written < visibleCount; order++) {
    const index = sampler.arrivalOrder[order]
    if (sampler.arrivalSeconds[index] + sampler.walkSeconds[index] <= seconds) continue
    if (activeRank === targetRank) {
      journeyIndices[written] = index
      writePosition(sampler, index, seconds, positions, written * 3)
      written++
      targetRank = Math.floor((written + 0.5) * walkingCount / visibleCount)
    }
    activeRank++
  }
  stats.visibleCount = written
  stats.walkingCount = walkingCount
  return stats
}
