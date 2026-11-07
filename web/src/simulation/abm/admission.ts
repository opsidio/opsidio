import type { AgentJourney, ServiceStation, ServiceStop } from '../runtime-types'

type Event = { journeyIndex: number; stopIndex: number; arrivalSeconds: number }
type RouteStop = Pick<ServiceStop, 'distanceM' | 'queueStartDistanceM' | 'queueEndDistanceM'> & { station: ServiceStation }
type AdmissionRoute = { stops: RouteStop[]; totalDistanceM: number }

function measureRoute(journey: AgentJourney, stations: Map<string, ServiceStation>): AdmissionRoute {
  const distances = new Float64Array(journey.points.length)
  for (let index = 1; index < journey.points.length; index++) {
    const point = journey.points[index], previous = journey.points[index - 1]
    distances[index] = distances[index - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2])
  }
  const stops: RouteStop[] = []
  let lastStationIndex = -1
  for (const [index, nodeId] of journey.routeNodeIds.entries()) {
    const station = stations.get(nodeId)
    if (!station) continue
    const stop: RouteStop = { station, distanceM: distances[index] }
    if (station.queueStartNodeId && station.queueEndNodeId) {
      const entrance = journey.routeNodeIds.indexOf(station.queueStartNodeId)
      const end = journey.routeNodeIds.indexOf(station.queueEndNodeId)
      if (entrance <= lastStationIndex || end <= entrance || end >= index || distances[end] <= distances[entrance]) {
        throw new Error(`Route to station ${station.id} must pass through the queue entrance and end in order before its checkpoint.`)
      }
      stop.queueStartDistanceM = distances[entrance]
      stop.queueEndDistanceM = distances[end]
    }
    stops.push(stop)
    lastStationIndex = index
  }
  return { stops, totalDistanceM: distances[distances.length - 1] }
}

/** Single-server FIFO stations. Process durations use the plan's fixed typical seconds. */
export function scheduleAdmission(journeys: AgentJourney[], stations: readonly ServiceStation[]): void {
  const byNode = new Map(stations.map(station => [station.nodeId, station]))
  if (byNode.size !== stations.length || new Set(stations.map(station => station.operatorId)).size !== stations.length || new Set(stations.map(station => station.id)).size !== stations.length) throw new Error('Service stations need unique IDs, checkpoints and operators.')
  for (const station of stations) {
    if (!Number.isFinite(station.serviceSeconds) || station.serviceSeconds <= 0 || !Number.isFinite(station.opensSeconds) || !Number.isFinite(station.closesSeconds) || station.closesSeconds <= station.opensSeconds) throw new Error(`Station ${station.id} has invalid service timing.`)
    const hasQueueBinding = station.queueStartNodeId !== undefined || station.queueEndNodeId !== undefined
    if (hasQueueBinding && (!station.queueStartNodeId?.trim() || !station.queueEndNodeId?.trim())) throw new Error(`Station ${station.id} needs both queue entrance and end nodes.`)
  }
  const freeAt = new Map(stations.map(station => [station.id, station.opensSeconds]))
  const queueIndices = new Map(stations.map(station => [station.id, 0]))
  const routeCache = new Map<AgentJourney['points'], AdmissionRoute>()
  const routeStops: RouteStop[][] = []
  const speeds = new Float64Array(journeys.length)
  const heap: Event[] = []
  const earlier = (a: Event, b: Event) => a.arrivalSeconds < b.arrivalSeconds || a.arrivalSeconds === b.arrivalSeconds && a.journeyIndex < b.journeyIndex
  function push(event: Event) {
    let index = heap.length
    heap.push(event)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (!earlier(event, heap[parent])) break
      heap[index] = heap[parent]
      index = parent
    }
    heap[index] = event
  }
  function pop(): Event {
    const first = heap[0], last = heap.pop()!
    if (heap.length) {
      let index = 0
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1
        if (child + 1 < heap.length && earlier(heap[child + 1], heap[child])) child++
        if (!earlier(heap[child], last)) break
        heap[index] = heap[child]
        index = child
      }
      heap[index] = last
    }
    return first
  }
  for (const [index, journey] of journeys.entries()) {
    let route = routeCache.get(journey.points)
    if (!route) {
      route = measureRoute(journey, byNode)
      routeCache.set(journey.points, route)
    }
    speeds[index] = journey.walkSeconds > 0 ? route.totalDistanceM / journey.walkSeconds : 1
    routeStops[index] = route.stops
    journey.serviceStops = []
    journey.completionSeconds = journey.onsiteArrivalSeconds + journey.walkSeconds
    const first = route.stops[0]
    if (first) push({ journeyIndex: index, stopIndex: 0, arrivalSeconds: journey.onsiteArrivalSeconds + (first.queueStartDistanceM ?? first.distanceM) / speeds[index] })
  }
  while (heap.length) {
    const event = pop()
    const journey = journeys[event.journeyIndex]
    const stop = routeStops[event.journeyIndex][event.stopIndex]
    const { station, ...routeDistances } = stop
    const speed = speeds[event.journeyIndex]
    const walkToStation = (stop.distanceM - (stop.queueStartDistanceM ?? stop.distanceM)) / speed
    const start = Math.max(event.arrivalSeconds + walkToStation, freeAt.get(station.id)!)
    const end = start + station.serviceSeconds
    const served = end <= station.closesSeconds
    const queueIndex = queueIndices.get(station.id)!
    queueIndices.set(station.id, queueIndex + 1)
    journey.serviceStops!.push({
      stationId: station.id, operatorId: station.operatorId, ...routeDistances,
      arrivalSeconds: event.arrivalSeconds,
      startSeconds: served ? start : null, endSeconds: served ? end : null, queueIndex,
    })
    // Once the FIFO head cannot finish by closing, later visitors cannot take its place.
    freeAt.set(station.id, served ? end : Infinity)
    if (!served) {
      journey.completionSeconds = null
      continue
    }
    const next = routeStops[event.journeyIndex][event.stopIndex + 1]
    if (next) {
      const distanceToNextQueue = (next.queueStartDistanceM ?? next.distanceM) - stop.distanceM
      push({ journeyIndex: event.journeyIndex, stopIndex: event.stopIndex + 1, arrivalSeconds: end + distanceToNextQueue / speed })
    } else {
      const remainingWalk = journey.walkSeconds - stop.distanceM / speed
      journey.completionSeconds = end + Math.max(0, remainingWalk)
    }
  }
}
