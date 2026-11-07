# Opsidio event planning workspace

An event organizer dashboard for entrance planning, built on the team's React 19 + TypeScript + Vite application. It includes demo login, an empty first-use homepage, editable plan forms, review, and the existing fullscreen GBK scene with layout controls, V1 worker playback and Doni API optimization / V2 comparison.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 5173
```

Open [Opsidio](http://127.0.0.1:5173). Sign in with `organizer@opsidio.demo` / `Opsidio2026!`, then create a draft or explore the supplied GBK demo. Plans save in this browser. The simulation is mounted directly at `/simulation`, with no iframe.

For **Optimize**, set `OPSIDIO_API_URL` and `OPSIDIO_API_KEY` in the server environment and start `python3 -m api.simulation` in a second terminal. V1 generation and playback work independently in the existing browser worker. The API key stays server-side.

See [dashboard setup, API handoff, verification and scope](docs/dashboard-handoff.md). The current authored 3D arrival route covers Plaza Utara; four other entry areas have markers but still need authored routes. Queue and service outcomes are returned by Doni's API.

```sh
npm run build --prefix web
node --experimental-strip-types --test web/src/dashboard/model.test.mjs web/src/simulation/route.test.mjs tests/scenarios/coldplay.test.mjs web/src/simulation/layout/core.test.mjs web/src/simulation/abm/abm.test.mjs
python3 -m unittest discover -s api/tests -p 'test_*.py'
```

## Handoffs

- [Dashboard integration](docs/dashboard-handoff.md)
- [Coldplay-inspired admission scenario](docs/coldplay-admission-scenario.md)
- [Doni-format planning draft](contracts/examples/coldplay-gbk-plan-draft.json)
- [Parallel integration checkpoint](docs/simulation-integration-checkpoint.md)
- [ABM preview integration](docs/abm-preview.md)
- [Spatial and layout contract proposal](docs/spatial-layout-contract.md)
- [Simulation handoff](docs/simulation-handoff.md)
- [GBK demo plan and equipment references](docs/gbk-demo-implementation.md)
- [Venue source and reproduction notes](data/venues/gbk/README.md)

The scene remains in `web/src/scene/GbkCanvas.tsx`; its props and engine modules are unchanged. `web/src/dashboard/SimulationPage.tsx` composes it with the controls. The footprint and surrounding map features are sourced; building heights, stadium architecture and the temporary event layout are illustrative. See the linked source and spatial-contract notes before using these demo assumptions for operational decisions.
