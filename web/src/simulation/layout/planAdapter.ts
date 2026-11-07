import { compileSimulationPlan } from '../plan/compile'
import { generateAbm } from '../abm/generator'
import type { Bounds, Point } from '../types'
import { inspectLayoutShape, localToWorld, type EditorLayout, type EditorArea, type RequiredRoute, type ReviewedOverlap } from './core'

type Row = Record<string, any>
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : []
const object = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a simulation plan object.')
  return value as Row
}
const samePoint = (a: readonly number[], b: readonly number[]) => a.every((value, axis) => Math.abs(value - b[axis]) < 0.000001)

/** Whole-plan snapshot: no coordinates, area locations or routes are inferred. */
export function createPlanEditorLayout(source: unknown): EditorLayout {
  const compiled = compileSimulationPlan(source), spatial = object(object(source).spatial_context)
  return {
    schemaVersion: 'opsidio-editor/0.1', id: compiled.layoutId, revision: compiled.layoutRevision,
    placements: structuredClone(compiled.placements), nodes: structuredClone(compiled.nodes), edges: structuredClone(compiled.edges),
    placementAreas: Object.fromEntries(rows(spatial.placements).map(row => [row.id, row.entry_area_id])),
    markers: rows(spatial.entry_areas).map(row => ({ id: `gate-marker:${row.id}`, label: `${row.label} · gate marker`, entryAreaId: row.id, position: [...row.position_m] as unknown as Point })),
  }
}

export function planEditorOptions(source: unknown) {
  const layout = createPlanEditorLayout(source), plan = object(source), spatial = object(plan.spatial_context)
  const areaRows = rows(spatial.entry_areas)
  const areas: EditorArea[] = areaRows.map(row => ({ id: row.id, label: row.label, position: [...row.position_m] as unknown as Point }))
  for (const id of [...new Set(layout.nodes.map(node => node.entryAreaId).filter(Boolean))]) {
    if (areas.some(area => area.id === id)) continue
    const nodes = layout.nodes.filter(node => node.entryAreaId === id)
    areas.push({ id: id!, label: id === 'shared_origins' ? 'Shared origins / drop-off' : id === 'approach_network' ? 'Public approach waypoints' : id!, position: nodes[0].position })
  }
  const points = [...layout.placements.map(item => item.position), ...layout.nodes.map(item => item.position), ...(layout.markers ?? []).map(item => item.position)]
  // Editing envelope only; padding is not a survey or a claim of walkable ground.
  const bounds: Bounds = { minX: Math.min(...points.map(p => p[0])) - 120, maxX: Math.max(...points.map(p => p[0])) + 120, minZ: Math.min(...points.map(p => p[2])) - 120, maxZ: Math.max(...points.map(p => p[2])) + 120 }
  const requiredRoutes: RequiredRoute[] = rows(spatial.cohort_routes).map(row => ({ from: row.arrival_node_id, to: row.destination_node_id }))
  for (const route of rows(spatial.approach_routes)) requiredRoutes.push({ from: route.origin_id, to: route.arrival_node_id })
  const protectedNodeIds = new Set<string>()
  const protectedPlacementIds = new Set<string>()
  for (const row of rows(spatial.operational_bindings)) { if (row.node_id) protectedNodeIds.add(row.node_id); if (row.placement_id) protectedPlacementIds.add(row.placement_id) }
  for (const row of rows(spatial.service_stations)) for (const key of ['node_id', 'queue_start_node_id', 'queue_end_node_id']) if (row[key]) protectedNodeIds.add(row[key])
  for (const row of rows(spatial.operators)) if (row.attachment?.placement_id) protectedPlacementIds.add(row.attachment.placement_id)
  for (const row of rows(spatial.cohort_routes)) for (const id of row.lane_checkpoint_ids ?? []) protectedNodeIds.add(id)
  for (const row of rows(spatial.arrival_origins)) protectedNodeIds.add(row.id)
  const reviewedOverlaps: ReviewedOverlap[] = []
  for (const review of rows(spatial.approach_network?.review_overlaps)) {
    const edge = layout.edges.find(edge => edge.id === review.edge_id)
    if (!edge || edge.id !== 'approach_417744527_417744522' || edge.basis !== 'proposed_admission_overlap_site_review_required' || review.entry_area_id !== 'plaza_timur') continue
    const from = layout.nodes.find(node => node.id === edge.from), to = layout.nodes.find(node => node.id === edge.to)
    const allowed = ['plaza_timur_row_2_0', 'plaza_timur_row_2_1', 'plaza_timur_row_2_2']
    if (!from || !to || !Array.isArray(review.placement_ids) || review.placement_ids.length !== 3 || !allowed.every(id => review.placement_ids.includes(id))) continue
    const placements = layout.placements.filter(placement => allowed.includes(placement.id))
    if (placements.length === 3) reviewedOverlaps.push({ edgeId: edge.id, from: edge.from, to: edge.to, basis: edge.basis, fromPosition: from.position, toPosition: to.position, placements })
  }
  return { bounds, areas, requiredRoutes, reviewedOverlaps, protectedNodeIds: [...protectedNodeIds], protectedPlacementIds: [...protectedPlacementIds], initialAreaId: areas.some(area => area.id === 'plaza_utara') ? 'plaza_utara' : areas[0]?.id ?? null }
}

