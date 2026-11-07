import layouts from './gbk-expansion-layouts.json' with { type: 'json' }
import { catalogue } from '../model.ts'
import { createConfigHash } from '../abm/worker-protocol.ts'
import { validateLayout } from '../layout/core.ts'
import { createPlanEditorLayout, planEditorOptions } from '../layout/planAdapter.ts'
import { compileSimulationPlan } from './compile.ts'
import { applyGateInputs, editableGates } from './operatingInputs.ts'
import { reportCosts } from '../ui/simulationReportData.ts'

type Row = Record<string, any>
type Geometry = {
  placements: Row[]
  navigation: { nodes: Row[]; edges: Row[] }
}
type LayoutOption = Geometry & {
  count: number; widthM: number; queue: Row; entry_areas: Row[];
  operational_bindings: Row[]; operators: Row[]; service_stations: Row[]; laneIds: string[]
}
export type Expansion = {
  plan: unknown; lanes: number; widthM: number | null; extraWidthM: number;
  staffAdded: number; equipment: { label: string; units: number }[]; costAdded: number | null;
  review: string[];
}

const geometryKey = (row: Row) => createConfigHash([
  row.preset_id, row.yaw_deg, row.parameters?.bays, row.attachment ?? row.position_m, row.from_node_id, row.to_node_id,
])

function replaceGeometry(current: Row[], before: Row[], after: Row[], collection: string): Row[] {
  const original = new Map(before.map(row => [row.id, geometryKey(row)]))
  for (const row of current) {
    const key = original.get(row.id)
    if (key !== undefined && key !== geometryKey(row)) throw new Error(`The selected entrance has custom ${collection}. Use the existing authored lanes or review its geometry in the editor.`)
  }
  return [...current.filter(row => !original.has(row.id)), ...structuredClone(after)]
}

function expandLayout(source: Row, gateId: string, before: LayoutOption, after: LayoutOption) {
  const plan = structuredClone(source)
  const layout = plan.venue.layout
  const gate = layout.gates.find((item: Row) => item.id === gateId)
  const areaId = before.entry_areas[0].id
  const spatial = plan.spatial_context
  const area = spatial.entry_areas.find((item: Row) => item.id === areaId)
  if (createConfigHash(area.corridor) !== createConfigHash(before.entry_areas[0].corridor)) {
    throw new Error('The selected entrance has a custom corridor. Use the existing authored lanes or review its geometry in the editor.')
  }
  if (spatial.placements.some((row: Row) => row.entry_area_id === areaId && !before.placements.some(item => item.id === row.id))) {
    throw new Error('The selected entrance has additional equipment. Review its position in the editor before expanding it.')
  }
  spatial.placements = replaceGeometry(spatial.placements, before.placements, after.placements, 'equipment positions')
  spatial.navigation.nodes = replaceGeometry(spatial.navigation.nodes, before.navigation.nodes, after.navigation.nodes, 'waypoints')
  spatial.navigation.edges = replaceGeometry(spatial.navigation.edges, before.navigation.edges, after.navigation.edges, 'walking routes')
  const affected = new Set(plan.event.ticket_categories.filter((row: Row) => row.entry_gate === gateId).map((row: Row) => row.id))
  for (const route of spatial.cohort_routes) if (affected.has(route.category_id)) route.lane_checkpoint_ids = [...after.laneIds]

  const currentOps = new Map<string, Row>(spatial.operators.filter((item: Row) => item.point_id === gateId).map((item: Row) => [item.id, item]))
  const stationByOperator = new Map<string, Row>(spatial.service_stations.filter((item: Row) => item.point_id === gateId).map((item: Row) => [item.operator_id, item]))
  const currentOpsByStep = new Map([...stationByOperator].map(([id, item]) => [item.step_ids[0], currentOps.get(id)]))
  const newStations = after.service_stations.filter(item => item.point_id === gateId)
  const newOperators = newStations.map(station => {
    const geometry = after.operators.find(item => item.id === station.operator_id)!
    const assigned = currentOps.get(geometry.id) ?? currentOpsByStep.get(station.step_ids[0])
    if (!assigned) throw new Error('The entrance needs an existing security and scan staffing assignment.')
    return { ...structuredClone(geometry), role_id: assigned.role_id }
  })
  const roleIds = new Set([...currentOps.values()].map(operator => operator.role_id))
  for (const id of roleIds) {
    const role = plan.staff.roles.find((item: Row) => item.id === id)
    const [assignment] = role?.assignment ?? []
    if (role?.assignment?.length !== 1 || assignment?.point !== gateId || assignment?.per_lane !== 1) {
      throw new Error('Lane expansion needs separate per-lane staffing assignments at this entrance.')
    }
    const count = newOperators.filter(item => item.role_id === id).length
    role.count = count
    assignment.count = count
    if (role.gender) role.gender = { ...role.gender, female: Math.floor(count / 2), male: Math.ceil(count / 2) }
  }
  spatial.operators = [...spatial.operators.filter((item: Row) => item.point_id !== gateId), ...newOperators]
  spatial.service_stations = [...spatial.service_stations.filter((item: Row) => item.point_id !== gateId), ...structuredClone(newStations)]
  spatial.operational_bindings = [...spatial.operational_bindings.filter((item: Row) => item.point_id !== gateId),
    ...structuredClone(after.operational_bindings.filter(item => item.point_id === gateId))]
  const oldWidth = area.corridor.illustrative_width_m
  area.corridor = structuredClone(after.entry_areas[0].corridor)
  gate.lanes[0].count = after.count
  gate.max_lanes = after.count
  gate.frontage_m = after.widthM
  if (after.widthM > oldWidth) {
    area.basis = 'illustrative_expansion_site_review_required'
    area.review_status = 'site_review_required'
  }
  const queue = layout.zones.find((zone: Row) => zone.id === gate.queue_zone)
  if (queue) for (const key of ['length_m', 'area_m2', 'barricade_m', 'switchback_rows']) queue[key] = after.queue[key]
  spatial.revision++
  if (plan.meta && Number.isInteger(plan.meta.revision)) plan.meta.revision = spatial.revision
  return plan
}

