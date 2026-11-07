# Phase 2 open questions

Date: 2026-11-07
Status: Phase 2 is deployed. Follow-up items below remain open by user direction or because remote backup inspection was unavailable.

| Item | Treatment |
| --- | --- |
| Can all acceptance fit within one hour? | Unmeasured. Measure during execution; keep scope and deadline unchanged. |
| What is the current Railway deployment and rollback state? | Inspect during authorized execution. The Phase 1 deployment record is historical evidence. |
| Will a later instruction authorize production release? | Required before production writes. This plan request does not authorize release. |
| Does the current image permit a readable first-migration backup? | Verify volume permissions and backup behavior during local rehearsal and authorized deployment. Fail startup on backup failure. |
| Can the full reference workload meet the updated 60-second budget? | Yes locally. The user changed the requested deadline from 30 to 60 seconds. Both full reference cases passed, and the full suite passed 21 tests in 64.94s. This does not complete the public release or old-code rehearsal. |
| Why does the Schemathesis runner stall, and how can its warnings be resolved? | Open, non-blocking by the user's direction on 2026-11-07. The latest run reported 4,052 passing cases and two warnings, then stalled after its summary; cleanup returned exit 143. Follow up on missing generated resources and schema validation mismatches for `GET /v4/step-presets` and `POST /v3/plans`. Owner: coordinator. |
| Has the migrated database been checked with the old source revision? | Yes. On 2026-11-07, old source passed health, v3 plan/run/optimization reads, create/replay, simulate, and optimize against the upgraded disposable database. |
| Did the production release and persistence journey pass? | The Phase 2 release and public H13 capture passed. The user asked to skip the second redeployment check due to time, so exact post-redeploy v3/v4 comparisons remain open. Remote backup-file inspection also remains open because Railway SSH has no registered key. See the [deployment record](../../deployments/2026-11-07-phase-2-railway.md). |

Record new non-blocking items with date, owner, impact, and evidence. Continue work that does not depend on them.
Actual blockers stop execution and require a report to the user. Do not guess a workaround.