/** Project authored edits without rebuilding demand, station assignments or directed links. */
export function projectPlanEditorLayout(source: unknown, layout: EditorLayout): unknown {
  const shape = inspectLayoutShape(layout)
  if (shape.length) throw new Error(shape.map(issue => issue.message).join(' '))
  const plan = structuredClone(object(source)), spatial = object(plan.spatial_context), navigation = object(spatial.navigation)
  const original = compileSimulationPlan(source)
  const originalPlacements = new Map(rows(spatial.placements).map(row => [row.id, row]))
  const originalNodes = new Map(rows(navigation.nodes).map(row => [row.id, row]))
  const originalEdges = new Map(rows(navigation.edges).map(row => [row.id, row]))
  const resolvedNodes = new Map(layout.nodes.map(node => {
    const placement = layout.placements.find(item => item.id === node.attachment?.placementId)
    return [node.id, { ...node, position: placement && node.attachment ? localToWorld(node.attachment.offset, placement) : node.position }]
  }))
  const protectedIds = planEditorOptions(source)
  for (const id of protectedIds.protectedPlacementIds) if (!layout.placements.some(item => item.id === id)) throw new Error(`${id} is bound to operations; retain it or update operational bindings separately.`)
  for (const id of protectedIds.protectedNodeIds) if (!resolvedNodes.has(id)) throw new Error(`${id} is bound to operations and cannot be removed from this layout.`)
  spatial.placements = layout.placements.map(item => {
    const previous = originalPlacements.get(item.id) ?? {}
    const area = layout.placementAreas?.[item.id] ?? previous.entry_area_id
    if (!area) throw new Error(`${item.label} needs an entry-area assignment.`)
    const parameters = { ...previous.parameters }; delete parameters.bays
    if (item.bays !== undefined) parameters.bays = item.bays
    return { ...previous, id: item.id, label: item.label, preset_id: item.presetId, position_m: item.position, yaw_deg: item.yawDeg, entry_area_id: area, ...(Object.keys(parameters).length ? { parameters } : { parameters: undefined }) }
  })
  const changedNodes = new Set<string>()
  navigation.nodes = layout.nodes.map(node => {
    const previous = originalNodes.get(node.id) ?? {}
    const old = original.nodes.find(item => item.id === node.id)
    if (!old || !samePoint(old.position, resolvedNodes.get(node.id)!.position)) changedNodes.add(node.id)
    const row: Row = { ...previous, id: node.id, role: node.role, entry_area_id: node.entryAreaId ?? previous.entry_area_id }
    delete row.attachment; delete row.position_m
    if (node.attachment) row.attachment = { ...previous.attachment, placement_id: node.attachment.placementId, offset_m: node.attachment.offset }
    else row.position_m = node.position
    if (changedNodes.has(node.id) && previous.osm_node_id) { row.reference_position_m ??= old?.position; row.basis = 'user_authored_proposed_position' }
    return row
  })
  navigation.edges = layout.edges.map(edge => {
    const previous = originalEdges.get(edge.id) ?? {}
    const altered = !originalEdges.has(edge.id) || previous.from_node_id !== edge.from || previous.to_node_id !== edge.to || changedNodes.has(edge.from) || changedNodes.has(edge.to)
    const from = resolvedNodes.get(edge.from), to = resolvedNodes.get(edge.to)
    if (!from || !to) throw new Error(`${edge.id} has a missing endpoint.`)
    return { ...previous, id: edge.id, from_node_id: edge.from, to_node_id: edge.to, directed: true,
      ...(edge.basis ? { basis: edge.basis } : {}), ...(altered ? { basis: 'proposed_user_edited_connector', reference_basis: previous.reference_basis ?? previous.basis } : {}),
      ...(previous.distance_m !== undefined ? { distance_m: Math.hypot(...from.position.map((value, axis) => value - to.position[axis])) } : {}) }
  })
  for (const marker of layout.markers ?? []) {
    const area = rows(spatial.entry_areas).find(row => row.id === marker.entryAreaId)
    if (!area) throw new Error(`Unknown gate marker area ${marker.entryAreaId}.`)
    if (!samePoint(area.position_m, marker.position)) {
      area.reference_position_m ??= area.position_m
      area.position_m = marker.position
      area.marker_basis = 'user_authored_visual_marker_only'
    }
  }
  for (const origin of rows(spatial.arrival_origins)) {
    const node = resolvedNodes.get(origin.id)
    if (!node || node.role !== 'arrival' || node.entryAreaId !== 'shared_origins' || node.attachment) throw new Error(`${origin.label} must remain a fixed shared-origin arrival node.`)
    if (!samePoint(origin.position_m, node.position)) {
      origin.reference_position_m ??= origin.position_m
      origin.position_m = node.position
      origin.basis = 'user_authored_proposed_origin_position'
    }
  }
  spatial.revision = layout.revision
  // Compiler validates bindings and all cohort routes; sample one full group per lane
  // to validate the same selected paths used by playback and recompute native distances.
  const compiled = compileSimulationPlan(plan)
  const samples = compiled.config.cohorts.map(cohort => ({ ...cohort, count: (cohort.laneCheckpointIds?.length ?? 1) * (cohort.groupSize ?? 1) }))
  const sample = generateAbm({ ...compiled.config, cohorts: samples })
  if (sample.issues.length || sample.journeys.length !== samples.reduce((sum, cohort) => sum + cohort.count, 0)) throw new Error(sample.issues.join(' ') || 'An authored cohort route cannot be resolved.')
  const cohortMap = new Map(compiled.config.cohorts.map(cohort => [cohort.id, cohort]))
  const nodeMap = new Map(compiled.nodes.map(node => [node.id, node]))
  const distances = new Map<string, { weighted: number; weight: number }>()
  const approaches = new Map<string, { total: number; count: number }>()
  for (const journey of sample.journeys) {
    const cohort = cohortMap.get(journey.cohortId)!, areaId = nodeMap.get(cohort.destinationNodeId)?.entryAreaId
    const authoredRoute = rows(spatial.cohort_routes).find(row => row.category_id === cohort.categoryId)
    const entryIndex = journey.routeNodeIds.indexOf(authoredRoute?.arrival_node_id ?? cohort.arrivalNodeId)
    if (entryIndex < 0) throw new Error(`${cohort.id} no longer reaches its assigned entry arrival waypoint.`)
    let before = 0, after = 0
    for (let index = 1; index < journey.points.length; index++) {
      const length = Math.hypot(...journey.points[index].map((value, axis) => value - journey.points[index - 1][axis]))
      if (index <= entryIndex) before += length; else after += length
    }
    const weight = cohort.count / ((cohort.laneCheckpointIds?.length ?? 1) * (cohort.groupSize ?? 1))
    const distance = distances.get(areaId!) ?? { weighted: 0, weight: 0 }
    distance.weighted += after * weight; distance.weight += weight; distances.set(areaId!, distance)
    if (cohort.originId) {
      const key = `${cohort.originId}:${areaId}`, approach = approaches.get(key) ?? { total: 0, count: 0 }
      approach.total += before; approach.count++; approaches.set(key, approach)
    }
  }
  const native = object(object(plan.venue).layout)
  for (const area of rows(spatial.entry_areas)) {
    const gate = rows(native.gates).find(row => row.id === area.gate_id), distance = distances.get(area.id)
    if (!gate || !distance?.weight) continue
    for (const path of rows(native.walking_paths)) if (path.from === gate.queue_zone && path.to === gate.id) path.distance_m = distance.weighted / distance.weight
  }
  for (const route of rows(spatial.approach_routes)) {
    const value = approaches.get(`${route.origin_id}:${route.entry_area_id}`)
    if (value) { route.distance_m = value.total / value.count; if (changedNodes.size) route.basis = 'authored_network_with_user_edits' }
  }
  if (spatial.approach_network) spatial.approach_network.connectors = rows(navigation.edges).filter(edge => String(edge.basis ?? '').startsWith('proposed'))
  return plan
}
