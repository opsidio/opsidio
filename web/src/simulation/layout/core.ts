import type { LayoutRevision, NavigationEdge, NavigationNode } from '../runtime-types'
import type { Bounds, KitPreset, Placement, Point, RouteLine, RouteNode } from '../types'

export type LayoutIssue = {
  code: string
  severity: 'error' | 'warning'
  path: string
  message: string
  relatedIds?: string[]
}
export type RequiredRoute = { from: string; to: string }
export type LayoutAssumptions = {
  routeClearanceM: number
  pagodaFootWidthM: number
  roderFootWidthM: number
  roderFootDepthM: number
}
/** Illustrative support/base geometry, matching KitModel; not installation approval. */
export const DEFAULT_ASSUMPTIONS: Readonly<LayoutAssumptions> = {
  routeClearanceM: 0.3, pagodaFootWidthM: 0.13, roderFootWidthM: 0.25, roderFootDepthM: 0.22,
}
export const DEMO_REQUIRED_ROUTES: readonly RequiredRoute[] = [
  { from: 'arrival', to: 'scan_checkpoint' },
  { from: 'scan_checkpoint', to: 'security_checkpoint' },
  { from: 'security_checkpoint', to: 'destination' },
]
export type LayoutValidationOptions = {
  bounds: Bounds
  catalogue: readonly KitPreset[]
  requiredRoutes?: readonly RequiredRoute[]
  assumptions?: LayoutAssumptions
}
export type ResolvedLayoutGraph = {
  nodes: NavigationNode[]
  edges: (NavigationEdge & { distanceM: number })[]
  routes: RouteLine[]
  sceneNodes: RouteNode[]
}
export type LayoutValidation = {
  valid: boolean
  issues: LayoutIssue[]
  graph: ResolvedLayoutGraph
}

const EPS = 1e-7
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 160
export const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const inBounds = (point: Point, bounds: Bounds) => point[0] >= bounds.minX - EPS && point[0] <= bounds.maxX + EPS && point[2] >= bounds.minZ - EPS && point[2] <= bounds.maxZ + EPS
const error = (code: string, path: string, message: string, relatedIds?: string[]): LayoutIssue => ({ code, severity: 'error', path, message, relatedIds })

/** Validate shape before allowing data into React or the renderer. Semantic errors remain repairable. */
export function inspectLayoutShape(value: unknown): LayoutIssue[] {
  if (!object(value)) return [error('invalid_document', '$', 'The layout must be a JSON object.')]
  const issues: LayoutIssue[] = []
  if (value.schemaVersion !== 'opsidio-editor/0.1') issues.push(error('schema_version', 'schemaVersion', 'Expected schemaVersion opsidio-editor/0.1.'))
  if (!id(value.id)) issues.push(error('invalid_id', 'id', 'A nonempty layout ID is required.'))
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) issues.push(error('invalid_revision', 'revision', 'Revision must be a positive safe integer.'))
  for (const key of ['placements', 'nodes', 'edges']) {
    if (!Array.isArray(value[key])) issues.push(error('invalid_collection', key, `${key} must be an array.`))
    else if ((value[key] as unknown[]).length > 5000) issues.push(error('collection_limit', key, `${key} is limited to 5,000 items in this editor.`))
  }
  if (issues.length) return issues
  for (const [index, item] of (value.placements as unknown[]).entries()) {
    if (!object(item) || !id(item.id) || typeof item.label !== 'string' || !id(item.presetId)
      || !isPoint(item.position) || typeof item.yawDeg !== 'number' || !Number.isFinite(item.yawDeg)
      || (item.bays !== undefined && (!Number.isInteger(item.bays) || (item.bays as number) < 1 || (item.bays as number) > 12))) {
      issues.push(error('invalid_placement', `placements[${index}]`, 'Placement needs an ID, label, preset, finite XYZ/yaw, and 1–12 whole bays.'))
    }
  }
  for (const [index, item] of (value.nodes as unknown[]).entries()) {
    if (!object(item) || !id(item.id) || !['arrival', 'waypoint', 'checkpoint', 'destination'].includes(String(item.role))
      || !isPoint(item.position) || (item.entryAreaId !== undefined && !id(item.entryAreaId))
      || (item.attachment !== undefined && (!object(item.attachment) || !id(item.attachment.placementId) || !isPoint(item.attachment.offset)))) {
      issues.push(error('invalid_node', `nodes[${index}]`, 'Node needs an ID, role and finite XYZ; an attachment needs a placement ID and finite local offset.'))
    }
  }
  for (const [index, item] of (value.edges as unknown[]).entries()) {
    if (!object(item) || !id(item.id) || !id(item.from) || !id(item.to)) issues.push(error('invalid_edge', `edges[${index}]`, 'Each directed edge needs an ID, from and to node IDs.'))
  }
  return issues
}

