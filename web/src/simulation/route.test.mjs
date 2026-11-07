import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRoutes } from './route.ts'

// Run with: node --experimental-strip-types --test web/src/simulation/route.test.mjs
const catalogue = [
  { id: 'roder', name: 'Roder', kind: 'roder', widthM: 10, depthM: 10, bayLengthM: 5, heightM: 5, sourceUrl: '' },
  { id: 'pagoda', name: 'Pagoda', kind: 'pagoda', widthM: 3, depthM: 3, heightM: 3, sourceUrl: '' },
  { id: 'panel', name: 'Queue panel', kind: 'rowing', widthM: 2.3, depthM: 0.45, heightM: 1, sourceUrl: '' },
  { id: 'table', name: 'Table', kind: 'table', widthM: 1.8, depthM: 0.6, heightM: 0.75, sourceUrl: '' },
  { id: 'wide-table', name: 'Wide test obstacle', kind: 'table', widthM: 10, depthM: 0.4, heightM: 0.75, sourceUrl: '' },
]
const placement = (id, presetId, x, z, yawDeg = 0) => ({ id, label: id, presetId, position: [x, 0, z], yawDeg })
const baseline = [
  { ...placement('scan_tent', 'roder', 12, -275), bays: 2 },
  { ...placement('security_tent', 'roder', 12, -228), bays: 2 },
  placement('help_tent', 'pagoda', 18, -258),
  placement('help_table', 'table', 18, -258.7),
  ...[7.85, 9.51, 11.17, 12.83, 14.49, 16.15].flatMap((x, lane) =>
    [-299.85, -297.55, -295.25].map((z, row) => placement(`queue-${lane}-${row}`, 'panel', x, z, 90))),
]

test('baseline follows the middle lane, visits checkpoints in order, and excludes help distance', () => {
  const preview = buildRoutes(baseline, catalogue)
  assert.deepEqual(preview.issues, [])
  assert.equal(preview.distanceM, 141)
  assert.equal(preview.walkSeconds, 117.5)
  assert.deepEqual(preview.edges.filter(edge => edge.to !== 'help_tent').map(edge => [edge.from, edge.to]), [
    ['arrival', 'queue'], ['queue', 'queue-exit'], ['queue-exit', 'scan_tent'],
    ['scan_tent', 'north-walkway'], ['north-walkway', 'security_tent'],
    ['security_tent', 'entry-approach'], ['entry-approach', 'destination'],
  ])
  const help = preview.routes.find(route => route.kind === 'exception')
  assert.ok(help)
  assert.deepEqual(help.points[0], [12, 0, -275])
  assert.ok(help.points[1][2] < -260)
  assert.ok(preview.edges.reduce((sum, edge) => sum + edge.distanceM, 0) > preview.distanceM)
})

test('moving scan updates geometry and distance after clearing the fixed queue exit', () => {
  const preview = buildRoutes(baseline.map(item => item.id === 'scan_tent'
    ? { ...item, position: [20, 0, -275] } : item), catalogue)
  assert.deepEqual(preview.issues, [])
  assert.ok(preview.distanceM > 141)
  assert.deepEqual(preview.routes.find(route => route.id === 'entry:queue-exit:scan_tent').points,
    [[12, 0, -293.5], [20, 0, -275]])
})

test('a missing required checkpoint cannot silently bypass it', () => {
  const preview = buildRoutes(baseline.filter(item => item.id !== 'scan_tent'), catalogue)
  assert.equal(preview.distanceM, null)
  assert.equal(preview.walkSeconds, null)
  assert.ok(preview.issues.some(issue => issue.includes('scan_tent') && issue.includes('missing')))
  assert.ok(!preview.edges.some(edge => edge.from === 'queue-exit'))
})

test('help is optional and never lies on the main route', () => {
  const preview = buildRoutes(baseline.filter(item => item.id !== 'help_tent'), catalogue)
  assert.deepEqual(preview.issues, [])
  assert.equal(preview.distanceM, 141)
  assert.ok(preview.routes.every(route => route.kind === 'entry'))
})

test('a solid obstacle blocks a required segment and suppresses totals', () => {
  const preview = buildRoutes([...baseline, placement('blocker', 'table', 12, -289)], catalogue)
  assert.equal(preview.distanceM, null)
  assert.equal(preview.walkSeconds, null)
  assert.ok(preview.issues.some(issue => issue.includes('blocked by blocker')))
  assert.ok(!preview.edges.some(edge => edge.from === 'queue-exit' && edge.to === 'scan_tent'))
})

test('rotated solid footprints use their actual orientation', () => {
  const across = buildRoutes([...baseline, placement('wide', 'wide-table', 16, -285)], catalogue)
  const along = buildRoutes([...baseline, placement('wide', 'wide-table', 16, -285, 90)], catalogue)
  assert.equal(across.distanceM, null)
  assert.equal(along.distanceM, 141)
  assert.deepEqual(along.issues, [])
})

test('a blocked help branch reports its issue without invalidating complete entry totals', () => {
  const preview = buildRoutes([...baseline, placement('help-blocker', 'table', 15, -267)], catalogue)
  assert.equal(preview.distanceM, 141)
  assert.ok(preview.issues.some(issue => issue.includes('Help desk approach') && issue.includes('blocked')))
  assert.ok(preview.routes.every(route => route.kind === 'entry'))
})

test('an out-of-bounds checkpoint suppresses entry totals', () => {
  const preview = buildRoutes(baseline.map(item => item.id === 'scan_tent'
    ? { ...item, position: [60, 0, -275] } : item), catalogue)
  assert.equal(preview.distanceM, null)
  assert.ok(preview.issues.some(issue => issue.includes('routing bounds')))
})

test('unknown, malformed and duplicate geometry cannot return checked routes', () => {
  for (const extra of [placement('unknown', 'missing', 10, -280),
    placement('malformed', 'table', NaN, -280), baseline[0]]) {
    const preview = buildRoutes([...baseline, extra], catalogue)
    assert.equal(preview.distanceM, null)
    assert.equal(preview.walkSeconds, null)
    assert.deepEqual(preview.routes, [])
    assert.ok(preview.issues.length > 0)
  }
})

test('results are deterministic across placement order and do not mutate input', () => {
  const before = structuredClone(baseline)
  const result = buildRoutes(baseline, catalogue)
  assert.deepEqual(buildRoutes([...baseline].reverse(), catalogue), result)
  assert.deepEqual(baseline, before)
})
