import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import venueJson from './venue/gbk.json'
import demoPlan from '../../../contracts/examples/coldplay-gbk-demo-plan.json'
import { catalogue } from './model'
import { LayoutEditor, useLayoutEditor } from './layout'
import { useAbmWorker } from './abm/useAbmWorker'
import { compileSimulationPlan } from './plan/compile'
import GateInputsPanel from './plan/GateInputsPanel'
import { applyGateInputs, editableGates, type GateInputs } from './plan/operatingInputs'
import { createPlanEditorLayout, planEditorOptions, projectPlanEditorLayout } from './layout/planAdapter'
import type { EditorArea } from './layout/core'
import { readEventBaseline, useSimulationVersions } from './ui/useSimulationVersions'
import SimulationVersions from './ui/SimulationVersions'
import CorridorOptimizationPanel from './ui/CorridorOptimizationPanel'
import EntranceExpansionPanel from './ui/EntranceExpansionPanel'
import { applyCorridorCandidate, projectCorridorPlan } from './des/corridorPlan'
import { createConfigHash } from './abm/worker-protocol'
import SimulationControls, { SimulationMapControls } from './ui/SimulationControls'
import SimulationReport from './ui/SimulationReport'
import WaypointTrace, { waypointLabel } from './ui/WaypointTrace'
import { traceWaypoint } from './ui/traceWaypoint'
import FirstPersonPanel from './ui/FirstPersonPanel'
import AdmissionFootprints, { admissionFootprints } from '../scene/AdmissionFootprints'
import FirstPersonFollow, { pickVisibleJourney, type FirstPersonStatus } from '../scene/FirstPersonFollow'
import { SimulationDrawer, SimulationToolbar, type SimulationTool } from './ui/SimulationChrome'
import { prepareJourneySampler, type CrowdSampleStats } from './abm/sampling'
import type { Point, RouteLine, RouteNode, SceneView, VenuePack } from './types'

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

type VersionCatalog = ReturnType<typeof useSimulationVersions>
type GateDraft = { edits: Record<string, GateInputs>; revision: number }

function readInputDraft(key: string): { gates: GateDraft; seed?: number } {
  const fallback = { gates: { edits: {}, revision: 0 } }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const value = JSON.parse(raw) as { gates?: GateDraft; seed?: number }
    const gates = value?.gates
    if (!gates?.edits || Array.isArray(gates.edits) || !Number.isSafeInteger(gates.revision) || gates.revision < 0) return fallback
    if (!Object.values(gates.edits).every(item => item && Number.isSafeInteger(item.lanes) && typeof item.opens === 'string' && typeof item.closes === 'string')) return fallback
    return { gates, ...(Number.isSafeInteger(value.seed) ? { seed: value.seed } : {}) }
  } catch { return fallback }
}

function editorUrl(id: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('version', id)
  url.searchParams.set('edit', '1')
  url.searchParams.delete('canvas')
  return url
}

export default function StandaloneSimulation() {
  const [{ eventId, baseline, error }] = useState(() => {
    const id = new URLSearchParams(location.search).get('event')
    if (!id) return { eventId: undefined, baseline: demoPlan, error: null }
    try {
      const plan = readEventBaseline(id)
      if (!plan) throw new Error('Open this event’s simulation from its plan in this browser.')
      compileSimulationPlan(plan)
      return { eventId: id, baseline: plan, error: null }
    } catch {
      return { eventId: id, baseline: null, error: 'Open this event’s simulation from its plan in this browser.' }
    }
  })
  if (error) return <main className="standalone-scene simulation-theme"><div className="scene-loading">
    <p>{error}</p><a href="/">Open dashboard</a>
  </div></main>
  return <VersionedWorkspace baseline={baseline} eventId={eventId} />
}

function VersionedWorkspace({ baseline, eventId }: { baseline: unknown; eventId?: string }) {
  const catalog = useSimulationVersions(baseline, eventId)
  const requested = new URLSearchParams(location.search).get('version')
  if (eventId && requested && requested !== catalog.selected.id) return <main className="standalone-scene simulation-theme"><div className="scene-loading">
    <p>This event version is unavailable in this browser.</p><a href={`/events/${encodeURIComponent(eventId)}/review`}>Back to plan</a>
  </div></main>
  return <SimulationWorkspace key={catalog.selected.id} catalog={catalog} eventId={eventId} />
}