export function localToWorld(offset: Point, placement: Placement): Point {
  const angle = placement.yawDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return [placement.position[0] + c * offset[0] + s * offset[2], placement.position[1] + offset[1], placement.position[2] - s * offset[0] + c * offset[2]]
}

export function worldToLocal(point: Point, placement: Placement): Point {
  const angle = placement.yawDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const x = point[0] - placement.position[0], z = point[2] - placement.position[2]
  return [c * x - s * z, point[1] - placement.position[1], s * x + c * z]
}

export function placementDimensions(placement: Placement, catalogue: readonly KitPreset[]): [number, number] | null {
  const preset = catalogue.find(item => item.id === placement.presetId)
  if (!preset || !Number.isFinite(preset.widthM) || preset.widthM <= 0 || !Number.isFinite(preset.depthM) || preset.depthM <= 0) return null
  const depth = preset.kind === 'roder' ? (placement.bays ?? 1) * (preset.bayLengthM ?? preset.depthM) : preset.depthM
  return Number.isFinite(depth) && depth > 0 ? [preset.widthM, depth] : null
}

type Footprint = { placement: Placement; offset: Point; width: number; depth: number; part: string }
const footprintCorners = ({ placement, offset, width, depth }: Footprint): Point[] =>
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => localToWorld([offset[0] + sx * width / 2, 0, offset[2] + sz * depth / 2], placement))

function overlaps(a: Footprint, b: Footprint): boolean {
  const ca = footprintCorners(a), cb = footprintCorners(b)
  for (const footprint of [a, b]) {
    const angle = footprint.placement.yawDeg * Math.PI / 180
    for (const [x, z] of [[Math.cos(angle), -Math.sin(angle)], [Math.sin(angle), Math.cos(angle)]]) {
      const pa = ca.map(p => p[0] * x + p[2] * z), pb = cb.map(p => p[0] * x + p[2] * z)
      if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS) return false
    }
  }
  return true
}

function obstacleParts(placement: Placement, preset: KitPreset, dimensions: [number, number], assumptions: LayoutAssumptions): Footprint[] {
  const [width, depth] = dimensions
  const part = (offset: Point, w: number, d: number, name: string): Footprint => ({ placement, offset, width: w, depth: d, part: name })
  if (preset.kind === 'pagoda') return [-1, 1].flatMap(x => [-1, 1].map(z => part([x * width / 2 * 0.965, 0, z * depth / 2 * 0.965], assumptions.pagodaFootWidthM, assumptions.pagodaFootWidthM, 'canopy foot')))
  if (preset.kind === 'roder') {
    const bays = placement.bays ?? 1, endZ = depth / 2 - 0.065
    return Array.from({ length: bays + 1 }, (_, bay) => -endZ + 2 * endZ * bay / bays).flatMap(z => [-1, 1].map(sign => part([sign * (width / 2 - 0.125), 0, z], assumptions.roderFootWidthM, assumptions.roderFootDepthM, 'canopy foot')))
  }
  if (preset.kind === 'detector') {
    const panel = Math.min(0.065, width * 0.075)
    return [-1, 1].map(sign => part([sign * (width / 2 - panel / 2), 0, 0], panel, depth, 'detector support'))
  }
  return [part([0, 0, 0], width, depth, preset.kind === 'rowing' ? 'barrier including feet' : 'equipment footprint')]
}

