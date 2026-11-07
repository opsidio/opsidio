import { useLayoutEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { AgentJourney, ServiceStop } from '../simulation/runtime-types'
import type { Point } from '../simulation/types'
import { sampleJourneyPosition, sampleJourneyWaitSeconds, sampleWalkingCrowd } from '../simulation/abm/sampling'
import type { JourneyPhase, JourneySampler } from '../simulation/abm/sampling'

const EYE_HEIGHT_M = 1.62
const DEFAULT_VISIBLE_LIMIT = 5000

export type FirstPersonStatus = {
  journeyIndex: number
  phase: JourneyPhase | 'waiting-off-scene'
  waitSeconds: number
  position: Point | null
  stationId: string | null
  nextNodeId: string | null
}

/** Choose from the same visible pool as CrowdPreview at the current playback time. */
export function pickVisibleJourney(sampler: JourneySampler, seconds: number, excludeIndex?: number | null, maxVisible = DEFAULT_VISIBLE_LIMIT): number | null {
  if (!Number.isFinite(seconds) || !Number.isFinite(maxVisible)) return null
  const capacity = Math.max(0, Math.min(sampler.count, Math.floor(maxVisible)))
  if (!capacity) return null
  const indices = new Uint32Array(capacity)
  const { visibleCount } = sampleWalkingCrowd(sampler, seconds, new Float32Array(capacity * 3), indices)
  const candidates = indices.subarray(0, visibleCount)
  const excludedSlot = excludeIndex == null ? -1 : candidates.indexOf(excludeIndex)
  const selectable = visibleCount - Number(excludedSlot >= 0)
  if (!selectable) return null
  const slot = Math.floor(Math.random() * selectable)
  return candidates[excludedSlot >= 0 && slot >= excludedSlot ? slot + 1 : slot]
}

function activeStop(journey: AgentJourney, seconds: number): ServiceStop | null {
  for (const stop of journey.serviceStops ?? []) {
    if (seconds < stop.arrivalSeconds) break
    if (stop.endSeconds === null || seconds < stop.endSeconds) return stop
  }
  return null
}

function isVisibleWait(sampler: JourneySampler, stop: ServiceStop | null): boolean {
  if (!stop) return false
  // Position sampling already updated this queue to the current playback time.
  const queue = sampler.queues?.get(stop.stationId)
  if (!queue?.pen) return false
  const rank = stop.queueIndex - queue.started
  return rank >= 0 && rank < queue.pen.visibleCount
}

/** Find the local route direction from the sampled position, including while stationary. */
function faceRoute(journey: AgentJourney, position: Float64Array, direction: Vector3): string | null {
  let nearest = Infinity
  let nextNodeId = journey.routeNodeIds[0] ?? null
  for (let index = 1; index < journey.points.length; index++) {
    const previous = journey.points[index - 1], next = journey.points[index]
    const dx = next[0] - previous[0], dz = next[2] - previous[2]
    const lengthSquared = dx * dx + dz * dz
    if (!lengthSquared) continue
    const x = position[0] - previous[0], z = position[2] - previous[2]
    const fraction = Math.min(1, Math.max(0, (x * dx + z * dz) / lengthSquared))
    const distance = (x - fraction * dx) ** 2 + (z - fraction * dz) ** 2
    if (distance > nearest) continue
    nearest = distance
    nextNodeId = journey.routeNodeIds[index] ?? null
    direction.set(dx, 0, dz).normalize()
  }
  return nextNodeId
}

type FirstPersonFollowProps = {
  sampler: JourneySampler
  journeyIndex: number
  journey: AgentJourney
  clockRef: { current: number }
  followCamera: boolean
  onStatus: (status: FirstPersonStatus) => void
}

/** Samples the selected attendee and takes camera ownership only in first-person view. */
export default function FirstPersonFollow({ sampler, journeyIndex, journey, clockRef, followCamera, onStatus }: FirstPersonFollowProps) {
  const get = useThree(state => state.get)
  const set = useThree(state => state.set)
  const { width, height } = useThree(state => state.size)
  const camera = useMemo(() => new PerspectiveCamera(66, 1, 0.05, 2600), [])
  const sample = useMemo(() => ({
    position: new Float64Array(3), direction: new Vector3(0, 0, -1), lookAt: new Vector3(),
    seconds: NaN, phase: 'not-arrived' as FirstPersonStatus['phase'], stationId: null as string | null,
    nextNodeId: null as string | null, pending: false, notifiedPhase: null as FirstPersonStatus['phase'] | null,
    notifiedStation: null as string | null, lastNotification: -Infinity,
  }), [sampler, journeyIndex, journey, followCamera])

  useLayoutEffect(() => {
    if (!followCamera) return
    const previous = get().camera
    camera.position.copy(previous.position)
    camera.quaternion.copy(previous.quaternion)
    set({ camera })
    return () => { if (get().camera === camera) set({ camera: previous }) }
  }, [camera, followCamera, get, set])

  useLayoutEffect(() => {
    camera.aspect = Math.max(1, width) / Math.max(1, height)
    camera.updateProjectionMatrix()
  }, [camera, width, height])

  useFrame(({ clock }) => {
    const seconds = clockRef.current
    if (!Number.isFinite(seconds) || journeyIndex < 0 || journeyIndex >= sampler.count) return
    if (sample.seconds !== seconds) {
      const phase = sampleJourneyPosition(sampler, journeyIndex, seconds, sample.position)
      const stop = phase === 'waiting' || phase === 'processing' ? activeStop(journey, seconds) : null
      sample.phase = phase === 'waiting' && !isVisibleWait(sampler, stop) ? 'waiting-off-scene' : phase
      sample.stationId = stop?.stationId ?? null
      if (sample.phase !== 'waiting-off-scene' && sample.phase !== 'not-arrived') {
        sample.nextNodeId = faceRoute(journey, sample.position, sample.direction)
        if (followCamera) {
          camera.position.set(sample.position[0], sample.position[1] + EYE_HEIGHT_M, sample.position[2])
          sample.lookAt.copy(camera.position).addScaledVector(sample.direction, 3)
          camera.lookAt(sample.lookAt)
        }
      } else {
        sample.nextNodeId = phase === 'not-arrived' ? journey.routeNodeIds[0] ?? null : null
      }
      sample.seconds = seconds
      sample.pending = true
    }
    if (!sample.pending || sample.phase === sample.notifiedPhase && sample.stationId === sample.notifiedStation && clock.elapsedTime - sample.lastNotification < 0.2) return
    sample.pending = false
    sample.notifiedPhase = sample.phase
    sample.notifiedStation = sample.stationId
    sample.lastNotification = clock.elapsedTime
    onStatus({
      journeyIndex, phase: sample.phase,
      waitSeconds: sampleJourneyWaitSeconds(sampler, journeyIndex, seconds),
      position: sample.phase === 'not-arrived' || sample.phase === 'waiting-off-scene' ? null : [sample.position[0], sample.position[1], sample.position[2]],
      stationId: sample.stationId, nextNodeId: sample.nextNodeId,
    })
  })
  return null
}