function equipmentUsage(plan: Row) {
  const usage = new Map<string, number>()
  const layout = plan.venue.layout
  for (const point of [...layout.gates, ...(layout.service_points ?? [])]) {
    for (const lane of point.lanes ?? []) {
      for (const [id, quantity] of Object.entries<number>(lane.equipment_per_lane ?? {})) {
        usage.set(id, (usage.get(id) ?? 0) + quantity * lane.count)
      }
    }
  }
  return usage
}

function proposalResources(source: Row, plan: Row, gate: Row, additionalLanes: number) {
  const review: string[] = []
  const usage = equipmentUsage(plan)
  const beforeUsage = equipmentUsage(source)
  const equipment: Expansion['equipment'] = []
  for (const [id, perLane] of Object.entries<number>(gate.lanes[0].equipment_per_lane ?? {})) {
    if (perLane <= 0) continue
    const item = plan.constraints?.equipment?.items?.find((record: Row) => record.id === id)
    equipment.push({ label: item?.name ?? id, units: perLane * additionalLanes })
    if (!item) {
      review.push(`Confirm ${perLane * additionalLanes} additional units of ${id}.`)
      continue
    }
    const required = usage.get(id) ?? 0
    const alreadyRented = item.extra_rented ?? 0
    const extraNeeded = Math.max(0, required - item.available - alreadyRented)
    if (extraNeeded > 0) {
      const rentable = Math.max(0, item.extra_rentable - alreadyRented)
      item.extra_rented = alreadyRented + Math.min(extraNeeded, rentable)
      if (Number.isFinite(item.extra_cost_idr_per_unit) && Number.isFinite(item.committed_cost_idr)) {
        const existingShortage = Math.max(0, (beforeUsage.get(id) ?? 0) - item.available - alreadyRented)
        item.committed_cost_idr += Math.max(0, extraNeeded - existingShortage) * item.extra_cost_idr_per_unit
      }
      if (extraNeeded > rentable) review.push(`${item.name}: confirm ${extraNeeded - rentable} units beyond recorded stock and rental capacity.`)
    }
  }
  for (const role of plan.staff.roles) {
    if (role.assignment?.some((item: Row) => item.point === gate.id) && role.count > role.pool_limit_total) {
      review.push(`${role.name}: confirm ${role.count - role.pool_limit_total} staff beyond the recorded pool.`)
    }
  }
  const oldCosts = reportCosts(source), newCosts = reportCosts(plan), budget = plan.constraints?.budget
  if (newCosts.wages !== null && newCosts.meals !== null && newCosts.wages + newCosts.meals > budget?.staff_cap_idr) review.push('The estimated staffing cost exceeds the plan’s staff budget.')
  if (newCosts.equipment !== null && newCosts.equipment > budget?.equipment_cap_idr) review.push('The estimated equipment cost exceeds the plan’s equipment budget.')
  return {
    review, equipment,
    staffAdded: (newCosts.headcount ?? 0) - (oldCosts.headcount ?? 0),
    costAdded: newCosts.total === null || oldCosts.total === null ? null : newCosts.total - oldCosts.total,
  }
}

