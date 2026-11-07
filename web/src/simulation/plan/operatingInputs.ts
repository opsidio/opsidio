/** The operating controls only activate lanes that have a complete authored route and staff positions. */
type Row = Record<string, any>
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : []
export type GateInputs = { lanes: number; opens: string; closes: string }
export type EditableGate = GateInputs & { id: string; label: string; maxLanes: number }

function gateRows(plan: Row) {
  const spatial = plan.spatial_context
  const stations = rows(spatial?.service_stations)
  const byNode = new Map(stations.map(station => [station.node_id, station]))
  const outgoing = new Map<string, string[]>()
  for (const edge of rows(spatial?.navigation?.edges)) {
    const list = outgoing.get(edge.from_node_id) ?? []
    list.push(edge.to_node_id)
    outgoing.set(edge.from_node_id, list)
  }
  const categories = rows(plan.event?.ticket_categories)
  return rows(plan.venue?.layout?.gates).flatMap(gate => {
    const lanes = rows(gate.lanes)
    if (lanes.length !== 1 || !Number.isInteger(lanes[0].count) || !Number.isInteger(gate.max_lanes)) return []
    const categoryIds = new Set(categories.filter(category => category.entry_gate === gate.id).map(category => category.id))
    const routes = rows(spatial?.cohort_routes).filter(route => categoryIds.has(route.category_id))
    const laneIds = routes[0]?.lane_checkpoint_ids
    if (!Array.isArray(laneIds) || laneIds.length !== lanes[0].count || laneIds.length > gate.max_lanes
      || routes.some(route => !Array.isArray(route.lane_checkpoint_ids) || route.lane_checkpoint_ids.join() !== laneIds.join())) return []
    const pairs: [Row, Row][] = []
    for (const laneId of laneIds) {
      const first = byNode.get(laneId)
      if (!first || first.point_id !== gate.id) return []
      const visited = new Set<string>([laneId]), queue = [...(outgoing.get(laneId) ?? [])], next = new Set<Row>()
      for (const id of queue) {
        if (visited.has(id)) continue
        visited.add(id)
        const station = byNode.get(id)
        if (station) { next.add(station); continue }
        queue.push(...(outgoing.get(id) ?? []))
      }
      const second = next.values().next().value
      if (next.size !== 1 || !second || second.point_id !== gate.id) return []
      pairs.push([first, second])
    }
    if (new Set(pairs.flat().map(station => station.id)).size !== pairs.length * 2) return []
    return [{ gate, routes, pairs, laneIds: laneIds as string[] }]
  })
}

