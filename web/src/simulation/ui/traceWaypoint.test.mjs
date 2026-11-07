import assert from 'node:assert/strict'
import test from 'node:test'
import { traceWaypoint } from './traceWaypoint.ts'

const origins = [
  { id: 'mrt', label: 'MRT', mode: 'mrt' },
  { id: 'parking', label: 'Parking', mode: 'parking' },
  { id: 'taxi', label: 'Taxi', mode: 'taxi_ride_hailing' },
]
const mrt = {
  routeNodeIds: ['mrt', 'junction', 'security', 'scan'],
  points: [[0, 0, 0], [5, 0, 1], [8, 0, 1], [12, 0, 1]],
}
const parking = {
  routeNodeIds: ['parking', 'junction', 'security', 'scan'],
  points: [[3, 0, -5], [5, 0, 1], [8, 0, 1], [12, 0, 1]],
}
const taxi = {
  routeNodeIds: ['taxi', 'junction', 'other-gate'],
  points: [[5, 0, 4], [5, 0, 1], [6, 0, 0]],
}

test('the trace counts only journeys using the selected waypoint and clips routes there', () => {
  const trace = traceWaypoint([mrt, mrt, parking, taxi], 'security', origins)
  assert.equal(trace.total, 3)
  assert.deepEqual(trace.origins.map(origin => [origin.id, origin.count]), [['mrt', 2], ['parking', 1], ['taxi', 0]])
  assert.deepEqual(trace.routes.map(line => line.points), [
    [[0, 0, 0], [5, 0, 1], [5, 0, 1], [8, 0, 1]],
    [[3, 0, -5], [5, 0, 1], [5, 0, 1], [8, 0, 1]],
  ])
  assert.ok(trace.routes.every(line => line.segments))
})

test('a shared waypoint shows all actual origins and selecting a start adds no artificial segment', () => {
  const trace = traceWaypoint([mrt, parking, taxi], 'junction', origins)
  assert.equal(trace.total, 3)
  assert.equal(trace.routes.length, 3)
  const start = traceWaypoint([mrt, parking, taxi], 'mrt', origins)
  assert.equal(start.total, 1)
  assert.deepEqual(start.routes, [])
})
