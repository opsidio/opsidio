---
task: 01-build-event-entry-and-release
jira: null
system: algorithm
model: sonnet
depends_on: []
boundary: donisury21/first-deploy-algorithm
---

# Build event-entry simulation and release

> **For agentic workers:** Use `superpowers:subagent-driven-development` once for this group, with three builders and the coordinator.

**Goal:** Extend the existing service with the complete approved Phase 2 workflow and prove its live persistence.
**Spec:** [Approved Phase 2 design](../../specs/2026-11-07-phase-2-event-entry-simulation-and-railway-design.md).
**Boundary:** `donisury21/first-deploy-algorithm`; one eventual MR; `depends_on: []`.
**Status:** Approved by the user on 2026-11-07; execution has not started.

All paths below are relative to `api/algorithm/`. Commands run from `api/algorithm/api/`, unless specified otherwise.
Apply every constraint, authorization gate, clock cutoff, and completion rule in [the overview](00-overview.md).
No package is a separate merge group. Integrate every package before claiming a runnable deliverable.

## Required context

Read the complete Phase 2 design. Its confirmed Q1–Q12 decisions override historical source defaults.
Read [source requirements](../../specs/references/2026-11-07-source-requirements.md) §§2–9 and applicable §10.3 static limits.
Inspect `example_plan.json` and `example_output.json` for field shapes. Example output values are not engine acceptance data.
Read `AGENTS.md`, `CONTEXT.md`, `api/openapi.yaml`, and `api-quick-start.md` before implementation.
The quick start contains historical deployment and route names; use the Phase 2 spec for current targets and `/v4` behavior.
Read [ADR 0003](../../adr/0003-keep-corridor-and-event-entry-contracts-separate.md) and [Phase 1 deployment evidence](../../deployments/2026-11-07-phase-1-railway.md).
Read global coding guidelines once before the first code edit. Check deeper instructions before creating files.

## File ownership

Create the following focused files rather than replacing the corridor modules.

| Owner | Create or modify | Responsibility |
| --- | --- | --- |
| Coordinator | Modify `api/openapi.yaml`; create `docs/specs/references/2026-11-07-v3-corridor.openapi.yaml` | Canonical contract and exact v3 archive |
| Coordinator | Modify `api/tests/e2e/conftest.py`; create `api/tests/e2e/test_event_entry.py`, `test_event_engine.py`, `test_event_runtime.py`, `test_event_migration.py`, `test_event_release.py` | Real-process HTTP, restart, old-image, and opt-in public checks |
| Coordinator | Create `api/tests/fixtures/event-entry/reference-plan.json`, `minimal-plan.json`; modify `api/pyproject.toml`, `api/uv.lock` only if necessary | Service-local input fixtures and package inclusion |
| Coordinator | Modify `api/Dockerfile`, `api/.dockerignore`, `api/README.md`; create `api/schemathesis.toml` | Locked build, unprivileged startup, operational instructions, narrow contract-test allowances |
| Coordinator | Create `docs/deployments/2026-11-07-phase-2-railway.md` during release; modify `AGENTS.md` Railway state after verified release; maintain this plan's log/questions | Actual evidence and target state |
| A: `sol` | Create `api/src/algorithm_api/event_models.py`, `event_validation.py`, `event_presets.py`, `event_documents.py`, `presets/*.json` | Document/resource schemas, validation, merge/item edits, packaged presets |
| B: `astra` | Create `api/src/algorithm_api/event_engine.py`, `event_capacity.py`, `event_flow.py`, `event_des.py`, `event_reports.py` | Shared service rules, operational resources, genuine engines, reports |
| C: `sol` | Modify `api/src/algorithm_api/app.py`; create `event_store.py`, `event_migrations.py`, `event_routes.py`, `event_runtime.py` in that package | Additive persistence, routes, shared exclusion, bounded computation |

Preserve `models.py`, `engine.py`, `store.py`, and `tests/e2e/test_corridor.py` unless a demonstrated compatibility defect requires a coordinator-approved ownership change.
Do not weaken existing corridor assertions. Transfer ownership only after the previous writer stops and acknowledges the handoff.
No worker writes another owner's files. Report needed cross-file changes to the coordinator.

## Frozen interfaces

