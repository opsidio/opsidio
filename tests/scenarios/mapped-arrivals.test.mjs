import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { distance, pointSegmentDistance, publicGraph, venue } from '../../tools/arrival-network.mjs'
import { localToWorld, validateLayout } from '../../web/src/simulation/layout/core.ts'
import { catalogue } from '../../web/src/simulation/model.ts'

const plan = JSON.parse(readFileSync(new URL('../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))
const { navigation, entry_areas: areas, arrival_origins: origins, approach_routes: approaches } = plan.spatial_context
const nodes = new Map(navigation.nodes.map(node => [node.id, node]))
const placements = plan.spatial_context.placements.map(item => ({ id: item.id, label: item.label, presetId: item.preset_id, position: item.position_m, yawDeg: item.yaw_deg, bays: item.parameters?.bays, entryAreaId: item.entry_area_id }))
const position = node => node.position_m ?? localToWorld(node.attachment.offset_m, placements.find(item => item.id === node.attachment.placement_id))
const hasPath = (from, to, edges = navigation.edges, excluded = new Set()) => {
  const seen = new Set([from]), visit = [from]
  for (let i = 0; i < visit.length; i++) for (const edge of edges) if (edge.from_node_id === visit[i] && !seen.has(edge.to_node_id) && !excluded.has(edge.to_node_id)) { seen.add(edge.to_node_id); visit.push(edge.to_node_id) }
  return seen.has(to)
}
const inside = ([x, , z], ring) => {
  let found = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, , zi] = ring[i], [xj, , zj] = ring[j]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) found = !found
  }
  return found
}
const samples = (a, b) => {
  const n = Math.max(1, Math.ceil(distance(a, b) / 0.5))
  return Array.from({ length: n + 1 }, (_, i) => a.map((x, axis) => x + (b[axis] - x) * i / n))
}
const renderedPaths = ids => venue.paths.filter(path => ids.some(id => path.id.startsWith(`osm-way-${id}-`)))
const corridorDistance = (p, paths) => Math.min(...paths.flatMap(path => path.points.slice(1).map((b, i) => pointSegmentDistance(p, path.points[i], b))))
const laneSegment = (edges, from, to) => {
  const chain = []
  const visited = new Set()
  while (from !== to) {
    assert.ok(!visited.has(from), `loop in lane from ${from} to ${to}`)
    visited.add(from)
    const next = edges.filter(edge => edge.from === from)
    assert.equal(next.length, 1, `expected an unbranched lane between ${from} and ${to}`)
    chain.push(next[0])
    from = next[0].to
  }
  return chain
}

test('transport releases, native distances and cohort totals agree', () => {
  assert.deepEqual(origins.map(item => item.id), ['origin_mrt', 'origin_parking', 'origin_dropoff'])
  assert.equal(plan.demand.time_reference, 'origin_spawn')
  assert.equal(plan.behavior_context.cohorts.length, 76)
  assert.equal(plan.behavior_context.cohorts.reduce((sum, item) => sum + item.expected_attendees_estimate, 0), 70000)
  assert.equal(approaches.length, 15)
  for (const profile of plan.behavior_context.profiles) assert.equal(Object.values(profile.origin_share_percent).reduce((a, b) => a + b, 0), 100)
  for (const origin of origins) {
    assert.deepEqual(nodes.get(origin.id).position_m, origin.position_m)
    for (const area of areas) {
      const approach = approaches.find(item => item.origin_id === origin.id && item.entry_area_id === area.id)
      assert.ok(hasPath(origin.id, approach.arrival_node_id))
      const native = plan.venue.layout.walking_paths.find(item => item.from === origin.id && item.to === `queue_${area.id}`)
      assert.equal(native.distance_m, approach.distance_m)
    }
  }
  const connectors = navigation.edges.filter(edge => edge.basis === 'proposed_connector_site_review_required')
  assert.equal(connectors.length, 1)
  assert.equal(connectors[0].from_node_id, 'origin_parking')
  assert.ok(connectors[0].distance_m < 83)
})

test('public routes use visible shared OSM edges without zero-length joins', () => {
  for (const edge of navigation.edges) {
    const a = nodes.get(edge.from_node_id), b = nodes.get(edge.to_node_id)
    assert.ok(a && b && distance(position(a), position(b)) > 0.001, edge.id)
    if (!edge.osm_way_id) continue
    const leg = publicGraph.get(a.osm_node_id)?.get(b.osm_node_id)
    assert.equal(leg?.wayId, edge.osm_way_id, edge.id)
    const paths = renderedPaths([edge.osm_way_id])
    for (const p of samples(position(a), position(b))) assert.ok(corridorDistance(p, paths) < 0.025, edge.id)
  }
})

