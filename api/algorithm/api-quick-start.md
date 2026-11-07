# Opsidio sandbox API quick start

Use this guide to call the deployed API. You load the key, create a plan, simulate it, and search for a better plan. The full reference is [`api/openapi.yaml`](../api/openapi.yaml).

## Before you start

- Install the Railway CLI, `curl`, and `python3`. Use bash or zsh.
- Log in to Railway with `railway login`.
- Run every command in `projects/opsidio-sandbox/api/`. Step 3 reads the example plan from that folder.

## Step 1: Load the URL and the key

Link the folder to the Railway service. Do this once on each machine:

```bash
railway link --project opsidio-sandbox --service opsidio-sandbox-api --environment production
```

Load the URL, the key, and the request headers into the shell:

```bash
export OPSIDIO_URL=https://opsidio-sandbox-api-production.up.railway.app
export OPSIDIO_KEY="$(railway variable list --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["API_KEY"])')"
H=(-H "X-API-Key: $OPSIDIO_KEY" -H 'Content-Type: application/json')
```

`H` holds the two headers that every request in this guide sends. Do not print `OPSIDIO_KEY` or write it to a file.

## Step 2: Check the service

```bash
curl -fsS "${H[@]}" "$OPSIDIO_URL/health"
```

Expected result: `{"status":"ok"}`. A missing or wrong key gives 401 `invalid_api_key`.

## Step 3: Create a plan

```bash
PLAN_ID=$(curl -fsS "${H[@]}" --data @tests/fixtures/example_plan.json "$OPSIDIO_URL/v1/plans" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "$PLAN_ID"
```

Expected result: a plan ID, such as `pln_01JC9W3K8Q6Y2M4T5R7V9X1Z3B`.

This example sends a full plan. The body can also be `{}` or part of a plan. You can add the other parts later.

## Step 4: Validate the plan

```bash
curl -fsS "${H[@]}" -X POST "$OPSIDIO_URL/v1/plans/$PLAN_ID/validate" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print("valid:", r["valid"]); [print(i["severity"], i["code"], i["field"]) for i in r["issues"]]'
```

Expected result: `valid: True`, then one line for each issue. Errors block steps 5 and 6. Warnings do not.

## Step 5: Simulate the plan

Run the flow method. It is the default method and the fastest:

```bash
curl -fsS "${H[@]}" -d '{}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/simulate" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["id"], r["simulation_method"], r["runtime_ms"], "ms"); print(r["output"]["scorecard"]["summary"])'
```

Run the des method. It repeats a random simulation 20 times:

```bash
curl -fsS "${H[@]}" -d '{"simulation_method":"des","replications":20}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/simulate" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["id"], r["simulation_method"], r["runtime_ms"], "ms"); print(r["output"]["scorecard"]["summary"])'
```

Expected result: the run ID, the method, the run time, and the scorecard summary. On the example plan, flow takes about 0.3 s and des about 6 s.

