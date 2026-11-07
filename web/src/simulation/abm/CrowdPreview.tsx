import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Color, DoubleSide, DynamicDrawUsage, Matrix4 } from 'three'
import type { InstancedMesh, Mesh } from 'three'
import type { AbmResult } from '../runtime-types'
import { prepareJourneySampler, sampleJourneyPosition, sampleJourneyWaitSeconds, sampleWalkingCrowd } from './sampling'
import type { CrowdSampleStats, JourneySampler } from './sampling'
import { writeWaitColor } from './wait-visuals'

export type CrowdPreviewProps = {
  result: AbmResult
  /** Share the prepared timeline with queue annotations to avoid a second population buffer. */
  sampler?: JourneySampler
  timeSeconds?: number
  /** Caller-owned simulation clock, read directly each frame for smooth playback. */
  clockRef?: { current: number }
  maxVisible?: number
  /** Hide the followed avatar and co-located people who would intersect its view. */
  hiddenJourneyIndex?: number | null
  selectedJourneyIndex?: number | null
  onSelectJourney?: (journeyIndex: number) => void
  color?: string
  /** Small decorative separation of overlapping group members; not a density model. */
  visualSpreadM?: number
  /** Called at most four times per second, only when counts change. */
  onSampleStats?: (stats: Readonly<CrowdSampleStats>) => void
}

