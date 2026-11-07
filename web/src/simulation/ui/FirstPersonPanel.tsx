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
  following: boolean
  onFollow: () => void
  onNext: () => void
  onExit: () => void
}

export default function FirstPersonPanel({ attendeeLabel, originLabel, locationLabel, status, notice, following, onFollow, onNext, onExit }: FirstPersonPanelProps) {
  const title = following ? 'First-person view' : 'Attendee details'
  return <section className="sim-first-person" aria-label={title}>
    <header className="sim-first-person-heading">
      <div><h3>{title}</h3><p>{attendeeLabel}</p></div>
      <span className="sim-first-person-phase">{status ? phaseLabels[status.phase] : 'Locating attendee…'}</span>
    </header>
    <dl>
      <div><dt>Origin</dt><dd>{originLabel}</dd></div>
      <div><dt>Current location</dt><dd>{locationLabel}</dd></div>
      <div><dt>Current wait</dt><dd>{status ? waitLabel(status.waitSeconds) : '—'}</dd></div>
    </dl>
    {status?.phase === 'waiting-off-scene' && <p className="sim-first-person-note">This queue has no modeled position for this attendee right now.{following && ' The camera holds its last view.'}</p>}
    {status?.phase === 'not-arrived' && <p className="sim-first-person-note">The attendee has not reached the site at this playback time.{following && ' The camera holds its last view.'}</p>}
    {status?.phase === 'arrived' && <p className="sim-first-person-note">This attendee has reached the end of their modeled route.</p>}
    {notice && <p role="status" className="sim-first-person-note">{notice}</p>}
    <div className="sim-first-person-actions">
      <button type="button" onClick={onExit}>{following ? 'Exit first person' : 'Close details'}</button>
      {following
        ? <button type="button" className="sim-first-person-next" onClick={onNext}>Next person</button>
        : <button type="button" className="sim-first-person-next" disabled={status?.position == null} onClick={onFollow}>View first person</button>}
    </div>
  </section>
}