test('clear mapped approaches avoid kit, with one flagged leg serving only the East forecourt', () => {
  const overlaps = plan.spatial_context.approach_network.review_overlaps
  assert.equal(overlaps.length, 1)
  const review = overlaps[0]
  assert.equal(review.entry_area_id, 'plaza_timur')
  const edge = navigation.edges.find(edge => edge.id === review.edge_id)
  assert.equal(edge.basis, 'proposed_admission_overlap_site_review_required')
  assert.equal(edge.osm_way_id, review.osm_way_id)
  const reviewedEdges = navigation.edges.filter(item => item.id !== review.edge_id)
  for (const approach of approaches) {
    assert.equal(hasPath(approach.origin_id, approach.arrival_node_id, reviewedEdges), approach.entry_area_id !== review.entry_area_id)
  }
  const checked = validateLayout({
    schemaVersion: 'opsidio-editor/0.1', id: 'whole-demo', revision: plan.spatial_context.revision,
    placements,
    nodes: navigation.nodes.map(node => ({ id: node.id, role: node.role, position: position(node) })),
    edges: navigation.edges.map(item => ({ id: item.id, from: item.from_node_id, to: item.to_node_id })),
  }, { bounds: { minX: -900, maxX: 900, minZ: -900, maxZ: 900 }, catalogue })
  const blocked = checked.issues.filter(issue => issue.code === 'blocked_edge')
  assert.deepEqual(blocked.map(issue => issue.relatedIds), [[review.edge_id, ...review.placement_ids]])
})

