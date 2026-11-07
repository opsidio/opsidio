import { useEffect, useRef, useState } from 'react'
import type { ExpansionResponse, ExpansionResult, ExpansionRun } from '../plan/entranceExpansion.worker'
import type { EditableGate } from '../plan/operatingInputs'
import { reportMoney, type ReportRun } from './simulationReportData'
import CorridorOptimizationPanel from './CorridorOptimizationPanel'
import { projectExpansionCorridor } from '../des/corridorPlan'
import './CorridorOptimizationPanel.css'

type Props = {
  gates: readonly EditableGate[]
  gateId: string
  onGateChange: (id: string) => void
  planKey: string
  activePlan: unknown
  authoredPlan: unknown
  onPreview: (proposal: ExpansionRun) => void
  onApply: (proposal: ExpansionRun) => void
  previewLanes?: number
  disabled?: boolean
}
type State = { status: 'pending' } | { status: 'error'; error: string } | { status: 'complete'; result: ExpansionResult }
const number = new Intl.NumberFormat('en-ID')
const display = (value: number | null) => value === null ? '—' : number.format(value)
const wait = (value: number | null) => value === null ? '—' : `${number.format(Math.round(value / 6) / 10)} min`
const peak = (run: ReportRun) => Math.max(run.checkpoints.security?.peak ?? 0, run.checkpoints.scan?.peak ?? 0)