These are plan-author choices for implementation seams, not additions to the HTTP design.
Freeze them with the canonical contract before dispatch. Report material contract changes as blockers.
Use plain JSON dictionaries across the process boundary. Do not pickle application objects or SQLite connections.

### A: models, documents, validation, and presets

In `event_models.py`, define Pydantic v2 `EventPlanResource`, `EventRunResource`, `SimulationSettings`, and `ValidationResult`.
Use every resource field from design §5, without inherited v3 names or historical reuse fields.
`EventPlanResource.document` and `EventRunResource.snapshot_document` preserve the full validated JSON document.
`ValidationResult` has `valid: bool` and `issues: list[Issue]`.
`Issue` has `severity: Literal['error', 'warning']`, `code: str`, `field: str`, and `message: str`.
`SimulationSettings` requires `simulation_method: Literal['flow', 'des']`; optional `replications` is an integer from 1 to 100; optional `base_seed` is an integer.
Reject unknown simulation keys and nonfinite numeric data. Preserve supplied settings before resolving defaults.
Do not use global unknown-field rejection to discard or reject supplied base-document provenance or free-text context.
Reject unsupported behavioral extensions explicitly; validate known field shapes recursively.

Produce these functions:

```python
# event_documents.py
def create_document(submitted: dict) -> dict: ...
def merge_document(document: dict, patch: dict) -> dict: ...
def edit_item(document: dict, collection: str, action: str,
              item_id: str | None, submitted: dict | None) -> dict: ...

# event_validation.py
def validate_shape(document: dict) -> dict: ...
def validate_ready(document: dict) -> ValidationResult: ...
def resolve_settings(document: dict, submitted: dict) -> dict: ...

# event_presets.py
def list_presets(kind: str) -> list[dict]: ...
def get_preset(kind: str, preset_id: str) -> dict | None: ...
def apply_preset(document: dict, kind: str, preset_id: str) -> dict: ...
```

`collection` is `steps` or `roles`; `action` is `create`, `update`, or `delete`; `kind` is `venue` or `step`.
All document operations return a new dictionary and never mutate their argument.
Define `EventInputError(status: int, code: str, message: str, details: list[dict])` in `event_models.py` for these functions.
Use it for expected 404/409/422 outcomes; C renders the standard envelope.
Use stable item-ID field paths from source §4, rather than Python object representations.
Preserve required defaults after updates; reject deletion or change of required schema identity.
Reject replacement or nulling of a parent section when that would bypass protected step/role item lists.

`resolve_settings` returns exactly `simulation_method`, `replications`, and `base_seed`.
Flow resolves to `flow`, `1`, and `None`, even when valid seed/replication settings were supplied.
DES defaults to 20 and integer event date `YYYYMMDD`; do not substitute the request date.
Reuse existing `models.canonical_hash` for finite, sorted-key, compact, Unicode-preserving canonical JSON.

### B: engine boundary

Produce this process-callable entry point in `event_engine.py`:

```python
ENGINE_VERSION = 'event_entry_v1'
CAPACITY_MODEL_VERSION = 'lane_capacity_v1'

def simulate_event(document: dict, resolved_settings: dict,
                   *, deadline: float) -> dict: ...
```

Return `{'output': dict, 'limitations': list[str]}` with the complete computed report.
Raise the existing `engine.ComputationTimeout` on deadline exhaustion. Never return partial success.
Keep HTTP, SQLite, resource IDs, and wall-clock resource creation outside the engine.
C supplies saved resource metadata in the report manifest after computation without changing numeric results.
Record both engine and capacity versions in the manifest and engine identity, alongside resolved settings.
Keep snapshot hashing independent of runtime metadata.

The internal B modules are one owner's implementation detail; keep their shared service semantics identical for flow and DES.
Engine results must retain all counters needed by reports, including refusal reasons, internal buffers, returns, resource shortfalls, and actual work intervals.
Every visitor or flow amount remains admitted, refused, or unfinished at the horizon.

### C: application, store, and runtime

Preserve `create_app(*, database_path: str, api_key: str) -> FastAPI` and the module-level application.
Initialize the existing `Store` for v3, then `EventStore` for separate tables. Register v4 routes in the same application.
Pass the existing single mutation lock into `register_event_routes(app, *, store, mutation_lock)` in `event_routes.py`.
Extend authentication to `/v4/` without exposing generated docs or changing `/health`.
Do not create a second lock that permits simultaneous v3/v4 calculations.

