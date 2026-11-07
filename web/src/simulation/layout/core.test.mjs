import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogue, initialDraft } from '../model.ts'
import {
  createLayoutRevision, DEFAULT_ASSUMPTIONS, DEMO_REQUIRED_ROUTES, exportLayoutJSON,
  importLayoutJSON, localToWorld, nodeRemovalIssue, persistLayout, placementDimensions,
  placementRemovalIssue, restoreLayout, validateLayout, worldToLocal,
} from './core.ts'

const bounds = { minX: -55, maxX: 55, minZ: -325, maxZ: -175 }
const options = { bounds, catalogue, requiredRoutes: DEMO_REQUIRED_ROUTES }
const baseline = () => createLayoutRevision(initialDraft().placements)
const codes = result => result.issues.map(issue => issue.code)
const kit = (id, presetId, x, z, yawDeg = 0) => ({ id, label: id, presetId, position: [x, 0, z], yawDeg })
const wideOptions = { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, catalogue }
const simple = (placements = [], from = [-50, 0, -50], to = [-50, 0, 50]) => ({
  schemaVersion: 'opsidio-editor/0.1', id: 'test-layout', revision: 1, placements,
  nodes: [{ id: 'a', role: 'arrival', position: from }, { id: 'b', role: 'destination', position: to }],
  edges: [{ id: 'a-b', from: 'a', to: 'b' }],
})

test('a specifically reviewed unchanged overlap warns, but modified or new collisions remain errors', () => {
  const layout = simple([kit('reviewed-barrier', 'barrier-230', 0, 0)], [0, 0, -50], [0, 0, 50])
  layout.edges[0].basis = 'proposed_admission_overlap_site_review_required'
  const options = { ...wideOptions, reviewedOverlaps: [{ edgeId: 'a-b', from: 'a', to: 'b', basis: layout.edges[0].basis, fromPosition: [...layout.nodes[0].position], toPosition: [...layout.nodes[1].position], placements: structuredClone(layout.placements) }] }
  const reviewed = validateLayout(layout, options)
  assert.equal(reviewed.valid, true)
  assert.equal(reviewed.issues[0].code, 'reviewed_demo_overlap')
  assert.equal(reviewed.graph.edges.length, 1)
  const changedKit = structuredClone(layout); changedKit.placements[0].position[0] += 0.1
  assert.ok(codes(validateLayout(changedKit, options)).includes('blocked_edge'))
  const changedNode = structuredClone(layout); changedNode.nodes[0].position[0] += 0.1
  assert.ok(codes(validateLayout(changedNode, options)).includes('blocked_edge'))
  const extraKit = structuredClone(layout); extraKit.placements.push(kit('new-table', 'table-183', 0, 12))
  assert.ok(codes(validateLayout(extraKit, options)).includes('blocked_edge'))
  assert.ok(codes(validateLayout(layout, wideOptions)).includes('blocked_edge'))
})

test('the prepared graph is explicit, passes checks and retains all model placement IDs', () => {
  const layout = baseline(), result = validateLayout(layout, options)
  assert.equal(result.valid, true)
  assert.deepEqual(result.issues, [])
  assert.equal(result.graph.edges.length, 9)
  assert.equal(result.graph.nodes.find(node => node.id === 'scan_checkpoint').role, 'checkpoint')
  assert.deepEqual(layout.placements, initialDraft().placements)
  assert.equal(result.graph.edges.filter(edge => !edge.id.startsWith('help')).reduce((sum, edge) => sum + edge.distanceM, 0), 141)
})

test('attachment transform matches positive-Y Three rotation and has an inverse', () => {
  const placement = kit('p', 'roder-10', 10, 20, 90)
  const world = localToWorld([2, 3, 4], placement)
  assert.deepEqual(world, [14, 3, 18])
  const local = worldToLocal(world, placement)
  local.forEach((value, axis) => assert.ok(Math.abs(value - [2, 3, 4][axis]) < 1e-10))
})

test('moving and rotating a placement updates attachment positions and edge lengths without changing IDs', () => {
  const layout = baseline(), checkpoint = layout.nodes.find(node => node.id === 'scan_checkpoint')
  checkpoint.attachment.offset = [1, 0, 2]
  const scan = layout.placements.find(item => item.id === 'scan_tent')
  scan.position = [20, 0, -275]; scan.yawDeg = 90
  const result = validateLayout(layout, options)
  assert.deepEqual(result.graph.nodes.find(node => node.id === checkpoint.id).position, [22, 0, -276])
  assert.ok(Math.abs(result.graph.edges.find(edge => edge.id === 'help_approach').distanceM - Math.hypot(4, 15.9)) < 1e-9)
  assert.ok(!result.graph.edges.some(edge => edge.id === 'leg_3'), 'rotating a post into the queue approach must block that authored edge')
  assert.equal(checkpoint.attachment.placementId, 'scan_tent')
})

