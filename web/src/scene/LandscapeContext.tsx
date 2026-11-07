import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { MapArea, MapPath, Point, VenuePack } from '../simulation/types'

// Optional visual metadata accompanies the mapped coordinates. It is not a
// navigation model: widths, planting and every non-zero Y value are illustrative.
type LandscapeArea = MapArea & { landscapeUse?: string; label?: string; sport?: string }
type LandscapePath = MapPath & { widthM?: number; highway?: string }
type Tree = { x: number; z: number; radius: number; height: number; tint: string; turn: number }
type Surface = { area: LandscapeArea; layer: number; bounds: ReturnType<typeof extent> }

const colors = {
  disk: '#d1d8c5', edge: '#bec7b2', woodland: '#a5b793', park: '#b3c19f', lawn: '#bdc9ab',
  pitch: '#94ac87', court: '#abb4b0', plaza: '#d5d5c4', parking: '#b7bdb1', sportsGround: '#c1c7b8', water: '#9fbec1',
  road: '#64726d', roadEdge: '#b1baa9', walk: '#929e90', walkEdge: '#c8cebc',
  wall: '#ddd9c7', roof: '#efebdd', roofEdge: '#c7c6b5', accentWall: '#919fce', accentRoof: '#b1bde1', accentEdge: '#7e8ebf',
  trunk: '#8d8f74', markings: '#e2e7cf', shadow: '#4a5947',
}
const landmarkBuildings = new Set([
  'osm-way-29203124', // Indonesia Arena
  'osm-way-153303501', // Tennis Indoor
  'osm-way-403720892', // Istora
  'osm-way-155110240', // GBK Arena
  'osm-way-153303496', 'osm-way-1371873078', 'osm-way-1371873079', // JCC halls
  'osm-way-754516405', // Senayan Park
])
const treeTints = ['#81976f', '#8ca379', '#9eb18a', '#769066', '#a7b994']

function areaSize(ring: readonly Point[]) {
  let sum = 0
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][2] - ring[i][0] * ring[i - 1][2]
  return Math.abs(sum / 2)
}
function inside(x: number, z: number, ring: readonly Point[]) {
  let result = false
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i]
    if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) result = !result
  }
  return result
}
function extent(ring: readonly Point[]) {
  return ring.reduce((b, p) => ({ minX: Math.min(b.minX, p[0]), maxX: Math.max(b.maxX, p[0]), minZ: Math.min(b.minZ, p[2]), maxZ: Math.max(b.maxZ, p[2]) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity })
}
function hash(value: string) {
  let n = 2166136261
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619)
  return n >>> 0
}
function random(seed: number) {
  let n = seed
  return () => {
    n |= 0; n = n + 0x6d2b79f5 | 0
    let t = Math.imul(n ^ n >>> 15, 1 | n)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
function shape(ring: readonly Point[]) {
  return new THREE.Shape(ring.slice(0, -1).map(p => new THREE.Vector2(p[0], -p[2])))
}
function tinted(geometry: THREE.BufferGeometry, base: string, top?: string) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
  const color = new THREE.Color(base), roof = new THREE.Color(top ?? base), array = new Float32Array(positions.count * 3)
  for (let i = 0; i < positions.count; i++) (normals && normals.getY(i) > 0.5 ? roof : color).toArray(array, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3))
  // A consistent set of attributes lets planar and extruded parts share a draw.
  geometry.deleteAttribute('uv')
  return geometry
}
function merge(parts: THREE.BufferGeometry[]) {
  if (!parts.length) return null
  const normalized = parts.map(part => {
    if (!part.index) return part
    const expanded = part.toNonIndexed(); part.dispose(); return expanded
  })
  const result = mergeGeometries(normalized, false)
  normalized.forEach(part => part.dispose())
  result?.computeBoundingSphere()
  return result
}
function flat(ring: readonly Point[], y: number) {
  const geometry = new THREE.ShapeGeometry(shape(ring))
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, y, 0)
  return geometry
}

