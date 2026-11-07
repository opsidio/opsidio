# Phase 2 event-entry simulation and Railway execution plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` once for this group. Execute with the three builders assigned below.

Date: 2026-11-07
Status: Approved; execution has not started.
Approved: 2026-11-07, by the user.

**Goal:** Deliver full event-entry plans, genuine flow/DES reports, and verified Railway persistence within one elapsed hour.

**Architecture:** Extend the existing FastAPI service with isolated `/v4` resources and additive SQLite migrations. Run full-plan calculations in one bounded child process. Preserve `/v3` behavior and records.

**Tech stack:** Python 3.12, uv, FastAPI, Pydantic v2, SQLite, standard-library simulation, pytest, HTTPX, and existing Railway packaging.

**Spec:** [Approved Phase 2 design](../../specs/2026-11-07-phase-2-event-entry-simulation-and-railway-design.md).

## Authorization and boundary

The user approved this plan on 2026-11-07, including multiple subagents for execution.
The user subsequently removed the instruction that prohibited execution of this plan.
Production release requires explicit authorization for `opsidio / opsidio-api / production`.
Do not infer production authorization from design approval or Phase 1 deployment authorization.

One group produces one runnable service and one eventual MR on `donisury21/first-deploy-algorithm`, the current branch.
The applicable rules define no further branch convention. Retaining this boundary follows the existing Phase 1 plan.
The builder packages share interfaces and are not independently mergeable tasks.
Preserve existing tracked and untracked work. Do not execute or revise either earlier plan.
The design retains the no-Jira exception. System `algorithm` exists in [CONTEXT-MAP.md](../../../../../CONTEXT-MAP.md).

| task | jira | system | model | depends_on | boundary |
| --- | --- | --- | --- | --- | --- |
| 01-build-event-entry-and-release | null | algorithm | sonnet | [] | donisury21/first-deploy-algorithm |

Read [the task](01-build-event-entry-and-release.md), [execution log](execution-log.md), and [open questions](open-questions.md).
There are no preceding merge groups. All package dependencies are internal to this group.

## Global constraints

- Keep `/v3` corridor behavior and resources compatible; add `/v4` without conversion or `/v1` and `/v2` aliases.
- Preserve the current v3 contract byte-for-byte at `docs/specs/references/2026-11-07-v3-corridor.openapi.yaml` during execution.
- Use one canonical OpenAPI 3.1 service contract with `info.version: 4.0.0`; retain the product-root symlink.
- Implement all 21 operations from design §5. Do not add `/v4` optimization, cancellation, or recommendation routes.
- Keep runtime code, preset data, fixtures, tests, and dependencies inside `api/algorithm/api/`.
- Preserve full source documents, integer IDR, and Asia/Jakarta `HH:MM` values. Use UTC RFC 3339 resource timestamps.
- Require explicit `simulation_method: flow` or `des`; reject `abm`, unknown settings, `spatial`, and `participant_behavior` with field-level 422 errors.
- Accept up to 10,000 sold-plus-issued ticket holders before no-show sampling; DES supports 1–100 replications, default 20.
- Keep synchronous simulation, one calculation across both APIs, a 60-second `/v4` computation deadline, and immediate 429 contention.
- Include child setup, capacity experiments, replications, and reports in the computation deadline. Terminate and join timed-out children.
- Preserve `/v3` computation deadlines and semantics. Keep reads and public `/health` available; disable generated docs.
- Keep bodies below 1 MiB, constant-time API-key checks, standard errors, and `Retry-After: 1` on `service_busy`.
- Scope optional POST idempotency by version, operation, and target for 24 hours; commit results and replay atomically.
- Keep SQLite WAL, foreign keys, short transactions, parameterized statements, and the five-second busy timeout.
- Add separate event-entry tables; never rewrite existing `plans`, `runs`, `optimizations`, or `replays` records.
- Before first migration, take one consistent SQLite backup under `/data/backups/`; preserve it on later startups.
- Reduce operational capacity to available eligible staff, equipment, and physical lanes. Preserve requested counts and planned costs.
- At closing, refuse external queues and new arrivals; finish already admitted work within the horizon. Charge actual started overtime hours.
- Use the 6,000-visitor lane experiment with 1,000 warm-up visitors for flow capacity. Do not substitute reciprocal mean service time.
- Preserve all eight exception outcomes, source report sections, explicit nulls, and population conservation.
- Use actual HTTP and process restarts for acceptance. Do not import engines into acceptance tests or assert illustrative output as truth.
- Reuse the existing Railway target, volume, domain, key, database path, region, and replica settings. Create no resources or paid services.
- Keep the complete scope and the 60-minute elapsed limit. Missing required acceptance means `incomplete`.

## Multiple-subagent execution

Use at most three active builders plus the coordinator, matching the four available slots.
The current request supplies workflow opt-in for future execution. No subagents are dispatched during plan authoring.

