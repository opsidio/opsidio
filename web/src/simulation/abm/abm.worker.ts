import { executeAbmRequest } from './generator'
import { createConfigHash } from './worker-protocol'
import type { AbmWorkerRequest, AbmWorkerResponse } from './worker-protocol'

// DOM-only project libs: narrow the worker global instead of adding conflicting lib declarations.
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<AbmWorkerRequest>) => void) | null
  postMessage: (response: AbmWorkerResponse) => void
}

worker.onmessage = ({ data }) => {
  if (data.configHash !== createConfigHash(data.config)) {
    worker.postMessage({
      type: 'error', requestId: data.requestId, layoutRevision: data.layoutRevision,
      configHash: data.configHash, error: 'ABM config hash does not match the submitted snapshot.',
    })
    return
  }
  worker.postMessage(executeAbmRequest(data))
}
