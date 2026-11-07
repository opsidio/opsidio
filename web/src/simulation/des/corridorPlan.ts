import { generateAbm } from '../abm/generator'
import { compileSimulationPlan } from '../plan/compile'
import { applyGateInputs, editableGates, type GateInputs } from '../plan/operatingInputs'
import type { AgentJourney } from '../runtime-types'
import type { Point } from '../types'

type JsonObject = Record<string, unknown>
type Money = { amount: string; currency: 'IDR' }
export type CorridorPlanDocument = {
  schema_version: 'corridor-1'
  name: string
  geometry_revision: string
  route: { nodes: { id: string; position: { x: number; y: number; z: number } }[]; scan_node_id: string }
  arrivals: { count: number; start_seconds: number; end_seconds: number }
  walking_speed_mps: number
  scan: {
    lanes: number
    physical_slots: number
    available_staff: number
    available_scanners: number
    service_seconds: number
    staff_cost_per_lane: Money
    scanner_cost_per_lane: Money
  }
  targets: { max_peak_scan_queue: number }
  budget: Money
  horizon_seconds: number
}

export type CorridorProjection = {
  document: CorridorPlanDocument
  gateId: string
  gateLabel: string
  startingLanes: number
  authoredLanes: number
  gateAttendees: number
  sampleStartSeconds: number
  sampleEndSeconds: number
  timeOrigin: string
}

type ProjectionSource = {
  gateId: string
  authoredPlan: JsonObject
  edits: Record<string, GateInputs>
  revisionDelta: number
  submitted: CorridorPlanDocument
}

const projectionSources = new WeakMap<CorridorProjection, ProjectionSource>()

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as JsonObject
}

