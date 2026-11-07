import { scheduleAdmission } from './admission.ts'
import type { AbmConfig, AbmResult, AgentJourney, CohortDemand, NavigationNode, ServiceStation } from '../runtime-types'
import type { Point } from '../types'
import type { AbmWorkerRequest, AbmWorkerResponse } from './worker-protocol'

export const ARRIVAL_BUCKET_SECONDS = 15 * 60
export const MAX_GENERATED_JOURNEYS = 1_000_000

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const validId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validPoint = (point: unknown): point is Point => Array.isArray(point) && point.length === 3 && point.every(finite)

type Arc = { to: string; distance: number }
type Graph = { nodes: Map<string, NavigationNode>; outgoing: Map<string, Arc[]>; orderedIds: string[] }
type Path = { nodeIds: string[]; points: Point[]; distance: number }
type Route = Path & { checkpointDistance: number }

function validateGraph(config: AbmConfig, issues: string[]): Graph | null {
  if (!Array.isArray(config.nodes) || !Array.isArray(config.edges)) {
    issues.push('Graph nodes and edges must be arrays.')
    return null
  }
  const nodes = new Map<string, NavigationNode>()
  const outgoing = new Map<string, Arc[]>()
  for (const node of config.nodes) {
    if (!node || !validId(node.id) || !validPoint(node.position)
      || !['arrival', 'waypoint', 'checkpoint', 'destination'].includes(node.role)) {
      issues.push(`Graph has an invalid node: ${node?.id ?? '(missing id)'}. Positions must be finite metre coordinates.`)
      continue
    }
    if (nodes.has(node.id)) issues.push(`Graph has duplicate node id "${node.id}".`)
    else {
      nodes.set(node.id, node)
      outgoing.set(node.id, [])
    }
  }
  const edgeIds = new Set<string>()
  const endpoints = new Set<string>()
  for (const edge of config.edges) {
    if (!edge || !validId(edge.id) || !validId(edge.from) || !validId(edge.to)) {
      issues.push(`Graph has an invalid directed edge: ${edge?.id ?? '(missing id)'}.`)
      continue
    }
    if (edgeIds.has(edge.id)) issues.push(`Graph has duplicate edge id "${edge.id}".`)
    edgeIds.add(edge.id)
    const pair = JSON.stringify([edge.from, edge.to])
    if (endpoints.has(pair)) issues.push(`Graph has duplicate directed edge ${edge.from} -> ${edge.to}.`)
    endpoints.add(pair)
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) {
      issues.push(`Graph edge "${edge.id}" references a missing node (${edge.from} -> ${edge.to}).`)
      continue
    }
    const distance = Math.hypot(...from.position.map((value, axis) => value - to.position[axis]))
    if (!Number.isFinite(distance)) issues.push(`Graph edge "${edge.id}" has a non-finite distance.`)
    else outgoing.get(edge.from)!.push({ to: edge.to, distance })
  }
  if (issues.length) return null
  for (const arcs of outgoing.values()) arcs.sort((a, b) => compareIds(a.to, b.to))
  return { nodes, outgoing, orderedIds: [...nodes.keys()].sort(compareIds) }
}

