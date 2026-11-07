import { readFileSync } from 'node:fs'
import { validateLayout } from '../web/src/simulation/layout/core.ts'
import { catalogue } from '../web/src/simulation/model.ts'

const root = new URL('../', import.meta.url)
export const venue = JSON.parse(readFileSync(new URL('web/src/simulation/venue/gbk.json', root)))
const raw = JSON.parse(readFileSync(new URL('data/venues/gbk/osm-source.json', root)))
const { origins: originSources } = JSON.parse(readFileSync(new URL('data/venues/gbk/arrival-origins.json', root)))
const nodes = new Map(raw.elements.filter(item => item.type === 'node').map(item => [String(item.id), item]))
const ways = new Map(raw.elements.filter(item => item.type === 'way').map(item => [String(item.id), item]))
const radians = Math.PI / 180
export const round = value => Math.round(value * 1000) / 1000
export const project = node => [round(6378137 * Math.cos(-6.21858 * radians) * (node.lon - 106.80255) * radians), 0, round(6378137 * (-6.21858 - node.lat) * radians)]
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const allowed = new Set(['footway', 'pedestrian', 'path', 'steps', 'living_street', 'service'])
const restricted = tags => ['no', 'private', 'customers'].includes(tags?.access) || ['no', 'private'].includes(tags?.foot)
const rendered = new Map()
for (const path of venue.paths) {
  const key = path.id.match(/^osm-way-(\d+)-/)[1]
  rendered.set(key, [...(rendered.get(key) ?? []), path])
}
export function pointSegmentDistance(point, a, b) {
  const length2 = distance(a, b) ** 2
  const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * (b[0] - a[0]) + (point[2] - a[2]) * (b[2] - a[2])) / length2)) : 0
  return distance(point, [a[0] + t * (b[0] - a[0]), 0, a[2] + t * (b[2] - a[2])])
}
const isRendered = (wayId, a, b) => (rendered.get(wayId) ?? []).some(path => path.points.slice(1).some((end, index) => pointSegmentDistance(a, path.points[index], end) < 0.025 && pointSegmentDistance(b, path.points[index], end) < 0.025))
const graph = new Map()
function connect(a, b, wayId, length) {
  if (!graph.has(a)) graph.set(a, new Map())
  if (!graph.get(a).has(b) || graph.get(a).get(b).length > length) graph.get(a).set(b, { length, wayId })
}
for (const [wayId, way] of ways) {
  if (!allowed.has(way.tags?.highway) || restricted(way.tags) || way.tags?.area === 'yes' || way.tags?.tunnel === 'yes') continue
  for (let i = 1; i < way.nodes.length; i++) {
    const a = String(way.nodes[i - 1]), b = String(way.nodes[i])
    if (!nodes.has(a) || !nodes.has(b) || restricted(nodes.get(a).tags) || restricted(nodes.get(b).tags)) continue
    const pa = project(nodes.get(a)), pb = project(nodes.get(b))
    if (!isRendered(wayId, pa, pb)) continue
    connect(a, b, wayId, distance(pa, pb)); connect(b, a, wayId, distance(pa, pb))
  }
}
// Shared node IDs establish connectivity. Crossing lines never create an implicit junction.
const component = new Set(['10121357658']), pending = [...component]
for (let i = 0; i < pending.length; i++) for (const id of graph.get(pending[i])?.keys() ?? []) if (!component.has(id)) { component.add(id); pending.push(id) }
export const publicGraph = new Map([...graph].filter(([id]) => component.has(id)))
const pathPoints = id => rendered.get(String(id))[0].points
const nodePosition = id => project(nodes.get(id))