export function expansionPlans(activePlan: unknown, authoredPlan: unknown, gateId: string): { proposals: Expansion[]; skipped: string[] } {
  const source = activePlan as Row, authored = authoredPlan as Row
  const active = editableGates(source).find(gate => gate.id === gateId)
  if (!active) throw new Error('Choose an entrance with a mapped security and ticket scan layout.')
  const authoredCapacity = editableGates(authored).find(gate => gate.id === gateId)?.maxLanes ?? active.lanes
  const area = source.spatial_context.entry_areas.find((item: Row) => item.gate_id === gateId)
  const options = source.venue.id === 'gbk-osm-local'
    ? ((layouts as unknown as Record<string, LayoutOption[]>)[area?.id] ?? [])
    : []
  const width = area?.corridor?.illustrative_width_m
  const before = options.find(item => createConfigHash(item.entry_areas[0].corridor) === createConfigHash(area.corridor))
  const proposals: Expansion[] = [], skipped: string[] = []
  const templateCapacity = before ? options.at(-1)?.count ?? 0 : 0
  const maxCount = Math.max(Math.min(authoredCapacity, active.lanes + 2), templateCapacity)
  for (let lanes = active.lanes + 1; lanes <= maxCount; lanes++) {
    try {
      const layout = options.find(option => option.count >= lanes)
      let plan: Row
      if (lanes <= authoredCapacity) {
        const edits = Object.fromEntries(editableGates(source).map(gate => [gate.id, gate.id === gateId ? { ...gate, lanes } : gate]))
        plan = applyGateInputs(authored, edits, source.spatial_context.revision - authored.spatial_context.revision + 1) as Row
        plan.spatial_context.playback.seed = source.spatial_context.playback.seed
      } else {
        if (!before || !layout) throw new Error('This corridor differs from the available GBK layout templates.')
        plan = expandLayout(source, gateId, before, layout)
        if (lanes < layout.count) plan = applyGateInputs(plan, { [gateId]: { ...active, lanes } }, 0) as Row
      }
      const validation = validateLayout(createPlanEditorLayout(plan), { ...planEditorOptions(plan), catalogue })
      if (!validation.valid) throw new Error(validation.issues.find(item => item.severity === 'error')?.message ?? 'The proposed layout has an invalid route.')
      const gate = plan.venue.layout.gates.find((item: Row) => item.id === gateId)
      const resources = proposalResources(source, plan, gate, lanes - active.lanes)
      const widthM = lanes > authoredCapacity ? layout?.widthM ?? null : Number.isFinite(width) ? width as number : null
      const extraWidthM = Number.isFinite(width) && widthM !== null ? Math.max(0, widthM - width) : 0
      if (extraWidthM > 0) resources.review.unshift(`Confirm an operating envelope ${extraWidthM.toFixed(1)} m wider at this entrance.`)
      if (lanes > authoredCapacity) {
        const stage = (data: Row, preset: string) => (data.spatial_context.placements as Row[])
          .filter(item => item.entry_area_id === area.id && item.preset_id === preset)
        const panels = stage(plan, 'barrier-230').length - stage(source, 'barrier-230').length
        const bays = (items: Row[]) => items.reduce((total, item) => total + (item.parameters?.bays ?? 0), 0)
        const extraBays = bays(stage(plan, 'roder-10')) - bays(stage(source, 'roder-10'))
        if (panels > 0 || extraBays > 0) {
          const staging = [panels > 0 && `${panels} extra barrier panels`, extraBays > 0 && `${extraBays} extra canopy bays`].filter(Boolean)
          resources.review.push(`Confirm ${staging.join(' and ')} and their installation cost.`)
        }
      }
      plan.meta ??= {}
      plan.meta.expansion_proposal = { gate_id: gateId, from_lanes: active.lanes, to_lanes: lanes, required_width_m: widthM, review: resources.review }
      compileSimulationPlan(plan)
      proposals.push({ plan, lanes, widthM, extraWidthM, ...resources })
    } catch (error) {
      skipped.push(`${lanes} lanes: ${error instanceof Error ? error.message : 'Invalid layout.'}`)
    }
  }
  return { proposals, skipped }
}
