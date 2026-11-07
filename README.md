# Opsidio venue foundation

A fresh browser 3D foundation for Stadion Utama Gelora Bung Karno, using pinned OpenStreetMap data and locally bundled geometry. The standalone scene includes 360 rotation/pause, pan, isometric, entry, and map cameras. It is ready for layout and waypoint overlays.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 5173
```

Open [Opsidio](http://127.0.0.1:5173) for the dashboard. Its event simulation remains at `/simulation?event=:id`. See the [dashboard handoff](docs/dashboard-handoff.md) for demo setup.

Open the [standalone simulation workspace](http://127.0.0.1:5173/simulation/workspace). Use `?view=map` for the transport and entry-area overview. Add `?debug=1` for renderer measurements. Use **Routes** to toggle the path guides.

Open **Control Panel** and select **Run simulation** to generate 70,000 fictional arrivals from `contracts/examples/coldplay-gbk-demo-plan.json`. People walk from MRT Istora Mandiri Exit B, Parkir Timur or a proposed passenger drop-off to their assigned category entrance. The **Entry area** selector focuses any of the five admission areas. **Editor → Layout** edits equipment and directed waypoints for all five gates and the shared transport origins. Pick an area, then use **Equipment** or **Waypoints** to move items on the map or enter coordinates. Move the arrival, checkpoint, and destination nodes to change the route. The separate gate marker only moves the label.

**Editor → Staffing & hours** sets staffed lanes and gate hours. Each active lane uses one security officer and one scan operator. Select the staffed lanes from the authored layout, then use **Run simulation**. Use **Report → Export plan JSON** for the current plan and operating inputs.

Camera presets are at the top of the map, pan and rotation are on the left, and layer toggles are near the bottom. In **Control Panel → Waypoint trace**, choose a waypoint and select **Focus waypoint**. Run the simulation to see the full run’s MRT, parking and drop-off routes and counts for that point. Choose one origin to isolate its route.

Use **Version** to choose the saved snapshot for playback. **Editor** opens that version’s draft; use **Save as new version** to keep the edits as a separate snapshot. **Include draft edits** previews local edits without overwriting a saved plan. Saved versions and copied editor links resolve in the same browser. Export a plan JSON to share it.

After running the simulation, choose **First person** to follow a visible attendee. The panel shows their origin, current location and queue wait. Use **Next person** to pick another attendee.

Playback starts at **1× real time**. Choose **10×**, **60×** or **180×** under **Playback speed** to review arrivals faster. Drag the time slider to pause and jump to a specific time. The WIB clock displays hours, minutes and seconds.

V1 is authored and played locally. In the standalone workspace, **Optimize → Compare lanes with Doni** runs a V3 corridor pilot for one entrance. An improving candidate can be applied to the authored layout and saved as another local plan version. See [V3 setup and iteration](docs/corridor-optimization.md).

```sh
npm run build --prefix web
node --test web/src/simulation/route.test.mjs tests/scenarios/coldplay.test.mjs web/src/simulation/layout/core.test.mjs
node --experimental-strip-types --test web/src/simulation/abm/abm.test.mjs
node --experimental-strip-types --test web/src/simulation/abm/queue-visuals.test.mjs
node --experimental-strip-types --test web/src/simulation/plan/compile.test.mjs
node --experimental-strip-types --test tests/scenarios/mapped-arrivals.test.mjs
python3.11 -m unittest discover -s api/tests -p 'test_*.py' -v
```

## Handoffs

- [Dashboard integration](docs/dashboard-handoff.md)
- [Doni V3 corridor comparison](docs/corridor-optimization.md)
- [Coldplay-inspired admission scenario](docs/coldplay-admission-scenario.md)
- [Doni-format planning draft](contracts/examples/coldplay-gbk-plan-draft.json)
- [Complete local V1 demo plan](contracts/examples/coldplay-gbk-demo-plan.json)
- [Parallel integration checkpoint](docs/simulation-integration-checkpoint.md)
- [ABM preview integration](docs/abm-preview.md)
- [Category and behavior cohort handoff](docs/abm-cohort-handoff.md)
- [Queue and waiting-time visuals](docs/queue-visuals.md)
- [Spatial and layout contract proposal](docs/spatial-layout-contract.md)
- [Simulation handoff](docs/simulation-handoff.md)
- [GBK demo plan and equipment references](docs/gbk-demo-implementation.md)
- [Venue source and reproduction notes](data/venues/gbk/README.md)

Wira can mount `web/src/scene/GbkCanvas.tsx` underneath the UI overlay. The scene props live in `web/src/simulation/types.ts`. The standalone bootstrap is separate from the renderer.

The footprint and surrounding map features are sourced. Building heights, stadium architecture, and the temporary event layout are illustrative. The earlier draft retains unresolved inputs. V1 adds fictional sales/no-show, staffing, service-time and cost assumptions. Revision 8 uses 30 staffed lanes: Plaza Tenggara 8, Plaza Barat 4, Pintu Kuning 5, Plaza Utara 5, and Plaza Timur 8. Its five entry layouts have 65 staff and 105 barrier panels. The seeded preview admits 41,654 of 70,000 by 21:00 WIB. The map and staffing still leave an admission shortfall at closing. The local worker models FIFO scan/security queues and one visitor per operator using fixed typical process times. Everyone passes the help desk; only groups with a ticket issue stop (a fictional 1% profile setting). The directed route continues through a fenced security queue, security, ticket scan and wristband, then into a terminal destination. The model permits one admission per visitor. Visible security queues use the authored lane bounds. Counts include everyone waiting, including those waiting off-scene. See [arrival routing and site-review limits](data/venues/gbk/README.md#arrival-routing). Doni’s API performs optimization and DES verification. Reviewed internal sector routes remain pending. Remote semantic validation remains pending.

Rebuild the complete example with `node --experimental-strip-types tools/build-coldplay-demo.mjs`. The editor projects coordinates, attachments, route distances, and gate operations into the same JSON snapshot used for export and optimization. A returned candidate whose staffing lacks matching spatial positions is rejected with a binding error for repair.

For dashboard integration, use `web/src/simulation/ui/SimulationChrome.tsx` for the toolbar and drawer shell, `SimulationControls.tsx` and `SimulationReport.tsx` for the controlled panels, and the existing `LayoutEditor` and `OptimizationPanel`. Wrap panels in `simulation-theme` to inherit the shared palette, or supply Wira’s own `--sim-*` tokens. `/simulation/workspace?view=map&canvas=1` shows the scene without the standalone toolbar and drawers.