function along(points) {
  const lengths = [0]
  points.slice(1).forEach((point, index) => lengths.push(lengths.at(-1) + distance(points[index], point)))
  return lengths
}
function at(points, lengths, s) {
  const i = Math.max(0, Math.min(points.length - 2, lengths.findIndex((value, index) => index && value >= s) - 1))
  const t = (s - lengths[i]) / (lengths[i + 1] - lengths[i])
  return [points[i][0] + t * (points[i + 1][0] - points[i][0]), 0, points[i][2] + t * (points[i + 1][2] - points[i][2])]
}
function slice(points, start, length = 141) {
  const lengths = along(points)
  if (start < 0 || start + length > lengths.at(-1)) throw new Error('Admission spine exceeds its mapped corridor')
  return [at(points, lengths, start), ...points.filter((point, i) => lengths[i] > start && lengths[i] < start + length), at(points, lengths, start + length)]
}
function nearestS(points, target) {
  const lengths = along(points)
  let best = { distance: Infinity, s: 0 }
  points.slice(1).forEach((end, i) => {
    const begin = points[i], d2 = distance(begin, end) ** 2
    const t = Math.max(0, Math.min(1, ((target[0] - begin[0]) * (end[0] - begin[0]) + (target[2] - begin[2]) * (end[2] - begin[2])) / d2))
    const position = [begin[0] + t * (end[0] - begin[0]), 0, begin[2] + t * (end[2] - begin[2])]
    if (distance(position, target) < best.distance) best = { distance: distance(position, target), s: lengths[i] + t * Math.sqrt(d2) }
  })
  return best.s
}
const north = pathPoints(28212629)
const west = pathPoints(555901298)
const yellow = pathPoints(403721028)
const east = pathPoints(555901293).slice().reverse()
const southeast = pathPoints(403720975)
const annotatedBasis = 'screenshot_guided_operating_width_site_review_required'

function annotatedCorridor(points, wayId, start, end, widthM, annotationCenter, accessReview) {
  return {
    points: slice(points, start, end - start),
    wayIds: [wayId],
    widthM,
    renderedWidthM: rendered.get(wayId)[0].widthM,
    placementBasis: annotatedBasis,
    // Keep the sketch reference separate from the actual simulated security checkpoint.
    requestedAnchor: at(points, along(points), nearestS(points, annotationCenter)).map(round),
    accessReview,
    closesPublicThrough: true,
  }
}

// OSM supplies the centerlines. The highlighted envelopes and widths are demo layout inputs.
const spineDefinitions = {
  plaza_utara: {
    points: slice(north, nearestS(north, [12, 0, -317])),
    wayIds: ['28212629'], widthM: 9, renderedWidthM: 7.5,
    placementBasis: 'expanded_operating_width_site_review_required', closesPublicThrough: true,
  },
  plaza_barat: {
    points: slice(west, nearestS(west, [-305, 0, 0.4])),
    wayIds: ['555901298'], widthM: 7.5, renderedWidthM: 7.5,
    placementBasis: 'illustrative_layout_on_mapped_pedestrian_way',
  },
  // The marked NW carriageway is private. Its short mapped link is isolated to this admission entrance.
  pintu_kuning: annotatedCorridor(
    yellow, '403721028', nearestS(yellow, nodePosition('4060512445')) + 2,
    nearestS(yellow, nodePosition('9531573790')), 10, [-159, 0, -241], {
      status: 'proposed_event_permission_required',
      public_anchor_osm_node_id: '4060512460',
      mapped_connector_osm_node_ids: ['4060512451', '4060512445'],
      source_osm_way_ids: ['403721006', '403721028'],
    },
  ),
  plaza_timur: annotatedCorridor(
    east, '555901293', nearestS(east, [392, 0, 3.05]), nearestS(east, [210, 0, 2.35]), 15, [307, 0, 3],
  ),
  plaza_tenggara: annotatedCorridor(
    southeast, '403720975', nearestS(southeast, [209, 0, 271]),
    nearestS(southeast, nodePosition('13531836398')) - 5, 15, [181, 0, 232],
  ),
}
export function admissionSpine(areaId) {
  const definition = spineDefinitions[areaId], points = definition.points, lengths = along(points)
  const segments = points.slice(1).map((point, i) => {
    const length = distance(points[i], point)
    return { x: (point[0] - points[i][0]) / length, z: (point[2] - points[i][2]) / length }
  })
  const normals = points.map((point, i) => {
    const a = segments[Math.max(0, i - 1)], b = segments[Math.min(i, segments.length - 1)]
    const dot = Math.max(0.5, 1 + a.x * b.x + a.z * b.z)
    return [(a.z + b.z) / dot, 0, -(a.x + b.x) / dot]
  })
  const sample = (s, offset = 0) => {
    let i = lengths.findIndex((value, index) => index && value >= s) - 1
    if (i < 0) i = s <= 0 ? 0 : points.length - 2
    const t = (s - lengths[i]) / (lengths[i + 1] - lengths[i])
    return [0, 1, 2].map(axis => round(points[i][axis] + t * (points[i + 1][axis] - points[i][axis]) + offset * (normals[i][axis] + t * (normals[i + 1][axis] - normals[i][axis]))))
  }
  return {
    ...definition, lengths, lengthM: lengths.at(-1),
    transform: point => sample(point[2] + 317, point[0] - 12),
    sample,
    yaw: s => { const segment = segments.find((_, index) => lengths[index + 1] >= s) ?? segments.at(-1); return Math.atan2(segment.x, segment.z) * 180 / Math.PI },
  }
}