test('Roder depth comes from its bay count and catalogue dimensions', () => {
  assert.deepEqual(placementDimensions({ ...kit('r', 'roder-10', 0, 0), bays: 3 }, catalogue), [10, 15])
  assert.equal(placementDimensions(kit('missing', 'unknown', 0, 0), catalogue), null)
  const layout = simple([{ ...kit('r', 'roder-10', 0, 96), bays: 2 }])
  assert.ok(codes(validateLayout(layout, wideOptions)).includes('placement_bounds'))
})

test('open canopy interiors allow equipment and paths, while canopy overlap produces a review warning', () => {
  const inside = simple([{ ...kit('r', 'roder-10', 0, 0), bays: 2 }, kit('table', 'table-183', 0, 0)])
  assert.equal(validateLayout(inside, wideOptions).valid, true)
  const roofs = simple([{ ...kit('r1', 'roder-10', 0, 0), bays: 2 }, { ...kit('r2', 'roder-10', 2, 0), bays: 2 }])
  const result = validateLayout(roofs, wideOptions)
  assert.equal(result.valid, true)
  assert.equal(result.issues.find(issue => issue.code === 'canopy_overlap').severity, 'warning')
  const under = simple([{ ...kit('r', 'roder-10', 0, 0), bays: 2 }], [0, 0, -8], [0, 0, 8])
  assert.equal(validateLayout(under, wideOptions).valid, true)
})

test('actual canopy feet collide with equipment and block a route through a post', () => {
  const layout = simple([{ ...kit('r', 'roder-10', 0, 0), bays: 2 }, kit('table', 'table-183', 4.875, 0)])
  assert.ok(codes(validateLayout(layout, wideOptions)).includes('physical_overlap'))
  const throughPost = simple([{ ...kit('r', 'roder-10', 0, 0), bays: 2 }], [4.875, 0, -8], [4.875, 0, 8])
  const result = validateLayout(throughPost, wideOptions)
  assert.ok(codes(result).includes('blocked_edge'))
  assert.deepEqual(result.graph.edges, [])
})

test('Roder base plates extending beyond roof depth still collide and count against bounds', () => {
  const layout = simple([{ ...kit('r', 'roder-10', 0, 0), bays: 2 }, kit('table', 'table-183', 4.875, 5.4)])
  assert.ok(codes(validateLayout(layout, wideOptions)).includes('physical_overlap'))
  const atBoundary = simple([{ ...kit('r', 'roder-10', 0, 95), bays: 2 }])
  assert.ok(codes(validateLayout(atBoundary, wideOptions)).includes('placement_bounds'))
})

test('barrier foot depth and route clearance are explicit assumptions, not a zero-depth fence', () => {
  const layout = simple([kit('barrier', 'barrier-230', 0, 0)], [-5, 0, 0.4], [5, 0, 0.4])
  assert.ok(codes(validateLayout(layout, wideOptions)).includes('blocked_edge'))
  assert.equal(validateLayout(layout, { ...wideOptions, assumptions: { ...DEFAULT_ASSUMPTIONS, routeClearanceM: 0.1 } }).valid, true)
})

test('detector passage is traversable while its side supports remain obstacles', () => {
  const placements = [kit('detector', 'detector-90', 0, 0)]
  assert.equal(validateLayout(simple(placements, [0, 0, -5], [0, 0, 5]), wideOptions).valid, true)
  assert.ok(codes(validateLayout(simple(placements, [0.2, 0, -5], [0.2, 0, 5]), wideOptions)).includes('blocked_edge'))
})

test('unknown preset, attachment and endpoint references are structured errors', () => {
  const layout = baseline()
  layout.placements[0].presetId = 'missing'
  layout.edges.push({ id: 'bad-edge', from: 'arrival', to: 'missing-node' })
  const result = validateLayout(layout, options)
  assert.equal(result.valid, false)
  for (const code of ['unknown_preset', 'unknown_attachment', 'unknown_endpoint', 'missing_required_node']) assert.ok(codes(result).includes(code), code)
  assert.ok(!result.graph.edges.some(edge => edge.to === 'missing-node'))
})

test('duplicate IDs and duplicate directed edges are rejected instead of arbitrarily selecting a reference', () => {
  for (const collection of ['placements', 'nodes', 'edges']) {
    const layout = baseline(); layout[collection].push(structuredClone(layout[collection][0]))
    const result = validateLayout(layout, options)
    assert.equal(result.valid, false)
    assert.ok(codes(result).includes('duplicate_id'))
    assert.equal(importLayoutJSON(exportLayoutJSON(layout), options).layout, null)
  }
  const layout = baseline(); layout.edges.push({ ...layout.edges[0], id: 'repeat-route' })
  assert.ok(codes(validateLayout(layout, options)).includes('duplicate_edge'))
})

