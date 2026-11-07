import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reportCosts, reportPlanChanges, reportShowtime, summarizeReportRun } from './simulationReportData.ts'

const plan = JSON.parse(readFileSync(new URL('../../../../contracts/examples/coldplay-gbk-demo-plan.json', import.meta.url)))

test('report costs keep staffing and committed rentals separate and preserve missing estimates', () => {
  const costs = reportCosts(plan)
  assert.deepEqual(costs, { headcount: 65, wages: 24250000, meals: 2925000, equipment: 5000000, total: 32175000 })
  const draft = structuredClone(plan)
  delete draft.constraints.equipment.items[0].committed_cost_idr
  assert.equal(reportCosts(draft).equipment, null)
  assert.equal(reportCosts(draft).total, null)
  assert.equal(reportShowtime(plan), '21:00')
})

test('report highlights plan inputs without treating a changed revision as a resource change', () => {
  const revised = structuredClone(plan)
  revised.spatial_context.revision++
  assert.deepEqual(reportPlanChanges(plan, revised), [])
  const first = revised.venue.layout.gates[0]
  first.lanes[0].count--
  revised.event.schedule.main_act = '21:30'
  assert.deepEqual(reportPlanChanges(plan, revised), [
    'Plaza Tenggara staffed lanes · 8 → 7.',
    'Main act · 21:00 → 21:30 WIB.',
  ])
})

test('report uses actual concurrent waiting, excludes unresolved waits from P90, and counts admissions at the main act', () => {
  const config = { timeOrigin: '2026-11-14T09:00:00+07:00', horizonSeconds: 120,
    serviceStations: [{ id: 'scan-a', admissionStage: 'scan' }, { id: 'scan-b', admissionStage: 'scan' }] }
  const makeStop = (stationId, arrivalSeconds, startSeconds, endSeconds) => ({ stationId, arrivalSeconds, startSeconds, endSeconds })
  const result = { seed: 9, generatedCount: 5, journeys: [
    { completionSeconds: 45, serviceStops: [makeStop('scan-a', 0, 30, 40)] },
    { completionSeconds: 75, serviceStops: [makeStop('scan-b', 30, 30, 40)] },
    { completionSeconds: null, serviceStops: [makeStop('scan-a', 30, null, null)] },
    { completionSeconds: 135, serviceStops: [makeStop('scan-b', 110, 115, 125)] },
    { completionSeconds: null, serviceStops: [makeStop('scan-a', 130, null, null)] },
  ] }
  assert.deepEqual(summarizeReportRun(config, result, '09:01'), {
    seed: 9, arrivals: 5, admittedByShowtime: 1, admittedByRunEnd: 2,
    p90GateWaitSeconds: 30, gateWaitSample: 2,
    checkpoints: { scan: { peak: 2, p90WaitSeconds: 30, processed: 2 } },
  })
  assert.equal(summarizeReportRun(config, result, '09:03').admittedByShowtime, null)
})