/** A world-metre ribbon with bounded miter joins; width does not grow on zoom. */
function ribbon(points: readonly Point[], width: number, y: number) {
  const path = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]) > 0.001)
  if (path.length < 2) return new THREE.BufferGeometry()
  const positions: number[] = [], indices: number[] = []
  const closed = path.length > 2 && path[0][0] === path[path.length - 1][0] && path[0][2] === path[path.length - 1][2]
  for (let i = 0; i < path.length; i++) {
    const p = path[i], previous = path[i > 0 ? i - 1 : closed ? path.length - 2 : 0], next = path[i < path.length - 1 ? i + 1 : closed ? 1 : path.length - 1]
    const a = new THREE.Vector2(p[0] - previous[0], p[2] - previous[2]).normalize()
    const b = new THREE.Vector2(next[0] - p[0], next[2] - p[2]).normalize()
    if (!a.lengthSq()) a.copy(b)
    if (!b.lengthSq()) b.copy(a)
    const normal = new THREE.Vector2(-a.y - b.y, a.x + b.x).normalize()
    if (!normal.lengthSq()) normal.set(-b.y, b.x)
    const denominator = Math.abs(normal.dot(new THREE.Vector2(-b.y, b.x)))
    const half = width / 2 / Math.max(0.5, denominator)
    positions.push(p[0] + normal.x * half, y, p[2] + normal.y * half, p[0] - normal.x * half, y, p[2] - normal.y * half)
    if (i) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function distanceToSegmentSquared(x: number, z: number, a: Point, b: Point) {
  const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0
  return (x - a[0] - t * dx) ** 2 + (z - a[2] - t * dz) ** 2
}

function planting(venue: VenuePack) {
  const areas = venue.areas as readonly LandscapeArea[], paths = venue.paths as readonly LandscapePath[]
  const planted: Tree[] = [], occupied = new Map<string, Tree[]>(), cell = 10
  const excluded = areas.filter(a => a.kind !== 'green' || a.landscapeUse === 'pitch').map(a => ({ area: a, bounds: extent(a.ring) }))
  const pathSegments = new Map<string, { a: Point; b: Point; clearance: number }[]>()
  const pathCell = 24
  // Local spatial buckets keep deterministic rejection sampling cheap even with
  // the full road/path context. No tree may cover a mapped path ribbon.
  paths.forEach(path => {
    const clearance = (path.widthM ?? (path.kind === 'road' ? 8 : 3.2)) / 2 + 4.5
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i]
      for (let x = Math.floor((Math.min(a[0], b[0]) - clearance) / pathCell); x <= Math.floor((Math.max(a[0], b[0]) + clearance) / pathCell); x++) {
        for (let z = Math.floor((Math.min(a[2], b[2]) - clearance) / pathCell); z <= Math.floor((Math.max(a[2], b[2]) + clearance) / pathCell); z++) {
          const key = `${x},${z}`, list = pathSegments.get(key) ?? []
          list.push({ a, b, clearance }); pathSegments.set(key, list)
        }
      }
    }
  })
  const candidates = areas.filter(a => a.kind === 'green' && ['woodland', 'park', 'lawn'].includes(a.landscapeUse ?? ''))
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const area of candidates) {
    const box = extent(area.ring), rand = random(hash(area.id)), spacing = area.landscapeUse === 'woodland' ? 11 : area.landscapeUse === 'park' ? 16 : 21
    for (let z0 = box.minZ + spacing / 2; z0 < box.maxZ; z0 += spacing) {
      for (let x0 = box.minX + spacing / 2; x0 < box.maxX; x0 += spacing) {
        const x = x0 + (rand() - 0.5) * spacing * 0.8, z = z0 + (rand() - 0.5) * spacing * 0.8
        const radius = 3 + rand() * 2.1, height = 7.8 + rand() * 4.2, turn = rand() * Math.PI * 2, tint = treeTints[Math.floor(rand() * treeTints.length)]
        const e = venue.editBounds
        if (x > e.minX - 6 && x < e.maxX + 6 && z > e.minZ - 6 && z < e.maxZ + 6) continue
        if (!inside(x, z, area.ring) || inside(x, z, venue.stadiumOutline)) continue
        // Keep the whole crown inside the mapped green ring, not just its trunk.
        if (![[radius, 0], [-radius, 0], [0, radius], [0, -radius]].every(([dx, dz]) => inside(x + dx, z + dz, area.ring))) continue
        if (excluded.some(({ area: other, bounds: b }) => x > b.minX - radius && x < b.maxX + radius && z > b.minZ - radius && z < b.maxZ + radius &&
          (inside(x, z, other.ring) || other.ring.some((p, i) => i && distanceToSegmentSquared(x, z, other.ring[i - 1], p) < (radius + 1) ** 2)))) continue
        if ((pathSegments.get(`${Math.floor(x / pathCell)},${Math.floor(z / pathCell)}`) ?? []).some(s => distanceToSegmentSquared(x, z, s.a, s.b) < s.clearance ** 2)) continue
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell)
        let crowded = false
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
          if ((occupied.get(`${gx},${gz}`) ?? []).some(t => Math.hypot(t.x - x, t.z - z) < (t.radius + radius) * 0.9)) crowded = true
        }
        if (crowded) continue
        const tree = { x, z, radius, height, turn, tint }, key = `${cx},${cz}`, bucket = occupied.get(key) ?? []
        planted.push(tree); bucket.push(tree); occupied.set(key, bucket)
      }
    }
  }
  return planted
}

