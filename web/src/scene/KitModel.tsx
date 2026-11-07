import { useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { KitPreset, Placement, SceneProps } from '../simulation/types'

type V3 = [number, number, number]
type Finish = 'fabric' | 'metal' | 'dark' | 'plastic' | 'accent'
type Parts = Record<Finish, THREE.BufferGeometry[]>
const finishes: Finish[] = ['fabric', 'metal', 'dark', 'plastic', 'accent']

// Dimensions come from the catalogue; small construction details are illustrative.
// Local X is width, local Z is depth, Y is vertical. Every part stays inside the footprint.
function geometryFor(preset: KitPreset, bayCount: number) {
  const w = preset.widthM, h = preset.heightM
  const d = preset.kind === 'roder' ? bayCount * (preset.bayLengthM ?? preset.depthM) : preset.depthM
  const parts: Parts = { fabric: [], metal: [], dark: [], plastic: [], accent: [] }
  const add = (finish: Finish, source: THREE.BufferGeometry) => {
    const geometry = source.index ? source.toNonIndexed() : source
    if (geometry !== source) source.dispose()
    geometry.deleteAttribute('uv')
    parts[finish].push(geometry)
  }
  const box = (finish: Finish, size: V3, position: V3) => add(finish,
    new THREE.BoxGeometry(...size).translate(...position))
  const beam = (finish: Finish, from: V3, to: V3, radius: number, sides = 8) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to)
    const direction = b.clone().sub(a)
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), sides)
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()))
    geometry.translate(...a.add(b).multiplyScalar(0.5).toArray() as V3)
    add(finish, geometry)
  }
  const sheet = (finish: Finish, a: V3, b: V3, c: V3, e: V3) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...e], 3))
    geometry.computeVertexNormals()
    add(finish, geometry)
  }

  if (preset.kind === 'pagoda') {
    const eave = preset.eaveM ?? h * 0.65
    const corners: V3[] = [[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2]]
    // A concave tensile profile, constructed as four curved triangular panels.
    for (let face = 0; face < 4; face++) {
      const a = corners[face], b = corners[(face + 1) % 4]
      const point = (corner: V3, t: number): V3 => [corner[0] * (1 - t), eave + (h - eave) * t ** 1.65, corner[2] * (1 - t)]
      for (let step = 0; step < 14; step++) {
        const t = step / 14, next = (step + 1) / 14
        sheet('fabric', point(a, t), point(b, t), point(b, next), point(a, next))
      }
      const x = a[0] * 0.965, z = a[2] * 0.965
      box('metal', [0.065, eave, 0.065], [x, eave / 2, z])
      box('metal', [0.13, 0.018, 0.13], [x, 0.009, z])
      const next = corners[(face + 1) % 4]
      beam('metal', [x, eave - 0.08, z], [next[0] * 0.965, eave - 0.08, next[2] * 0.965], 0.026)
      // Narrow fabric seam runs up each hip, keeping the curved silhouette legible.
      for (let step = 0; step < 10; step++) beam('plastic', point(a, step / 10), point(a, (step + 1) / 10), 0.009, 5)
    }
    box('fabric', [w, 0.18, 0.018], [0, eave - 0.09, -d / 2 + 0.009])
    box('fabric', [w, 0.18, 0.018], [0, eave - 0.09, d / 2 - 0.009])
    box('fabric', [0.018, 0.18, d], [-w / 2 + 0.009, eave - 0.09, 0])
    box('fabric', [0.018, 0.18, d], [w / 2 - 0.009, eave - 0.09, 0])
  } else if (preset.kind === 'roder') {
    const eave = preset.eaveM ?? h * 0.8
    const frameX = w / 2 - 0.075, endZ = d / 2 - 0.065
    // Open sides reveal the portal frames and their 5 m bay rhythm.
    for (let bay = 0; bay <= bayCount; bay++) {
      const z = -endZ + 2 * endZ * bay / bayCount
      for (const sign of [-1, 1]) {
        box('metal', [0.12, eave - 0.06, 0.12], [sign * frameX, (eave - 0.06) / 2, z])
        box('metal', [0.25, 0.022, 0.22], [sign * (w / 2 - 0.125), 0.011, z])
        beam('metal', [sign * frameX, eave - 0.08, z], [0, h - 0.08, z], 0.062)
        beam('metal', [sign * frameX, eave - 0.82, z], [sign * (frameX - 0.85), eave + (h - eave) * 0.17 - 0.09, z], 0.031)
      }
      // Fine roof seam above the structural frame.
      beam('plastic', [-w / 2 + 0.01, eave, z], [0, h - 0.012, z], 0.012)
      beam('plastic', [0, h - 0.012, z], [w / 2 - 0.01, eave, z], 0.012)
    }
    for (const sign of [-1, 1]) {
      sheet('fabric', [0, h, -d / 2], [sign * w / 2, eave, -d / 2], [sign * w / 2, eave, d / 2], [0, h, d / 2])
      box('fabric', [0.025, 0.2, d], [sign * (w / 2 - 0.0125), eave - 0.1, 0])
      beam('metal', [sign * frameX, eave - 0.08, -endZ], [sign * frameX, eave - 0.08, endZ], 0.04)
      beam('metal', [sign * w / 4, (h + eave) / 2 - 0.07, -endZ], [sign * w / 4, (h + eave) / 2 - 0.07, endZ], 0.03)
    }
    beam('metal', [0, h - 0.08, -endZ], [0, h - 0.08, endZ], 0.04)
  } else if (preset.kind === 'rowing') {
    const rail = 0.018, left = -w / 2 + 0.055, right = w / 2 - 0.055
    const top = h - rail, lower = 0.22
    beam('metal', [left, top, 0], [right, top, 0], rail)
    beam('metal', [left, lower, 0], [right, lower, 0], rail)
    beam('metal', [left, 0.035, 0], [left, top, 0], rail)
    beam('metal', [right, 0.035, 0], [right, top, 0], rail)
    const uprights = 15
    for (let bar = 1; bar <= uprights; bar++) {
      const x = left + (right - left) * bar / (uprights + 1)
      beam('metal', [x, lower, 0], [x, top, 0], 0.008, 6)
    }
    for (const x of [left + 0.17, right - 0.17]) {
      beam('metal', [x, 0.025, -d / 2 + 0.018], [x, 0.025, d / 2 - 0.018], 0.018)
      beam('metal', [x, 0.025, 0], [x, lower, 0], 0.014)
    }
    // Male hooks and female receiver loops at both connection heights.
    for (const y of [0.42, 0.86]) {
      beam('metal', [right, y, 0], [w / 2 - 0.009, y, 0], 0.009)
      beam('metal', [w / 2 - 0.009, y, 0], [w / 2 - 0.009, y - 0.05, 0], 0.009)
      const loop = new THREE.TorusGeometry(0.025, 0.007, 5, 10)
      loop.rotateX(Math.PI / 2).translate(left - 0.025, y, 0)
      add('metal', loop)
    }
  } else if (preset.kind === 'table') {
    const thickness = 0.043, radius = 0.045
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2 + radius, -d / 2)
    shape.lineTo(w / 2 - radius, -d / 2).quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + radius)
    shape.lineTo(w / 2, d / 2 - radius).quadraticCurveTo(w / 2, d / 2, w / 2 - radius, d / 2)
    shape.lineTo(-w / 2 + radius, d / 2).quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - radius)
    shape.lineTo(-w / 2, -d / 2 + radius).quadraticCurveTo(-w / 2, -d / 2, -w / 2 + radius, -d / 2)
    const top = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 5 })
    top.rotateX(-Math.PI / 2).translate(0, h - thickness, 0)
    add('plastic', top)
    box('dark', [0.002, 0.001, d - 0.04], [0, h - 0.0005, 0])
    for (const side of [-1, 1]) {
      const x = side * w * 0.31, footX = side * w * 0.34
      for (const end of [-1, 1]) {
        beam('dark', [x, h - thickness - 0.025, end * d * 0.27], [footX, 0.03, end * d * 0.36], 0.016)
        box('dark', [0.045, 0.035, 0.045], [footX, 0.0175, end * d * 0.36])
      }
      beam('dark', [footX, 0.12, -d * 0.35], [footX, 0.12, d * 0.35], 0.014)
      beam('metal', [side * w * 0.04, h - 0.06, 0], [footX, h * 0.4, 0], 0.01)
    }
    for (const sign of [-1, 1]) beam('dark', [-w * 0.41, h - 0.07, sign * d * 0.29], [w * 0.41, h - 0.07, sign * d * 0.29], 0.014)
  } else if (preset.kind === 'detector') {
    const panel = Math.min(0.065, w * 0.075), head = 0.14
    for (const sign of [-1, 1]) {
      const x = sign * (w / 2 - panel / 2)
      box('plastic', [panel, h - head, d * 0.82], [x, (h - head) / 2, 0])
      box('dark', [panel, 0.06, d], [x, 0.03, 0])
      box('dark', [panel * 0.28, h - head - 0.14, 0.018], [x - sign * panel * 0.34, (h - head) / 2, -d * 0.41 + 0.009])
      for (let marker = 0; marker < 12; marker++) box('accent', [0.006, 0.024, 0.006], [x - sign * (panel / 2 - 0.003), 0.16 + marker * (h - 0.4) / 12, -d * 0.32])
    }
    box('plastic', [w, head, d * 0.82], [0, h - head / 2, 0])
    box('dark', [w * 0.53, head * 0.57, 0.008], [0, h - head / 2, -d * 0.41 - 0.004])
    box('accent', [w * 0.2, 0.028, 0.009], [-w * 0.085, h - head / 2, -d * 0.41 - 0.009])
    for (let button = 0; button < 3; button++) box('metal', [0.015, 0.015, 0.009], [w * (0.11 + button * 0.035), h - head / 2, -d * 0.41 - 0.009])
  }

  const merged = finishes.flatMap(finish => {
    if (parts[finish].length === 0) return []
    const geometry = mergeGeometries(parts[finish], false)!
    parts[finish].forEach(part => part.dispose())
    return [{ finish, geometry }]
  })
  return { merged, width: w, depth: d }
}

