#!/usr/bin/env python3
"""Build the small GBK VenuePack from an attributed, pinned OSM extract.

Offline: python3 tools/venue-gbk.py
Refresh: python3 tools/venue-gbk.py --refresh
Only the Python standard library is required. See data/venues/gbk/README.md.
"""

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/venues/gbk"
OUTPUT = ROOT / "web/src/simulation/venue/gbk.json"
ORIGIN = {"lon": 106.80255, "lat": -6.21858}
MAP_BOUNDS = {"minX": -480, "maxX": 480, "minZ": -550, "maxZ": 450}
EDIT_BOUNDS = {"minX": -55, "maxX": 55, "minZ": -325, "maxZ": -175}
STADIUM_ID = 682984153
STADIUM_URL = f"https://api.openstreetmap.org/api/0.6/way/{STADIUM_ID}/full.json"
CONTEXT_URL = "https://api.openstreetmap.org/api/0.6/map.json?bbox=106.797,-6.224,106.808,-6.2125"
COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
# Deliberately bounded context, not a complete map. These nearby named buildings
# avoid overlapping alternative outlines present in the source extract.
BUILDING_IDS = {
    29203124, 153303501, 403720892, 119772934, 119772933,
    403720931, 403722793, 403720944, 754516399, 755282394,
}
LANDMARK_WAYS = {
    STADIUM_ID, 29203124, 153303501, 403720892, 29026803,
    403720906, 403720907, 403720908, 403720897, 506643608,
}
LANDMARK_NODES = {7044588762, 7047415793, 7048980920, 7059433344, 7059770842}
KEEP_TAGS = {
    "name", "name:en", "highway", "service", "area", "access", "foot",
    "bicycle", "motor_vehicle", "building", "building:levels", "height",
    "leisure", "landuse", "natural", "surface", "sport", "barrier",
    "entrance", "ref", "source",
}


def local(node):
    # WGS84 geodetic origin; local equirectangular approximation in metres.
    # Spherical radius is WGS84 semi-major axis. Y is illustrative flat ground.
    factor = math.pi / 180 * 6378137
    return [round((node["lon"] - ORIGIN["lon"]) * factor * math.cos(math.radians(ORIGIN["lat"])), 2),
            0, round((ORIGIN["lat"] - node["lat"]) * factor, 2)]


def within(point, bounds=MAP_BOUNDS):
    return bounds["minX"] <= point[0] <= bounds["maxX"] and bounds["minZ"] <= point[2] <= bounds["maxZ"]


def clip_segment(a, b):
    """Liang–Barsky clipping; no outside points or connections across gaps."""
    dx, dz = b[0] - a[0], b[2] - a[2]
    lo, hi = 0.0, 1.0
    for p, q in [(-dx, a[0] - MAP_BOUNDS["minX"]), (dx, MAP_BOUNDS["maxX"] - a[0]),
                 (-dz, a[2] - MAP_BOUNDS["minZ"]), (dz, MAP_BOUNDS["maxZ"] - a[2])]:
        if p == 0:
            if q < 0:
                return None
        elif p < 0:
            lo = max(lo, q / p)
        else:
            hi = min(hi, q / p)
        if lo > hi:
            return None
    return [[round(a[0] + t * dx, 2), 0, round(a[2] + t * dz, 2)] for t in (lo, hi)]


def clip_path(points):
    parts, current = [], []
    for a, b in zip(points, points[1:]):
        segment = clip_segment(a, b)
        if segment and segment[0] != segment[1]:
            if current and current[-1] != segment[0]:
                parts.append(current)
                current = []
            if not current:
                current = [segment[0]]
            current.append(segment[1])
        elif current:
            parts.append(current)
            current = []
    if current:
        parts.append(current)
    return parts


def length(points):
    return sum(math.hypot(b[0] - a[0], b[2] - a[2]) for a, b in zip(points, points[1:]))


def area_kind(tags):
    if tags.get("natural") == "water":
        return "water"
    if tags.get("landuse") == "grass" or tags.get("natural") == "wood" or tags.get("leisure") == "park":
        return "green"
    if tags.get("leisure") == "pitch":
        return "green" if tags.get("surface") == "grass" or tags.get("sport") in {"soccer", "rugby_union", "baseball"} else "plaza"
    if tags.get("highway") == "pedestrian" and tags.get("area") == "yes":
        return "plaza"
    return None


def selected_way(way, nodes):
    points = [local(nodes[n]) for n in way["nodes"]]
    if way["id"] == STADIUM_ID:
        return True
    tags = way.get("tags", {})
    closed = way["nodes"][0] == way["nodes"][-1]
    if closed and all(within(p) for p in points):
        if way["id"] in BUILDING_IDS or area_kind(tags) or way["id"] in LANDMARK_WAYS:
            return True
    highway = tags.get("highway")
    if not highway or tags.get("area") == "yes" or tags.get("service") == "parking_aisle":
        return False
    if highway not in {"primary", "secondary", "primary_link", "secondary_link", "unclassified", "residential", "service", "footway", "pedestrian", "path", "cycleway", "steps"}:
        return False
    parts = clip_path(points)
    if not parts:
        return False
    # Omit minor unnamed service spurs outside the stadium core.
    return highway != "service" or "name" in tags or sum(length(p) for p in parts) >= 90 or any(math.hypot(p[0], p[2]) < 200 for part in parts for p in part)


def pin_source(elements, retrieved_at):
    # Retain public geometry and relevant source metadata only, excluding editor
    # account fields, contact details, unrelated relation members and POIs.
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
                "retrievedAt": retrieved_at, "sourceUrls": [STADIUM_URL, CONTEXT_URL], "elements": clean}
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "osm-source.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")


