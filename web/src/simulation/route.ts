import type { KitPreset, Placement, Point, RouteLine, RouteNode } from './types'

export type RoutePreview = {
  routes: RouteLine[]
  nodes: RouteNode[]
  edges: { from: string; to: string; distanceM: number }[]
  distanceM: number | null
  walkSeconds: number | null
  issues: string[]
}

const WALK_SPEED_MPS = 1.2
const CLEARANCE_M = 0.3
const EPSILON = 1e-8
const DEMO_BOUNDS = { minX: -55, maxX: 55, minZ: -325, maxZ: -175 }

type Obstacle = { placement: Placement; preset: KitPreset }

const ground = (point: Point): Point => [point[0], 0, point[2]]
const finitePoint = (point: Point) => point.every(Number.isFinite)
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[2] - a[2])
const inBounds = (point: Point) => point[0] >= DEMO_BOUNDS.minX
  && point[0] <= DEMO_BOUNDS.maxX && point[2] >= DEMO_BOUNDS.minZ
  && point[2] <= DEMO_BOUNDS.maxZ

// Match Three.js rotation around Y; all calculations are on the ground plane.
function localPosition(point: Point, placement: Placement): readonly [number, number] {
  const angle = placement.yawDeg * Math.PI / 180
  const x = point[0] - placement.position[0]
  const z = point[2] - placement.position[2]
  return [Math.cos(angle) * x - Math.sin(angle) * z,
    Math.sin(angle) * x + Math.cos(angle) * z]
}

function crossesObstacle(from: Point, to: Point, { placement, preset }: Obstacle): boolean {
  const start = localPosition(from, placement)
  const end = localPosition(to, placement)
  const halfSizes = [preset.widthM / 2 + CLEARANCE_M, preset.depthM / 2 + CLEARANCE_M]
  let enter = 0
  let exit = 1
  for (let axis = 0; axis < 2; axis += 1) {
    const delta = end[axis] - start[axis]
    if (Math.abs(delta) < EPSILON) {
      if (Math.abs(start[axis]) > halfSizes[axis]) return false
    } else {
      const a = (-halfSizes[axis] - start[axis]) / delta
      const b = (halfSizes[axis] - start[axis]) / delta
      enter = Math.max(enter, Math.min(a, b))
      exit = Math.min(exit, Math.max(a, b))
      if (enter > exit + EPSILON) return false
    }
  }
  return true
}

// Stop outside the help canopy on the side facing scan, rather than at its table.
function helpApproach(placement: Placement, preset: KitPreset, scan: Point): Point {
  let [x, z] = localPosition(scan, placement)
  if (Math.hypot(x, z) < EPSILON) [x, z] = [0, -1]
  const depth = preset.kind === 'roder'
    ? (preset.bayLengthM ?? preset.depthM) * (placement.bays ?? 1) : preset.depthM
  const scale = Math.min(
    Math.abs(x) < EPSILON ? Infinity : (preset.widthM / 2 + 0.6) / Math.abs(x),
    Math.abs(z) < EPSILON ? Infinity : (depth / 2 + 0.6) / Math.abs(z),
  )
  const angle = placement.yawDeg * Math.PI / 180
  return [placement.position[0] + (Math.cos(angle) * x + Math.sin(angle) * z) * scale,
    0, placement.position[2] + (-Math.sin(angle) * x + Math.cos(angle) * z) * scale]
}

/**
 * A deterministic, local geometric preview, not a crowd simulation or engine result.
 * Authored segments stay inside the north demo bounds. Tables and queue panels
 * block a segment using a 0.3 m illustrative clearance. Open canopies and detector
 * portals are traversable; support posts, terrain, venue access and crowds are not
 * modelled. There is no automatic detour or claim that a route is operationally safe.
 * Distance and walking time cover the complete entry route only; the optional help
 * branch is excluded. Walking time assumes 1.2 m/s, without service or queue delays.
 */
