import type { SceneView } from '../types'
import './SimulationControls.css'

type FocusOption = { id: string; label: string }
type PlaybackControls = {
  playing: boolean
  clockLabel: string
  seconds: number
  duration: number
  rate: number
  onTogglePlaying: () => void
  onSeek: (seconds: number) => void
  onRateChange: (rate: number) => void
}

export type SimulationMapControlsProps = {
  view: SceneView
  cameraViews: readonly { id: SceneView; label: string }[]
  onViewChange: (view: SceneView) => void
  autoRotate: boolean
  onToggleAutoRotate: () => void
  panMode: boolean
  onTogglePan: () => void
  showRoutes: boolean
  onToggleRoutes: () => void
  showOperations: boolean
  onToggleOperations: () => void
  showLabels: boolean
  onToggleLabels: () => void
  onFollowPerson?: () => void
  followDisabled?: boolean
  following?: boolean
}

export type SimulationControlsProps = {
  entries: readonly FocusOption[]
  onFocusEntry: (id: string) => void
  origins: readonly FocusOption[]
  onFocusOrigin: (id: string) => void
  runDisabled: boolean
  runPending: boolean
  onRun: () => void
  playback?: PlaybackControls
}

const iconPaths = {
  orbit: 'M20 11a8 8 0 1 1-2.35-5.65L20 8M20 3v5h-5',
  isometric: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5m-8 4.5L4 7.5M12 12v9',
  entry: 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M2 21h20m-9-9h3m-2-2 2 2-2 2',
  map: 'M9 5 3 7v14l6-2 6 2 6-2V5l-6 2-6-2Zm0 0v14m6-12v14',
  pan: 'M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
  pause: 'M9 5v14m6-14v14',
  play: 'm8 5 11 7-11 7V5Z',
  routes: 'M7 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm14 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM7 5h9a3 3 0 0 1 0 6H8a4 4 0 0 0 0 8h9',
  operations: 'M3 10 12 3l9 7H3Zm2 0v11m14-11v11m-8-5h2m-1 0v5',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  labels: 'M20 14 10 4H4v6l10 10 6-6ZM7 7h.01',
} as const

type ControlIconName = keyof typeof iconPaths

const cameraIcons: Record<SceneView, ControlIconName> = {
  orbit: 'orbit', isometric: 'isometric', entry: 'entry', map: 'map', layout: 'map',
}

function ControlIcon({ name }: { name: ControlIconName }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={iconPaths[name]} /></svg>
}

type MapButtonProps = {
  label: string
  icon: ControlIconName
  pressed?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}

function MapButton({ label, icon, pressed, disabled, title, onClick }: MapButtonProps) {
  return <button type="button" className="sim-map-button" aria-label={label} title={title ?? label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
    <ControlIcon name={icon} /><span>{label}</span>
  </button>
}

export function SimulationMapControls({
  view, cameraViews, onViewChange, autoRotate, onToggleAutoRotate, panMode, onTogglePan,
  showRoutes, onToggleRoutes, showOperations, onToggleOperations, showLabels, onToggleLabels,
  onFollowPerson, followDisabled, following = false,
}: SimulationMapControlsProps) {
  return (
    <div className="sim-map-controls" role="group" aria-label="Map controls">
      <div className="sim-map-control-group sim-map-control-group-camera" role="group" aria-label="Camera view">
        {cameraViews.map(({ id, label }) => <MapButton key={id} label={label} icon={cameraIcons[id]} pressed={!following && view === id} onClick={() => onViewChange(id)} />)}
        {onFollowPerson && <MapButton label="First person" icon="eye" pressed={following} disabled={followDisabled} title={followDisabled ? 'Run the simulation to follow an attendee' : 'First person'} onClick={onFollowPerson} />}
      </div>
      <div className="sim-map-control-group sim-map-control-group-navigation" role="group" aria-label="Map navigation">
        <MapButton label="Pan" icon="pan" pressed={panMode && !following} disabled={following} onClick={onTogglePan} />
        {view === 'orbit' && !following && <MapButton label={autoRotate ? 'Pause rotation' : 'Auto rotate'} icon={autoRotate ? 'pause' : 'play'} onClick={onToggleAutoRotate} />}
      </div>
      <div className="sim-map-control-group sim-map-control-group-layers" role="group" aria-label="Map layers">
        <MapButton label="Routes" icon="routes" pressed={showRoutes} onClick={onToggleRoutes} />
        <MapButton label="Operators & equipment" icon="operations" pressed={showOperations} onClick={onToggleOperations} />
        <MapButton label="Labels" icon="labels" pressed={showLabels} onClick={onToggleLabels} />
      </div>
    </div>
  )
}

export default function SimulationControls({
  entries, onFocusEntry, origins, onFocusOrigin, runDisabled, runPending, onRun, playback,
}: SimulationControlsProps) {
  return (
    <div className="sim-controls">
      {(entries.length > 0 || origins.length > 0) && (
        <section className="sim-controls-section" aria-label="Map focus">
          <h3>Focus on map</h3>
          <div className="sim-controls-focus">
            {entries.length > 0 && <label className="sim-controls-field">
              Entry area
              <select value="" onChange={event => onFocusEntry(event.target.value)}>
                <option value="" disabled>Select entry area</option>
                {entries.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>}
            {origins.length > 0 && <label className="sim-controls-field">
              Arrival origin
              <select value="" onChange={event => onFocusOrigin(event.target.value)}>
                <option value="" disabled>Select arrival origin</option>
                {origins.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>}
          </div>
        </section>
      )}

      <section className="sim-controls-section" aria-label="Playback">
        <div className="sim-controls-clock">
          <h3>Playback</h3>
          <button className="sim-controls-run" type="button" onClick={onRun} disabled={runDisabled || runPending}>
            <ControlIcon name="play" />{runPending ? 'Generating…' : 'Run simulation'}
          </button>
        </div>
        {playback && <>
          <div className="sim-controls-clock">
            <button type="button" onClick={playback.onTogglePlaying}><ControlIcon name={playback.playing ? 'pause' : 'play'} />{playback.playing ? 'Pause playback' : 'Play playback'}</button>
            <time dateTime={playback.clockLabel}>{playback.clockLabel} WIB</time>
          </div>
          <input className="sim-controls-timeline" aria-label="Simulation time" aria-valuetext={`${playback.clockLabel} WIB`}
            type="range" min={0} max={playback.duration} step={30} value={playback.seconds}
            onChange={event => playback.onSeek(event.currentTarget.valueAsNumber)} />
          <label className="sim-controls-field sim-controls-rate">
            Playback speed
            <select value={playback.rate} onChange={event => playback.onRateChange(Number(event.target.value))}>
              <option value={1}>1× real time</option>
              <option value={10}>10×</option>
              <option value={60}>60×</option>
              <option value={180}>180×</option>
            </select>
          </label>
        </>}
      </section>
    </div>
  )
}
