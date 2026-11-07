import type { AgentJourney, ServiceStation } from '../runtime-types'

type Event = { journeyIndex: number; stopIndex: number; arrivalSeconds: number }
type RouteStop = { station: ServiceStation; distanceM: number }

/** Single-server FIFO stations. Process durations use the plan's fixed typical seconds. */
export function scheduleAdmission(journeys: AgentJourney[], stations: readonly ServiceStation[]): void {
  const byNode = new Map(stations.map(station => [station.nodeId, station]))
  if (byNode.size !== stations.length || new Set(stations.map(station => station.operatorId)).size !== stations.length) throw new Error('Service stations need unique checkpoint and operator bindings.')
  for (const station of stations) {
    if (!Number.isFinite(station.serviceSeconds) || station.serviceSeconds <= 0 || !Number.isFinite(station.opensSeconds) || !Number.isFinite(station.closesSeconds) || station.closesSeconds <= station.opensSeconds) throw new Error(`Station ${station.id} has invalid service timing.`)
  }
  const freeAt = new Map(stations.map(station => [station.id, station.opensSeconds]))
  const queueIndices = new Map(stations.map(station => [station.id, 0]))
  const routeCache = new Map<AgentJourney['points'], RouteStop[]>()
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
    let stops = routeCache.get(journey.points)
    let totalDistance = 0
    for (let point = 1; point < journey.points.length; point++) totalDistance += Math.hypot(...journey.points[point].map((value, axis) => value - journey.points[point - 1][axis]))
    speeds[index] = journey.walkSeconds > 0 ? totalDistance / journey.walkSeconds : 1
    if (!stops) {
      stops = []
      let distanceM = 0
      for (let point = 0; point < journey.routeNodeIds.length; point++) {
        if (point > 0) distanceM += Math.hypot(...journey.points[point].map((value, axis) => value - journey.points[point - 1][axis]))
        const station = byNode.get(journey.routeNodeIds[point])
        if (station) stops.push({ station, distanceM })
      }
      routeCache.set(journey.points, stops)
    }
    routeStops[index] = stops
    journey.serviceStops = []
    journey.completionSeconds = journey.onsiteArrivalSeconds + journey.walkSeconds
    if (stops.length) push({ journeyIndex: index, stopIndex: 0, arrivalSeconds: journey.onsiteArrivalSeconds + stops[0].distanceM / speeds[index] })
  }
  while (heap.length) {
    const event = pop()
    const journey = journeys[event.journeyIndex]
    const stop = routeStops[event.journeyIndex][event.stopIndex]
    const start = Math.max(event.arrivalSeconds, freeAt.get(stop.station.id)!)
    const served = start + stop.station.serviceSeconds <= stop.station.closesSeconds
    const end = start + stop.station.serviceSeconds
    const queueIndex = queueIndices.get(stop.station.id)!
    queueIndices.set(stop.station.id, queueIndex + 1)
    journey.serviceStops!.push({ stationId: stop.station.id, operatorId: stop.station.operatorId, distanceM: stop.distanceM, arrivalSeconds: event.arrivalSeconds, startSeconds: served ? start : null, endSeconds: served ? end : null, queueIndex })
    if (!served) {
      journey.completionSeconds = null
      continue
    }
    freeAt.set(stop.station.id, end)
    const next = routeStops[event.journeyIndex][event.stopIndex + 1]
    if (next) push({ journeyIndex: event.journeyIndex, stopIndex: event.stopIndex + 1, arrivalSeconds: end + (next.distanceM - stop.distanceM) / speeds[event.journeyIndex] })
    else {
      const remainingWalk = journey.walkSeconds - stop.distanceM / speeds[event.journeyIndex]
      journey.completionSeconds = end + Math.max(0, remainingWalk)
    }
  }
}
