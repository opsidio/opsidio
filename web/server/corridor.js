import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const DONI_ORIGIN = 'https://opsidio-api-production.up.railway.app'
const REQUEST_BYTES = 32 * 1024
const RESPONSE_BYTES = 128 * 1024
const UPSTREAM_TIMEOUT_MS = 20_000
const decoder = new TextDecoder('utf-8', { fatal: true })

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const inRange = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max
const hasId = (value, prefix) => typeof value === 'string' && value.length === 36
  && value.startsWith(prefix) && /^[0-9a-f]{32}$/.test(value.slice(4))
const laneLimit = scan => Math.min(scan.physical_slots, scan.available_staff, scan.available_scanners)

class BridgeFailure extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  })
}

function error(status, code, message, headers) {
  return json({
    status: status === 504 ? 'timeout' : status === 503 ? 'unconfigured' : 'error',
    error: { code, message },
  }, status, headers)
}

function apiKey() {
  const key = process.env.OPSIDIO_CORRIDOR_API_KEY?.trim()
  return key && /^[\x20-\x7e]+$/.test(key) ? key : null
}

function methodNotAllowed(method) {
  return error(405, 'method_not_allowed', `Use ${method} for this route.`, { Allow: method })
}

export function corridorHealth(request) {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const configured = Boolean(apiKey())
  return json({ status: configured ? 'configured' : 'unconfigured', configured, upstream_checked: false })
}

async function readJson(message, maxBytes) {
  if (Number(message.headers.get('content-length')) > maxBytes) return undefined
  const reader = message.body?.getReader()
  if (!reader) throw new TypeError('JSON body is missing.')
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    return JSON.parse(decoder.decode(Buffer.concat(chunks, bytes)), (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.')
      return value === 0 ? 0 : value
    })
  } finally {
    reader.releaseLock()
  }
}

function validDocument(plan) {
  if (!isObject(plan) || plan.schema_version !== 'corridor-1') return false
  const { scan, arrivals, route, horizon_seconds: horizon } = plan
  return isObject(scan) && ['lanes', 'physical_slots', 'available_staff', 'available_scanners'].every(field => inRange(scan[field], 1, 8))
    && scan.lanes <= laneLimit(scan)
    && isObject(arrivals) && inRange(arrivals.count, 1, 500)
    && isObject(route) && Array.isArray(route.nodes) && inRange(route.nodes.length, 3, 32)
    && Number.isFinite(horizon) && horizon > 0 && horizon <= 86400
}

// Match the canonical Python digest for JSON emitted by this bridge. Its JSON
// encoder uses scientific notation below 1e-4 and pads single-digit exponents.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  if (typeof value === 'number' && value !== 0 && Math.abs(value) < 1e-4) {
    return value.toExponential().replace(/e-(\d)$/, 'e-0$1')
  }
  return JSON.stringify(value)
}

const hash = document => createHash('sha256').update(canonicalJson(document)).digest('hex')
const invalidResponse = () => new BridgeFailure(502, 'upstream_invalid_response', 'Doni returned a corridor result that does not match the submitted plan.')

function checkPlan(plan, id, parentId, document) {
  if (!hasId(plan.id, 'pln_') || (id !== null && plan.id !== id) || plan.id === parentId
    || plan.parent_id !== parentId || !isDeepStrictEqual(plan.document, document) || plan.snapshot_hash !== hash(document)) {
    throw invalidResponse()
  }
}

function checkOptimization(result, planId) {
  const { id, plan_id, baseline_run_id: baseline, best_run_id: best, candidate_plan_id: candidate, improved, stop_reason, evaluations } = result
  if (!hasId(id, 'opt_') || plan_id !== planId || !hasId(baseline, 'run_') || !hasId(best, 'run_')
    || typeof improved !== 'boolean' || !['completed', 'time_limit'].includes(stop_reason)
    || !Array.isArray(evaluations) || evaluations.length > 8
    || (improved ? !hasId(candidate, 'pln_') || candidate === planId || best === baseline : candidate !== null || best !== baseline)) {
    throw invalidResponse()
  }
}

