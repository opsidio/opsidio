import type { AgentJourney } from '../runtime-types'
import type { Point, RouteLine } from '../types'

export type TraceOrigin = { id: string; label: string; mode?: string }
export type WaypointTraceResult = {
  total: number
  origins: { id: string; label: string; color: string; count: number; routes: RouteLine[] }[]
  routes: RouteLine[]
}

const originColors: Record<string, string> = {
  mrt: '#775bb1',
  parking: '#3f83ae',
  taxi_ride_hailing: '#bc743d',
}

/** Use generated path prefixes and their resolved coordinates, including authored detours. */
export function traceWaypoint(
  journeys: readonly Pick<AgentJourney, 'routeNodeIds' | 'points'>[],
  waypointId: string,
  origins: readonly TraceOrigin[],
): WaypointTraceResult {
  const sources = new Map(origins.map(origin => [origin.id, {
    id: origin.id,
    label: origin.mode === 'taxi_ride_hailing' ? 'Taxi & ride-hailing drop-off' : origin.label,
    color: originColors[origin.mode ?? ''] ?? '#567b6b',
    count: 0,
    segments: new Map<string, [Point, Point]>(),
  }]))
  // The generator shares route arrays among people using the same path.
  const paths = new Map<readonly string[], { points: readonly Point[]; count: number }>()
  for (const journey of journeys) {
    const path = paths.get(journey.routeNodeIds)
    if (path) path.count++
    else paths.set(journey.routeNodeIds, { points: journey.points, count: 1 })
  }
  let total = 0
  for (const [nodeIds, path] of paths) {
    const index = nodeIds.indexOf(waypointId)
    if (index < 0) continue
    const id = nodeIds[0]
    let source = sources.get(id)
    if (!source) {
      source = { id, label: `On-site start · ${id}`, color: '#567b6b', count: 0, segments: new Map() }
      sources.set(id, source)
    }
    source.count += path.count
    total += path.count
    for (let i = 1; i <= index; i++) {
      const a = path.points[i - 1], b = path.points[i]
      if (a && b) source.segments.set(JSON.stringify([nodeIds[i - 1], nodeIds[i]]), [a, b])
    }
  }
  const groups = [...sources.values()].map(({ segments, ...source }) => {
    const routes: RouteLine[] = segments.size ? [{
      id: `waypoint-trace-${source.id}`,
      kind: 'entry',
      color: source.color,
      points: [...segments.values()].flat(),
      segments: true,
    }] : []
    return { ...source, routes }
  })
  return { total, origins: groups, routes: groups.flatMap(group => group.routes) }
}
