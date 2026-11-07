# Opsidio venue foundation

A fresh browser 3D foundation for Stadion Utama Gelora Bung Karno, using pinned OpenStreetMap data and locally bundled geometry. The standalone scene includes 360 rotation/pause, pan, isometric, entry, and map cameras. It is ready for layout and waypoint overlays.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 5173
```

Open [the scene](http://127.0.0.1:5173/simulation). Use `?view=map` for the transport and entry-area overview. Add `?debug=1` for renderer measurements. Use **Routes** to toggle the path guides.

Select **Run V1 locally** to generate 70,000 fictional arrivals from `contracts/examples/coldplay-gbk-demo-plan.json`. People walk from MRT Istora Mandiri Exit B, Parkir Timur or a proposed passenger drop-off to their assigned category entrance. **Focus North layout** shows the queue barriers, scan operators, security officers and help agent. The area buttons focus the other entry areas. **Layout editor** edits the North equipment, attached checkpoints and directed waypoints with revisioned persistence and JSON import/export.

V1 is authored and played locally. **Optimize via Doni** submits the current plan snapshot for server validation and optimization. Start the local bridge with `python3.11 -m api.simulation` and configure `OPSIDIO_API_URL` and `OPSIDIO_API_KEY` in its server environment. The panel reports configuration, polls the remote job and offers returned candidates for V2. See [API setup and limitations](docs/des-bridge.md).

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

The footprint and surrounding map features are sourced. Building heights, stadium architecture, and the temporary event layout are illustrative. The earlier draft retains unresolved inputs. V1 adds fictional sales/no-show, staffing, service-time and cost assumptions. Its five four-lane layouts follow mapped pedestrian and stadium-ring corridors, with 45 operators and 75 barrier panels. The local worker models FIFO scan/security queues and one visitor per operator using fixed typical process times. The front 32 people per queue are rendered, with the full queue count reported. See [arrival routing and site-review limits](data/venues/gbk/README.md#arrival-routing). Doni’s API performs optimization and DES verification. Help-desk exception arrivals and reviewed internal sector routes remain pending. Remote semantic validation remains pending.

Rebuild the complete example with `node --experimental-strip-types tools/build-coldplay-demo.mjs`. The editor projects North coordinates, attachments and route distances into the same JSON snapshot used for export and optimization. A returned candidate whose staffing lacks matching spatial positions is rejected with a binding error for repair.
