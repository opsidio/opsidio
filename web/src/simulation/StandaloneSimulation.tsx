import { lazy, Suspense, useState } from 'react'
import venueJson from './venue/gbk.json'
import admissionScenario from '../../../data/scenarios/coldplay-gbk-demo.json'
import { catalogue, initialDraft, placementIssue } from './model'
import { buildRoutes } from './route'
import type { EntryAreaMarker, Placement, Point, SceneView, VenuePack } from './types'

const GbkCanvas = lazy(() => import('../scene/GbkCanvas'))
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
  const [placements, setPlacements] = useState<Placement[]>(() => initialDraft().placements)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const route = buildRoutes(placements, catalogue)

  return <main className="standalone-scene">
    <Suspense fallback={<div className="scene-loading">Loading GBK…</div>}>
      <GbkCanvas venue={venue} catalogue={catalogue} placements={placements}
        routes={debug ? route.routes : []} nodes={debug ? route.nodes : []}
        entryAreas={showEntryAreas ? entryAreaMarkers : undefined}
        view={view} autoRotate={autoRotate} panMode={panMode} showLabels={showLabels}
        onCameraInteraction={() => setAutoRotate(false)}
        debug={debug} showGuides={debug} selectedId={debug ? selectedId : null}
        onSelect={debug ? setSelectedId : () => {}}
        onMove={(id, position) => {
          if (!debug) return
          const placement = placements.find(item => item.id === id)
          if (!placement) return
          const next = { ...placement, position }
          if (!placementIssue(next, placements, venue.editBounds)) {
            setPlacements(current => current.map(item => item.id === id ? next : item))
          }
        }} />
    </Suspense>
    <nav className="scene-views" aria-label="Camera view">
      {cameraViews.map(item => <button key={item.id} type="button" aria-pressed={view === item.id}
        onClick={() => { setView(item.id); setAutoRotate(item.id === 'orbit'); setPanMode(false) }}>{item.label}</button>)}
    </nav>
    <div className="scene-tools">
      {view === 'orbit' && <button type="button" aria-pressed={autoRotate} onClick={() => setAutoRotate(!autoRotate)}>{autoRotate ? 'Ⅱ Pause rotation' : '▷ Auto rotate'}</button>}
      <button type="button" aria-pressed={panMode} onClick={() => { setPanMode(!panMode); setAutoRotate(false) }}>↔ Pan</button>
      <button type="button" aria-pressed={showEntryAreas} onClick={() => { setShowEntryAreas(!showEntryAreas); setAutoRotate(false) }}>Entry areas</button>
      <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>Labels</button>
    </div>
    <span className="scene-navigation">Drag to {panMode || view === 'map' || view === 'isometric' ? 'pan' : 'orbit'} · scroll to zoom · right-drag to pan</span>
    <a className="scene-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · Illustrative structures and event layout</a>
  </main>
}
