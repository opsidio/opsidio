import { lazy, Suspense, useMemo, useRef, useState, type ChangeEvent } from 'react'
import venueJson from './venue/gbk.json'
import demoPlan from '../../../contracts/examples/coldplay-gbk-demo-plan.json'
import { catalogue } from './model'
import { LayoutEditor, useLayoutEditor } from './layout'
import { useAbmWorker } from './abm/useAbmWorker'
import { compileSimulationPlan, projectNorthLayout } from './plan/compile'
import { createConfigHash } from './abm/worker-protocol'
import OptimizationPanel from './des/OptimizationPanel'
import { prepareJourneySampler, type CrowdSampleStats } from './abm/sampling'
import type { Point, RouteLine, SceneView, VenuePack } from './types'

const GbkCanvas = lazy(() => import('../scene/GbkCanvas'))
const PlaybackClock = lazy(() => import('../scene/PlaybackClock'))
const CrowdPreview = lazy(() => import('./abm/CrowdPreview').then(module => ({ default: module.CrowdPreview })))
const OperationsLayer = lazy(() => import('../scene/OperationsLayer'))
const OperatorQueueBars = lazy(() => import('../scene/OperatorQueueBars'))
const ArrivalOrigins = lazy(() => import('../scene/ArrivalOrigins'))
const venue = venueJson as unknown as VenuePack
const cameraViews: readonly { id: SceneView; label: string }[] = [
  { id: 'orbit', label: '360 view' }, { id: 'isometric', label: 'Isometric' },
  { id: 'entry', label: 'Entry gate' }, { id: 'map', label: 'Map view' },
]

export default function StandaloneSimulation() {
  const [source, setSource] = useState<unknown>(demoPlan)
  const [version, setVersion] = useState(1)
  const loadPlan = (next: unknown) => {
    compileSimulationPlan(next)
    setSource(next)
    setVersion(current => current + 1)
  }
  return <SimulationWorkspace key={version} source={source} onLoad={loadPlan} />
}

