import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { DesBridgeError, getDesHealth, isObject, planShapeError, runDes, type DesFailure, type DesHealth, type DesRunResult } from './client'
import './DesRunPanel.css'

export type DesRunPanelProps = {
  plan: unknown | null
  baseSeed: number
  onResult?: (result: DesRunResult) => void
}

export default function DesRunPanel({ plan, baseSeed, onResult }: DesRunPanelProps) {
  const [imported, setImported] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [health, setHealth] = useState<DesHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [replications, setReplications] = useState(20)
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<DesFailure | null>(null)
  const [result, setResult] = useState<DesRunResult | null>(null)
  const generation = useRef(0)
  const activePlan = plan ?? imported
  const shapeError = activePlan === null ? null : planShapeError(activePlan)
  const event = isObject(activePlan) && isObject(activePlan.event) ? activePlan.event : null
  const venue = isObject(activePlan) && isObject(activePlan.venue) ? activePlan.venue : null
  const eventName = typeof event?.name === 'string' ? event.name : typeof event?.id === 'string' ? event.id : 'Unnamed event'
  const venueName = typeof event?.venue === 'string' ? event.venue : typeof venue?.name === 'string' ? venue.name : typeof venue?.id === 'string' ? venue.id : 'Venue not named'

  async function refreshHealth() {
    setChecking(true)
    setHealthError(null)
    try { setHealth(await getDesHealth()) }
    catch (error) { setHealth(null); setHealthError(error instanceof Error ? error.message : 'Could not check the DES bridge.') }
    finally { setChecking(false) }
  }

  useEffect(() => { void refreshHealth() }, [])
  useEffect(() => {
    // A late response from an earlier plan must never become this plan's result.
    generation.current += 1
    setResult(null)
    setFailure(null)
    setRunning(false)
  }, [activePlan, baseSeed, replications])
  useEffect(() => () => { generation.current += 1 }, [])

  async function importPlan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setImportError(null)
    try {
      if (file.size > 1_048_576) throw new Error('The plan file must be smaller than 1 MB.')
      const next: unknown = JSON.parse(await file.text())
      const error = planShapeError(next)
      if (error) throw new Error(error)
      setImported(next)
      setFileName(file.name)
    } catch (error) {
      setImportError(error instanceof SyntaxError ? 'This file is not valid JSON.' : error instanceof Error ? error.message : 'Could not read the plan.')
    }
  }

  async function submit() {
    const token = ++generation.current
    setRunning(true)
    setFailure(null)
    setResult(null)
    let next: DesRunResult
    try {
      next = await runDes(activePlan, baseSeed, replications)
    } catch (error) {
      if (generation.current === token) setFailure(error instanceof DesBridgeError ? error.payload : { status: 'error', error: { code: 'unknown_error', message: 'The DES request failed.' } })
      return
    } finally {
      if (generation.current === token) setRunning(false)
    }
    if (generation.current === token) {
      setResult(next)
      onResult?.(next)
    }
  }

  return <section className="des-run-panel" aria-label="DES processing simulation">
    <div className="des-panel-heading"><h2>Processing simulation</h2><span>DES</span></div>
    <p className="des-note">Run Doni’s processing engine with a full event plan.</p>
    {activePlan === null ? <p className="des-notice">A full GBK plan is needed for GBK results. Import a v0.1 plan to continue.</p> : <div className="des-plan-identity">
      <strong>{eventName}</strong><span>{venueName}</span>
      {fileName && plan == null && <small>{fileName}</small>}
      <p>This run uses the plan shown here. Importing a plan does not synchronize it with the visible scene or ABM arrivals.</p>
    </div>}
    {plan == null && <label className="des-import">Import plan JSON<input aria-label="Import DES plan JSON" type="file" accept=".json,application/json" disabled={running} onChange={importPlan} /></label>}
    {(importError || shapeError) && <p className="des-error" role="alert">{importError || shapeError}</p>}
    <div className="des-health">
      <span>{checking ? 'Checking local bridge…' : health?.configured ? 'Local bridge configured' : 'DES unavailable'}</span>
      <button type="button" disabled={checking || running} onClick={() => { void refreshHealth() }}>Refresh</button>
    </div>
    {health?.configured && <p className="des-note">Engine access is checked when you run.</p>}
    {health && !health.configured && <p className="des-notice">Set the bridge’s server environment: {[...health.missing, ...health.invalid].join(', ')}. Restart the bridge, then refresh.</p>}
    {healthError && <p className="des-error" role="status">{healthError}</p>}
    <div className="des-settings"><span>Seed <strong>{baseSeed}</strong></span><label>Replications <input aria-label="DES replications" type="number" min={1} max={100} step={1} value={replications} disabled={running} onChange={event => setReplications(Number(event.target.value))} /></label></div>
    <button className="des-run-button" type="button" disabled={running || checking || !health?.configured || activePlan === null || !!shapeError || !Number.isInteger(replications) || replications < 1 || replications > 100} onClick={() => { void submit() }}>{running ? 'Validating plan and running DES…' : 'Run DES'}</button>
    {running && <p className="des-note" role="status">Waiting for engine validation and results. No queue estimates are generated in this panel.</p>}
    {failure && <div className="des-error" role="alert"><strong>{failure.status === 'timeout' ? 'Engine request timed out' : failure.error.code}</strong><p>{failure.error.message}</p>{failure.stage && <small>Stage: {failure.stage}</small>}{failure.plan_id && <small>Plan: {failure.plan_id}</small>}
      {failure.error.details?.length ? <ul>{failure.error.details.map((issue, index) => <li key={index}>{issue.field}: {issue.message}</li>)}</ul> : null}
    </div>}
    {result && <div className="des-result" role="status">
      <strong>{result.run.reused ? 'Stored DES run recovered' : 'DES run complete'}</strong>
      <p>{result.run.output.scorecard?.summary ?? 'The engine returned a result without a summary.'}</p>
      <dl><dt>Plan</dt><dd>{result.run.plan_id}</dd><dt>Run</dt><dd>{result.run.id}</dd><dt>Engine runtime</dt><dd>{result.run.runtime_ms} ms</dd></dl>
      {result.validation.issues.length > 0 && <details><summary>Plan validation issues ({result.validation.issues.length})</summary><ul>{result.validation.issues.map((issue, index) => <li key={index}>{issue.severity}: {issue.field} — {issue.message}</li>)}</ul></details>}
      <details><summary>Original engine output</summary><pre>{JSON.stringify(result.run.output, null, 2)}</pre></details>
    </div>}
  </section>
}
