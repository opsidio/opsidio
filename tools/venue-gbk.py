#!/usr/bin/env python3
"""Build the GBK VenuePack from a pinned, attributed public OSM extract.

Offline: python3 tools/venue-gbk.py
Refresh: python3 tools/venue-gbk.py --refresh
Only the Python standard library is required. See data/venues/gbk/README.md.
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import re
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/venues/gbk"
OUTPUT = ROOT / "web/src/simulation/venue/gbk.json"
ORIGIN = {"lon": 106.80255, "lat": -6.21858}
CONTEXT_RADIUS = 900
MAP_BOUNDS = {"minX": -900, "maxX": 900, "minZ": -900, "maxZ": 900}
EDIT_BOUNDS = {"minX": -55, "maxX": 55, "minZ": -325, "maxZ": -175}
STADIUM_ID = 682984153
STADIUM_URL = f"https://api.openstreetmap.org/api/0.6/way/{STADIUM_ID}/full.json"
CONTEXT_URL = "https://api.openstreetmap.org/api/0.6/map.json?bbox=106.7938,-6.2273,106.8113,-6.2099"
COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
LANDMARK_NODES = {7044588762, 7047415793, 7048980920, 7059433344, 7059770842}
# These are alternative, overlapping outlines inside the named arena footprints.
# Keep Indonesia Arena 29203124 and Istora 403720892 instead.
ALTERNATIVE_BUILDINGS = {754516403, 1471818359}
KEEP_TAGS = {
    "name", "name:en", "highway", "service", "area", "access", "foot",
    "bicycle", "motor_vehicle", "building", "building:part", "building:levels", "height",
    "leisure", "landuse", "natural", "surface", "sport", "barrier", "covered",
    "entrance", "ref", "source", "amenity", "parking", "bridge", "tunnel", "layer",
}
HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link",
            "primary_link", "secondary_link", "tertiary_link", "unclassified", "residential",
            "service", "footway", "pedestrian", "path", "cycleway", "steps"}
WALK_HIGHWAYS = {"footway", "pedestrian", "path", "cycleway", "steps"}


def local(node):
    factor = math.pi / 180 * 6378137
    return [round((node["lon"] - ORIGIN["lon"]) * factor * math.cos(math.radians(ORIGIN["lat"])), 2),
            0, round((ORIGIN["lat"] - node["lat"]) * factor, 2)]


def within(point):
    return math.hypot(point[0], point[2]) <= CONTEXT_RADIUS + 0.02


def inside(point, ring):
    """Even/odd point-in-ring in the local X/Z plane."""
    x, _, z = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[2] > z) != (b[2] > z) and x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]:
            result = not result
    return result


def polygon_area(points):
    return abs(sum(a[0] * b[2] - b[0] * a[2] for a, b in zip(points, points[1:]))) / 2


def anchor(points):
    ring = points[:-1] if points[0] == points[-1] else points
    return [round(sum(p[0] for p in ring) / len(ring), 2), 0,
            round(sum(p[2] for p in ring) / len(ring), 2)]


def clip_segment(a, b, excluded_ring=None):
    """Clip an original segment to the context circle, then omit stadium interior.

    No new connections across clipped gaps are created. Intersections are rounded
    only after clipping. Display clipping does not alter the pinned source nodes.
    """
    dx, dz = b[0] - a[0], b[2] - a[2]
    aa = dx * dx + dz * dz
    if aa == 0:
        return []
    bb = 2 * (a[0] * dx + a[2] * dz)
    cc = a[0] * a[0] + a[2] * a[2] - CONTEXT_RADIUS * CONTEXT_RADIUS
    discriminant = bb * bb - 4 * aa * cc
    if discriminant < 0:
        return []
    root = math.sqrt(discriminant)
    lo, hi = max(0, (-bb - root) / (2 * aa)), min(1, (-bb + root) / (2 * aa))
    if hi <= lo:
        return []
    stops = [lo, hi]
    if excluded_ring:
        for c, d in zip(excluded_ring, excluded_ring[1:]):
            ex, ez = d[0] - c[0], d[2] - c[2]
            det = dx * ez - dz * ex
            if abs(det) < 1e-9:
                continue
            cx, cz = c[0] - a[0], c[2] - a[2]
            t, u = (cx * ez - cz * ex) / det, (cx * dz - cz * dx) / det
            if lo < t < hi and 0 <= u <= 1:
                stops.append(t)
    result = []
    stops = sorted(set(stops))
    for start, end in zip(stops, stops[1:]):
        mid = (start + end) / 2
        if excluded_ring and inside([a[0] + mid * dx, 0, a[2] + mid * dz], excluded_ring):
            continue
        result.append([[round(a[0] + t * dx, 2), 0, round(a[2] + t * dz, 2)] for t in (start, end)])
    return result


def clip_path(points, excluded_ring=None):
    parts, current = [], []
    for a, b in zip(points, points[1:]):
        segments = clip_segment(a, b, excluded_ring)
        if not segments and current:
            parts.append(current)
            current = []
        for segment in segments:
            if segment[0] == segment[1]:
                continue
            if current and current[-1] != segment[0]:
                parts.append(current)
                current = []
            if not current:
                current = [segment[0]]
            current.append(segment[1])
    if current:
        parts.append(current)
    return parts


def landscape_use(tags):
    if tags.get("natural") == "water" or tags.get("leisure") == "swimming_pool":
        return "water"
    if tags.get("leisure") == "pitch":
        return "pitch" if tags.get("surface") in {"grass", "artificial_turf"} or tags.get("sport") in {"soccer", "rugby_union", "baseball", "multi", "archery", "field_hockey"} else "court"
    if tags.get("natural") in {"wood", "scrub"} or tags.get("landuse") == "forest":
        return "woodland"
    if tags.get("leisure") in {"park", "garden"}:
        return "park"
    if tags.get("landuse") in {"grass", "meadow"} or tags.get("natural") in {"grassland", "heath"}:
        return "lawn"
    if tags.get("leisure") in {"stadium", "sports_centre"}:
        return "sportsGround"
    if tags.get("highway") == "pedestrian" and tags.get("area") == "yes":
        return "plaza"
    if tags.get("amenity") == "parking" and tags.get("parking") != "multi-storey":
        return "parking"
    return None


def selected_way(way, nodes):
    if way["id"] == STADIUM_ID:
        return True
    points = [local(nodes[n]) for n in way["nodes"]]
    tags = way.get("tags", {})
    closed = way["nodes"][0] == way["nodes"][-1]
    if closed and all(within(p) for p in points) and (tags.get("building") not in {None, "no"} or landscape_use(tags)):
        return True
    return tags.get("highway") in HIGHWAYS and tags.get("area") != "yes" and tags.get("tunnel") != "yes" and bool(clip_path(points))


def pin_source(elements, retrieved_at):
    source_nodes = {e["id"]: e for e in elements if e["type"] == "node"}
    source_ways = {e["id"]: e for e in elements if e["type"] == "way"}
    ways = [w for w in source_ways.values() if all(n in source_nodes for n in w["nodes"]) and selected_way(w, source_nodes)]
    node_ids = {n for w in ways for n in w["nodes"]} | LANDMARK_NODES
    picked = [source_nodes[n] for n in sorted(node_ids) if n in source_nodes] + sorted(ways, key=lambda w: w["id"])
    clean = []
    for element in picked:
        item = {k: v for k, v in element.items() if k in {"type", "id", "version", "timestamp", "lat", "lon", "nodes"}}
        tags = {k: v for k, v in element.get("tags", {}).items() if k in KEEP_TAGS}
        if tags:
            item["tags"] = tags
        clean.append(item)
    snapshot = {"attribution": "© OpenStreetMap contributors", "license": LICENSE_URL,
                "retrievedAt": retrieved_at, "sourceUrls": [CONTEXT_URL], "elements": clean}
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "osm-source.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")


def refresh():
    request = urllib.request.Request(CONTEXT_URL, headers={"User-Agent": "Opsidio-local-demo-venue-extractor/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        elements = json.load(response)["elements"]
    pin_source(elements, dt.datetime.now(dt.timezone.utc).isoformat())


def building_height(tags):
    raw = tags.get("height", "")
    if re.fullmatch(r"\d+(?:\.\d+)?(?:\s*m)?", raw):
        return float(raw.removesuffix("m").strip()), "OSM height tag, not independently surveyed"
    levels = tags.get("building:levels", "")
    if levels.isdigit():
        if tags.get("building") in {"stadium", "sports_hall"}:
            return max(14, float(levels) * 5), "Illustrative sports hall estimate: mapped levels × 5 m, minimum 14 m; not measured"
        return float(levels) * 3, "Illustrative estimate: mapped levels × 3 m; not measured"
    if tags.get("building") == "roof":
        return 4, "Illustrative 4 m canopy mass; no mapped height"
    return 8, "Illustrative 8 m default; no mapped height or levels"


def path_width(tags, walk):
    # All visual widths are assumptions, never navigation clearance or capacity.
    if tags.get("service") == "parking_aisle":
        return 3.4
    highway = tags.get("highway")
    if walk:
        return 7.5 if highway == "pedestrian" or tags.get("name") == "Jalan Lingkar Stadion" else 3.2
    return {"motorway": 12, "trunk": 12, "primary": 11, "secondary": 9, "tertiary": 8,
            "residential": 6, "unclassified": 6}.get(highway, 5)


def build():
    source_file = DATA / "osm-source.json"
    source = json.loads(source_file.read_text())
    nodes = {e["id"]: e for e in source["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in source["elements"] if e["type"] == "way"}
    rings = {i: [local(nodes[n]) for n in w["nodes"]] for i, w in ways.items()}
    stadium = rings[STADIUM_ID]
    buildings = [i for i, w in ways.items() if w.get("tags", {}).get("building") not in {None, "no"}
                 and w["nodes"][0] == w["nodes"][-1] and all(within(p) for p in rings[i])]
    excluded = {i: "Known overlapping alternative arena outline" for i in ALTERNATIVE_BUILDINGS if i in buildings}
    # Prefer the outer footprint. Building parts or alternative nested surveys
    # cannot be displayed as overlapping opaque masses without a roof model.
    for i in sorted(buildings, key=lambda key: -polygon_area(rings[key])):
        if i in excluded:
            continue
        if inside(anchor(rings[i]), stadium):
            excluded[i] = "Main stadium interior is owned by the separate stadium model"
            continue
        ai = polygon_area(rings[i])
        for j in buildings:
            if j == i or j in excluded or polygon_area(rings[j]) > ai:
                continue
            sample = rings[j][:-1]
            if sample and sum(inside(p, rings[i]) for p in sample) / len(sample) >= 0.85:
                excluded[j] = f"Nested/overlapping footprint simplified to outer osm-way-{i}"
    pack = {"id": "gbk-osm-local", "name": "Gelora Bung Karno — mapped context",
            "origin": ORIGIN, "basis": "mapped", "contextRadiusM": CONTEXT_RADIUS,
            "attribution": "© OpenStreetMap contributors · ODbL. Heights, trees, widths and work area are illustrative.",
            "sourceUrl": COPYRIGHT_URL, "stadiumOutline": stadium, "areas": [], "paths": [], "landmarks": [], "editBounds": EDIT_BOUNDS}
    provenance = []
    for way_id, way in sorted(ways.items()):
        tags, points = way.get("tags", {}), rings[way_id]
        record = {"id": f"osm-way-{way_id}", "sourceUrl": f"https://www.openstreetmap.org/way/{way_id}",
                  "sourceVersion": way.get("version"), "sourceTimestamp": way.get("timestamp"), "tags": tags}
        closed = way["nodes"][0] == way["nodes"][-1]
        rendered = False
        if way_id == STADIUM_ID:
            rendered = True
        elif way_id in excluded:
            record["omittedReason"] = excluded[way_id]
        elif way_id in buildings:
            height, height_basis = building_height(tags)
            area = {"id": record["id"], "kind": "building", "ring": points, "heightM": height,
                    "landscapeUse": "building", "label": tags.get("name", "")}
            pack["areas"].append(area)
            record["heightBasis"] = height_basis
            rendered = True
        elif closed and landscape_use(tags) and all(within(p) for p in points):
            if inside(anchor(points), stadium) or all(inside(p, stadium) for p in points[:-1]):
                record["omittedReason"] = "Mapped ground inside main stadium is represented by the separate stadium model"
            else:
                use = landscape_use(tags)
                kind = "water" if use == "water" else "green" if use in {"park", "woodland", "lawn", "pitch"} else "plaza"
                pack["areas"].append({"id": record["id"], "kind": kind, "ring": points, "landscapeUse": use,
                                      "label": tags.get("name", ""), "sport": tags.get("sport", "")})
                rendered = True
        elif tags.get("highway") in HIGHWAYS and tags.get("area") != "yes" and tags.get("tunnel") != "yes":
            walk = tags["highway"] in WALK_HIGHWAYS or tags.get("motor_vehicle") == "no"
            width = path_width(tags, walk)
            for index, part in enumerate(clip_path(points, stadium)):
                pack["paths"].append({"id": f"{record['id']}-{index}", "kind": "walk" if walk else "road", "points": part,
                                      "widthM": width, "highway": tags["highway"], "label": tags.get("name", "")})
            record["geometryTreatment"] = "Original polyline clipped to 900 m context circle and outside main stadium; no gaps connected; no route/access validation"
            record["widthBasis"] = f"Illustrative {width} m visual width by highway class; not measured clearance"
        if rendered and tags.get("name") and (way_id == STADIUM_ID or way_id in buildings or tags.get("leisure") in {"park", "stadium", "pitch"}):
            pack["landmarks"].append({"id": record["id"], "label": tags["name"], "position": anchor(points)})
            record["labelPositionBasis"] = "Mean of mapped way vertices; not an entrance"
        provenance.append(record)
    for node_id in sorted(LANDMARK_NODES):
        if node_id not in nodes or not within(local(nodes[node_id])):
            continue
        node = nodes[node_id]
        tags = node.get("tags", {})
        pack["landmarks"].append({"id": f"osm-node-{node_id}", "label": f"Pintu {tags.get('ref', tags.get('name', ''))} (OSM)", "position": local(node)})
        provenance.append({"id": f"osm-node-{node_id}", "sourceUrl": f"https://www.openstreetmap.org/node/{node_id}", "tags": tags,
                           "note": "Mapped gate location only; current access is unverified"})
    assert len(stadium) >= 4 and stadium[0] == stadium[-1]
    assert all(a["ring"][0] == a["ring"][-1] and all(within(p) for p in a["ring"]) for a in pack["areas"])
    assert all(len(p["points"]) >= 2 and all(within(q) for q in p["points"]) for p in pack["paths"])
    all_points = stadium + [p for a in pack["areas"] for p in a["ring"]] + [p for path in pack["paths"] for p in path["points"]]
    assert all(len(p) == 3 and all(math.isfinite(v) for v in p) and p[1] == 0 for p in all_points)
    assert not any(a["id"] in {f"osm-way-{i}" for i in ALTERNATIVE_BUILDINGS | {STADIUM_ID}} for a in pack["areas"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    metadata = {"sourceRetrievedAt": source["retrievedAt"], "sourceSha256": hashlib.sha256(source_file.read_bytes()).hexdigest(), "license": LICENSE_URL,
                "mapBoundsMetres": MAP_BOUNDS, "contextRadiusMetres": CONTEXT_RADIUS,
                "editBoundsBasis": "Fictional demo work envelope north of stadium; includes unverified ground beyond narrow mapped pedestrian plaza",
                "coordinateSystem": "WGS84 lon/lat to local equirectangular metres: X east, Y up=0, Z south; R=6378137 m; rounded to 0.01 m (not accuracy)",
                "landscapeRendering": {"buildings": "Source footprints, illustrative massing; mapped height tags used when present, otherwise documented estimates",
                    "trees": "Deterministic illustrative planting within mapped woodland, park and lawn polygons; positions, species, size and count are not surveyed. Sports fields, water, buildings, mapped path ribbons and demo work envelope excluded.",
                    "surfaceElevations": "Ground polygons, paths, building bases and disk top stay at Y=0. Conservative overlap-depth batches use polygonOffset/renderOrder for stable display without changing placement coordinates. Only roof borders use a 0.06 m visual offset.",
                    "widths": "All path/road widths are illustrative by highway class. No navigability, accessibility, clearance or capacity is established.",
                    "appearance": "Warm ivory/periwinkle massing, roof edge bands, faceted tree crowns, pitch borders and colours are schematic visual design; no architectural survey or imagery traced."},
                "features": provenance}
    (DATA / "provenance.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)), "stadiumVertices": len(stadium), "areas": len(pack["areas"]),
                      "buildings": sum(a["kind"] == "building" for a in pack["areas"]), "paths": len(pack["paths"]), "landmarks": len(pack["landmarks"]),
                      "omittedBuildings": len(excluded), "contextRadiusM": CONTEXT_RADIUS, "editBounds": EDIT_BOUNDS}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Fetch current public OSM data before rebuilding")
    args = parser.parse_args()
    if args.refresh:
        refresh()
    build()
