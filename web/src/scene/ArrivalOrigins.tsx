import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Point } from '../simulation/types'

export type ArrivalOriginMarker = {
  id: string
  label: string
  mode: string
  position: Point
  attendees: number
  sourceUrl?: string
  basis?: string
}
const colors: Record<string, string> = {
  mrt: '#775bb1',
  parking: '#3f83ae',
  taxi_ride_hailing: '#bc743d',
}

export default function ArrivalOrigins({ origins, showLabels }: {
  origins: readonly ArrivalOriginMarker[]
  showLabels: boolean
}) {
  const firstFrame = useRef(true)
  const [ready, setReady] = useState(false)
  useFrame(() => {
    if (!firstFrame.current) return
    firstFrame.current = false
    setReady(true)
  })
  return <group name="transport-arrival-origins">
    {origins.map(origin => {
      const color = colors[origin.mode] ?? '#567b6b'
      const dropoff = origin.mode === 'taxi_ride_hailing'
      const offset = dropoff ? 'translate(-130px, -68px)' : origin.mode === 'mrt' ? 'translate(-140px, 10px)' : 'translate(-40px, -50px)'
      return <group key={origin.id} position={[...origin.position]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .18, 0]}>
          <ringGeometry args={[2.8, 4.2, 24]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={[0, 2, 0]}>
          <cylinderGeometry args={[.35, .35, 4, 6]} />
          <meshBasicMaterial color={color} />
        </mesh>
        {ready && showLabels && <Html position={[0, 5, 0]} zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
          <div className="arrival-origin-label" style={{ borderTopColor: color, transform: offset }}>
            <strong>{dropoff ? 'Taxi & ride-hailing drop-off' : origin.label}</strong>
            <span>{origin.attendees.toLocaleString()} planned arrivals</span>
            <small>{dropoff ? 'Taxi / GoCar / GoRide / GrabCar / GrabBike' : origin.mode === 'mrt' ? 'Station exit → assigned entry gate' : 'Parked visitors → assigned entry gate'}</small>
          </div>
        </Html>}
      </group>
    })}
  </group>
}
