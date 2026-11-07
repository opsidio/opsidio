import { readFileSync, writeFileSync } from 'node:fs'
import { catalogue, initialDraft } from '../web/src/simulation/model.ts'
import { createLayoutRevision, localToWorld } from '../web/src/simulation/layout/core.ts'
import { admissionSpine, addArrivalNetwork, round } from './arrival-network.mjs'

const root = new URL('../', import.meta.url)
const draft = JSON.parse(readFileSync(new URL('contracts/examples/coldplay-gbk-plan-draft.json', root)))
const source = draft.meta.source_scenario.snapshot
const plan = structuredClone(draft)
const baseline = createLayoutRevision(initialDraft().placements)
const laneOffsets = [-2.49, -0.83, 0.83, 2.49]
const laneScanIds = ['lane_1_scan_checkpoint', 'scan_checkpoint', 'lane_3_scan_checkpoint', 'lane_4_scan_checkpoint']
baseline.placements = baseline.placements.filter(item => !item.id.startsWith('row_5_'))
for (const placement of baseline.placements) {
  if (placement.id.startsWith('row_')) {
    const [, row, panel] = placement.id.split('_')
    placement.position = [8.68 + Number(row) * 1.66, 0, -300.05 + Number(panel) * 2.5]
  }
  if (placement.id === 'scan_table') { placement.position = [15.3, 0, -273]; placement.yawDeg = 90 }
  if (placement.id === 'help_tent') placement.position[0] = 15
  if (placement.id === 'help_table') { placement.position[0] = 15.3; placement.yawDeg = 90 }
}
for (const node of baseline.nodes) {
  if (['queue', 'queue-exit', 'north-walkway'].includes(node.id)) node.position[0] = 11.17
  if (['scan_checkpoint', 'security_checkpoint'].includes(node.id)) node.attachment.offset = [-0.83, 0, 0]
  if (node.id === 'help_checkpoint') node.attachment.offset[0] = -0.8
}
for (const [index, offset] of laneOffsets.entries()) {
  if (index === 1) continue
  const prefix = `lane_${index + 1}`
  const nodes = [
    { id: `${prefix}_queue`, role: 'waypoint', position: [12 + offset, 0, -303] },
    { id: `${prefix}_queue_exit`, role: 'waypoint', position: [12 + offset, 0, -293.5] },
    { id: `${prefix}_scan_checkpoint`, role: 'checkpoint', position: [0, 0, 0], attachment: { placementId: 'scan_tent', offset: [offset, 0, 0] } },
    { id: `${prefix}_walkway`, role: 'waypoint', position: [12 + offset, 0, -249] },
    { id: `${prefix}_security_checkpoint`, role: 'checkpoint', position: [0, 0, 0], attachment: { placementId: 'security_tent', offset: [offset, 0, 0] } },
  ]
  baseline.nodes.push(...nodes)
  const chain = ['arrival', ...nodes.map(node => node.id), 'entry-approach']
  chain.slice(0, -1).forEach((from, leg) => baseline.edges.push({ id: `${prefix}_leg_${leg}`, from, to: chain[leg + 1] }))
}
const windows = { '09:00-13:00': 10, '13:00-15:30': 30, '15:30-17:30': 45, '17:30-19:30': 15 }
plan.meta.description = 'V1 local Coldplay-inspired GBK demo. Fictional operational assumptions are editable. Send this snapshot to the API when Optimize is selected.'
plan.meta.version = 1
plan.meta.revision = 5
plan.meta.readiness = { status: 'local_preview_ready', remote_semantic_validation: 'not_run' }
plan.meta.unresolved = []
plan.meta.demo_assumptions = [
  'The existing 70,000 expected arrivals are represented by fictional sold counts with zero no-shows for deterministic demo conservation.',
  'Each proposed entry area uses an illustrative four-lane admission template with four scan operators, four security officers and one help agent.',
  'Gate processing combines scan, wristband and security steps. Physical checkpoint positions remain separately visible in the spatial context.',
  'Admission paths follow mapped 7.5 m pedestrian or stadium-ring corridors. East, southeast and northwest stations are relocated from the original illustrative anchors because their original roads cannot fit four lanes. Equipment, widths and operational use require site review; these are not confirmed event gates.',
  'Behavior profiles define fictional arrival windows, group sizes of two or four, and walking speeds from 1.0 to 1.25 m/s.',
  'Rates, queue dimensions, costs, capacity, staff genders, targets and opening policies are fictional demo inputs.',
  'The browser displays walking trajectories. Queue and processing results require a separate engine run or optimization response.'
]
plan.event.name = 'Coldplay-inspired GBK demo · V1'
plan.event.capacity = { basis: 'estimate', configured_capacity: 70000, tickets_on_sale: 70000, tickets_sold: 70000, no_show_percent_estimate: 0 }
plan.event.schedule = { ...plan.event.schedule, basis: 'policy', redemption_open: '13:00', redemption_close: '21:00', last_entry: '21:00', show_end_estimate: '23:30' }
plan.event.audience_profile = { basis: 'estimate', female_percent: 50, typical_group_size: 2, arrive_in_groups_percent: 100, visitors_with_bag_percent: 50, visitors_using_locker_percent: 0, accessible_visitors_percent: 0 }
for (const category of plan.event.ticket_categories) {
  category.sold = category.expected_attendees_estimate
  category.quota = category.sold
  category.basis = 'estimate'
  category.count_basis = 'fictional_v1_sales_equal_expected_arrivals_zero_no_show'
  delete category.entry_gate_status
  delete category.attendance_interpretation
}
const spatial = {
  schema_version: 'opsidio-layout/0.1', venue_id: 'gbk-osm-local', catalogue_version: 'research-v1',
  layout_id: 'gbk-five-entry-v1', revision: 5,
  coordinate_frame: { units: 'm', origin_wgs84: { longitude_deg: 106.80255, latitude_deg: -6.21858 }, axes: { x: 'east', y: 'up', z: 'south' }, vertical_reference: 'local_ground' },
  placements: [], navigation: { nodes: [], edges: [] }, operational_bindings: [], entry_areas: [], cohort_routes: [], operators: [], service_stations: [],
  playback: { seed: 20261114, time_origin: '2026-11-14T09:00:00+07:00', horizon_seconds: 52200, walk_speed_mps: 1.2, group_size: 2 }
}
const layout = { basis: 'estimate', zones: [], service_points: [], gates: [], walking_paths: [], visitor_flow: [{ order: 1, point: 'entry_gate_of_category', required: true }] }
const roles = []
for (const area of source.entry_areas) {
  const north = area.id === 'plaza_utara'
  const spine = admissionSpine(area.id)
  const key = id => north ? id : `${area.id}_${id}`
  const transform = spine.transform
  const gateId = `proposed_gate_${area.id}`
  spatial.entry_areas.push({ id: area.id, label: area.label, gate_id: gateId, position_m: spine.sample(42), proposed_anchor_m: area.position, operational_anchor_m: spine.sample(42), color: area.color, basis: 'fictional_station_on_mapped_corridor', review_status: 'site_review_required', corridor: { osm_way_ids: spine.wayIds, illustrative_width_m: spine.widthM, lane_center_offsets_m: laneOffsets, spine_points_m: spine.points.map(point => point.map(round)), route_length_m: 141 } })
  for (const item of baseline.placements) spatial.placements.push({ id: key(item.id), label: item.label, preset_id: item.presetId, position_m: transform(item.position), yaw_deg: round(item.yawDeg + spine.yaw(item.position[2] + 317)), ...(item.bays ? { parameters: { bays: item.bays } } : {}), entry_area_id: area.id, basis: 'fictional_scenario' })
  // Visible detectors stand beside the central walking route, preserving its clearance.
  spatial.placements.push({ id: key('security_detector'), label: 'Security detector', preset_id: 'detector-90', position_m: transform([14.49, 0, -228]), yaw_deg: round(spine.yaw(89)), entry_area_id: area.id, basis: 'fictional_scenario' })
  for (const node of baseline.nodes) spatial.navigation.nodes.push({ id: key(node.id), role: node.role, entry_area_id: area.id, ...(node.attachment ? { attachment: { placement_id: key(node.attachment.placementId), offset_m: node.attachment.offset } } : { position_m: transform(node.position) }) })
  const originalPosition = id => {
    const node = baseline.nodes.find(item => item.id === id)
    return node.attachment ? localToWorld(node.attachment.offset, baseline.placements.find(item => item.id === node.attachment.placementId)) : node.position
  }
  // Every mapped bend becomes a waypoint in each lane; do not cut across grass at curve chords.
  for (const edge of baseline.edges) {
    const from = originalPosition(edge.from), to = originalPosition(edge.to)
    const begin = from[2] + 317, end = to[2] + 317
    const stops = spine.lengths.filter(s => s > Math.min(begin, end) + 0.001 && s < Math.max(begin, end) - 0.001).sort((a, b) => begin < end ? a - b : b - a)
    let previous = key(edge.from)
    for (const [index, s] of stops.entries()) {
      const t = (s - begin) / (end - begin), nodeId = key(`${edge.id}_bend_${index}`)
      spatial.navigation.nodes.push({ id: nodeId, role: 'waypoint', entry_area_id: area.id, position_m: spine.sample(s, from[0] - 12 + t * (to[0] - from[0])), basis: 'mapped_corridor_lane_bend' })
      spatial.navigation.edges.push({ id: key(`${edge.id}_part_${index}`), from_node_id: previous, to_node_id: nodeId, directed: true })
      previous = nodeId
    }
    spatial.navigation.edges.push({ id: key(edge.id), from_node_id: previous, to_node_id: key(edge.to), directed: true })
  }
  const categories = plan.event.ticket_categories.filter(category => category.entry_area_id === area.id)
  const queueId = `queue_${area.id}`
  const insideId = `inside_${area.id}`
  const helpId = `help_${area.id}`
  layout.zones.push({ id: queueId, name: `${area.label} queue`, type: 'queue', area_m2: 120, barricade_m: 15 * 2.3, switchback_rows: 4 }, { id: insideId, name: `${area.label} admitted area`, type: 'holding', area_m2: 1200 })
  layout.gates.push({ id: gateId, name: area.label, queue_zone: queueId, leads_to: [insideId], opens: '17:30', closes: '21:00', frontage_m: 10, max_lanes: 4, serves_categories: categories.map(category => category.id), lanes: [{ group: 'general', count: 4, steps: ['eticket_scan', 'wristband_fit', 'security_inspection'], equipment_per_lane: { handheld_scanner: 1, metal_detector_wand: 1 } }] })
  layout.service_points.push({ id: helpId, name: `${area.label} ticket help`, zone: insideId, queue_zone: queueId, opens: '13:00', closes: '21:00', max_lanes: 1, lanes: [{ group: 'desk', count: 1, serves: 'visitors_with_exception', steps: ['help_desk_resolution'], equipment_per_lane: {} }] })
  layout.walking_paths.push({ from: queueId, to: gateId, distance_m: 141 })
  for (const category of categories) spatial.cohort_routes.push({ category_id: category.id, arrival_node_id: key('arrival'), destination_node_id: key('destination'), lane_checkpoint_ids: laneScanIds.map(key) })
  for (const [kind, count, placement, steps, point, offsetZ] of [
    ['scan', 4, 'scan_tent', ['eticket_scan', 'wristband_fit'], gateId, 0],
    ['security', 4, 'security_tent', ['security_inspection'], gateId, 0],
    ['help', 1, 'help_tent', ['help_desk_resolution'], helpId, -0.5]
  ]) {
    const roleId = `${area.id}_${kind}`
    roles.push({ id: roleId, name: `${area.label} ${kind}`, basis: 'estimate', processing_role: true, count, gender: { female: Math.floor(count / 2), male: count - Math.floor(count / 2) }, shift: 'admission_shift', can_do: steps, rate_idr_per_shift: kind === 'security' ? 400000 : 350000, pool_limit_total: count * 2, assignment: [{ point, lane_group: kind === 'help' ? 'desk' : 'general', per_lane: 1, count }] })
    for (let index = 0; index < count; index++) spatial.operators.push({ id: `${roleId}_${index + 1}`, label: `${kind === 'security' ? 'Security' : kind === 'help' ? 'Help agent' : 'Scan operator'} ${index + 1}`, role_id: roleId, point_id: point, entry_area_id: area.id, attachment: { placement_id: key(placement), offset_m: [count === 1 ? -0.3 : -2.49 + index * 1.66 + (kind === 'security' ? 0.8 : 0.65), 0, offsetZ] } })
    spatial.operational_bindings.push({ placement_id: key(placement), node_id: key(`${kind === 'scan' ? 'scan' : kind === 'security' ? 'security' : 'help'}_checkpoint`), point_id: point, lane_group: kind === 'help' ? 'desk' : 'general', queue_zone_id: queueId })
  }
}
for (const area of spatial.entry_areas) {
  const key = id => area.id === 'plaza_utara' ? id : `${area.id}_${id}`
  for (let lane = 0; lane < 4; lane++) {
    const prefix = lane === 1 ? '' : `lane_${lane + 1}_`
    for (const kind of ['scan', 'security']) spatial.service_stations.push({ id: `${area.id}_${kind}_${lane + 1}_service`, node_id: key(`${prefix}${kind}_checkpoint`), operator_id: `${area.id}_${kind}_${lane + 1}`, point_id: area.gate_id, step_ids: kind === 'scan' ? ['eticket_scan', 'wristband_fit'] : ['security_inspection'] })
  }
}
plan.venue = { ...plan.venue, id: 'gbk-osm-local', name: 'Stadion Utama Gelora Bung Karno', layout }
plan.process_steps = { basis: 'estimate', steps: [
  ['eticket_scan', 'Scan e-ticket and match ID', 5, 12, 'scan'],
  ['wristband_fit', 'Issue admission wristband', 4, 8, 'scan'],
  ['security_inspection', 'Security inspection', 8, 20, 'security'],
  ['help_desk_resolution', 'Resolve ticket exception', 90, 240, 'help']
].map(([id, name, typical, slow, kind]) => ({ id, name, applies_to: kind === 'help' ? 'visitors_with_exception' : 'all_visitors', done_by: roles.filter(role => role.id.endsWith(`_${kind}`)).map(role => role.id), time_per_person_seconds: { typical, slow }, exceptions: [], ...(kind === 'help' ? { results: { resolved_percent: 100, refused_percent: 0 } } : {}) })) }
plan.staff = { basis: 'estimate', meal_allowance_idr_per_person: 45000, shifts: [{ id: 'admission_shift', start: '12:30', end: '21:30', meal_break_minutes: 30 }], roles }
plan.constraints = { budget: { basis: 'estimate', staff_cap_idr: 30000000, equipment_cap_idr: 30000000 }, service_targets: { basis: 'policy', gate_wait: { max_minutes: 20, for_share_of_visitors_percent: 90 }, longest_acceptable_wait_minutes: 45, inside_before_main_act_percent: 95 }, safety: { basis: 'policy', max_density_persons_per_m2: { queue_zones: 2, inner_concourse: 1.5 }, queues_must_stay_inside_queue_zones: true, emergency_lane_width_m: 3 }, equipment: { basis: 'estimate', items: [{ id: 'handheld_scanner', name: 'Ticket scanner', available: 20, extra_rentable: 10, extra_cost_idr_per_unit: 150000, lead_time_days: 3, committed_cost_idr: 3000000 }, { id: 'metal_detector_wand', name: 'Metal detector wand', available: 20, extra_rentable: 10, extra_cost_idr_per_unit: 100000, lead_time_days: 3, committed_cost_idr: 2000000 }] }, timing: { basis: 'policy', doors_open_earliest: '17:00', last_entry_latest: '21:00', venue_slot_end: '23:30' } }
plan.demand = { basis: 'estimate', time_reference: 'origin_spawn', walking_time_policy: 'Arrival windows specify release at MRT, parking or drop-off. Add exactly one spatial approach walk before the entrance; do not add a second transport or approach delay.', arrival_windows_percent: Object.fromEntries(plan.event.ticket_categories.map(category => [category.id, windows])), group_size_share_percent: { '2': 100 } }
plan.spatial_context = spatial
const profiles = [
  { id: 'early_fan', label: 'Early fan', group_size: 2, walk_speed_mps: 1.2, shares: [40, 40, 18, 2], spawn: 'arrival', offset_m: 0, behavior: 'Arrives early and keeps the assigned category queue.' },
  { id: 'regular_attendee', label: 'Regular attendee', group_size: 2, walk_speed_mps: 1.2, shares: [5, 25, 50, 20], spawn: 'arrival_walk', offset_m: 6, behavior: 'Walks from the onsite approach to the assigned entrance.' },
  { id: 'late_arrival', label: 'Late arrival', group_size: 2, walk_speed_mps: 1.25, shares: [0, 5, 45, 50], spawn: 'arrival_dropoff', offset_m: -6, behavior: 'Joins the assigned entrance later in the admission period.' },
  { id: 'premium_package', label: 'Package holder', group_size: 2, walk_speed_mps: 1.1, shares: [5, 65, 28, 2], spawn: 'arrival_package', offset_m: 3, behavior: 'Uses the package category entry area and an earlier arrival profile.' },
  { id: 'social_group', label: 'Social group', group_size: 4, walk_speed_mps: 1.0, shares: [10, 35, 45, 10], spawn: 'arrival_group', offset_m: -3, behavior: 'Arrives together and shares a slower group walking speed.' },
].map((profile, index) => ({ ...profile, origin_share_percent: Object.fromEntries(['origin_mrt', 'origin_parking', 'origin_dropoff'].map((id, i) => [id, [[60, 15, 25], [45, 25, 30], [20, 10, 70], [10, 40, 50], [25, 45, 30]][index][i]])), arrival_windows_percent: Object.fromEntries(Object.keys(windows).map((key, index) => [key, profile.shares[index]])) }))
const behavior = { schema_version: 'opsidio-behavior/0.1', basis: 'fictional_demo_assumptions', unit: 'category_x_behavior_cohort', profiles, cohorts: [], destination_scope: 'Post-security category handover at the assigned entrance. Internal routes to seats and standing sectors require venue review.', spawn_scope: 'Pedestrians spawn at mapped MRT Istora Mandiri Exit B, mapped Parkir Timur centroid or a fictional passenger drop-off at a mapped parking entrance. No vehicle traffic is modeled. Legacy entrance arrival IDs remain fallback bindings.', time_reference: 'origin_spawn' }
for (const area of spatial.entry_areas) {
  const north = area.id === 'plaza_utara'
  const key = id => north ? id : `${area.id}_${id}`
  const arrival = spatial.navigation.nodes.find(node => node.id === key('arrival'))
  const scan = spatial.placements.find(item => item.id === key('scan_tent'))
  for (const profile of profiles.filter(item => item.spawn !== 'arrival')) {
    const radians = scan.yaw_deg * Math.PI / 180
    const position = [...arrival.position_m]
    position[0] += Math.cos(radians) * Math.sign(profile.offset_m) * Math.min(1.2, Math.abs(profile.offset_m))
    position[2] -= Math.sin(radians) * Math.sign(profile.offset_m) * Math.min(1.2, Math.abs(profile.offset_m))
    spatial.navigation.nodes.push({ id: key(profile.spawn), role: 'arrival', entry_area_id: area.id, position_m: position, label: `${area.label} · ${profile.label} arrival` })
    spatial.navigation.edges.push({ id: key(`${profile.spawn}_to_lanes`), from_node_id: key(profile.spawn), to_node_id: key('arrival'), directed: true })
  }
}
for (const category of plan.event.ticket_categories) {
  const area = spatial.entry_areas.find(item => item.id === category.entry_area_id)
  const north = area.id === 'plaza_utara'
  const key = id => north ? id : `${area.id}_${id}`
  const destinationId = `destination_${category.id}`
  const parent = spatial.navigation.nodes.find(node => node.id === key('destination'))
  const sector = category.viewing_tier === 'festival' ? 0 : Number(category.viewing_tier.replace('cat', ''))
  const lateralOffset = (sector - 4.5) * 0.65
  const yaw = spatial.placements.find(item => item.id === key('scan_tent')).yaw_deg * Math.PI / 180
  const handover = [parent.position_m[0] + Math.cos(yaw) * lateralOffset, 0, parent.position_m[2] - Math.sin(yaw) * lateralOffset]
  spatial.navigation.nodes.push({ id: destinationId, role: 'destination', entry_area_id: area.id, position_m: handover, label: `${category.name} handover`, viewing_tier: category.viewing_tier, final_zone_route_status: 'pending_venue_review' })
  spatial.navigation.edges.push({ id: `handover_${category.id}`, from_node_id: key('destination'), to_node_id: destinationId, directed: true })
  spatial.cohort_routes.find(route => route.category_id === category.id).destination_node_id = destinationId
  let mix
  if (['ultimate_experience', 'my_universe'].includes(category.id)) mix = { premium_package: 95, social_group: 5 }
  else if (category.viewing_tier === 'festival') mix = { early_fan: 55, regular_attendee: 30, late_arrival: 10, social_group: 5 }
  else if (['cat1', 'cat2'].includes(category.viewing_tier)) mix = { early_fan: 10, regular_attendee: 65, late_arrival: 20, social_group: 5 }
  else if (['cat3', 'cat4'].includes(category.viewing_tier)) mix = { early_fan: 20, regular_attendee: 55, late_arrival: 20, social_group: 5 }
  else mix = { early_fan: 35, regular_attendee: 45, late_arrival: 15, social_group: 5 }
  const allocation = Object.entries(mix).map(([segment, share]) => ({ segment, share, count: Math.floor(category.sold * share / 100), remainder: category.sold * share / 100 % 1 }))
  const remaining = category.sold - allocation.reduce((sum, item) => sum + item.count, 0)
  allocation.sort((a, b) => b.remainder - a.remainder || a.segment.localeCompare(b.segment)).slice(0, remaining).forEach(item => item.count++)
  for (const item of allocation) {
    const profile = profiles.find(profile => profile.id === item.segment)
    behavior.cohorts.push({ id: `${category.id}__${item.segment}`, category_id: category.id, segment_id: item.segment, share_percent: item.share, expected_attendees_estimate: item.count, arrival_node_id: key(profile.spawn), destination_node_id: destinationId })
  }
  plan.demand.arrival_windows_percent[category.id] = Object.fromEntries(Object.keys(windows).map(window => [window, allocation.reduce((sum, item) => sum + item.share * profiles.find(profile => profile.id === item.segment).arrival_windows_percent[window] / 100, 0)]))
}
const groupVisitors = behavior.cohorts.filter(cohort => cohort.segment_id === 'social_group').reduce((sum, cohort) => sum + cohort.expected_attendees_estimate, 0)
const groupShare = Math.round(groupVisitors / 70000 * 10000) / 100
plan.demand.group_size_share_percent = { '2': 100 - groupShare, '4': groupShare }
plan.behavior_context = behavior
addArrivalNetwork(spatial, layout)
plan.meta.demo_assumptions.push('Local admission uses one FIFO server per bound operator, fixed typical step times, and the native gate opening/closing clock. Unprocessed people remain queued when processing closes. Only the queue front is rendered.')
plan.meta.demo_assumptions.push('Arriving groups are assigned round-robin across the four open authored lanes. Queue waiting and shortest-queue selection require service-state simulation.')
plan.meta.demo_assumptions.push('Behavior profiles, origin shares and category mixes are fictional inputs. The 76 category × behavior rows expand into 228 origin-specific runtime cohorts with exact attendee conservation. Category handovers remain near the admitted entrance endpoint until internal sector routes are reviewed.')
plan.meta.demo_assumptions.push('MRT Exit B and drop-off coordinates use existing public OSM nodes. Parkir Timur uses a mapped polygon centroid with one explicitly proposed exit connector. Designating the parking entrance for taxi or app-based passenger drop-off is fictional; no vehicle movement is modeled.')
writeFileSync(new URL('contracts/examples/coldplay-gbk-demo-plan.json', root), JSON.stringify(plan, null, 2) + '\n')
console.log(`Wrote V1 with ${plan.event.ticket_categories.length} categories, ${spatial.entry_areas.length} entry areas, ${spatial.operators.length} operators and ${spatial.placements.length} equipment placements. Catalogue has ${catalogue.length} presets.`)