Define `EventStore(Store)` in `event_store.py`, reusing connection settings without changing v3 methods:

```python
def get_event_plan(self, plan_id: str) -> EventPlanResource | None: ...
def get_event_run(self, run_id: str) -> EventRunResource | None: ...
def list_event_resources(self, kind: str, *, plan_id: str | None,
                         limit: int, cursor: str | None) -> dict: ...
def get_event_replay(self, operation: str, target: str, key: str,
                     *, now: datetime) -> Replay | None: ...
def commit_event_change(self, *, plan: EventPlanResource | None,
                        run: EventRunResource | None,
                        delete_plan_id: str | None,
                        replay: ReplayWrite | None) -> None: ...
```

`kind` is `plans` or `runs`; lists return `{data, next_cursor}`. Preset pagination uses the same HTTP convention without database tables.
Define `migrate_event_schema(path: str) -> None` in `event_migrations.py`, called once by `EventStore` initialization.
Create migration-ledger, event-plan, event-snapshot, event-run, and event-replay tables with foreign keys and a numbered migration.
Keep event replays in their own table; version-scope them as well as operation/target/key.
Store each Run's immutable snapshot and report atomically with any successful replay.
Deleting a plan cascades only its event snapshots and Runs. Preserve create replays even after deletion.

In `event_runtime.py`, define `compute_event(document: dict, resolved_settings: dict, *, deadline: float) -> dict`.
Start one spawn-safe child, pass a deep immutable snapshot and remaining deadline, and collect B's result over bounded IPC.
Start the 60-second deadline before spawning. Drain result IPC while the child runs to avoid full-pipe deadlock.
On timeout terminate, escalate to kill if needed, join, and close IPC before releasing calculation admission.
On child crash, return a logged standard server error and save neither Run nor success replay.
Never leave a child calculating after an HTTP failure. Keep health and reads responsive throughout.

## Execution steps

### P0: coordinator, authorization, contract, and dispatch

- [ ] Start the shared clock before execution setup. Record all cutoffs in `execution-log.md`.
- [ ] Verify named production authorization before any production write.
- [ ] Inspect branch, worktree, status, applicable instructions, local tools, and old application revision. Preserve unrelated work.
- [ ] Read current Railway state without printing secrets. Capture deployment ID/digest, variable names, rollback availability, and the three recorded Phase 1 GET responses.
- [ ] Archive `api/openapi.yaml` at the required v3 reference path. Verify byte identity and record SHA-256 before modification.
- [ ] Author all 21 v4 operations from design §5 in the canonical contract. Preserve all existing seven total health/v3 operations and their behavior.
- [ ] Set OpenAPI 3.1 and `info.version: 4.0.0`; include exact resource shapes, examples, cursor parameters, optional POST idempotency, and all applicable errors.
- [ ] Declare 401/404/409/413/422/429/503 as applicable, including field details, `service_busy`, and `Retry-After: 1`. Keep public health security empty.
- [ ] Lint with the command below before handlers. A matching approved contract requires no second approval. Stop for material deviations.
- [ ] Send A/B/C the interfaces above, exclusive files, source sections, H-cases, report expectations, and one absolute deadline.

### P1: A, full plans and validation

- [ ] Use the lifecycle and validation H02/H03 cases as failing HTTP acceptance. Confirm failure against the pre-v4 service.
- [ ] Implement partial creation with `schema_version: '0.1'` and `meta.document: 'opsidio_event_input'`; preserve complete input and provenance.
- [ ] Implement JSON Merge Patch: optional null removal, whole-array replacement, immutable item IDs, and protected list/parent rejection.
- [ ] Validate supplied shapes, percent bounds, integer counts, IDR, clock ordering, and typical ≤ slow on writes; defer missing sections and references.
- [ ] Implement all source §4 readiness errors and warnings with stable keyed field paths. Errors yield `plan_invalid` before calculation; warnings remain in reports.
- [ ] Include §10.3 applicable static hard limits, unknown target/rule/staffing warnings, category coverage, staff splits, walking paths, and demand totals.
- [ ] Package `tennis_indoor_senayan` and exactly nine step presets from source §2.3. Include known problems and source records; do not add unsolicited steps.
- [ ] Apply venue replacement and source incorporation without duplicate source IDs. Return `step_exists` for duplicate step application.
- [ ] Resolve method settings exactly as frozen above. Report changed files and interface readiness to C/coordinator.

