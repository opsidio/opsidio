import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { EntryAreaMarker, KitPreset, Placement, Point } from '../simulation/types'

export type OperationsOperator = {
  id: string
  label: string
  roleId: string
  pointId: string
  entryAreaId: string
  /** Already resolved from the JSON attachment by the plan adapter; metres, ground Y = 0. */
  position: Point
  roleName?: string
  yawDeg?: number
  attachment?: { placementId: string; offset: Point }
}
export type OperationsRole = 'scan' | 'security' | 'help' | 'other'
export type OperationsLayerProps = {
  operators: readonly OperationsOperator[]
  placements: readonly Placement[]
  catalogue: readonly KitPreset[]
  entryAreas?: readonly EntryAreaMarker[]
  showLabels?: boolean
  showLayoutOverlay?: boolean
  labelMode?: 'auto' | 'overview' | 'detail'
  /** Explicit display aid only. False keeps normal roof/wall occlusion. */
  staffThroughCanopies?: boolean
  /** Screen-space displacement when a host already shows entry-area labels. */
  areaLabelOffsetPx?: number
}

export const OPERATIONS_ROLES: Record<OperationsRole, { label: string; color: string }> = {
  scan: { label: 'Ticket scan', color: '#2867d5' },
  security: { label: 'Security', color: '#cd493d' },
  help: { label: 'Help', color: '#188565' },
  other: { label: 'Staff', color: '#8861ad' },
}
export function operationsRole(value: string): OperationsRole {
  if (/secur|guard|screen/i.test(value)) return 'security'
  if (/help|exception|support/i.test(value)) return 'help'
  if (/scan|ticket|check.?in|admission/i.test(value)) return 'scan'
  return 'other'
}
const operatorRole = (operator: OperationsOperator) => operationsRole(`${operator.roleId} ${operator.roleName ?? ''}`)
const noRaycast = () => {}
const localToWorld = (placement: Placement, x: number, y: number, z: number): [number, number, number] => {
  const angle = placement.yawDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return [placement.position[0] + c * x + s * z, placement.position[1] + y, placement.position[2] - s * x + c * z]
}
const distanceSquared = (a: Point, b: Point) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2

type StaffFinish = 'uniform' | 'skin' | 'vest' | 'reflective'
/** Shared low-poly geometry. Shoes start at Y=0; the head ends at exactly 1.70 m. */
function staffGeometry(): Record<StaffFinish, THREE.BufferGeometry> {
  const parts: Record<StaffFinish, THREE.BufferGeometry[]> = { uniform: [], skin: [], vest: [], reflective: [] }
  const box = (finish: StaffFinish, w: number, h: number, d: number, x: number, y: number, z = 0) => {
    const geometry = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed()
    geometry.deleteAttribute('uv'); parts[finish].push(geometry)
  }
  for (const sign of [-1, 1]) {
    box('uniform', 0.14, 0.09, 0.26, sign * 0.105, 0.045, -0.025)
    box('uniform', 0.14, 0.8, 0.17, sign * 0.105, 0.48)
    box('uniform', 0.11, 0.46, 0.15, sign * 0.275, 1.14)
    box('skin', 0.10, 0.13, 0.12, sign * 0.275, 0.86)
    box('reflective', 0.045, 0.4, 0.258, sign * 0.13, 1.23)
  }
  box('vest', 0.44, 0.55, 0.25, 0, 1.16)
  box('reflective', 0.446, 0.05, 0.258, 0, 1.11)
  box('skin', 0.11, 0.12, 0.11, 0, 1.44)
  const head = new THREE.SphereGeometry(0.14, 8, 6).translate(0, 1.56, 0).toNonIndexed()
  head.deleteAttribute('uv'); parts.skin.push(head)
  return Object.fromEntries(Object.entries(parts).map(([finish, geometries]) => {
    const geometry = mergeGeometries(geometries, false)!
    geometries.forEach(part => part.dispose())
    return [finish, geometry]
  })) as Record<StaffFinish, THREE.BufferGeometry>
}

