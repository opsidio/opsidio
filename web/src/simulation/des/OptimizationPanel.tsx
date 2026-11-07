import { useEffect, useRef, useState } from 'react'
import { getDesHealth, isObject, type DesHealth } from './client'

type Job = { id: string; status: string; candidates?: { plan_id: string; kind: string; recommended: boolean; score?: { missed_checks: number; shortfall: number; cost_idr: number } }[]; error?: { message: string } | null }
async function call(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/simulation/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = isObject(data) && isObject(data.error) ? data.error : null
    const details = error && Array.isArray(error.details) ? error.details.map(issue => isObject(issue) ? `${String(issue.field)} — ${String(issue.message)}` : '').join('\n') : ''
    throw new Error(`${typeof error?.message === 'string' ? error.message : `API request failed (${response.status})`}${details ? `\n${details}` : ''}`)
  }
  return data
}
export default function OptimizationPanel({ plan, baseSeed, disabled, onLoad }: { plan: unknown; baseSeed: number; disabled: boolean; onLoad?: (plan: unknown) => void }) {
  const [health, setHealth] = useState<DesHealth | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<unknown>(null)
  const generation = useRef(0)
  async function refresh() {
    try { setHealth(await getDesHealth()) }
    catch (error) { setError(error instanceof Error ? error.message : 'Cannot reach the local API bridge.') }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { generation.current++; setJob(null); setCandidate(null); setBusy(false); setError(null) }, [plan, baseSeed])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    const identifier = job.id, token = generation.current
    let active = true
    let timeout: ReturnType<typeof setTimeout>
    async function poll() {
      let finished = false
      try {
        const next = await call(`optimizations/${identifier}`)
        if (active && token === generation.current && isObject(next) && next.id === identifier && typeof next.status === 'string') {
          finished = !['queued', 'running'].includes(next.status)
          setJob(next as Job)
          setError(null)
        }
      } catch (error) {
        if (active && token === generation.current) setError(error instanceof Error ? error.message : 'Cannot read optimization progress.')
      }
      if (active && token === generation.current && !finished) timeout = setTimeout(() => void poll(), 3000)
    }
    timeout = setTimeout(() => void poll(), 3000)
    return () => { active = false; clearTimeout(timeout) }
  }, [job?.id, job?.status])
  async function start() {
    const token = ++generation.current
    setBusy(true); setError(null); setJob(null); setCandidate(null)
    try {
      const result = await call('optimize', { plan, base_seed: baseSeed, replications: 20 })
      if (token === generation.current && isObject(result) && isObject(result.optimization)) setJob(result.optimization as Job)
    } catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : 'Optimization failed.') }
    finally { if (token === generation.current) setBusy(false) }
  }
  async function loadCandidate(id: string) {
    const token = generation.current
    try {
      const result = await call(`plans/${id}`)
      if (token === generation.current && isObject(result)) { setCandidate(result.document); onLoad?.(result.document) }
    } catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : 'Cannot load candidate.') }
  }
  function downloadCandidate() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(candidate, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'opsidio-candidate-v2.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section aria-label="Doni optimization">
    <p>V1 runs locally. Optimize submits this plan snapshot to Doni’s API and returns candidate plans for V2.</p>
    <p>{health?.configured ? 'API bridge configured' : 'API access needs configuration'}</p>
    <div className="simulation-actions"><button onClick={() => void refresh()}>Refresh connection</button><button disabled={disabled || busy || !health?.configured || !!job && ['queued', 'running'].includes(job.status)} onClick={() => void start()}>{busy ? 'Submitting…' : 'Optimize V1'}</button></div>
    <small>Greedy search · 60-second search limit · 20 DES verification replications. Service validation runs before optimization.</small>
    {error && <p role="alert" style={{ whiteSpace: 'pre-wrap' }}>{error}</p>}
    {job && <div role="status"><p><strong>{job.status}</strong> · {job.id}</p>{job.error && <p>{job.error.message}</p>}
      {job.candidates?.map(item => <div key={item.plan_id}><p>{item.recommended ? 'Recommended candidate' : item.kind}{item.score && ` · ${item.score.missed_checks} checks missed · IDR ${item.score.cost_idr.toLocaleString()}`}</p><button onClick={() => void loadCandidate(item.plan_id)}>Load candidate V2</button></div>)}
    </div>}
    {candidate != null && <button onClick={downloadCandidate}>Download candidate JSON</button>}
    {health && !health.configured && <p>Configure the bridge’s server environment with Doni’s service URL and API key, then refresh.</p>}
  </section>
}
