import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type {} from '@react-three/fiber'
import * as THREE from 'three'
import type { VenuePack } from '../simulation/types'

type V3 = [number, number, number]
type Buffer = number[]
type Chair = { position: V3; yaw: number; color: THREE.Color }

const TAU = Math.PI * 2
const SEGMENTS = 160
const colors = {
  ivory: '#dedfd3', roof: '#efeee4', roofShade: '#bbc7bb',
  concrete: '#a7b1a0', shade: '#495d54', red: '#a54e43',
  sage: '#819580', track: '#aa6654', grass: '#63805b',
  grassLight: '#6c895f', marking: '#e7ebd7',
}
type Surface = keyof typeof colors
type Batches = Record<Surface, Buffer>

function quad(target: Buffer, a: V3, b: V3, c: V3, d: V3) {
  target.push(...a, ...b, ...c, ...a, ...c, ...d)
}

function geometry(vertices: Buffer) {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  result.computeVertexNormals()
  result.computeBoundingSphere()
  return result
}

function oval(rx: number, rz: number, y: number, angle: number): V3 {
  return [rx * Math.cos(angle), y, rz * Math.sin(angle)]
}

function band(target: Buffer, outerX: number, outerZ: number, innerX: number, innerZ: number,
  outerY: number, innerY = outerY, skip?: (segment: number) => boolean) {
  for (let i = 0; i < SEGMENTS; i++) {
    if (skip?.(i)) continue
    const a = i / SEGMENTS * TAU, b = (i + 1) / SEGMENTS * TAU
    quad(target, oval(outerX, outerZ, outerY, a), oval(innerX, innerZ, innerY, a),
      oval(innerX, innerZ, innerY, b), oval(outerX, outerZ, outerY, b))
  }
}

function wall(target: Buffer, rx: number, rz: number, bottom: number, top: number,
  skip?: (segment: number) => boolean) {
  for (let i = 0; i < SEGMENTS; i++) {
    if (skip?.(i)) continue
    const a = i / SEGMENTS * TAU, b = (i + 1) / SEGMENTS * TAU
    quad(target, oval(rx, rz, bottom, a), oval(rx, rz, top, a),
      oval(rx, rz, top, b), oval(rx, rz, bottom, b))
  }
}

function box(target: Buffer, position: V3, size: V3, rotation = new THREE.Quaternion()) {
  const [x, y, z] = size.map(v => v / 2)
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(1, 1, 1))
  const corners = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]
    .map(([px, py, pz]) => new THREE.Vector3(px, py, pz).applyMatrix4(matrix).toArray() as V3)
  for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3],
    [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]) quad(target, corners[a], corners[b], corners[c], corners[d])
}

function beam(target: Buffer, from: V3, to: V3, width: number, depth = width) {
  const direction = new THREE.Vector3(...to).sub(new THREE.Vector3(...from))
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  box(target, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    [width, direction.length(), depth], rotation)
}

function capsule(radius: number, straightHalf: number, y: number): V3[] {
  const points: V3[] = []
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI + i / 40 * Math.PI
    points.push([Math.cos(a) * radius, y, -straightHalf + Math.sin(a) * radius])
  }
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * Math.PI
    points.push([Math.cos(a) * radius, y, straightHalf + Math.sin(a) * radius])
  }
  return points
}

function capsuleBand(target: Buffer, outer: number, inner: number, straightHalf: number, y: number) {
  const outside = capsule(outer, straightHalf, y), inside = capsule(inner, straightHalf, y)
  for (let i = 0; i < outside.length; i++) {
    const next = (i + 1) % outside.length
    quad(target, outside[i], inside[i], inside[next], outside[next])
  }
}

function circle(target: Buffer, cx: number, cz: number, radius: number, y: number, width: number, start = 0, end = TAU) {
  const count = Math.max(8, Math.ceil((end - start) / TAU * 64))
  for (let i = 0; i < count; i++) {
    const a = start + i / count * (end - start), b = start + (i + 1) / count * (end - start)
    const p = (r: number, angle: number): V3 => [cx + r * Math.cos(angle), y, cz + r * Math.sin(angle)]
    quad(target, p(radius + width / 2, a), p(Math.max(0, radius - width / 2), a),
      p(Math.max(0, radius - width / 2), b), p(radius + width / 2, b))
  }
}