/** Shortest geometric route on the authored directed graph; no obstacle or crowd model. */
function shortestPath(graph: Graph, origin: string, destination: string, excluded?: string): Path | string {
  if (!graph.nodes.has(origin)) return `arrival node "${origin}" is missing`
  if (!graph.nodes.has(destination)) return `destination node "${destination}" is missing`
  const distances = new Map<string, number>([[origin, 0]])
  const previous = new Map<string, string>()
  const visited = new Set<string>()
  while (true) {
    let current: string | undefined
    let nearest = Infinity
    // Stable ID order breaks equal-distance ties, independently of input array order.
    for (const id of graph.orderedIds) {
      const distance = distances.get(id) ?? Infinity
      if (!visited.has(id) && distance < nearest) {
        current = id
        nearest = distance
      }
    }
    if (current === undefined) return `destination "${destination}" is unreachable from "${origin}" on the directed graph`
    if (current === destination) break
    visited.add(current)
    for (const arc of graph.outgoing.get(current)!) {
      if (arc.to === excluded || visited.has(arc.to)) continue
      const distance = nearest + arc.distance
      if (distance < (distances.get(arc.to) ?? Infinity)) {
        distances.set(arc.to, distance)
        previous.set(arc.to, current)
      }
    }
  }
  const nodeIds = [destination]
  while (nodeIds[0] !== origin) nodeIds.unshift(previous.get(nodeIds[0])!)
  const points = nodeIds.map(id => [...graph.nodes.get(id)!.position] as Point)
  return { nodeIds, points, distance: distances.get(destination)! }
}

function validateCohort(cohort: CohortDemand, horizon: number): string[] {
  const issues: string[] = []
  if (!validId(cohort.id)) issues.push('id must be a non-empty string')
  if (!Number.isSafeInteger(cohort.count) || cohort.count < 0) issues.push('count must be a non-negative safe integer')
  if (!validId(cohort.arrivalNodeId) || !validId(cohort.destinationNodeId)) issues.push('arrival and destination node IDs are required')
  if (cohort.groupSize !== undefined && (!Number.isSafeInteger(cohort.groupSize) || cohort.groupSize < 1)) {
    issues.push('groupSize must be a positive safe integer')
  }
  if (cohort.laneCheckpointIds !== undefined && (!Array.isArray(cohort.laneCheckpointIds) || !cohort.laneCheckpointIds.length || cohort.laneCheckpointIds.some(id => !validId(id)) || new Set(cohort.laneCheckpointIds).size !== cohort.laneCheckpointIds.length)) issues.push('laneCheckpointIds needs distinct authored checkpoint IDs')
  if (cohort.helpDesk !== undefined) {
    const help = cohort.helpDesk
    if (!help || !validId(help.passNodeId) || !validId(help.checkpointNodeId) || !finite(help.visitPercent) || help.visitPercent < 0 || help.visitPercent > 100 || !cohort.laneCheckpointIds?.length) {
      issues.push('helpDesk needs a passage, a checkpoint, a 0–100% visit share and authored security lanes')
    }
  }
  if (cohort.walkSpeedMps !== undefined && (!finite(cohort.walkSpeedMps) || cohort.walkSpeedMps <= 0)) issues.push('walkSpeedMps must be finite and positive')
  if (!Array.isArray(cohort.windows) || cohort.windows.length === 0) {
    issues.push('at least one arrival window is required')
    return issues
  }
  let sum = 0
  for (const window of cohort.windows) {
    if (!window || !finite(window.startSeconds) || !finite(window.endSeconds) || !finite(window.sharePercent)
      || window.startSeconds < 0 || window.endSeconds <= window.startSeconds || window.endSeconds > horizon
      || window.sharePercent < 0 || window.sharePercent > 100) {
      issues.push('arrival windows must be finite, within [0, horizon], have start < end, and shares between 0 and 100')
      continue
    }
    sum += window.sharePercent
  }
  if (Math.abs(sum - 100) > 1e-7) issues.push(`arrival-window shares must sum to 100 (received ${sum})`)
  if (!issues.length) {
    const windows = [...cohort.windows].sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds)
    for (let index = 1; index < windows.length; index++) {
      if (windows[index].startSeconds < windows[index - 1].endSeconds) {
        issues.push('arrival windows must not overlap')
        break
      }
    }
  }
  return issues
}

