import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { CrowdSampleStats } from '../abm/sampling'
import type { AbmStatus } from '../abm/useAbmWorker'
import type { AbmResult } from '../runtime-types'
import type { SimulationVersion } from './useSimulationVersions'
import type { ReportResponse } from './simulationReport.worker'
import { hasOneWayAdmission, reportCosts, reportMoney as money, reportPlanChanges, reportShowtime, reportStages } from './simulationReportData'
import type { ReportRun } from './simulationReportData'
import './SimulationReport.css'

type SimulationReportProps = {
  plan: unknown
  version: SimulationVersion
  versions: readonly SimulationVersion[]
  seed: number
  draftControls?: ReactNode
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
  onClose: () => void
}

type ReportVersion = Pick<SimulationVersion, 'id' | 'label' | 'plan'>
type ReportJob = {
  reference: ReportVersion
  comparison?: ReportVersion
  seed: number
  response?: ReportResponse
}

const count = (value: number) => value.toLocaleString('en-US')
const minutes = (seconds: number) => `${(seconds / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })} min`
const format = (value: number | null | undefined, formatter = count) => value == null ? '—' : formatter(value)
const signed = (value: number, formatter: (n: number) => string) => value === 0 ? formatter(0) : `${value > 0 ? '+' : '−'}${formatter(Math.abs(value))}`

