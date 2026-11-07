import type { ChangeEvent } from 'react'
import type { CrowdSampleStats } from '../abm/sampling'
import type { AbmStatus } from '../abm/useAbmWorker'
import type { AbmResult } from '../runtime-types'
import './SimulationReport.css'

type SimulationReportProps = {
  plannedCount: number
  entryAreaCount: number
  staffCount: number
  revision: number
  clockLabel: string
  status: AbmStatus
  result: AbmResult | null
  stats: CrowdSampleStats
  error?: string | null
  onRun?: () => void
  runDisabled?: boolean
  onExport?: () => void
  exportDisabled?: boolean
  onClear?: () => void
  onImport?: (event: ChangeEvent<HTMLInputElement>) => void
  importError?: string | null
  onClose?: () => void
  showHeading?: boolean
  versionLabel?: string
}

const count = (value: number) => value.toLocaleString('en-US')

export default function SimulationReport({
  plannedCount, entryAreaCount, staffCount, revision, clockLabel, status, result, stats,
  error, onRun, runDisabled, onExport, exportDisabled, onClear, onImport, importError, onClose, showHeading = true, versionLabel = 'V1',
}: SimulationReportProps) {
  const running = status === 'running'
  const admitted = stats.completedCount ?? 0
  const waiting = stats.waitingCount ?? 0
  const offScene = stats.overflowWaitingCount ?? 0
  const progress = result && plannedCount > 0 ? Math.floor(admitted / plannedCount * 1000) / 10 : 0
  const metrics = [
    { label: 'Planned arrivals', value: plannedCount },
    { label: 'Admitted', value: admitted },
    { label: 'Waiting', value: waiting },
    { label: 'Processing', value: stats.processingCount ?? 0 },
  ]

  return <section className="sim-report" aria-label="Simulation report" aria-busy={running}>
    <header className="sim-report__header">
      <div>
        <p className="sim-report__eyebrow">Local simulation · {versionLabel}</p>
        {showHeading && <h2>Report</h2>}
      </div>
      {onClose && <button type="button" className="sim-report__close" onClick={onClose} aria-label="Close report">×</button>}
    </header>

    <div className="sim-report__meta">
      <span>Revision {revision}</span>
      <span>{count(entryAreaCount)} entry areas</span>
      <span>{count(staffCount)} staff</span>
    </div>

    {error && <p className="sim-report__error" role="alert">{error}</p>}
    {result ? <>
      <div className="sim-report__snapshot">
        <span>Playback snapshot</span>
        <time dateTime={clockLabel}>{clockLabel} WIB</time>
      </div>
      <dl className="sim-report__metrics">
        {metrics.map(metric => <div className="sim-report__metric" key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{count(metric.value)}</dd>
        </div>)}
      </dl>
      {plannedCount > 0 && <div className="sim-report__progress">
        <div><span>Admission progress</span><strong>{progress}%</strong></div>
        <progress value={admitted} max={plannedCount} aria-label="Admission progress" />
      </div>}
      <dl className="sim-report__detail">
        <div><dt>Walking</dt><dd>{count(stats.walkingCount)}</dd></div>
        <div><dt>Waiting off-scene</dt><dd>{count(offScene)}</dd></div>
        <div><dt>Generated from plan</dt><dd>{count(result.generatedCount)}</dd></div>
        <div><dt>Run seed</dt><dd>{count(result.seed)}</dd></div>
      </dl>
      <p className="sim-report__note">Waiting includes people outside the visible lanes. Results use the plan’s simulated arrival and service times.</p>
      {result.issues.map(issue => <p className="sim-report__error" role="alert" key={issue}>{issue}</p>)}
    </> : <div className="sim-report__empty">
      <strong>{count(plannedCount)} planned arrivals</strong>
      <p>{running ? 'The local simulation is running.' : 'Run the simulation to see admissions, queues, and processing at the current playback time.'}</p>
      {onRun && <button type="button" className="sim-report__primary" onClick={onRun} disabled={running || runDisabled}>{running ? 'Running…' : 'Run simulation'}</button>}
    </div>}

    {(onExport || onClear || onImport) && <div className="sim-report__actions">
      {onExport && <button type="button" onClick={onExport} disabled={exportDisabled}>Export plan JSON</button>}
      {onImport && <label className="sim-report__import">
        <span>Load plan JSON</span>
        <input aria-label="Load simulation plan JSON" type="file" accept=".json,application/json" onChange={onImport} />
      </label>}
      {onClear && (result || running) && <button type="button" onClick={onClear}>{running ? 'Cancel run' : 'Clear preview'}</button>}
    </div>}
    {importError && <p className="sim-report__error" role="alert">{importError}</p>}
  </section>
}
