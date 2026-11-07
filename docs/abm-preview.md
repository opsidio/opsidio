# Deterministic ABM journey preview

This worker generates fictional demand and movement on an authored directed graph. Optional bound operators add fixed-time FIFO scan/security processing. Local V1 reports waiting, processing and admitted counts from that model. Doni's API supplies optimization and its own DES verification. Real walkability, collision avoidance and physical crowd pressure still require a different level of venue validation and modeling.

## Inputs and semantics

`generateAbm(config: AbmConfig): AbmResult` is pure and deterministic. Config comes from the frozen `web/src/simulation/runtime-types.ts` contract. Coordinates are local metres; walking time is Euclidean polyline distance divided by the explicit `walkSpeedMps`. Inputs are not mutated.

- `timeOrigin` is an ISO timestamp with an explicit timezone. All output seconds are relative to it.
- Arrival windows must be finite, non-overlapping, within the positive horizon, and have shares summing to 100. Windows are start-inclusive and end-exclusive. Zero-share windows receive no arrivals.
- Windows are selected by their probability share for each group; shares are **not exact attendance quotas**. Every valid cohort receives exactly its requested integer attendance. Groups share their onsite timestamp and route. A smaller final group preserves residual attendance.
- Each cohort uses its own seeded random stream. Input node, edge, cohort, and window ordering does not alter results. Person and group IDs are stable across seeds.
- Routes follow shortest geometric distance on directed edges. Stable node-ID order breaks equal-distance ties. Graph node positions are the resolved geometry; callers must resolve placement attachments before generation.
- `onsiteArrivalSeconds` is arrival at the origin. `checkpointArrivalSeconds` is arrival at the **first checkpoint** on the route. `walkSeconds` covers the entire route to the destination.
- Invalid or unreachable cohort routes produce issues and no journeys for those cohorts. Routes without a checkpoint are invalid; a shortest route that bypasses all checkpoints is not replaced by an invented detour. Malformed/duplicate graph nodes or edges invalidate the entire graph. Duplicate cohort IDs invalidate all cohorts with that ID.
- The `arrivalBuckets` list is sparse, sorted by cohort and then time, with half-open 15-minute intervals and separate onsite/checkpoint counts. Walking may carry checkpoint arrival past the generation horizon; these arrivals are retained in later buckets. Missing buckets mean zero. The horizon limits onsite generation, not walking completion.
- The preview rejects requested populations above 1,000,000 to bound browser memory. The included 70,000-person test uses a synthetic shared route; it does not validate all GBK entry-area routes.

## Worker integration

```ts
import { createConfigHash, isCurrentAbmResponse } from './abm/worker-protocol'
import type { AbmWorkerRequest, AbmWorkerResponse } from './abm/worker-protocol'

const worker = new Worker(new URL('./abm/abm.worker.ts', import.meta.url), { type: 'module' })
const identity = { requestId: crypto.randomUUID(), layoutRevision, configHash: createConfigHash(config) }
const request: AbmWorkerRequest = { type: 'generate', ...identity, config }
worker.onmessage = ({ data }: MessageEvent<AbmWorkerResponse>) => {
  if (!isCurrentAbmResponse(data, currentIdentity)) return
  // data.type === 'result': data.result; data.type === 'error': data.error.
  // Also show result.issues; a result may contain only the valid cohorts.
}
worker.postMessage(request)
```

Set `currentIdentity` to the submitted identity; clear it as soon as the config or layout changes. Every response echoes request ID, layout revision, and config hash. The worker rejects a config/hash mismatch. The hash is a deterministic snapshot marker, not a security hash. Terminate the worker to cancel an in-flight synchronous generation.

When passing demand to DES alongside plan walking distances, use **onsite** buckets so walking is counted once.

The React wrapper handles this lifecycle:

```tsx
import { useAbmWorker } from './abm/useAbmWorker'

const { result, status, error, generate, cancel } = useAbmWorker(config, layout.revision)
// status: 'idle' | 'running' | 'ready' | 'error'.
// Call generate() from Run; cancel() terminates the worker and clears the result.
// Replacing config or changing its hash/revision invalidates the previous run.
// Use immutable config snapshots. Show result.issues even when status is 'ready'.
```

## Renderer sampling

`prepareJourneySampler(result.journeys)` compiles typed arrays once, deduplicates route geometry, and precomputes cumulative lengths. `sampleJourneyPosition(sampler, index, timeSeconds, output, offset?)` writes XYZ without allocating and returns `not-arrived`, `walking`, or `arrived`; endpoints are clamped before/after walking.

`sampleWalkingCrowd(sampler, timeSeconds, positions, journeyIndices, reusableStats)` writes a packed set of active walkers and their original journey indices. Buffers determine the cap. It returns `{ visibleCount, walkingCount }` through the reusable stats object. Capped samples are spread evenly over all active journeys in arrival-time order, rather than taking the first cohort or earliest people. Binary searches limit scanning to the arrival interval that can still contain walkers; route interpolation uses precomputed cumulative lengths. Backward scrubbing works without mutable simulation state. If every journey can still be walking, the candidate interval can include the full population.

Inside the existing React Three Fiber Canvas:

```tsx
import { CrowdPreview } from './abm/CrowdPreview'

{result && <CrowdPreview
  result={result}
  clockRef={simulationClockRef}
  maxVisible={5000}
  onSampleStats={setCrowdStats}
/>}
```

`clockRef` is an optional `{ current: number }` of simulation seconds. The parent can advance it in `useFrame` using `delta * playbackRate`, and update a timeline label less frequently. Pass `timeSeconds={seconds}` instead for paused/manual scrubbing. When both are supplied, the ref wins. Keep the clock in the parent's timeline layer; the preview does not advance time itself.

`CrowdPreview` renders instanced bodies and heads for walking, waiting and processing states. `onSampleStats` reports visible, walking, waiting, processing and completed counts at most four times per second. Waiting visitors fill the authored queue segment and advance toward service in FIFO order. The panel separates the people shown from those waiting off-scene. Wait colors progress from yellow to red; teal identifies processing. Display spacing is illustrative. The clock stays in the parent timeline layer.

## Verification

```sh
node --experimental-strip-types --test web/src/simulation/abm/abm.test.mjs
```

Tests cover repeat seeds, group residuals, 70,000 exact cohort counts, shortest paths and ties, invalid windows, duplicate/malformed graphs, unreachable routes, bucket conservation, worker identity, position interpolation, and capped crowd sampling.

## Optional operator processing

`AbmConfig.serviceStations` binds checkpoint nodes to single operators with a fixed typical process duration and opening/closing seconds. `CohortDemand.laneCheckpointIds` lists the authored open lane choices. Whole arriving groups are assigned round-robin, preserving seeded onsite arrival times when lane options change. Each person then queues FIFO and is processed individually. Journey service stops and completion times drive waiting, processing and continuing movement states. Stations with a fenced queue can reference `queue_start_node_id` and `queue_end_node_id` in `spatial_context.service_stations`. The worker uses the entrance waypoint to start the queue clock and schedules service after the approach walk. The renderer uses both waypoints for the pen and the walk to the operator. The renderer keeps people inside the drawn pen while they wait for call-up; any overflow stays off-scene. In the GBK plan, everyone passes the help desk first. The seeded help share in each behavior profile sends whole ticket-issue groups through the help checkpoint before security and scan. The final admission route has no return path.
