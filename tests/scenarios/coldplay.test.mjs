import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const scenario = JSON.parse(await readFile(new URL('../../data/scenarios/coldplay-gbk-demo.json', import.meta.url)))

test('70,000 demo attendees are allocated once across disjoint admission cohorts', () => {
  const ids = scenario.cohorts.map(cohort => cohort.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(scenario.cohorts.reduce((sum, cohort) => sum + cohort.expected_attendees, 0), 70000)
  assert.ok(scenario.cohorts.every(cohort => cohort.count_basis === 'fictional_demo_allocation'))
})

test('five shared entry areas match the researched routing groups', () => {
  const expected = {
    plaza_tenggara: ['ultimate_experience', 'my_universe', 'cat1', 'cat2', 'infinity'],
    plaza_barat: ['cat3'],
    pintu_kuning: ['cat4'],
    plaza_utara: ['cat5', 'cat6', 'cat7', 'cat8'],
    plaza_timur: ['festival'],
  }
  assert.equal(scenario.entry_areas.length, 5)
  for (const [area, cohorts] of Object.entries(expected)) {
    assert.deepEqual(scenario.cohorts.filter(item => item.entry_area_id === area).map(item => item.id).sort(), cohorts.sort())
  }
})

test('Infinity destination allocation stays inside its 500-person cohort', () => {
  assert.equal(Object.values(scenario.infinity_demo_allocation.viewing_tiers).reduce((sum, value) => sum + value, 0),
    scenario.cohorts.find(cohort => cohort.id === 'infinity').expected_attendees)
})

test('every marker is explicitly a proposed coordinate and requires route authoring', () => {
  for (const area of scenario.entry_areas) {
    assert.equal(area.position_basis, 'proposed_demo_anchor')
    assert.equal(area.route_status, 'awaiting_authored_graph')
    assert.equal(area.position.length, 3)
    assert.ok(area.position.every(Number.isFinite))
    assert.equal(area.position[1], 0)
  }
})