export function buildRoutes(placements: readonly Placement[], catalogue: readonly KitPreset[]): RoutePreview {
  const result: RoutePreview = { routes: [], nodes: [], edges: [], distanceM: null, walkSeconds: null, issues: [] }
  const presets = new Map(catalogue.map(preset => [preset.id, preset]))
  const obstacles: Obstacle[] = []
  const invalid = new Set<string>()
  const seen = new Set<string>()

  // Sort checks by ID so input order does not change error or obstacle ordering.
  for (const placement of [...placements].sort((a, b) => a.id.localeCompare(b.id))) {
    const preset = presets.get(placement.presetId)
    if (seen.has(placement.id)) {
      invalid.add(placement.id)
      result.issues.push(`Duplicate placement ID: ${placement.id}.`)
    }
    seen.add(placement.id)
    if (!preset) {
      invalid.add(placement.id)
      result.issues.push(`${placement.label}: kit preset is missing; route geometry cannot be checked.`)
    } else if (!finitePoint(placement.position) || !Number.isFinite(placement.yawDeg)
      || !Number.isFinite(preset.widthM) || preset.widthM <= 0
      || !Number.isFinite(preset.depthM) || preset.depthM <= 0
      || (preset.kind === 'roder' && (!Number.isFinite(preset.bayLengthM ?? preset.depthM)
        || (preset.bayLengthM ?? preset.depthM) <= 0
        || !Number.isInteger(placement.bays ?? 1) || (placement.bays ?? 1) < 1))) {
      invalid.add(placement.id)
      result.issues.push(`${placement.label}: invalid position, rotation or dimensions; route geometry cannot be checked.`)
    } else if (preset.kind === 'rowing' || preset.kind === 'table') {
      obstacles.push({ placement, preset })
    }
  }

  const fixed = (id: string, label: string, role: RouteNode['role'], position: Point): RouteNode => ({ id, label, role, position })
  const arrival = fixed('arrival', 'Arrival', 'arrival', [12, 0, -317])
  const queue = fixed('queue', 'Queue approach', 'waypoint', [12, 0, -303])
  // Keep the middle queue lane until beyond its last panel at Z = -294.1 m.
  const queueExit = fixed('queue-exit', 'Queue exit', 'waypoint', [12, 0, -293.5])
  const walkway = fixed('north-walkway', 'North walkway', 'waypoint', [12, 0, -249])
  const exit = fixed('entry-approach', 'Entry approach', 'waypoint', [12, 0, -195])
  const destination = fixed('destination', 'Venue entry', 'destination', [12, 0, -176])

  function checkpoint(id: string, label: string, required: boolean): RouteNode | undefined {
    const placement = placements.find(item => item.id === id)
    if (!placement) {
      if (required) result.issues.push(`${label} is missing (${id}); the entry route is incomplete.`)
      return undefined
    }
    if (invalid.has(id)) return undefined
    const preset = presets.get(placement.presetId)!
    if (preset.kind !== 'roder' && preset.kind !== 'pagoda') {
      result.issues.push(`${label} must use a canopy preset (${id}).`)
      return undefined
    }
    return fixed(id, label, 'checkpoint', ground(placement.position))
  }

  const scan = checkpoint('scan_tent', 'Ticket scan', true)
  const security = checkpoint('security_tent', 'Security', true)
  const help = checkpoint('help_tent', 'Help desk approach', false)
  if (help && scan) {
    const placement = placements.find(item => item.id === 'help_tent')!
    help.position = helpApproach(placement, presets.get(placement.presetId)!, scan.position)
  }

  const main = [arrival, queue, queueExit, scan, walkway, security, exit, destination]
  result.nodes = main.filter((node): node is RouteNode => node !== undefined)
  if (help && scan) result.nodes.push(help)

  function addLeg(from: RouteNode, to: RouteNode, kind: RouteLine['kind']): number | null {
    if (!inBounds(from.position) || !inBounds(to.position)) {
      result.issues.push(`${from.label} → ${to.label}: outside the north demo routing bounds.`)
      return null
    }
    const blockers = obstacles.filter(obstacle => crossesObstacle(from.position, to.position, obstacle))
    if (blockers.length > 0) {
      result.issues.push(`${from.label} → ${to.label}: blocked by ${blockers.map(item => item.placement.label).join(', ')}. Move the object or checkpoint to clear this segment.`)
      return null
    }
    const distanceM = distance(from.position, to.position)
    result.routes.push({ id: `${kind}:${from.id}:${to.id}`, kind, points: [from.position, to.position] })
    result.edges.push({ from: from.id, to: to.id, distanceM })
    return distanceM
  }

  // Unknown or malformed geometry must never produce an apparently checked path.
  if (invalid.size > 0) return result

  let complete = Boolean(scan && security)
  let total = 0
  for (let index = 1; index < main.length; index += 1) {
    const from = main[index - 1]
    const to = main[index]
    if (!from || !to) continue
    const length = addLeg(from, to, 'entry')
    if (length === null) complete = false
    else total += length
  }
  if (complete) {
    result.distanceM = total
    result.walkSeconds = total / WALK_SPEED_MPS
  }
  if (scan && help) addLeg(scan, help, 'exception')
  return result
}
