/** The browser calls only the local bridge. API credentials belong to Python. */
export type JsonObject = Record<string, unknown>

export type DesHealth = {
  status: 'configured' | 'unconfigured'
  configured: boolean
  missing: string[]
  invalid: string[]
  upstream_checked: false
}

export type ValidationIssue = { severity: 'error' | 'warning'; code: string; field: string; message: string }
export type ValidationResult = { valid: boolean; issues: ValidationIssue[] }
export type DesRun = JsonObject & {
  id: string
  plan_id: string
  simulation_method: 'des'
  reused: boolean
  runtime_ms: number
  output: JsonObject & {
    scorecard?: JsonObject & { summary?: string }
    run_manifest?: JsonObject & { uncomputed_fields?: string[] }
  }
}
export type DesRunResult = {
  status: 'completed'
  plan: JsonObject & { id: string; document: JsonObject }
  validation: ValidationResult
  run: DesRun
}
export type DesFailure = {
  status: 'unconfigured' | 'invalid' | 'error' | 'timeout'
  error: { code: string; message: string; details?: { field: string; message: string; code?: string }[] }
  stage?: 'health' | 'create' | 'validate' | 'simulate'
  plan_id?: string
  validation?: ValidationResult
  upstream_status?: number
}

export class DesBridgeError extends Error {
  constructor(public readonly httpStatus: number, public readonly payload: DesFailure) {
    super(payload.error.message)
    this.name = 'DesBridgeError'
  }
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A shape check for import feedback; Doni's validator remains authoritative. */
export function planShapeError(plan: unknown): string | null {
  if (!isObject(plan) || plan.schema_version !== '0.1') return 'Import a full plan with schema_version "0.1".'
  const missing = ['event', 'venue', 'process_steps', 'staff', 'constraints'].filter(key => !isObject(plan[key]))
  return missing.length ? `The plan needs these object sections: ${missing.join(', ')}.` : null
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`/api/simulation/${path}`, { ...init, cache: 'no-store' })
  } catch {
    throw new DesBridgeError(0, { status: 'error', error: { code: 'bridge_unreachable', message: 'Cannot reach the local DES bridge. Start it and check the development proxy.' } })
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DesBridgeError(response.status, { status: 'error', error: { code: 'bridge_invalid_response', message: 'The local DES bridge did not return JSON. Check that it is running and the proxy is configured.' } })
  }
  if (!response.ok) {
    if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string' && typeof body.error.message === 'string') {
      throw new DesBridgeError(response.status, body as unknown as DesFailure)
    }
    throw new DesBridgeError(response.status, { status: response.status === 504 ? 'timeout' : 'error', error: { code: 'bridge_http_error', message: `The DES bridge returned HTTP ${response.status}.` } })
  }
  return body
}

export async function getDesHealth(): Promise<DesHealth> {
  const result = await request('health')
  if (!isObject(result) || typeof result.configured !== 'boolean' || !Array.isArray(result.missing) || !Array.isArray(result.invalid)) {
    throw new DesBridgeError(502, { status: 'error', error: { code: 'bridge_invalid_response', message: 'The DES bridge returned an invalid health response.' } })
  }
  return result as DesHealth
}

export async function runDes(plan: unknown, baseSeed: number, replications: number): Promise<DesRunResult> {
  const shapeError = planShapeError(plan)
  if (shapeError || !Number.isSafeInteger(baseSeed) || !Number.isInteger(replications) || replications < 1 || replications > 100) {
    throw new DesBridgeError(422, { status: 'invalid', error: { code: 'validation_failed', message: shapeError ?? 'Use an integer seed and 1–100 replications.' } })
  }
  const result = await request('run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, base_seed: baseSeed, replications }) })
  if (!isObject(result) || result.status !== 'completed' || !isObject(result.run) || !isObject(result.run.output)
    || !isObject(result.plan) || !isObject(result.validation) || result.run.simulation_method !== 'des'
    || typeof result.run.id !== 'string' || result.run.plan_id !== result.plan.id) {
    throw new DesBridgeError(502, { status: 'error', error: { code: 'bridge_invalid_response', message: 'The bridge returned an incomplete or mismatched DES run.' } })
  }
  return result as DesRunResult
}