### P2: B, real engines and reports

- [ ] Use H04–H10 as failing HTTP acceptance; build small deterministic cases before the reference workload.
- [ ] Derive operational lanes from staff, shift starts, certification/gender, equipment, and physical limits in stable point/group/lane order.
- [ ] Prevent overlapping allocation of individual staff or equipment units. Preserve requested counts, shortages, planned costs, and zero-capacity queues.
- [ ] Build ordered staff-capable positions with the source optimal split, extra eligible servers, duty lanes, and one waiting visitor between positions.
- [ ] Implement lane capacity with 6,000 visitors, 1,000 warm-up discards, finite intermediate buffers, exceptions, and canonical-hash seed.
- [ ] Include capacity work in deadline checks. Any cache key includes canonical configuration and capacity model version.
- [ ] Implement minute-grid cumulative flow with expected attendance, FCFS class mix, service delays, exception branches, walking, and fractional conservation.
- [ ] Implement one chronological DES event queue, stable visitor/lane tie breaks, capped lognormal draws, and separate visitor/service streams per replication.
- [ ] Use μ = ln(typical), σ = ln(slow / typical) / 1.2816, capped at 3 × slow. Replication i uses `base_seed + i`.
- [ ] Draw visitor attributes at creation; preserve common random numbers for plans sharing visitor inputs and keep groups together.
- [ ] Implement supplied/default demand, empty-window share transfer, 1.0 m/s walking, locker paths, gate-join holds, escort, category/gender eligibility, and destination holding.
- [ ] Implement all eight exceptions, help-desk resolution, locker exhaustion and 10–20 minute item-removal delay, and returning paths until horizon/deadline.
- [ ] At equal times, complete service first; refuse external queues at closing; start no new visitor at closing. Finish admitted positions/internal buffers within horizon.
- [ ] Keep staff unavailable before shift start; paid shift end begins overtime rather than stopping service. Charge each started overtime hour from actual work.
- [ ] Compute every source §9 report section, deterministic summary/risk templates, source checks/rules, costs, support/stock, access, utilization, bottlenecks, and aggregate density.
- [ ] Keep flow individual all-queue P90, both-method rain-plan exposure, and optimization-only `moves_to` null and listed as uncomputed.
- [ ] Preserve explicit assumptions and `not_tested` rules, including floaters covering meals and unmodeled break schedules. Set `meta.example: false`.
- [ ] Produce DES means/P05/P95 and equal flow interval values; retain unfinished counts and never count post-horizon completions.
- [ ] Report completion and measured checks to the coordinator. Do not reduce scope or population to meet runtime.

### P3: C, persistence and HTTP

- [ ] Use H01/H02/H11/H12 as failing HTTP acceptance before implementing routes and storage.
- [ ] Create a consistent SQLite backup with `Connection.backup` before the first event migration. Use sibling `backups/` for local databases and `/data/backups/` in production.
- [ ] Keep one first-migration backup, even across startup retries. Make backup completion recoverable and migration transactional/idempotent.
- [ ] Fail startup on backup/migration failure. Do not report health readiness until migration succeeds; never auto-restore or delete v4 tables.
- [ ] Implement all operations and status codes from the linted contract. Match exact operation IDs; keep namespaces isolated and newest-first stable cursors.
- [ ] Share mutation exclusion across POST/PATCH/DELETE and both APIs. Acquire before snapshot capture; reads remain available.
- [ ] Read streamed bodies with the below-1-MiB bound. Handle malformed/nonfinite JSON and request validation through the standard field-level envelope.
- [ ] Implement 24-hour version/operation/target replay on POST; hash submitted JSON before defaults and recheck inside the mutation lock.
- [ ] Validate readiness and the sold-plus-issued ceiling before no-show sampling or child creation. Reject >10,000 with `workload_limit_exceeded`.
- [ ] Run B through the bounded child wrapper. Map deadline exhaustion to 503 `computation_timeout`; contention returns immediate 429.
- [ ] Commit successful plan edits, full snapshots, Runs, and replays atomically. Never write incomplete Runs on timeout or crash.
- [ ] Log bounded request/computation records with operation, request ID, status, duration, method, and engine version. Exclude keys, bodies, and visitor records.
- [ ] Hand off startup, migration, child cleanup, and route evidence. Keep old corridor code and records compatible.

