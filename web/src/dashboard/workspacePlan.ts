import authoredGbk from '../../../contracts/examples/coldplay-gbk-demo-plan.json'
import { compileSimulationPlan } from '../simulation/plan/compile'
import { applyGateInputs, editableGates, type GateInputs } from '../simulation/plan/operatingInputs'
import { clockSeconds, validate, type Draft, type Plan } from './model'

const template: Plan = authoredGbk
const defaultOrigins = {
  origin_mrt: authoredGbk.event.audience_profile.arrival_mode_percent.mrt,
  origin_parking: authoredGbk.event.audience_profile.arrival_mode_percent.private_car,
  origin_dropoff: authoredGbk.event.audience_profile.arrival_mode_percent.ride_hailing_drop_off,
}

function mappedLayout(plan: Plan): Plan {
  const spatial = plan.spatial_context
  if (spatial?.one_way_admission && spatial?.service_stations?.length) return structuredClone(spatial)

  const authoredGates = editableGates(template)
  const gates: Plan[] = plan.venue.layout.gates
  if (gates.length !== authoredGates.length || gates.some(gate => !authoredGates.some(authored => authored.id === gate.id))) {
    throw new Error('The GBK workspace needs the five listed entry areas. Custom entrances need an authored layout.')
  }
  const edits: Record<string, GateInputs> = {}
  for (const gate of gates) {
    const authored = authoredGates.find(item => item.id === gate.id)!
    const lanes = gate.lanes[0]?.count
    if (gate.lanes.length !== 1 || gate.lanes[0]?.group !== 'general' || !Number.isSafeInteger(lanes) || lanes < 1 || lanes > authored.maxLanes) {
      throw new Error(`${gate.name} needs one lane group with 1–${authored.maxLanes} lanes to fit the mapped layout.`)
    }
    edits[gate.id] = { lanes, opens: gate.opens, closes: gate.closes }
  }
  return (applyGateInputs(template, edits, 0) as Plan).spatial_context
}

function projectRoutes(plan: Plan, spatial: Plan) {
  const nodes: Plan[] = spatial.navigation.nodes
  const edges: Plan[] = spatial.navigation.edges
  const routes: Plan[] = spatial.cohort_routes
  const byNode = new Map(nodes.map(node => [node.id, node]))
  spatial.cohort_routes = plan.event.ticket_categories.map((category: Plan) => {
    const area = (spatial.entry_areas as Plan[]).find(item => item.gate_id === category.entry_gate)
    const original = routes.find(route => route.category_id === category.id && byNode.get(route.destination_node_id)?.entry_area_id === area?.id)
    const route = original ?? routes.find(route => byNode.get(route.destination_node_id)?.entry_area_id === area?.id)
    if (!area || !route) throw new Error(`${category.name} needs a ticket category route at a mapped GBK entrance.`)
    category.entry_area_id = area.id
    if (original) return { ...original, category_id: category.id }

    const exit = edges.find(edge => edge.to_node_id === route.destination_node_id)
    const handover = exit && byNode.get(exit.from_node_id)
    if (!handover || handover.role !== 'destination') throw new Error(`${category.name} needs an authored stadium handover.`)
    const destinationId = `dashboard_handover_${category.id}`
    if (byNode.has(destinationId)) throw new Error(`Duplicate handover for ${category.name}.`)
    nodes.push({ ...handover, id: destinationId, label: `${category.name} handover` })
    edges.push({ ...exit, id: destinationId, to_node_id: destinationId })
    return { ...route, category_id: category.id, destination_node_id: destinationId }
  })
}

function bindStaff(plan: Plan, spatial: Plan) {
  const roles: Plan[] = plan.staff.roles
  const operators: Plan[] = spatial.operators
  const stations = new Map<string, Plan>((spatial.service_stations as Plan[]).map(station => [station.operator_id, station]))
  const points = new Map<string, Plan>([...plan.venue.layout.gates, ...(plan.venue.layout.service_points ?? [])].map(point => [point.id, point]))
  const assigned = new Map<Plan, number>()
  const rendered = new Map<string, number>()
  for (const operator of operators) {
    const station = stations.get(operator.id)
    const point = points.get(operator.point_id)
    if (!station || !point) throw new Error(`The layout needs a mapped checkpoint for ${operator.label}.`)
    const candidates = roles.flatMap(role => {
      if (!station.step_ids.every((step: string) => role.can_do?.includes(step))) return []
      return (role.assignment ?? []).filter((assignment: Plan) =>
        assignment.point === point.id && assignment.lane_group === point.lanes[0]?.group &&
        (assigned.get(assignment) ?? 0) < assignment.count,
      ).map((assignment: Plan) => ({ role, assignment }))
    })
    const match = candidates.find(candidate => candidate.role.id === operator.role_id) ?? candidates[0]
    if (!match) throw new Error(`${point.name} needs a qualified worker assigned to each mapped ${station.step_ids.includes('security_inspection') ? 'security' : station.step_ids.includes('eticket_scan') ? 'ticket scan' : 'help desk'} position.`)
    operator.role_id = match.role.id
    assigned.set(match.assignment, (assigned.get(match.assignment) ?? 0) + 1)
    rendered.set(match.role.id, (rendered.get(match.role.id) ?? 0) + 1)
  }
  for (const role of roles) {
    if ((rendered.get(role.id) ?? 0) !== role.count ||
      (role.assignment ?? []).some((assignment: Plan) => (assigned.get(assignment) ?? 0) !== assignment.count)) {
      throw new Error(`${role.name}: active staff and assignments must match mapped operator positions. Adjust lane and staff counts together.`)
    }
  }
}

