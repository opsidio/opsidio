# Operations display layer

Mount `OperationsLayer` inside `GbkCanvas` children, alongside the crowd preview. It does not change cameras, plans, shared types or app state.

```tsx
<OperationsLayer
  operators={resolved.operators}
  placements={resolved.layout.placements}
  catalogue={catalogue}
  entryAreas={entryAreaMarkers}
  showLabels={showLabels}
/>
```

`OperationsOperator` is structurally compatible with the adapter: `id`, `label`, `roleId`, `pointId`, `entryAreaId`, resolved world `position`, and optional `roleName`, `yawDeg`, `attachment: { placementId, offset }`. Positions come from the same JSON as the processing layout. The layer adds no operators and does not move them.

Staff are stationary 1.7 m figures with shoes at local Y = 0. Four shared instanced meshes draw all staff: uniform, skin, vest and reflective strips. Blue denotes ticket scanning, red security, green help, purple other roles. Default roof/wall occlusion is preserved. `staffThroughCanopies` defaults to **false**; enabling it is an explicit overlay aid, not a changed physical position.

`labelMode` accepts `auto` (default), `overview`, or `detail`. Auto uses projected metres per pixel, not a fixed camera name. Overview callouts use supplied entry-area anchors and exact operator counts per `entryAreaId`. Detail callouts use actual canopy positions, catalogue dimensions and placement yaw, showing Ticket scan, Security and Help names with assigned operator counts. A direct tent attachment is preferred; staff attached to equipment are associated with the nearest same-role canopy within 25 m. This affects labels only. Barrier counts use the nearest supplied entry-area anchor.

`showLayoutOverlay` defaults to true. One batched screen-width line makes rowing rails readable; canopy footprint guides appear at close zoom. Barrier mesh metal is darkened for contrast without changing dimensions. Labels ignore pointer events and use `zIndexRange={[20,0]}`. `areaLabelOffsetPx` can move an overview badge below the host's existing entry-area label; alternatively show only one set. Close labels remain compact and do not scale into large markers.

This layer depicts staff assignments and equipment from a local baseline; it does not represent processing results or optimization. Root integration should visually check the authored staff offsets and inspect the North entry from an oblique camera, since roof occlusion can hide figures in a directly overhead view.