function crosses(from: Point, to: Point, obstacle: Footprint, clearance: number): boolean {
  const a = worldToLocal(from, obstacle.placement), b = worldToLocal(to, obstacle.placement)
  let enter = 0, exit = 1
  for (const axis of [0, 2] as const) {
    const start = a[axis] - obstacle.offset[axis], end = b[axis] - obstacle.offset[axis]
    const half = (axis === 0 ? obstacle.width : obstacle.depth) / 2 + clearance
    const delta = end - start
    if (Math.abs(delta) < EPS) { if (Math.abs(start) > half) return false }
    else {
      const near = (-half - start) / delta, far = (half - start) / delta
      enter = Math.max(enter, Math.min(near, far)); exit = Math.min(exit, Math.max(near, far))
      if (enter > exit + EPS) return false
    }
  }
  return true
}

function duplicates(items: readonly { id: string }[], path: string, issues: LayoutIssue[]): Set<string> {
  const seen = new Set<string>(), duplicate = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id) && !duplicate.has(item.id)) { duplicate.add(item.id); issues.push(error('duplicate_id', path, `Duplicate ${path} ID: ${item.id}.`, [item.id])) }
    seen.add(item.id)
  }
  return duplicate
}

export function reachableNodeIds(start: string, edges: readonly NavigationEdge[]): Set<string> {
  const visited = new Set([start]), queue = [start], outgoing = new Map<string, string[]>()
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  for (let index = 0; index < queue.length; index++) {
    for (const next of outgoing.get(queue[index]) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next) }
  }
  return visited
}

