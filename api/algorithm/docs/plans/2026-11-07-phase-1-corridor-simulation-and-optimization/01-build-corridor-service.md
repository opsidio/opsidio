---
task: 01-build-corridor-service
jira: null
system: algorithm
model: sonnet
depends_on: []
boundary: donisury21/first-deploy-algorithm
---

# Build the phase 1 corridor service

> Use `superpowers:subagent-driven-development` once for this group. Dispatch three tiered builders with exclusive file ownership.

**Goal:** Produce one runnable, tested service implementing the entire approved phase 1 design.
**Spec:** [Approved design](../../specs/2026-11-07-phase-1-corridor-simulation-and-optimization-design.md).
**Boundary:** `donisury21/first-deploy-algorithm`; one eventual MR; no task dependencies.
**Prerequisites:** Explicit later instruction to execute. No calibration, fixture freeze, feasibility project, or second contract approval is required.
**Constraints:** All constraints, deadlines, and review conditions in [the overview](00-overview.md) apply.

All paths below are relative to `api/algorithm/`. All commands run from `api/algorithm/api/`, unless stated otherwise.
Read global coding guidelines before the first code edit. Inspect deeper instructions before creating files.

## File ownership

| Owner | Exclusive files | Responsibility |
| --- | --- | --- |
| Coordinator | `api/openapi.yaml`; `docs/specs/references/2026-11-07-v2-full-scope.openapi.yaml` | Archive and phase-specific contract |
| Coordinator | `api/pyproject.toml`; `api/uv.lock`; `api/.python-version`; `api/.gitignore`; `api/src/algorithm_api/__init__.py` | Python 3.12 package and startup dependencies |
| Coordinator | `api/examples/corridor-plan.json`; `api/README.md` | Compact example, startup, limits, and API use |
| Coordinator | `api/tests/e2e/conftest.py`; `api/tests/e2e/test_corridor.py` | Actual-process HTTP acceptance and restart harness |
| Coordinator | This plan's `execution-log.md` and `open-questions.md` | Evidence, timing, unresolved non-blocking items |
| Builder A (`sol`) | `api/src/algorithm_api/models.py` | Strict input/output models, validation, canonical hashes, exact costs |
| Builder B (`astra`) | `api/src/algorithm_api/engine.py` | Visitor event schedule, horizon metrics, lane search |
| Builder C (`sol`) | `api/src/algorithm_api/store.py`; `api/src/algorithm_api/app.py` | Persistence, atomic replay, concurrency, security, HTTP |

No builder edits another owner's files. Send interface changes to the coordinator before using them.
A coordinator transfer of ownership requires an explicit handoff and a stopped previous writer.

## Interfaces to freeze before dispatch

Use Pydantic v2 models with `extra='forbid'` recursively. JSON field names follow the design without aliases.
The coordinator writes these names into the contract and sends this section to all workers.

### Models owned by A

- `PlanDocument`: all required fields from design section 4, with its complete validation rules.
- `Money`: `amount` as a two-fractional-digit nonnegative decimal string; `currency` fixed to `IDR`.
- `RunOutput`: design section 6 metrics, including `population.unfinished_by_state` with four integer state counts.
- `PlanResource`: `id`, nullable `parent_id`, `document`, `snapshot_hash`, `created_at`.
- `RunResource`: exact fields in design section 6; `output: RunOutput`, `limitations: list[str]`.
- `Evaluation`: `lanes: int`, `status: Literal['completed', 'excluded_budget']`, nullable `score: tuple[int, int, int]`.
- `OptimizationResource`: design section 7 fields plus `evaluations: list[Evaluation]`.
- `canonical_hash(value: object) -> str`: SHA-256 of sorted-key, compact, UTF-8 canonical JSON; reject nonfinite values.
- `lane_cost_minor(plan: PlanDocument, lanes: int) -> int`: exact combined per-lane costs times active lanes.
- `money_from_minor(value: int) -> Money`: exact two-digit IDR serialization.