def refresh():
    elements = []
    for url in [CONTEXT_URL, STADIUM_URL]:
        request = urllib.request.Request(url, headers={"User-Agent": "Opsidio-local-demo-venue-extractor/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            elements.extend(json.load(response)["elements"])
    pin_source(elements, dt.datetime.now(dt.timezone.utc).isoformat())


def build():
    source_file = DATA / "osm-source.json"
    source = json.loads(source_file.read_text())
    nodes = {e["id"]: e for e in source["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in source["elements"] if e["type"] == "way"}
    pack = {"id": "gbk-osm-local", "name": "Gelora Bung Karno — mapped context",
            "origin": ORIGIN, "basis": "mapped",
            "attribution": "© OpenStreetMap contributors · ODbL. Heights and demo work area are illustrative.",
            "sourceUrl": COPYRIGHT_URL, "stadiumOutline": [], "areas": [], "paths": [], "landmarks": [], "editBounds": EDIT_BOUNDS}
    provenance = []
    for way_id, way in sorted(ways.items()):
        tags = way.get("tags", {})
        points = [local(nodes[n]) for n in way["nodes"]]
        osm_url = f"https://www.openstreetmap.org/way/{way_id}"
        record = {"id": f"osm-way-{way_id}", "sourceUrl": osm_url, "sourceVersion": way.get("version"), "sourceTimestamp": way.get("timestamp"), "tags": tags}
        if way_id == STADIUM_ID:
            pack["stadiumOutline"] = points
        elif way_id in BUILDING_IDS:
            height = float(tags["height"]) if tags.get("height", "").replace(".", "", 1).isdigit() else None
            if height is not None:
                height_basis = "OSM height tag, not independently surveyed"
            elif tags.get("building:levels", "").isdigit():
                height = float(tags["building:levels"]) * 3
                height_basis = "Illustrative estimate: mapped levels × 3 m; not measured height"
            else:
                height = 8
                height_basis = "Illustrative 8 m default; no mapped height or levels"
            pack["areas"].append({"id": record["id"], "kind": "building", "ring": points, "heightM": height})
            record["heightBasis"] = height_basis
        elif way["nodes"][0] == way["nodes"][-1] and area_kind(tags) and all(within(p) for p in points):
            pack["areas"].append({"id": record["id"], "kind": area_kind(tags), "ring": points})
        elif tags.get("highway") and tags.get("area") != "yes":
            walk = tags["highway"] in {"footway", "pedestrian", "path", "cycleway", "steps"} or tags.get("motor_vehicle") == "no"
            for index, part in enumerate(clip_path(points)):
                pack["paths"].append({"id": f"{record['id']}-{index}", "kind": "walk" if walk else "road", "points": part})
            record["geometryTreatment"] = "Polyline clipped to local context bounds; widths and access are not modeled"
        if way_id in LANDMARK_WAYS:
            ring = points[:-1] if points[0] == points[-1] else points
            # Label anchor is vertex mean, not an entrance or surveyed centre.
            anchor = [round(sum(p[0] for p in ring) / len(ring), 2), 0, round(sum(p[2] for p in ring) / len(ring), 2)]
            pack["landmarks"].append({"id": record["id"], "label": tags["name"], "position": anchor})
            record["labelPositionBasis"] = "Mean of mapped way vertices; not an entrance"
        provenance.append(record)
    for node_id in sorted(LANDMARK_NODES):
        if node_id not in nodes or not within(local(nodes[node_id])):
            continue
        node = nodes[node_id]
        tags = node.get("tags", {})
        label = f"Pintu {tags.get('ref', tags.get('name', ''))} (OSM)"
        pack["landmarks"].append({"id": f"osm-node-{node_id}", "label": label, "position": local(node)})
        provenance.append({"id": f"osm-node-{node_id}", "sourceUrl": f"https://www.openstreetmap.org/node/{node_id}", "tags": tags, "note": "Mapped gate location only; current access is unverified"})
    assert len(pack["stadiumOutline"]) >= 4 and pack["stadiumOutline"][0] == pack["stadiumOutline"][-1]
    assert all(a["ring"][0] == a["ring"][-1] for a in pack["areas"])
    assert all(len(p["points"]) >= 2 and all(within(q) for q in p["points"]) for p in pack["paths"])
    all_points = pack["stadiumOutline"] + [p for a in pack["areas"] for p in a["ring"]] + [p for path in pack["paths"] for p in path["points"]]
    assert all(len(p) == 3 and all(math.isfinite(v) for v in p) and p[1] == 0 for p in all_points)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    metadata = {"sourceRetrievedAt": source["retrievedAt"], "sourceSha256": hashlib.sha256(source_file.read_bytes()).hexdigest(), "license": LICENSE_URL,
                "mapBoundsMetres": MAP_BOUNDS, "editBoundsBasis": "Fictional demo work envelope north of stadium; includes unverified ground beyond narrow mapped pedestrian plaza",
                "coordinateSystem": "WGS84 lon/lat to local equirectangular metres: X east, Y up=0, Z south; R=6378137 m; rounded to 0.01 m (not accuracy)",
                "features": provenance}
    (DATA / "provenance.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)), "stadiumVertices": len(pack["stadiumOutline"]), "areas": len(pack["areas"]), "paths": len(pack["paths"]), "landmarks": len(pack["landmarks"]), "editBounds": EDIT_BOUNDS}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Fetch current public OSM data before rebuilding")
    args = parser.parse_args()
    if args.refresh:
        refresh()
    build()