export default function EntranceExpansionPanel({ gates, gateId, onGateChange, planKey, activePlan, authoredPlan, onPreview, onApply, previewLanes, disabled }: Props) {
  const [state, setState] = useState<(State & { key: string }) | null>(null)
  const [choice, setChoice] = useState<{ key: string; lanes: number } | null>(null)
  const [scanCheckOpen, setScanCheckOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)
  const key = `${planKey}:${gateId}`
  const gate = gates.find(item => item.id === gateId)
  const current = state?.key === key ? state : null
  const result = current?.status === 'complete' ? current.result : null
  const proposal = result?.proposals.find(item => item.lanes === (choice?.key === key ? choice.lanes : result.recommendedLanes))
    ?? result?.proposals[0]

  useEffect(() => () => {
    worker.current?.terminate()
    worker.current = null
  }, [key])

  function compare() {
    if (!gate || disabled || worker.current) return
    setState({ key, status: 'pending' })
    setChoice(null)
    setSaveError(null)
    try {
      const run = new Worker(new URL('../plan/entranceExpansion.worker.ts', import.meta.url), { type: 'module' })
      worker.current = run
      const finish = (response: ExpansionResponse) => {
        if (worker.current !== run) return
        run.terminate()
        worker.current = null
        setState('error' in response ? { key, status: 'error', error: response.error } : { key, status: 'complete', result: response })
      }
      run.onmessage = (event: MessageEvent<ExpansionResponse>) => finish(event.data)
      run.onerror = () => finish({ error: 'The entrance comparison could not run. Try again.' })
      run.postMessage({ activePlan, authoredPlan, gateId })
    } catch (error) {
      worker.current?.terminate()
      worker.current = null
      setState({ key, status: 'error', error: error instanceof Error ? error.message : 'Unable to start the entrance comparison.' })
    }
  }

  return <section className="sim-corridor" aria-label="Entrance layout proposals">
    <label className="sim-corridor-field">Entrance
      <select value={gateId} onChange={event => onGateChange(event.currentTarget.value)} disabled={!gates.length}>
        {!gates.length && <option value="">No supported entrance</option>}
        {gates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    {gate && <p className="sim-corridor-note">Current plan: {gate.lanes} staffed lanes. Compare extra security and scan lanes using the same arrivals.</p>}
    <button type="button" className="sim-corridor-primary" onClick={compare} disabled={disabled || !gate || current?.status === 'pending'}>
      {current?.status === 'pending' ? 'Testing layouts…' : 'Find lane and layout proposals'}
    </button>
    {current?.status === 'error' && <p role="alert">{current.error}</p>}
    {result && <div className="sim-corridor-results" aria-live="polite">
      <h3>{result.recommendedLanes === null ? 'Keep the current lane count' : `Recommended: add ${result.recommendedLanes - gate!.lanes} ${result.recommendedLanes - gate!.lanes === 1 ? 'lane' : 'lanes'}`}</h3>
      <p className="sim-corridor-note">{result.recommendedLanes === null
        ? result.proposals.length ? 'None of the tested layouts improved admission or queue performance.' : 'No extra lane layout passed the geometry checks.'
        : 'Ranks the tested layouts by admissions, then peak queue and wait.'}</p>
      {proposal && <><label className="sim-corridor-field">Layout to review
        <select value={proposal.lanes} onChange={event => { setChoice({ key, lanes: Number(event.currentTarget.value) }); setSaveError(null) }}>
          {result.proposals.map(item => <option key={item.lanes} value={item.lanes}>{item.lanes} total lanes{item.lanes === result.recommendedLanes ? ' · Recommended' : ''}</option>)}
        </select>
      </label>
      <table><thead><tr><th scope="col">At this entrance</th><th scope="col">Current</th><th scope="col">Proposal</th></tr></thead><tbody>
        <tr><th scope="row">Staffed lanes</th><td>{gate!.lanes}</td><td>{proposal.lanes}</td></tr>
        <tr><th scope="row">Admitted by showtime</th><td>{display(result.baseline.admittedByShowtime)}</td><td>{display(proposal.metrics.admittedByShowtime)}</td></tr>
        <tr><th scope="row">Peak security or scan queue</th><td>{display(peak(result.baseline))}</td><td>{display(peak(proposal.metrics))}</td></tr>
        <tr><th scope="row">P90 gate wait</th><td>{wait(result.baseline.p90GateWaitSeconds)}</td><td>{wait(proposal.metrics.p90GateWaitSeconds)}</td></tr>
      </tbody></table>
      <p>+{proposal.staffAdded} staff{proposal.equipment.map(item => ` · +${item.units} ${item.label.toLowerCase()}`).join('')}{proposal.costAdded === null ? '' : ` · ${reportMoney(proposal.costAdded)} additional estimated staffing and device cost`}</p>
      {proposal.widthM !== null && <p className="sim-corridor-note">{proposal.widthM} m proposed operating width{proposal.extraWidthM > 0 && ` · ${proposal.extraWidthM.toFixed(1)} m wider than the current layout`}</p>}
      {proposal.review.length > 0 && <div className="sim-expansion-review"><strong>Confirm before use</strong><ul>{proposal.review.map(item => <li key={item}>{item}</li>)}</ul></div>}
      <button type="button" onClick={() => onPreview(proposal)}>{previewLanes === proposal.lanes ? 'Return to current layout' : 'Preview layout on map'}</button>
      <button type="button" onClick={() => {
        try { onApply(proposal) }
        catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save this proposal.') }
      }}>Save proposal as new version</button>
      {saveError && <p role="alert">{saveError}</p>}
      <details className="sim-existing-lane-comparison" onToggle={event => setScanCheckOpen(event.currentTarget.open)}>
        <summary>Check the proposed scan capacity with Doni</summary>
        {scanCheckOpen && gate && <CorridorOptimizationPanel
          proposedCapacity
          gates={[{ ...gate, maxLanes: proposal.lanes }]}
          gateId={gate.id} onGateChange={onGateChange}
          planKey={`${planKey}:proposal:${proposal.lanes}`} disabled={disabled}
          project={id => projectExpansionCorridor(authoredPlan, activePlan, id, proposal.plan)} />}
      </details>
      </>}
      {result.skipped.length > 0 && <details className="sim-corridor-note"><summary>Layouts that could not be tested</summary><ul>{result.skipped.map(item => <li key={item}>{item}</li>)}</ul></details>}
    </div>}
  </section>
}
