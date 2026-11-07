# Local DES bridge

This adapter calls Doni's existing flow/DES service using its [OpenAPI contract](../api/algorithm/openapi.yaml) and [quick start](../api/algorithm/api-quick-start.md). It contains no queue simulator. The repository has the service documentation and example documents, not the engine source or an importable engine hook.

## Start

Use Python 3.11+ from the repository root. No additional Python packages are required.

```sh
python3.11 -m api.simulation
```

The server binds **127.0.0.1:8000**. Configure its process environment before starting it:

| Variable | Meaning |
| --- | --- |
| `OPSIDIO_API_URL` | Doni's verified service base URL. HTTPS is required except for a loopback engine. No embedded credentials, query or fragment. |
| `OPSIDIO_API_KEY` | The service API key; sent only in the server's `X-API-Key` header. |
| `OPSIDIO_API_TIMEOUT_SECONDS` | Optional timeout for each upstream request, default 180 seconds, maximum 1800. |

Obtain access through Doni's documented service setup. Do not put the key in browser configuration, `VITE_` variables, source files, logs or shared shell history. Missing configuration is a supported state. Starting the bridge and checking local health make no external calls.

```sh
curl -sS http://127.0.0.1:8000/api/simulation/health
```

Example without configuration:

```json
{"status":"unconfigured","configured":false,"missing":["OPSIDIO_API_URL","OPSIDIO_API_KEY"],"invalid":[],"upstream_checked":false}
```

`configured` means the environment has the required values in an acceptable form. It does not prove access. Each run first calls the authenticated upstream `GET /health`; only `{"status":"ok"}` allows plan creation.

## Request and response

`POST /api/simulation/run` accepts JSON, with a total request limit of 1,048,576 bytes:

```json
{"plan":{"schema_version":"0.1","event":{},"venue":{},"process_steps":{},"staff":{},"constraints":{}},"base_seed":20261127,"replications":20}
```

The snippet only illustrates the envelope. **Replace its empty sections with a full, valid v0.1 plan.** The bridge checks the basic shape; Doni's validation endpoint checks every domain rule. `base_seed` must be an integer; `replications` must be 1–100. The full document, provenance and unknown fields are forwarded unchanged. Nothing is inferred from the GBK scene or browser ABM.

For a real full plan saved locally, construct the request without adding credentials:

```sh
python3.11 - /path/to/full-plan.json > /tmp/opsidio-des-request.json <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    print(json.dumps({"plan": json.load(source), "base_seed": 20261127, "replications": 20}))
PY
curl -sS -H 'Content-Type: application/json' \
  --data-binary @/tmp/opsidio-des-request.json \
  http://127.0.0.1:8000/api/simulation/run
```

After upstream health, the bridge calls:

1. `POST /v1/plans` with the full plan.
2. `POST /v1/plans/{plan_id}/validate`. Errors stop the run; warnings remain visible.
3. `POST /v1/plans/{plan_id}/simulate` with `simulation_method: "des"`, `base_seed`, and `replications`.

Success is HTTP 200 with `{status: "completed", plan: Plan, validation: ValidationResult, run: Run}`. All three upstream objects are returned unchanged. Read `run.id`, `run.plan_id`, `run.reused`, `run.runtime_ms` and `run.output`; the latter retains the engine's spread values, units, manifest, seeds and uncomputed-field declarations. No fixture or fallback output is used by the server or panel.

## Reuse, errors and timeouts

Plan creation uses `Idempotency-Key: opsidio-bridge-plan-v1-<sha256>` from the canonical full plan JSON. Repeating the same plan resolves to the same creation response within the engine's documented **24-hour** window. Different seeds or replication counts still use that plan. Do not edit these bridge-created plans through another client; the adapter does not synchronize remote edits. After the idempotency window expires, the same input may create a new plan.

Simulation relies on the engine's natural reuse of the same plan snapshot and settings. It does not replay a cached HTTP response or manufacture `reused`; a later engine response can report `reused: true`. No upstream calls are automatically retried.

