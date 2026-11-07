import { lazy, Suspense, useState } from 'react'
import venueJson from './venue/gbk.json'
import { catalogue, initialDraft, placementIssue } from './model'
import { buildRoutes } from './route'
import type { Placement, SceneView, VenuePack } from './types'

const GbkCanvas = lazy(() => import('../scene/GbkCanvas'))
const venue = venueJson as unknown as VenuePack

/** Canvas-only entrypoint. Dashboard controls can compose this scene through SceneProps. */
export default function StandaloneSimulation() {
  const params = new URLSearchParams(location.search)
  const view: SceneView = params.get('view') === 'entry' ? 'entry' : params.get('view') === 'layout' ? 'layout' : 'orbit'
  const debug = params.get('debug') === '1'
  const [placements, setPlacements] = useState<Placement[]>(() => initialDraft().placements)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const route = buildRoutes(placements, catalogue)

  return <main className="standalone-scene">
    <Suspense fallback={<div className="scene-loading">Loading GBK…</div>}>
      <GbkCanvas venue={venue} catalogue={catalogue} placements={placements}
        routes={debug ? route.routes : []} nodes={debug ? route.nodes : []}
        view={view} debug={debug} showGuides={debug} selectedId={debug ? selectedId : null}
        onSelect={debug ? setSelectedId : () => {}}
        onMove={(id, position) => {
          if (!debug) return
          const placement = placements.find(item => item.id === id)
          if (!placement) return
          const next = { ...placement, position }
          if (!placementIssue(next, placements, venue.editBounds)) setPlacements(current => current.map(item => item.id === id ? next : item))
        }} />
    </Suspense>
    <a className="scene-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · Illustrative event layout</a>
  </main>
}
