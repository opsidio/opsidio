import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { validateLayout, importLayoutJSON } from './core.ts'
import { catalogue } from '../model.ts'

function compile(path, replacements) {
  let result = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  for (const [key, value] of Object.entries(replacements)) result = result.replaceAll(`'${key}'`, JSON.stringify(value))
  return `data:text/javascript;base64,${Buffer.from(result).toString('base64')}`
}
const compilerURL = compile('../plan/compile.ts', { '../model': new URL('../model.ts', import.meta.url).href, '../abm/generator': new URL('../abm/generator.ts', import.meta.url).href, '../layout/core': new URL('./core.ts', import.meta.url).href })
const { createPlanEditorLayout, projectPlanEditorLayout, planEditorOptions } = await import(compile('./planAdapter.ts', {
  '../plan/compile': compilerURL, '../abm/generator': new URL('../abm/generator.ts', import.meta.url).href, './core': new URL('./core.ts', import.meta.url).href,
}))
const fixture = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))

test('whole-plan snapshot retains five area layouts, origins, directed cross-area links and markers', () => {
  const layout = createPlanEditorLayout(fixture), options = planEditorOptions(fixture)
  assert.equal(layout.placements.length, fixture.spatial_context.placements.length)
  assert.equal(layout.nodes.length, fixture.spatial_context.navigation.nodes.length)
  assert.equal(layout.edges.length, fixture.spatial_context.navigation.edges.length)
  assert.equal(layout.markers.length, 5)
  assert.ok(options.areas.some(area => area.id === 'shared_origins'))
  for (const node of layout.nodes) assert.ok(node.position[0] >= options.bounds.minX && node.position[0] <= options.bounds.maxX)
  const restored = importLayoutJSON(JSON.stringify(layout), { ...options, catalogue })
  assert.ok(restored.layout)
  assert.equal(restored.validation.valid, true, JSON.stringify(restored.validation.issues.filter(issue => issue.severity === 'error').slice(0, 10)))
  assert.deepEqual(restored.validation.issues.filter(issue => issue.code === 'reviewed_demo_overlap'), [])
  assert.deepEqual(restored.layout.markers, layout.markers)
})

test('moving an East placement preserves unrelated source metadata and operational assignments', () => {
  const layout = createPlanEditorLayout(fixture)
  const placement = layout.placements.find(item => item.id === 'plaza_timur_help_table')
  placement.position = [placement.position[0] + 0.1, 0, placement.position[2]]
  layout.revision++
  const plan = projectPlanEditorLayout(fixture, layout)
  assert.deepEqual(plan.spatial_context.placements.find(item => item.id === placement.id).position_m, placement.position)
  assert.deepEqual(plan.spatial_context.operators, fixture.spatial_context.operators)
  assert.deepEqual(plan.spatial_context.operational_bindings, fixture.spatial_context.operational_bindings)
  assert.equal(plan.spatial_context.revision, layout.revision)
  assert.equal(plan.spatial_context.navigation.edges.length, layout.edges.length)
  assert.ok(plan.spatial_context.navigation.edges.every(edge => edge.directed === true))
})

test('moving drop-off updates matching origin and node, preserves reference and refreshes approach length', () => {
  const layout = createPlanEditorLayout(fixture), origin = layout.nodes.find(node => node.id === 'origin_dropoff')
  origin.position = [origin.position[0] + 6, 0, origin.position[2] + 2]
  layout.revision++
  const plan = projectPlanEditorLayout(fixture, layout), updated = plan.spatial_context.arrival_origins.find(item => item.id === origin.id)
  assert.deepEqual(updated.position_m, origin.position)
  assert.equal(updated.basis, 'user_authored_proposed_origin_position')
  assert.deepEqual(updated.reference_position_m, fixture.spatial_context.arrival_origins.find(item => item.id === origin.id).position_m)
  assert.deepEqual(plan.spatial_context.navigation.nodes.find(item => item.id === origin.id).position_m, origin.position)
  assert.notEqual(plan.spatial_context.approach_routes.find(route => route.origin_id === origin.id).distance_m, fixture.spatial_context.approach_routes.find(route => route.origin_id === origin.id).distance_m)
})

test('moving a visual gate marker does not silently relocate route nodes', () => {
  const layout = createPlanEditorLayout(fixture), marker = layout.markers.find(item => item.entryAreaId === 'plaza_barat')
  marker.position = [marker.position[0] - 20, 0, marker.position[2]]
  const plan = projectPlanEditorLayout(fixture, layout)
  assert.deepEqual(plan.spatial_context.entry_areas.find(area => area.id === 'plaza_barat').position_m, marker.position)
  assert.equal(plan.spatial_context.entry_areas.find(area => area.id === 'plaza_barat').marker_basis, 'user_authored_visual_marker_only')
  assert.deepEqual(plan.spatial_context.navigation.nodes.map(node => node.position_m), fixture.spatial_context.navigation.nodes.map(node => node.position_m))
})

test('bound station nodes and equipment cannot disappear through imported snapshots', () => {
  const layout = createPlanEditorLayout(fixture)
  layout.nodes = layout.nodes.filter(node => node.id !== 'plaza_timur_scan_checkpoint')
  assert.throws(() => projectPlanEditorLayout(fixture, layout), /bound to operations/)
})

test('marker shapes reject non-finite coordinates before renderer access', () => {
  const layout = createPlanEditorLayout(fixture)
  layout.markers[0].position = [NaN, 0, 0]
  assert.equal(validateLayout(layout, { ...planEditorOptions(fixture), catalogue }).valid, false)
})
