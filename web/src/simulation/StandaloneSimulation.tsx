import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import venueJson from './venue/gbk.json'
import admissionScenario from '../../../data/scenarios/coldplay-gbk-demo.json'
import { catalogue } from './model'
import { LayoutEditor, useLayoutEditor } from './layout'
import { useAbmWorker } from './abm/useAbmWorker'
import DesRunPanel from './des/DesRunPanel'
import type { AbmConfig } from './runtime-types'
import type { EntryAreaMarker, Point, SceneView, VenuePack } from './types'

const GbkCanvas = lazy(() => import('../scene/GbkCanvas'))
const PlaybackClock = lazy(() => import('../scene/PlaybackClock'))
const CrowdPreview = lazy(() => import('./abm/CrowdPreview').then(module => ({ default: module.CrowdPreview })))
const venue = venueJson as unknown as VenuePack
const entryAreaMarkers: readonly EntryAreaMarker[] = admissionScenario.entry_areas.map(area => ({
  id: area.id,
  label: area.label,
  position: area.position as unknown as Point,
  color: area.color,
  attendees: admissionScenario.cohorts.filter(cohort => cohort.entry_area_id === area.id)
    .reduce((sum, cohort) => sum + cohort.expected_attendees, 0),
}))
const cameraViews: readonly { id: SceneView; label: string }[] = [
  { id: 'orbit', label: '360 view' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'entry', label: 'Entry gate' },
  { id: 'map', label: 'Map view' },
]

