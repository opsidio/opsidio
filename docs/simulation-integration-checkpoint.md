# Simulation integration checkpoint

## 11:17 WIB checkpoint

The full-screen GBK foundation is merged in PR #4. The admission mapping is in PR #5. The scene has viewer cameras, sourced ground data, illustrative stadium and equipment models, and an optional proposed entry-area layer.

The next work runs in three isolated worktrees. Faisal owns shared interfaces, app composition, dependency/configuration changes, review, and browser checks.

| Lane | Deliverable |
| --- | --- |
| Layout editor | Reusable overlay for placements, persisted revisions and JSON import/export. The standalone scene remains full-screen. |
| ABM | Seeded onsite arrivals and group journeys on an authored directed graph, in a browser worker. |
| DES | A server-side adapter to Doni's documented existing engine, with genuine results and explicit unconfigured/error states. |

## Frozen seams

Editor-state import/export uses `opsidio-editor/0.1` with camelCase fields. The algorithm-facing `opsidio-layout/0.1` envelope remains a separate proposal for the boundary adapter.

The TypeScript integration types are in `web/src/simulation/runtime-types.ts`. Ground coordinates remain local metres with X east, Y up, Z south.

ABM onsite arrival is arrival at the graph's origin node. Checkpoint arrival adds walking time. Keep both counts in separate 15-minute buckets. Project onsite demand into Doni's arrival curve when the plan also contains walking distances, so walking is counted once. ABM movement is a journey preview. DES determines processing and queue metrics.

The DES bridge accepts a compiled, valid v0.1 plan plus `base_seed` and `replications`. It preserves Doni's plan and run identities and output shape. API credentials stay in the local bridge's environment. The bridge can be implemented and tested with fixtures while service access is arranged.

The agent outputs must be reviewable commits with focused tests and concrete caveats. They do not push or edit the app entrypoint; the orchestrator integrates them and shows the local result.