function paintLine(target: Buffer, from: [number, number], to: [number, number], y: number, width = 0.18) {
  const dx = to[0] - from[0], dz = to[1] - from[1], distance = Math.hypot(dx, dz)
  if (!distance) return
  const px = -dz / distance * width / 2, pz = dx / distance * width / 2
  quad(target, [from[0] - px, y, from[1] - pz], [from[0] + px, y, from[1] + pz],
    [to[0] + px, y, to[1] + pz], [to[0] - px, y, to[1] - pz])
}

function makeModel(rx: number, rz: number) {
  const batches: Batches = { ivory: [], roof: [], roofShade: [], concrete: [], shade: [], red: [],
    sage: [], track: [], grass: [], grassLight: [], marking: [] }
  const chairs: Chair[] = []
  const seatRed = new THREE.Color('#ad574b'), seatLight = new THREE.Color('#c27762')
  const seatIvory = new THREE.Color('#d8d7c6'), seatSage = new THREE.Color('#899c87')

  // A slim apron and the exposed inner bowl ground. All elevations and the
  // architectural profile are illustrative; OSM only supplies horizontal scale.
  band(batches.concrete, rx + 6, rz + 6, 0, 0, 0.2)
  band(batches.sage, rx * 0.60, rz * 0.66, 0, 0, 0.45)

  // Open ground-level entrance bays. Repeated slim outer ribs and horizontal
  // decks make the four concourses legible without one mesh per column.
  wall(batches.ivory, rx * 0.972, rz * 0.972, 0.5, 5.4, i => i % 8 === 0)
  wall(batches.shade, rx * 0.957, rz * 0.957, 1.0, 28.6)
  for (const y of [6.2, 13.5, 20.8, 28.2]) {
    band(batches.ivory, rx * 0.983, rz * 0.983, rx * 0.91, rz * 0.91, y)
    wall(batches.ivory, rx * 0.983, rz * 0.983, y - 0.65, y)
    band(batches.concrete, rx * 0.966, rz * 0.966, rx * 0.91, rz * 0.91, y + 0.12)
  }
  for (let i = 0; i < 144; i++) {
    const angle = i / 144 * TAU
    beam(batches.ivory, oval(rx * 0.964, rz * 0.964, 0.5, angle),
      oval(rx * 0.989, rz * 0.989, 31.9, angle), 0.82, 1.2)
  }

  // Four separated seating tiers, each with six coarse rows and an open
  // circulation ledge. This is a stylized bowl, not an actual seating inventory.
  const tiers = [
    { ix: .555, iz: .61, ox: .66, oz: .70, low: 2.2, high: 8.0 },
    { ix: .677, iz: .716, ox: .767, oz: .79, low: 9.1, high: 14.9 },
    { ix: .785, iz: .806, ox: .86, oz: .87, low: 16, high: 21.8 },
    { ix: .877, iz: .886, ox: .944, oz: .944, low: 22.9, high: 28.7 },
  ]
  tiers.forEach((tier, tierIndex) => {
    for (let row = 0; row < 6; row++) {
      const t = row / 6, next = (row + 1) / 6
      const innerX = rx * THREE.MathUtils.lerp(tier.ix, tier.ox, t)
      const innerZ = rz * THREE.MathUtils.lerp(tier.iz, tier.oz, t)
      const outerX = rx * THREE.MathUtils.lerp(tier.ix, tier.ox, next)
      const outerZ = rz * THREE.MathUtils.lerp(tier.iz, tier.oz, next)
      const y = THREE.MathUtils.lerp(tier.low, tier.high, next)
      const previousY = THREE.MathUtils.lerp(tier.low, tier.high, t)
      band(batches[tierIndex === 2 ? 'sage' : 'red'], outerX, outerZ, innerX, innerZ, y)
      wall(batches[tierIndex === 2 ? 'sage' : 'red'], innerX, innerZ, previousY, y)
      for (let aisle = 0; aisle < 32; aisle++) {
        const a = aisle / 32 * TAU, halfWidth = .007
        quad(batches.ivory, oval(outerX, outerZ, y + .18, a - halfWidth),
          oval(innerX, innerZ, y + .18, a - halfWidth),
          oval(innerX, innerZ, y + .18, a + halfWidth),
          oval(outerX, outerZ, y + .18, a + halfWidth))
      }
      const chairX = (outerX + innerX) / 2, chairZ = (outerZ + innerZ) / 2
      const count = tierIndex < 2 ? 512 : 640
      for (let seat = 0; seat < count; seat++) {
        const a = (seat + .5) / count * TAU
        // Clear 32 radial aisles; keep the seats out of the walking strips.
        const aislePhase = ((a / TAU * 32) % 1 + 1) % 1
        if (aislePhase < .055 || aislePhase > .945) continue
        const sector = Math.floor(a / TAU * 32)
        const color = sector % 8 === 0 ? seatIvory : tierIndex === 2 ? seatSage : row % 3 === 0 ? seatLight : seatRed
        chairs.push({ position: oval(chairX, chairZ, y + .06, a), yaw: Math.atan2(-chairX * Math.cos(a), -chairZ * Math.sin(a)), color })
      }
    }
    // Distinct circulation bands separate the tiers instead of one cone.
    band(batches.ivory, rx * (tier.ox + .012), rz * (tier.oz + .012), rx * tier.ox, rz * tier.oz, tier.high + .08)
  })

  // GBK's distinctive continuous oval roof with a large clear opening. The
  // profile is intentionally low-poly and unsurveyed. No geometry spans the hole.
  const roof = [
    { x: 1, z: 1, y: 32.0 }, { x: .965, z: .97, y: 33.3 },
    { x: .88, z: .90, y: 34.8 }, { x: .725, z: .79, y: 35.9 },
  ]
  for (let i = 0; i < roof.length - 1; i++) {
    const a = roof[i], b = roof[i + 1]
    band(batches.roof, rx * a.x, rz * a.z, rx * b.x, rz * b.z, a.y, b.y)
    band(batches.roofShade, rx * a.x, rz * a.z, rx * b.x, rz * b.z, a.y - .8, b.y - .8)
  }
  wall(batches.ivory, rx, rz, 31.2, 32)
  wall(batches.ivory, rx * .725, rz * .79, 35.1, 35.9)
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU
    for (let p = 0; p < roof.length - 1; p++) {
      const start = roof[p], end = roof[p + 1]
      beam(batches.roofShade, oval(rx * start.x, rz * start.z, start.y + .24, a),
        oval(rx * end.x, rz * end.z, end.y + .24, a), .28, .22)
    }
    if (i % 3 === 0) {
      beam(batches.ivory, oval(rx * .97, rz * .97, 28.3, a),
        oval(rx * .88, rz * .90, 34.0, a), .45)
    }
  }

  // Standard-sized illustrative football markings inside a capsule-shaped
  // athletics track. The pitch is 68 × 105 m; no venue dimensions were surveyed.
  const fieldScale = Math.min(1, rx / 115, rz / 145)
  const beforeField = Object.fromEntries(Object.entries(batches).map(([key, value]) => [key, value.length])) as Record<Surface, number>
  capsuleBand(batches.ivory, 48.2, 47.1, 42.2, .70)
  capsuleBand(batches.track, 47.1, 37.1, 42.2, .70)
  // With two zero-radius cap centres the band already fills the entire infield,
  // including its straight middle. Do not add a second coplanar rectangle.
  capsuleBand(batches.grass, 37.1, 0, 42.2, .70)
  for (let lane = 0; lane <= 8; lane++) capsuleBand(batches.marking, 37.1 + lane * 1.25 + .045, 37.1 + lane * 1.25 - .045, 42.2, .88)
  paintLine(batches.marking, [37.1, -20], [47.1, -20], 1.06, .13)
  for (let stripe = 0; stripe < 10; stripe++) {
    const z0 = -52.5 + stripe * 10.5, z1 = z0 + 10.5
    quad(batches[stripe % 2 ? 'grass' : 'grassLight'], [-34, 1, z0], [-34, 1, z1], [34, 1, z1], [34, 1, z0])
  }
  const paintY = 1.18
  const rectangle = (x0: number, x1: number, z0: number, z1: number, endLine = true) => {
    paintLine(batches.marking, [x0, z0], [x1, z0], paintY)
    paintLine(batches.marking, [x1, z0], [x1, z1], paintY)
    if (endLine) paintLine(batches.marking, [x1, z1], [x0, z1], paintY)
    paintLine(batches.marking, [x0, z1], [x0, z0], paintY)
  }
  rectangle(-34, 34, -52.5, 52.5)
  paintLine(batches.marking, [-34, 0], [34, 0], paintY)
  circle(batches.marking, 0, 0, 9.15, paintY, .18)
  circle(batches.marking, 0, 0, .16, paintY, .32)
  for (const side of [-1, 1]) {
    rectangle(-20.16, 20.16, side * 36, side * 52.5, false)
    rectangle(-9.16, 9.16, side * 47, side * 52.5, false)
    circle(batches.marking, 0, side * 41.5, .16, paintY, .32)
    const arc = Math.acos(5.5 / 9.15)
    circle(batches.marking, 0, side * 41.5, 9.15, paintY, .18,
      side < 0 ? Math.PI / 2 - arc : Math.PI * 1.5 - arc,
      side < 0 ? Math.PI / 2 + arc : Math.PI * 1.5 + arc)
    const goalZ = side * 52.7, backZ = side * 54.7
    for (const x of [-3.66, 3.66]) {
      beam(batches.marking, [x, 1.02, goalZ], [x, 3.46, goalZ], .13)
      beam(batches.marking, [x, 3.46, goalZ], [x, 3.08, backZ], .09)
      beam(batches.marking, [x, 1.02, backZ], [x, 3.08, backZ], .08)
    }
    beam(batches.marking, [-3.66, 3.46, goalZ], [3.66, 3.46, goalZ], .13)
    beam(batches.marking, [-3.66, 3.08, backZ], [3.66, 3.08, backZ], .08)
    for (let i = 1; i < 8; i++) {
      const x = -3.66 + i / 8 * 7.32
      beam(batches.marking, [x, 1.02, backZ], [x, 3.08, backZ], .025)
      beam(batches.marking, [x, 3.46, goalZ], [x, 3.08, backZ], .025)
    }
    for (const y of [1.69, 2.39]) beam(batches.marking, [-3.66, y, backZ], [3.66, y, backZ], .025)
  }
  // Only scale the illustrative pitch if a smaller venue pack is supplied.
  if (fieldScale !== 1) {
    for (const key of Object.keys(batches) as Surface[]) {
      for (let i = beforeField[key]; i < batches[key].length; i += 3) {
        batches[key][i] *= fieldScale
        batches[key][i + 2] *= fieldScale
      }
    }
  }

  const chairVertices: Buffer = []
  box(chairVertices, [0, .38, 0], [.59, .12, .48])
  box(chairVertices, [0, .67, -.22], [.59, .5, .10])
  return {
    surfaces: (Object.entries(batches) as [Surface, Buffer][]).filter(([, vertices]) => vertices.length).map(([name, vertices]) => ({ name, geometry: geometry(vertices) })),
    chairGeometry: geometry(chairVertices), chairs,
  }
}