export default function KitModel({ preset, placement, selected, onSelect }: {
  preset: KitPreset; placement: Placement; selected: boolean; onSelect: SceneProps['onSelect']
}) {
  const bays = Math.max(1, Math.floor(placement.bays ?? 1))
  const model = useMemo(() => geometryFor(preset, bays), [preset, bays])
  useEffect(() => () => model.merged.forEach(part => part.geometry.dispose()), [model])
  const materials: Record<Finish, { color: string; roughness: number; metalness: number }> = {
    fabric: { color: '#f6f5ef', roughness: 0.88, metalness: 0 },
    metal: { color: '#b2bac0', roughness: 0.36, metalness: 0.7 },
    dark: { color: '#3d4851', roughness: 0.52, metalness: 0.35 },
    plastic: { color: '#e6e7df', roughness: 0.62, metalness: 0.02 },
    accent: { color: '#68bda8', roughness: 0.4, metalness: 0.05 },
  }
  return <group position={[...placement.position]} rotation={[0, placement.yawDeg * Math.PI / 180, 0]}
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(placement.id) }}>
    {model.merged.map(({ finish, geometry }) => <mesh key={finish} geometry={geometry} castShadow receiveShadow dispose={null}>
      <meshStandardMaterial {...materials[finish]} side={finish === 'fabric' ? THREE.DoubleSide : THREE.FrontSide} />
    </mesh>)}
    {selected && <group position={[0, 0.025, 0]}>
      {[-1, 1].map(sign => <group key={sign}>
        <mesh position={[0, 0, sign * model.depth / 2]}><boxGeometry args={[model.width + 0.06, 0.025, 0.04]} /><meshBasicMaterial color="#3158db" /></mesh>
        <mesh position={[sign * model.width / 2, 0, 0]}><boxGeometry args={[0.04, 0.025, model.depth + 0.06]} /><meshBasicMaterial color="#3158db" /></mesh>
      </group>)}
    </group>}
  </group>
}
