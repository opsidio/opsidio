import type { FirstPersonStatus } from '../../scene/FirstPersonFollow'
import './FirstPersonPanel.css'

const phaseLabels: Record<FirstPersonStatus['phase'], string> = {
  'not-arrived': 'Not on site yet',
  walking: 'Walking',
  waiting: 'Waiting in line',
  'waiting-off-scene': 'Waiting off scene',
  processing: 'At checkpoint',
  arrived: 'Admitted',
}

function waitLabel(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const remainder = whole % 60
  return hours ? `${hours} h ${minutes} min` : minutes ? `${minutes} min ${remainder} s` : `${remainder} s`
}

export type FirstPersonPanelProps = {
  attendeeLabel: string
  originLabel: string
  locationLabel: string
  status: FirstPersonStatus | null
  notice?: string | null
  onNext: () => void
  onExit: () => void
}

export default function FirstPersonPanel({ attendeeLabel, originLabel, locationLabel, status, notice, onNext, onExit }: FirstPersonPanelProps) {
  return <section className="sim-first-person" aria-label="First-person view">
    <header className="sim-first-person-heading">
      <div><h3>First-person view</h3><p>{attendeeLabel}</p></div>
      <span className="sim-first-person-phase">{status ? phaseLabels[status.phase] : 'Locating attendee…'}</span>
    </header>
    <dl>
      <div><dt>Origin</dt><dd>{originLabel}</dd></div>
      <div><dt>Current location</dt><dd>{locationLabel}</dd></div>
      <div><dt>Current wait</dt><dd>{status ? waitLabel(status.waitSeconds) : '—'}</dd></div>
    </dl>
    {status?.phase === 'waiting-off-scene' && <p className="sim-first-person-note">This queue has no modeled position for this attendee right now. The camera holds its last view.</p>}
    {status?.phase === 'not-arrived' && <p className="sim-first-person-note">The attendee has not reached the site at this playback time. The camera holds its last view.</p>}
    {status?.phase === 'arrived' && <p className="sim-first-person-note">This attendee has reached the end of their modeled route.</p>}
    {notice && <p role="status" className="sim-first-person-note">{notice}</p>}
    <div className="sim-first-person-actions">
      <button type="button" onClick={onExit}>Exit first person</button>
      <button type="button" className="sim-first-person-next" onClick={onNext}>Next person</button>
    </div>
  </section>
}