`RunResource.engine_version` starts at `1.0.0`; `model_id` is `corridor_v1`.
Plan snapshot hashes include the complete validated document. Idempotency hashes use parsed submitted JSON before model defaults.
Canonicalization sorts keys recursively, retains array order, and uses JSON-mode model data for validated plans.
Validate coordinates as finite numbers; preserve their validated numeric representation in the snapshot.

### Engine owned by B

- `simulate(plan: PlanDocument, *, deadline: float) -> RunOutput`.
- `score(output: RunOutput, plan: PlanDocument) -> tuple[int, int, int]`.
- `compare_lanes(plan: PlanDocument, *, deadline: float) -> Comparison`.
- `ComputationTimeout(Exception)`: raised when simulation or the baseline cannot complete before its monotonic deadline.
- `Comparison`: dataclass in `engine.py` with `baseline: RunOutput`, `best: RunOutput`, `best_plan: PlanDocument | None`, `evaluations: list[Evaluation]`, `stop_reason: Literal['completed', 'time_limit']`.

`compare_lanes` caps each simulation deadline at the earlier of the search deadline and now plus two seconds.
A later candidate timeout returns the completed comparison with `time_limit`; the incomplete evaluation is omitted.
If nothing improves, `best` is the baseline and `best_plan` is null. No I/O, resource IDs, or timestamps belong in the engine.

### Persistence and application owned by C

- `Store(path: str)`: initialize SQLite schema and connection settings.
- `Store.get_plan(id: str) -> PlanResource | None`; corresponding `get_run` and `get_optimization` return their resource types.
- `Store.get_replay(operation: str, target: str, key: str, *, now: datetime) -> Replay | None`.
- `Replay`: stored request hash, status code, response JSON, expiry; define in `store.py`.
- `Store.commit_resources(*, plans: list[PlanResource], runs: list[RunResource], optimizations: list[OptimizationResource], replay: ReplayWrite | None) -> None`.
- `ReplayWrite`: operation, target, key, request hash, status code, response JSON, expiry; define in `store.py`.
- `create_app(*, database_path: str, api_key: str) -> FastAPI`; module-level `app` reads `DATABASE_PATH` and `API_KEY`.

Use one nonblocking process mutation lock. Recheck replay inside the lock before computation.
Execute POST computation outside the event loop so GET requests remain available. Release the lock on every outcome.
Construct IDs and UTC timestamps in the application. Persist all result references and replay together after successful computation.
No candidate: `best_run_id == baseline_run_id`, `candidate_plan_id == null`, `improved == false`.
With improvement, persist baseline Run, candidate Plan, candidate Run, and Optimization atomically.
The candidate Run references the candidate Plan and its new hash. The baseline Run references the original Plan.

## Execution steps

### P0: Coordinator setup and contract, minutes 0–5

- [ ] Start the monotonic clock and record absolute deadlines before any execution work.
- [ ] Inspect status and instructions; preserve unrelated files. Record branch, tool availability, and the starting contract hash.
- [ ] Copy the current service contract to the specified v2 reference; compare bytes before replacing the service contract.
- [ ] Author all seven phase 1 operations in OpenAPI 3.1 version `3.0.0`, including exact schemas, examples, statuses, auth, and replay headers.
- [ ] Describe all errors: 401, 404, 409, 413, 422, 429 with `Retry-After`, and 503 `computation_timeout` where applicable.
- [ ] Lint offline with the final lint command. Require zero warnings, including on public health; document its explicit responses.
- [ ] Freeze the interfaces above. Stop for approval only if a material deviation from the approved design is necessary.
- [ ] Create the package manifest with FastAPI, Pydantic v2, uvicorn, and test dependencies pytest and HTTPX. Generate `uv.lock` during this window.
- [ ] Dispatch A, B, and C concurrently. Include ownership, full spec link, interfaces, shared deadline, and the instruction to preserve others' edits.

### P1: Builder A validation, minutes 5–30

