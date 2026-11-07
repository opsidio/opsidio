import { useEffect, useRef, useState } from 'react'
import { createConfigHash } from '../abm/worker-protocol'
import { isObject } from '../des/client'
import type { CorridorProjection } from '../des/corridorPlan'
import './CorridorOptimizationPanel.css'

export type CorridorGateOption = { id: string; label: string; lanes: number; maxLanes: number }
export type CorridorOptimizationPanelProps = {
  gates: readonly CorridorGateOption[]
  gateId: string
  onGateChange: (id: string) => void
  planKey: string
  project: (gateId: string) => CorridorProjection
  onApply: (projection: CorridorProjection, candidateDocument: unknown) => void | Promise<void>
  disabled?: boolean
  active?: boolean
}

type CorridorRun = {
  id: string; planId: string; hash: string; lanes: number; total: number; admitted: number; unfinished: number
  peakQueue: number; p90Wait: number | null; cost: string; queueTargetMet: boolean; budgetMet: boolean
}
type Comparison = {
  projection: CorridorProjection; baseline: CorridorRun; best: CorridorRun; candidate: unknown | null; timedOut: boolean
}
type Result = { key: string } & (
  { status: 'pending' } | { status: 'error'; message: string } | { status: 'complete'; comparison: Comparison }
)
type ApplyState = { key: string; status: 'saving' | 'saved' | 'error'; message?: string }

const invalidComparison = () => new Error('Doni did not return a complete, verifiable corridor comparison.')
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const minor = (amount: string) => BigInt(amount.replace('.', ''))

function readRun(input: unknown): CorridorRun {
  if (!isObject(input) || input.model_id !== 'corridor_v1' || typeof input.id !== 'string' || typeof input.plan_id !== 'string'
    || typeof input.snapshot_hash !== 'string' || !isObject(input.output)) throw invalidComparison()
  const { population, scan, costs, checks } = input.output
  if (!isObject(population) || !isCount(population.total) || !isCount(population.admitted) || !isCount(population.unfinished)
    || population.admitted + population.unfinished !== population.total || !isObject(scan) || !isCount(scan.lanes) || scan.lanes < 1 || scan.lanes > 8
    || !isCount(scan.peak_queue) || scan.peak_queue > population.total || (scan.wait_p90_seconds !== null && (typeof scan.wait_p90_seconds !== 'number' || !Number.isFinite(scan.wait_p90_seconds) || scan.wait_p90_seconds < 0))
    || !isObject(costs) || !isObject(costs.total) || costs.total.currency !== 'IDR' || typeof costs.total.amount !== 'string' || !/^\d+\.\d{2}$/.test(costs.total.amount)
    || !isObject(checks) || typeof checks.queue_target_met !== 'boolean' || typeof checks.budget_met !== 'boolean') throw invalidComparison()
  return { id: input.id, planId: input.plan_id, hash: input.snapshot_hash, lanes: scan.lanes, total: population.total, admitted: population.admitted,
    unfinished: population.unfinished, peakQueue: scan.peak_queue, p90Wait: scan.wait_p90_seconds, cost: costs.total.amount, queueTargetMet: checks.queue_target_met, budgetMet: checks.budget_met }
}

function improvedScore(baseline: CorridorRun, best: CorridorRun, queueTarget: number) {
  const baseShortfall = Math.max(0, baseline.peakQueue - queueTarget), bestShortfall = Math.max(0, best.peakQueue - queueTarget)
  if (best.unfinished !== baseline.unfinished) return best.unfinished < baseline.unfinished
  if (bestShortfall !== baseShortfall) return bestShortfall < baseShortfall
  return minor(best.cost) < minor(baseline.cost)
}

function readComparison(payload: unknown, projection: CorridorProjection): Comparison {
  if (!isObject(payload) || !isObject(payload.plan) || !isObject(payload.optimization)) throw invalidComparison()
  const { plan, optimization } = payload
  const baseline = readRun(payload.baseline), best = readRun(payload.best)
  const { document } = projection
  const queueTarget = document.targets.max_peak_scan_queue
  const laneCost = minor(document.scan.staff_cost_per_lane.amount) + minor(document.scan.scanner_cost_per_lane.amount)
  const budget = minor(document.budget.amount)
  const validCost = (run: CorridorRun) => run.budgetMet && minor(run.cost) === laneCost * BigInt(run.lanes) && minor(run.cost) <= budget
  if (typeof plan.id !== 'string' || baseline.planId !== plan.id || baseline.hash !== plan.snapshot_hash
    || createConfigHash(plan.document) !== createConfigHash(document) || optimization.plan_id !== plan.id
    || optimization.baseline_run_id !== baseline.id || optimization.best_run_id !== best.id
    || baseline.total !== document.arrivals.count || best.total !== baseline.total || baseline.lanes !== document.scan.lanes
    || baseline.queueTargetMet !== (baseline.peakQueue <= queueTarget) || best.queueTargetMet !== (best.peakQueue <= queueTarget)
    || !validCost(baseline) || !validCost(best) || typeof optimization.improved !== 'boolean'
    || (optimization.stop_reason !== 'completed' && optimization.stop_reason !== 'time_limit')) throw invalidComparison()
  let candidate: unknown | null = null
  if (optimization.improved) {
    const verified = payload.candidate
    const expected = { ...document, scan: { ...document.scan, lanes: best.lanes } }
    if (!isObject(verified) || typeof verified.id !== 'string' || verified.id !== optimization.candidate_plan_id
      || verified.parent_id !== plan.id || verified.id === plan.id || best.planId !== verified.id || best.hash !== verified.snapshot_hash
      || best.id === baseline.id || best.lanes <= baseline.lanes
      || best.lanes > Math.min(projection.authoredLanes, document.scan.physical_slots, document.scan.available_staff, document.scan.available_scanners)
      || !improvedScore(baseline, best, queueTarget)
      || createConfigHash(verified.document) !== createConfigHash(expected)) throw invalidComparison()
    candidate = verified.document
  } else if (payload.candidate !== null || optimization.candidate_plan_id !== null || createConfigHash(best) !== createConfigHash(baseline)) {
    throw invalidComparison()
  }
  return { projection, baseline, best, candidate, timedOut: optimization.stop_reason === 'time_limit' }
}