### P4: coordinator, executable acceptance and integration

- [ ] Extend the process fixture to support restart on the same temporary database and an HTTP timeout above 60 seconds for v4 simulation.
- [ ] Keep existing corridor tests and their assertions. Add fixtures within the service root; copy the full reference input byte-for-byte.
- [ ] Author H01–H12 as actual HTTP tests against a subprocess, with bounded startup, requests, and cleanup. Do not bypass HTTP by importing engines.
- [ ] Add a public opt-in H13 harness using URL/key environment inputs and an explicit release-test flag. Default pytest must remain local and credential-free.
- [ ] Run focused tests after owner handoffs. Return failures to the file owner; integrate only after interfaces agree.
- [ ] Compare separate calculations after removing only allowed IDs/timestamps/runtime metadata. Compare persisted GET bodies exactly.
- [ ] Use flow arithmetic tolerance `abs=1e-8`, `rel=1e-10` for population conservation; check per-state totals before display rounding.
- [ ] Rehearse backup/migration twice and launch the actual recorded Phase 1 source with its locked dependencies against the upgraded disposable database.
- [ ] Retain a read-only old-code snapshot outside the upload root; do not check out the old revision over shared edits or alter the production database for rehearsal.
- [ ] Prepare locked package-data inclusion and unprivileged volume startup in Docker. Keep one Uvicorn process, `0.0.0.0`, and `${PORT:-8000}`.
- [ ] Confirm presets load from the installed package without access to product-root files. Retain Python 3.12 and existing locked dependencies where possible.
- [ ] By minute 45, stop functionality and run the final commands below. Do not release with a failed or missing acceptance check.

## Acceptance matrix

Every row needs executable assertions and recorded results. Small cases must include all structurally required document sections.
Use deterministic audience shares, `typical == slow`, no-show 0, and zero exceptions unless testing the corresponding rule.
The reference plan tests full source behavior; small fixtures isolate exact results.