- [ ] Implement the models and helpers above. Enforce all required fields, unknown-field rejection, and `corridor-1` only.
- [ ] Enforce 3–32 unique route nodes, internal scan reference, finite coordinates, equal Y, and coincident-node acceptance.
- [ ] Enforce 1–500 visitors, positive speed/horizon, nonnegative service, ordered arrival bounds, and horizon at most 86400.
- [ ] Enforce 1–8 lanes, integer capacities 0–8, resource feasibility, integer queue target, IDR format, and starting budget feasibility.
- [ ] Ensure Pydantic coercion cannot turn booleans or fractional values into accepted integer counts.
- [ ] Implement exact costs, canonical hashes, result types, and field-level error locations.
- [ ] Hand off import names and validation behavior. Report completion or blockers to the coordinator.

### P2: Builder B engine, minutes 5–30

- [ ] Sum 3D segment lengths before/after scan. Generate visitor arrivals using `start + i * (end - start) / n`.
- [ ] Schedule FCFS service by visitor index, earliest availability, and lane index. Release completed service before equal-time assignments.
- [ ] Measure waiting on half-open intervals; exclude service occupants and immediate starts from peak queue.
- [ ] Clip all state and walking metrics at the horizon. Admission exactly at the horizon counts; conserve the population.
- [ ] Compute nearest-rank wait P90 over visitors who started service by the horizon, including zero waits. Return null with zero samples.
- [ ] Check deadlines during visitor and candidate processing. Never return an incomplete simulation result.
- [ ] Evaluate baseline then feasible higher lanes through `min(slots, staff, scanners, 8)`. Record budget exclusions.
- [ ] Rank `(unfinished, max(0, peak_queue - target), total_cost_minor_units)` lexicographically; break exact ties by fewer lanes.
- [ ] Return a candidate only for a strictly better completed score, changing only `scan.lanes`. Preserve best completed results on later timeout.
- [ ] Hand off completed interfaces and algorithm limitations.

### P3: Builder C HTTP and storage, minutes 5–30

- [ ] Create parameterized SQLite tables for immutable Plans, Runs, Optimizations, and scoped replay records, with foreign keys.
- [ ] Configure WAL and busy timeout 5000 ms; keep writes in short transactions after computation.
- [ ] Implement the seven contract operations and disable `/docs`, `/redoc`, and `/openapi.json`.
- [ ] Compare API keys with `secrets.compare_digest`; use shared error envelopes and field-level validation details. Never log keys or documents.
- [ ] Enforce body size while reading streamed chunks, even without `Content-Length`; reject malformed JSON through the shared validation envelope.
- [ ] Implement scoped 24-hour replay. Identical canonical request JSON replays status/body; changed content returns 409.
- [ ] Reject concurrent POST work with 429 and `Retry-After: 1`; keep GET requests responsive and recheck replay under the mutation lock.
- [ ] Map simulation/baseline deadline failures to 503 with no incomplete resources. Persist later timeout comparisons with `time_limit`.
- [ ] Commit all result resources and successful replay in one transaction. Restart must leave either all committed references or none.
- [ ] Hand off startup settings and HTTP behavior.

### P4: Coordinator executable acceptance, minutes 5–50

Author the following journeys while builders work. Start the actual uvicorn application on a local free port using a temporary database and test key.
Use HTTPX over HTTP, never an in-process client. Bound startup waits, requests, subprocess lifetime, and suite runtime.
The entire suite must stop within 180 seconds or the shorter remaining execution budget. Always stop owned child processes.
Use fixture variants of the exact design example; do not reuse frozen v2 manifests.

