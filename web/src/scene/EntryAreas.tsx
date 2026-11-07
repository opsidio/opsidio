import { Html } from '@react-three/drei'
import type { EntryAreaMarker } from '../simulation/types'

/** Proposed admission-area anchors; exact processing and access geometry is pending. */
export default function EntryAreas({ areas }: { areas: readonly EntryAreaMarker[] }) {
  return <group name="proposed-admission-areas">
    {areas.map(area => <group key={area.id} position={[...area.position]}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[2.5, 2.5, 0.35, 24]} />
        <meshBasicMaterial color={area.color} />
      </mesh>
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 9.5, 8]} />
        <meshBasicMaterial color={area.color} />
      </mesh>
      <Html position={[0, 13, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="entry-area-label" style={{ borderTopColor: area.color }}>
          <strong>{area.label}</strong>
          <span>{area.attendees.toLocaleString('en-US')} demo arrivals</span>
          <small>Proposed anchor</small>
        </div>
      </Html>
    </group>)}
  </group>
}
