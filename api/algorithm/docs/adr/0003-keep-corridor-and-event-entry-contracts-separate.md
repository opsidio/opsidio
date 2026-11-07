# Keep corridor and event-entry contracts separate

Date: 2026-11-07
Status: Accepted decision; Phase 2 design remains Draft.

Phase 1 is deployed and has saved immutable corridor resources.
Phase 2 needs editable full documents and different simulation reports.
The user selected separate contracts in Q4 and explicit method selection in Q5.
Preserve `/v3` and introduce `/v4` for full event-entry plans.
This avoids changing the meaning of existing documents, results, and client requests.
See the [Phase 2 draft](../specs/2026-11-07-phase-2-event-entry-simulation-and-railway-design.md) and [Phase 1 deployment](../deployments/2026-11-07-phase-1-railway.md).

## Considered options

- Replace `/v3`: rejected because existing clients and saved corridor resources must remain usable.
- Accept both documents through the same operations: rejected because editing and simulation semantics differ.
- Convert corridor plans automatically: rejected because a corridor document does not define the full event-entry process.
- Restore historical `/v1` or `/v2` aliases: excluded from the selected compatibility policy.

## Consequences

- Keep existing `/v3` requests, responses, resource reads, and lane comparisons compatible.
- Add `/v4` operations with distinct operation IDs and full-document resources.
- Require explicit `flow` or `des` for full-plan simulation. Reject unavailable methods.
- Keep corridor and event-entry resource identities separate.
- Preserve the deployed SQLite file and existing tables. Add versioned storage without converting corridor records.
- Keep document money as integer IDR and document clock times as Asia/Jakarta `HH:MM`, for full-document compatibility.
- Keep API resource timestamps in UTC RFC 3339.
- Keep the deployed public `/health`; the historical full-scope ADR's protected-health choice does not apply to this phased service.
- This decision authorizes documentation only. It does not authorize implementation or production changes now.
