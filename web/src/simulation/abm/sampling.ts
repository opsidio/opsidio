import type { AgentJourney } from '../runtime-types'

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
}
export type PositionTarget = { [index: number]: number; length: number }
export type JourneyPhase = 'not-arrived' | 'walking' | 'arrived'
export type CrowdSampleStats = { visibleCount: number; walkingCount: number }

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
  return sampler
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

function writePosition(sampler: JourneySampler, index: number, seconds: number, output: PositionTarget, offset: number): JourneyPhase {
  const route = sampler.routes[sampler.routeIndices[index]]
  const elapsed = seconds - sampler.arrivalSeconds[index]
  const duration = sampler.walkSeconds[index]
  let phase: JourneyPhase
  let distance: number
  if (elapsed < 0) { phase = 'not-arrived'; distance = 0 }
  else if (elapsed >= duration) { phase = 'arrived'; distance = route.totalM }
  else { phase = 'walking'; distance = route.totalM * elapsed / duration }
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