function SimulationWorkspace({ source, onLoad }: { source: unknown; onLoad: (plan: unknown) => void }) {
  const base = useMemo(() => compileSimulationPlan(source), [source])
  const storageKey = useMemo(() => `opsidio-v1:${base.layoutId}:${createConfigHash(source)}`, [base.layoutId, source])
  const editor = useLayoutEditor({ bounds: venue.editBounds, catalogue, initialLayout: base.northLayout, storageKey })
  const resolved = useMemo(() => {
    try {
      if (JSON.stringify(editor.layout) === JSON.stringify(base.northLayout)) {
        return { plan: source, compiled: base, error: null }
      }
      const plan = projectNorthLayout(source, editor.layout)
      return { plan, compiled: compileSimulationPlan(plan), error: null }
    } catch (error) {
      return { plan: source, compiled: base, error: error instanceof Error ? error.message : 'The layout cannot be compiled.' }
    }
  }, [source, editor.layout, base])
  const compiled = resolved.compiled
  const params = new URLSearchParams(location.search)
  const requestedView = params.get('view')
  const [view, setView] = useState<SceneView>(cameraViews.find(item => item.id === requestedView)?.id ?? 'orbit')
  const debug = params.get('debug') === '1'
  const [autoRotate, setAutoRotate] = useState(!debug)
  const [panMode, setPanMode] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showOperations, setShowOperations] = useState(true)
  const [showRoutes, setShowRoutes] = useState(debug)
  const [editorOpen, setEditorOpen] = useState(params.get('edit') === '1')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [focusPosition, setFocusPosition] = useState<Point>([12, 0, -260])
  const [focusYawDeg, setFocusYawDeg] = useState(0)
  const [seed, setSeed] = useState(base.config.seed)
  const [playing, setPlaying] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const clockRef = useRef(7 * 3600)
  const [clockSeconds, setClockSeconds] = useState(clockRef.current)
  const [crowdStats, setCrowdStats] = useState<CrowdSampleStats>({ visibleCount: 0, walkingCount: 0 })
  const config = useMemo(() => editor.runnableGraph && !resolved.error ? { ...compiled.config, seed } : null, [compiled, seed, editor.runnableGraph, resolved.error])
  const abm = useAbmWorker(config, editor.layout.revision)
  const sampler = useMemo(() => abm.result ? prepareJourneySampler(abm.result.journeys) : null, [abm.result])
  const total = compiled.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0)
  const behaviorCohorts = useMemo(() => new Set(compiled.config.cohorts.map(cohort => JSON.stringify([cohort.categoryId ?? cohort.id, cohort.segmentId]))).size, [compiled])
  const originClock = Number(compiled.config.timeOrigin.slice(11, 13)) * 3600 + Number(compiled.config.timeOrigin.slice(14, 16)) * 60
  const localClock = (originClock + clockSeconds) % 86400
  const clockLabel = `${String(Math.floor(localClock / 3600)).padStart(2, '0')}:${String(Math.floor(localClock / 60) % 60).padStart(2, '0')}`
  const guides = editorOpen || showRoutes
  const routes = useMemo<RouteLine[]>(() => {
    const nodes = new Map(compiled.nodes.map(node => [node.id, node]))
    const entry: Point[] = [], exception: Point[] = [], connector: Point[] = []
    for (const edge of compiled.edges) {
      const points = edge.basis?.startsWith('proposed') ? connector : edge.id.includes('help') ? exception : entry
      points.push(nodes.get(edge.from)!.position, nodes.get(edge.to)!.position)
    }
    return [
      { id: 'entry-network', kind: 'entry', points: entry, segments: true },
      { id: 'exception-network', kind: 'exception', points: exception, segments: true },
      { id: 'proposed-connectors', kind: 'connector', points: connector, segments: true },
    ]
  }, [compiled])
  function focusPoint(position: Point, yawDeg = 0) {
    setFocusPosition(position)
    setFocusYawDeg(yawDeg)
    setView('entry')
    setAutoRotate(false)
  }
  function focus(areaId: string) {
    const area = compiled.entryAreas.find(item => item.id === areaId)
    const scanId = areaId === 'plaza_utara' ? 'scan_tent' : `${areaId}_scan_tent`
    const scan = compiled.placements.find(placement => placement.id === scanId)
    if (area) focusPoint(area.position, scan?.yawDeg)
  }
  function runLocal() {
    clockRef.current = Math.min(compiled.config.horizonSeconds, 8 * 3600 + 40 * 60)
    setClockSeconds(clockRef.current)
    setPreviewOpen(true)
    setOptimizeOpen(false)
    setShowRoutes(true)
    setPlaying(true)
    abm.generate()
  }
  async function importPlan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      if (file.size > 1_048_576) throw new Error('Choose a plan smaller than 1 MB.')
      onLoad(JSON.parse(await file.text()))
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Cannot read this plan.') }
  }
  function exportPlan() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(resolved.plan, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'opsidio-gbk-v1.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="standalone-scene">
    <Suspense fallback={<div className="scene-loading">Loading GBK…</div>}>
      <GbkCanvas venue={venue} catalogue={catalogue} placements={compiled.placements}
        routes={guides ? routes : []} nodes={guides ? compiled.nodes.filter(node => editorOpen ? node.entryAreaId === 'plaza_utara' : node.role !== 'waypoint' && node.entryAreaId !== 'shared_origins').map(node => ({ ...node, label: node.id })) : []}
        view={view} focusPosition={focusPosition} focusYawDeg={focusYawDeg} autoRotate={autoRotate} panMode={panMode} showLabels={showLabels}
        onCameraInteraction={() => setAutoRotate(false)} debug={debug} showGuides={guides}
        selectedId={guides ? editor.selectedId : null} onSelect={guides ? editor.onSelect : () => {}} onMove={guides ? editor.onMove : () => {}}>
        <PlaybackClock clockRef={clockRef} playing={playing && abm.result !== null} rate={180} duration={compiled.config.horizonSeconds} onTick={setClockSeconds} onEnd={() => setPlaying(false)} />
        <Suspense fallback={null}>
          {abm.result && sampler && <CrowdPreview result={abm.result} sampler={sampler} clockRef={clockRef} maxVisible={5000} visualSpreadM={0.1} onSampleStats={setCrowdStats} />}
          {sampler && showOperations && <OperatorQueueBars sampler={sampler} operators={compiled.operators} clockRef={clockRef} showLabels={showLabels} />}
        </Suspense>
        {showOperations && <OperationsLayer operators={compiled.operators} placements={compiled.placements} catalogue={catalogue} entryAreas={compiled.entryAreas} showLabels={showLabels} />}
        {compiled.arrivalOrigins.length > 0 && <ArrivalOrigins origins={compiled.arrivalOrigins} showLabels={showLabels} />}
      </GbkCanvas>
    </Suspense>
    <nav className="scene-views" aria-label="Camera view">
      {cameraViews.map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => { setView(item.id); setAutoRotate(item.id === 'orbit'); setPanMode(false) }}>{item.label}</button>)}
    </nav>
    <div className="scene-tools">
      {view === 'orbit' && <button aria-pressed={autoRotate} onClick={() => setAutoRotate(!autoRotate)}>{autoRotate ? 'Ⅱ Pause rotation' : '▷ Auto rotate'}</button>}
      <button aria-pressed={panMode} onClick={() => { setPanMode(!panMode); setAutoRotate(false) }}>↔ Pan</button>
      <button onClick={runLocal} disabled={!config || abm.status === 'running'}>{abm.status === 'running' ? 'Generating…' : 'Run V1 locally'}</button>
      <button aria-pressed={showOperations} onClick={() => setShowOperations(!showOperations)}>Operators & equipment</button>
      <button aria-pressed={showRoutes} onClick={() => setShowRoutes(!showRoutes)}>Routes</button>
      <button onClick={() => focus('plaza_utara')}>Focus North layout</button>
      <button aria-pressed={editorOpen} onClick={() => { setEditorOpen(!editorOpen); setFocusPosition([12, 0, -260]); setFocusYawDeg(0); setView(!editorOpen ? 'layout' : 'entry'); setAutoRotate(false) }}>Layout editor</button>
      <button aria-pressed={optimizeOpen} onClick={() => { setOptimizeOpen(!optimizeOpen); setPreviewOpen(false) }}>Optimize via Doni</button>
      <button aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>Labels</button>
    </div>
    <div className="operations-focus" aria-label="Entry area close-ups">
      {compiled.entryAreas.map(area => <button key={area.id} onClick={() => focus(area.id)}>{area.label}</button>)}
      {compiled.arrivalOrigins.map(origin => <button className="origin-shortcut" key={origin.id} onClick={() => focusPoint(origin.position)}>{origin.mode === 'mrt' ? 'MRT origin' : origin.mode === 'parking' ? 'Parking origin' : 'Drop-off origin'}</button>)}
    </div>
    {editorOpen && <div className="layout-overlay"><LayoutEditor editor={editor} onClose={() => setEditorOpen(false)} /></div>}
    {previewOpen && <section className="simulation-overlay" aria-label="Local V1 simulation">
      <header><strong>V1 · local simulation</strong><button onClick={() => setPreviewOpen(false)} aria-label="Close simulation">×</button></header>
      <p>{total.toLocaleString()} planned arrivals · {compiled.entryAreas.length} entry areas · {compiled.operators.length} staff</p>
      <details><summary>{behaviorCohorts} category × behavior cohorts</summary>{compiled.segments.map(segment => <p key={segment.id}>{segment.label} · {segment.attendees.toLocaleString()}</p>)}</details>
      {compiled.arrivalOrigins.length > 0 && <details><summary>{compiled.arrivalOrigins.length} transport origins</summary>{compiled.arrivalOrigins.map(origin => <p key={origin.id}>{origin.label} · {origin.attendees.toLocaleString()}</p>)}</details>}
      <label>Seed <input type="number" value={seed} onChange={event => { const value = Number(event.target.value); if (Number.isSafeInteger(value)) setSeed(value) }} /></label>
      {abm.error && <p role="alert">{abm.error}</p>}
      {resolved.error && <p role="alert">{resolved.error}</p>}
      {!editor.runnableGraph && <p role="alert">Resolve the North layout errors before running.</p>}
      {abm.result && <>
        <p><strong>{abm.result.generatedCount.toLocaleString()} generated from JSON</strong> · revision {editor.layout.revision}</p>
        <div className="simulation-actions"><button onClick={() => setPlaying(!playing)}>{playing ? 'Pause playback' : 'Play playback'}</button><strong>{clockLabel} WIB</strong></div>
        <input aria-label="Simulation time" type="range" min="0" max={compiled.config.horizonSeconds} step="30" value={clockSeconds} onChange={event => { const value = Number(event.target.value); clockRef.current = value; setClockSeconds(value); setPlaying(false) }} />
        <p>{crowdStats.walkingCount.toLocaleString()} walking · {(crowdStats.waitingCount ?? 0).toLocaleString()} queued · {crowdStats.processingCount ?? 0} processing</p><p>{(crowdStats.completedCount ?? 0).toLocaleString()} admitted · {crowdStats.visibleCount.toLocaleString()} rendered</p>
        {abm.result.issues.map(issue => <p role="alert" key={issue}>{issue}</p>)}
      </>}
      <div className="simulation-actions"><button onClick={exportPlan} disabled={!!resolved.error}>Export V1 JSON</button><button onClick={() => { setPlaying(false); abm.cancel() }}>Clear preview</button></div>
      <label>Load plan JSON<input aria-label="Load simulation plan JSON" type="file" accept=".json,application/json" onChange={importPlan} /></label>
      {importError && <p role="alert">{importError}</p>}
      <small>Fictional operations and arrival assumptions. Local queues use fixed typical process times. The front 32 people per queue are rendered. Optimize sends the current plan to Doni’s API.</small>
    </section>}
    <div className="simulation-overlay" hidden={!optimizeOpen}><header><strong>Optimize V1</strong><button aria-label="Close optimization" onClick={() => setOptimizeOpen(false)}>×</button></header><OptimizationPanel plan={resolved.plan} baseSeed={seed} disabled={!config} onLoad={onLoad} /></div>
    <div className="operations-legend"><span style={{ color: '#2867d5' }}>● Scan operators</span><span style={{ color: '#cd493d' }}>● Security</span><span style={{ color: '#188565' }}>● Help</span><span style={{ color: '#359c9b' }}>● Processing</span><span>Queue wait</span><span className="queue-wait-gradient" aria-label="Wait color from yellow to red" /><small>0 · 5 · 15+ min</small><span>Bar height · queue size</span>{routes[2].points.length > 0 && <span style={{ color: '#8c64b6' }}>┅ Proposed connector</span>}<small>Fictional V1 layout</small></div>
    <span className="scene-navigation">Drag to {panMode || ['map', 'isometric', 'layout'].includes(view) ? 'pan' : 'orbit'} · scroll to zoom</span>
    <a className="scene-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · Illustrative structures and event layout</a>
  </main>
}