function StaffInstances({ operators, throughCanopies }: { operators: readonly OperationsOperator[]; throughCanopies: boolean }) {
  const geometries = useMemo(staffGeometry, [])
  const uniform = useRef<THREE.InstancedMesh>(null), skin = useRef<THREE.InstancedMesh>(null)
  const vest = useRef<THREE.InstancedMesh>(null), reflective = useRef<THREE.InstancedMesh>(null)
  useEffect(() => () => Object.values(geometries).forEach(geometry => geometry.dispose()), [geometries])
  useLayoutEffect(() => {
    const matrix = new THREE.Object3D(), color = new THREE.Color()
    for (const [index, operator] of operators.entries()) {
      matrix.position.set(...operator.position)
      matrix.rotation.set(0, (operator.yawDeg ?? 0) * Math.PI / 180, 0)
      matrix.updateMatrix()
      for (const mesh of [uniform.current, skin.current, vest.current, reflective.current]) mesh?.setMatrixAt(index, matrix.matrix)
      vest.current?.setColorAt(index, color.set(OPERATIONS_ROLES[operatorRole(operator)].color))
    }
    for (const mesh of [uniform.current, skin.current, vest.current, reflective.current]) if (mesh) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [operators])
  const depth = { depthTest: !throughCanopies, depthWrite: !throughCanopies }
  return <group name="stationary-operations-staff" userData={{ operatorCount: operators.length, heightM: 1.7 }}>
    <instancedMesh ref={uniform} args={[geometries.uniform, undefined, operators.length]} raycast={noRaycast} renderOrder={30} castShadow dispose={null}>
      <meshStandardMaterial color="#253346" roughness={0.86} {...depth} />
    </instancedMesh>
    <instancedMesh ref={skin} args={[geometries.skin, undefined, operators.length]} raycast={noRaycast} renderOrder={31} castShadow dispose={null}>
      <meshStandardMaterial color="#b98261" roughness={0.92} {...depth} />
    </instancedMesh>
    <instancedMesh ref={vest} args={[geometries.vest, undefined, operators.length]} raycast={noRaycast} renderOrder={32} castShadow dispose={null}>
      <meshStandardMaterial color="#ffffff" roughness={0.75} {...depth} />
    </instancedMesh>
    <instancedMesh ref={reflective} args={[geometries.reflective, undefined, operators.length]} raycast={noRaycast} renderOrder={33} dispose={null}>
      <meshStandardMaterial color="#f1f6d9" roughness={0.58} {...depth} />
    </instancedMesh>
  </group>
}

export type OperationsCheckpoint = { placement: Placement; preset: KitPreset; role: OperationsRole; operators: OperationsOperator[] }
/** Explicit tent attachment wins. Equipment attachments use the nearest matching canopy within 25 m. */
export function operationsCheckpoints(operators: readonly OperationsOperator[], placements: readonly Placement[], catalogue: readonly KitPreset[]): OperationsCheckpoint[] {
  const presets = new Map(catalogue.map(preset => [preset.id, preset]))
  const checkpoints = placements.flatMap(placement => {
    const preset = presets.get(placement.presetId)
    return preset && (preset.kind === 'roder' || preset.kind === 'pagoda')
      ? [{ placement, preset, role: operationsRole(`${placement.id} ${placement.label}`), operators: [] as OperationsOperator[] }] : []
  })
  for (const operator of operators) {
    const explicit = checkpoints.find(checkpoint => checkpoint.placement.id === operator.attachment?.placementId)
    const nearby = checkpoints.filter(checkpoint => checkpoint.role === operatorRole(operator) && distanceSquared(checkpoint.placement.position, operator.position) <= 25 ** 2)
      .sort((a, b) => distanceSquared(a.placement.position, operator.position) - distanceSquared(b.placement.position, operator.position))
    const checkpoint = explicit ?? nearby[0]
    checkpoint?.operators.push(operator)
  }
  return checkpoints
}

function useDetailLabels(mode: OperationsLayerProps['labelMode'], positions: readonly Point[]) {
  const { camera, size } = useThree()
  const [detail, setDetail] = useState(mode === 'detail')
  const elapsed = useRef(1)
  useFrame((_, delta) => {
    elapsed.current += delta
    if (elapsed.current < 0.2) return
    elapsed.current = 0
    if (mode !== 'auto') { setDetail(mode === 'detail'); return }
    let pixelsPerMetre = 0
    if (camera instanceof THREE.OrthographicCamera) pixelsPerMetre = size.height * camera.zoom / (camera.top - camera.bottom)
    else if (camera instanceof THREE.PerspectiveCamera && positions.length) {
      const nearestDistance = Math.max(1, Math.min(...positions.map(point => camera.position.distanceTo(new THREE.Vector3(...point)))))
      pixelsPerMetre = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * nearestDistance)
    }
    setDetail(previous => pixelsPerMetre >= (previous ? 3.5 : 4.5))
  })
  return detail
}

const labelStyle: CSSProperties = { pointerEvents: 'none', whiteSpace: 'nowrap', fontFamily: 'Inter, system-ui, sans-serif', color: '#223c46', background: '#fffffff0', border: '1px solid #dce4e2', borderRadius: 5, padding: '5px 8px', boxShadow: '0 2px 8px #173b3720', textAlign: 'center' }