test('disconnected and reversed edges are not replaced with a fallback route', () => {
  const layout = baseline(); layout.edges = layout.edges.filter(edge => edge.id !== 'leg_3')
  const result = validateLayout(layout, options)
  assert.equal(result.valid, false)
  assert.ok(codes(result).includes('required_route_unreachable'))
  assert.ok(codes(result).includes('unreachable_node'))
  assert.ok(!result.graph.edges.some(edge => edge.from === 'queue-exit' && edge.to === 'scan_checkpoint'))
  const backwards = simple(); backwards.edges[0] = { id: 'reverse', from: 'b', to: 'a' }
  assert.ok(codes(validateLayout(backwards, wideOptions)).includes('unreachable_destination'))
})

test('required nodes, connected nodes and attached placements are protected from deletion', () => {
  const layout = baseline()
  assert.equal(placementRemovalIssue(layout, 'scan_tent').code, 'placement_referenced')
  assert.equal(placementRemovalIssue(layout, 'scan_table'), null)
  assert.equal(nodeRemovalIssue(layout, 'scan_checkpoint', DEMO_REQUIRED_ROUTES).code, 'node_required')
  assert.equal(nodeRemovalIssue(layout, 'queue', DEMO_REQUIRED_ROUTES).code, 'node_referenced')
  layout.nodes.push({ id: 'unused', role: 'waypoint', position: [20, 0, -270] })
  assert.equal(nodeRemovalIssue(layout, 'unused', DEMO_REQUIRED_ROUTES), null)
})

test('serialized editor snapshots round-trip and cannot be confused with the proposed algorithm envelope', () => {
  const layout = baseline(), json = exportLayoutJSON(layout), result = importLayoutJSON(json, options)
  assert.deepEqual(result.layout, layout)
  assert.equal(result.validation.valid, true)
  assert.equal(JSON.parse(json).schemaVersion, 'opsidio-editor/0.1')
  assert.equal(importLayoutJSON(json.replace('opsidio-editor/0.1', 'opsidio-layout/0.1'), options).layout, null)
  assert.equal(importLayoutJSON('{"schema_version":"opsidio-layout/0.1"}', options).layout, null)
})

test('malformed JSON and unsafe geometry shapes retain the current draft, semantic errors remain repairable', () => {
  assert.equal(importLayoutJSON('{broken', options).layout, null)
  for (const bad of [null, [0, 0], [0, null, 0]]) {
    const layout = baseline(); layout.placements[0].position = bad
    assert.equal(importLayoutJSON(JSON.stringify(layout), options).layout, null)
  }
  const layout = baseline(); layout.placements[0].position = [150, 0, -275]
  const imported = importLayoutJSON(exportLayoutJSON(layout), options)
  assert.deepEqual(imported.layout, layout)
  assert.equal(imported.validation.valid, false)
  assert.deepEqual(imported.issues, validateLayout(layout, options).issues)
})

test('restore and persist apply the live validator, retain invalid draft errors and do not overwrite corrupt storage', () => {
  const data = new Map(), writes = []
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes.push(key); data.set(key, value) } }
  const layout = baseline(); layout.edges = layout.edges.filter(edge => edge.id !== 'leg_3')
  assert.deepEqual(persistLayout(storage, 'draft', layout, options), [])
  const restored = restoreLayout(storage, 'draft', options)
  assert.equal(restored.validation.valid, false)
  assert.deepEqual(restored.issues, validateLayout(layout, options).issues)
  data.set('corrupt', '{broken')
  const corrupt = restoreLayout(storage, 'corrupt', options)
  assert.equal(corrupt.layout, null)
  assert.equal(corrupt.sourceJSON, '{broken')
  assert.deepEqual(writes, ['draft'])
  assert.equal(data.get('corrupt'), '{broken')
})

test('storage access failures and invalid geometry never throw from recovery helpers', () => {
  const storage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.equal(restoreLayout(storage, 'draft', options).issues[0].code, 'storage_read')
  assert.equal(persistLayout(storage, 'draft', baseline(), options)[0].code, 'storage_write')
  const invalid = baseline(); invalid.nodes.push(invalid.nodes[0])
  assert.ok(persistLayout(storage, 'draft', invalid, options).some(issue => issue.code === 'duplicate_id'))
})

test('validation never mutates authored positions, placements, attachments or IDs', () => {
  const layout = baseline(), before = structuredClone(layout)
  validateLayout(layout, options)
  assert.deepEqual(layout, before)
})
