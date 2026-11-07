# Phase 1 corridor service execution plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` once for this group. Execute the assigned packages with multiple sub-agents.

Date: 2026-11-07
Status: Approved; execution has not started.
Approved: 2026-11-07, by the user.

The user approved this plan and explicitly instructed the agent not to execute it. Wait for a separate execution instruction.

**Goal:** Deliver saved corridor plans, deterministic individual simulation, and feasible lane comparison through HTTP within 60 elapsed minutes.

**Architecture:** One FastAPI process serializes POST computation and persists immutable resources in SQLite. One engine computes both simulation and lane comparison. Three builders own separate files; the coordinator owns integration and HTTP acceptance.

**Tech stack:** Python 3.12, uv, FastAPI, Pydantic, SQLite, pytest, and HTTPX.

**Spec:** [Approved phase 1 design](../../specs/2026-11-07-phase-1-corridor-simulation-and-optimization-design.md). Read the entire design before execution.

## Boundary and metadata

One independently runnable group produces one eventual MR on the existing branch. Builder packages are responsibilities within this group, not separate merge tasks.
No additional branch convention was found in the applicable product rules. Retain the current checkout boundary as a planning choice.
Preserve existing user changes. Do not execute or revise the historical full-scope plan.
The spec retains the recorded no-Jira exception; do not create a ticket.
System `algorithm` is registered in the root [context map](../../../../../CONTEXT-MAP.md).

| task | jira | system | model | depends_on | boundary |
| --- | --- | --- | --- | --- | --- |
| 01-build-corridor-service | null | algorithm | sonnet | [] | donisury21/first-deploy-algorithm |

Read [the task](01-build-corridor-service.md), then maintain [the execution log](execution-log.md) and [open questions](open-questions.md).
The user's multiple-agent request supplies workflow opt-in for future execution. This request explicitly prohibits execution now.

## Global constraints

- Implement from scratch. Do not copy or adapt the previous source implementation.
- Keep the complete runnable service, examples, dependencies, and tests inside `api/algorithm/api/`.
- Preserve the existing contract byte-for-byte at `docs/specs/references/2026-11-07-v2-full-scope.openapi.yaml`, relative to the product root.
- Replace the service contract with OpenAPI 3.1, version `3.0.0`; retain the root contract symlink.
- Expose only public `/health` and the six approved `/v3` operations. Disable generated schema and interactive docs.
- Use `corridor-1` complete documents and `corridor_v1`; enforce every limit in design sections 4–8.
- Use exact IDR arithmetic, UTC resource timestamps, canonical snapshot hashes, and explicit model limitations.
- Use one process, SQLite WAL, foreign keys, a five-second busy timeout, and short atomic result transactions.
- Bound bodies below 1 MiB, simulations to two seconds, and optimization to ten seconds.
- Return concurrent POST requests as 429 `service_busy`, with `Retry-After: 1`; keep reads available.
- Scope optional idempotency keys by operation and target for 24 hours. Hash submitted JSON before defaults.
- Do not refresh historical fixture manifests or claim v2 compatibility, ABM completeness, or production readiness.
- Use real HTTP and process restart in one E2E suite. Do not import engine functions or substitute computed outputs.
- No Docker build, deployment, benchmark, model call, owner credentials, or later-phase implementation is required.

## Multiple-agent schedule

The coordinator starts one monotonic clock before environment inspection, skill loading, setup, or implementation reasoning.
Set a shared absolute deadline at start plus 3,600 seconds. Send it to every builder. Never reset or pause it.
Planning this document does not start the execution clock.

| Window | Coordinator | Builder A: `sol` | Builder B: `astra` | Builder C: `sol` |
| --- | --- | --- | --- | --- |
| 0–5 min | Inspect, archive v2, author/lint contract, freeze interfaces, start setup | Not dispatched until contract/interface handoff | Not dispatched until contract/interface handoff | Not dispatched until contract/interface handoff |
| 5–30 min | Package setup, real HTTP E2E authoring, example, README | Models and validation | Individual engine and bounded lane comparison | SQLite and application routes |
| 30–50 min | Integrate, run journeys, assign fixes to owners | Fix owned files | Fix owned files | Fix owned files |
| 50–57 min | Final commands, restart proof, collect evidence | Verification support only | Verification support only | Verification support only |
| 57–60 min | Stop owned processes, record results and elapsed time | Handoff and stop | Handoff and stop | Handoff and stop |

Use at most three builders plus one coordinator, matching the four available slots.
Builder B uses `astra` because timestamp ties, horizon accounting, and deadline-safe optimization require careful algorithm work.
The other builders use `sol` for defined interfaces. Record actual tiers and any changes in the log.
Dispatch all three after the contract/interface handoff. Builders can write against these interfaces before neighboring modules exist.
A package handoff is not independently mergeable; only the complete group can pass acceptance.
Workers must state that they share the checkout and must preserve other owners' edits.
Do not create nested subagents or launch an independent plan/large-diff review without separate user approval.
The coordinator performs the final local consistency review. Any skill requiring such independent review remains subject to the user's approval rule.

These windows allocate budget; they are not measured development estimates or feasibility prerequisites.
Stop feature work at minute 50. Bound every subprocess by the remaining time; E2E has a 180-second maximum.
A missing required tool, material contract change, or other actual blocker stops execution. Report it; do not invent a workaround.
At the deadline, stop and report `incomplete` unless every required check already passed within the window.
Cleanup, fixes, commits, review, and reporting all consume this same budget.

## Review focus

Each condition has an owning acceptance journey in the task.

1. Simultaneous service completion and arrival: release lanes first; zero waits never inflate peak queue.
2. Horizon boundaries: count admission exactly at the horizon; classify unfinished visitors and conserve population.
3. Empty wait samples and zero service: return null P90 only for zero samples; handle coincident route nodes.
4. Request contention and replay races: keep GET available, return bounded POST rejection, and commit replay atomically.
5. Interrupted optimization: retain only completed evaluations and identify `time_limit`; never save an unevaluated candidate.

## Completion evidence

Require all design section 9 journeys, exact outputs, persistence/replay after restart, and matching static contract.
Run these final commands from `api/algorithm/api/` within the shared execution window:

```text
uv sync --locked
uv run pytest tests/e2e -q
npx --offline --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml
```

Require exit 0 and no contract warnings. Record any existing tool-version warning separately.
Record all commands, durations, exit codes, observed behavior, cleanup, and total elapsed time in the execution log.
Report `complete` only when every listed output and check passes within 60 minutes. Otherwise list remaining work and preserve evidence.
