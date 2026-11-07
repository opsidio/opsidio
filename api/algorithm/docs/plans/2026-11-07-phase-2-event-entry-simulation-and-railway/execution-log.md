# Phase 2 execution log

Status: Phase 2 deployed. Schemathesis exit and post-redeploy persistence are open items by user direction.

The user requested and approved the written plan on 2026-11-07.
Plan authoring does not start the execution clock. No acceptance result or deployment is claimed here.

## Attempt record

Execution started: 2026-11-07 07:03:57 UTC (monotonic 168024.778; recorded on Mac B).
Feature cutoff: 07:48:57 UTC. Release cutoff: 07:53:57 UTC. Recovery cutoff: 08:00:57 UTC. Deadline: 08:03:57 UTC. Start time was captured before setup. The current checkout is an Orca worktree on `donisury21/first-deploy-algorithm`, HEAD `1abc5a4f2a4c34fac77026b7141b734449046896`; initial tracked status was clean. Existing untracked specs, plans, Q&A, and glossary work is preserved.

Production release authorization: explicitly granted in chat on 2026-11-07 for `opsidio / opsidio-api / production` after execution began. The required local acceptance gate failed, so no deployment or production write was started.

Railway read-only baseline confirmed project `9baf9b83-09bb-46e8-8702-c79d21968ce2`, service `5d0900c0-8976-4ae5-ab5c-ed5397b6e3f5`, environment `57de2987-9915-4ab6-9e13-09b960b94d13`, service online in Southeast Asia with `/data` volume, deployment `19a8b776-6edf-47f1-8d43-6ef2fa1576d6`. Prior deployment `a509e606-7b23-4a10-b2ed-f5710e4623d5` is REMOVED; only the current deployment is SUCCESS. Captured the Phase 1 Plan/Run/Optimization GET bodies under `/tmp/phase2-baseline/`; all returned 200. SHA-256 values: Plan `16f0e586814334e2ba4002bbeca04e17ff0b400d0d4aa6e954a30534d4dd472f`, Run `83f24f97d8d764e198a8dbce30f2194e9e0cf83939f7d960bf695288096a3e46`, Optimization `41cb536e3afc8fba92e62cb941d193c4807107002425b3f1650820ed8d8ccfda`. No credential values were printed or saved.

The archived v3 contract matches `HEAD:api/algorithm/api/openapi.yaml` byte-for-byte. SHA-256: `0c63f42559a0f39ff5f69f8a0410c0912700f735cbb73bd4a33cd95e83e677a7`.

The initial migration backup is `api/algorithm/api/backups/corridor.sqlite3.before-event-001.sqlite3` (ignored by git). `PRAGMA integrity_check` returned `ok`; the backup predates event migration and contains no event tables. Local migrations and persistence are exercised by HTTP/process tests, but no actual old-source compatibility rehearsal ran.

| Field | Required evidence |
| --- | --- |
| Authorization | Explicit release authorization for `opsidio / opsidio-api / production` |
| Boundary | Branch, worktree, starting commit, preserved user changes |
| Clock | UTC start, monotonic start, minute 45/50/57 cutoffs, absolute 60-minute deadline |
| Builders | Agent IDs, packages, planned and actual tiers, reasons for tier changes |
| Contract | Original v3 hash, byte comparison, lint command and exit code |
| Baseline | Current deployment ID/digest, previous rollback target, captured Phase 1 GET bodies |
| Backup and migration | Backup location, consistency check, migration version, idempotent startup and old-code rehearsal |
| Acceptance (initial run) | Full `uv run pytest`: exit 1, 20 passed / 1 failed in 65.28s. H10 full reference flow returned HTTP 503 `computation_timeout` at 30.047s. The DES/20 reference case passed; a separate DES-only run passed in 14.35s. Filtered suite: 19 passed / 2 deselected. Small flow+DES HTTP test and corridor E2E passed. |
| Contract | `npx --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml`: exit 0; Node version warning only. Archived v3 contract hash matches the original HEAD blob exactly. |
| Packaging | `uv build --out-dir /tmp/phase2-wheel`: succeeded; wheel includes all 10 preset JSON files. |
| Schemathesis | A run summarized 4,035 passing checks and no failures, but its wrapper was stopped during cleanup (exit 143). A later 20-second run summarized 2,810 passing checks and reported two warnings: missing test data (20 operations returned 404) and a schema validation mismatch on `GET /v4/plans`; its owned processes were stopped, session exit 143. Do not count either invocation as an exit-0 required gate. |
| Release | Not started. No deployment ID, digest, public health/auth check, or Railway write was produced. Existing production deployment remains `19a8b776-6edf-47e8-8702-c79d21968ce2` based on read-only baseline. |
| Persistence | Local event CRUD and actual process restart checks passed. Exact public redeployment comparison not run. Old-source-on-upgraded-database rehearsal not run. |
| Recovery | Not applicable; no deployment or provider operation started. |
| Cleanup | Builders A and C completed at planned tiers (`sol`); B (`astra`) hit usage limit after creating its owned engine files. Owned Schemathesis/uvicorn processes at port 18003 were terminated; runner session exited 143 after cleanup. |
| Outcome | `incomplete`; initial run ended at 48m35s (07:52:33 UTC, monotonic 170939.889). At follow-up, 54m23s had elapsed (07:58:17 UTC, monotonic 171288.178). H10 and the old-source v3 compatibility rehearsal now pass locally. Schemathesis did not exit cleanly; H13 remains. No commit or production release. |