- [ ] `test_lifecycle_security`: assert public health 200; each protected operation rejects missing/wrong keys with 401; saved resources round-trip; legacy/docs/schema routes return 404.
- [ ] `test_exact_walking`: one visitor, zero service, 5 m route at 1 m/s is admitted at horizon 5 and unfinished just before 5. Repeat with 10 m and boundary 10. Assert distance and free-flow outputs.
- [ ] `test_scan_queue_and_candidate`: design example at horizon 30 gives admitted 2, unfinished 0, peak 1, wait P90 10, sample count 2, costs 100/50/150 IDR, and observed walking 10 seconds.
- [ ] In that journey, use horizon probes at 15 and 25 to establish both original admission times through HTTP.
- [ ] Optimize the example: best lanes 2, admissions both at 15, peak/P90 zero, total 300. Assert real baseline/best Run IDs, candidate parent, candidate hash, and only lane-count change.
- [ ] `test_resource_limits_and_ties`: vary slots, staff, scanners, and budget independently to prevent extra lanes. Assert excluded budget counts; one visitor retains cheaper baseline and null candidate.
- [ ] `test_horizon_arrivals_and_repeatability`: horizon 20 gives one admitted and one scanning. Shift arrivals by 3 and probe matching admission boundaries 18/28. Repeat identical inputs and compare computed outputs excluding IDs/timestamps/runtime metadata.
- [ ] Assert conservation, exact cost arithmetic, all three checks, and all four unfinished classifications using horizon/route variants.
- [ ] `test_timestamp_edges`: completion equals next arrival, simultaneous arrivals, zero service, and coincident nodes preserve deterministic ties and zero-wait queue behavior.
- [ ] `test_no_wait_samples`: horizon before first scan arrival yields null P90, zero sample count, and correctly clipped walking time.
- [ ] `test_validation_and_body_limit`: reject bad scan references, duplicate IDs, elevation, NaN/infinity, unknown nested fields, legacy schema, invalid money, resource/cost violations, and count bounds with field-level 422 details. Reject a body at least 1 MiB with 413, including chunked transfer.
- [ ] `test_replay_and_restart`: test every POST's identical replay and changed-content 409. Restart on the same database; fetch original/candidate plans, both Runs, Optimization references, and identical replay bodies/statuses.
- [ ] Assert key scope isolation across operation/target and equivalent JSON key ordering. Test 24-hour expiry through persisted expiry metadata in the temporary database, without changing computed outputs.
- [ ] `test_contention_and_timeouts`: exercise real HTTP concurrent POST and GET; when computation owns the lock, the competing POST returns 429 with header 1 while GET succeeds.
- [ ] Use an external test-process supervisor pause/resume to force real monotonic deadline expiry during computation; use no fake results or engine imports. Assert 503/no saved partial resources for baseline timeout, and `time_limit` with only completed evaluations for a later candidate timeout.
- [ ] Coordinate the process barrier with an observed request-start signal; repeat only within the suite deadline. Do not weaken a required check when timing is hard to reproduce.

The spec does not prescribe test synchronization mechanics. A reliable observable barrier may require test-harness instrumentation.
Keep that instrumentation outside production behavior and record the method and its limitations. Stop if proving required behavior needs a material API change.

### P5: Integrate and finish, minutes 30–60

- [ ] Collect handoffs. Integrate imports, schemas, and references; send fixes to the file owner while that builder is active.
- [ ] Create `examples/corridor-plan.json` from the design. Add a README with limits, model limitations, curl lifecycle, and complete startup command:

```text
uv sync --locked
API_KEY=local-test-key DATABASE_PATH=./corridor.sqlite3 uv run uvicorn algorithm_api.app:app --host 127.0.0.1 --port 8000
```

- [ ] Ignore local SQLite files and runtime artifacts. Verify README commands use no owner credentials.
- [ ] Run the complete E2E suite and correct failures before minute 50. Stop adding features at minute 50.
- [ ] Run the three final commands in the overview during minutes 50–57, with remaining-time subprocess limits.
- [ ] Confirm restart evidence, byte-identical v2 archive, unchanged contract symlink, compact example, manifest/lockfile, and README startup.
- [ ] Check every design section against the delivered behavior. Inspect only owned diffs; preserve historical fixtures and unrelated changes.
- [ ] During minutes 57–60, terminate owned processes and workers. Record exact results, actual tiers, elapsed time, and remaining work.
- [ ] Mark the group complete only after all acceptance passes within the hour. If time expires or a blocker occurs, record `incomplete` and stop.
- [ ] If time remains and completion is established, commit only this group's files with an imperative message. Commit time counts; no merge or deploy is authorized.

## Required handoff

Each builder reports files changed, implemented interfaces, checks observed, unresolved issues, and remaining time.
The coordinator records the task outcome before any later task starts. No other merge task is authorized by this plan.