function shortest(graph, start, end) {
  const distances = new Map([[start, 0]]), previous = new Map(), remaining = new Set(graph.keys())
  while (remaining.size) {
    let current, minimum = Infinity
    for (const id of remaining) if ((distances.get(id) ?? Infinity) < minimum) { current = id; minimum = distances.get(id) }
    if (!current) throw new Error(`No mapped walking route ${start} → ${end}`)
    if (current === end) break
    remaining.delete(current)
    for (const [next, edge] of graph.get(current)) if (minimum + edge.length < (distances.get(next) ?? Infinity)) { distances.set(next, minimum + edge.length); previous.set(next, current) }
  }
  const result = [end]
  while (result[0] !== start) result.unshift(previous.get(result[0]))
  return { ids: result, distance: distances.get(end) }
}

function reachable(graph, start) {
  const queue = [start]
  const seen = new Set(queue)
  for (let i = 0; i < queue.length; i++) {
    for (const next of graph.get(queue[i]).keys()) if (!seen.has(next)) {
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

function sharesSpineSegment(a, b, spine) {
  const length = distance(a, b)
  if (length <= 0.025) return false
  const dx = (b[0] - a[0]) / length, dz = (b[2] - a[2]) / length
  const alongEdge = p => (p[0] - a[0]) * dx + (p[2] - a[2]) * dz
  const onEdgeLine = p => Math.abs((p[0] - a[0]) * dz - (p[2] - a[2]) * dx) < 0.025
  return spine.points.slice(1).some((end, i) => {
    const start = spine.points[i]
    if (!onEdgeLine(start) || !onEdgeLine(end)) return false
    const s = alongEdge(start), e = alongEdge(end)
    return Math.min(length, Math.max(s, e)) - Math.max(0, Math.min(s, e)) > 0.025
  })
}

function clearApproaches(spatial) {
  const mapNodes = [...publicGraph.keys()].map(id => ({ id, role: 'waypoint', position: project(nodes.get(id)) }))
  const mapNodeById = new Map(mapNodes.map(node => [node.id, node]))
  const closedCorridors = Object.values(spineDefinitions).filter(spine => spine.closesPublicThrough)
  const candidateEdges = []
  for (const [from, links] of publicGraph) {
    const a = mapNodeById.get(from).position
    for (const [to, leg] of links) {
      const b = mapNodeById.get(to).position
      if (closedCorridors.some(spine => spine.wayIds.includes(leg.wayId) && sharesSpineSegment(a, b, spine))) continue
      candidateEdges.push({ id: `approach_${from}_${to}`, from, to })
    }
  }
  const reviewNodes = []
  const reviewedJoins = new Map()
  const arrivals = spatial.entry_areas.map(area => {
    const id = area.id === 'plaza_utara' ? 'arrival' : `${area.id}_arrival`
    const arrival = spatial.navigation.nodes.find(node => node.id === id)
    const spine = spineDefinitions[area.id]
    const review = spine.accessReview
    if (review) {
      const anchor = mapNodeById.get(review.public_anchor_osm_node_id)
      if (!anchor) throw new Error(`Proposed event access for ${area.id} needs a public anchor.`)
      const connectorNodes = review.mapped_connector_osm_node_ids.map(osmNodeId => ({
        id: `approach_review_${osmNodeId}`, role: 'waypoint', position: nodePosition(osmNodeId), osmNodeId,
      }))
      const chain = [anchor, ...connectorNodes, { id, position: arrival.position_m }]
      const edges = chain.slice(1).map((to, i) => {
        const from = chain[i]
        const wayId = review.source_osm_way_ids.find(source => isRendered(source, from.position, to.position))
        if (!wayId) throw new Error(`Missing mapped event access geometry for ${area.id}: ${from.id} → ${to.id}`)
        return { id: to.id === id ? `connector_approach_to_${area.id}` : `connector_event_${area.id}_${i + 1}`, from: from.id, to: to.id, wayId }
      })
      reviewedJoins.set(id, { anchor: anchor.id, nodes: connectorNodes, edges })
      reviewNodes.push(...connectorNodes)
      candidateEdges.push(...edges)
    } else {
      const [start, next] = spine.points
      const segmentLength = distance(start, next)
      const dx = (next[0] - start[0]) / segmentLength, dz = (next[2] - start[2]) / segmentLength
      for (const node of mapNodes) {
        const direction = (node.position[0] - arrival.position_m[0]) * dx + (node.position[2] - arrival.position_m[2]) * dz
        if (direction > 0.025) continue
        if (spine.wayIds.some(wayId => isRendered(wayId, node.position, arrival.position_m))) {
          candidateEdges.push({ id: `approach_${node.id}_${id}`, from: node.id, to: id })
        }
      }
    }
    return { id, role: 'destination', position: arrival.position_m, areaId: area.id }
  })
  const checked = validateLayout({
    schemaVersion: 'opsidio-editor/0.1', id: 'public-approach-clearance', revision: spatial.revision,
    placements: spatial.placements.map(item => ({ id: item.id, label: item.label, presetId: item.preset_id, position: item.position_m, yawDeg: item.yaw_deg, bays: item.parameters?.bays })),
    nodes: [...mapNodes, ...reviewNodes, ...arrivals], edges: candidateEdges,
  }, { bounds: { minX: -900, maxX: 900, minZ: -900, maxZ: 900 }, catalogue })
  const graph = new Map(mapNodes.map(node => [node.id, new Map()]))
  const joins = new Map(arrivals.map(arrival => [arrival.id, []]))
  for (const edge of checked.graph.edges) {
    if (publicGraph.get(edge.from)?.has(edge.to)) graph.get(edge.from).set(edge.to, publicGraph.get(edge.from).get(edge.to))
    else if (joins.has(edge.to)) joins.get(edge.to).push(edge)
  }
  const clearComponent = reachable(graph, '10121357658')
  const clearEdges = new Map(checked.graph.edges.map(edge => [edge.id, edge]))
  const targets = new Map(arrivals.map(arrival => {
    const review = reviewedJoins.get(arrival.id)
    if (review) {
      const edges = review.edges.map(edge => ({ ...edge, length: clearEdges.get(edge.id)?.distanceM }))
      if (!clearComponent.has(review.anchor) || edges.some(edge => edge.length === undefined)) throw new Error(`Proposed event access for ${arrival.areaId} is disconnected or blocked.`)
      const length = round(edges.reduce((sum, edge) => sum + edge.length, 0))
      return [arrival.areaId, { nodeId: arrival.id, anchor: review.anchor, length, review: { nodes: review.nodes, edges } }]
    }
    const join = joins.get(arrival.id).filter(edge => clearComponent.has(edge.from)).sort((a, b) => a.distanceM - b.distanceM)[0]
    if (!join) throw new Error(`No clear mapped forecourt link for ${arrival.areaId}`)
    return [arrival.areaId, { nodeId: arrival.id, anchor: join.from, length: round(join.distanceM) }]
  }))
  return { graph, targets, clearComponent }
}

export function addArrivalNetwork(spatial, layout) {
  spatial.arrival_origins = originSources.map(item => {
    const parking = item.osm_way_id && ways.get(item.osm_way_id).nodes.slice(0, -1).map(id => project(nodes.get(String(id))))
    const position_m = parking ? [0, 1, 2].map(axis => round(parking.reduce((sum, point) => sum + point[axis], 0) / parking.length)) : project(nodes.get(item.osm_node_id))
    return { ...item, position_m }
  })
  const { graph, targets, clearComponent } = clearApproaches(spatial)
  const networkIds = new Set(), networkEdges = new Map(), connectors = [], distances = []
  const nearest = point => [...clearComponent].sort((a, b) => distance(point, project(nodes.get(a))) - distance(point, project(nodes.get(b))))[0]
  const anchors = new Map(spatial.arrival_origins.map(origin => [origin.id, origin.osm_node_id ?? nearest(origin.position_m)]))
  const originAliases = new Map(spatial.arrival_origins.filter(origin => origin.osm_node_id).map(origin => [origin.osm_node_id, origin.id]))
  const navigationId = id => originAliases.get(id) ?? `approach_osm_${id}`
  const addPair = (a, b) => {
    networkIds.add(a)
    networkIds.add(b)
    networkEdges.set(`approach_${a}_${b}`, [a, b])
    if (graph.get(b).has(a)) networkEdges.set(`approach_${b}_${a}`, [b, a])
  }
  const join = (id, position, anchor, label, proposed = false) => {
    networkIds.add(anchor)
    const length = round(distance(position, project(nodes.get(anchor))))
    if (length > 0.01) connectors.push({ id: `connector_${id}`, from_node_id: id, to_node_id: navigationId(anchor), directed: true, basis: proposed ? 'proposed_connector_site_review_required' : 'mapped_corridor_access', distance_m: length, label })
    return length
  }
  for (const origin of spatial.arrival_origins) {
    spatial.navigation.nodes.push({ ...origin, role: 'arrival', entry_area_id: 'shared_origins' })
    const originConnector = join(origin.id, origin.position_m, anchors.get(origin.id), `${origin.label} pedestrian connector`, origin.id === 'origin_parking')
    layout.zones.push({ id: origin.id, name: origin.label, type: origin.mode === 'taxi_ride_hailing' ? 'drop_off' : 'holding', basis: 'estimate', position_m: origin.position_m, arrival_mode: origin.mode })
    for (const area of spatial.entry_areas) {
      const target = targets.get(area.id)
      const route = shortest(graph, anchors.get(origin.id), target.anchor)
      route.ids.slice(1).forEach((b, index) => addPair(route.ids[index], b))
      const length = round(originConnector + route.distance + target.length)
      const basis = target.review ? 'mapped_public_network_with_proposed_event_access' : 'mapped_public_network_plus_explicit_connectors'
      distances.push({ origin_id: origin.id, entry_area_id: area.id, arrival_node_id: target.nodeId, distance_m: length, basis })
      layout.walking_paths.push({ from: origin.id, to: `queue_${area.id}`, distance_m: length, basis: 'estimate', spatial_route_ref: `${origin.id}__${area.id}`, time_reference: 'origin_spawn' })
    }
  }
  for (const area of spatial.entry_areas) {
    const target = targets.get(area.id)
    networkIds.add(target.anchor)
    if (target.review) {
      for (const node of target.review.nodes) spatial.navigation.nodes.push({ id: node.id, role: node.role, position_m: node.position, entry_area_id: 'approach_network', osm_node_id: node.osmNodeId, basis: 'proposed_event_access_site_review_required' })
      for (const edge of target.review.edges) connectors.push({
        id: edge.id, from_node_id: edge.from === target.anchor ? navigationId(edge.from) : edge.from, to_node_id: edge.to,
        directed: true, basis: 'proposed_event_access_site_review_required', distance_m: round(edge.length), osm_way_id: edge.wayId, entry_area_id: area.id,
      })
    } else {
      connectors.push({ id: `connector_approach_to_${area.id}`, from_node_id: navigationId(target.anchor), to_node_id: target.nodeId, directed: true, basis: 'mapped_corridor_access', distance_m: target.length })
    }
  }
  for (const id of [...networkIds].sort()) if (!originAliases.has(id)) spatial.navigation.nodes.push({ id: navigationId(id), role: 'waypoint', entry_area_id: 'approach_network', position_m: project(nodes.get(id)), osm_node_id: id, basis: 'mapped_public_walking_network' })
  for (const [id, [from, to]] of [...networkEdges].sort(([a], [b]) => a.localeCompare(b))) {
    spatial.navigation.edges.push({ id, from_node_id: navigationId(from), to_node_id: navigationId(to), directed: true, osm_way_id: graph.get(from).get(to).wayId, basis: 'mapped_public_walking_network' })
  }
  spatial.navigation.edges.push(...connectors)
  spatial.approach_routes = distances
  spatial.approach_network = {
    basis: 'mapped_public_osm_shared_nodes', public_component_nodes: publicGraph.size, kit_clear_component_nodes: clearComponent.size, used_nodes: networkIds.size,
    access_policy: 'Use rendered footways, paths, steps, living streets and service roads connected at shared OSM nodes. Exclude restricted public legs, installed kit and reserved admission corridors from through travel. Pintu Kuning has a separate one-way event access link pending permission.',
    connectors: connectors.filter(item => item.basis.startsWith('proposed')), review_overlaps: [],
    limitations: ['OSM access and screenshot-guided operating widths need event review.', 'No accessible routing, opening hours, crossing signal or vehicle traffic model.', 'The Pintu Kuning event connector uses mapped private ways. Its modeled access depends on permission.'],
  }
  return distances
}