Errors have `{status, error: {code, message, details?}, stage?, plan_id?}`. Match on `error.code`. Upstream JSON error contents and HTTP status are preserved, with `upstream_status` and the stage added. A rejected validation is HTTP 422 `plan_invalid`, including the full `validation` and original `plan` response. Missing/invalid local configuration is HTTP 503 `bridge_unconfigured`.

A transport timeout returns HTTP 504 with `status: "timeout"`, `error.code: "upstream_timeout"`, and the known `plan_id`. The remote operation **may still be running**. An upstream 408/504 retains its original error and gets the same timeout status. Retry the identical plan and settings to recover a stored run. Closing the browser does not cancel engine work. Upstream redirects are blocked so the key cannot be forwarded to another host.

## Browser integration

`web/src/simulation/des/client.ts` exports `getDesHealth`, `runDes`, `DesBridgeError`, and the response types. It calls only `/api/simulation/*`. The development server must proxy those paths to `http://127.0.0.1:8000` without a timeout shorter than the configured upstream timeout.

```tsx
import DesRunPanel from './des/DesRunPanel'

<DesRunPanel plan={null} baseSeed={20261127} onResult={result => {
  console.log(result.run.id)
}} />
```

The parent positions the panel. A supplied `plan` is used directly. With `plan={null}`, the panel accepts a full JSON plan file, reports parsing/shape errors and displays the imported event and venue identity. Importing a Tennis example does not turn it into a GBK plan. The panel explicitly states that imports do not synchronize with the displayed scene or ABM arrivals. A compiled GBK plan remains separate integration work.

The panel shows configuration, engine validation errors, running state, real scorecard summary and expandable original output. If the plan or seed changes before a response arrives, that old response is not presented as the new plan's result.

## GBK planning draft export

The admission scenario has its own `opsidio-admission-scenario/0.1` format. It is not a Doni `PlanDocument`. Export a separate partial document with:

```sh
python3.11 -m api.simulation.compile_scenario
```

This writes [contracts/examples/coldplay-gbk-plan-draft.json](../contracts/examples/coldplay-gbk-plan-draft.json), targeting Doni's `schema_version: "0.1"` and `meta.document: "opsidio_event_input"`. The planning source remains unchanged in `data/scenarios/coldplay-gbk-demo.json`. The exporter retains the complete original scenario snapshot and canonical hash, and converts source URLs to `{title, url}` objects.

All 70,000 fictional expected attendees are retained as estimates. They are not reinterpreted as sold tickets, capacity or a zero no-show policy. Infinity's existing 500 people split into nine seated/standing records using the source's fixed allocation; their original cohort, product and arrival-area IDs remain available. The resulting 20 records still sum to 70,000.

The draft maps the proposed 13:00 prefunction opening, 17:30 general doors and 21:00 main act to Doni's schedule fields while retaining the entire proposal clock. Gate references are explicitly proposed. The gate records, lanes, processing times, staffing, constraints and demand curve are omitted pending authored inputs; their unresolved status is recorded in `meta`.

**Schema compatibility is not live semantic validity.** The API supports partial plans, but this draft is not ready for `/simulate`. It will not pass the bridge/panel's full-plan check until the operational sections are authored. No capacity or service assumptions are silently added to make it runnable.

## Verification and limits

```sh
python3.11 -m unittest discover -s api/tests -p 'test_*.py' -v
npm run build --prefix web
```

Tests use mocks and temporary loopback HTTP servers only. `api/tests/fixtures/des_bridge_run.json` is explicitly synthetic, for contract checks; it is never served by the bridge. The existing `api/algorithm/example_plan.json` is used as test input without editing it. No live backend run or GBK operational result is claimed by these checks.

This adapter serves the local hackathon demo. Production deployment requires browser authentication, job management and persistence. Python's per-request timeout applies separately to each upstream request in the health/create/validate/simulate sequence.
