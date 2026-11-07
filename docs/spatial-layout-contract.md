# Spatial and layout contract proposal

Proposed version 0.1 for Faisal, Doni, and Wira. The rendered coordinate frame and placement fields are implemented. The JSON envelope and operational bindings below are proposed for agreement before the algorithm consumes them.

## Coordinate frame

- Anchor at longitude 106.80255°, latitude −6.21858° in WGS84.
- Local positions are `[x, y, z]` in metres. X increases east, Y increases up, Z increases south. North is negative Z. Ground starts at Y = 0, independent of sea level.
- The current extraction uses `x = R cos(lat0) (lon − lon0)` and `z = −R (lat − lat0)`, with angles in radians and R = 6378137 m. This is a local approximation. The file's decimal precision describes serialization.
- Placement yaw uses degrees around positive Y. For a local offset `[dx, dy, dz]`, the rotated X offset is `cos(yaw) dx + sin(yaw) dz` and the rotated Z offset is `−sin(yaw) dx + cos(yaw) dz`. Add the placement position afterward.
- Decorative ground layering and estimated structure heights belong to rendering. Operational coordinates keep the stated local-ground reference.

## Fixed venue and editable layout

Keep the public venue pack separate from each event's layout revision. The venue pack contains source geometry and label anchors. Navigation is an authored graph over that frame. Public map paths remain visual context until reviewed and connected as navigation.

An editable placement references a versioned kit preset. Its physical dimensions come from that preset and its discrete parameters, such as Roder bay count. Moving or rotating a tent updates its attached checkpoints. The layout retains stable IDs across revisions.

Proposed serialized envelope:

```json
{
  "schema_version": "opsidio-layout/0.1",
  "venue_id": "gbk-osm-local",
  "venue_revision": "<SHA-256 of the pinned venue pack>",
  "catalogue_version": "research-v1",
  "layout_id": "plaza-utara-demo",
  "revision": 1,
  "coordinate_frame": {
    "units": "m",
    "origin_wgs84": { "longitude_deg": 106.80255, "latitude_deg": -6.21858 },
    "axes": { "x": "east", "y": "up", "z": "south" },
    "vertical_reference": "local_ground"
  },
  "placements": [
    {
      "id": "scan_tent",
      "preset_id": "roder-10",
      "position_m": [12, 0, -275],
      "yaw_deg": 0,
      "parameters": { "bays": 2 },
      "basis": "fictional_scenario"
    }
  ],
  "navigation": {
    "nodes": [
      {
        "id": "arrival_north",
        "role": "arrival",
        "position_m": [12, 0, -317]
      },
      {
        "id": "scan_checkpoint",
        "role": "checkpoint",
        "attachment": { "placement_id": "scan_tent", "offset_m": [0, 0, 0] }
      }
    ],
    "edges": [
      {
        "id": "arrival_to_scan",
        "from_node_id": "arrival_north",
        "to_node_id": "scan_checkpoint",
        "directed": true
      }
    ]
  },
  "operational_bindings": [
    {
      "placement_id": "scan_tent",
      "node_id": "scan_checkpoint",
      "point_id": "north_scan",
      "lane_group": "general",
      "queue_zone_id": "north_scan_queue"
    }
  ]
}
```

This small example illustrates two nodes and one edge. The demo graph also includes queue waypoints, security, a destination, and the help-desk branch. The `north_scan` operational IDs are proposals to match against the GBK algorithm plan.

Each node has either a fixed position or a placement attachment. Resolve attachments before calculating paths. Recompute edge lengths from resolved endpoints and route waypoints for every revision. Include those lengths in the compiled output.

## Interface to Doni

Compile a reviewed layout into the existing v0.1 plan. A binding maps an operational point to the same gate or service-point ID, lane group, and queue-zone ID in that plan. Each logical walking link receives the sum of its directed route-leg lengths in `venue.layout.walking_paths[].distance_m`. Flag missing bindings or disconnected required links.

The lane count also needs a valid placement, equipment allocation, and staff assignment. The layout determines geometric fit. Doni's plan defines the processing steps, equipment and staffing requirements, opening times, and service behavior. Scenario arrival curves remain in `demand`. [Current algorithm schema](../api/algorithm/openapi.yaml)

Return run results with the compiled plan snapshot hash and the layout revision. Baseline and candidate comparisons use the same units, metric definitions, and DES settings. Operational results are shown against the matching revision.

## Interface to Wira

`GbkCanvas` takes `VenuePack`, the equipment catalogue, placements, camera flags, optional route guides, and selection/move callbacks. The standalone page currently wraps that renderer with small camera controls. Wira can compose the renderer under the dashboard's own overlay.

The current renderer placement fields are `presetId`, `position`, `yawDeg`, and optional `bays`. The envelope above uses explicit wire-unit names. The boundary adapter maps these once. Keep overlay screen pixels separate from local metre coordinates.

## Agreement and checks

Faisal and Doni need to agree on the proposed operational bindings, the venue/catalogue revision identity, and the compiled walking-link mapping. Wira needs the renderer props and one fixture.

Before acceptance, check origin and east/north direction, rotation of an attached offset, move-driven path updates, a disconnected checkpoint, an unknown kit preset, and a saved result that belongs to an older layout revision. The venue's source geometry is pinned and the event placements carry their own provenance.