/** No automatic routing: only authored directed edges with known, clear endpoints are returned. */
export function validateLayout(layout: LayoutRevision, options: LayoutValidationOptions): LayoutValidation {
  const issues = inspectLayoutShape(layout)
  const graph: ResolvedLayoutGraph = { nodes: [], edges: [], routes: [], sceneNodes: [] }
  if (issues.length) return { valid: false, issues, graph }
  const assumptions = options.assumptions ?? DEFAULT_ASSUMPTIONS
  if (Object.entries(assumptions).some(([key, value]) => !Number.isFinite(value) || (key === 'routeClearanceM' ? value < 0 : value <= 0))) return { valid: false, issues: [error('invalid_assumption', 'assumptions', 'Clearance must be nonnegative and support-foot dimensions must be positive finite metres.')], graph }
  if (Object.values(options.bounds).some(value => !Number.isFinite(value)) || options.bounds.minX >= options.bounds.maxX || options.bounds.minZ >= options.bounds.maxZ) return { valid: false, issues: [error('invalid_bounds', 'bounds', 'Editable bounds must be finite with minimums below maximums.')], graph }
  const duplicatePlacements = duplicates(layout.placements, 'placements', issues)
  const duplicateNodes = duplicates(layout.nodes, 'nodes', issues)
  const duplicateEdges = duplicates(layout.edges, 'edges', issues)
  const presets = new Map(options.catalogue.map(preset => [preset.id, preset]))
  const placements = new Map<string, Placement>(), obstacles: Footprint[] = [], envelopes: Footprint[] = []
  const partsByPlacement = new Map<string, Footprint[]>(), physicalEnvelopes = new Map<string, Footprint>()
  for (const placement of layout.placements) {
    if (duplicatePlacements.has(placement.id)) continue
    const preset = presets.get(placement.presetId), dimensions = placementDimensions(placement, options.catalogue)
    if (!preset || !dimensions) { issues.push(error('unknown_preset', `placements.${placement.id}`, `${placement.label}: missing or invalid kit preset ${placement.presetId}.`, [placement.id])); continue }
    placements.set(placement.id, placement)
    const footprint: Footprint = { placement, width: dimensions[0], depth: dimensions[1], offset: [0, 0, 0], part: 'envelope' }
    const parts = obstacleParts(placement, preset, dimensions, assumptions)
    if ([...footprintCorners(footprint), ...parts.flatMap(footprintCorners)].some(point => !inBounds(point, options.bounds))) issues.push(error('placement_bounds', `placements.${placement.id}.position`, `${placement.label}: the full footprint, including support feet, leaves the editable bounds.`, [placement.id]))
    if (Math.abs(placement.position[1]) > EPS) issues.push(error('ground_height', `placements.${placement.id}.position`, `${placement.label}: this ground-plane scenario requires Y = 0 m.`, [placement.id]))
    envelopes.push(footprint)
    obstacles.push(...parts)
    partsByPlacement.set(placement.id, parts)
    physicalEnvelopes.set(placement.id, { ...footprint, width: Math.max(dimensions[0], ...parts.map(part => 2 * Math.abs(part.offset[0]) + part.width)), depth: Math.max(dimensions[1], ...parts.map(part => 2 * Math.abs(part.offset[2]) + part.depth)) })
  }
  for (let i = 0; i < envelopes.length; i++) for (let j = i + 1; j < envelopes.length; j++) {
    const a = envelopes[i], b = envelopes[j]
    if (!overlaps(physicalEnvelopes.get(a.placement.id)!, physicalEnvelopes.get(b.placement.id)!)) continue
    const physical = partsByPlacement.get(a.placement.id)!.some(aPart => partsByPlacement.get(b.placement.id)!.some(bPart => overlaps(aPart, bPart)))
    const ids = [a.placement.id, b.placement.id]
    if (physical) issues.push(error('physical_overlap', 'placements', `${a.placement.label} and ${b.placement.label} have overlapping solid footprints or support feet.`, ids))
    else if (overlaps(a, b) && [a, b].every(item => ['pagoda', 'roder'].includes(presets.get(item.placement.presetId)!.kind))) issues.push({ code: 'canopy_overlap', severity: 'warning', path: 'placements', message: `${a.placement.label} and ${b.placement.label} canopy envelopes overlap. Support feet are clear; roof/rigging compatibility needs review.`, relatedIds: ids })
  }
  for (const node of layout.nodes) {
    if (duplicateNodes.has(node.id)) continue
    const placement = node.attachment ? placements.get(node.attachment.placementId) : undefined
    if (node.attachment && !placement) { issues.push(error('unknown_attachment', `nodes.${node.id}.attachment`, `${node.id} references missing or invalid placement ${node.attachment.placementId}.`, [node.id, node.attachment.placementId])); continue }
    const position = placement && node.attachment ? localToWorld(node.attachment.offset, placement) : node.position
    if (!inBounds(position, options.bounds)) issues.push(error('node_bounds', `nodes.${node.id}.position`, `${node.id} is outside the editable bounds.`, [node.id]))
    if (Math.abs(position[1]) > EPS) issues.push(error('ground_height', `nodes.${node.id}.position`, `${node.id}: this ground-plane scenario requires Y = 0 m.`, [node.id]))
    graph.nodes.push({ ...node, position })
    graph.sceneNodes.push({ id: node.id, label: node.id.replaceAll('_', ' '), role: node.role, position })
  }
  const nodes = new Map(graph.nodes.map(node => [node.id, node])), pairs = new Set<string>()
  for (const edge of layout.edges) {
    if (duplicateEdges.has(edge.id)) continue
    const from = nodes.get(edge.from), to = nodes.get(edge.to), pair = JSON.stringify([edge.from, edge.to])
    if (!from || !to) { issues.push(error('unknown_endpoint', `edges.${edge.id}`, `${edge.id} references missing or invalid node ${!from ? edge.from : edge.to}.`, [edge.id, edge.from, edge.to])); continue }
    if (edge.from === edge.to) { issues.push(error('self_edge', `edges.${edge.id}`, `${edge.id}: connect two different nodes.`, [edge.id])); continue }
    if (pairs.has(pair)) { issues.push(error('duplicate_edge', `edges.${edge.id}`, `There is already a directed edge ${edge.from} → ${edge.to}.`, [edge.id])); continue }
    pairs.add(pair)
    if (distance(from.position, to.position) < EPS) { issues.push(error('zero_length_edge', `edges.${edge.id}`, `${edge.id} has coincident endpoints.`, [edge.id])); continue }
    if (!inBounds(from.position, options.bounds) || !inBounds(to.position, options.bounds)) continue
    const blockers = [...new Set(obstacles.filter(obstacle => crosses(from.position, to.position, obstacle, assumptions.routeClearanceM)).map(obstacle => obstacle.placement.id))]
    if (blockers.length) { issues.push(error('blocked_edge', `edges.${edge.id}`, `${edge.from} → ${edge.to} intersects ${blockers.join(', ')} with the assumed ${assumptions.routeClearanceM} m clearance.`, [edge.id, ...blockers])); continue }
    graph.edges.push({ ...edge, distanceM: distance(from.position, to.position) })
    graph.routes.push({ id: edge.id, kind: edge.from.includes('help') || edge.to.includes('help') ? 'exception' : 'entry', points: [from.position, to.position] })
  }
  const arrivals = graph.nodes.filter(node => node.role === 'arrival'), destinations = graph.nodes.filter(node => node.role === 'destination')
  if (!arrivals.length) issues.push(error('missing_arrival', 'nodes', 'Add at least one arrival node.'))
  if (!destinations.length) issues.push(error('missing_destination', 'nodes', 'Add at least one destination node.'))
  const reachable = new Set<string>()
  for (const arrival of arrivals) {
    const found = reachableNodeIds(arrival.id, graph.edges)
    found.forEach(nodeId => reachable.add(nodeId))
    if (destinations.length && !destinations.some(node => found.has(node.id))) issues.push(error('unreachable_destination', `nodes.${arrival.id}`, `${arrival.id} cannot reach a destination along the authored directed edges.`, [arrival.id]))
  }
  for (const node of graph.nodes) {
    if (node.role !== 'arrival' && !reachable.has(node.id)) issues.push(error('unreachable_node', `nodes.${node.id}`, `${node.id} is unreachable from every arrival.`, [node.id]))
    if (node.role !== 'destination' && destinations.length && !destinations.some(destination => reachableNodeIds(node.id, graph.edges).has(destination.id))) issues.push(error('dead_end', `nodes.${node.id}`, `${node.id} has no directed path to a destination.`, [node.id]))
  }
  for (const required of options.requiredRoutes ?? []) {
    if (!nodes.has(required.from) || !nodes.has(required.to)) issues.push(error('missing_required_node', 'nodes', `Required route ${required.from} → ${required.to} has a missing node.`, [required.from, required.to]))
    else if (!reachableNodeIds(required.from, graph.edges).has(required.to)) issues.push(error('required_route_unreachable', 'edges', `Required route ${required.from} → ${required.to} is disconnected or blocked.`, [required.from, required.to]))
  }
  return { valid: !issues.some(issue => issue.severity === 'error'), issues, graph }
}