function checkRun(run, id, plan) {
  const { output } = run
  if (run.id !== id || run.plan_id !== plan.id || run.snapshot_hash !== plan.snapshot_hash || run.model_id !== 'corridor_v1'
    || !isObject(output) || !['population', 'walking', 'scan', 'costs', 'checks'].every(field => isObject(output[field]))) {
    throw invalidResponse()
  }
  const { population, scan } = output
  const total = plan.document.arrivals.count
  if (population.total !== total || !inRange(population.admitted, 0, total) || !inRange(population.unfinished, 0, total)
    || population.admitted + population.unfinished !== total || scan.lanes !== plan.document.scan.lanes
    || !inRange(scan.peak_queue, 0, total)
    || (scan.wait_p90_seconds !== null && (!Number.isFinite(scan.wait_p90_seconds) || scan.wait_p90_seconds < 0))) {
    throw invalidResponse()
  }
}

async function compare(document, key) {
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  async function upstream(path, body, idempotencyKey) {
    const response = await fetch(`${DONI_ORIGIN}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        'X-API-Key': key,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 408 || response.status === 504) {
        throw new BridgeFailure(504, 'upstream_timeout', 'Doni’s optimizer timed out. Retry the same comparison to recover its result.')
      }
      const status = [413, 422, 429].includes(response.status) ? response.status : 502
      throw new BridgeFailure(status, 'upstream_http_error', `Doni’s API returned HTTP ${response.status}.`)
    }
    let value
    try { value = await readJson(response, RESPONSE_BYTES) }
    catch (cause) {
      if (signal.aborted) throw cause
      throw invalidResponse()
    }
    if (!isObject(value)) throw invalidResponse()
    return value
  }

  const plan = await upstream('/v3/plans', document, `opsidio-corridor-plan-v1-${hash(document)}`)
  checkPlan(plan, null, null, document)

  const optimization = await upstream(`/v3/plans/${plan.id}/optimize`, {}, `opsidio-corridor-opt-v1-${plan.id}`)
  checkOptimization(optimization, plan.id)

  const baseline = await upstream(`/v3/runs/${optimization.baseline_run_id}`)
  checkRun(baseline, optimization.baseline_run_id, plan)
  if (!optimization.improved) return { plan, optimization, baseline, best: baseline, candidate: null }

  const candidate = await upstream(`/v3/plans/${optimization.candidate_plan_id}`)
  const lanes = candidate.document?.scan?.lanes
  if (!inRange(lanes, document.scan.lanes + 1, laneLimit(document.scan))) throw invalidResponse()
  checkPlan(candidate, optimization.candidate_plan_id, plan.id, { ...document, scan: { ...document.scan, lanes } })

  const best = await upstream(`/v3/runs/${optimization.best_run_id}`)
  checkRun(best, optimization.best_run_id, candidate)
  return { plan, optimization, baseline, best, candidate }
}

export async function optimizeCorridor(request) {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if ((origin && origin !== new URL(request.url).origin) || (fetchSite && fetchSite !== 'same-origin')) {
    return error(403, 'cross_origin_request', 'Start the comparison from the Opsidio workspace.')
  }
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'unsupported_media_type', 'Send application/json.')
  }
  const key = apiKey()
  if (!key) return error(503, 'corridor_bridge_unconfigured', 'Configure the corridor API key on the server.')

  let body
  try { body = await readJson(request, REQUEST_BYTES) }
  catch { return error(400, 'invalid_json', 'The request body must contain valid JSON.') }
  if (body === undefined) return error(413, 'body_too_large', 'The corridor request exceeds 32 KiB.')
  if (!validDocument(body?.plan)) {
    return error(422, 'validation_failed', 'Provide a corridor plan with up to 500 arrivals, 32 route nodes, eight lanes, and a 24-hour horizon.')
  }

  try {
    return json(await compare(body.plan, key))
  } catch (cause) {
    if (cause instanceof BridgeFailure) return error(cause.status, cause.code, cause.message)
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
      return error(504, 'corridor_timeout', 'The corridor comparison exceeded its time limit. Retry the same sample to recover its result.')
    }
    return error(502, 'upstream_unreachable', 'Opsidio could not reach Doni’s corridor API.')
  }
}