function routeNodeIds(nodes: readonly Row[], edges: readonly Row[]): Set<string> {
  const forward = new Map<string, string[]>(), backward = new Map<string, string[]>()
  for (const { from_node_id: from, to_node_id: to } of edges) {
    const outgoing = forward.get(from) ?? [], incoming = backward.get(to) ?? []
    outgoing.push(to)
    incoming.push(from)
    forward.set(from, outgoing)
    backward.set(to, incoming)
  }
  function walk(role: string, links: ReadonlyMap<string, readonly string[]>) {
    const queue = nodes.filter(node => node.role === role).map(node => String(node.id))
    const visited = new Set(queue)
    for (const id of queue) for (const next of links.get(id) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
    return visited
  }
  const fromArrival = walk('arrival', forward)
  const toDestination = walk('destination', backward)
  return new Set([...fromArrival].filter(id => toDestination.has(id)))
}

function pruneInactiveLaneBranches(spatial: Row, disabledNodes: Set<string>, replacementNodes: ReadonlyMap<string, readonly string[]>) {
  if (!disabledNodes.size) return
  const navigation = spatial.navigation
  const nodes = rows(navigation.nodes), edges = rows(navigation.edges)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const editedAreas = new Set([...disabledNodes].map(id => byId.get(id)?.entry_area_id))
  const originalRoute = routeNodeIds(nodes, edges)
  const activeEdges = edges.filter(edge => !disabledNodes.has(edge.from_node_id) && !disabledNodes.has(edge.to_node_id))
  const activeRoute = routeNodeIds(nodes, activeEdges)
  const pruned = new Set(disabledNodes)
  // Remove only route nodes stranded by this edit. Arrivals, destinations, and the public network stay authored.
  for (const node of nodes) {
    if (editedAreas.has(node.entry_area_id) && node.role !== 'arrival' && node.role !== 'destination'
      && originalRoute.has(node.id) && !activeRoute.has(node.id)) pruned.add(node.id)
  }
  navigation.nodes = nodes.filter(node => !pruned.has(node.id))
  navigation.edges = activeEdges.filter(edge => !pruned.has(edge.from_node_id) && !pruned.has(edge.to_node_id))

  if (Array.isArray(spatial.operational_bindings)) {
    spatial.operational_bindings = rows(spatial.operational_bindings).flatMap(binding => {
      if (!pruned.has(binding.node_id)) return [binding]
      const replacement = replacementNodes.get(binding.node_id)?.find(id => !pruned.has(id)
        && byId.get(id)?.attachment?.placement_id === binding.placement_id)
      return replacement ? [{ ...binding, node_id: replacement }] : []
    })
  }
  if (Array.isArray(spatial.approach_network?.connectors)) {
    const removed = new Set(edges.filter(edge => pruned.has(edge.from_node_id) || pruned.has(edge.to_node_id)).map(edge => edge.id))
    spatial.approach_network.connectors = rows(spatial.approach_network.connectors).filter(edge => !removed.has(edge.id))
  }
}

export function editableGates(plan: unknown): EditableGate[] {
  return gateRows(plan as Row).map(({ gate, pairs }) => ({ id: gate.id, label: gate.name, lanes: pairs.length, maxLanes: pairs.length, opens: gate.opens, closes: gate.closes }))
}

export function applyGateInputs(source: unknown, edits: Readonly<Record<string, GateInputs>>, extraRevision: number): unknown {
  if (!Object.keys(edits).length) return source
  const plan = structuredClone(source) as Row
  const spatial = plan.spatial_context
  const disabled = new Set<string>(), disabledStaff = new Set<string>(), disabledNodes = new Set<string>(), changedRoles = new Set<string>()
  const replacementNodes = new Map<string, readonly string[]>()
  const operators = new Map(rows(spatial.operators).map(operator => [operator.id, operator]))
  const gates = new Map(gateRows(plan).map(entry => [entry.gate.id, entry]))
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  for (const [id, edit] of Object.entries(edits)) {
    const entry = gates.get(id)
    if (!entry || !Number.isInteger(edit.lanes) || edit.lanes < 1 || edit.lanes > entry.pairs.length) throw new Error('Select a number of staffed lanes supported by the authored layout.')
    if (!clock.test(edit.opens) || !clock.test(edit.closes) || edit.closes <= edit.opens) throw new Error(`${entry.gate.name}: closing time must be later than opening time.`)
    entry.gate.opens = edit.opens
    entry.gate.closes = edit.closes
    entry.gate.lanes[0].count = edit.lanes
    for (const route of entry.routes) route.lane_checkpoint_ids = entry.laneIds.slice(0, edit.lanes)
    const activePairs = entry.pairs.slice(0, edit.lanes)
    for (const inactivePair of entry.pairs.slice(edit.lanes)) for (const [stage, station] of inactivePair.entries()) {
      disabled.add(station.id)
      disabledNodes.add(station.node_id)
      disabledStaff.add(station.operator_id)
      for (const key of ['node_id', 'queue_start_node_id', 'queue_end_node_id']) {
        if (typeof station[key] !== 'string') continue
        replacementNodes.set(station[key], activePairs.map(pair => pair[stage][key]).filter(id => typeof id === 'string'))
      }
      const operator = operators.get(station.operator_id)
      if (!operator) throw new Error('An authored lane is missing its operator binding.')
      changedRoles.add(operator.role_id)
    }
  }
  spatial.service_stations = rows(spatial.service_stations).filter(station => !disabled.has(station.id))
  spatial.operators = rows(spatial.operators).filter(operator => !disabledStaff.has(operator.id))
  pruneInactiveLaneBranches(spatial, disabledNodes, replacementNodes)
  for (const role of rows(plan.staff?.roles)) {
    if (!changedRoles.has(role.id)) continue
    const count = rows(spatial.operators).filter(operator => operator.role_id === role.id).length
    const assignments = rows(role.assignment)
    if (assignments.length !== 1 || assignments[0].per_lane !== 1 || !gates.has(assignments[0].point)) throw new Error(`${role.name}: update the existing staffing allocation before changing lane count.`)
    role.count = count
    if (role.gender) role.gender = { ...role.gender, female: Math.floor(count / 2), male: Math.ceil(count / 2) }
    assignments[0].count = count
  }
  spatial.revision += extraRevision
  if (plan.meta && Number.isInteger(plan.meta.revision)) plan.meta.revision = spatial.revision
  return plan
}
