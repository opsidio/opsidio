# Opt-in layout editor

This module supplies a compact React overlay and controller. It does not mount itself, change the app entrypoint, or own a camera. The host keeps the full-screen viewer as its default and mounts the panel only when the user chooses Edit.

```tsx
import { LayoutEditor, useLayoutEditor } from './layout'

const editor = useLayoutEditor({ bounds: venue.editBounds, catalogue })

<GbkCanvas
  {...otherSceneProps}
  placements={editor.layout.placements}
  nodes={editMode ? editor.graph.sceneNodes : []}
  routes={editMode ? editor.graph.routes : []}
  showGuides={editMode}
  view={editMode ? 'layout' : view}
  selectedId={editMode ? editor.selectedId : null}
  onSelect={editMode ? editor.onSelect : () => {}}
  onMove={(id, position) => { if (editMode) editor.onMove(id, position) }}
/>
{editMode && <div className="host-editor-position">
  <LayoutEditor editor={editor} onClose={() => setEditMode(false)} />
</div>}
```

The host positions its wrapper, for example with `position: absolute; top: 80px; right: 16px; z-index: 20`. The panel owns its maximum height and scrolling. The component accepts `className` and optional `onClose`. No stylesheet rule targets the host canvas or page.

Equipment can be selected in the scene or selector. Ground clicks work through the existing scene `onMove` callback. Waypoints are selected in the overlay; the same ground-click callback then moves the waypoint. Numeric fields apply on Enter/blur and cancel on Escape. Object IDs stay fixed. New objects receive UUIDs. Roder depth is catalogue bay length multiplied by the bay count.

## Graph and simulation boundary

`editor.layout` is the authored `LayoutRevision`. `editor.graph` contains resolved positions, checked directed edges with `distanceM`, renderer `routes`, and labelled `sceneNodes`. It is useful for repairing partially invalid drafts. **Only `editor.runnableGraph` is suitable for starting an ABM run**; it is `null` while any validation error remains.

```tsx
const graph = editor.runnableGraph
if (graph) {
  const abmConfig = { ...demandAndTiming, nodes: graph.nodes, edges: graph.edges }
  // Send abmConfig to the worker. Record editor.layout.id and revision with results.
}
```

The default graph is explicitly authored: `arrival → queue → queue-exit → scan_checkpoint → north-walkway → security_checkpoint → entry-approach → destination`. The help branch is `scan_checkpoint → help_checkpoint → scan_checkpoint`. It does not infer navigation from map paths and never creates a fallback detour. The initial placements come from `initialDraft()` in `model.ts`.

The default scenario protects the three required links in `DEMO_REQUIRED_ROUTES`. A different scenario can pass `requiredRoutes`. Referenced placements cannot be removed until their nodes are detached or removed. Connected nodes cannot be removed until their edges are removed. Required route endpoint nodes cannot be removed. Removing a connecting edge is allowed, with an explicit invalid draft until repaired.

Node attachments are authoritative: resolve them with `localToWorld` using positive-Y Three.js yaw, `x′ = cos(yaw) x + sin(yaw) z`, `z′ = −sin(yaw) x + cos(yaw) z`. Stored node `position` is a snapshot/fallback; use resolved graph positions for rendering or ABM. Attaching/detaching preserves world position. Moving an attached node changes its local offset.

## Validation and persistence

`validateLayout`, `importLayoutJSON`, `restoreLayout`, and `persistLayout` share the same checks. They report structured `{ code, severity, path, message, relatedIds }` issues. Invalid geometry and disconnected graphs stay editable and exportable. Malformed shapes and duplicate IDs are rejected before entering the renderer; import text stays in the panel for repair. Corrupt saved JSON is offered in Save / import and is not overwritten merely by opening the editor. Browser storage failures appear as messages and do not prevent JSON export.

Serialization is **`schemaVersion: "opsidio-editor/0.1"`**, using the camelCase `LayoutRevision` fields. This is an editor snapshot, not the proposed snake_case `opsidio-layout/0.1` algorithm envelope. No operational bindings, venue revision hashes, catalogue revision identity, or compiled DES plan are fabricated. That boundary adapter remains a separate integration task.