function projectBehavior(plan: Plan, spatial: Plan) {
  const audience = plan.event.audience_profile
  const groupSize = audience.typical_group_size
  const groupShare = audience.arrive_in_groups_percent
  if (!Number.isSafeInteger(groupSize) || groupSize < 1 || !Number.isFinite(groupShare) || groupShare < 0 || groupShare > 100) {
    throw new Error('Enter a whole group size of at least 1 and a group-arrival share from 0 to 100%.')
  }
  const modalSplit = audience.arrival_mode_percent
  const originShares = modalSplit
    ? { origin_mrt: modalSplit.mrt, origin_parking: modalSplit.private_car, origin_dropoff: modalSplit.ride_hailing_drop_off }
    : defaultOrigins
  const profiles: Plan[] = []
  const cohorts = spatial.cohort_routes.flatMap((route: Plan) => {
    const category = plan.event.ticket_categories.find((item: Plan) => item.id === route.category_id)
    const arrivals = { ...plan.demand.arrival_windows_percent[category.id] }
    delete arrivals.basis
    const sizes = groupSize === 1 ? [{ size: 1, share: 100 }] : [{ size: 1, share: 100 - groupShare }, { size: groupSize, share: groupShare }]
    return sizes.filter(group => group.share > 0).map(group => {
      const id = `dashboard_${category.id}_${group.size}`
      profiles.push({
        id, label: `${category.name} · ${group.size === 1 ? 'solo' : `groups of ${group.size}`}`,
        group_size: group.size, walk_speed_mps: spatial.playback.walk_speed_mps,
        help_desk_visit_percent: 1, arrival_windows_percent: arrivals, origin_share_percent: originShares,
      })
      return {
        id, category_id: category.id, segment_id: id, share_percent: group.share,
        arrival_node_id: route.arrival_node_id, destination_node_id: route.destination_node_id,
      }
    })
  })
  return { schema_version: 'opsidio-behavior/0.1', basis: 'dashboard_input_projection', profiles, cohorts }
}

export function projectDashboardPlan(draft: Draft): Plan {
  if (draft.venueType !== 'public' || draft.plan.venue.id !== 'gbk-osm-local') {
    throw new Error('The full 3D workspace needs a mapped public GBK venue. You can still export your event plan.')
  }
  const validationPlan = structuredClone(draft.plan)
  for (const item of validationPlan.constraints.equipment.items as Plan[]) {
    if (Number.isSafeInteger(item.available) && Number.isSafeInteger(item.extra_rented) && item.extra_rented > 0) item.available += item.extra_rented
  }
  const issues = validate(validationPlan)
  if (issues.length) throw new Error(`Complete the plan before opening 3D. ${issues[0].message}`)

  const plan = structuredClone(draft.plan)
  const spatial = mappedLayout(plan)
  const start = plan.event.schedule.arrival_generation_start || plan.event.schedule.outer_area_open
  const end = plan.event.schedule.model_end || plan.event.schedule.show_end_estimate || plan.event.schedule.last_entry
  const horizon = clockSeconds(end) - clockSeconds(start)
  if (!Number.isFinite(horizon) || horizon <= 0) throw new Error('Set a same-day simulation start and end.')
  for (const category of plan.event.ticket_categories as Plan[]) {
    for (const range of Object.keys(plan.demand.arrival_windows_percent[category.id]).filter(key => key !== 'basis')) {
      const [from, to] = range.split('-')
      if (clockSeconds(from) < clockSeconds(start) || clockSeconds(to) > clockSeconds(end)) {
        throw new Error(`${category.name}: arrival windows must fit between ${start} and ${end} WIB.`)
      }
    }
  }
  spatial.playback = { ...spatial.playback, time_origin: `${plan.event.date}T${start}:00+07:00`, horizon_seconds: horizon }
  spatial.revision = Math.max(spatial.revision, draft.revision)
  plan.spatial_context = spatial
  plan.demand.attendance_basis = 'category_expected_arrivals'
  plan.demand.time_reference = 'origin_spawn'
  plan.meta.dashboard_form_revision = draft.revision
  plan.meta.dashboard_projection_assumptions = [
    'Arrival windows release people at MRT, parking or drop-off. Category forecasts determine modeled attendance.',
    'The workspace uses fixed typical service times and the mapped GBK walking routes. Bag mix, staff breaks and slow service estimates remain planning inputs.',
    'The simulation assigns 1% of each group profile to ticket help. All simulated help visits continue to admission.',
    ...(!plan.event.audience_profile.arrival_mode_percent ? ['Transport uses the GBK illustrative split because this form has no transport split.'] : []),
  ]
  projectRoutes(plan, spatial)
  bindStaff(plan, spatial)
  const help = plan.process_steps.steps.find((step: Plan) => step.id === 'help_desk_resolution')
  if (help?.results?.refused_percent > 0) throw new Error('This 3D model assumes ticket-help visits continue to admission. Export the form to keep its refusal assumptions.')
  plan.behavior_context = projectBehavior(plan, spatial)
  compileSimulationPlan(plan)
  return plan
}