export const resolveLayoutGraph = (layout: LayoutRevision, options: LayoutValidationOptions): ResolvedLayoutGraph => validateLayout(layout, options).graph

/** Explicit prepared graph. These are authored scenario coordinates, never inferred from public paths. */
export function createLayoutRevision(placements: Placement[]): LayoutRevision {
  const fixed = (id: string, role: NavigationNode['role'], position: Point): NavigationNode => ({ id, role, position })
  const attached = (id: string, placementId: string, offset: Point = [0, 0, 0]): NavigationNode => ({
    id, role: 'checkpoint', position: [0, 0, 0], attachment: { placementId, offset },
  })
  const nodes: NavigationNode[] = [
    fixed('arrival', 'arrival', [12, 0, -317]), fixed('queue', 'waypoint', [12, 0, -303]),
    fixed('queue-exit', 'waypoint', [12, 0, -293.5]), attached('scan_checkpoint', 'scan_tent'),
    fixed('north-walkway', 'waypoint', [12, 0, -249]), attached('security_checkpoint', 'security_tent'),
    fixed('entry-approach', 'waypoint', [12, 0, -195]), fixed('destination', 'destination', [12, 0, -176]),
    attached('help_checkpoint', 'help_tent', [0, 0, -2.1]),
  ]
  const edges = nodes.slice(0, 7).map((node, index) => ({ id: `leg_${index + 1}`, from: node.id, to: nodes[index + 1].id }))
  edges.push({ id: 'help_approach', from: 'scan_checkpoint', to: 'help_checkpoint' }, { id: 'help_return', from: 'help_checkpoint', to: 'scan_checkpoint' })
  return { schemaVersion: 'opsidio-editor/0.1', id: 'gbk-north-demo', revision: 1, placements: structuredClone(placements), nodes, edges }
}