function Seats({ chairs, shape }: { chairs: Chair[]; shape: THREE.BufferGeometry }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!mesh.current) return
    const object = new THREE.Object3D()
    chairs.forEach((chair, i) => {
      object.position.set(...chair.position)
      object.rotation.set(0, chair.yaw, 0)
      object.updateMatrix()
      mesh.current!.setMatrixAt(i, object.matrix)
      mesh.current!.setColorAt(i, chair.color)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [chairs])
  return <instancedMesh ref={mesh} args={[shape, undefined, chairs.length]} receiveShadow>
    <meshStandardMaterial roughness={.95} />
  </instancedMesh>
}

/** Fresh illustrative GBK architecture, fitted to the sourced OSM outline bounds.
 * Mapped horizontal bounds: 267.81 × 322.23 m for the supplied GBK pack.
 * All heights, tier/roof profiles, facade details and seats are unsurveyed.
 * Eleven batched material meshes + one seat instance draw; no HTML UI.
 */
export default function StadiumModel({ venue }: { venue: VenuePack }) {
  const dimensions = useMemo(() => {
    const xs = venue.stadiumOutline.map(p => p[0]), zs = venue.stadiumOutline.map(p => p[2])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, rx: (maxX - minX) / 2, rz: (maxZ - minZ) / 2 }
  }, [venue.stadiumOutline])
  const model = useMemo(() => makeModel(dimensions.rx, dimensions.rz), [dimensions.rx, dimensions.rz])
  useEffect(() => () => {
    model.surfaces.forEach(surface => surface.geometry.dispose())
    model.chairGeometry.dispose()
  }, [model])
  return <group name="GBK — illustrative architecture over mapped dimensions"
    position={[dimensions.cx, 0, dimensions.cz]}
    userData={{ basis: 'illustrative', heights: 'unsurveyed', footprintSource: venue.sourceUrl }}>
    {model.surfaces.map(surface => <mesh key={surface.name} geometry={surface.geometry}
      receiveShadow castShadow={['ivory', 'roof', 'roofShade'].includes(surface.name)}>
      <meshStandardMaterial color={colors[surface.name]} roughness={surface.name === 'roof' ? .78 : .94} side={THREE.DoubleSide} />
    </mesh>)}
    <Seats chairs={model.chairs} shape={model.chairGeometry} />
  </group>
}