test('help, security and scan form one-way lanes within the mapped corridor and clear of equipment', () => {
  const stations = plan.spatial_context.service_stations
  assert.equal(plan.spatial_context.one_way_admission, true)
  assert.ok(plan.behavior_context.profiles.every(profile => profile.help_desk_visit_percent === 1))
  assert.equal(stations.length, 45)
  assert.equal(plan.spatial_context.operators.length, 45)
  for (const area of areas) {
    const group = navigation.nodes.filter(node => node.entry_area_id === area.id)
    const groupIds = new Set(group.map(node => node.id))
    const edges = navigation.edges.filter(edge => groupIds.has(edge.from_node_id) && groupIds.has(edge.to_node_id))
    const kit = placements.filter(item => item.entryAreaId === area.id)
    const north = area.id === 'plaza_utara', key = id => north ? id : `${area.id}_${id}`
    const paths = renderedPaths(area.corridor.osm_way_ids)
    const width = area.corridor.illustrative_width_m
    const checked = validateLayout({ schemaVersion: 'opsidio-editor/0.1', id: area.id, revision: plan.spatial_context.revision, placements: kit, nodes: group.map(node => ({ id: node.id, role: node.role, position: node.position_m ?? [0, 0, 0], ...(node.attachment && { attachment: { placementId: node.attachment.placement_id, offset: node.attachment.offset_m } }) })), edges: edges.map(edge => ({ id: edge.id, from: edge.from_node_id, to: edge.to_node_id })) }, { bounds: north ? venue.editBounds : { minX: -900, maxX: 900, minZ: -900, maxZ: 900 }, catalogue })
    assert.ok(checked.valid, `${area.id}: ${checked.issues.map(issue => issue.message).join(' | ')}`)
    const buildings = venue.areas.filter(item => item.kind === 'building')
    for (const edge of edges) for (const p of samples(position(nodes.get(edge.from_node_id)), position(nodes.get(edge.to_node_id)))) {
      assert.ok(corridorDistance(p, paths) < width / 2 - 0.3, edge.id)
      assert.ok(!inside(p, venue.stadiumOutline) && !buildings.some(item => inside(p, item.ring)), edge.id)
    }
    const walkIn = navigation.edges.find(edge => edge.id === `connector_approach_to_${area.id}`)
    for (const p of samples(position(nodes.get(walkIn.from_node_id)), position(nodes.get(walkIn.to_node_id)))) assert.ok(corridorDistance(p, paths) < width / 2 - 0.3, walkIn.id)
    assert.equal(kit.filter(item => item.presetId === 'barrier-230').length, 15)
    for (const item of kit.filter(item => ['barrier-230', 'table-183', 'detector-90'].includes(item.presetId))) {
      const preset = catalogue.find(candidate => candidate.id === item.presetId)
      for (const x of [-preset.widthM / 2, preset.widthM / 2]) for (const z of [-preset.depthM / 2, preset.depthM / 2]) assert.ok(corridorDistance(localToWorld([x, 0, z], item), paths) < width / 2, item.id)
    }
    for (const operator of plan.spatial_context.operators.filter(item => item.entry_area_id === area.id)) {
      const pl = placements.find(item => item.id === operator.attachment.placement_id)
      assert.ok(corridorDistance(localToWorld(operator.attachment.offset_m, pl), paths) < width / 2 - 0.3, operator.id)
    }
    const gate = plan.venue.layout.gates.find(item => item.id === area.gate_id)
    assert.equal(gate.lanes[0].count, 4)
    assert.deepEqual(gate.lanes[0].steps, ['security_inspection', 'eticket_scan', 'wristband_fit'])
    const help = stations.find(station => station.node_id === area.help_checkpoint_node_id)
    const desk = plan.venue.layout.service_points.find(point => point.id === help.point_id)
    assert.deepEqual(desk.lanes[0].steps, ['help_desk_resolution'])
    assert.equal(desk.lanes[0].serves, 'visitors_with_exception')
    assert.ok(hasPath(key('arrival'), area.help_pass_node_id, edges))
    assert.ok(hasPath(area.help_pass_node_id, help.node_id, edges))
    assert.equal(hasPath(help.node_id, area.help_pass_node_id, edges), false)
    for (const lane of [1, 2, 3, 4]) {
      const prefix = lane === 2 ? '' : `lane_${lane}_`, scan = key(`${prefix}scan_checkpoint`), security = key(`${prefix}security_checkpoint`)
      assert.ok(hasPath(area.help_pass_node_id, security, edges, new Set([help.node_id])))
      assert.ok(hasPath(help.node_id, security, edges))
      assert.equal(hasPath(key('arrival'), security, edges, new Set([area.help_pass_node_id])), false, `${security} bypasses help desk pass`)
      assert.ok(hasPath(security, scan, edges))
      assert.ok(hasPath(scan, key('destination'), edges))
      assert.equal(hasPath(scan, security, edges), false, `lane ${lane} loops back to security at ${area.id}`)
      assert.equal(hasPath(key('arrival'), scan, edges, new Set([security])), false, `lane ${lane} bypasses security at ${area.id}`)
      assert.equal(hasPath(security, key('destination'), edges, new Set([scan])), false, `lane ${lane} bypasses scan at ${area.id}`)
      const securityStation = stations.find(station => station.node_id === security)
      const tail = nodes.get(securityStation.queue_start_node_id), head = nodes.get(securityStation.queue_end_node_id)
      assert.equal(tail.attachment.placement_id, key(`row_${lane - 1}_0`))
      assert.equal(head.attachment.placement_id, key(`row_${lane - 1}_2`))
      assert.equal(hasPath(key('arrival'), security, edges, new Set([tail.id])), false, `${security} bypasses its queue pen`)

      const { widthM: panelLength, depthM: panelDepth } = catalogue.find(item => item.id === 'barrier-230')
      const innerRail = (row, side) => [0, 1, 2].flatMap(panel => {
        const placement = kit.find(item => item.id === key(`row_${row}_${panel}`))
        return [panelLength / 2, -panelLength / 2].map(x => localToWorld([x, 0, side * panelDepth / 2], placement))
      })
      const pen = [...innerRail(lane - 1, 1), ...innerRail(lane, -1).reverse()]
      const waitingEdges = laneSegment(checked.graph.edges, tail.id, head.id)
      for (const edge of waitingEdges) for (const sample of samples(position(nodes.get(edge.from)), position(nodes.get(edge.to)))) {
        assert.ok(inside(sample, pen), `${edge.id} leaves the fenced waiting lane`)
      }
      const waitingLength = waitingEdges.reduce((sum, edge) => sum + edge.distanceM, 0)
      const callUpLength = laneSegment(checked.graph.edges, head.id, security).reduce((sum, edge) => sum + edge.distanceM, 0)
      assert.ok(waitingLength >= 6 && waitingLength <= 7, `${security} pen length ${waitingLength}`)
      assert.ok(callUpLength > 0 && callUpLength < 7, `${security} call-up length ${callUpLength}`)
      const scanStation = stations.find(station => station.node_id === scan)
      assert.equal(scanStation.queue_start_node_id, undefined)
      assert.equal(scanStation.queue_end_node_id, undefined)
    }
  }
})