| Owner | Tier | Responsibility | Internal dependency |
| --- | --- | --- | --- |
| Coordinator | Session | Contract, process harness, shared interfaces, integration, packaging, release, evidence | Collects all builder handoffs |
| A | `sol` / sonnet | Full-document models, writes, presets, readiness validation | Frozen contract and interfaces |
| B | `astra` / opus | Capacity allocation, flow, DES, costs, reports | A's document schema; frozen raw-JSON engine interface |
| C | `sol` / sonnet | Migration, storage, routes, bounded child execution | Frozen A/B interfaces and coordinator contract |

B uses `astra` for event ordering, blocking positions, resource allocation, stochastic streams, and horizon conservation.
A and C use `sol` for defined implementation work. Record actual tiers and any change of tier in the execution log.
Use isolated context with `fork_turns: none` and the named tier agent. Do not silently inherit the session model.
Send each builder its ownership, required spec/source sections, interfaces, acceptance cases, and shared absolute deadline.
Tell every builder: “You are not alone in this checkout. Preserve other owners' edits. Do not revert their work.”
Builders must not spawn nested agents, commit shared work, modify other owners' files, or run Railway writes.
Only the coordinator stages scoped files or commits after integration.

Run A, B, and C concurrently after the contract/interface handoff. Parallelism is limited to exclusive files.
This explicit workflow adapts the skill's default serial implementer rule to the requested multiple-agent execution and existing group structure.
No nested branches or worktrees are required; verify the existing Orca worktree during execution.
Read `superpowers:using-git-worktrees` then; use Orca tooling for any necessary Orca worktree operation.

An independent plan or large-diff review requires separate user approval under the global `fable` rule.
Do not dispatch that review automatically, substitute another tier, or treat this request as review authorization.
The coordinator checks spec coverage and integration locally. Preserve this approval rule when applying execution skills.

## Shared execution clock

Planning time does not start the execution clock. At future execution, start one monotonic clock before setup or reasoning.
Record start, feature cutoff, release cutoff, recovery cutoff, and deadline. Send the same deadlines to every builder.
Owner waits, skill reads, builds, tests, fixes, releases, reviews, cleanup, and reporting count toward the same hour.

| Elapsed window | Coordinator | Builders |
| --- | --- | --- |
| 0–7 minutes | Check authorization and checkout; archive/lint contract; freeze interfaces; dispatch | Start only after handoff |
| 7–35 minutes | Author HTTP tests, reference fixture, process harness, and packaging | A/B/C implement separate files and report evidence |
| 35–45 minutes | Integrate, run journeys, rehearse migration and old-image compatibility | Fix owned files; deliver final handoff |
| 45–50 minutes | Stop new functionality; finish required local checks; start first release only if ready | Verification support only |
| 50–57 minutes | Finish public checks and an already-started persistence redeployment | Support acceptance; no feature additions |
| 57–60 minutes | Cancel or recover, stop owned work, record outcome | Stop and report process cleanup |

These are budget allocations, not measured estimates. The one-hour feasibility remains unproven.
Start no new Railway deployment after minute 50, including the persistence redeployment.
Both deployment starts must fit before that cutoff; do not extend it to finish the second deployment.
By minute 57, stop acceptance work and use the remaining time for recovery, cleanup, and reporting.
Bound every command by the shorter of its useful timeout and the remaining budget before its next cutoff.
Do not start an operation whose timeout exceeds that budget.
Stop all owned work at the deadline. Record pending provider operations as `incomplete`.

Execution extension: on 2026-11-07, after the original cutoff, the user directed completion of Phase 2 and moved the Schemathesis clean-exit gate to open items. This instruction supersedes the original one-hour and minute-50 release cutoffs for this continuation. Keep the original production target and deployment authorization.

Actual blockers stop execution immediately under the global rules. Preserve files and report the blocker.
Record non-blocking questions separately and continue. Do not restore the old full-plan feasibility gate.

## Review focus

Each condition maps to executable cases in the task's acceptance matrix.

1. Parent replacement or null patches must not bypass step/role item endpoints or erase required defaults. Owned by A/C, H02.
2. Shared staff and equipment must not be double allocated across points with overlapping schedules. Owned by B, H06.
3. A completion at closing precedes refusal; internal buffers survive closing; horizon overruns remain unfinished. Owned by B, H08.
4. Timeout, crash, or replay races must leave no orphan calculation, partial Run, or success replay. Owned by C, H11.
5. Migration, restart, and image rollback must preserve exact saved `/v3` and `/v4` GET responses. Owned by C/coordinator, H12–H13.

## Completion gate

Mark the group complete only after every H01–H13 check passes locally where applicable, and all required public checks pass.
Require pytest and Redocly exit 0, both reference methods within 60 seconds, and successful public H13 workflows. Record Schemathesis and post-redeploy persistence findings as open items by the user's direction; they do not block release or completion.
Require actual old-code compatibility, first-migration backup evidence, and owned-process cleanup.
Record actual elapsed time and deployment state before the shared deadline.
Otherwise record `incomplete`, the missing evidence, remaining work, and any recovery still pending.
