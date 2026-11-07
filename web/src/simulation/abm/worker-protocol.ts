import type { AbmConfig, AbmResult } from '../runtime-types'

export type AbmRunIdentity = { requestId: string; layoutRevision: number; configHash: string }
export type AbmWorkerRequest = AbmRunIdentity & { type: 'generate'; config: AbmConfig }
export type AbmWorkerResponse = AbmRunIdentity & (
  { type: 'result'; result: AbmResult } | { type: 'error'; error: string }
)

function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `number:${String(value)}`
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? String(value)
}

/** Stable snapshot identity, not a security hash. Includes every config field. */
export function createConfigHash(config: AbmConfig): string {
  const text = canonical(config)
  let first = 2166136261
  let second = 2246822507
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 3266489909)
  }
  return `abm1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

/** Match all three fields before showing a worker result after edits or reruns. */
export function isCurrentAbmResponse(response: AbmWorkerResponse, current: AbmRunIdentity | null): boolean {
  return current !== null && response.requestId === current.requestId
    && response.layoutRevision === current.layoutRevision && response.configHash === current.configHash
}