function SimulationWorkspace({ catalog, eventId }: { catalog: VersionCatalog; eventId?: string }) {
  const version = catalog.selected
  const source = version.plan
  const base = useMemo(() => compileSimulationPlan(source), [source])
  const editOptions = useMemo(() => planEditorOptions(source), [source])
  const initialLayout = useMemo(() => createPlanEditorLayout(source), [source])
  const editor = useLayoutEditor({ ...editOptions, catalogue, initialLayout, storageKey: version.layoutStorageKey })
  const gateOptions = useMemo(() => editableGates(source), [source])
  const draftKey = `${version.layoutStorageKey}:inputs`
  const [savedInputs] = useState(() => readInputDraft(draftKey))
  const [gateDraft, setGateDraft] = useState<GateDraft>(savedInputs.gates)
  const [seed, setSeed] = useState(savedInputs.seed ?? base.config.seed)
  const [useDraft, setUseDraft] = useState(false)
  const [versionNotice, setVersionNotice] = useState<string | null>(null)
  const hasDraft = editor.layout !== initialLayout || Object.keys(gateDraft.edits).length > 0 || seed !== base.config.seed
  useEffect(() => {
    try { window.localStorage.setItem(draftKey, JSON.stringify({ gates: gateDraft, seed })) } catch { /* Snapshots can still be exported. */ }
  }, [draftKey, gateDraft, seed])
  const oneWayAdmission = (source as { spatial_context?: { one_way_admission?: boolean } }).spatial_context?.one_way_admission === true
  const saved = useMemo(() => ({ plan: source, authoredPlan: source, compiled: base, error: null }), [source, base])
  const draft = useMemo(() => {
    if (!hasDraft) return saved
    try {
      const layoutPlan = editor.layout === initialLayout ? source : projectPlanEditorLayout(source, editor.layout)
      let plan = applyGateInputs(layoutPlan, gateDraft.edits, gateDraft.revision)
      if (seed !== base.config.seed) {
        const seeded = structuredClone(plan) as { spatial_context: { playback: { seed: number } } }
        seeded.spatial_context.playback.seed = seed
        plan = seeded
      }
      return { plan, authoredPlan: layoutPlan, compiled: compileSimulationPlan(plan), error: null }
    } catch (error) {
      return { ...saved, error: error instanceof Error ? error.message : 'The draft cannot be compiled.' }
    }
  }, [hasDraft, saved, source, editor.layout, initialLayout, base.config.seed, gateDraft, seed])
  const resolved = useDraft ? draft : saved
  const compiled = resolved.compiled
  const [corridorGate, setCorridorGate] = useState('proposed_gate_plaza_timur')
  const corridorGates = useMemo(() => {
    const capacity = new Map(editableGates(resolved.authoredPlan).map(gate => [gate.id, gate.maxLanes]))
    return editableGates(resolved.plan).flatMap(gate => {
      const maxLanes = capacity.get(gate.id)
      return maxLanes && gate.lanes <= maxLanes ? [{ ...gate, maxLanes }] : []
    })
  }, [resolved.plan, resolved.authoredPlan])
  const corridorKey = useMemo(() => `${version.id}:${createConfigHash(resolved.plan)}:${createConfigHash(resolved.authoredPlan)}`, [version.id, resolved.plan, resolved.authoredPlan])
  const expansionGates = useMemo(() => editableGates(resolved.plan), [resolved.plan])
  const [expansionPreview, setExpansionPreview] = useState<{ key: string; lanes: number; plan: unknown } | null>(null)
  const expansionGateId = expansionGates.some(gate => gate.id === corridorGate) ? corridorGate : expansionGates[0]?.id ?? ''
  const expansionKey = `${corridorKey}:${expansionGateId}`
  const preview = expansionPreview?.key === expansionKey ? expansionPreview : null
  const scenePlan = preview?.plan ?? resolved.plan
  const scene = useMemo(() => scenePlan === resolved.plan ? compiled : compileSimulationPlan(scenePlan), [scenePlan, resolved.plan, compiled])
  const footprints = useMemo(() => admissionFootprints(scenePlan), [scenePlan])
  const params = new URLSearchParams(location.search)
  const requestedView = params.get('view')
  const canvasOnly = params.get('canvas') === '1'
  const startInEditor = !canvasOnly && params.get('edit') === '1'
  const requestedPanel = params.get('panel')
  const [view, setView] = useState<SceneView>(startInEditor ? 'layout' : cameraViews.find(item => item.id === requestedView)?.id ?? 'orbit')
  const debug = params.get('debug') === '1'
  const [autoRotate, setAutoRotate] = useState(!debug)
  const [panMode, setPanMode] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showOperations, setShowOperations] = useState(true)
  const [showRoutes, setShowRoutes] = useState(debug)
  const [activeTool, setActiveTool] = useState<SimulationTool | null>(startInEditor ? 'editor' : !canvasOnly && (requestedPanel === 'controls' || requestedPanel === 'report' || requestedPanel === 'optimize') ? requestedPanel : null)
  const [editorTab, setEditorTab] = useState<'layout' | 'staffing'>('layout')
  const priorEditorView = useRef<SceneView>(startInEditor ? 'map' : view)
  const editorOpen = activeTool === 'editor' && editorTab === 'layout'
  const [focusPosition, setFocusPosition] = useState<Point>(() => editOptions.areas.find(area => area.id === editOptions.initialAreaId)?.position ?? [12, 0, -260])
  const [focusYawDeg, setFocusYawDeg] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [importError, setImportError] = useState<string | null>(null)
  const [waypointId, setWaypointId] = useState<string | null>(null)
  const [showTrace, setShowTrace] = useState(true)
  const [traceOrigin, setTraceOrigin] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ index: number; firstPerson: boolean } | null>(null)
  const [attendeeStatus, setAttendeeStatus] = useState<FirstPersonStatus | null>(null)
  const [followNotice, setFollowNotice] = useState<string | null>(null)
  const clockRef = useRef(7 * 3600)
  const [clockSeconds, setClockSeconds] = useState(clockRef.current)
  const [crowdStats, setCrowdStats] = useState<CrowdSampleStats>({ visibleCount: 0, walkingCount: 0 })
  const config = !resolved.error && (!useDraft || editor.runnableGraph) ? compiled.config : null
  const abm = useAbmWorker(config, compiled.layoutRevision)
  const sampler = useMemo(() => abm.result ? prepareJourneySampler(abm.result.journeys) : null, [abm.result])
  useEffect(() => { setSelection(null); setAttendeeStatus(null); setFollowNotice(null) }, [abm.result])
  const attendeeIndex = selection?.index ?? null
  const attendee = attendeeIndex === null ? null : abm.result?.journeys[attendeeIndex] ?? null
  const following = attendee !== null && selection?.firstPerson === true
  const attendeeCohort = attendee && compiled.config.cohorts.find(cohort => cohort.id === attendee.cohortId)
  const attendeeOrigin = attendee && compiled.arrivalOrigins.find(origin => origin.id === (attendeeCohort?.originId ?? attendee.routeNodeIds[0]))
  const attendeeCategory = (resolved.plan as { event?: { ticket_categories?: { id: string; name?: string }[] } }).event?.ticket_categories?.find(category => category.id === attendeeCohort?.categoryId)
  const attendeeStation = compiled.config.serviceStations?.find(station => station.id === attendeeStatus?.stationId)
  const attendeeNode = compiled.nodes.find(node => node.id === (attendeeStation?.nodeId ?? attendeeStatus?.nextNodeId))
  const attendeeArea = compiled.entryAreas.find(area => area.id === attendeeNode?.entryAreaId)
  const attendeeDestination = attendee && compiled.nodes.find(node => node.id === attendee.routeNodeIds.at(-1))
  const attendeeDestinationArea = compiled.entryAreas.find(area => area.id === attendeeDestination?.entryAreaId)
  const attendeeLocation = attendeeNode?.entryAreaId === 'approach_network' && attendeeDestinationArea && attendeeNode.id !== 'approach_osm_309878212'
    ? `Public approach to ${attendeeDestinationArea.label}`
    : attendeeNode ? `${attendeeArea ? `${attendeeArea.label} · ` : ''}${waypointLabel(attendeeNode)}` : '—'
  const total = compiled.config.cohorts.reduce((sum, cohort) => sum + cohort.count, 0)
  const originClock = Number(compiled.config.timeOrigin.slice(11, 13)) * 3600 + Number(compiled.config.timeOrigin.slice(14, 16)) * 60
  const localClock = Math.floor((originClock + clockSeconds) % 86400)
  const clockLabel = [Math.floor(localClock / 3600), Math.floor(localClock / 60) % 60, localClock % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
  const inspector = activeTool === 'controls' && !canvasOnly
  const trace = useMemo(() => waypointId && abm.result ? traceWaypoint(abm.result.journeys, waypointId, compiled.arrivalOrigins) : null, [waypointId, abm.result, compiled.arrivalOrigins])
  const traceRoutes = inspector && showTrace && trace ? traceOrigin ? trace.origins.find(origin => origin.id === traceOrigin)?.routes ?? [] : trace.routes : []
  const guides = !!preview || editorOpen || showRoutes || (inspector && waypointId !== null)
  const editedEdges = editorOpen ? editor.visibleEdges : null
  const editedNodes = editorOpen ? editor.graph?.nodes ?? editor.layout.nodes : null
  const routes = useMemo<RouteLine[]>(() => {
    const nodes = new Map((editedNodes ?? scene.nodes).map(node => [node.id, node]))
    const entry: Point[] = [], exception: Point[] = [], connector: Point[] = [], publicApproach: Point[] = []
    for (const edge of editedEdges ?? scene.edges) {
      const from = nodes.get(edge.from), to = nodes.get(edge.to)
      if (!from || !to) continue
      const points = edge.basis === 'mapped_public_walking_network' ? publicApproach : edge.basis?.startsWith('proposed') ? connector : edge.id.includes('help_checkpoint') ? exception : entry
      points.push(from.position, to.position)
    }
    return [
      { id: 'entry-network', kind: 'entry', points: entry, segments: true },
      { id: 'exception-network', kind: 'exception', points: exception, segments: true },
      { id: 'proposed-connectors', kind: 'connector', points: connector, segments: true },
      { id: 'public-approach', kind: 'public', points: publicApproach, segments: true },
    ]
  }, [scene, editedEdges, editedNodes])
  const guideNodes: RouteNode[] = editorOpen
    ? [
        ...(editedNodes ?? []).filter(node => editor.visibleNodes.some(item => item.id === node.id)).map(node => ({ ...node, label: compiled.arrivalOrigins.find(origin => origin.id === node.id)?.label ?? node.id })),
        ...(editor.layout.markers ?? []).filter(marker => !editor.activeAreaId || marker.entryAreaId === editor.activeAreaId).map(marker => ({ ...marker, role: 'waypoint' as const })),
      ]
    : compiled.nodes.filter(node => node.id === waypointId && inspector || showRoutes && (
        node.role !== 'waypoint' && node.entryAreaId !== 'shared_origins' || inspector && node.id === 'approach_osm_309878212'
      )).map(node => ({ ...node, label: waypointLabel(node) }))
  function focusEditorArea(area: EditorArea | null) {
    setFocusPosition(area?.position ?? [0, 0, 0])
    setFocusYawDeg(0)
    setView(area ? 'layout' : 'map')
    setAutoRotate(false)
    setPanMode(false)
  }
  function selectTool(tool: SimulationTool | null) {
    const next = tool === activeTool ? null : tool
    if (next !== 'optimize') setExpansionPreview(null)
    if (activeTool === 'editor' && next !== 'editor') setView(priorEditorView.current)
    if (next === 'editor') {
      clearAttendee()
      priorEditorView.current = view
      setEditorTab('layout')
      setPlaying(false)
      focusEditorArea(editor.areas.find(area => area.id === editor.activeAreaId) ?? null)
    }
    setActiveTool(next)
    const url = new URL(window.location.href)
    if (next === 'editor') url.searchParams.set('edit', '1')
    else url.searchParams.delete('edit')
    if (next && next !== 'editor') url.searchParams.set('panel', next)
    else url.searchParams.delete('panel')
    window.history.replaceState(window.history.state, '', url)
  }
  function clearAttendee() { setSelection(null); setAttendeeStatus(null); setFollowNotice(null) }
  function selectAttendee(index: number, firstPerson = false) {
    if (index !== attendeeIndex) setAttendeeStatus(null)
    setFollowNotice(null)
    setSelection({ index, firstPerson })
  }
  function nextAttendee() {
    const next = sampler ? pickVisibleJourney(sampler, clockRef.current, attendeeIndex) : null
    if (next === null) { setFollowNotice(attendeeIndex === null ? 'No attendee is visible at this time. Try a different playback time.' : 'No other attendee is visible at this time.'); return }
    selectAttendee(next, true)
  }
  function viewSelectedAttendee() {
    if (attendeeIndex === null || attendeeStatus?.position == null) return
    if (activeTool) selectTool(null)
    selectAttendee(attendeeIndex, true)
  }
  function toggleFirstPerson() {
    if (following) clearAttendee()
    else if (attendee) viewSelectedAttendee()
    else { if (activeTool) selectTool(null); nextAttendee() }
  }
  function changeView(next: SceneView) {
    if (following) clearAttendee()
    setView(next)
    setAutoRotate(next === 'orbit')
    setPanMode(false)
  }
  function focusOrigin(id: string) {
    const origin = compiled.arrivalOrigins.find(item => item.id === id)
    if (origin) focusPoint(origin.position)
  }
  function seek(seconds: number) {
    clockRef.current = seconds
    setClockSeconds(seconds)
    setPlaying(false)
  }
  function selectWaypoint(id: string | null) {
    setWaypointId(id)
    setTraceOrigin(null)
    setShowTrace(true)
  }
  function focusWaypoint() {
    const node = compiled.nodes.find(item => item.id === waypointId)
    if (node) focusPoint(node.position)
  }
  function focusPoint(position: Point, yawDeg = 0) {
    clearAttendee()
    setFocusPosition(position)
    setFocusYawDeg(yawDeg)
    setView('entry')
    setAutoRotate(false)
  }
  function focus(areaId: string) {
    const area = compiled.entryAreas.find(item => item.id === areaId)
    const prefix = areaId === 'plaza_utara' ? '' : `${areaId}_`
    const station = compiled.placements.find(placement => placement.id === `${prefix}${oneWayAdmission ? 'security' : 'scan'}_tent`)
    const areas = (resolved.plan as { spatial_context?: { entry_areas?: { id: string; admission_yaw_deg?: number }[] } }).spatial_context?.entry_areas
    const yaw = areas?.find(item => item.id === areaId)?.admission_yaw_deg
    if (area && editorOpen) {
      editor.selectArea(areaId)
      focusEditorArea(area)
    } else if (area) focusPoint(area.position, yaw ?? station?.yawDeg)
  }
  function runLocal() {
    clearAttendee()
    clockRef.current = Math.min(compiled.config.horizonSeconds, 8 * 3600 + 40 * 60)
    setClockSeconds(clockRef.current)
    if (activeTool !== 'report' && activeTool !== 'controls') selectTool('controls')
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
      catalog.addVersion(JSON.parse(await file.text()), 'imported')
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Cannot read this plan.') }
  }
  function exportPlan() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(resolved.plan, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `opsidio-gbk-${version.id}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const draftError = draft.error ?? (editor.runnableGraph ? null : 'Resolve the layout errors before running this draft.')
  const planError = useDraft ? draftError : null
  const draftSelector = hasDraft && <label className="sim-draft-switch"><input type="checkbox" checked={useDraft} onChange={event => { setUseDraft(event.target.checked); setPlaying(false) }} /> Include draft edits</label>
  function saveVersion() {
    try { catalog.addVersion(draft.plan, 'saved') }
    catch (error) { setVersionNotice(error instanceof Error ? error.message : 'Unable to save this version.') }
  }
  async function copyEditorLink() {
    try { await navigator.clipboard.writeText(editorUrl(version.id).href); setVersionNotice('Editor link copied.') }
    catch { setVersionNotice('Copy the editor link from your browser’s address bar.') }
  }
  return <main className="standalone-scene simulation-theme" data-panel-open={activeTool !== null}>
    <Suspense fallback={<div className="scene-loading">Loading GBK…</div>}>
      <GbkCanvas venue={venue} catalogue={catalogue} placements={editorOpen ? editor.layout.placements : scene.placements} editBounds={editorOpen ? editOptions.bounds : undefined}
        routes={[...(preview || editorOpen || showRoutes ? routes : []), ...traceRoutes]} nodes={guides ? guideNodes : []} inspectWaypoints={inspector}
        view={view} followCamera={following} focusPosition={focusPosition} focusYawDeg={focusYawDeg} autoRotate={autoRotate} panMode={panMode} showLabels={showLabels}
        onCameraInteraction={() => setAutoRotate(false)} debug={debug} showGuides={guides}
        selectedId={editorOpen ? editor.selectedId : inspector ? waypointId : null} onSelect={editorOpen ? editor.onSelect : id => { if (inspector && id) selectWaypoint(id) }} onMove={editorOpen ? editor.onMove : () => {}}>
        <PlaybackClock clockRef={clockRef} playing={!preview && playing && abm.result !== null} rate={playbackRate} duration={compiled.config.horizonSeconds} onTick={setClockSeconds} onEnd={() => setPlaying(false)} />
        <Suspense fallback={null}>
          {!preview && abm.result && sampler && <CrowdPreview result={abm.result} sampler={sampler} clockRef={clockRef} maxVisible={5000}
            hiddenJourneyIndex={following ? attendeeIndex : null} selectedJourneyIndex={following ? null : attendeeIndex}
            onSelectJourney={canvasOnly || activeTool === 'editor' || following ? undefined : selectAttendee}
            visualSpreadM={0.1} onSampleStats={setCrowdStats} />}
          {!preview && sampler && showOperations && <OperatorQueueBars sampler={sampler} operators={compiled.operators} clockRef={clockRef} showLabels={showLabels} />}
        </Suspense>
        {attendee && sampler && attendeeIndex !== null && <FirstPersonFollow sampler={sampler} journeyIndex={attendeeIndex} journey={attendee} clockRef={clockRef}
          followCamera={following} onStatus={setAttendeeStatus} />}
        {(preview || showOperations || editorOpen) && footprints.length > 0 && <AdmissionFootprints footprints={footprints} />}
        {(preview || showOperations) && <OperationsLayer operators={scene.operators} placements={scene.placements} catalogue={catalogue} entryAreas={scene.entryAreas} showLabels={showLabels} />}
        {compiled.arrivalOrigins.length > 0 && <ArrivalOrigins origins={compiled.arrivalOrigins} showLabels={showLabels} />}
      </GbkCanvas>
    </Suspense>
    {!canvasOnly && <>
      <SimulationToolbar active={activeTool} revision={activeTool === 'editor' ? editor.layout.revision : compiled.layoutRevision} onSelect={selectTool}
        eventName={eventId ? (source as { event?: { name?: string } }).event?.name : undefined}
        backToPlan={eventId ? `/events/${encodeURIComponent(eventId)}/review` : undefined}
        versionPicker={<SimulationVersions versions={catalog.versions} selectedId={version.id} onSelect={catalog.selectVersion} />} />
      {(!editorOpen || view !== 'layout') && <SimulationMapControls view={view} cameraViews={cameraViews} onViewChange={changeView}
        autoRotate={autoRotate} onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        panMode={panMode} onTogglePan={() => { setPanMode(!panMode); setAutoRotate(false) }}
        showRoutes={showRoutes} onToggleRoutes={() => setShowRoutes(!showRoutes)}
        showOperations={showOperations} onToggleOperations={() => setShowOperations(!showOperations)}
        showLabels={showLabels} onToggleLabels={() => setShowLabels(!showLabels)} onFollowPerson={toggleFirstPerson} following={following}
        followDisabled={!abm.result || (!following && attendee !== null && attendeeStatus?.position == null)} />}
      <SimulationDrawer tool="editor" active={activeTool === 'editor'} description="Place equipment, edit routes, and staff entry lanes." onClose={() => selectTool(null)}>
        {activeTool === 'editor' && <>
          <div className="sim-version-editor">
            <strong>Editing {version.label}</strong>
            <p>{hasDraft ? 'Changes are in this version’s draft.' : 'Edits are saved to a draft until you create a new version.'}</p>
            <div><button type="button" onClick={saveVersion} disabled={!hasDraft || !!draftError}>Save as new version</button><button type="button" onClick={() => void copyEditorLink()}>Copy editor link</button></div>
            {version.id !== 'baseline' && <small>Saved versions and their links are local to this browser.</small>}
            {(versionNotice || catalog.storageError) && <p role="status">{versionNotice ?? catalog.storageError}</p>}
          </div>
          <div className="sim-panel-tabs" role="group" aria-label="Editor sections">
            <button type="button" aria-pressed={editorTab === 'layout'} onClick={() => { setEditorTab('layout'); focusEditorArea(editor.areas.find(area => area.id === editor.activeAreaId) ?? null) }}>Layout</button>
            <button type="button" aria-pressed={editorTab === 'staffing'} onClick={() => setEditorTab('staffing')}>Staffing & hours</button>
          </div>
          {editorTab === 'layout'
            ? <><LayoutEditor editor={editor} onAreaChange={focusEditorArea} />{editor.runnableGraph && draft.error && <p className="sim-drawer-note" role="alert">{draft.error}</p>}</>
            : <GateInputsPanel gates={gateOptions} edits={gateDraft.edits} error={draft.error}
                onChange={(id, edit) => setGateDraft(current => ({ edits: { ...current.edits, [id]: edit }, revision: current.revision + 1 }))}
                onReset={() => setGateDraft({ edits: {}, revision: 0 })} />}
        </>}
      </SimulationDrawer>
      <SimulationDrawer tool="controls" active={activeTool === 'controls'} description="Adjust the map and play the local simulation." onClose={() => selectTool(null)}>
        {planError && <p className="sim-drawer-note" role="alert">{planError}</p>}
        {abm.error && <p className="sim-drawer-note" role="alert">{abm.error}</p>}
        <p className="sim-drawer-note">{version.label} · {useDraft && hasDraft ? 'Draft preview' : 'Saved snapshot'}</p>
        {draftSelector}
        <SimulationControls
          entries={compiled.entryAreas} onFocusEntry={focus} origins={compiled.arrivalOrigins} onFocusOrigin={focusOrigin}
          runDisabled={!config} runPending={abm.status === 'running'} onRun={runLocal}
          playback={abm.result ? { playing, clockLabel, seconds: clockSeconds, duration: compiled.config.horizonSeconds,
            rate: playbackRate, onTogglePlaying: () => setPlaying(!playing), onSeek: seek, onRateChange: setPlaybackRate } : undefined} />
        {inspector && <WaypointTrace nodes={compiled.nodes} entryAreas={compiled.entryAreas} selectedId={waypointId} trace={trace}
          onSelect={selectWaypoint} onFocus={focusWaypoint} showRoutes={showTrace} onShowRoutesChange={setShowTrace}
          shownOriginId={traceOrigin} onShownOriginChange={setTraceOrigin} />}
        <label className="sim-seed-field">Simulation seed <input type="number" value={useDraft ? seed : base.config.seed} onChange={event => { const value = Number(event.target.value); if (Number.isSafeInteger(value)) { setSeed(value); setUseDraft(true); setPlaying(false) } }} /></label>
      </SimulationDrawer>
      {activeTool === 'report' && <SimulationReport plan={resolved.plan} version={version} versions={catalog.versions} seed={compiled.config.seed}
        draftControls={draftSelector} plannedCount={total} entryAreaCount={compiled.entryAreas.length} staffCount={compiled.operators.length}
        revision={compiled.layoutRevision} clockLabel={clockLabel} status={abm.status} result={abm.result} stats={crowdStats}
        error={abm.error ?? planError} onRun={runLocal} runDisabled={!config} onExport={exportPlan} exportDisabled={!!planError}
        onClear={() => { setPlaying(false); abm.cancel() }} onImport={importPlan} importError={importError} onClose={() => selectTool(null)} />}
      <SimulationDrawer tool="optimize" active={activeTool === 'optimize'} description="Test extra lanes and preview where they would go." onClose={() => selectTool(null)}>
        {planError && <p className="sim-drawer-note" role="alert">{planError}</p>}
        {draftSelector}
        {activeTool === 'optimize' && <>
          <EntranceExpansionPanel gates={expansionGates}
            gateId={expansionGateId}
            onGateChange={id => { setExpansionPreview(null); setCorridorGate(id) }}
            planKey={corridorKey} activePlan={resolved.plan} authoredPlan={resolved.authoredPlan}
            disabled={!config} previewLanes={preview?.lanes}
            onPreview={proposal => {
              if (preview?.lanes === proposal.lanes) { setExpansionPreview(null); return }
              const candidate = compileSimulationPlan(proposal.plan)
              const operator = candidate.operators.find(item => item.pointId === expansionGateId)
              if (operator) focusPoint(operator.position, operator.yawDeg)
              setPlaying(false)
              setExpansionPreview({ key: expansionKey, lanes: proposal.lanes, plan: proposal.plan })
            }}
            onApply={proposal => {
              catalog.addVersion(proposal.plan, 'optimized', resolved.plan)
              selectTool('report')
            }} />
          <details className="sim-existing-lane-comparison">
            <summary>Compare existing lanes with Doni</summary>
            <CorridorOptimizationPanel gates={corridorGates}
              gateId={corridorGates.some(gate => gate.id === corridorGate) ? corridorGate : corridorGates[0]?.id ?? ''}
              onGateChange={id => { setExpansionPreview(null); setCorridorGate(id) }}
              planKey={corridorKey} disabled={!config}
              project={gateId => projectCorridorPlan({ authoredPlan: resolved.authoredPlan, activePlan: resolved.plan, gateId })}
              onApply={(projection, candidate) => {
                catalog.addVersion(applyCorridorCandidate(projection, candidate), 'optimized', resolved.plan)
                selectTool('report')
              }} />
          </details>
        </>}
      </SimulationDrawer>
      {attendee && attendeeIndex !== null && <div className="sim-first-person-dock"><FirstPersonPanel
        attendeeLabel={`Attendee ${attendeeIndex + 1}${attendeeCategory?.name ? ` · ${attendeeCategory.name}` : ''}`} originLabel={attendeeOrigin?.label ?? 'On-site arrival'}
        locationLabel={attendeeLocation} status={attendeeStatus} notice={followNotice} following={following}
        onFollow={viewSelectedAttendee} onNext={nextAttendee} onExit={clearAttendee} /></div>}
      {!attendee && followNotice && <p role="status" className="sim-follow-notice">{followNotice}</p>}
      {!attendee && showOperations && <div className="operations-legend"><strong>Map legend</strong><span style={{ color: '#2867d5' }}>● Scan operators</span><span style={{ color: '#a92b36' }}>● Security</span><span style={{ color: '#167451' }}>● Help</span><span style={{ color: '#217b7a' }}>● Processing</span><span>Queue wait</span><span className="queue-wait-gradient" aria-label="Wait color from yellow to red" /><small>0 · 5 · 15+ min</small><span>Bar height · queue size</span>{footprints.length > 0 && <span style={{ color: '#75551f' }}>▰ Proposed gate footprint</span>}{showRoutes && <><span style={{ color: '#4d6f9f' }}>┅ Public approach</span><span style={{ color: '#167b74' }}>━ Admission lane</span>{routes[2].points.length > 0 && <span style={{ color: '#7252a3' }}>┅ Proposed connector</span>}</>}</div>}
      {!following && <span className="scene-navigation">Drag to {panMode || ['map', 'isometric', 'layout'].includes(view) ? 'pan' : 'orbit'} · scroll to zoom{abm.result && activeTool !== 'editor' && ' · click an attendee to inspect'}</span>}
    </>}
    <a className="scene-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · Illustrative structures and event layout</a>
  </main>
}