The default storage key is `opsidio-editor:0.1:gbk-north`. Pass `storageKey: null` to disable persistence or a scenario-specific key to isolate drafts. The hook reads storage on mount. Mount a fresh controller when changing scenario or storage key. Every accepted edit, import, reset and undo produces a new revision; restoration preserves the saved revision. Undo retains the last 20 edits in memory.

## Geometry assumptions

Ground coordinates use metres, X east, Y up, Z south; this editor requires Y = 0 for operations. Bounds are the explicit scenario work area, not a claim that the mapped ground is walkable.

The obstacle check distinguishes canopy roofs from support feet. Tables and rowing barriers use their catalogue footprints, including barrier foot depth. Open tents and detector portals are traversable; their modelled supports remain obstacles. Support-foot dimensions match the illustrative renderer: pagoda bases 0.13 m square; Roder bases 0.25 × 0.22 m. Roder support positions change with bay count. Routes use an explicit assumed 0.3 m clearance around solid parts. These are configurable `assumptions`, not site installation facts. Canopy roof overlaps produce review warnings even when feet are clear; roof/rigging compatibility is not validated. Terrain, ballast, crowd clearance, egress standards and operating approval are outside this geometric preview.

## Checks

```sh
node --test web/src/simulation/layout/core.test.mjs
npm run build --prefix web
```

The focused suite covers the default graph, attachment transforms, moving checkpoints, dimensions, actual support feet, canopy overlap, barrier clearances, detector passage, unknown/duplicate/unreachable references, deletion protection, JSON recovery, persistence validation and mutation safety. The host must verify final overlay positioning and scene interaction after mounting it.

## Multi-area plan editing

For a complete plan, use `createPlanEditorLayout(source)` and pass the result plus
`planEditorOptions(source)` into `useLayoutEditor`. Use a separate storage key from
older North-only drafts. Project edits with `projectPlanEditorLayout(source, editor.layout)`.
The adapter retains operational, staffing, source and route metadata. It updates
all area equipment, authored nodes and directed edges, origin coordinates, revision,
public-approach distances and native queue-to-gate distances. New moved source
coordinates retain their reference and are labelled proposed user edits.

`LayoutEditor` accepts `onAreaChange(area)` for the host camera. The controller
exposes `activeAreaId`, `selectArea`, `visiblePlacements`, `visibleNodes` and
`visibleEdges`. Scope filtering changes the UI only; validation always checks the
whole graph, including connections between areas. `editor.layout.markers` are
visual gate anchors; moving them does **not** move flow. `placementAreas` preserves
stable equipment-to-area assignments. Both fields survive export/import and undo.

Choose an entry area, select equipment and click the ground or edit X/Z/yaw. In
**Waypoints**, select an existing arrival, checkpoint or destination to move it
while preserving demand bindings. Choose **Shared origins / drop-off** and select
`origin_dropoff`, `origin_mrt` or `origin_parking` to move its actual arrival node
and matching origin definition. New waypoints/arrival/destination nodes require
explicit one-way From → To connections and are not assigned demand automatically.
A reverse connection must be authored separately. No routing fallback is generated.
Gate-marker controls explicitly identify a visual sign rather than a flow anchor.

Bound stations, queue nodes, operators and origins cannot be removed through this
editor; operational changes belong in the plan workflow. An invalid draft must
remain visible using its authored placements and resolved graph, while the host
keeps playback disabled via `runnableGraph` and projection errors. The editing
envelope is derived from existing coordinates with a 120 m margin; it is not a
survey, walkability claim or a new site location.

The pinned mapped demo explicitly flags one East public-approach overlap
(`approach_417744527_417744522`) with the three `plaza_timur_row_2_*` barriers.
Only this source-listed overlap, with its exact review basis and unchanged source
endpoints/equipment geometry, is retained as a visible warning. Moving the edge or
any of those barriers, changing its preset/bays, or adding another blocker restores
the normal blocking error. No other collision receives this exception.