/** Each cohort has its own stream, so adding/reordering another cohort cannot shift it. */
function cohortRandom(seed: number, cohortId: string, stream?: string): () => number {
  let state = 2166136261
  const key = JSON.stringify(stream === undefined ? [seed, cohortId] : [seed, cohortId, stream])
  for (let index = 0; index < key.length; index++) state = Math.imul(state ^ key.charCodeAt(index), 16777619)
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function resolveRoute(
  graph: Graph, paths: Map<string, Path | string>, stages: Map<string, ServiceStation['admissionStage']>,
  cohort: CohortDemand, via: string | null, visitHelp: boolean,
): Route | string {
  const { arrivalNodeId, destinationNodeId, helpDesk } = cohort
  if (!graph.nodes.has(arrivalNodeId)) return `arrival node "${arrivalNodeId}" is missing`
  if (graph.nodes.get(arrivalNodeId)!.role !== 'arrival') return `origin "${arrivalNodeId}" must have role "arrival"`
  if (via && graph.nodes.get(via)?.role !== 'checkpoint') return `lane node "${via}" must be a checkpoint`
  const waypoints = [arrivalNodeId]
  if (helpDesk) {
    if (graph.nodes.get(helpDesk.passNodeId)?.role !== 'waypoint' || stages.get(helpDesk.checkpointNodeId) !== 'help') return 'help passage or desk station is missing'
    waypoints.push(helpDesk.passNodeId)
    if (visitHelp) waypoints.push(helpDesk.checkpointNodeId)
  }
  if (via) waypoints.push(via)
  waypoints.push(destinationNodeId)

  const nodeIds: string[] = [], points: Point[] = []
  let distance = 0
  for (let index = 1; index < waypoints.length; index++) {
    const from = waypoints[index - 1], to = waypoints[index]
    const helpNode = helpDesk?.checkpointNodeId
    const excluded = helpNode !== from && helpNode !== to ? helpNode : undefined
    const key = JSON.stringify([from, to, excluded])
    let path = paths.get(key)
    if (!path) {
      path = shortestPath(graph, from, to, excluded)
      paths.set(key, path)
    }
    if (typeof path === 'string') return path
    nodeIds.push(...path.nodeIds.slice(index === 1 ? 0 : 1))
    points.push(...path.points.slice(index === 1 ? 0 : 1))
    distance += path.distance
  }

  if (helpDesk) {
    const checkpointIds = nodeIds.filter(id => graph.nodes.get(id)!.role === 'checkpoint')
    const required = visitHelp ? [helpDesk.checkpointNodeId, via] : [via]
    const scanId = checkpointIds[required.length]
    const terminal = graph.nodes.get(destinationNodeId)
    if (stages.get(via!) !== 'security' || stages.get(scanId) !== 'scan' || checkpointIds.length !== required.length + 1
      || required.some((id, index) => checkpointIds[index] !== id)
      || new Set(nodeIds).size !== nodeIds.length || terminal?.role !== 'destination' || graph.outgoing.get(destinationNodeId)!.length) {
      return 'admission route must pass the help desk, then security and ticket scan, and end at a terminal handover'
    }
  }
  const checkpointIndex = helpDesk ? nodeIds.indexOf(via!) : nodeIds.findIndex(id => graph.nodes.get(id)!.role === 'checkpoint')
  if (checkpointIndex < 0) return `route ${arrivalNodeId} -> ${destinationNodeId} has no checkpoint; checkpoint arrival cannot be derived`
  let checkpointDistance = 0
  for (let index = 1; index <= checkpointIndex; index++) {
    checkpointDistance += Math.hypot(...points[index].map((value, axis) => value - points[index - 1][axis]))
  }
  return { nodeIds, points, distance, checkpointDistance }
}

/**
 * Seeded demand and authored-route movement, with optional fixed-time FIFO
 * operator processing. Inputs are never mutated. Doni handles API optimization.
 */
export function generateAbm(config: AbmConfig): AbmResult {
  const result: AbmResult = {
    seed: config?.seed, timeOrigin: config?.timeOrigin, generatedCount: 0,
    journeys: [], arrivalBuckets: [], issues: [],
  }
  if (!config || !Number.isSafeInteger(config.seed)) result.issues.push('seed must be a safe integer.')
  if (typeof config?.timeOrigin !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(config.timeOrigin)
    || !Number.isFinite(Date.parse(config.timeOrigin))) {
    result.issues.push('timeOrigin must be an ISO timestamp with an explicit timezone.')
  }
  if (!finite(config?.horizonSeconds) || config.horizonSeconds <= 0) result.issues.push('horizonSeconds must be finite and positive.')
  if (!finite(config?.walkSpeedMps) || config.walkSpeedMps <= 0) result.issues.push('walkSpeedMps must be finite and positive.')
  if (!Array.isArray(config?.cohorts)) result.issues.push('cohorts must be an array.')
  if (result.issues.length) return result
  const graph = validateGraph(config, result.issues)
  if (!graph) {
    result.issues.sort(compareIds)
    return result
  }
  const idCounts = new Map<string, number>()
  for (const cohort of config.cohorts) {
    if (cohort && validId(cohort.id)) idCounts.set(cohort.id, (idCounts.get(cohort.id) ?? 0) + 1)
  }
  const routes = new Map<string, Route | string>()
  const paths = new Map<string, Path | string>()
  const stages = new Map(config.serviceStations?.map(station => [station.nodeId, station.admissionStage]))
  const cohorts = [...config.cohorts].sort((a, b) => compareIds(a?.id ?? '', b?.id ?? ''))
  const requestedCount = cohorts.reduce((sum, cohort) => sum + (Number.isSafeInteger(cohort?.count) && cohort.count > 0 ? cohort.count : 0), 0)
  if (!Number.isSafeInteger(requestedCount) || requestedCount > MAX_GENERATED_JOURNEYS) {
    result.issues.push(`Requested attendance exceeds the preview limit of ${MAX_GENERATED_JOURNEYS} journeys.`)
    return result
  }
  for (const cohort of cohorts) {
    if (!cohort) {
      result.issues.push('Cohort entry must be an object.')
      continue
    }
    const issues = validateCohort(cohort, config.horizonSeconds)
    if ((idCounts.get(cohort.id) ?? 0) > 1) issues.push(`duplicate cohort id "${cohort.id}"`)
    if (issues.length) {
      result.issues.push(...issues.map(issue => `Cohort "${cohort.id ?? '(missing id)'}": ${issue}.`))
      continue
    }
    const routeOptions: { ordinary: Route; help?: Route }[] = []
    const helpDesk = cohort.helpDesk
    const helpVisitPercent = helpDesk?.visitPercent ?? 0
    for (const via of cohort.laneCheckpointIds ?? [null]) {
      const routeFor = (visitHelp: boolean) => {
        const key = JSON.stringify([cohort.arrivalNodeId, via, cohort.destinationNodeId, helpDesk?.passNodeId, helpDesk?.checkpointNodeId, visitHelp])
        let route = routes.get(key)
        if (!route) {
          route = resolveRoute(graph, paths, stages, cohort, via, visitHelp)
          routes.set(key, route)
        }
        if (typeof route === 'string') result.issues.push(`Cohort "${cohort.id}": ${route}.`)
        return route
      }
      const ordinary = routeFor(false)
      const help = helpVisitPercent > 0 ? routeFor(true) : undefined
      if (typeof ordinary !== 'string' && typeof help !== 'string') routeOptions.push({ ordinary, help })
    }
    if (routeOptions.length !== (cohort.laneCheckpointIds?.length ?? 1)) continue
    const walkSpeed = cohort.walkSpeedMps ?? config.walkSpeedMps
    if (routeOptions.some(({ ordinary, help }) => !Number.isFinite(config.horizonSeconds + Math.max(ordinary.distance, help?.distance ?? 0) / walkSpeed))) {
      result.issues.push(`Cohort "${cohort.id}": route travel time is not finite at the configured walk speed.`)
      continue
    }
    const random = cohortRandom(config.seed, cohort.id)
    const helpRandom = helpVisitPercent > 0 ? cohortRandom(config.seed, cohort.id, 'help-desk') : undefined
    const windows = [...cohort.windows].filter(window => window.sharePercent > 0)
      .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds)
    const totalShare = windows.reduce((sum, window) => sum + window.sharePercent, 0)
    const buckets = new Map<number, AbmResult['arrivalBuckets'][number]>()
    const addBucket = (seconds: number, count: number, kind: 'onsiteArrivals' | 'checkpointArrivals') => {
      const startSeconds = Math.floor(seconds / ARRIVAL_BUCKET_SECONDS) * ARRIVAL_BUCKET_SECONDS
      let bucket = buckets.get(startSeconds)
      if (!bucket) {
        bucket = { cohortId: cohort.id, startSeconds, endSeconds: startSeconds + ARRIVAL_BUCKET_SECONDS, onsiteArrivals: 0, checkpointArrivals: 0 }
        buckets.set(startSeconds, bucket)
      }
      bucket[kind] += count
    }
    const groupSize = cohort.groupSize ?? 1
    const encodedId = encodeURIComponent(cohort.id)
    let personIndex = 0
    let groupIndex = 0
    while (personIndex < cohort.count) {
      const option = routeOptions[groupIndex % routeOptions.length]
      const route = option.help && helpRandom && helpRandom() * 100 < helpVisitPercent ? option.help : option.ordinary
      const walkSeconds = route.distance / walkSpeed
      const checkpointSeconds = route.checkpointDistance / walkSpeed
      let draw = random() * totalShare
      let window = windows[windows.length - 1]
      for (const candidate of windows) {
        draw -= candidate.sharePercent
        if (draw < 0) { window = candidate; break }
      }
      // Every person in a group receives exactly the same onsite arrival.
      const onsiteArrivalSeconds = window.startSeconds + random() * (window.endSeconds - window.startSeconds)
      const checkpointArrivalSeconds = onsiteArrivalSeconds + checkpointSeconds
      const count = Math.min(groupSize, cohort.count - personIndex)
      const groupId = `${encodedId}:group:${groupIndex}`
      for (let member = 0; member < count; member++) {
        const journey: AgentJourney = {
          id: `${encodedId}:person:${personIndex + member}`, cohortId: cohort.id, groupId,
          onsiteArrivalSeconds, checkpointArrivalSeconds,
          routeNodeIds: route.nodeIds, points: route.points, walkSeconds,
        }
        result.journeys.push(journey)
      }
      addBucket(onsiteArrivalSeconds, count, 'onsiteArrivals')
      addBucket(checkpointArrivalSeconds, count, 'checkpointArrivals')
      personIndex += count
      groupIndex++
    }
    result.arrivalBuckets.push(...[...buckets.values()].sort((a, b) => a.startSeconds - b.startSeconds))
  }
  if (config.serviceStations?.length) scheduleAdmission(result.journeys, config.serviceStations)
  result.generatedCount = result.journeys.length
  result.issues = [...new Set(result.issues)].sort(compareIds)
  return result
}

/** Pure worker handler; callers supply the identity of the config snapshot sent. */
export function executeAbmRequest(request: AbmWorkerRequest): AbmWorkerResponse {
  const identity = { requestId: request.requestId, layoutRevision: request.layoutRevision, configHash: request.configHash }
  try {
    if (request.type !== 'generate' || !validId(request.requestId) || !validId(request.configHash)
      || !Number.isSafeInteger(request.layoutRevision) || request.layoutRevision < 0) {
      throw new Error('Invalid ABM worker request identity.')
    }
    return { type: 'result', ...identity, result: generateAbm(request.config) }
  } catch (error) {
    return { type: 'error', ...identity, error: error instanceof Error ? error.message : String(error) }
  }
}
