import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import LayoutInspector from './editor/LayoutInspector'
import venueJson from './venue/gbk.json'
import { buildRoutes } from './route'
import { catalogue, checkLanes, initialDraft, placementIssue, restoreDraft, type Draft } from './model'
import type { Placement, SceneView, VenuePack } from './types'

const GbkCanvas = lazy(() => import('../scene/GbkCanvas'))
const venue = venueJson as unknown as VenuePack
const STORAGE = 'opsidio-gbk-workspace-v1'

export default function SimulationWorkspace({ scenarioId = 'coldplay-gbk-2023' }: { scenarioId?: string }) {
  const [draft, setDraft] = useState<Draft>(() => {
    try { return restoreDraft(localStorage.getItem(STORAGE)) } catch { return initialDraft() }
  })
  const [selectedId, setSelectedId] = useState<string | null>('scan_tent')
  const [view, setView] = useState<SceneView>('orbit')
  const [message, setMessage] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  const route = useMemo(() => buildRoutes(draft.placements, catalogue), [draft.placements])
  const laneCheck = checkLanes(draft.placements, draft.lanePlan)
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(draft)) }
    catch { setMessage('Browser storage is unavailable. Export the layout to keep your edits.') }
  }, [draft])

  const update = (next: Placement) => {
    const issue = placementIssue(next, draft.placements, venue.editBounds)
    if (issue) { setMessage(issue); return }
    setDraft(current => ({ ...current, revision: current.revision + 1, placements: current.placements.map(p => p.id === next.id ? next : p) }))
    setMessage(`${next.label} updated. Route recalculated for revision ${draft.revision + 1}.`)
  }
  const add = (presetId: string) => {
    const preset = catalogue.find(p => p.id === presetId)!
    const next: Placement = { id: crypto.randomUUID(), label: preset.name, presetId, position: [25, 0, -275], yawDeg: 0, ...(preset.kind === 'roder' ? { bays: 2 } : {}) }
    for (let x = 25; x <= 45; x += 5) {
      for (let z = -280; z <= -200; z += 10) {
        next.position = [x, 0, z]
        if (!placementIssue(next, draft.placements, venue.editBounds)) {
          setDraft(current => ({ ...current, revision: current.revision + 1, placements: [...current.placements, { ...next }] }))
          setSelectedId(next.id); setView('layout'); setMessage('Equipment added. Select a position or edit its coordinates.'); return
        }
      }
    }
    setMessage('There is no free position in the add area. Move or remove an item first.')
  }
  const exportLayout = () => {
    const payload = {
      schema_version: 'opsidio-spatial-preview/1', scenario_id: scenarioId, venue_id: venue.id,
      revision: draft.revision, basis: 'fictional_operations_scenario', layout: draft,
      catalogue_version: 'research-v1', catalogue, nodes: route.nodes, edges: route.edges,
      route_distance_m: route.distanceM, nominal_walk_seconds: route.walkSeconds,
      lane_check: laneCheck, runnable: laneCheck.valid && route.issues.length === 0,
      assumptions: { walk_speed_mps: 1.2, clear_lane_width_m: 1.2, crew_per_scan_lane: 1,
        mapped_ground: true, temporary_layout: 'fictional', operational_results: 'pending_engine_integration' },
      issues: [...route.issues, ...laneCheck.limiting],
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `opsidio-gbk-r${draft.revision}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(`Exported revision ${draft.revision} with geometry, sources, and feasibility checks.`)
  }

  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="/simulation"><span className="brand-mark">o</span><strong>opsidio</strong><span className="brand-divider" />Simulation workspace</a>
      <div className="header-meta"><span className="live-dot" />Local prototype<span className="revision">REV {String(draft.revision).padStart(2, '0')}</span></div>
    </header>
    <section className="projectbar">
      <div><div className="breadcrumb">GBK / PLAZA UTARA / ADMISSION PLANNING</div><h1>One entry. Every moving part.</h1><p>Coldplay Jakarta 2023 <span>·</span> Fictional operations scenario</p></div>
      <div className="project-actions"><button onClick={() => setDetails(!details)}>About this model</button><button onClick={() => { setDraft(initialDraft()); setSelectedId('scan_tent'); setMessage('Restored the prepared baseline.'); }}>Reset layout</button><button className="primary" onClick={exportLayout} disabled={route.issues.length > 0}>Export layout <span>↗</span></button></div>
    </section>
    {details && <section className="model-note"><strong>Mapped ground. Proposed event layout.</strong> The GBK footprint and surrounding features come from OpenStreetMap. The stadium heights, equipment placements, north working envelope, staffing, and arrivals are illustrative. The work envelope includes mapped landscaping. Walking time assumes 1.2 m/s and excludes queue and service time. The current build provides a geometric route preview. Doni’s operational simulator is pending integration. <a href="https://www.pk-ent.com/news/coldplay-music-of-the-spheres-world-tour" target="_blank" rel="noreferrer">Event source ↗</a></section>}
    <main className="workbench">
      <div className="map-column">
        <div className="map-toolbar"><div className="view-switch" role="group" aria-label="Camera view"><button className={view === 'orbit' ? 'active' : ''} onClick={() => setView('orbit')}>◇ Venue overview</button><button className={view === 'layout' ? 'active' : ''} onClick={() => setView('layout')}>⊞ Edit layout</button></div><span className="map-hint">{view === 'orbit' ? 'Drag to orbit · scroll to zoom' : 'Select equipment, then click ground to move'}</span></div>
        <div className="canvas-panel">
          <Suspense fallback={<div className="loading">Building the venue view…</div>}><GbkCanvas venue={venue} catalogue={catalogue} placements={draft.placements} routes={route.routes} nodes={route.nodes} view={view} selectedId={selectedId} onSelect={id => { setSelectedId(id); setMessage(null) }} onMove={(id, position) => { const p = draft.placements.find(p => p.id === id); if (p) update({ ...p, position: [Math.round(position[0] * 10) / 10, 0, Math.round(position[2] * 10) / 10] }) }} /></Suspense>
          <div className="map-title"><span className="map-tag">VENUE MODEL</span><strong>Stadion Utama GBK</strong><small>Real footprint · illustrative structure</small></div>
          <div className="north"><strong>N</strong><span>↑</span></div>
          <div className="map-legend"><span><i className="line-entry" />Entry route</span><span><i className="line-help" />Ticket exceptions</span><span>1 unit = 1 metre</span></div>
          <a className="attribution" href={venue.sourceUrl} target="_blank" rel="noreferrer">{venue.attribution}</a>
        </div>
        <div className="metric-strip">
          <div><span>ENTRY ROUTE</span><strong>{route.distanceM === null ? 'Blocked' : `${route.distanceM.toFixed(1)}`}<small>{route.distanceM !== null && ' m'}</small></strong><p>Updates with the layout</p></div>
          <div><span>NOMINAL WALK</span><strong>{route.walkSeconds === null ? '—' : (route.walkSeconds / 60).toFixed(1)}<small> min</small></strong><p>Assumed speed · 1.2 m/s</p></div>
          <div><span>SCAN LANES</span><strong>{draft.lanePlan.planned}<small> / {laneCheck.feasible} feasible</small></strong><p>{laneCheck.valid ? 'Room, scanners and crew checked' : 'Resolve the capacity constraint'}</p></div>
          <div><span>OPERATIONAL RESULTS</span><strong className="pending">Pending</strong><p>Awaiting a matching engine run</p></div>
        </div>
        {route.issues.length > 0 && <div className="route-warning" role="alert"><strong>Route needs attention</strong>{route.issues.map(issue => <p key={issue}>{issue}</p>)}</div>}
        <div className="scenario-footer"><div><span className="tiny-square" /><strong>Prepared baseline</strong><span>One north admission corridor</span></div><span>Layout and resource assumptions are editable.</span></div>
      </div>
      <LayoutInspector catalogue={catalogue} placements={draft.placements} selectedId={selectedId} lanePlan={draft.lanePlan} laneCheck={laneCheck} message={message} onSelect={setSelectedId} onChange={update} onAdd={add} onRemove={id => { setDraft(current => ({ ...current, revision: current.revision + 1, placements: current.placements.filter(p => p.id !== id) })); setSelectedId(null); setMessage('Equipment removed. Route and capacity recalculated.') }} onLanePlanChange={lanePlan => { if (Object.values(lanePlan).some(v => !Number.isInteger(v) || v < 0 || v > 100)) { setMessage('Lane inputs must be whole numbers from 0 to 100.'); return } setDraft(current => ({ ...current, revision: current.revision + 1, lanePlan })) }} />
    </main>
  </div>
}