function rows(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`)
  return value.map(item => object(item, label))
}

function amount(value: unknown, label: string): number {
  if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) {
    throw new Error(`${label} needs a nonnegative IDR estimate.`)
  }
  return value
}

const money = (idr: number): Money => ({ amount: amount(idr, 'Corridor cost').toFixed(2), currency: 'IDR' })

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]))
  if (Array.isArray(b)) return false
  const first = a as JsonObject, second = b as JsonObject
  const keys = Object.keys(first)
  return keys.length === Object.keys(second).length && keys.every(key => Object.hasOwn(second, key) && sameJson(first[key], second[key]))
}

function laneCosts(plan: JsonObject, gateId: string) {
  const layout = object(object(plan.venue, 'Venue').layout, 'Venue layout')
  const gate = rows(layout.gates, 'Gates').find(item => item.id === gateId)
  if (!gate) throw new Error('The selected entrance is missing its native gate.')
  const [group] = rows(gate.lanes, 'Gate lanes')
  const equipmentPerLane = object(group.equipment_per_lane, 'Lane equipment')
  const equipment = object(object(plan.constraints, 'Constraints').equipment, 'Equipment inventory')
  const items = rows(equipment.items, 'Equipment items')
  let equipmentCost = 0
  for (const [id, units] of Object.entries(equipmentPerLane)) {
    const item = items.find(item => item.id === id)
    equipmentCost += amount(units, `${id} units per lane`) * amount(item?.extra_cost_idr_per_unit, `${id} rental rate`)
  }
  const staff = object(plan.staff, 'Staff')
  const meal = amount(staff.meal_allowance_idr_per_person, 'Meal allowance')
  let staffCost = 0
  for (const role of rows(staff.roles, 'Staff roles')) {
    const assignments = rows(role.assignment, 'Staff assignments')
    for (const assignment of assignments.filter(item => item.point === gateId && item.lane_group === group.group)) {
      staffCost += amount(assignment.per_lane, 'Staff per lane') * (amount(role.rate_idr_per_shift, 'Shift rate') + meal)
    }
  }
  return { staffCost, equipmentCost }
}

function pathLength(points: readonly Point[], end = points.length - 1): number {
  let total = 0
  for (let i = 1; i <= end; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2])
  return total
}

export function projectCorridorPlan({ authoredPlan, activePlan, gateId, journeys }: {
  authoredPlan: unknown
  activePlan: unknown
  gateId: string
  /** Optional current worker journeys for the exact active snapshot. */
  journeys?: readonly AgentJourney[]
}): CorridorProjection {
  const source = object(structuredClone(authoredPlan), 'Authored plan')
  const active = object(activePlan, 'Active plan')
  const authored = compileSimulationPlan(source), compiled = compileSimulationPlan(active)
  const authoredGate = editableGates(source).find(gate => gate.id === gateId)
  const activeGates = editableGates(active)
  const activeGate = activeGates.find(gate => gate.id === gateId)
  if (!authoredGate || !activeGate) throw new Error('Choose an entrance with authored security and ticket scan lanes.')
  const authoredLanes = authoredGate.maxLanes
  const revisionDelta = compiled.layoutRevision - authored.layoutRevision
  if (compiled.layoutId !== authored.layoutId || revisionDelta < 0) throw new Error('The active draft must come from the authored layout.')
  const sourceSpatial = object(source.spatial_context, 'Authored spatial layout')
  object(sourceSpatial.playback, 'Playback').seed = compiled.config.seed
  const edits = Object.fromEntries(activeGates.map(gate => [gate.id, { lanes: gate.lanes, opens: gate.opens, closes: gate.closes }]))
  if (!sameJson(applyGateInputs(source, edits, revisionDelta), active)) {
    throw new Error('The active plan must match the authored layout and its gate inputs before optimization.')
  }

  const spatial = object(active.spatial_context, 'Active spatial layout')
  const area = rows(spatial.entry_areas, 'Entry areas').find(area => area.gate_id === gateId)
  const areaId = area?.id
  const destinations = new Set(compiled.nodes.filter(node => node.entryAreaId === areaId && node.role === 'destination').map(node => node.id))
  const gateCohorts = compiled.config.cohorts.filter(cohort => destinations.has(cohort.destinationNodeId))
  const gateAttendees = gateCohorts.reduce((sum, cohort) => sum + cohort.count, 0)
  const gateCategoryIds = new Set(gateCohorts.map(cohort => cohort.categoryId))
  const forecourts = new Set(rows(spatial.cohort_routes, 'Category routes').filter(route => typeof route.category_id === 'string' && gateCategoryIds.has(route.category_id)).map(route => route.arrival_node_id))
  const [forecourtId] = forecourts
  if (forecourts.size !== 1 || typeof forecourtId !== 'string' || !gateAttendees) {
    throw new Error('This entrance needs one forecourt and at least one planned attendee.')
  }
  const gateOperatorIds = new Set(compiled.operators.filter(operator => operator.pointId === gateId).map(operator => operator.id))
  const scanStations = (compiled.config.serviceStations ?? []).filter(station => station.admissionStage === 'scan' && gateOperatorIds.has(station.operatorId))
  const serviceSeconds = scanStations[0]?.serviceSeconds
  if (scanStations.length !== activeGate.lanes || !serviceSeconds || scanStations.some(station => station.serviceSeconds !== serviceSeconds)) {
    throw new Error('The selected gate needs one equally timed ticket scan station per active lane.')
  }
  const scanIds = new Set(scanStations.map(station => station.nodeId))

  if (!journeys) {
    const generated = generateAbm({ ...compiled.config, cohorts: gateCohorts })
    if (generated.issues.length) throw new Error(`Cannot sample this entrance: ${generated.issues[0]}`)
    journeys = generated.journeys
  }
  const speedByCohort = new Map(gateCohorts.map(cohort => [cohort.id, cohort.walkSpeedMps ?? compiled.config.walkSpeedMps]))
  const nodeById = new Map(compiled.nodes.map(node => [node.id, node]))
  const prefixByRoute = new Map<readonly string[], { index: number; distance: number }>()
  const arrivals: { seconds: number; speed: number; journey: AgentJourney; startIndex: number }[] = []
  for (const journey of journeys) {
    const speed = speedByCohort.get(journey.cohortId)
    if (speed === undefined) continue
    let prefix = prefixByRoute.get(journey.routeNodeIds)
    if (!prefix) {
      const index = journey.routeNodeIds.indexOf(forecourtId)
      const stale = journey.routeNodeIds.length !== journey.points.length || journey.routeNodeIds.some((id, i) => {
        const node = nodeById.get(id)
        return !node || node.position.some((value, axis) => value !== journey.points[i]?.[axis])
      })
      if (index < 0 || stale) throw new Error('A sampled journey differs from its active forecourt route. Regenerate the active plan.')
      prefix = { index, distance: pathLength(journey.points, index) }
      prefixByRoute.set(journey.routeNodeIds, prefix)
    }
    const seconds = journey.onsiteArrivalSeconds + prefix.distance / speed
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('The selected gate has invalid arrival times.')
    arrivals.push({ seconds, speed, journey, startIndex: prefix.index })
  }
  if (arrivals.length !== gateAttendees) throw new Error('Regenerate the active simulation before using its entrance arrivals.')
  arrivals.sort((a, b) => a.seconds - b.seconds || a.journey.id.localeCompare(b.journey.id))
  const wave = arrivals
  const sampleCount = wave.length
  const sampleStartSeconds = wave[0].seconds, sampleEndSeconds = wave[wave.length - 1].seconds
  const widthSeconds = sampleEndSeconds - sampleStartSeconds
  const walkingSpeed = wave.reduce((sum, item) => sum + item.speed, 0) / sampleCount
  const validRoute = ({ journey, startIndex }: typeof wave[number]) => {
    const ids = journey.routeNodeIds.slice(startIndex)
    return ids.length >= 3 && ids.length <= 32 && ids.slice(1, -1).some(id => scanIds.has(id))
  }
  const helpId = area?.help_checkpoint_node_id
  const representative = wave.find(item => validRoute(item) && !item.journey.routeNodeIds.includes(String(helpId))) ?? wave.find(validRoute)
  if (!representative) throw new Error('The sampled wave needs one authored route with 3–32 nodes through ticket scan to handover.')
  const routeIds = representative.journey.routeNodeIds.slice(representative.startIndex)
  const routePoints = representative.journey.points.slice(representative.startIndex)
  const route = {
    nodes: routeIds.map((id, index) => {
      const [x, y, z] = routePoints[index]
      return { id, position: { x, y, z } }
    }),
    scan_node_id: routeIds.find(id => scanIds.has(id))!,
  }
  const { staffCost, equipmentCost } = laneCosts(source, gateId)
  const horizon = Math.ceil(Math.max(widthSeconds, sampleCount * serviceSeconds / activeGate.lanes)
    + pathLength(routePoints) / walkingSpeed + serviceSeconds + 1)
  if (!Number.isFinite(horizon) || horizon > 86400) throw new Error('The representative corridor exceeds Doni’s 24-hour horizon.')
  const document: CorridorPlanDocument = {
    schema_version: 'corridor-1',
    name: `${activeGate.label} · Full entrance arrival window`,
    geometry_revision: `${compiled.layoutId}:r${compiled.layoutRevision}:${gateId}`,
    route,
    arrivals: { count: sampleCount, start_seconds: 0, end_seconds: widthSeconds },
    walking_speed_mps: walkingSpeed,
    scan: {
      lanes: activeGate.lanes, physical_slots: authoredLanes, available_staff: authoredLanes, available_scanners: authoredLanes,
      service_seconds: serviceSeconds, staff_cost_per_lane: money(staffCost), scanner_cost_per_lane: money(equipmentCost),
    },
    targets: { max_peak_scan_queue: 0 },
    budget: money((staffCost + equipmentCost) * authoredLanes),
    horizon_seconds: horizon,
  }
  const projection = {
    document, gateId, gateLabel: activeGate.label, startingLanes: activeGate.lanes, authoredLanes, gateAttendees,
    sampleStartSeconds, sampleEndSeconds, timeOrigin: compiled.config.timeOrigin,
  }
  projectionSources.set(projection, { gateId, authoredPlan: source, edits, revisionDelta, submitted: structuredClone(document) })
  return projection
}

/** Doni can increase one scan count. Reopen only complete, existing security and scan pairs. */
export function applyCorridorCandidate(projection: CorridorProjection, candidateDocument: unknown): unknown {
  const source = projectionSources.get(projection)
  if (!source) throw new Error('Reconcile the candidate against its original submitted corridor.')
  const scan = object(object(candidateDocument, 'Returned corridor').scan, 'Returned scan')
  const lanes = scan.lanes
  const { submitted } = source
  const maximum = Math.min(submitted.scan.physical_slots, submitted.scan.available_staff, submitted.scan.available_scanners)
  if (typeof lanes !== 'number' || !Number.isSafeInteger(lanes) || lanes <= submitted.scan.lanes || lanes > maximum) {
    throw new Error(`The candidate must add staffed lanes within the authored ${maximum}-lane capacity.`)
  }
  const expected = { ...submitted, scan: { ...submitted.scan, lanes } }
  if (!sameJson(expected, candidateDocument)) throw new Error('The returned corridor changes more than its active scan lanes.')
  const gate = source.edits[source.gateId]
  const plan = applyGateInputs(source.authoredPlan, { ...source.edits, [source.gateId]: { ...gate, lanes } }, source.revisionDelta + 1)
  compileSimulationPlan(plan)
  return plan
}
