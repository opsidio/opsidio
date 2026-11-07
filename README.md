# Opsidio venue foundation

A fresh browser 3D foundation for Stadion Utama Gelora Bung Karno, using pinned OpenStreetMap data and locally bundled geometry. The standalone scene includes 360 rotation/pause, pan, isometric, entry, and map cameras. It is ready for layout and waypoint overlays.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 5173
```

Open [the scene](http://127.0.0.1:5173/simulation). Add `?debug=1` to view renderer measurements and the provisional route guides.

```sh
npm run build --prefix web
node --test web/src/simulation/route.test.mjs
```

## Handoffs

- [Spatial and layout contract proposal](docs/spatial-layout-contract.md)
- [Simulation handoff](docs/simulation-handoff.md)
- [GBK demo plan and equipment references](docs/gbk-demo-implementation.md)
- [Venue source and reproduction notes](data/venues/gbk/README.md)

Wira can mount `web/src/scene/GbkCanvas.tsx` underneath the UI overlay. The scene props live in `web/src/simulation/types.ts`. The standalone bootstrap is separate from the renderer.

The footprint and surrounding map features are sourced. Building heights, stadium architecture, and the temporary event layout are illustrative. The current route preview calculates geometry and nominal walking time. Operational crowd results require the algorithm integration described in the handoff.