function Trees({ trees }: { trees: readonly Tree[] }) {
  const crowns = useRef<THREE.InstancedMesh>(null), trunks = useRef<THREE.InstancedMesh>(null), shades = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const object = new THREE.Object3D(), tint = new THREE.Color()
    trees.forEach((tree, i) => {
      object.position.set(tree.x, tree.height * 0.7, tree.z); object.rotation.set(0, tree.turn, 0)
      object.scale.set(tree.radius, tree.height * 0.38, tree.radius * 0.9); object.updateMatrix()
      crowns.current!.setMatrixAt(i, object.matrix); crowns.current!.setColorAt(i, tint.set(tree.tint))
      object.position.set(tree.x, tree.height * 0.28, tree.z); object.rotation.set(0, 0, 0)
      object.scale.set(0.35, tree.height * 0.56, 0.35); object.updateMatrix(); trunks.current!.setMatrixAt(i, object.matrix)
      object.position.set(tree.x + 1.3, 0, tree.z + 1); object.rotation.set(-Math.PI / 2, 0, tree.turn)
      object.scale.set(tree.radius * 1.12, tree.radius * 0.82, 1); object.updateMatrix(); shades.current!.setMatrixAt(i, object.matrix)
    })
    for (const ref of [crowns, trunks, shades]) if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere() }
    if (crowns.current?.instanceColor) crowns.current.instanceColor.needsUpdate = true
  }, [trees])
  if (!trees.length) return null
  return <group name="illustrative-planting" userData={{ basis: 'Illustrative deterministic planting inside mapped green polygons', trees: trees.length }}>
    <instancedMesh ref={shades} args={[undefined, undefined, trees.length]} renderOrder={30}>
      <circleGeometry args={[1, 10]} /><meshBasicMaterial color={colors.shadow} transparent opacity={0.1} depthWrite={false} polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={-1} />
    </instancedMesh>
    <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]}>
      <cylinderGeometry args={[0.7, 1, 1, 5]} /><meshStandardMaterial color={colors.trunk} roughness={1} />
    </instancedMesh>
    <instancedMesh ref={crowns} args={[undefined, undefined, trees.length]}>
      <icosahedronGeometry args={[1, 1]} /><meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
  </group>
}

function polygonHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[2] - b[2])
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
  const lower: Point[] = [], upper: Point[] = []
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p) }
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p) }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return [...hull, hull[0]]
}

/** Static local context: mapped footprints and paths, schematic massing/planting.
 * All repeated surfaces are merged; the whole landscape uses a small, bounded set of draws.
 * Ground layers intentionally do not receive shadow maps: stable graphic shading
 * avoids acne at this kilometre-wide scale while roof/tree faces retain light.
 */