/** Full-bleed venue canvas. The dashboard can overlay its UI via SceneProps. */
export default function StandaloneSimulation() {
  const params = new URLSearchParams(location.search)
  const requestedView = params.get('view')
  const initialView = cameraViews.find(item => item.id === requestedView)?.id ?? (requestedView === 'layout' ? 'layout' : 'orbit')
  const debug = params.get('debug') === '1'
  const [view, setView] = useState<SceneView>(initialView)
  const [autoRotate, setAutoRotate] = useState(!debug)
  const [panMode, setPanMode] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showEntryAreas, setShowEntryAreas] = useState(params.get('entries') === '1')
  const [editorOpen, setEditorOpen] = useState(params.get('edit') === '1')
  const editor = useLayoutEditor({ bounds: venue.editBounds, catalogue })
  const editable = editorOpen || debug
  const [abmOpen, setAbmOpen] = useState(false)
  const [desOpen, setDesOpen] = useState(false)
  const [seed, setSeed] = useState(20261114)
  const [playing, setPlaying] = useState(false)
  const clockRef = useRef(7 * 3600)
  const [clockSeconds, setClockSeconds] = useState(clockRef.current)
  const [crowdStats, setCrowdStats] = useState<Readonly<{ visibleCount: number; walkingCount: number }>>({ visibleCount: 0, walkingCount: 0 })
  const config = useMemo<AbmConfig | null>(() => {
    if (!editor.runnableGraph) return null
    return {
      seed, timeOrigin: '2026-11-14T09:00:00+07:00',
      horizonSeconds: 14.5 * 3600, walkSpeedMps: 1.2,
      nodes: editor.runnableGraph.nodes, edges: editor.runnableGraph.edges,
      cohorts: admissionScenario.cohorts.filter(cohort => cohort.entry_area_id === 'plaza_utara').map(cohort => ({
        id: cohort.id, count: cohort.expected_attendees,
        arrivalNodeId: 'arrival', destinationNodeId: 'destination', groupSize: 2,
        windows: [
          { startSeconds: 0, endSeconds: 4 * 3600, sharePercent: 10 },
          { startSeconds: 4 * 3600, endSeconds: 6.5 * 3600, sharePercent: 30 },
          { startSeconds: 6.5 * 3600, endSeconds: 8.5 * 3600, sharePercent: 45 },
          { startSeconds: 8.5 * 3600, endSeconds: 10.5 * 3600, sharePercent: 15 },
        ],
      })),
    }
  }, [editor.runnableGraph, seed])
  const abm = useAbmWorker(config, editor.layout.revision)
  const clockLabel = `${String(9 + Math.floor(clockSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(clockSeconds / 60) % 60).padStart(2, '0')}`

  return <main className="standalone-scene">
    <Suspense fallback={<div className="scene-loading">Loading GBK…</div>}>
      <GbkCanvas venue={venue} catalogue={catalogue} placements={editor.layout.placements}
        routes={editable ? editor.graph.routes : []} nodes={editable ? editor.graph.sceneNodes : []}
        entryAreas={showEntryAreas ? entryAreaMarkers : undefined}
        view={view} autoRotate={autoRotate} panMode={panMode} showLabels={showLabels}
        onCameraInteraction={() => setAutoRotate(false)}
        debug={debug} showGuides={editable} selectedId={editable ? editor.selectedId : null}
        onSelect={editable ? editor.onSelect : () => {}}
        onMove={editable ? editor.onMove : () => {}}>
        <PlaybackClock clockRef={clockRef} playing={playing && abm.result !== null} rate={180}
          duration={14.5 * 3600} onTick={setClockSeconds} onEnd={() => setPlaying(false)} />
        {abm.result && <CrowdPreview result={abm.result} clockRef={clockRef} maxVisible={5000} onSampleStats={setCrowdStats} />}
      </GbkCanvas>
    </Suspense>
    <nav className="scene-views" aria-label="Camera view">
      {cameraViews.map(item => <button key={item.id} type="button" aria-pressed={view === item.id}
        onClick={() => { setView(item.id); setAutoRotate(item.id === 'orbit'); setPanMode(false) }}>{item.label}</button>)}
    </nav>
    <div className="scene-tools">
      {view === 'orbit' && <button type="button" aria-pressed={autoRotate} onClick={() => setAutoRotate(!autoRotate)}>{autoRotate ? 'Ⅱ Pause rotation' : '▷ Auto rotate'}</button>}
      <button type="button" aria-pressed={panMode} onClick={() => { setPanMode(!panMode); setAutoRotate(false) }}>↔ Pan</button>
      <button type="button" aria-pressed={abmOpen} onClick={() => { setAbmOpen(!abmOpen); setDesOpen(false) }}>ABM preview</button>
      <button type="button" aria-pressed={desOpen} onClick={() => { setDesOpen(!desOpen); setAbmOpen(false) }}>DES engine</button>
      <button type="button" aria-pressed={editorOpen} onClick={() => { setEditorOpen(!editorOpen); setView(!editorOpen ? 'layout' : 'entry'); setAutoRotate(false) }}>Layout editor</button>
      <button type="button" aria-pressed={showEntryAreas} onClick={() => { setShowEntryAreas(!showEntryAreas); setAutoRotate(false) }}>Entry areas</button>
      <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>Labels</button>
    </div>
    {editorOpen && <div className="layout-overlay"><LayoutEditor editor={editor} onClose={() => setEditorOpen(false)} /></div>}
    {abmOpen && <section className="simulation-overlay" aria-label="ABM preview">
      <header><strong>North entry · ABM preview</strong><button onClick={() => setAbmOpen(false)} aria-label="Close ABM preview">×</button></header>
      <p>15,500 proposed CAT 5–8 arrivals on the authored north route. The other entry-area graphs remain pending.</p>
      <label>Seed <input type="number" value={seed} onChange={event => { const value = Number(event.target.value); if (Number.isSafeInteger(value)) setSeed(value) }} /></label>
      <div className="simulation-actions"><button onClick={() => { setPlaying(false); abm.generate() }} disabled={!config || abm.status === 'running'}>{abm.status === 'running' ? 'Generating…' : 'Generate arrivals'}</button><button onClick={abm.cancel}>Clear</button></div>
      {!config && <p role="alert">Resolve the layout or graph issues before generating arrivals.</p>}
      {abm.error && <p role="alert">{abm.error}</p>}
      {abm.result && <>
        <p><strong>{abm.result.generatedCount.toLocaleString()} generated</strong> · revision {editor.layout.revision}</p>
        <div className="simulation-actions"><button onClick={() => setPlaying(!playing)}>{playing ? 'Pause walking' : 'Play walking'}</button><strong>{clockLabel} WIB</strong></div>
        <input aria-label="Simulation time" type="range" min="0" max={14.5 * 3600} step="30" value={clockSeconds} onChange={event => { const value = Number(event.target.value); clockRef.current = value; setClockSeconds(value); setPlaying(false) }} />
        <p>{crowdStats.walkingCount} walking now · {crowdStats.visibleCount} rendered · 3 simulated minutes/second</p>
        {abm.result.issues.map(issue => <p role="alert" key={issue}>{issue}</p>)}
      </>}
      <small>Fictional arrival windows, groups of two and 1.2 m/s walking. Queue and service outcomes come from DES.</small>
    </section>}
    {desOpen && <div className="simulation-overlay des-overlay"><header><strong>DES engine bridge</strong><button aria-label="Close DES engine" onClick={() => setDesOpen(false)}>×</button></header><DesRunPanel plan={null} baseSeed={seed} /></div>}
    <span className="scene-navigation">Drag to {panMode || view === 'map' || view === 'isometric' ? 'pan' : 'orbit'} · scroll to zoom · right-drag to pan</span>
    <a className="scene-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · Illustrative structures and event layout</a>
  </main>
}
