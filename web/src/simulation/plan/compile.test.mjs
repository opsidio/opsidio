import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { generateAbm } from '../abm/generator.ts'
const source = readFileSync(new URL('./compile.ts', import.meta.url), 'utf8')
const compiledSource = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace("'../model'", JSON.stringify(new URL('../model.ts', import.meta.url).href))
  .replace("'../abm/generator'", JSON.stringify(new URL('../abm/generator.ts', import.meta.url).href))
  .replace("'../layout/core'", JSON.stringify(new URL('../layout/core.ts', import.meta.url).href))
const { compileSimulationPlan, projectNorthLayout } = await import(`data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`)
const fixture = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))

test('the actual JSON produces 70,000 journeys across all five authored entry areas', () => {
  const plan = compileSimulationPlan(fixture)
  const result = generateAbm(plan.config)
  assert.equal(result.generatedCount, 70000)
  assert.deepEqual(result.issues, [])
  assert.equal(plan.entryAreas.length, 5)
  assert.equal(plan.operators.length, 45)
  assert.equal(plan.placements.filter(item => item.presetId === 'barrier-230').length, 90)
  assert.equal(plan.entryAreas.reduce((sum, item) => sum + item.attendees, 0), 70000)
})
test('JSON ticket edits drive attendance and no-show rounding conserves the expected total', () => {
  const changed = structuredClone(fixture)
  changed.event.ticket_categories[0].sold += 10
  changed.event.capacity.no_show_percent_estimate = 3.5
  const result = compileSimulationPlan(changed)
  assert.equal(result.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0), Math.round(70010 * .965))
})
test('moving a tent projects its attached checkpoint and operators into the same plan snapshot', () => {
  const original = compileSimulationPlan(fixture)
  const layout = structuredClone(original.northLayout)
  layout.revision++
  layout.placements.find(item => item.id === 'scan_tent').position[0] += 2
  const projected = projectNorthLayout(fixture, layout)
  const result = compileSimulationPlan(projected)
  assert.equal(result.nodes.find(node => node.id === 'scan_checkpoint').position[0], 14)
  const before = original.operators.find(item => item.roleId === 'plaza_utara_scan').position[0]
  assert.equal(result.operators.find(item => item.roleId === 'plaza_utara_scan').position[0], before + 2)
  assert.equal(fixture.spatial_context.revision, 1)
})
test('a partial plan, disconnected binding, bad coordinate frame or staffing mismatch fails explicitly', () => {
  const draft = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-plan-draft.json', import.meta.url)))
  assert.throws(() => compileSimulationPlan(draft), /spatial_context/)
  for (const change of [
    plan => { plan.spatial_context.navigation.edges[0].to_node_id = 'missing' },
    plan => { plan.spatial_context.coordinate_frame.axes.z = 'north' },
    plan => { plan.staff.roles[0].count++ },
    plan => { plan.demand.arrival_windows_percent.cat1['09:00-13:00'] = 20 },
  ]) {
    const plan = structuredClone(fixture)
    change(plan)
    assert.throws(() => compileSimulationPlan(plan))
  }
})
