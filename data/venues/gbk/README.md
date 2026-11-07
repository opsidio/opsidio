# GBK mapped context for a local demo

This is a fresh extraction from public OpenStreetMap data. It does not reuse the rehearsal viewer, its code, or its assets. The required JSON fields follow `VenuePack` in `web/src/simulation/types.ts`; optional landscape metadata is described below.

## Sources and license

- Stadium: [OSM way 682984153](https://www.openstreetmap.org/way/682984153), **Stadion Utama Gelora Bung Karno**, version 5, edited 2026-06-01.
- Stadium geometry endpoint: <https://api.openstreetmap.org/api/0.6/way/682984153/full.json>.
- Public map extract used for this snapshot: <https://api.openstreetmap.org/api/0.6/map.json?bbox=106.7938,-6.2273,106.8113,-6.2099>.
- Map data **© OpenStreetMap contributors**, available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). [Attribution information](https://www.openstreetmap.org/copyright).

Keep visible OSM attribution and the license link with the map. The pinned source and derived geometry are an adapted OSM database under ODbL; this statement covers the data, not the application code. OpenStreetMap contributors do not endorse this demo.

`osm-source.json` is a sanitized selection from the map API response. It retains geometry, relevant tags, source versions and edit timestamps, while excluding contributor account identifiers, contact information, unrelated POIs and relations. `provenance.json` records retrieval time, source hash, each feature's OSM link, omissions, height assumptions and rendering treatment.

## Coordinates and extent

- Fixed origin: longitude **106.80255**, latitude **−6.21858**, in WGS84.
- Local coordinates: **X east, Y up, Z south**, in metres. All mapped ground points have **Y = 0**. The landscape's ground surfaces and building bases also render at Y = 0, so placements and waypoints need no display-height correction.
- Projection: `x = R × cos(lat0) × (lon − lon0)` and `z = R × (lat0 − lat)`, with angles in radians and R = 6,378,137 m. This is a local equirectangular approximation, not a survey coordinate system.
- Values are rounded to 0.01 m for stable files. That precision does **not** imply centimetre accuracy.
- Context: a **900 m radius** around the origin, supplying surroundings for a study area of about 800 m radius. Whole contained area rings are retained; paths are clipped to the circle and outside the main stadium. No connecting segments are invented across clipped gaps.
- Stadium outline bounds remain X −127.55…140.26 m, Z −161.36…160.87 m, with 124 points including the repeated closing point.
- Current pack: **376 building footprints, 119 other areas, 1,054 road/path pieces and 91 landmark anchors**. These are a source snapshot, not a completeness claim.

The main nearby venues include Indonesia Arena, Tennis Indoor, Istora, Stadion Madya, the JCC complex, GBK Arena and Senayan Park, along with mapped courts, fields, pools, woodland, parking areas and surrounding streets. The map also includes numerous smaller source-mapped buildings; none is positioned arbitrarily.

## Fictional work envelope

`editBounds = { minX: -55, maxX: 55, minZ: -325, maxZ: -175 }` remains an **illustrative north-side work envelope**, not a mapped event boundary, confirmed usable area, operational plan or permission to place equipment.

It sits outside the mapped stadium footprint. [Pedestrian way 28212629](https://www.openstreetmap.org/way/28212629) runs around X 12 m between Z −328 and −174 m. [Pedestrian area 555817845](https://www.openstreetmap.org/way/555817845) is much narrower, around X 5…19 m and Z −321…−200 m. The demo rectangle deliberately extends beyond that mapped pedestrian area and may include landscaped ground. No included building footprint intersects its bounding rectangle. These observations do not establish access, ground condition, levelness, capacity, clearance or event suitability.

The editable area is separate from public map data. Its routes, equipment and any crowd results must be labeled as demo assumptions by the application.

## Geometry and rendering assumptions

- Footprint vertices and path coordinates come from OSM. No gates, paths or buildings were traced from another map or invented to fill gaps.
- The context omits relations, incomplete/out-of-scope rings, and tunnels. It flattens source bridge and layer information; this is **not a connected or validated navigation graph**, terrain model or representation of multi-level access.
- The main stadium's leisure outline supplies no roof, bowl, seating or height geometry. Its separate model is illustrative. The mapped pitch inside that outline is omitted from the landscape to prevent overlapping stadium surfaces.
- Alternative footprints inside Indonesia Arena and Istora are omitted. JCC Hall A/B outlines nested within the larger JCC footprint are simplified to the outer complex footprint. The generator records these omissions; it does not assert that the smaller structures do not exist.
- A numeric OSM `height` tag is used when present, without independent survey verification. Otherwise, building levels × 3 m is used; sports halls use levels × 5 m with a 14 m minimum; unsized buildings use 8 m and roof-only masses use 4 m. **Those estimates are illustrative**, individually recorded in provenance.
- Optional area fields `landscapeUse`, `label` and `sport` preserve simplified source semantics for rendering. Optional path fields `widthM`, `highway` and `label` support world-metre ribbons. `contextRadiusM` records the visual scope. Existing required `VenuePack` fields and the coordinate basis remain unchanged.
- All road/path widths are **illustrative class-based values**. They must not be used as measured clearance, capacity, accessibility or permission to enter. Shared/closed/private paths can still appear as contextual geometry.
- Tree positions, count, dimensions, species and crown shapes are **illustrative**. A seeded sampler plants only inside mapped woodland, park and lawn polygons, with exclusion clearances around buildings, water, sports fields, mapped path ribbons and the demo work envelope. The same input produces the same trees. No trees are treated as surveyed obstacles.
- Palette, periwinkle landmark massing, roof-edge bands, pitch borders, graphic ground shadows and the circular presentation disk are styling. They are not architectural measurements or extra source features.
- `LandscapeContext.tsx` merges geometry and instances trees. Ground polygons and roads stay at Y = 0 and draw in a stable order before 3D objects, with depth testing and depth writes disabled for those colour layers. The base terrain retains its normal depth. This prevents the road from covering tent legs and people at tilted camera angles. Graphic shadows use a small constant depth bias. Ground layers do not receive shadow maps. Roof borders sit 0.06 m above the illustrative roof.
- Named-area labels use mean polygon vertices. These are label anchors, not entrances. Gate labels use OSM nodes; some gates have restricted or closed access tags and must not be presented as available entrances.

OSM polygons can be approximate, incomplete or stale. This pack is a coordinate foundation for local visual prototyping; actual placement, access and routes still need event-specific verification.

## Arrival routing

MRT Istora Mandiri Exit B and the mapped parking entrance are shared network nodes. The demo uses the latter as a proposed taxi and ride-hailing drop-off. Parkir Timur uses the centre of its mapped parking polygon and an **82.6 m proposed walking connector** to the public network. [Pinned arrival origin sources](arrival-origins.json)

The baseline routes pedestrians from all three origins to all five forecourts. Mapped public legs use shared OSM nodes and avoid the admission corridors. Each approach joins its forecourt upstream of the help desk and queue. The new corridors separate CAT 4 arrivals from Plaza Tenggara admission traffic and remove the previous Festival barrier overlap.

The three marked layouts use the following centerlines. North and West retain their previous centerlines. The widths are proposed operating envelopes for the demo. The mapped path widths shown in the scene are class-based render values. Paving, clearances, access and equipment placement require site review.

| Entrance | Mapped centerline and direction | Proposed width | Staffed lanes | Spine length |
| --- | --- | ---: | ---: | ---: |
| Plaza Tenggara | Jalan Plaza Selatan northwest from the Istora side, OSM 403720975 | 15 m | 8 | 143 m |
| Plaza Barat | West pedestrian approach, OSM 555901298 | 7.5 m | 4 | 141 m |
| Pintu Kuning | Marked northwest boulevard toward the stadium, OSM 403721028 | 10 m | 5 | 99 m |
| Plaza Utara | North pedestrian approach, OSM 28212629 | 9 m | 5 | 141 m |
| Plaza Timur · Festival | Jalan Plaza Timur west toward the stadium, OSM 555901293 | 15 m | 8 | 182 m |

Pintu Kuning uses one **13.84 m event access connector** from public OSM node 4060512460 along mapped private ways 403721006 and 403721028. That one-way approach is reserved for Pintu Kuning and requires event permission. The public network excludes these private ways.

After ticket scan, visitors continue from the end of their admission spine to a handover just inside the mapped stadium footprint, under the illustrated roof edge. The five links are proposals for site review. Their endpoints mark the modeled threshold, with onward seating and standing routes still to be mapped.

`proposed_anchor_m` retains the sketch reference for the three moved gates. `operational_anchor_m` marks the simulated security location. The geometry tests check all 30 one-way lanes, their queue pens and service equipment, and the 15 origin-to-forecourt routes against the pinned map.

| Origin | Approach walk to entrance forecourt |
| --- | ---: |
| MRT Istora Mandiri Exit B | 658–2,576 m |
| Parkir Timur | 363–1,911 m |
| Proposed passenger drop-off | 724–2,641 m |

The approach walk ends at the forecourt. Admission adds the route along the entrance’s spine and the link to the stadium handover. In the API snapshot, `demand.time_reference: origin_spawn` means arrivals are released at the selected origin. Apply the matching distance in `venue.layout.walking_paths` once. Local playback assigns origin shares to the 76 category × behavior rows and preserves all 70,000 visitors.

## Rebuild and checks

From the repository root, using Python 3.9 or later:

```sh
python3 tools/venue-gbk.py
```

This rebuilds `web/src/simulation/venue/gbk.json` and `data/venues/gbk/provenance.json` deterministically from the pinned source. To fetch current public data and replace the snapshot:

```sh
python3 tools/venue-gbk.py --refresh
```

Refresh performs one bounded, read-only map API request with a 45-second timeout. It needs network access and may produce changed geometry as OSM changes. No API key or private data is used.

The generator checks closed rings, finite coordinates, flat-ground Y values, circular bounds and the exclusion of alternative stadium footprints. The landscape pass was also checked in a standalone Chromium preview: 19 landscape draw calls, about 158,000 triangles, and 1,130 illustrative trees for this snapshot. Full application draw counts depend on the stadium, kit and overlays. The web build passes with the existing large-bundle warning.