function PlaybackSnapshot({
  version, plannedCount, entryAreaCount, staffCount, revision, clockLabel, status, result, stats, error,
  onRun, runDisabled, onExport, exportDisabled, onClear, onImport, importError, draftControls,
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

  return <section className="sim-report__card sim-report__playback" aria-label="Playback snapshot" aria-busy={running}>
    <h3>Playback snapshot</h3>
    <div className="sim-report__meta">
      <span>{version.label}</span>
      <span>Revision {revision}</span>
      <span>{count(entryAreaCount)} entry areas</span>
      <span>{count(staffCount)} staff</span>
    </div>
    {draftControls}
    {error && <p className="sim-report__error" role="alert">{error}</p>}
    {result ? <>
      <div className="sim-report__snapshot">
        <span>Current playback time</span>
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
      {result.issues.map(issue => <p className="sim-report__error" role="alert" key={issue}>{issue}</p>)}
    </> : <div className="sim-report__empty">
      <strong>{count(plannedCount)} planned arrivals</strong>
      <p>{running ? 'The local simulation is running.' : 'Run the simulation to see activity at the current playback time.'}</p>
    </div>}

    <div className="sim-report__actions">
      {onRun && <button type="button" onClick={onRun} disabled={running || runDisabled}>{running ? 'Running…' : 'Run simulation'}</button>}
      {onExport && <button type="button" onClick={onExport} disabled={exportDisabled}>Export plan JSON</button>}
      {onImport && <label className="sim-report__import">
        <span>Load plan JSON</span>
        <input aria-label="Load simulation plan JSON" type="file" accept=".json,application/json" onChange={onImport} />
      </label>}
      {onClear && (result || running) && <button type="button" onClick={onClear}>{running ? 'Cancel run' : 'Clear preview'}</button>}
    </div>
    {importError && <p className="sim-report__error" role="alert">{importError}</p>}
  </section>
}

type ComparisonMetric = {
  label: string
  reference?: number | null
  comparison?: number | null
  formatter?: (value: number) => string
}
function MetricTable({ rows, reference, comparison }: { rows: ComparisonMetric[]; reference: string; comparison?: string }) {
  return <div className="sim-report__scroll"><table>
    <thead><tr><th scope="col">Metric</th><th scope="col">{reference}</th>{comparison && <><th scope="col">{comparison}</th><th scope="col">Change</th></>}</tr></thead>
    <tbody>{rows.map(metric => <tr key={metric.label}>
      <th scope="row">{metric.label}</th>
      <td>{format(metric.reference, metric.formatter)}</td>
      {comparison && <><td>{format(metric.comparison, metric.formatter)}</td><td>{
        metric.reference == null || metric.comparison == null ? '—' : signed(metric.comparison - metric.reference, metric.formatter ?? count)
      }</td></>}
    </tr>)}</tbody>
  </table></div>
}

export default function SimulationReport(props: SimulationReportProps) {
  const { plan, version, versions, seed, onClose } = props
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])

  const active = useMemo<ReportVersion>(() => plan === version.plan
    ? version : { id: 'report-draft', label: `${version.label} draft`, plan }, [plan, version])
  const options = useMemo(() => active === version ? versions : [...versions, active], [active, version, versions])
  const defaultComparison = active.id === versions[0]?.id ? options.at(-1) : active
  const [referenceId, setReferenceId] = useState<string | undefined>()
  const [comparisonId, setComparisonId] = useState<string | undefined>()
  const reference = options.find(item => item.id === (referenceId ?? version.comparisonVersionId)) ?? versions[0] ?? active
  const comparison = options.find(item => item.id !== reference.id && item.id === (comparisonId ?? defaultComparison?.id))
  const [job, setJob] = useState<ReportJob | null>(null)
  const matchingJob = job?.reference === reference && job?.comparison === comparison && job.seed === seed ? job : null
  const pending = matchingJob !== null && !matchingJob.response
  useEffect(() => {
    if (!matchingJob || matchingJob.response) return
    let worker: Worker | undefined
    function finish(response: ReportResponse) {
      setJob(current => current && current === matchingJob ? { ...current, response } : current)
    }
    try {
      worker = new Worker(new URL('./simulationReport.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<ReportResponse>) => finish(event.data)
      worker.onerror = () => finish({ error: 'The report simulation could not finish.' })
      worker.postMessage({ plans: comparison ? [reference.plan, comparison.plan] : [reference.plan], seed })
    } catch {
      finish({ error: 'The report simulation could not start.' })
    }
    return () => worker?.terminate()
  }, [matchingJob, comparison, reference, seed])

  const response = matchingJob?.response
  const [firstRun, secondRun]: (ReportRun | undefined)[] = response && 'runs' in response ? response.runs : []
  const firstCosts = useMemo(() => reportCosts(reference.plan), [reference])
  const secondCosts = useMemo(() => comparison && reportCosts(comparison.plan), [comparison])
  const firstShowtime = reportShowtime(reference.plan)
  const secondShowtime = comparison ? reportShowtime(comparison.plan) : null
  const oneWayAdmission = hasOneWayAdmission(reference.plan) && (!comparison || hasOneWayAdmission(comparison.plan))
  const changes = useMemo(() => comparison ? reportPlanChanges(reference.plan, comparison.plan) : [], [comparison, reference])
  const headline: ComparisonMetric[] = [
    { label: 'Peak scan queue', reference: firstRun?.checkpoints.scan?.peak, comparison: secondRun?.checkpoints.scan?.peak },
    { label: 'P90 gate wait', reference: firstRun?.p90GateWaitSeconds, comparison: secondRun?.p90GateWaitSeconds, formatter: minutes },
    { label: 'Admitted by showtime', reference: firstRun?.admittedByShowtime, comparison: secondRun?.admittedByShowtime },
    { label: 'Staff + equipment', reference: firstCosts.total, comparison: secondCosts?.total, formatter: money },
  ]
  const breakdown: ComparisonMetric[] = [
    { label: 'Staff headcount', reference: firstCosts.headcount, comparison: secondCosts?.headcount },
    { label: 'Wages', reference: firstCosts.wages, comparison: secondCosts?.wages, formatter: money },
    { label: 'Meal allowance', reference: firstCosts.meals, comparison: secondCosts?.meals, formatter: money },
    { label: 'Committed equipment', reference: firstCosts.equipment, comparison: secondCosts?.equipment, formatter: money },
  ]
  const checkpointRows = reportStages.flatMap(({ id, label }) => {
    const a = firstRun?.checkpoints[id], b = secondRun?.checkpoints[id]
    return [
      { label: `${label} · peak queue`, reference: a?.peak, comparison: b?.peak },
      { label: `${label} · P90 wait`, reference: a?.p90WaitSeconds, comparison: b?.p90WaitSeconds, formatter: minutes },
      { label: `${label} · processed`, reference: a?.processed, comparison: b?.processed },
    ]
  })

  return <dialog ref={dialog} className="sim-report" id="simulation-report" aria-labelledby="simulation-report-title"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="sim-report__header">
      <div>
        <p className="sim-report__eyebrow">GBK · Entry operations</p>
        <h2 id="simulation-report-title">Simulation report</h2>
        <p className="sim-report__note">Review queue performance, resource costs and plan changes.</p>
      </div>
      <button type="button" className="sim-report__close" onClick={onClose} aria-label="Close report">×</button>
    </header>

    <div className="sim-report__body">
      <div className="sim-report__filters">
        <label>Reference version <select value={reference.id} onChange={event => { setReferenceId(event.target.value); setJob(null) }}>
          {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>Compare with <select value={comparison?.id ?? ''} onChange={event => { setComparisonId(event.target.value); setJob(null) }}>
          <option value="">Select a version</option>
          {options.filter(item => item.id !== reference.id).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <button className="sim-report__primary" type="button" disabled={pending} onClick={() => setJob({ reference, comparison, seed })}>
          {pending ? 'Running…' : comparison ? 'Run comparison' : 'Run report'}
        </button>
      </div>
      <p className="sim-report__note" role="status">{pending ? 'Running the full admission model in this browser.'
        : firstRun ? `Local runs use seed ${seed}. Showtime follows each plan’s main-act time.`
        : 'Run the selected plan versions to measure performance. Costs come from the saved plan inputs.'}</p>
      {response && 'error' in response && <p className="sim-report__error" role="alert">{response.error}</p>}

      <div className="sim-report__overview">
        {headline.map(metric => <div className="sim-report__card sim-report__kpi" key={metric.label}>
          <p>{metric.label}</p>
          <strong>{format(comparison ? metric.comparison : metric.reference, metric.formatter)}</strong>
          <small>{comparison ? `${format(metric.reference, metric.formatter)} · ${reference.label}`
            : metric.reference == null ? 'Awaiting data' : reference.label}</small>
        </div>)}
      </div>

      <div className="sim-report__layout">
        <div className="sim-report__main">
          <section className="sim-report__card" aria-label="Version comparison">
            <h3>Version comparison</h3>
            <MetricTable reference={reference.label} comparison={comparison?.label} rows={[
              ...headline,
              { label: 'Generated arrivals', reference: firstRun?.arrivals, comparison: secondRun?.arrivals },
              { label: 'Admitted by run end', reference: firstRun?.admittedByRunEnd, comparison: secondRun?.admittedByRunEnd },
            ]} />
            <p className="sim-report__note">Showtime {firstShowtime ? `${firstShowtime} WIB` : 'not specified'}{comparison && ` / ${secondShowtime ? `${secondShowtime} WIB` : 'not specified'}`}.</p>
            <p className="sim-report__note">P90 gate wait sums queue-entry-to-service time for attendees admitted by run end.
              {firstRun && ` Measured for ${count(firstRun.gateWaitSample)}${secondRun ? ` / ${count(secondRun.gateWaitSample)}` : ''} attendees.`}</p>
          </section>
          {oneWayAdmission && <section className="sim-report__card">
            <h3>Entry process</h3>
            <ol className="sim-report__process">
              <li>Help desk<small>For ticket issues</small></li>
              <li>Security check<small>Screening and clearance</small></li>
              <li>Ticket scan<small>Scan and wristband</small></li>
              <li>Admission<small>Reach the stadium</small></li>
            </ol>
          </section>}
          <section className="sim-report__card">
            <h3>Checkpoint performance</h3>
            <MetricTable reference={reference.label} comparison={comparison?.label} rows={checkpointRows} />
            <p className="sim-report__note">Peak queues combine all lanes at the same time, including people waiting off scene. Checkpoint P90 covers service starts by run end.</p>
          </section>
        </div>
        <aside className="sim-report__side" aria-label="Plan details">
          <section className="sim-report__card">
            <h3>What changed</h3>
            {changes.length > 0 ? <ul className="sim-report__changes">{changes.map(change => <li key={change}>{change}</li>)}</ul>
              : <p className="sim-report__note">{comparison ? 'The tracked operating inputs match.' : 'Select another saved version to review its changes.'}</p>}
          </section>
          <section className="sim-report__card">
            <h3>Planned costs</h3>
            <MetricTable reference={reference.label} comparison={comparison?.label} rows={breakdown} />
            <p className="sim-report__note">IDR. Wages use the headcount and per-shift rate. Equipment uses committed costs.</p>
          </section>
          <PlaybackSnapshot {...props} />
        </aside>
      </div>
    </div>
  </dialog>
}