| ID / owner / HTTP test | Required assertions |
| --- | --- |
| H01 C/coordinator, `test_v3_compatibility_and_namespace` | Existing corridor E2E passes unchanged; seven original operations remain. V3 IDs fail v4 reads/mutations and vice versa with 404; v4 lists exclude corridor resources. Health is public; all protected operations reject missing/wrong keys. Docs and historical aliases remain 404. |
| H02 A/C, `test_event_plan_lifecycle` | `{}` creates defaults with 201; partial and full inputs round-trip supplied text/sources. Patch removes an optional field and replaces an ordinary array. Step/role CRUD returns 201/200/204 and preserves IDs. Direct protected lists, parent-null/replacement bypasses, schema deletion/change, and item-ID changes return field-level 422. Pagination has no duplicate/missing records at timestamp ties. Delete cascades only event Runs/snapshots and returns 204. |
| H03 A/C, `test_presets_and_readiness` | Venue replacement includes known problems/sources. All nine named steps are readable/applicable; duplicate application is 409 `step_exists`; venue application adds no steps. Missing sections/references can be stored but validate as invalid; each source error code blocks simulation with `plan_invalid`. Unknown targets/rules/staffing keys, hard limits, and missing demand warn without blocking structurally valid Runs. Shapes, counts, times, and 100 ± 0.5 demand boundaries are checked. |
| H04 B, `test_computed_flow` | A deterministic one-position lane with 60-second service yields capacity 1 visitor/minute after the required experiment. A six-person pulse produces a nonzero queue; adding a feasible lane reduces waits, doubling demand increases queue/wait. Repeats produce equal computed output. Assert one-minute curves, expected fractional attendance, and conservation before rounding. |
| H05 B, `test_seeded_des_and_fcfs` | Same full snapshot/settings/seed reproduce normalized output and snapshot hash. A two-person same-time queue at one 60-second position has waits 0 and 60 seconds; stable IDs select order. Replication range 1/100 works; 0/101 fails 422. Default seed equals event date and default count is 20. Common visitor inputs retain attendance/attributes across a lane-count change. DES attendance is drawn rather than set to a rounded expectation. |
| H06 B, `test_positions_and_resources` | Source split examples yield ordered positions, help-desk extra servers, and escort duty lanes. One intermediate waiting place blocks the preceding position when full. Invalid capability splits return readiness errors. Three requested scanner lanes and two scanners operate two lanes with warnings and unchanged requested cost. Shared inventory/staff across overlapping points is never doubled. Gender/certification failures suppress service; zero capacity conserves every visitor. |
| H07 B, `test_exception_paths_and_support` | Parameterize all eight outcomes at 100% where applicable: continue, secondary check, step-aside return, help desk, locker, redirect, redemption return, refusal. Assert lane time and destination changes, resolved/unresolved help-desk outcomes, locker exhaustion, walking delay, accessible escort, priority gate eligibility, and holding zones. A repeated-return case remains explicitly unfinished at horizon rather than disappearing. |
| H08 B, `test_closing_shift_and_horizon` | With two visitors and first completion exactly at close, completion counts before the external queue is refused; the second never starts at close. A visitor admitted before close finishes remaining positions/internal buffers afterward. An arrival/return at close is refused. Shift-start holds service; shift-end does not stop it. Work ending one minute after paid shift end incurs one started overtime hour. Horizon-before-completion remains unfinished. Check both methods and closure reason codes. |
| H09 B, `test_report_semantics` | All 15 source §9 sections exist and are calculated from fixture data; `meta.example` is false. A 10-person occupancy in a declared 20 m² zone gives 0.5 persons/m² with the aggregate limitation. Exact declared shift/package/meal/rental counts and actual overtime produce expected integer-IDR costs. Wait, opening hold, gate-join hold, walking, and service remain distinct. Flow interval triples are equal; DES statistics match replication samples. Check targets, shortfalls, known-problem selectors/aggregates, risk text templates, and required null/uncomputed fields. |
| H10 B/C, `test_reference_workload_and_settings` | Full `example_plan.json` copy retains 3,412 sold plus 120 issued holders. Flow and DES/default 20 return 200 within the inclusive 60-second computation budget, without population truncation. Submitted flow seed/count remain recorded while resolved settings are 1/null. Missing method, ABM, unknown keys, and both deferred extensions on create/update return field-level 422. 10,000 pre-no-show holders are accepted; 10,001 returns `workload_limit_exceeded` even with 100% no-show. |
| H11 C, `test_contention_timeout_replay` | During real v4 computation, v3 computation and mutating v4 calls get immediate 429 plus `Retry-After: 1`, while health/reads respond. A real child driven beyond its computation budget returns 503, is terminated/joined, leaves no Run/replay, and frees admission. A child crash saves no success. Bound a subprocess with an OS execution limit for crash coverage; do not add production test hooks or fake engine output. Same canonical POST JSON replays status/body; changed content is 409; versions/targets are isolated; expiry works. Concurrent same-key requests recheck replay under lock. Deleted-plan create replay returns its original response without resurrection. |
| H12 C/coordinator, `test_migration_restart_and_old_code` | Populate corridor records/replays before upgrade; capture GET bodies. Confirm consistent backup includes committed WAL data, additive schema is transactional, failed backup/migration prevents readiness, second startup retains the original backup, and no v3 record changes. Create v4 Runs, edit plans, restart actual process, and compare every saved GET exactly; snapshots retain prior documents. Launch actual old source against upgraded disposable DB and verify health, v3 reads, create/simulate/optimize, and replay. Never restore production backup as this test. |
| H13 coordinator, `test_public_release_persistence` | On the named public URL, confirm deployment success, health, missing-key 401, captured v3 reads, new corridor lane comparison, v4 lifecycle/presets/validation/item edits, flow, DES/20 reference workload, and saved full-plan Run reads. Capture v3 Plan/Run/Optimization and v4 Plan/Run GET bodies. The user later moved the second redeployment comparison to open items. Record deployment IDs/digests and actual settings; include backup/migration evidence and bounded logs. |

For H11, choose a valid high-replication, near-limit source workload that actually reaches the deadline; never weaken the 60-second production deadline for the test.
If the candidate computes it faster, increase valid service/return complexity within the approved limits and horizon.
If genuine timeout or child-death evidence cannot be produced within the hour, mark that required check missing and the attempt `incomplete`.
Deadline assertions allow bounded parent cleanup latency but never classify post-deadline calculation as success.

