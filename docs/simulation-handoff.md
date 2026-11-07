# Simulation handoff

Implementation handoff for Faisal, Doni, Wira, and Andre. The API contract was checked against the algorithm docs merged at `09dd989`. The GBK engine checks below are acceptance work. [GBK demo plan](gbk-demo-implementation.md)

## Baseline contract

Use `PlanDocument` in OpenAPI as the base input contract. The merged `example_plan.json` matches the supplied JSON and validates against it. Preserve the v0.1 event, ticket categories, venue layout, process steps, staffing, constraints, and demand. A draft plan can be partial. Run `validatePlan` before simulation or optimization so it can check references and rules across sections. [OpenAPI contract](../api/algorithm/openapi.yaml)

The merged `example_output.json` illustrates a 20-replication discrete-event simulation (DES) and excludes individual traces. It is useful for report semantics. Use the OpenAPI `Run` example for API response fixtures. The standalone report fails the `OutputDocument` schema, including missing plan IDs, `uncomputed_fields`, and scorecard `shortfall` values. [Illustrative output](../api/algorithm/example_output.json)

## Add spatial and behavioral context

Treat these as optional, versioned extensions to the same editor plan revision. OpenAPI permits additional plan properties. Their validation, persistence, and use in the engine require an explicit integration. For the first slice, keep the extensions in the editor revision and submit the compiled v0.1 plan to the API.

| Proposed section | First fields | Projection into the algorithm input |
| --- | --- | --- |
| `participant_behavior` | Segment ID, ticket category ID, share within that category, arrival shares over shared time bins, arrival node ID, and provenance | Weight the segment arrival shares into `demand.arrival_windows_percent[category_id]`. Preserve category attendance, `gate_join_windows`, and `group_size_share_percent`. Unconfigured categories retain their existing curve or the API default. |
| `spatial` | Venue-local coordinate frame in metres, stable navigation nodes with positions, directed walkable edges, and bindings to existing zones, gates, and service points | Set `venue.layout.walking_paths[].distance_m` from each configured route's traversed edge lengths. Preserve its logical `from` and `to` IDs. Other paths retain their base distances. |

Validate extension versions, references, and reachable configured routes before compiling. Require the segment weights for each configured category and the arrival shares within each segment to sum to 100%. Use common, non-overlapping time bins in the event's local time. Preserve the base eligibility, accessibility, and staffing rules.

This projection carries category-level arrival curves and route distances into the existing input. Segment-specific behavior, individual arrival schedules, and route geometry stay in the editor until the simulator consumes them directly.

## Compile feasible scan lanes

Bind each planned scan lane to the GBK scan checkpoint and its lane group using the same IDs in the editor, exported plan, and result lookup. Validate physical placement and the scenario's clear-width requirement in the editor. Count scanner allocations during the modeled window and staff whose shift and role cover the lane. Each active lane consumes its configured resources. Account for allocations elsewhere before counting available equipment or crew.

Map the active count to the agreed `LaneGroup.count`. Use `equipment_per_lane`, the equipment inventory, and staff shift, role, and assignment fields from the base plan. Show any limiting requirement next to the draft lane count and keep the invalid draft editable. Require all checks to pass before creating a runnable or selectable revision. Doni's plan validation still applies after compilation. [Lane and resource schemas](../api/algorithm/openapi.yaml)

## Simulation and optimization

Submit the compiled document to `POST /v1/plans`, then validate and simulate by its returned plan ID. The documented `SimulateRequest` has `simulation_method`, `replications`, and `base_seed`. An optimization starts from a stored plan snapshot. It scores moves with flow runs and can verify and select finalists with DES using `verify.replications` and `verify.base_seed`. Compare the resulting baseline and candidate run IDs and scorecards. For the first slice, keep behavior and geometry fixed and vary one allowed operational lever. [Optimization guide](../api/algorithm/api-quick-start.md)

For paired DES runs, use the same replication count and base seed. Record the editor revision, extension versions, and compiled snapshot hash so results can be tied back to their inputs. If the engine later consumes the extensions directly, include the extension hash in the run's reuse identity and carry the same extension revision through optimization and verification.

## Decision summary and saved runs

The demo compares the stressed Plaza Utara baseline with one feasible additional scan lane. Hold the arrival curve, exception handling, and scenario conditions fixed. Include the added scanner and crew assignments in the candidate. Record one queue target and budget before comparing.

Show the baseline and candidate peak scan queue for the same scan checkpoint and a consistent statistic across replications. Show P90 gate wait, admissions before showtime, staffing and equipment cost, and whether the target and budget were met. Save the selected feasible revision, its assumptions, and its run IDs. If the required metrics are unavailable, show the route and geometric checks and leave the operational decision pending.

Store each pre-run result with the compiled snapshot hash, editor revision, simulation method, seed, and replication count. Live edits update layout and route immediately. Show operational results for a live revision when a matching run completes. Keep prepared results available under their own revisions.

## Direct simulation and replay

A later engine adapter can pass explicit arrivals and walking durations to the same engine that advances queues and service. Each arrival carries a synthetic `agent_id`, ticket category ID, arrival node ID, elapsed seconds from a run start with UTC offset, and optional group ID. The adapter combines generated arrivals for configured segments with the baseline generator for everyone else.

Replay requires a separate event stream from a real DES replication. The proposed manifest records the run ID, replication index, time origin, and geometry revision. Events carry a sequence number, elapsed seconds, synthetic agent ID, event type, and relevant node, edge, lane group, or process step references. Use the sequence number to order simultaneous events. Record actual queue join time, and preserve the report's distinction between pre-opening holding and service-point wait.

The published API documents neither explicit arrival or walking-duration inputs nor a replay endpoint. Confirm with Doni whether the engine has internal hooks for these before promising per-attendee replay.

## First-hour integration gate

1. By T+60, Doni and Faisal create, validate, and simulate a minimal GBK Plaza Utara plan with GBK-specific IDs. Check that one feasible scan-lane change reaches the correct lane group and is reflected in the output using a constrained test case. Verify that the scan queue metric is available. The Tennis Indoor example is a separate compatibility fixture. [Plan fixture](../api/algorithm/example_plan.json)
2. Check one arrival-window change and one route-distance change independently. Confirm the engine behavior and record which checks passed. If the GBK run or scan-queue metric misses the gate, prepare the layout and route comparison while the team resolves integration.
3. Before freeze, walk through the layout with a ticketing or venue ops reviewer. Check the route, failed-scan branch, one row of barriers, one lane's staff and scanner, and the scenario assumptions. Exercise the no-scanner live edit and verify that it identifies the constraint and blocks the run. If an event trace is available, reconcile one replication's replay with that replication's measurements.