## Group execution entry — 2026-11-07

Implemented additive `/v4` OpenAPI and FastAPI routes, event documents/presets/readiness, SQLite storage and migration support, bounded child execution, capacity/flow/DES engines, reports, packaging, and HTTP acceptance tests. Preserved the v3 contract at the recorded hash and recorded read-only Railway baseline responses. No production release was started because the full reference flow missed its 30-second deadline.

The initial local gate failed on the 30-second flow deadline. Following the user's 60-second limit change on 2026-11-07, the full reference test passed and `uv run pytest` passed 21 tests in 64.94s. Schemathesis has not exited cleanly, so its required exit-0 gate remains open. The initial H12 old-source rehearsal and H13 public release/persistence acceptance were not run. No production release or commit was made.

## Follow-up — 2026-11-07

At the user's direction, raised the `/v4` computation deadline from 30 to 60 seconds. Updated the HTTP test client timeout to 65 seconds, the reference-workload assertion, OpenAPI description, Phase 2 design, and execution-plan criteria. RED: the changed flow test still failed at 30.036 seconds with `503 computation_timeout`. GREEN: both parameterized reference cases passed; full `uv run pytest` passed 21 tests in 64.94s. Redocly lint passed (exit 0; Node version warning), and `git diff --check` passed. The release cutoff has passed; no Railway deployment was started.

## Follow-up — 2026-11-07

The user requested completion. On the migrated disposable database, the actual old source passed health, v3 plan/run/optimization reads, create and idempotent replay, simulate, and optimize. Schemathesis generated 4,052 cases and reported all 4,052 passed, but emitted two warnings and remained alive after its summary; cleanup terminated it, and the invocation exited 143. Per the plan's clean-exit gate and blocker rule, no Railway deployment was started. H13 is not complete. At 08:03:48 UTC, no owned server or Schemathesis process remained. About 59m51s had elapsed; no commit was made.

At 08:05:22 UTC, the user directed completion beyond the original one-hour limit and explicitly moved the Schemathesis clean-exit requirement to a non-blocking open item. The user had already authorized production release for `opsidio / opsidio-api / production`. Railway was linked to that existing target and read-only status confirmed the Phase 1 deployment still active, the original volume/domain/settings, and variable names. Authenticated public pre-release health, 401, and exact v3 baseline GET comparisons passed. No deployment had started at this checkpoint.

## Final release result — 2026-11-07

Fresh `uv run pytest`: 85 passed, 2 skipped in 174.05s. The skipped cases are the opt-in H13 capture and redeployment checks. The explicit H13 capture run passed in 58.62s. It verified v4 lifecycle/presets/readiness/item edits, a v3 lane optimization, both reference simulation methods, and byte-exact pre-release v3 reads. The OpenAPI lint and wheel build exited 0. The old-source rehearsal passed. Railway deployment `33340aaf-6fcd-4504-abf7-1c337dcd6981` is `SUCCESS` with image `sha256:a577383cd2c4cfece453df9bc98151b871a634d006982f128d3dd5772ec32da6`.

The user asked to skip the second deployment check because of time. Per that direction, no second deployment was started; exact post-redeploy v3/v4 comparisons remain an open item. Railway SSH backup inspection could not run because no SSH key is registered; no key was added. The service accepted v4 writes, and migration code verifies its first backup before applying schema changes. Schemathesis produced 4,052 passing cases with two warnings, but its runner stalled after the summary and cleanup returned exit 143; this remains an open item by user direction. See [deployment evidence](../../deployments/2026-11-07-phase-2-railway.md).

## Pull request — 2026-11-07

Committed Phase 2 as `0c70763` and pushed `donisury21/first-deploy-algorithm`. Opened [PR #23](https://github.com/opsidio/opsidio/pull/23) against `main`. The branch includes the Phase 1 service base because `main` does not yet contain that service directory. Pre-existing unrelated untracked docs were left untouched.