### Final local commands

The coordinator bounds each process and captures its exit code and duration. Pytest and Redocly must exit 0 before release. Record Schemathesis results and warnings as an open item.

```sh
uv run pytest
npx --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml
```

For contract testing, start the real app with a fresh disposable database and local test key:

```sh
API_KEY=test-key DATABASE_PATH=/tmp/opsidio-phase2-contract/corridor.sqlite3 uv run uvicorn algorithm_api.app:app --host 127.0.0.1 --port 8000 --workers 1
```

Create that disposable parent directory first. Track and stop the server PID after the check.
Run against both API versions, without an operation filter. Record results and warnings in the open item. A nonzero or stalled run no longer blocks release.

```sh
uvx --from 'schemathesis>=4,<5' schemathesis run openapi.yaml --url http://127.0.0.1:8000 -H 'X-API-Key: test-key'
```

In `schemathesis.toml`, allow business-validation 422 only for schema-valid requests where cross-field rules require it.
Disable resource-availability checking only for replay-after-delete behavior. Keep successful journeys covered by pytest.
Record Schemathesis warnings in the open item. They do not block release or completion. Report any Node-version warning separately.
Do not run a Docker build as an extra prerequisite when a daemon is unavailable; the Railway build remains required evidence.

### P5: coordinator, authorized release and redeployment

- [ ] Confirm local H01–H12, pytest, and Redocly passed. Record Schemathesis as an open item. Check enough time remains for both deployments and recovery.
- [ ] Verify the captured rollback target, original consistent migration backup policy, image compatibility rehearsal, and production authorization.
- [ ] From the service build root, link the existing target with `railway link --project opsidio --service opsidio-api --environment production`.
- [ ] Verify project/service/environment IDs against design §8. Retain Singapore, one replica/process, serverless off, `/data`, database path, key, domain, and public health.
- [ ] Start `railway up --service opsidio-api --environment production` before minute 50. Capture build/deploy result and digest without secrets.
- [ ] Require actual deployment success and public health before H13. A CLI submission alone is insufficient evidence.
- [ ] Read the key only into a process environment or shell variable; never print or document it. Use bounded authenticated HTTP requests.
- [ ] Execute the public checks in H13, including both reference methods. Preserve the three existing Phase 1 smoke records.
- [ ] Capture exact saved GET bodies. The user moved the second deployment step to open items; do not start a second redeployment without renewed direction.
- [ ] Compare saved v3/v4 GET bodies after redeployment only if that open item is resumed. Do not ignore timestamps or runtime fields on persisted reads.
- [ ] Record actual target, settings, IDs/digests, command exits, timings, public evidence, and persistence in the deployment record and Railway state.

The existing target is `https://opsidio-api-production.up.railway.app`, project `9baf9b83-09bb-46e8-8702-c79d21968ce2`, service `5d0900c0-8976-4ae5-ab5c-ed5397b6e3f5`, environment `57de2987-9915-4ab6-9e13-09b960b94d13`.
Volume-backed redeployments have brief downtime. This release adds no paid resource; computation and storage use may increase.

### P6: recovery, cleanup, and outcome

- [ ] On an actual blocker, stop execution and workers immediately; report the blocker without inventing a workaround.
- [ ] If a candidate release is unfinished near the cutoff, cancel that owned deployment through Railway's available deployment action.
- [ ] If the candidate is active and fails acceptance, select Rollback on the captured previous successful deployment.
- [ ] Keep added v4 tables and the migration backup. Never restore the backup or delete tables during image rollback.
- [ ] Verify public health and captured v3 GET bodies after rollback. Report pending/failed rollback as its actual state.
- [ ] At minute 57, stop tests and owned work; use the final three minutes for recovery, process cleanup, and evidence.
- [ ] Terminate/join owned calculation children and test servers. Stop workers. Preserve working files and required evidence.
- [ ] Record H01–H13, command exits, elapsed time, actual builder tiers, deployment state, pending operations, and remaining work in `execution-log.md`.
- [ ] Mark `complete` only when every requirement passed within 60 minutes. Otherwise record `incomplete`; do not restart the clock or extend scope into later phases.