async function bridgeJson(path: 'health' | 'optimize', init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/simulation/corridor/${path}`, { cache: 'no-store', ...init })
  let body: unknown
  try { body = await response.json() }
  catch { throw new Error('The local corridor bridge did not return JSON. Check the bridge and its proxy.') }
  if (!response.ok) {
    const error = isObject(body) && isObject(body.error) ? body.error : null
    const message = typeof error?.message === 'string' ? error.message : `The corridor bridge returned HTTP ${response.status}.`
    throw new Error(message)
  }
  return body
}

const count = new Intl.NumberFormat('en-ID')
const sampleClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const rupiah = (amount: string) => {
  const [whole, fraction] = amount.split('.')
  return `IDR ${count.format(BigInt(whole))}${fraction === '00' ? '' : `.${fraction}`}`
}
const wait = (seconds: number | null) => seconds === null ? '—' : `${count.format(Math.round(seconds * 10) / 10)} s`
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The corridor comparison failed.'

export default function CorridorOptimizationPanel({ gates, gateId, onGateChange, planKey, project, onApply, disabled, active = true }: CorridorOptimizationPanelProps) {
  const [connection, setConnection] = useState<'checking' | 'configured' | 'unconfigured' | 'unreachable'>('checking')
  const [result, setResult] = useState<Result | null>(null)
  const [apply, setApply] = useState<ApplyState | null>(null)
  const healthRequest = useRef<AbortController | null>(null)
  const comparisonRequest = useRef<{ key: string; controller: AbortController } | null>(null)
  const key = `${planKey}:${gateId}`
  const selected = gates.find(gate => gate.id === gateId)
  const laneLimit = selected ? Math.min(8, selected.maxLanes) : 0
  const hasSpareLane = !!selected && selected.lanes < laneLimit
  const liveRequest = comparisonRequest.current?.key === key && !comparisonRequest.current.controller.signal.aborted
  const visibleResult = result?.key === key && (result.status !== 'pending' || liveRequest) ? result : null
  const visibleApply = apply?.key === key ? apply : null
  const comparison = visibleResult?.status === 'complete' ? visibleResult.comparison : null

  async function refreshConnection() {
    healthRequest.current?.abort()
    const controller = new AbortController()
    healthRequest.current = controller
    setConnection('checking')
    try {
      const health = await bridgeJson('health', { signal: controller.signal })
      if (!isObject(health) || typeof health.configured !== 'boolean') throw new Error('Invalid corridor health response.')
      if (!controller.signal.aborted) setConnection(health.configured ? 'configured' : 'unconfigured')
    } catch {
      if (!controller.signal.aborted) setConnection('unreachable')
    }
  }

  useEffect(() => {
    if (!active) return
    void refreshConnection()
    return () => healthRequest.current?.abort()
  }, [active])
  useEffect(() => () => {
    if (comparisonRequest.current?.key === key) comparisonRequest.current.controller.abort()
  }, [key])

  async function compare() {
    if (!selected || !hasSpareLane || disabled || connection !== 'configured' || liveRequest || visibleApply?.status === 'saving') return
    comparisonRequest.current?.controller.abort()
    const controller = new AbortController()
    comparisonRequest.current = { key, controller }
    setResult({ key, status: 'pending' })
    setApply(null)
    try {
      const projection = project(selected.id)
      if (projection.gateId !== selected.id || projection.startingLanes !== selected.lanes) throw new Error('The selected entrance has changed. Select it again before comparing lanes.')
      const { scan } = projection.document
      if (scan.lanes >= Math.min(scan.physical_slots, scan.available_staff, scan.available_scanners)) {
        throw new Error('This comparison has no spare staffed scanner lane. Check the current draft and available equipment.')
      }
      const payload = await bridgeJson('optimize', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: projection.document }) })
      const verified = readComparison(payload, projection)
      if (!controller.signal.aborted) setResult({ key, status: 'complete', comparison: verified })
    } catch (error) {
      if (!controller.signal.aborted) setResult({ key, status: 'error', message: errorMessage(error) })
    } finally {
      if (comparisonRequest.current?.controller === controller) comparisonRequest.current = null
    }
  }

  async function applyCandidate() {
    if (!comparison?.candidate || disabled || visibleApply?.status === 'saving' || visibleApply?.status === 'saved') return
    setApply({ key, status: 'saving' })
    try {
      await onApply(comparison.projection, comparison.candidate)
      setApply({ key, status: 'saved' })
    } catch (error) {
      setApply({ key, status: 'error', message: errorMessage(error) })
    }
  }

  const connectionLabel = { checking: 'Checking connection…', configured: 'Corridor bridge configured', unconfigured: 'Corridor access needs configuration', unreachable: 'Corridor bridge unavailable' }[connection]
  const sampleWindow = comparison ? [comparison.projection.sampleStartSeconds, comparison.projection.sampleEndSeconds]
    .map(seconds => sampleClock.format(new Date(Date.parse(comparison.projection.timeOrigin) + seconds * 1000))).join('–') : null

  return <section className="sim-corridor" aria-label="Doni corridor comparison">
    <p className="sim-corridor-scope"><strong>Up to 500 visitors · one scan checkpoint</strong><span>Compare scan lanes on one entrance corridor. The full admission simulation stays in Control Panel.</span></p>
    <label className="sim-corridor-field">Entrance
      <select value={gateId} onChange={event => onGateChange(event.currentTarget.value)} disabled={!gates.length}>
        {!gates.some(gate => gate.id === gateId) && <option value="">Select an entrance</option>}
        {gates.map(gate => <option key={gate.id} value={gate.id}>{gate.label}</option>)}
      </select>
    </label>
    {selected && <p className="sim-corridor-note">{selected.lanes} active / {selected.maxLanes} authored lanes{selected.maxLanes > 8 ? ' · Doni compares up to 8' : ''}</p>}
    {!gates.length && <p className="sim-corridor-note">This version has no supported entrance corridor.</p>}
    {selected && !hasSpareLane && <p className="sim-corridor-note">There’s no spare lane in this scope. In Editor → Staffing &amp; hours, reduce the active lanes, then choose the editor draft to compare against an authored spare lane.</p>}
    <div className="sim-corridor-connection"><span role="status" data-configured={connection === 'configured'}>{connectionLabel}</span><button type="button" onClick={() => void refreshConnection()} disabled={connection === 'checking'}>Refresh</button></div>
    <button type="button" className="sim-corridor-primary" disabled={disabled || !hasSpareLane || connection !== 'configured' || visibleResult?.status === 'pending' || visibleApply?.status === 'saving'} onClick={() => void compare()}>{visibleResult?.status === 'pending' ? 'Comparing lanes…' : 'Compare lanes with Doni'}</button>
    {visibleResult?.status === 'error' && <p role="alert">{visibleResult.message}</p>}
    {comparison && <div className="sim-corridor-results" aria-live="polite">
      <h3>{comparison.projection.gateLabel} comparison</h3>
      <p className="sim-corridor-note">{count.format(comparison.baseline.total)} sampled visitors of {count.format(comparison.projection.gateAttendees)} at this entrance · {sampleWindow} WIB</p>
      <table><thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Best tested</th></tr></thead><tbody>
        <tr><th scope="row">Scan lanes</th><td>{comparison.baseline.lanes}</td><td>{comparison.best.lanes}</td></tr>
        <tr><th scope="row">Admitted</th><td>{count.format(comparison.baseline.admitted)}</td><td>{count.format(comparison.best.admitted)}</td></tr>
        <tr><th scope="row">Peak scan queue</th><td>{count.format(comparison.baseline.peakQueue)}</td><td>{count.format(comparison.best.peakQueue)}</td></tr>
        <tr><th scope="row">P90 scan wait</th><td>{wait(comparison.baseline.p90Wait)}</td><td>{wait(comparison.best.p90Wait)}</td></tr>
        <tr><th scope="row">Corridor cost</th><td>{rupiah(comparison.baseline.cost)}</td><td>{rupiah(comparison.best.cost)}</td></tr>
      </tbody></table>
      {comparison.timedOut && <p className="sim-corridor-note">The search reached its time limit. This table shows the best completed comparison.</p>}
      {comparison.candidate ? <button type="button" className="sim-corridor-primary" disabled={disabled || visibleApply?.status === 'saving' || visibleApply?.status === 'saved'} onClick={() => void applyCandidate()}>{visibleApply?.status === 'saving' ? 'Saving…' : visibleApply?.status === 'saved' ? 'Version saved' : 'Save candidate as new version'}</button>
        : <p className="sim-corridor-note">Doni found no improving candidate among the completed comparisons.</p>}
      {visibleApply?.status === 'error' && <p role="alert">{visibleApply.message}</p>}
    </div>}
  </section>
}
