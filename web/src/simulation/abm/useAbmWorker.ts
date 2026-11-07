import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AbmConfig, AbmResult } from '../runtime-types'
import { createConfigHash, isCurrentAbmResponse } from './worker-protocol'
import type { AbmRunIdentity, AbmWorkerRequest, AbmWorkerResponse } from './worker-protocol'

export type AbmStatus = 'idle' | 'running' | 'ready' | 'error'

/** Explicit runs; config/revision edits invalidate pending and displayed results. */
export function useAbmWorker(config: AbmConfig | null, layoutRevision: number) {
  const configHash = useMemo(() => config ? createConfigHash(config) : null, [config])
  const worker = useRef<Worker | null>(null)
  const current = useRef<AbmRunIdentity | null>(null)
  const sequence = useRef(0)
  const [state, setState] = useState<{
    identity: AbmRunIdentity | null; result: AbmResult | null; status: AbmStatus; error: string | null
  }>({ identity: null, result: null, status: 'idle', error: null })

  const stopWorker = useCallback(() => {
    current.current = null
    worker.current?.terminate()
    worker.current = null
  }, [])
  const cancel = useCallback(() => {
    stopWorker()
    setState({ identity: null, result: null, status: 'idle', error: null })
  }, [stopWorker])

  useEffect(() => {
    cancel()
    return stopWorker
  }, [configHash, layoutRevision, cancel, stopWorker])

  const generate = useCallback(() => {
    stopWorker()
    if (!config || !configHash) {
      setState({ identity: null, result: null, status: 'error', error: 'An ABM config is required.' })
      return
    }
    const identity: AbmRunIdentity = { requestId: `abm-${++sequence.current}`, layoutRevision, configHash }
    current.current = identity
    setState({ identity, result: null, status: 'running', error: null })
    try {
      const instance = new Worker(new URL('./abm.worker.ts', import.meta.url), { type: 'module' })
      worker.current = instance
      instance.onmessage = ({ data }: MessageEvent<AbmWorkerResponse>) => {
        if (!isCurrentAbmResponse(data, current.current)) return
        instance.terminate()
        if (worker.current === instance) worker.current = null
        if (data.type === 'result') setState({ identity, result: data.result, status: 'ready', error: null })
        else setState({ identity, result: null, status: 'error', error: data.error })
      }
      instance.onerror = event => {
        if (!isCurrentAbmResponse({ type: 'error', ...identity, error: '' }, current.current)) return
        instance.terminate()
        if (worker.current === instance) worker.current = null
        setState({ identity, result: null, status: 'error', error: event.message || 'ABM worker failed.' })
      }
      const request: AbmWorkerRequest = { type: 'generate', ...identity, config }
      instance.postMessage(request)
    } catch (error) {
      stopWorker()
      setState({ identity, result: null, status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [config, configHash, layoutRevision, stopWorker])

  // Hide an obsolete result immediately, including the render before effect cleanup.
  const matches = state.identity?.configHash === configHash && state.identity?.layoutRevision === layoutRevision
  return {
    result: matches ? state.result : null,
    status: matches || state.identity === null ? state.status : 'idle' as AbmStatus,
    error: matches || state.identity === null ? state.error : null,
    generate, cancel,
  }
}