const LandscapeContext = memo(function LandscapeContext({ venue }: { venue: VenuePack }) {
  const scene = useMemo(() => {
    const areas = venue.areas as readonly LandscapeArea[], paths = venue.paths as readonly LandscapePath[]
    const surfaceParts: THREE.BufferGeometry[][] = [], buildingParts: THREE.BufferGeometry[] = [], roofEdges: THREE.BufferGeometry[] = [], markings: THREE.BufferGeometry[] = [], shadows: THREE.BufferGeometry[] = []
    // All ground stays exactly Y=0. Draw its colour layers before 3D objects,
    // without changing depth. Slope-based depth bias can lift kilometre-wide
    // surfaces in front of tent legs and walkers when the camera tilts.
    // Bounds-overlap layers keep contained courts/parks in a stable order.
    const ground = areas.filter(a => a.kind !== 'building').sort((a, b) => areaSize(b.ring) - areaSize(a.ring) || a.id.localeCompare(b.id))
    const surfaces: Surface[] = []
    for (const area of ground) {
      const b = extent(area.ring)
      let layer = 0
      for (const previous of surfaces) {
        const a = previous.bounds
        if (b.maxX >= a.minX && b.minX <= a.maxX && b.maxZ >= a.minZ && b.minZ <= a.maxZ) layer = Math.max(layer, previous.layer + 1)
      }
      surfaces.push({ area, layer, bounds: b })
    }
    for (const { area, layer } of surfaces) {
      const y = 0
      const use = area.landscapeUse ?? (area.kind === 'green' ? 'lawn' : area.kind)
      const color = colors[use as keyof typeof colors] ?? colors.plaza
      ;(surfaceParts[layer] ??= []).push(tinted(flat(area.ring, y), color))
      if (use === 'pitch' || use === 'court') {
        const ring = area.ring, cx = ring.slice(0, -1).reduce((n, p) => n + p[0], 0) / (ring.length - 1), cz = ring.slice(0, -1).reduce((n, p) => n + p[2], 0) / (ring.length - 1)
        const inset: Point[] = ring.map(p => [cx + (p[0] - cx) * 0.94, 0, cz + (p[2] - cz) * 0.94])
        markings.push(ribbon(inset, 0.32, y))
        if (ring.length === 5 && ['soccer', 'tennis', 'basketball'].includes(area.sport ?? '')) {
          const a: Point = [(inset[0][0] + inset[1][0]) / 2, 0, (inset[0][2] + inset[1][2]) / 2]
          const b: Point = [(inset[2][0] + inset[3][0]) / 2, 0, (inset[2][2] + inset[3][2]) / 2]
          markings.push(ribbon([a, b], 0.27, y))
        }
      }
    }
    for (const area of areas.filter(a => a.kind === 'building')) {
      const height = Math.max(2, area.heightM ?? 8), accent = landmarkBuildings.has(area.id)
      const solid = new THREE.ExtrudeGeometry(shape(area.ring), { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 })
      solid.rotateX(-Math.PI / 2)
      buildingParts.push(tinted(solid, accent ? colors.accentWall : colors.wall, accent ? colors.accentRoof : colors.roof))
      roofEdges.push(tinted(ribbon(area.ring, accent ? 0.8 : 0.5, height + 0.06), accent ? colors.accentEdge : colors.roofEdge))
      // A stable graphic ground shade, not a second depth/shadow pass. Its
      // projected hull is visual styling; it is never exposed as mapped data.
      const shifted = area.ring.map(p => [p[0] + height * 0.17, 0, p[2] + height * 0.12] as Point)
      shadows.push(flat(polygonHull([...area.ring, ...shifted]), 0))
    }
    const road = paths.filter(p => p.kind === 'road'), walk = paths.filter(p => p.kind === 'walk')
    const pathBatch = (items: readonly LandscapePath[], extra: number, y: number) => merge(items.map(p => ribbon(p.points, (p.widthM ?? (p.kind === 'road' ? 8 : 3.2)) + extra, y)))
    return { ground: surfaceParts.map(parts => merge(parts)), buildings: merge(buildingParts), roofEdges: merge(roofEdges), markings: merge(markings), shadows: merge(shadows),
      roadEdge: pathBatch(road, 1.5, 0), road: pathBatch(road, 0, 0), walkEdge: pathBatch(walk, 0.9, 0), walk: pathBatch(walk, 0, 0), trees: planting(venue) }
  }, [venue])
  useEffect(() => () => {
    for (const value of Object.values(scene)) {
      if (value instanceof THREE.BufferGeometry) value.dispose()
      else if (Array.isArray(value)) value.forEach(item => { if (item instanceof THREE.BufferGeometry) item.dispose() })
    }
  }, [scene])
  const radius = (venue as VenuePack & { contextRadiusM?: number }).contextRadiusM ?? 900
  return <group name="gbk-mapped-landscape">
    <mesh position={[0, -3, 0]} renderOrder={-1000}>
      <cylinderGeometry args={[radius + 8, radius + 8, 6, 160]} /><meshStandardMaterial color={colors.disk} roughness={1} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} renderOrder={-990}>
      <ringGeometry args={[radius + 3, radius + 8, 160]} /><meshBasicMaterial color={colors.edge} depthTest={false} depthWrite={false} />
    </mesh>
    {scene.ground.map((geometry, layer) => geometry && <mesh key={layer} geometry={geometry} renderOrder={-900 + layer}>
      <meshStandardMaterial vertexColors roughness={1} depthTest={false} depthWrite={false} />
    </mesh>)}
    {scene.shadows && <mesh geometry={scene.shadows} renderOrder={30}><meshBasicMaterial color={colors.shadow} transparent opacity={0.12} depthWrite={false} polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={-1} /></mesh>}
    {scene.roadEdge && <mesh geometry={scene.roadEdge} renderOrder={-560}><meshBasicMaterial color={colors.roadEdge} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh>}
    {scene.road && <mesh geometry={scene.road} renderOrder={-558}><meshBasicMaterial color={colors.road} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh>}
    {scene.walkEdge && <mesh geometry={scene.walkEdge} renderOrder={-556}><meshBasicMaterial color={colors.walkEdge} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh>}
    {scene.walk && <mesh geometry={scene.walk} renderOrder={-554}><meshBasicMaterial color={colors.walk} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh>}
    {scene.markings && <mesh geometry={scene.markings} renderOrder={-574}><meshBasicMaterial color={colors.markings} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh>}
    {scene.buildings && <mesh geometry={scene.buildings}><meshStandardMaterial vertexColors roughness={0.95} flatShading /></mesh>}
    {scene.roofEdges && <mesh geometry={scene.roofEdges}><meshBasicMaterial vertexColors side={THREE.DoubleSide} /></mesh>}
    <Trees trees={scene.trees} />
  </group>
})

export default LandscapeContext
