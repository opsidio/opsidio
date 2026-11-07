# Opsidio venue foundation

A fresh browser 3D foundation for Stadion Utama Gelora Bung Karno, using pinned OpenStreetMap data and locally bundled geometry. The standalone scene includes 360 rotation/pause, pan, isometric, entry, and map cameras. It is ready for layout and waypoint overlays.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 5173
```

Open [the scene](http://127.0.0.1:5173/simulation). Use `?view=map&entries=1` for the proposed category-entry map. Add `?debug=1` to view renderer measurements and the provisional route guides.

Open **Layout editor** to edit equipment, attached checkpoints and directed waypoints, with revisioned browser persistence and JSON import/export. **ABM preview** generates seeded arrivals and walking playback for the authored North-entry route, covering the proposed 15,500 CAT 5–8 attendees. The other four entry-area graphs still require authoring.

**DES engine** imports a full Doni-format plan and calls the local Python bridge. Start it in a second terminal with `python3.11 -m api.simulation`. Configure `OPSIDIO_API_URL` and `OPSIDIO_API_KEY` in its server environment. The bridge reports missing configuration until those values are available. See [DES setup and limitations](docs/des-bridge.md).

```sh
npm run build --prefix web
node --test web/src/simulation/route.test.mjs tests/scenarios/coldplay.test.mjs web/src/simulation/layout/core.test.mjs
node --experimental-strip-types --test web/src/simulation/abm/abm.test.mjs
python3.11 -m unittest discover -s api/tests -p 'test_*.py' -v
```

## Handoffs

- [Coldplay-inspired admission scenario](docs/coldplay-admission-scenario.md)
- [Doni-format planning draft](contracts/examples/coldplay-gbk-plan-draft.json)
- [Parallel integration checkpoint](docs/simulation-integration-checkpoint.md)
- [ABM preview integration](docs/abm-preview.md)
- [Spatial and layout contract proposal](docs/spatial-layout-contract.md)
- [Simulation handoff](docs/simulation-handoff.md)
- [GBK demo plan and equipment references](docs/gbk-demo-implementation.md)
- [Venue source and reproduction notes](data/venues/gbk/README.md)

Wira can mount `web/src/scene/GbkCanvas.tsx` underneath the UI overlay. The scene props live in `web/src/simulation/types.ts`. The standalone bootstrap is separate from the renderer.

The footprint and surrounding map features are sourced. Building heights, stadium architecture, and the temporary event layout are illustrative. The planning draft passes the repository's OpenAPI `PlanDocument` schema and preserves 70,000 fictional expected attendees. Its `meta.unresolved` lists missing operational inputs, and `simulation_ready` remains false. Completing those inputs and connecting Doni's live service are required for GBK processing results. Editor revisions and ABM arrivals still require projection into the algorithm plan.
