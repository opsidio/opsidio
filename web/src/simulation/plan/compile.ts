import { catalogue } from '../model'
import { generateAbm } from '../abm/generator'
import { isPoint, localToWorld } from '../layout/core'
import type { AbmConfig, CohortDemand, ServiceStation, LayoutRevision, NavigationEdge, NavigationNode } from '../runtime-types'
import type { EntryAreaMarker, Placement, Point } from '../types'
import type { OperationsOperator } from '../../scene/OperationsLayer'

type JsonObject = Record<string, unknown>
export type CompiledSimulationPlan = {
  config: AbmConfig
  placements: Placement[]
  nodes: NavigationNode[]
  edges: NavigationEdge[]
  operators: OperationsOperator[]
  entryAreas: EntryAreaMarker[]
  northLayout: LayoutRevision
  layoutId: string
  layoutRevision: number
  segments: { id: string; label: string; attendees: number }[]
  arrivalOrigins: { id: string; label: string; mode: 'mrt' | 'parking' | 'taxi_ride_hailing'; position: Point; attendees: number; sourceUrl?: string; basis?: string }[]
}
function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  return value as JsonObject
}
function list(value: unknown, path: string): JsonObject[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error(`${path} must be an array with at most 5,000 entries.`)
  return value.map((item, index) => object(item, `${path}[${index}]`))
}
function name(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} is required.`)
  return value
}
function number(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`${path} must be a finite number ≥ ${minimum}.`)
  return value
}
function point(value: unknown, path: string): Point {
  if (!isPoint(value) || value[1] !== 0) throw new Error(`${path} needs ground coordinates [x, 0, z] in metres.`)
  return value
}
function unique<T extends { id: string }>(items: T[], path: string): Map<string, T> {
  const result = new Map(items.map(item => [item.id, item]))
  if (result.size !== items.length) throw new Error(`${path} contains duplicate IDs.`)
  return result
}
function seconds(clock: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error(`Invalid clock ${clock}. Use HH:MM.`)
  return Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3)) * 60
}

/** Largest remainders distribute whole groups; only the final incomplete group may be partial. */
function allocateOrigins(count: number, groupSize: number, shares: { id: string; share: number }[]): number[] {
  const groups = Math.floor(count / groupSize)
  const allocated = shares.map(item => Math.floor(groups * item.share / 100))
  const remainder = groups - allocated.reduce((sum, value) => sum + value, 0)
  shares.map((item, index) => ({ index, id: item.id, fraction: groups * item.share / 100 % 1 }))
    .sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id)).slice(0, remainder).forEach(item => { allocated[item.index]++ })
  const people = allocated.map(value => value * groupSize)
  const partial = count % groupSize
  if (partial) {
    const preferred = shares.map((item, index) => ({ index, id: item.id, deficit: count * item.share / 100 - people[index] }))
      .sort((a, b) => b.deficit - a.deficit || a.id.localeCompare(b.id))[0]
    people[preferred.index] += partial
  }
  return people
}

/** Validate a complete local plan before using any of its coordinates or counts. */
export function compileSimulationPlan(input: unknown): CompiledSimulationPlan {
  const plan = object(input, 'Plan')
  if (plan.schema_version !== '0.1') throw new Error('Use Doni PlanDocument schema_version 0.1.')
  const spatial = object(plan.spatial_context, 'spatial_context')
  if (spatial.schema_version !== 'opsidio-layout/0.1' || spatial.venue_id !== 'gbk-osm-local') throw new Error('This viewer needs GBK spatial_context opsidio-layout/0.1.')
  const frame = object(spatial.coordinate_frame, 'coordinate_frame')
  const axes = object(frame.axes, 'coordinate_frame.axes')
  const origin = object(frame.origin_wgs84, 'coordinate_frame.origin_wgs84')
  if (frame.units !== 'm' || frame.vertical_reference !== 'local_ground' || axes.x !== 'east' || axes.y !== 'up' || axes.z !== 'south' || origin.longitude_deg !== 106.80255 || origin.latitude_deg !== -6.21858) throw new Error('The spatial coordinate frame must match the GBK venue origin and axes.')
  const placementRows = list(spatial.placements, 'placements')
  const placements: Placement[] = placementRows.map(item => {
    const presetId = name(item.preset_id, 'preset_id')
    if (!catalogue.some(preset => preset.id === presetId)) throw new Error(`Unknown equipment preset ${presetId}.`)
    const bays = item.parameters ? object(item.parameters, 'parameters').bays : undefined
    if (bays !== undefined && (!Number.isInteger(bays) || Number(bays) < 1 || Number(bays) > 12)) throw new Error('Roder bays must be a whole number from 1 to 12.')
    return { id: name(item.id, 'placement.id'), label: name(item.label, 'placement.label'), presetId, position: point(item.position_m, 'placement.position_m'), yawDeg: number(item.yaw_deg, 'yaw_deg', -36000), ...(bays !== undefined ? { bays: Number(bays) } : {}) }
  })
  const placementMap = unique(placements, 'placements')
  const attachment = (value: unknown): { placementId: string; offset: Point } => {
    const item = object(value, 'attachment')
    const placementId = name(item.placement_id, 'attachment.placement_id')
    if (!placementMap.has(placementId)) throw new Error(`Attachment references missing placement ${placementId}.`)
    return { placementId, offset: point(item.offset_m, 'attachment.offset_m') }
  }
  const navigation = object(spatial.navigation, 'navigation')
  const nodes: NavigationNode[] = list(navigation.nodes, 'nodes').map(item => {
    const role = name(item.role, 'node.role')
    if (!['arrival', 'waypoint', 'checkpoint', 'destination'].includes(role)) throw new Error(`Unknown node role ${role}.`)
    const attached = item.attachment ? attachment(item.attachment) : undefined
    return { id: name(item.id, 'node.id'), role: role as NavigationNode['role'], entryAreaId: name(item.entry_area_id, 'node.entry_area_id'), position: attached ? localToWorld(attached.offset, placementMap.get(attached.placementId)!) : point(item.position_m, 'node.position_m'), ...(attached ? { attachment: attached } : {}) }
  })
  const nodeMap = unique(nodes, 'nodes')
  const arrivalOrigins: CompiledSimulationPlan['arrivalOrigins'] = spatial.arrival_origins === undefined ? [] : list(spatial.arrival_origins, 'arrival_origins').map(item => {
    const id = name(item.id, 'origin.id'), mode = name(item.mode, 'origin.mode')
    const modes: Record<string, string> = { origin_mrt: 'mrt', origin_parking: 'parking', origin_dropoff: 'taxi_ride_hailing' }
    if (modes[id] !== mode) throw new Error(`Unknown arrival origin or mode ${id}/${mode}.`)
    const position = point(item.position_m, 'origin.position_m'), node = nodeMap.get(id)
    if (!node || node.role !== 'arrival' || node.entryAreaId !== 'shared_origins' || node.attachment || node.position.some((value, axis) => value !== position[axis])) throw new Error(`Arrival origin ${id} needs a matching shared_origins arrival node and coordinates.`)
    return { id, label: name(item.label, 'origin.label'), mode: mode as CompiledSimulationPlan['arrivalOrigins'][number]['mode'], position, attendees: 0, ...(item.source_url !== undefined ? { sourceUrl: name(item.source_url, 'origin.source_url') } : {}), ...(item.basis !== undefined ? { basis: name(item.basis, 'origin.basis') } : {}) }
  })
  const originMap = unique(arrivalOrigins, 'arrival_origins')
  if (spatial.arrival_origins !== undefined && !arrivalOrigins.length) throw new Error('arrival_origins must declare at least one origin.')
  if (nodes.some(node => node.entryAreaId === 'shared_origins' && !originMap.has(node.id))) throw new Error('A shared origin node is missing its arrival_origins definition.')
  const edges: NavigationEdge[] = list(navigation.edges, 'edges').map(item => {
    const from = name(item.from_node_id, 'edge.from_node_id'), to = name(item.to_node_id, 'edge.to_node_id')
    if (item.directed !== true || !nodeMap.has(from) || !nodeMap.has(to)) throw new Error(`Edge ${String(item.id)} needs existing endpoints and directed=true.`)
    return { id: name(item.id, 'edge.id'), from, to, ...(typeof item.basis === 'string' ? { basis: item.basis } : {}) }
  })
  unique(edges, 'edges')
  const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]))
  const endpointPairs = new Set<string>()
  for (const edge of edges) {
    const pair = JSON.stringify([edge.from, edge.to])
    if (endpointPairs.has(pair)) throw new Error('Navigation contains duplicate directed edges.')
    endpointPairs.add(pair)
    outgoing.get(edge.from)!.push(edge.to)
  }
  const reachable = new Map<string, Set<string>>()
  const canReach = (from: string, to: string): boolean => {
    if (!reachable.has(from)) {
      const seen = new Set([from]), pending = [from]
      for (let index = 0; index < pending.length; index++) for (const next of outgoing.get(pending[index]) ?? []) if (!seen.has(next)) { seen.add(next); pending.push(next) }
      reachable.set(from, seen)
    }
    return reachable.get(from)!.has(to)
  }
  const event = object(plan.event, 'event')
  const noShow = number(object(event.capacity, 'event.capacity').no_show_percent_estimate, 'no_show_percent_estimate')
  if (noShow > 100) throw new Error('No-show percentage must be 0–100.')
  const categories = list(event.ticket_categories, 'event.ticket_categories')
  unique(categories.map(category => ({ ...category, id: name(category.id, 'category.id') })), 'categories')
  const routes = unique<JsonObject & { id: string }>(list(spatial.cohort_routes, 'cohort_routes').map(route => ({ ...route, id: name(route.category_id, 'category_id') })), 'cohort_routes')
  if (routes.size !== categories.length) throw new Error('Every category needs one authored route.')
  const demand = object(object(plan.demand, 'demand').arrival_windows_percent, 'arrival_windows_percent')
  const playback = object(spatial.playback, 'playback')
  const timeOrigin = name(playback.time_origin, 'time_origin')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+07:00$/.test(timeOrigin) || !Number.isFinite(Date.parse(timeOrigin))) throw new Error('Use a WIB time_origin with +07:00 offset.')
  const originSeconds = seconds(timeOrigin.slice(11, 16))
  const expected = categories.map(category => {
    const tickets = number(category.complimentary === true ? category.issued : category.sold, `${String(category.id)} ticket count`)
    if (!Number.isSafeInteger(tickets)) throw new Error('Ticket counts must be safe whole numbers.')
    return tickets * (1 - noShow / 100)
  })
  const counts = expected.map(Math.floor)
  const residual = Math.round(expected.reduce((sum, value) => sum + value, 0)) - counts.reduce((sum, value) => sum + value, 0)
  expected.map((value, index) => ({ index, fraction: value - Math.floor(value), id: String(categories[index].id) })).sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id)).slice(0, residual).forEach(({ index }) => { counts[index]++ })
  const categoryCohortDefaults: CohortDemand[] = categories.map((category, index) => {
    const id = String(category.id), route = routes.get(id)
    if (!route) throw new Error(`Missing route for ${id}.`)
    const arrivalNodeId = name(route.arrival_node_id, 'arrival_node_id'), destinationNodeId = name(route.destination_node_id, 'destination_node_id')
    if (nodeMap.get(arrivalNodeId)?.role !== 'arrival' || nodeMap.get(destinationNodeId)?.role !== 'destination') throw new Error(`Invalid arrival or destination for ${id}.`)
    if ((!originMap.has(arrivalNodeId) && nodeMap.get(arrivalNodeId)?.entryAreaId !== category.entry_area_id) || nodeMap.get(destinationNodeId)?.entryAreaId !== category.entry_area_id) throw new Error(`Invalid category entry area for ${id}.`)
    if (route.lane_checkpoint_ids !== undefined && !Array.isArray(route.lane_checkpoint_ids)) throw new Error('lane_checkpoint_ids must be an array.')
    const shares = object(demand[id], `arrival_windows_percent.${id}`)
    const windows = Object.entries(shares).filter(([key]) => key !== 'basis').map(([window, share]) => {
      const parts = window.split('-')
      if (parts.length !== 2) throw new Error(`Invalid arrival window ${window}.`)
      const startSeconds = seconds(parts[0]) - originSeconds, endSeconds = seconds(parts[1]) - originSeconds
      if (startSeconds < 0 || endSeconds <= startSeconds) throw new Error(`Invalid time range ${window}.`)
      return { startSeconds, endSeconds, sharePercent: number(share, `${id}.${window}`) }
    })
    if (Math.abs(windows.reduce((sum, window) => sum + window.sharePercent, 0) - 100) > 1e-6) throw new Error(`${id} arrival shares must sum to 100%.`)
    return { id, categoryId: id, count: counts[index], arrivalNodeId, destinationNodeId, windows, ...(Array.isArray(route.lane_checkpoint_ids) ? { laneCheckpointIds: route.lane_checkpoint_ids.map(value => name(value, 'lane checkpoint')) } : {}), groupSize: number(playback.group_size, 'group_size', 1) }
  })
  let cohorts = categoryCohortDefaults
  const segments: CompiledSimulationPlan['segments'] = []
  if (plan.behavior_context !== undefined) {
    const behavior = object(plan.behavior_context, 'behavior_context')
    if (behavior.schema_version !== 'opsidio-behavior/0.1') throw new Error('Use behavior_context opsidio-behavior/0.1.')
    const profiles = unique<JsonObject & { id: string }>(list(behavior.profiles, 'behavior profiles').map(profile => ({ ...profile, id: name(profile.id, 'profile.id') })), 'profiles')
    const profileOrigins = new Map<string, { id: string; share: number }[]>()
    for (const profile of profiles.values()) {
      if (!arrivalOrigins.length) {
        if (profile.origin_share_percent !== undefined) throw new Error('Profile origin shares require spatial arrival_origins.')
        continue
      }
      const shares = object(profile.origin_share_percent, 'profile.origin_share_percent')
      if (Object.keys(shares).some(id => !originMap.has(id)) || arrivalOrigins.some(origin => shares[origin.id] === undefined)) throw new Error('Profile origin shares must reference every declared arrival origin and no unknown origins.')
      const normalized = arrivalOrigins.map(origin => ({ id: origin.id, share: number(shares[origin.id], `profile.origin_share_percent.${origin.id}`) }))
      if (Math.abs(normalized.reduce((sum, item) => sum + item.share, 0) - 100) > 1e-6) throw new Error('Profile origin shares must sum to 100%.')
      profileOrigins.set(profile.id, normalized)
    }
    const definitions = list(behavior.cohorts, 'behavior cohorts')
    unique(definitions.map(item => ({ id: name(item.id, 'cohort.id') })), 'behavior cohorts')
    const categoryIds = new Set(categories.map(category => category.id))
    if (definitions.some(item => !categoryIds.has(item.category_id))) throw new Error('A behavior cohort references an unknown category.')
    cohorts = categories.flatMap((category, index) => {
      const rows = definitions.filter(item => item.category_id === category.id)
      const shares = rows.map(item => number(item.share_percent, 'cohort.share_percent'))
      if (Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) > 1e-6) throw new Error(`${String(category.id)} behavior shares must sum to 100%.`)
      const allocated = shares.map(share => Math.floor(counts[index] * share / 100))
      const remainder = counts[index] - allocated.reduce((sum, count) => sum + count, 0)
      shares.map((share, position) => ({ position, fraction: counts[index] * share / 100 % 1, id: String(rows[position].id) })).sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id)).slice(0, remainder).forEach(item => { allocated[item.position]++ })
      const categoryCohorts = rows.map((item, position): CohortDemand => {
        const profile = profiles.get(name(item.segment_id, 'segment_id'))
        if (!profile) throw new Error(`Unknown behavior segment ${String(item.segment_id)}.`)
        const arrivalNodeId = name(item.arrival_node_id, 'cohort.arrival_node_id')
        const destinationNodeId = name(item.destination_node_id, 'cohort.destination_node_id')
        if (nodeMap.get(arrivalNodeId)?.role !== 'arrival' || nodeMap.get(destinationNodeId)?.role !== 'destination') throw new Error('A cohort needs authored arrival and destination nodes.')
        if ((!originMap.has(arrivalNodeId) && nodeMap.get(arrivalNodeId)?.entryAreaId !== category.entry_area_id) || nodeMap.get(destinationNodeId)?.entryAreaId !== category.entry_area_id) throw new Error('Cohort route endpoints must match the category entry area or a declared arrival origin.')
        const categoryRoute = categoryCohortDefaults[index]
        if (destinationNodeId !== categoryRoute.destinationNodeId) throw new Error('A behavior cohort must reach its category handover destination.')
        const windows = Object.entries(object(profile.arrival_windows_percent, 'profile.arrival_windows_percent')).map(([key, share]) => {
          const range = key.split('-')
          if (range.length !== 2) throw new Error(`Invalid profile arrival window ${key}.`)
          return { startSeconds: seconds(range[0]) - originSeconds, endSeconds: seconds(range[1]) - originSeconds, sharePercent: number(share, 'profile arrival share') }
        })
        if (Math.abs(windows.reduce((sum, window) => sum + window.sharePercent, 0) - 100) > 1e-6) throw new Error('Profile arrival windows must sum to 100%.')
        const groupSize = number(profile.group_size, 'profile.group_size', 1)
        if (!Number.isSafeInteger(groupSize)) throw new Error('Profile group_size must be a whole number.')
        return { id: name(item.id, 'cohort.id'), categoryId: String(category.id), segmentId: profile.id, count: allocated[position], arrivalNodeId, destinationNodeId, ...(categoryRoute.laneCheckpointIds ? { laneCheckpointIds: categoryRoute.laneCheckpointIds } : {}), groupSize, walkSpeedMps: number(profile.walk_speed_mps, 'profile.walk_speed_mps', 0.01), windows }
      })
      const nativeShares = object(demand[String(category.id)], 'native arrival windows')
      for (const [key, share] of Object.entries(nativeShares).filter(([key]) => key !== 'basis')) {
        const range = key.split('-'), start = seconds(range[0]) - originSeconds, end = seconds(range[1]) - originSeconds
        const combined = categoryCohorts.reduce((sum, cohort, position) => sum + shares[position] / 100 * (cohort.windows.find(window => window.startSeconds === start && window.endSeconds === end)?.sharePercent ?? 0), 0)
        if (Math.abs(combined - Number(share)) > 1e-6) throw new Error(`${String(category.id)} native arrival curve must match its behavior cohort mixture.`)
      }
      return categoryCohorts.flatMap(cohort => {
        const originShares = profileOrigins.get(cohort.segmentId!)
        if (!originShares) return [cohort]
        const allocated = allocateOrigins(cohort.count, cohort.groupSize!, originShares)
        return originShares.map((origin, index) => ({ ...cohort, id: `${cohort.id}__${origin.id}`, originId: origin.id, arrivalNodeId: origin.id, count: allocated[index] }))
      })
    })
    for (const profile of profiles.values()) segments.push({ id: profile.id, label: name(profile.label, 'profile.label'), attendees: cohorts.filter(cohort => cohort.segmentId === profile.id).reduce((sum, cohort) => sum + cohort.count, 0) })
  }
  if (arrivalOrigins.length && plan.behavior_context === undefined) throw new Error('Arrival origins require behavior_context profile origin shares.')
  for (const origin of arrivalOrigins) origin.attendees = cohorts.filter(cohort => cohort.originId === origin.id).reduce((sum, cohort) => sum + cohort.count, 0)
  for (const cohort of cohorts) {
    const areaId = nodeMap.get(cohort.destinationNodeId)!.entryAreaId
    const checkpoints = cohort.laneCheckpointIds
    if (checkpoints !== undefined && (!checkpoints.length || new Set(checkpoints).size !== checkpoints.length || checkpoints.some(id => nodeMap.get(id)?.role !== 'checkpoint' || nodeMap.get(id)?.entryAreaId !== areaId || !canReach(cohort.arrivalNodeId, id) || !canReach(id, cohort.destinationNodeId)))) throw new Error(`Cohort ${cohort.id} needs distinct reachable lane checkpoints in its destination entry area.`)
    if (!checkpoints && !nodes.some(node => node.role === 'checkpoint' && node.entryAreaId === areaId && canReach(cohort.arrivalNodeId, node.id) && canReach(node.id, cohort.destinationNodeId))) throw new Error(`Cohort ${cohort.id} has no reachable checkpoint before its destination.`)
  }
  const roles = unique<JsonObject & { id: string }>(list(object(plan.staff, 'staff').roles, 'staff.roles').map(role => ({ ...role, id: name(role.id, 'role.id') })), 'roles')
  const operators: OperationsOperator[] = list(spatial.operators, 'operators').map(item => {
    const roleId = name(item.role_id, 'operator.role_id'), role = roles.get(roleId)
    if (!role) throw new Error(`Unknown operator role ${roleId}.`)
    const attached = attachment(item.attachment)
    return { id: name(item.id, 'operator.id'), label: name(item.label, 'operator.label'), roleId, roleName: typeof role.name === 'string' ? role.name : roleId, pointId: name(item.point_id, 'operator.point_id'), entryAreaId: name(item.entry_area_id, 'operator.entry_area_id'), position: localToWorld(attached.offset, placementMap.get(attached.placementId)!), yawDeg: placementMap.get(attached.placementId)!.yawDeg, attachment: attached }
  })
  unique(operators, 'operators')
  for (const role of roles.values()) if (number(role.count, `${role.id}.count`) !== operators.filter(operator => operator.roleId === role.id).length) throw new Error(`${role.id} staff count differs from its spatial operator positions. Update the layout bindings.`)
  const entryAreaRows = list(spatial.entry_areas, 'entry_areas')
  if (categories.some(category => !entryAreaRows.some(area => area.id === category.entry_area_id && area.gate_id === category.entry_gate))) throw new Error('Category entry area and gate must match a spatial entry area.')
  const entryAreas: EntryAreaMarker[] = entryAreaRows.map(area => ({ id: name(area.id, 'area.id'), label: name(area.label, 'area.label'), position: point(area.position_m, 'area.position_m'), color: name(area.color, 'area.color'), attendees: categories.reduce((sum, category, index) => sum + (category.entry_gate === area.gate_id ? counts[index] : 0), 0) }))
  unique(entryAreas, 'entry_areas')
  if (entryAreas.reduce((sum, area) => sum + area.attendees, 0) !== counts.reduce((sum, count) => sum + count, 0)) throw new Error('Every category must reference one spatial entry area.')
  const northIds = new Set(placementRows.filter(item => item.entry_area_id === 'plaza_utara').map(item => item.id))
  const northNodes = nodes.filter(node => node.entryAreaId === 'plaza_utara')
  const northNodeIds = new Set(northNodes.map(node => node.id))
  const revision = number(spatial.revision, 'spatial.revision', 1)
  if (!Number.isSafeInteger(revision)) throw new Error('Layout revision must be a whole number.')
  const stepRows = list(object(plan.process_steps, 'process_steps').steps, 'process_steps.steps')
  const stepMap = new Map(stepRows.map(step => [step.id, step]))
  const gates = list(object(object(plan.venue, 'venue').layout, 'venue.layout').gates, 'gates')
  const stationRows = spatial.service_stations === undefined ? [] : list(spatial.service_stations, 'service_stations')
  for (const category of categories) {
    const gate = gates.find(gate => gate.id === category.entry_gate)
    const route = routes.get(String(category.id))!
    if (Array.isArray(route.lane_checkpoint_ids)) {
      if (!gate) throw new Error('Category gate is missing.')
      const activeLanes = list(gate.lanes, 'gate.lanes').reduce((sum, lane) => sum + number(lane.count, 'lane.count', 1), 0)
      if (route.lane_checkpoint_ids.length !== activeLanes) throw new Error('Authored lane routes must match the gate active lane count.')
    }
  }
  const serviceStations: ServiceStation[] = stationRows.map(row => {
    const operatorId = name(row.operator_id, 'station.operator_id')
    const operator = operators.find(item => item.id === operatorId)
    const nodeId = name(row.node_id, 'station.node_id')
    const gate = gates.find(gate => gate.id === row.point_id)
    if (!operator || nodeMap.get(nodeId)?.role !== 'checkpoint' || !gate || operator.pointId !== row.point_id || nodeMap.get(nodeId)?.entryAreaId !== operator.entryAreaId) throw new Error('Service station needs a bound operator, checkpoint and matching entry gate/area.')
    if (!Array.isArray(row.step_ids) || !row.step_ids.length) throw new Error('Service station needs process step IDs.')
    const role = roles.get(operator.roleId)!
    if (!Array.isArray(role.can_do) || row.step_ids.some(id => !(role.can_do as unknown[]).includes(id))) throw new Error('An operator is assigned a process outside its role skills.')
    const serviceSeconds = row.step_ids.reduce((sum: number, id: unknown) => {
      const step = stepMap.get(id)
      if (!step) throw new Error(`Missing process step ${String(id)}.`)
      return sum + number(object(step.time_per_person_seconds, 'step timing').typical, 'typical service seconds', .01)
    }, 0)
    return { id: name(row.id, 'station.id'), nodeId, operatorId, serviceSeconds, opensSeconds: seconds(name(gate.opens, 'gate.opens')) - originSeconds, closesSeconds: seconds(name(gate.closes, 'gate.closes')) - originSeconds }
  })
  unique(serviceStations, 'service_stations')
  if (new Set(serviceStations.map(station => station.operatorId)).size !== serviceStations.length || new Set(serviceStations.map(station => station.nodeId)).size !== serviceStations.length) throw new Error('Service stations need one operator and one checkpoint each; capacity cannot be double counted.')
  if (serviceStations.length && cohorts.some(cohort => cohort.laneCheckpointIds?.some(id => !serviceStations.some(station => station.nodeId === id)))) throw new Error('Each lane checkpoint needs a bound service station.')
  const config: AbmConfig = { seed: number(playback.seed, 'seed'), timeOrigin, horizonSeconds: number(playback.horizon_seconds, 'horizon_seconds', 1), walkSpeedMps: number(playback.walk_speed_mps, 'walk_speed_mps', 0.01), nodes, edges, cohorts, ...(serviceStations.length ? { serviceStations } : {}) }
  return { config, placements, nodes, edges, operators, entryAreas, segments, arrivalOrigins, layoutId: name(spatial.layout_id, 'layout_id'), layoutRevision: revision, northLayout: { schemaVersion: 'opsidio-editor/0.1', id: `${String(spatial.layout_id)}-north`, revision, placements: placements.filter(item => northIds.has(item.id)), nodes: northNodes, edges: edges.filter(edge => northNodeIds.has(edge.from) && northNodeIds.has(edge.to)) } }
}

/** Persist editor coordinates into the same plan snapshot used by playback and API calls. */
export function projectNorthLayout(input: unknown, layout: LayoutRevision): unknown {
  const plan = structuredClone(object(input, 'Plan'))
  const spatial = object(plan.spatial_context, 'spatial_context')
  const navigation = object(spatial.navigation, 'navigation')
  const northNodeIds = new Set(list(navigation.nodes, 'nodes').filter(node => node.entry_area_id === 'plaza_utara').map(node => node.id))
  const editedNorthIds = new Set(layout.nodes.map(node => node.id))
  const retainedEdges = list(navigation.edges, 'edges').filter(edge => {
    const fromNorth = northNodeIds.has(edge.from_node_id), toNorth = northNodeIds.has(edge.to_node_id)
    if (fromNorth && toNorth) return false
    if ((fromNorth && !editedNorthIds.has(String(edge.from_node_id))) || (toNorth && !editedNorthIds.has(String(edge.to_node_id)))) throw new Error('The North edit removed a node bound to the public approach network.')
    return true
  })
  spatial.placements = [...list(spatial.placements, 'placements').filter(item => item.entry_area_id !== 'plaza_utara'), ...layout.placements.map(item => ({ id: item.id, label: item.label, preset_id: item.presetId, position_m: item.position, yaw_deg: item.yawDeg, entry_area_id: 'plaza_utara', ...(item.bays ? { parameters: { bays: item.bays } } : {}) }))]
  navigation.nodes = [...list(navigation.nodes, 'nodes').filter(item => item.entry_area_id !== 'plaza_utara'), ...layout.nodes.map(node => ({ id: node.id, role: node.role, entry_area_id: 'plaza_utara', ...(node.attachment ? { attachment: { placement_id: node.attachment.placementId, offset_m: node.attachment.offset } } : { position_m: node.position }) }))]
  navigation.edges = [...retainedEdges, ...layout.edges.map(edge => ({ id: edge.id, from_node_id: edge.from, to_node_id: edge.to, directed: true, ...(edge.basis ? { basis: edge.basis } : {}) }))]
  spatial.revision = layout.revision
  const resolved = compileSimulationPlan(plan)
  const northNodeIdsResolved = new Set(resolved.northLayout.nodes.map(node => node.id))
  const northCohorts = resolved.config.cohorts.filter(cohort => northNodeIdsResolved.has(cohort.destinationNodeId))
  if (!northCohorts.length) throw new Error('The plan needs an authored North entry route.')
  const sample = generateAbm({ ...resolved.config, cohorts: northCohorts.map(cohort => ({ ...cohort, count: (cohort.laneCheckpointIds?.length ?? 1) * (cohort.groupSize ?? 1) })) })
  if (sample.issues.length || sample.journeys.length !== northCohorts.reduce((sum, cohort) => sum + (cohort.laneCheckpointIds?.length ?? 1) * (cohort.groupSize ?? 1), 0)) throw new Error(sample.issues.join(' ') || 'The North route cannot be resolved.')
  const total = northCohorts.reduce((sum, cohort) => sum + cohort.count, 0)
  const distance = sample.journeys.reduce((sum, journey) => {
    const cohort = northCohorts.find(item => item.id === journey.cohortId)!
    // Native queue-to-gate distance starts at the forecourt, excluding public transport approaches and all service time.
    const start = cohort.originId ? journey.routeNodeIds.indexOf('arrival') : 0
    if (start < 0) throw new Error('The North origin route must pass its authored forecourt arrival node.')
    let walkingDistance = 0
    for (let index = start + 1; index < journey.points.length; index++) walkingDistance += Math.hypot(...journey.points[index].map((value, axis) => value - journey.points[index - 1][axis]))
    return sum + walkingDistance * (total ? cohort.count / total : 1 / northCohorts.length) / ((cohort.laneCheckpointIds?.length ?? 1) * (cohort.groupSize ?? 1))
  }, 0)
  const nativeLayout = object(object(plan.venue, 'venue').layout, 'venue.layout')
  for (const path of list(nativeLayout.walking_paths, 'walking_paths')) if (path.from === 'queue_plaza_utara' && path.to === 'proposed_gate_plaza_utara') path.distance_m = distance
  return plan
}
