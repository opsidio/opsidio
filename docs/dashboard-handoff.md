# Event planning dashboard

The dashboard uses the team's existing React 19 + TypeScript + Vite application. The previous standalone bootstrap is replaced; the renderer, layout editor, browser worker, geometry and catalogue are reused unchanged.

## Start

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 5173
```

Open http://127.0.0.1:5173. Demo login: **organizer@opsidio.demo** / **Opsidio2026!**. This is the requested hardcoded MVP login, not server authentication. Use this workspace in the team's private demo environment.

A new browser begins with an empty homepage. Create a blank draft or choose **Use GBK sample plan** to edit the supplied 70,000-person plan. Its proposed event date is 14 November 2026, with the 2023 concert retained as a historical reference.

Routes:

- `/`: home and saved drafts.
- `/events`: event list.
- `/events/:id/brief`: event brief and public/private venue choice.
- `/events/:id/attendance`, `/checks`, `/resources`, `/targets`, `/review`: entry planning and review.
- `/simulation?event=:id`: fullscreen interactive `GbkCanvas`. `/simulation` selects the most recent draft when no ID is supplied.
- `/settings`: demo profile and logout. `/reports`: entry point back to event comparisons.

Choose **Try the GBK demo** on the dashboard or from the event form to open the V1 baseline at `/simulation/workspace` in a new tab. Choose **Run simulation** in the open Control Panel to see all five entrances, local queues, version switching and waypoint traces. Playback runs in the browser. The workspace also has the [Doni V3 corridor comparison](corridor-optimization.md).

Planning navigation accepts incomplete estimates, so organizers can move through every section and return to unknown inputs later. Review shows remaining issues; Optimize still validates the full plan. The arrival editor supports editable time periods, a per-category assigned / remaining total, and an explicit even-split estimate based on the event’s configured start and last-entry times. Estimates are applied only to the categories selected by the organizer. Missing values are not silently converted to zero or normalized.

Time fields accept entries such as `5:30 pm`, `1730`, or `17:30`, plus quarter-hour dropdown choices. Values are normalized to the API’s `HH:MM` format on blur or Enter. The event brief groups arrival/admission and show/closing times; wristbands and special-access times are in an optional disclosure and remain in the plan when collapsed.\n\nStaff assignments support changing the role, entrance/help point, lane group, role shift and headcount, plus adding/removing assignments. Shifts can be added and configured above; a shift referenced by a role cannot be removed until that role is reassigned. The contract stores shift on `staff.roles[].shift`, so selecting a shift updates every assignment for that role. Allocation totals, qualification, lane, team-size and shift-coverage checks are visible without blocking draft navigation.\n\nDrafts are saved after each edit in localStorage (`opsidio:plans:v1`). Layouts use a separate key for each event. Export the full plan from Review; export the authored layout from its existing Save / import panel. Optimization jobs and comparisons persist for the current tab in sessionStorage, including refresh recovery. Storage failures remain visible and JSON export remains available.

## V1 and the scene

The page mounts `GbkCanvas` as a React component, without an iframe. Camera, entry markers, layout editing, worker generation and playback controls are dashboard overlays. The original `useAbmWorker` remains the V1 engine; generation happens only after **Generate V1 arrivals**. It makes no optimization request.

Current scene scope: the authored Plaza Utara route and its four CAT 5–8 cohorts (15,500 expected arrivals in the supplied plan). Other areas have markers only. The existing model shows walking arrivals, not service queues. The preview renders a bounded sample while preserving the worker's full generated population. Other venues can be planned and exported, but need a corresponding scene before 3D preview; the dashboard does not present GBK as another venue.

The current graph and editable category expected counts, arrival percentages, dates and seed feed V1. Plan/layout edits invalidate the worker result. The existing editor validates geometry, attachments and route connectivity before the graph can be run.

## Optimize and V2

Start the server bridge in a second terminal:

```sh
# Configure these in your server's environment; never use a VITE_ variable for the key.
export OPSIDIO_API_URL="https://YOUR_ENGINE_HOST"
export OPSIDIO_API_KEY="YOUR_SERVER_SIDE_KEY"
python3 -m api.simulation
```

Vite forwards `/api/simulation/*` to `127.0.0.1:8000`. For production, serve the built web files with SPA fallback and proxy that same path to the Python bridge. A static host alone cannot perform optimization. The bridge intentionally binds to loopback and does not enable cross-origin access.

**Optimize** is the only action that starts Doni's optimization API:

1. Clone the full current plan. Preserve source provenance, cohort IDs, optional extensions and unexposed fields.
2. For GBK, attach the authored `editor_context` and project the checked north queue-to-scan route distance into the logical walking path. This is a limited projection, not a complete spatial recompiler: derived `spatial_context` / `source_scenario` projections remain source references. `derived_projections_require_regeneration` explicitly tells the backend adapter to regenerate these from the submitted plan and layout before using derived representations.
3. `POST /v1/plans`, then `POST /v1/plans/{id}/validate`. Stop and display errors if the service rejects the plan.
4. `POST /v1/plans/{id}/optimize` with greedy search, a 180-second search budget and DES verification of 20 replications using the selected seed. Plan creation and optimization have content-derived idempotency keys.
5. Poll `GET /v1/optimizations/{id}` until terminal. Network errors pause polling and expose **Resume checking**. Cancellation requests are sent to the documented cancel endpoint; the UI keeps polling until the service actually stops.
6. Select a candidate. The bridge fetches its full plan and any referenced baseline/candidate DES runs, checking their IDs, plan ownership and simulation method. The UI shows the service's actual scores and changes. Missing verification is labelled; result values are never fabricated.
7. **Use V2 inputs** requires review of the changes and applies the candidate as a new draft revision. It does not claim to animate a DES queue trajectory. Generate a fresh arrival preview after applying.

A comparison is tied to the exact draft, layout revision and seed. Changed inputs mark it stale and disable applying it. The full returned comparison can be exported as JSON. API keys never enter the browser bundle or response.

The live API was not configured in this development environment. Request/poll/cancel/comparison contracts were verified with mocked upstream responses; browser QA also exercised queued → running → succeeded → candidate review → apply against an isolated local fixture. Those fixtures are not app fallback results and are not served by the default app.

## Checks

```sh
npm run build --prefix web
node --experimental-strip-types --test web/src/dashboard/model.test.mjs web/src/simulation/abm/abm.test.mjs web/src/simulation/layout/core.test.mjs web/src/simulation/route.test.mjs tests/scenarios/coldplay.test.mjs
python3 -m unittest discover -s api/tests -p 'test_*.py'
```

Browser coverage: demo login/logout; first-use home; public/private forms; blank validation; complete six-section GBK journey; persistence on reload; fullscreen scene; worker arrival generation; playback; layout-edit invalidation; missing service configuration; isolated API happy path; candidate review/apply/stale guards; desktop and mobile layouts.

Main integration points: `web/src/dashboard/App.tsx`, `PlanForm.tsx`, `model.ts`, `SimulationPage.tsx`, `api.ts`; server routes in `api/simulation/__main__.py` and forwarding in `bridge.py`.