/** Render inside GbkCanvas children. Inputs are the same reviewed JSON used by the preview. */
export default function OperationsLayer({ operators, placements, catalogue, entryAreas = [], showLabels = true,
  showLayoutOverlay = true, labelMode = 'auto', staffThroughCanopies = false, areaLabelOffsetPx = 0 }: OperationsLayerProps) {
  const checkpoints = useMemo(() => operationsCheckpoints(operators, placements, catalogue), [operators, placements, catalogue])
  const anchors = useMemo(() => checkpoints.map(checkpoint => checkpoint.placement.position), [checkpoints])
  const detail = useDetailLabels(labelMode, anchors)
  const presets = useMemo(() => new Map(catalogue.map(preset => [preset.id, preset])), [catalogue])
  const barriers = useMemo(() => placements.filter(placement => presets.get(placement.presetId)?.kind === 'rowing'), [placements, presets])
  const railSegments = useMemo(() => barriers.flatMap(placement => {
    const preset = presets.get(placement.presetId)!
    return [localToWorld(placement, -preset.widthM / 2, preset.heightM + 0.025, 0), localToWorld(placement, preset.widthM / 2, preset.heightM + 0.025, 0)]
  }), [barriers, presets])
  const footprintSegments = useMemo(() => checkpoints.flatMap(({ placement, preset }) => {
    const w = preset.widthM / 2, d = (preset.kind === 'roder' ? (placement.bays ?? 1) * (preset.bayLengthM ?? preset.depthM) : preset.depthM) / 2
    const corners = [[-w, -d], [w, -d], [w, d], [-w, d]]
    return corners.flatMap((corner, index) => [localToWorld(placement, corner[0], 0.035, corner[1]), localToWorld(placement, corners[(index + 1) % 4][0], 0.035, corners[(index + 1) % 4][1])])
  }), [checkpoints])
  const areas = useMemo(() => entryAreas.map(area => {
    const assigned = operators.filter(operator => operator.entryAreaId === area.id)
    const counts = { scan: 0, security: 0, help: 0, other: 0 }
    assigned.forEach(operator => { counts[operatorRole(operator)]++ })
    const barrierCount = barriers.filter(placement => [...entryAreas].sort((a, b) => distanceSquared(a.position, placement.position) - distanceSquared(b.position, placement.position))[0]?.id === area.id).length
    return { area, counts, total: assigned.length, barrierCount }
  }), [entryAreas, operators, barriers])

  return <group name="operations-layer">
    {operators.length > 0 && <StaffInstances operators={operators} throughCanopies={staffThroughCanopies} />}
    {showLayoutOverlay && railSegments.length > 0 && <Line name="rowing-barrier-rail-guides" points={railSegments} segments color="#254350" lineWidth={detail ? 2 : 1.5} raycast={noRaycast} renderOrder={8} />}
    {showLayoutOverlay && detail && footprintSegments.length > 0 && <Line name="checkpoint-footprint-guides" points={footprintSegments} segments color="#537887" lineWidth={1} transparent opacity={0.6} raycast={noRaycast} renderOrder={7} />}
    {showLabels && detail && checkpoints.map(({ placement, preset, role, operators: assigned }) => {
      const depth = preset.kind === 'roder' ? (placement.bays ?? 1) * (preset.bayLengthM ?? preset.depthM) : preset.depthM
      const color = OPERATIONS_ROLES[role].color
      return <Html key={placement.id} position={localToWorld(placement, 0, (preset.eaveM ?? preset.heightM) + 0.3, -depth / 2 - 0.5)} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div data-operations-checkpoint={placement.id} style={{ ...labelStyle, borderTop: `3px solid ${color}`, padding: '3px 6px' }}>
          <strong style={{ display: 'block', fontSize: 10, color }}>{role === 'other' ? placement.label : OPERATIONS_ROLES[role].label}</strong>
          <span style={{ display: 'block', fontSize: 9, marginTop: 1 }}>{assigned.length} {assigned.length === 1 ? 'operator' : 'operators'}</span>
        </div>
      </Html>
    })}
    {showLabels && !detail && areas.filter(item => item.total > 0 || item.barrierCount > 0).map(({ area, counts, total, barrierCount }) =>
      <Html key={area.id} position={[area.position[0], area.position[1] + 6, area.position[2]]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div data-operations-area={area.id} style={{ ...labelStyle, transform: `translateY(${areaLabelOffsetPx}px)`, borderTop: `3px solid ${area.color}` }}>
          <strong style={{ display: 'block', fontSize: 10 }}>{area.label} · {total} staff</strong>
          <span style={{ display: 'flex', gap: 7, marginTop: 3, fontSize: 9 }}>
            <span style={{ color: OPERATIONS_ROLES.scan.color }}>{counts.scan} scan</span>
            <span style={{ color: OPERATIONS_ROLES.security.color }}>{counts.security} security</span>
            <span style={{ color: OPERATIONS_ROLES.help.color }}>{counts.help} help</span>
            {counts.other > 0 && <span>{counts.other} other</span>}
          </span>
          <small style={{ display: 'block', marginTop: 3, color: '#6f8186', fontSize: 8 }}>{barrierCount} barrier panels · zoom to inspect</small>
        </div>
      </Html>)}
  </group>
}