export type ImportResult = { layout: LayoutRevision | null; validation: LayoutValidation | null; issues: LayoutIssue[] }
export function importLayoutJSON(json: string, options: LayoutValidationOptions): ImportResult {
  if (json.length > 2_000_000) return { layout: null, validation: null, issues: [error('document_limit', '$', 'Layout JSON is limited to 2 MB.')] }
  let value: unknown
  try { value = JSON.parse(json) } catch { return { layout: null, validation: null, issues: [error('invalid_json', '$', 'Cannot parse JSON. The current draft has been kept.')] } }
  const shape = inspectLayoutShape(value)
  if (shape.length) return { layout: null, validation: null, issues: shape }
  const layout = value as LayoutRevision
  const validation = validateLayout(layout, options)
  // Duplicate IDs cannot be selected unambiguously. Keep the source JSON editable instead.
  if (validation.issues.some(issue => issue.code === 'duplicate_id')) return { layout: null, validation, issues: validation.issues }
  return { layout, validation, issues: validation.issues }
}

export function exportLayoutJSON(layout: LayoutRevision): string { return JSON.stringify(layout, null, 2) }

export type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>
export function restoreLayout(storage: LayoutStorage, key: string, options: LayoutValidationOptions): ImportResult & { found: boolean; sourceJSON?: string } {
  try {
    const json = storage.getItem(key)
    return json === null ? { found: false, layout: null, validation: null, issues: [] } : { found: true, sourceJSON: json, ...importLayoutJSON(json, options) }
  } catch { return { found: false, layout: null, validation: null, issues: [error('storage_read', 'storage', 'Browser storage is unavailable; use JSON export to keep this draft.')] } }
}
export function persistLayout(storage: LayoutStorage, key: string, layout: LayoutRevision, options: LayoutValidationOptions): LayoutIssue[] {
  const checked = importLayoutJSON(exportLayoutJSON(layout), options)
  if (!checked.layout) return checked.issues
  try { storage.setItem(key, exportLayoutJSON(layout)); return [] }
  catch { return [error('storage_write', 'storage', 'Browser storage could not save this draft. Export JSON to keep it.') ] }
}

export function placementRemovalIssue(layout: LayoutRevision, placementId: string): LayoutIssue | null {
  const attached = layout.nodes.filter(node => node.attachment?.placementId === placementId)
  return attached.length ? error('placement_referenced', `placements.${placementId}`, `Detach or remove ${attached.map(node => node.id).join(', ')} before removing this placement.`, [placementId, ...attached.map(node => node.id)]) : null
}
export function nodeRemovalIssue(layout: LayoutRevision, nodeId: string, requiredRoutes: readonly RequiredRoute[] = []): LayoutIssue | null {
  if (requiredRoutes.some(route => route.from === nodeId || route.to === nodeId)) return error('node_required', `nodes.${nodeId}`, `${nodeId} is required by the current scenario and cannot be removed.`, [nodeId])
  const references = layout.edges.filter(edge => edge.from === nodeId || edge.to === nodeId)
  return references.length ? error('node_referenced', `nodes.${nodeId}`, `Remove the ${references.length} connected edge(s) before removing ${nodeId}.`, [nodeId, ...references.map(edge => edge.id)]) : null
}
