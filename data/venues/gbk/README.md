# GBK mapped context for a local demo

This is a fresh extraction from public OpenStreetMap data. It does not reuse the rehearsal viewer, its code, or its assets. The resulting JSON follows `VenuePack` in `web/src/simulation/types.ts`.

## Sources and license

- Stadium: [OSM way 682984153](https://www.openstreetmap.org/way/682984153), tagged **Stadion Utama Gelora Bung Karno**, version 5, edited 2026-06-01.
- Stadium geometry: <https://api.openstreetmap.org/api/0.6/way/682984153/full.json>.
- Nearby public map extract: <https://api.openstreetmap.org/api/0.6/map.json?bbox=106.797,-6.224,106.808,-6.2125>.
- Map data **© OpenStreetMap contributors**, available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). [Attribution information](https://www.openstreetmap.org/copyright).

Keep visible OSM attribution and the license link with the map. The pinned source and derived geometry are an adapted OSM database under ODbL; this statement covers the data, not the application code. OpenStreetMap contributors do not endorse this demo.

`osm-source.json` is a small, sanitized selection from the API responses. It retains the geometry, relevant tags, source versions and edit timestamps. It excludes contributor account identifiers, contact information, unrelated POIs and relations. `provenance.json` records retrieval time, source hash, each rendered feature's OSM link, height assumptions and geometry treatment.

## Coordinates and bounds

- Origin: longitude **106.80255**, latitude **−6.21858**, in WGS84.
- Local coordinates: **X east, Y up, Z south**, in metres. All mapped ground points have Y = 0.
- Projection: `x = R × cos(lat0) × (lon − lon0)` and `z = R × (lat0 − lat)`, with angles in radians and R = 6,378,137 m. This is a local equirectangular approximation, not a survey coordinate system.
- Values are rounded to 0.01 m for a stable file. That precision does **not** imply centimetre accuracy.
- Context display bounds: X −480…480 m, Z −550…450 m. Road and path segments are clipped to this rectangle; only complete contained area rings are retained. No connecting segments are invented across clipped gaps.
- Stadium outline bounds: X −127.55…140.26 m, Z −161.36…160.87 m, with 124 points including the repeated closing point.

## Fictional work envelope

`editBounds = { minX: -55, maxX: 55, minZ: -325, maxZ: -175 }` is an **illustrative north-side work envelope**, not a mapped event boundary, confirmed usable area, operational plan or permission to place equipment.

It sits outside the mapped stadium footprint. [Pedestrian way 28212629](https://www.openstreetmap.org/way/28212629) runs around X 12 m between Z −328 and −174 m. [Pedestrian area 555817845](https://www.openstreetmap.org/way/555817845) is much narrower, around X 5…19 m and Z −321…−200 m. The demo rectangle deliberately extends beyond that mapped pedestrian area and may include landscaped ground. No included building footprint intersects its bounding rectangle. These observations do not establish access, ground condition, levelness, capacity, clearance or event suitability.

The editable area is separate from the public map data. Its routes, equipment and any crowd results must be labeled as demo assumptions by the application.

## Geometry and assumptions

- The stadium outline and feature coordinates come from OSM. No gates, paths or footprints were traced from another map or invented to fill gaps.
- Nearby context is intentionally incomplete: minor unnamed service spurs, parking aisles, most buildings, relations and distant objects are omitted. Path geometry is a visual reference, not a connected or validated navigation graph.
- The stadium's mapped leisure outline is not a detailed architectural model. It supplies no roof, bowl, seating or height geometry. Any such rendering is illustrative.
- Ten selected nearby building footprints are rendered with `heightM`. A numeric OSM `height` tag would be used when present; otherwise mapped levels × 3 m or an 8 m default is used. **Every current height is an estimate**, listed individually in `provenance.json`; none is a measured height.
- `green`, `plaza` and path categories are simplified visual classes. In particular, non-grass pitches use `plaza`, and shared paths use `walk`; this does not grant pedestrian access. Rendering widths, colors, materials, heights and all Y elevations are illustrative.
- Named-area labels use the mean of polygon vertices. They are label anchors, not entrance locations. Gate labels use mapped OSM nodes. Some mapped gates have restricted or closed access tags; the app must not present them as available entrances.
- Existing OSM polygons can be approximate, incomplete or stale. Buildings were selected explicitly to avoid known overlapping alternative outlines in this extract. This pack is for local visual prototyping.

## Rebuild

From the repository root, using Python 3:

```sh
python3 tools/venue-gbk.py
```

This rebuilds `web/src/simulation/venue/gbk.json` and `data/venues/gbk/provenance.json` offline from the pinned source. The output is deterministic. To fetch current public data and replace the pinned snapshot:

```sh
python3 tools/venue-gbk.py --refresh
```

Refresh performs two bounded, read-only API requests with 30-second timeouts. It requires network access and may produce changed geometry as OSM changes. The first attempted Overpass service was unavailable; the pinned extract instead uses the OSM map API listed above. No API key or private data is used.

The generator checks closed rings, finite coordinates, flat-ground Y values, and clipped path bounds before writing. Schema and application integration checks belong to the application test suite.
