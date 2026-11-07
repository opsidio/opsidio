import { useEffect, useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three'
import type { Point } from '../simulation/types'

export type AdmissionFootprint = { id: string; width: number; spine: readonly Point[] }

/** Only show an authored operating envelope where it exceeds the underlying map ribbon. */
export function admissionFootprints(plan: unknown): AdmissionFootprint[] {
  const areas = (plan as { spatial_context?: { entry_areas?: unknown } })?.spatial_context?.entry_areas
  if (!Array.isArray(areas)) return []
  return areas.flatMap(area => {
    const width = area?.corridor?.illustrative_width_m, mapped = area?.corridor?.rendered_width_m
    const spine = area?.corridor?.spine_points_m
    if (typeof area?.id !== 'string' || !Number.isFinite(width) || !Number.isFinite(mapped) || width <= mapped || width > 40
      || !Array.isArray(spine) || spine.length < 2 || !spine.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) return []
    return [{ id: area.id, width, spine: spine as Point[] }]
  })
}

function footprintGeometry({ width, spine }: AdmissionFootprint) {
  const vertices: number[] = [], triangles: number[] = []
  const normal = (a: Point, b: Point) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz) || 1
    return [dz / length, -dx / length]
  }
  for (let i = 0; i < spine.length; i++) {
    const p = spine[i], before = normal(spine[Math.max(i - 1, 0)], i ? p : spine[i + 1]), after = normal(i === spine.length - 1 ? spine[i - 1] : p, spine[Math.min(i + 1, spine.length - 1)])
    const amount = width / (2 * Math.max(0.5, 1 + before[0] * after[0] + before[1] * after[1]))
    const x = (before[0] + after[0]) * amount, z = (before[1] + after[1]) * amount
    vertices.push(p[0] + x, 0.018, p[2] + z, p[0] - x, 0.018, p[2] - z)
    if (i) { const left = (i - 1) * 2; triangles.push(left, left + 1, left + 2, left + 1, left + 3, left + 2) }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setIndex(triangles)
  return geometry
}

export default function AdmissionFootprints({ footprints }: { footprints: readonly AdmissionFootprint[] }) {
  const meshes = useMemo(() => footprints.map(item => ({ id: item.id, geometry: footprintGeometry(item) })), [footprints])
  useEffect(() => () => meshes.forEach(item => item.geometry.dispose()), [meshes])
  return <group name="proposed-admission-footprints">
    {meshes.map(({ id, geometry }) => <mesh key={id} geometry={geometry} renderOrder={-540}>
      <meshBasicMaterial color="#d4b775" transparent opacity={0.25} side={DoubleSide} depthWrite={false} />
    </mesh>)}
  </group>
}