The `output` field of the response holds the full output. [Read the output](#read-the-output) shows how to read it again and what it holds. A second call with the same plan and the same settings returns the stored run, with `reused: true`.

## Step 6: Start an optimization

```bash
OPT_ID=$(curl -fsS "${H[@]}" -d '{}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/optimize" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "$OPT_ID"
```

Expected result: an optimization ID, such as `opt_01JC9Y5N2B7C4D6F8G0H2J4K6M`. The call returns 202 at once, and the search runs in the background.

The body `{}` uses the defaults: `optimization_method` `greedy`, all five levers, at most 200 kept moves, a 600 s limit, and a des selection with 50 replications. See [spec §7](specs/2026-11-06-optimization-method-design.md). To name the method, send it:

```bash
curl -fsS "${H[@]}" -d '{"optimization_method":"greedy"}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/optimize"
```

For the model-based method, see [Use the llm_guided method](#use-the-llm_guided-method).

## Step 7: Wait for the search to end

```bash
while :; do
  S=$(curl -fsS "${H[@]}" "$OPSIDIO_URL/v1/optimizations/$OPT_ID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  echo "$S"
  case $S in succeeded|failed|cancelled) break;; esac
  sleep 30
done
```

Expected result: the status goes from `queued` to `running` to `succeeded`. On the example plan, the greedy search took about 95 s on Railway. Des selection then adds about 2 min (an estimate; spec §10). A `failed` search has an `error` object with the reason. A succeeded search has a `stop_reason`: `no_improving_move`, `time_limit`, `max_kept_moves`, `scoring_budget`, or `cancelled`.

## Step 8: Read the candidate plans

```bash
curl -fsS "${H[@]}" "$OPSIDIO_URL/v1/optimizations/$OPT_ID" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print("start", r["starting_plan"]["des_checks"]); [print(c["kind"], c["plan_id"], c["score"], c["recommended"], c["des_checks"]) for c in r["candidates"]]'
```

Expected result: one line for each candidate. Kinds are `milestone`, `final`, and `finalist`. A lower score is better. The API compares missed checks first, then the shortfall, then the cost. At most one candidate has `recommended: true`: the finalist with the best des score, when it beats the starting plan. No candidate is recommended when none beats it, or when `verify` is `null`. `starting_plan.des_checks` shows the start for comparison. See [spec §5.4](specs/2026-11-06-optimization-method-design.md).

To read a full candidate plan, put its plan ID in this call:

```bash
curl -fsS "${H[@]}" "$OPSIDIO_URL/v1/plans/<plan_id>"
```

## Use the llm_guided method

The `llm_guided` method asks a model for moves. Each round, the model proposes up to 8 moves and the simulator scores them. A failed call falls back to a greedy round. See [spec §6](specs/2026-11-06-optimization-method-design.md).

```bash
OPT_ID=$(curl -fsS "${H[@]}" -d '{"optimization_method":"llm_guided"}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/optimize" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
```

Wait as in step 7. Then read the calls:

```bash
curl -fsS "${H[@]}" "$OPSIDIO_URL/v1/optimizations/$OPT_ID" \
  | python3 -c 'import json,sys; l=json.load(sys.stdin)["llm"]; print(l["model"], l["fallback_rounds"], l["stop_reason"], l["estimated_cost"]["amount"]); [print(c["round"], c["status"], len(c["llm_moves"])) for c in l["calls"]]'
```

The `llm` block holds:

- `model` and `reasoning_effort`: the model and its effort.
- `fallback_rounds`: the number of rounds that fell back to greedy.
- `estimated_cost`: `{"amount", "currency"}`.
- `stop_reason`: why the model search stopped.
- `calls[]`: one entry for each call, with `round`, `status`, and `llm_moves[]`.

Each `history[].reason` entry gives the reason for a move.

Rules:

- A search makes at most 12 calls. Each call has 60 s. The estimated cost has a limit of USD 1.00. Call time counts toward `time_limit_seconds`.
- Only the plan view and the move lists leave the service. See [spec §6.2](specs/2026-11-06-optimization-method-design.md).
- The same request can give another result.
- Without an OpenAI key on the server, the call gets 422 `optimization_method_unavailable`.

## Read the output

Two endpoints return the output of a run:

| Endpoint | Use |
|---|---|
| `POST /v1/plans/{plan_id}/simulate` | Run the plan. The response holds the full output in its `output` field. |
| `GET /v1/runs/{run_id}` | Read the output of a stored run again. |

To find a run ID:

- The simulate response: its `id` field is the run ID. Keep it to read the output later.
- `GET /v1/plans/{plan_id}/runs` lists the runs of a plan, newest first, without the output. Add `?purpose=plain` to list only the runs of your simulate calls.
- `GET /v1/optimizations/{optimization_id}` names the runs of a search. `starting_plan` has a `flow_run_id` and a `des_run_id`, and each candidate, a `finalist` candidate included, has the same two fields. `des_run_id` is null when the search has no des check.

Each plan keeps its own runs. A second simulate call on the same plan, with the same document and the same settings, returns the stored run with `reused: true` and computes nothing. Two plans with the same document, such as two plans from `example_plan.json`, each get their own run.

Take the run ID from a simulate call, save the output to `/tmp/opsidio-output.json`, then print its scorecard summary:

```bash
RUN_ID=$(curl -fsS "${H[@]}" -d '{}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/simulate" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS "${H[@]}" "$OPSIDIO_URL/v1/runs/$RUN_ID" \
  | python3 -c 'import json,sys; json.dump(json.load(sys.stdin)["output"], sys.stdout, indent=2)' > /tmp/opsidio-output.json
python3 -c 'import json; print(json.load(open("/tmp/opsidio-output.json"))["scorecard"]["summary"])'
```

Expected result: the scorecard summary, such as `The plan misses 3 of 10 checks: …`. After step 5, this simulate call returns the stored flow run and computes nothing. The file `/tmp/opsidio-output.json` holds the full output. It is outside the repo, so `railway up` does not upload it.

The output follows the tree of [`docs/research/opsidio-event-output-example.yaml`](../../../docs/research/opsidio-event-output-example.yaml). It has these sections:

| Section | What it holds |
|---|---|
| `run_manifest` | The run ID, the plan hash, the method, the replications, the seeds, and the fields that the run did not compute |
| `scorecard` | A one-line summary, and the result of each check and each budget check |
| `known_problem_checks` | Checks for problems from past events at Gelora Bung Karno |
| `time_to_clear` | The time when the queue at each gate clears after the doors open |
| `max_queue_length` | The longest queue in each zone |
| `wait_time` | The waits at each point |
| `staff_utilization` | How busy each role is, against an 85% limit |
| `staffing_cost` | The staffing cost, against the cap |
| `peak_density` | People per m² in each zone, on the Fruin level-of-service scale |
| `bottleneck_report` | Bottlenecks ranked by queue minutes, with suggested moves |
| `entry_outcomes` | How many people came, got in, and were refused |
| `support_services` | The help desk and locker load |
| `stock_check` | The use of items such as wristbands, against the stock |
| `arrival_and_access` | The arrivals in each 15-minute period |

The output also has `schema_version` and `meta`. A des run gives many values as `{mean, p05, p95}` across its replications.

## Other tasks

### Change a plan

Send a JSON Merge Patch (RFC 7386). A list in the patch replaces the whole list. `null` removes a part.

```bash
curl -fsS "${H[@]}" -X PATCH -d '{"constraints":{"budget":{"staff_cap_idr":70000000}}}' "$OPSIDIO_URL/v1/plans/$PLAN_ID" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["document"]["constraints"]["budget"]["staff_cap_idr"])'
```

Expected result: `70000000`, the new staff cap. The other budget fields do not change.

Steps and roles have their own endpoints. A plan patch that changes them gets 422 `use_item_endpoint`.

### Stop a search

```bash
curl -fsS "${H[@]}" -X POST "$OPSIDIO_URL/v1/optimizations/$OPT_ID/cancel" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'
```

Expected result: a queued search becomes `cancelled` at once. A running search stays `running` until the worker stops it, so wait as in step 7. A search that already ended gives 409 `optimization_finished`.

## Rules for every request

- **Bodies:** send JSON. The limit is 1 MB.
- **Units:** money is an integer amount in IDR. A time is `"HH:MM"` in Asia/Jakarta time.
- **Lists:** set `limit` from 1 to 100 (default 20). To get the next page, send the `next_cursor` value as `cursor`. Lists show the newest items first.
- **Repeated requests:** these calls accept an `Idempotency-Key` header: `createPlan`, `createStep`, `createRole`, `applyVenuePreset`, `applyStepPreset`, `simulatePlan`, `optimizePlan`, and `cancelOptimization`. For 24 hours, the same key with the same body returns the stored response. The same key with a different body gets 409.
- **Errors:** every error has the form `{"error": {"code", "message", "details"}}`. Match on `code`. Only 422 responses have `details`.

## Operations

| Method and path | Use |
|---|---|
| `GET /health` | Check that the service runs. |
| `GET /v1/venue-presets`, `GET /v1/venue-presets/{preset_id}` | Show the known venues. |
| `GET /v1/step-presets`, `GET /v1/step-presets/{preset_id}` | Show the known process steps. |
| `POST /v1/plans`, `GET /v1/plans` | Create a plan, or list the plans, candidate plans included. |
| `GET`, `PATCH`, `DELETE /v1/plans/{plan_id}` | Read, change, or delete a plan. |
| `POST /v1/plans/{plan_id}/steps`, `PATCH`, `DELETE /v1/plans/{plan_id}/steps/{step_id}` | Add, change, or remove a step. |
| `POST /v1/plans/{plan_id}/roles`, `PATCH`, `DELETE /v1/plans/{plan_id}/roles/{role_id}` | Add, change, or remove a staff role. |
| `POST /v1/plans/{plan_id}/apply-venue-preset` | Replace the venue of the plan with a preset venue. |
| `POST /v1/plans/{plan_id}/apply-step-preset` | Copy one preset step into the plan. |
| `POST /v1/plans/{plan_id}/validate` | Get every error and warning. |
| `POST /v1/plans/{plan_id}/simulate` | Run the plan with the flow or des method. |
| `GET /v1/plans/{plan_id}/runs`, `GET /v1/runs/{run_id}` | List the runs (filter with `?purpose=`), or read one run with its output. |
| `POST /v1/plans/{plan_id}/optimize` | Start a search for a better plan. The body takes `optimization_method`. |
| `GET /v1/plans/{plan_id}/optimizations` | List the searches of a plan. |
| `GET /v1/optimizations/{optimization_id}` | Read the status, progress, and candidates of a search. |
| `POST /v1/optimizations/{optimization_id}/cancel` | Stop a search. |

## Error codes

| Status | Codes |
|---|---|
| 401 | `invalid_api_key` |
| 404 | `plan_not_found`, `run_not_found`, `optimization_not_found`, `step_not_found`, `role_not_found`, `preset_not_found` |
| 409 | `idempotency_key_reused`; `optimization_active` (delete during a search); `optimization_finished` (cancel after the end) |
| 413 | `body_too_large` |
| 422 | `validation_failed` (bad fields), `plan_invalid` (validation errors), `hard_limits_broken` (optimize only), `use_item_endpoint` (a plan patch changes steps or roles), `optimization_method_unavailable` (`llm_guided` while the server has no OpenAI key) |
| 429 | `optimization_queue_full`: five searches are queued or running. Wait for the time in the `Retry-After` header (60 s). |

## Read the full reference

`api/openapi.yaml` lists every field, example, and error. The live service does not serve `/docs` or `/openapi.json`.

To read the reference as a web page, run this in `projects/opsidio-sandbox/api/`, then open the file in a browser:

```bash
npx --yes @redocly/cli@2 build-docs openapi.yaml -o /tmp/opsidio-api.html
```