/** Illustrative walking, waiting and processing from the authored journey timeline. */
export function CrowdPreview({
  result, sampler: suppliedSampler, timeSeconds = 0, clockRef, maxVisible = 5000, hiddenJourneyIndex, selectedJourneyIndex, onSelectJourney,
  color = '#f4c66b', visualSpreadM = 0.65, onSampleStats,
}: CrowdPreviewProps) {
  const sampler = useMemo(() => suppliedSampler ?? prepareJourneySampler(result.journeys), [result, suppliedSampler])
  const capacity = Math.max(0, Math.min(sampler.count, Number.isFinite(maxVisible) ? Math.floor(maxVisible) : 5000))
  const buffers = useMemo(() => ({
    positions: new Float32Array(capacity * 3), indices: new Uint32Array(capacity), instanceJourneys: new Uint32Array(capacity),
    stats: { visibleCount: 0, walkingCount: 0 } as CrowdSampleStats, matrix: new Matrix4(), color: new Color(),
    lastTime: NaN, lastNotifyTime: -Infinity, lastVisible: -1, lastWalking: -1, lastWaiting: -1,
    lastVisibleWaiting: -1, lastProcessing: -1, lastCompleted: -1,
  }), [sampler, capacity])
  const offsets = useMemo(() => {
    const values = new Float32Array(sampler.count * 2)
    for (let index = 0; index < sampler.count; index++) {
      let hash = 2166136261
      const id = result.journeys[index].id
      for (let char = 0; char < id.length; char++) hash = Math.imul(hash ^ id.charCodeAt(char), 16777619)
      values[index * 2] = ((hash >>> 0) % 1024) / 1023 * 2 - 1
      values[index * 2 + 1] = ((hash >>> 10) % 1024) / 1023 * 2 - 1
    }
    return values
  }, [sampler, result])
  const bodies = useRef<InstancedMesh>(null)
  const heads = useRef<InstancedMesh>(null)
  const marker = useRef<Mesh>(null)
  useLayoutEffect(() => {
    for (const mesh of [bodies.current, heads.current]) if (mesh) {
      mesh.count = 0
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    }
    if (marker.current) marker.current.visible = false
    buffers.lastTime = NaN
  }, [buffers, hiddenJourneyIndex, selectedJourneyIndex, visualSpreadM])

  function selectJourney(event: ThreeEvent<MouseEvent>) {
    const instance = event.instanceId
    if (event.delta > 4 || instance === undefined || instance >= (bodies.current?.count ?? 0)) return
    event.stopPropagation()
    onSelectJourney?.(buffers.instanceJourneys[instance])
  }

  useFrame(({ clock }) => {
    const seconds = clockRef?.current ?? timeSeconds
    if (!bodies.current || !heads.current || !Number.isFinite(seconds)) return
    if (buffers.lastTime !== seconds) {
      sampleWalkingCrowd(sampler, seconds, buffers.positions, buffers.indices, buffers.stats)
      const spread = Number.isFinite(visualSpreadM) ? Math.max(0, visualSpreadM) : 0
      const followedSlot = hiddenJourneyIndex == null ? -1 : buffers.indices.subarray(0, buffers.stats.visibleCount).indexOf(hiddenJourneyIndex)
      const followedPhase = followedSlot < 0 ? null : sampleJourneyPosition(sampler, buffers.indices[followedSlot], seconds, buffers.positions, followedSlot * 3)
      const eyeX = followedSlot < 0 ? 0 : buffers.positions[followedSlot * 3]
      const eyeZ = followedSlot < 0 ? 0 : buffers.positions[followedSlot * 3 + 2]
      const eyeClearanceM = followedPhase === 'walking' ? 1.2 : 0.4
      if (marker.current) marker.current.visible = false
      let instance = 0
      for (let slot = 0; slot < buffers.stats.visibleCount; slot++) {
        const index = buffers.indices[slot]
        if (index === hiddenJourneyIndex) continue
        const phase = sampleJourneyPosition(sampler, index, seconds, buffers.positions, slot * 3)
        if (phase === 'waiting') writeWaitColor(sampleJourneyWaitSeconds(sampler, index, seconds), buffers.color)
        else buffers.color.set(phase === 'processing' ? '#359c9b' : color)
        const walkingSpread = phase === 'walking' ? spread : 0
        const x = buffers.positions[slot * 3] + offsets[index * 2] * walkingSpread
        const y = buffers.positions[slot * 3 + 1]
        const z = buffers.positions[slot * 3 + 2] + offsets[index * 2 + 1] * walkingSpread
        // Walkers share paths without collision avoidance. In queues, preserve the authored 0.8 m spacing.
        if (followedSlot >= 0 && (x - eyeX) ** 2 + (z - eyeZ) ** 2 < eyeClearanceM ** 2) continue
        if (marker.current && index === selectedJourneyIndex) {
          marker.current.position.set(x, y + 0.08, z)
          marker.current.visible = true
        }
        buffers.instanceJourneys[instance] = index
        bodies.current.setColorAt(instance, buffers.color)
        buffers.matrix.makeTranslation(x, y + 0.8, z)
        bodies.current.setMatrixAt(instance, buffers.matrix)
        buffers.matrix.makeTranslation(x, y + 1.5, z)
        heads.current.setMatrixAt(instance, buffers.matrix)
        instance++
      }
      bodies.current.count = instance
      heads.current.count = instance
      // Three caches instance bounds for raycasts. Recompute lazily on the next hit test.
      bodies.current.boundingSphere = null
      heads.current.boundingSphere = null
      if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true
      bodies.current.instanceMatrix.needsUpdate = true
      heads.current.instanceMatrix.needsUpdate = true
      buffers.lastTime = seconds
    }
    if (onSampleStats && clock.elapsedTime - buffers.lastNotifyTime >= 0.25
      && (buffers.lastVisible !== buffers.stats.visibleCount || buffers.lastWalking !== buffers.stats.walkingCount
        || buffers.lastWaiting !== buffers.stats.waitingCount || buffers.lastVisibleWaiting !== buffers.stats.visibleWaitingCount
        || buffers.lastProcessing !== buffers.stats.processingCount || buffers.lastCompleted !== buffers.stats.completedCount)) {
      buffers.lastNotifyTime = clock.elapsedTime
      buffers.lastVisible = buffers.stats.visibleCount
      buffers.lastWalking = buffers.stats.walkingCount
      buffers.lastWaiting = buffers.stats.waitingCount ?? 0
      buffers.lastVisibleWaiting = buffers.stats.visibleWaitingCount ?? 0
      buffers.lastProcessing = buffers.stats.processingCount ?? 0
      buffers.lastCompleted = buffers.stats.completedCount ?? 0
      // Low-frequency notification copy; all per-frame geometry work reuses buffers.
      onSampleStats({ ...buffers.stats })
    }
  })

  return <group name="Illustrative ABM walking preview" onClick={onSelectJourney ? selectJourney : undefined}>
    <instancedMesh ref={bodies} args={[undefined, undefined, Math.max(1, capacity)]} frustumCulled={false}>
      <cylinderGeometry args={[0.22, 0.27, 1.15, 5]} />
      <meshStandardMaterial color="#ffffff" roughness={0.9} />
    </instancedMesh>
    <instancedMesh ref={heads} args={[undefined, undefined, Math.max(1, capacity)]} frustumCulled={false}>
      <sphereGeometry args={[0.2, 5, 3]} />
      <meshStandardMaterial color="#e7b890" roughness={0.9} />
    </instancedMesh>
    {selectedJourneyIndex != null && <mesh ref={marker} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.36, 0.52, 24]} />
      <meshBasicMaterial color="#ff5a5f" side={DoubleSide} />
    </mesh>}
  </group>
}
