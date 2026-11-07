# Phase 2: event-entry simulation and Railway deployment

Date: 2026-11-07
Status: Approved
Scope: Broader event-entry plans, flow/DES reports, and release to the existing Railway service within one execution hour.
Repos: opsidio/opsidio; product root `api/algorithm/`.
Jira: None. Retain the recorded no-Jira exception.

## Problem

[Phase 1](2026-11-07-phase-1-corridor-simulation-and-optimization-design.md) delivers a deterministic corridor model and scan-lane comparison.
It cannot describe or evaluate the full event-entry process.
Its plans omit ticket categories, service positions, exceptions, opening schedules, staff shifts, and shared equipment rules.

The Phase 1 roadmap assigns broader event-entry plans and service reports to Phase 2.
The user also requires Railway acceptance in this phase.
Phase 1 is already deployed. Phase 2 upgrades that service while leaving offline evaluation deferred.

The current [Phase 1 execution log](../plans/2026-11-07-phase-1-corridor-simulation-and-optimization/execution-log.md#execution-2026-11-07) records completion in 15m 35s.
It records ten passing HTTP tests, contract lint, and local process restart checks.
Those results establish the corridor baseline, rather than Phase 2 engine or deployment acceptance.

## Goals

- Accept the full event-entry document and support partial plan creation, editing, and presets.
- Compute genuine flow and discrete-event simulation (DES) results from submitted plans.
- Apply eligibility, service exceptions, schedules, staffing, equipment, and cost rules.
- Return the applicable source service reports, with explicit model assumptions and uncomputed fields.
- Prove the workflows through HTTP, persistence, and deterministic examples.
- Release Phase 2 to the existing Railway service and verify authenticated workflows on its public URL.
- Prove that saved data survives redeployment.

## Non-goals

- Complete spatial agent-based simulation (ABM), collision avoidance, congestion, queue choice, or rerouting.
- Broader optimization, ABM scoring, finalist verification, or production recommendations.
- Durable optimization jobs, cancellation, recovery, model proposals, or run reuse.
- OpenAI integration, offline lab tools, benchmarks, discovery, or promotion experiments.
- Frontend changes, surveyed venue geometry, venue calibration, or a venue-readiness claim.

## Decision

### Confirmed user decisions

| Question | Decision |
| --- | --- |
| Q1 | Use the Phase 2 roadmap scope: full plans, editing, presets, flow/DES, eligibility, exceptions, schedules, and resource rules. |
| Q2 | Require live Railway deployment, authenticated HTTP checks, and persistence after redeployment. |
| Q3 | Impose a fixed one-hour execution limit. |
| Q4 | Preserve `/v3` corridor behavior and resources. Add `/v4` for editable full plans, without automatic conversion or legacy API aliases. |
| Q5 | Require explicit `simulation_method: flow` or `des` for full-plan simulation. Reject ABM until implemented in Phase 3. |
| Q6 | Follow the existing Phase 1 deployment under `opsidio / opsidio-api / production`. |
| Q7 | Count setup, code, tests, fixes, Railway build/deployment, remote checks, and reporting within one elapsed hour. Stop and report `incomplete` when required acceptance is missing. |
| Q8 | Keep synchronous simulation, one calculation at a time, a 60-second computation deadline, and 429 contention. Accept up to 10,000 ticket holders; DES supports 1–100 replications, default 20. |
| Q9 | Add separate `/v4` storage to the existing database, preserve `/v3` records, take a consistent backup, and rehearse migration and rollback locally. |
| Q10 | Reduce actual service to available staff, equipment, and physical lane capacity. Keep the submitted plan unchanged and report shortages. |
| Q11 | Reject deferred `spatial` and `participant_behavior` extensions with field-level 422 errors. |
| Q12 | Stop new service and refuse waiting queues at closing. Finish service already started; charge actual overtime after paid shift end. Staff are unavailable before shift start. |

The user approved this written specification on 2026-11-07 and instructed the agent to do nothing afterward.
Record approval only. Do not create an execution plan, start implementation, run tests, or deploy.

### Execution limit and estimate

The user selected a fixed **60-minute execution limit** in Q3.
The earlier 4–8-hour range remains an unmeasured engineering estimate for the larger scope.
It is not the selected delivery window or an approved extension.
The existing deployment removes initial resource setup from the work.
It does not establish that full Phase 2 acceptance will fit within one hour.
The Phase 1 measurement does not establish a linear coding rate for broader simulation.

Keep the confirmed scope. Do not remove service rules or substitute example results to meet the clock.
Use the accounting and incomplete outcome confirmed in Q7.
Do not introduce the previous full-scope plan's feasibility gate as a new start prerequisite.

### Author choices

The following details implement the confirmed directions. They are author choices, rather than separate user answers.

- Extend the existing FastAPI, Pydantic, Python 3.12, uv, and SQLite application.
- Use one local computation child for a `/v4` simulation; keep HTTP reads available in the application process.
- Preserve source document money, clock times, report semantics, and explicitly uncomputed fields.
- Store an immutable full document with each Run so later edits cannot change its input.
- Keep one backup for the first Phase 2 migration. Defer scheduled backups and disaster-recovery drills.

Approval of this written specification includes its operation table, request settings, source coverage, and author choices.
Write and lint the matching OpenAPI contract before handlers during execution.
A matching contract needs no second approval round. A material design or contract change requires approval.

## Design

### 1. Phase boundary

Use the [source requirements](references/2026-11-07-source-requirements.md) to define full-document and service behavior.
The [earlier full design](2026-11-07-simulation-and-optimization-design.md) supplies context for previous compatibility decisions.
Neither reference makes all later-phase operations mandatory in Phase 2.
For Phase 2, this specification overrides conflicting defaults in those references.

| Source area | Phase 2 boundary |
| --- | --- |
| §2: full plans and presets | Required, including the base document and optional demand. |
| §3: HTTP operations | Required for plans, presets, validation, and plain Runs; use `/v4` and the operation IDs below. |
| §4: validation | Required for writes and simulation readiness. |
| §5–6: services, resources, costs, and lane capacity | Required with the source assumptions and check/rule catalogs. |
| §7–9: flow, DES, and reports | Required; no corridor substitution or illustrative output. |
| §10.3: hard-limit catalog | Use applicable static checks as validation warnings and report findings. No optimization or change-proposal workflow. |
| Remaining optimization, OpenAI, reuse, and lab behavior | Deferred; do not inherit their routes, caches, workers, or acceptance suites. |

Do not execute the earlier full-scope plan or inherit its A01–A17 suite and preparation gates.
The Phase 2 checks below establish this phase's acceptance.

Keep complete spatial behavior in Phase 3 and broader optimization in Phase 4.
Keep offline evaluation, lab tooling, and further operational packaging in Phase 5.
Phase 2 releases its accepted workflow to the existing Phase 1 deployment.

### 2. Event-entry plans

Restore the source document sections: `schema_version`, `meta`, `event`, `venue`, `process_steps`, `staff`, `constraints`, and `sources`.
Support the optional `demand` block.
Include partial creation, merge patches, step and role item edits, validation, read-only presets, and saved simulation snapshots.

`POST /v4/plans` accepts `{}`, a partial document, or a complete document directly.
Default `schema_version` to `0.1` and `meta.document` to `opsidio_event_input`.
Keep every supplied base-document field, including provenance and free-text context.
Free text never changes simulation behavior.
Reject unsupported schema versions and behavioral extensions with field-level 422 errors.
In particular, reject `spatial` and `participant_behavior` on creation and update, as confirmed in Q11.
Do not store them silently or derive an invented navigation graph from source walking distances.

Apply JSON Merge Patch semantics to plan updates. Null removes an optional field; arrays replace whole arrays.
Reject plan patches that touch `process_steps.steps` or `staff.roles` with 422 `use_item_endpoint`.
Use the dedicated item operations for those lists. Item IDs cannot change.

Ship venue preset `tennis_indoor_senayan` and the nine source step presets as read-only package data.
Applying a venue preset replaces the venue and incorporates its source records.
Applying a step preset adds only that step; duplicate IDs return 409 `step_exists`.
Never add missing steps automatically.

Validate field shape on writes. Defer missing sections and cross-section references until validation or simulation.
Return `valid` and `issues` from validation. Each issue has severity, stable code, field path, and message.
Use the source catalog for missing sections, unknown references, uncovered categories, invalid staff splits, counts, times, demand totals, and walking paths.
Errors block simulation with 422 `plan_invalid`.
Warnings about hard limits, unknown checks/rules, and default demand remain visible and do not block simulation.
Never label such a plan operationally feasible merely because a Run completed.

Keep `/v3` corridor operations and saved resources compatible.
Add `/v4` for editable schema `0.1` event-entry plans, with distinct operation IDs.
Do not convert corridor plans automatically or introduce historical `/v1` and `/v2` aliases.
Use the [glossary](../../CONTEXT.md) to distinguish Corridor plan from Event-entry plan.
The [compatibility decision](../adr/0003-keep-corridor-and-event-entry-contracts-separate.md) records the boundary and document-format exceptions.

Keep integer IDR and Asia/Jakarta `HH:MM` clock values inside full plan and report documents.
Keep UTC RFC 3339 timestamps on API resources.
Keep `/v3` money objects and elapsed model times unchanged.

### 3. Simulation and reports

Flow must use the source minute-grid aggregate semantics and computed lane capacity.
DES must use individual visitors, an event queue, FCFS service, seeded replications, and the source service rules.
Neither method may return the corridor model under a different name or substitute illustrative example outputs.

Cover source eligibility, walking assumptions, service positions, exception outcomes, point schedules, support services, stock, and costs.
Keep observed waits, opening holds, planned gate-join holds, walking, and service time distinct.
Preserve explicit limitations for density and other results that do not model spatial crowd interactions.

Require `simulation_method` on `/v4` simulation requests, with `flow` and `des` as the only accepted values.
Do not change `/v3` simulation bodies or assign a new implicit default when later methods arrive.

Accept these simulation bodies:

```json
{"simulation_method": "flow"}
```

```json
{"simulation_method": "des", "replications": 20, "base_seed": 20261127}
```

Require the method. DES accepts 1–100 replications and defaults to 20.
Default its base seed to the event date as `YYYYMMDD`.
Flow uses one replication and a null reported base seed.
For compatibility with source request settings, accept supplied flow seed/replication settings but normalize them to those resolved values.
Record both submitted and resolved settings so ignored settings remain explicit.
Reject `abm`, omitted methods, and unknown settings with 422.

### 4. Service behavior and report semantics

Use source §5 for attendance, visitor classes, service paths, staffing, exceptions, demand, checks, rules, and costs.
Keep these requirements explicit:

- Flow uses expected attendance; DES samples attendance from sold or issued tickets and no-show rates.
- Preserve category, gender, bag, locker, accessibility, and group attributes.
- Apply redemption, optional lockers, gate-join holding, accessible escort, gate eligibility, and destination holding.
- Walk declared source paths at 1.0 m/s. Do not infer geometry from distances or claim collision avoidance.
- Derive ordered service positions from per-lane staff capabilities. Preserve duty lanes and extra eligible servers.
- Bound waiting between positions to one visitor. A completed position blocks until the next position has room.
- Preserve all eight exception outcomes and their lane-time, return, support-service, or refusal effects.
- Apply help-desk resolution, locker exhaustion, point opening/closure, shift coverage, and actual overtime.
- Separate scheduled resource availability from advisory planning limits. Do not serve visitors using unavailable resources.
- Use the source demand defaults and distinguish assumed curves from submitted estimates.
- Keep source assumptions explicit, including floaters covering meal breaks and untested break-schedule rules.

The exception outcomes are `continue`, `secondary_check`, `step_aside_and_return`, `help_desk`, `locker_point`, `redirect_to_correct_gate`, `back_to_redemption`, and `refuse_entry`.
Bound return paths by the modeled horizon and computation deadline; never drop returning visitors to finish faster.

#### Available capacity

Keep the submitted plan immutable during a simulation, including its requested lane, staff, and rental counts.
Derive operational lanes from available staff, their capabilities, equipment inventory, and declared physical lane limits.
Allocate shared resources in stable point-ID, lane-group-ID, and lane-index order.
Do not allocate the same staff member or equipment unit to overlapping service positions.
Apply gender and certification eligibility before admitting a lane to service.
Treat physical lane limits as declared capacities; this phase does not verify geometric fit.

Three requested scan lanes with two available scanners operate as two lanes.
Keep the hard-limit warning and identify requested versus operational capacity in the Run.
If no lane can operate, preserve the resulting queues and unfinished or refused outcomes.
Do not invent resources or reject a structurally valid simulation solely because it has resource shortages.
Structural validation errors still block a Run.
Compute planned costs from declared role and rental counts, plus actual overtime.
Capacity capping does not silently reduce the submitted plan or its planned cost.

#### Closing and overtime

A point admits new visitors to service during the half-open interval from opening to closing.
At closing, stop new admissions to service and refuse the external waiting queue.
Apply the same refusal rule to arrivals or returning visitors at or after closing.
Use the source closure reasons for redemption and gate queues.

Visitors already admitted to the point's service process may finish all remaining positions after closing.
This includes visitors waiting in an internal position buffer; they do not rejoin the refused external queue.
At equal timestamps, record completed service before queue refusal. Never start another visitor at the closing timestamp.
Count a completion only if it occurs by the modeled horizon.
An unfinished service remains unfinished when the horizon arrives.

Staff cannot serve before their shift starts.
Assigned staff remain available through the point's operating window and completion of work already admitted.
Their paid shift end starts overtime accounting; it does not terminate active service or close the point early.
Charge source overtime rates for each started overtime hour using actual observed work.
Preserve the source assumption that floaters cover meal breaks.

These Q10/Q12 rules override ambiguous resource and closing behavior in the historical source.

Flow uses one-minute cumulative arrival/service curves and computed lane capacity.
Compute capacity from the source 6,000-visitor lane experiment, discarding the first 1,000 visitors as warm-up.
Seed that experiment from the canonical lane-configuration hash. Include its time in the request deadline.
An in-memory capacity cache may reuse identical configurations; record its model version in Run identity.
Do not replace the experiment with reciprocal mean service time.

DES uses one chronological event queue and FCFS lane-group queues.
Use capped lognormal service draws from typical and slow times, as defined in source §5.4.
Use replication seed `base_seed + i` and stable separate streams for visitor and service draws.
Preserve common random numbers when plans share visitor inputs.
Use stable IDs to break simultaneous visitor and lane ties.
Release completed service before assigning work at the same timestamp.

Conserve attendance through the horizon: admitted, refused, and unfinished sum to modeled attendance.
Keep unfinished state counts and flow fractional amounts explicit. Do not report scheduled future admissions as completed.
DES reports aggregate means and source P05/P95 intervals across replications.
Flow's `{mean, p05, p95}` values are equal.

Preserve the source output document structure from §9 and [the illustrative output](../../example_output.json).
Compute every applicable section from the submitted snapshot:

| Report area | Required behavior |
| --- | --- |
| `meta`, `run_manifest` | Mark computed output with `example: false`; record inputs, assumptions, method, settings, versions, and uncomputed fields. |
| `scorecard`, `known_problem_checks` | Evaluate source targets, rules, shortfalls, risk conditions, and deterministic text templates. |
| `time_to_clear`, `max_queue_length`, `wait_time` | Compute clearance, queue peaks, and defined wait measures. Keep opening and planned gate-join holds separate. |
| `staff_utilization`, `staffing_cost` | Compute service utilization, paid non-service roles, shift/package/meal costs, and started overtime hours. |
| `peak_density` | Compute aggregate occupancy divided by declared zone area. State that this omits spatial crowd interactions. |
| `bottleneck_report` | Report measured bottlenecks. Leave optimization-only `moves_to` null and identify its absence. |
| `entry_outcomes`, `support_services`, `stock_check` | Compute admissions/refusals/unfinished visitors, support demand, and equipment/locker constraints. |
| `arrival_and_access` | Compute source arrivals and access measures from submitted data and declared assumptions. |

Flow cannot compute the sum of an individual's waits across all queues.
Keep `wait_time.by_category[].all_queues_p90_minutes` null for flow.
Keep `peak_density.open_air_exposure.with_rain_plan_persons` null for both methods.
List these and optimization-only omissions in `run_manifest.uncomputed_fields`.
Do not fabricate zeros or completed checks for unavailable measures.
These are the explicit model limitations, rather than permission to omit implemented source report sections.

### 5. HTTP contract

Keep the existing seven `/v3` and health operations compatible.
Add the following 21 `/v4` operations. Their success responses use the corresponding source resource shape.

| Method and path | Operation ID | Success |
| --- | --- | --- |
| `GET /v4/venue-presets` | `listEventVenuePresets` | 200, cursor page |
| `GET /v4/venue-presets/{preset_id}` | `getEventVenuePreset` | 200, preset |
| `GET /v4/step-presets` | `listEventStepPresets` | 200, cursor page |
| `GET /v4/step-presets/{preset_id}` | `getEventStepPreset` | 200, preset |
| `POST /v4/plans` | `createEventPlan` | 201, Plan |
| `GET /v4/plans` | `listEventPlans` | 200, cursor page |
| `GET /v4/plans/{plan_id}` | `getEventPlan` | 200, Plan |
| `PATCH /v4/plans/{plan_id}` | `updateEventPlan` | 200, Plan |
| `DELETE /v4/plans/{plan_id}` | `deleteEventPlan` | 204 |
| `POST /v4/plans/{plan_id}/steps` | `createEventStep` | 201, changed Plan |
| `PATCH /v4/plans/{plan_id}/steps/{step_id}` | `updateEventStep` | 200, changed Plan |
| `DELETE /v4/plans/{plan_id}/steps/{step_id}` | `deleteEventStep` | 204 |
| `POST /v4/plans/{plan_id}/roles` | `createEventRole` | 201, changed Plan |
| `PATCH /v4/plans/{plan_id}/roles/{role_id}` | `updateEventRole` | 200, changed Plan |
| `DELETE /v4/plans/{plan_id}/roles/{role_id}` | `deleteEventRole` | 204 |
| `POST /v4/plans/{plan_id}/apply-venue-preset` | `applyEventVenuePreset` | 200, Plan |
| `POST /v4/plans/{plan_id}/apply-step-preset` | `applyEventStepPreset` | 200, Plan |
| `POST /v4/plans/{plan_id}/validate` | `validateEventPlan` | 200, validation result |
| `POST /v4/plans/{plan_id}/simulate` | `simulateEventPlan` | 200, Run |
| `GET /v4/plans/{plan_id}/runs` | `listEventRuns` | 200, cursor page |
| `GET /v4/runs/{run_id}` | `getEventRun` | 200, Run |

Do not expose `/v4` optimization, cancellation, or recommendation routes.
An ID from the other API namespace must not read or mutate its resources.
List only `/v4` resources in `/v4` lists; preserve existing `/v3` candidate reads.

Plan resources contain `id`, `parent_plan_id`, `optimization_id`, `candidate_kind`, `created_at`, `updated_at`, and `document`.
The three lineage/optimization fields are null for Phase 2 event-entry plans.
Run resources contain `id`, `plan_id`, `purpose`, `created_at`, `snapshot_hash`, `snapshot_document`, `simulation_method`, `request_settings`, `resolved_settings`, `engine_version`, `runtime_ms`, `output`, and `limitations`.
Every Phase 2 full-plan Run has purpose `plain`; no reuse or verified recommendation is implied.
The snapshot includes the entire document, rather than only the fields consumed by the engine.
Hash canonical UTF-8 JSON using sorted keys, compact separators, and preserved Unicode.
Engine identity includes resolved settings and lane-capacity model version.

Paginate lists with `limit` default 20, maximum 100, and opaque `cursor`.
Return `{data, next_cursor}`, newest first with ID as the stable timestamp tie-breaker.
Deleting an event-entry plan removes its own snapshots and Runs; it never deletes corridor resources.

Use the existing `X-API-Key`, constant-time comparison, public `/health`, disabled generated docs, and standard error envelope.
Keep bodies below 1 MiB. Never log keys, full request documents, or visitor records.
Return 401 for authentication, 404 for missing resources, 409 for conflicts, 413 for oversized bodies, and 422 for invalid input.
Return 429 `service_busy` with `Retry-After: 1` for contention and 503 `computation_timeout` for unfinished computations.
Declare all applicable responses and field-level validation details in OpenAPI.

Accept optional `Idempotency-Key` on POST operations, scoped by API version, operation, and target for 24 hours.
Replay identical submitted JSON; changed content returns 409. Recheck replay after acquiring the mutation lock.
Commit a successful mutation and its replay response atomically.
Timeouts and crashes save no incomplete Run or success replay.
A create replay can reference a subsequently deleted Plan; do not recreate it silently.

Archive the current v3 contract byte-for-byte before changing it.
Use `docs/specs/references/2026-11-07-v3-corridor.openapi.yaml` for that reference.
Author one canonical service `api/openapi.yaml`, OpenAPI 3.1, with `info.version: 4.0.0`, preserved `/v3` operations, and new `/v4` operations.
Keep the product-root symlink pointing to it. Keep the historical v2 archive and fixture manifests unchanged.

### 6. Runtime and persistence

Use the existing FastAPI, Pydantic, Python 3.12, uv, and SQLite foundation unless the interview establishes another requirement.
Define the contract before route implementation, following the [product rules](../../AGENTS.md#apis).
Keep the engine separate from HTTP and database access.
Keep all runtime code, presets, lockfiles, fixtures, and tests inside the service build root.
Do not import runtime helpers from another repository or product folder.

Reject simulation workloads above 10,000 sold-plus-issued ticket holders with 422 `workload_limit_exceeded`.
Apply this ceiling before no-show sampling. Partial document storage does not imply readiness for simulation.
The supplied [reference plan](../../example_plan.json) has 3,412 sold tickets and 120 issued invitations.
It must run with flow and DES at the default 20 replications within the 60-second computation deadline, locally and on Railway.
This is required acceptance, rather than a measured performance claim.

Run at most one calculation across both APIs. Share the existing mutation exclusion policy with new mutating operations.
Keep reads and health checks available. Return 429 immediately rather than accepting queued work.
Offload `/v4` CPU work to one local child and pass it an immutable snapshot and resolved settings.
The 60-second deadline includes child setup, capacity calculation, all replications, and report construction.
Check it during visitor, event, and capacity processing. Terminate and join the child after timeout.
Do not leave timed-out calculations consuming CPU or accept background completion.
Keep `/v3` computation limits and response semantics unchanged.

Keep SQLite WAL, foreign keys, parameterized statements, short transactions, and the five-second busy timeout.
Add numbered migrations and separate event-entry plan, snapshot, Run, and replay tables.
Do not alter or rewrite the existing `plans`, `runs`, `optimizations`, or `replays` records.
Serialize snapshot capture with mutation admission; later edits never change saved Run inputs or outputs.
Migration startup must be idempotent and transactional, with readiness only after success.

Before the first migration, create one consistent backup with SQLite's backup API under `/data/backups/`.
Do not copy only the main database file while WAL writes may be outstanding.
Fail startup if the backup or migration fails. Keep the old database and healthy deployment recoverable.
On later redeployments, detect the completed migration and retain the original backup without creating unbounded copies.
Do not restore that backup automatically: restoration could discard newer corridor records.
The previous image must still operate against the upgraded database while ignoring the added tables.
The local rehearsal may launch the recorded Phase 1 application with its locked dependencies against the upgraded test database.
It must use the actual old code, rather than a mock. A local Docker daemon is not a prerequisite.

### 7. HTTP acceptance

Author executable tests during the hour. Use actual HTTP, temporary databases, local test keys, and real process restart.
Use calculated small cases and the supplied reference plan. Do not assert illustrative source output as computed truth.
Do not import engine functions to bypass the application, replace outputs, or require external model calls.

| Check | Required evidence |
| --- | --- |
| Phase 1 compatibility | Existing corridor E2E tests pass without weakened assertions. Saved corridor results and replay behavior survive migration and restart. |
| Full-plan lifecycle | Create empty, partial, and complete documents; edit allowed sections and individual items; paginate, read, and delete resources. |
| Presets and validation | Apply venue and all nine step presets; prove replacement/addition semantics, duplicate conflicts, deferred references, and readiness errors. |
| Real flow | Constant-service lane examples show computed capacity, queue buildup, and changed results when lane counts or demand change. Repeat inputs reproduce computed output. |
| Real DES | Fixed seeds reproduce output and snapshot identity. Replication settings resolve correctly; category eligibility, FCFS, and population conservation hold. |
| Service positions | Staff capabilities, extra servers, duty lanes, and bounded intermediate buffers change actual service behavior. Invalid splits fail validation. |
| Exceptions and support | Exercise all eight outcomes, help-desk resolution/refusal, locker exhaustion, accessible escort, and return paths. Conserve every visitor or flow amount. |
| Schedules and resources | Three requested scan lanes with two scanners operate as two lanes and retain a shortage warning. Verify zero-capacity conservation, shift-start availability, queue refusal at closing, completion already in service, and actual overtime. |
| Reports | Compute every listed section, targets, risk text, costs, and aggregate density. Prove required null/uncomputed fields and distinct hold/wait/walk measures. |
| Reference workload | Run the full reference document with flow and DES/20 within the computation bound. No truncated population or omitted source behavior. |
| Security and failure | Reject missing/wrong keys, unsupported methods/extensions, invalid settings, oversized input, excessive workloads, and changed idempotency reuse. Prove immediate contention and real timeout cleanup. |
| Persistence and rollback | Saved Runs retain their original document after edits and restart. Rehearse additive migration and old-image compatibility against a disposable local database. |
| Railway release | Repeat authenticated full-plan workflows on the existing public URL. Redeploy and compare saved `/v3` and `/v4` reads with their captured pre-redeploy responses. |

Ignore IDs, timestamps, and runtime metadata only when comparing separate computations.
Compare persisted GET bodies exactly across restart or redeployment.
Select numeric tolerances explicitly for flow arithmetic. Never round away conservation errors or missed checks.

Run pytest, Redocly contract lint, and Schemathesis against an empty local database before release.
Keep the source Schemathesis allowances narrow: valid shape can still produce business-validation 422, and replay may reference a deleted resource.
Use pytest for successful create/read and complete journey checks.
All required commands must exit 0; report the existing Node-version warning separately from contract warnings.

### 8. Railway deployment

Require a live deployment and public HTTP acceptance, as confirmed in Q2.
Follow the [Phase 1 deployment record](../deployments/2026-11-07-phase-1-railway.md) and current [Railway state](../../AGENTS.md#railway-state).
They override the copied product naming defaults.

| Setting | Existing target to retain |
| --- | --- |
| Project | `opsidio`, `9baf9b83-09bb-46e8-8702-c79d21968ce2` |
| Service | `opsidio-api`, `5d0900c0-8976-4ae5-ab5c-ed5397b6e3f5` |
| Environment | `production`, `57de2987-9915-4ab6-9e13-09b960b94d13` |
| Public URL | `https://opsidio-api-production.up.railway.app` |
| Build root | `api/algorithm/api/` |
| Region | Singapore, `asia-southeast1-eqsg3a` |
| Processes and replicas | One Uvicorn process; one replica; serverless off |
| Volume | `opsidio-api-volume`, mounted at `/data` |
| Database | `/data/corridor.sqlite3` |
| Variables | Existing secret `API_KEY`; existing `DATABASE_PATH`; Railway-provided `PORT` |
| Health check | Public `/health` |

Reuse the domain, volume, API key, and database path.
Create no additional Railway resource or paid service for this design.
Keep existing resource settings; computation and storage usage may increase with full simulations.
Use the confirmed migration backup and local rollback rehearsal.
The existing volume and that backup do not establish disaster recovery or scheduled backup coverage.

A persistent volume supports SQLite storage across deployments.
Volume-backed redeployments cause brief downtime even when a health check is configured.
Railway deployment health checks do not provide continuous monitoring.
See [Railway volumes](https://docs.railway.com/volumes) and [health checks](https://docs.railway.com/deployments/healthchecks).

Extend the existing Docker packaging within the service build root.
Install locked production dependencies and include preset package data.
Start as root only to prepare volume ownership, then execute Uvicorn as an unprivileged user.
Bind the API to `0.0.0.0` and Railway's `PORT`.
Initialize the database after the volume mounts, during startup.
See [Dockerfile support](https://docs.railway.com/builds/dockerfiles) and [volume availability](https://docs.railway.com/volumes#volume-availability).

Verify saved plan and Run reads after redeployment.
Also verify the saved Phase 1 Plan, Run, and Optimization recorded in the deployment evidence.
Record the actual target, public URL, settings, and acceptance evidence after authorized deployment.

Capture the existing deployment ID, image digest, variable names, and stored Phase 1 GET responses before release.
Read the key without printing or storing it in documentation.
Use the existing target for all release commands from `api/algorithm/api/`:

```text
railway link --project opsidio --service opsidio-api --environment production
railway up --service opsidio-api --environment production
```

This design authorizes no command execution now.
Future execution must include explicit authorization to release to this named production target.
No new project, service, volume, domain, region, or key is required.

Require successful Railway build/deployment and public `/health` before authenticated acceptance.
Check missing-key rejection, `/v3` reads and lane comparison, `/v4` plan edits, both methods, and saved full-plan Run reads.
Redeploy the accepted Phase 2 image and compare saved resources afterward.
Record evidence in `docs/deployments/2026-11-07-phase-2-railway.md` and update the product's Railway state.
Keep bounded structured request and computation logs, with operation, request ID, status, duration, method, and engine version.
Use existing Railway observability; add no monitoring service for this release.

Railway rollback restores the prior image and custom variables.
Database compatibility requires a separate application policy.
See [deployment actions](https://docs.railway.com/deployments/deployment-actions).

For a failed release, select the captured previous successful deployment's Rollback action.
The additive schema must permit that image to serve existing corridor records without restoring the database.
Keep new `/v4` tables for a corrected release. Never delete them as part of image rollback.
After rollback, verify public health and the captured `/v3` reads.
If rollback is unavailable or pending, report that actual state; do not claim recovery from an issued command alone.

### 9. Execution window and completion

Start one monotonic elapsed clock before environment checks or implementation reasoning.
Count setup, contract changes, code, test authoring/runtime, fixes, container builds, Railway operations, remote checks, and reporting.
Count owner waits and service waits. Do not pause or restart the clock.
Any authorized workers share the same deadline; this specification does not authorize a parallel workflow.

Keep the execution attempt separate from this design interview and subsequent plan authoring.
Do not require a separate preparation project, calibration run, fixture freeze, or timing proof before starting.
Actual blockers stop execution under the global rules.

Stop adding functionality by minute 45. Reserve the remaining time for final checks, release, persistence verification, and reporting.
Do not start a process whose timeout exceeds the remaining execution window.
Start no new Railway deployment after minute 50.
Reserve the final three minutes for cancellation or recovery actions, cleanup, and the recorded outcome.
Cancel an unfinished candidate release before the deadline; initiate rollback if an activated candidate fails acceptance.
Preserve the last healthy deployment when possible. Record any provider operation still pending at the deadline.
A pending cancellation or rollback is an explicit incomplete state, rather than permission to extend the hour.

Complete Phase 2 only when every local and Railway acceptance check passes within 60 elapsed minutes.
At the deadline, stop owned work and report `incomplete` if any requirement remains.
Record actual elapsed time, checks and exit codes, current deployment state, remaining work, and owned-process cleanup.
Preserve working files. Never remove source behavior, weaken acceptance, restart the clock, or claim completion from partial results.

## Risks

| Risk | Consequence and control |
| --- | --- |
| Full-document behavior exceeds the corridor model | Use explicit source coverage and small computed HTTP examples for each service rule. |
| API and stored models change | Preserve `/v3`; isolate `/v4` storage and rehearse old-image compatibility. |
| Full workloads exceed synchronous request bounds | Enforce the approved workload/deadline limits and verify the reference document. |
| Aggregate reports imply spatial accuracy | Label method assumptions and unsupported crowd effects in each Run. |
| Volume-backed deployment interrupts service | Accept brief downtime explicitly and verify persisted reads after redeployment. |
| One-hour limit is shorter than the provisional estimate | Keep scope intact; report `incomplete` unless all acceptance fits the actual hour. |
| Provider deployment or recovery exceeds remaining time | Stop new releases early, reserve recovery time, and record pending state without a completion claim. |
| Same-volume backup is lost with the volume | Treat it as an upgrade safeguard; defer disaster-recovery claims. |

## Alternatives considered

- Keep all deployment work in Phase 5: declined by the user's Q2 answer.
- Deliver deployment files without a live service: declined by the user's Q2 answer.
- Include complete ABM and broader optimization: deferred by the confirmed Phase 2 boundary.
- Replace full event-entry simulation with the corridor model: incompatible with the confirmed Phase 2 scope.
- Replace `/v3`: declined in Q4; preserve separate contracts.
- Implicit simulation default: declined in Q5; require the method explicitly.
- Extend execution to the provisional 4–8-hour range: declined in Q3 and Q7.
- Add durable simulation jobs or another database service: unnecessary for the confirmed synchronous, single-replica boundary.
- Simulate unavailable resources with warnings only: declined in Q10; shortages reduce operational capacity.
- Store spatial extensions without applying their effects: declined in Q11.
- Terminate admitted service at closing or paid shift end: declined in Q12; finish admitted work within the modeled horizon and charge overtime.

## Open items

- All interview decisions Q1–Q12 and written approval are recorded. Execution remains unstarted by user instruction.
- Measure completion during the actual one-hour attempt; feasibility has not been established by this document.
- Verify current Railway linkage and rollback availability during execution. The deployment record is the selected baseline, not a live inspection.
- Scheduled backups, restore drills, continuous monitoring, and later-phase contracts remain future work.

## Sources

- [Approved Phase 1 design](2026-11-07-phase-1-corridor-simulation-and-optimization-design.md).
- [Phase 1 execution evidence](../plans/2026-11-07-phase-1-corridor-simulation-and-optimization/execution-log.md#execution-2026-11-07).
- [Existing Phase 1 Railway deployment](../deployments/2026-11-07-phase-1-railway.md).
- [Source requirements](references/2026-11-07-source-requirements.md).
- [Previous full design](2026-11-07-simulation-and-optimization-design.md).
- [Current corridor contract](../../api/openapi.yaml).
- [Product rules](../../AGENTS.md) and [product glossary](../../CONTEXT.md).
- [Phase 2 Railway answer](../qna/phase-2-railway-deployment.md).

This approved specification records design work only. Execution and infrastructure changes remain unauthorized.
