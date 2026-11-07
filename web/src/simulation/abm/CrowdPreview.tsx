import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DynamicDrawUsage, Matrix4 } from 'three'
import type { InstancedMesh } from 'three'
import type { AbmResult } from '../runtime-types'
import { prepareJourneySampler, sampleJourneyPosition, sampleWalkingCrowd } from './sampling'
import type { CrowdSampleStats } from './sampling'

export type CrowdPreviewProps = {
  result: AbmResult
  timeSeconds?: number
  /** Caller-owned simulation clock, read directly each frame for smooth playback. */
  clockRef?: { current: number }
  maxVisible?: number
  color?: string
  /** Small decorative separation of overlapping group members; not a density model. */
  visualSpreadM?: number
  /** Called at most four times per second, only when counts change. */
  onSampleStats?: (stats: Readonly<CrowdSampleStats>) => void
}

/** Illustrative walking, waiting and processing from the authored journey timeline. */
export function CrowdPreview({
  result, timeSeconds = 0, clockRef, maxVisible = 5000, color = '#f4c66b', visualSpreadM = 0.65, onSampleStats,
}: CrowdPreviewProps) {
  const sampler = useMemo(() => prepareJourneySampler(result.journeys), [result])
  const capacity = Math.max(0, Math.min(sampler.count, Number.isFinite(maxVisible) ? Math.floor(maxVisible) : 5000))
  const buffers = useMemo(() => ({
    positions: new Float32Array(capacity * 3), indices: new Uint32Array(capacity),
    stats: { visibleCount: 0, walkingCount: 0 } as CrowdSampleStats, matrix: new Matrix4(), color: new Color(),
    lastTime: NaN, lastNotifyTime: -Infinity, lastVisible: -1, lastWalking: -1, lastWaiting: -1, lastProcessing: -1, lastCompleted: -1,
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
  useLayoutEffect(() => {
    for (const mesh of [bodies.current, heads.current]) if (mesh) {
      mesh.count = 0
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    }
    buffers.lastTime = NaN
  }, [buffers, visualSpreadM])

  useFrame(({ clock }) => {
    const seconds = clockRef?.current ?? timeSeconds
    if (!bodies.current || !heads.current || !Number.isFinite(seconds)) return
    if (buffers.lastTime !== seconds) {
      sampleWalkingCrowd(sampler, seconds, buffers.positions, buffers.indices, buffers.stats)
      const spread = Number.isFinite(visualSpreadM) ? Math.max(0, visualSpreadM) : 0
      for (let slot = 0; slot < buffers.stats.visibleCount; slot++) {
        const index = buffers.indices[slot]
        const phase = sampleJourneyPosition(sampler, index, seconds, buffers.positions, slot * 3)
        bodies.current.setColorAt(slot, buffers.color.set(phase === 'waiting' ? '#e59838' : phase === 'processing' ? '#359c9b' : color))
        const x = buffers.positions[slot * 3] + offsets[index * 2] * spread
        const y = buffers.positions[slot * 3 + 1]
        const z = buffers.positions[slot * 3 + 2] + offsets[index * 2 + 1] * spread
        buffers.matrix.makeTranslation(x, y + 0.8, z)
        bodies.current.setMatrixAt(slot, buffers.matrix)
        buffers.matrix.makeTranslation(x, y + 1.55, z)
        heads.current.setMatrixAt(slot, buffers.matrix)
      }
      bodies.current.count = buffers.stats.visibleCount
      heads.current.count = buffers.stats.visibleCount
      if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true
      bodies.current.instanceMatrix.needsUpdate = true
      heads.current.instanceMatrix.needsUpdate = true
      buffers.lastTime = seconds
    }
    if (onSampleStats && clock.elapsedTime - buffers.lastNotifyTime >= 0.25
      && (buffers.lastVisible !== buffers.stats.visibleCount || buffers.lastWalking !== buffers.stats.walkingCount || buffers.lastWaiting !== buffers.stats.waitingCount || buffers.lastProcessing !== buffers.stats.processingCount || buffers.lastCompleted !== buffers.stats.completedCount)) {
      buffers.lastNotifyTime = clock.elapsedTime
      buffers.lastVisible = buffers.stats.visibleCount
      buffers.lastWalking = buffers.stats.walkingCount
      buffers.lastWaiting = buffers.stats.waitingCount ?? 0
      buffers.lastProcessing = buffers.stats.processingCount ?? 0
      buffers.lastCompleted = buffers.stats.completedCount ?? 0
      // Low-frequency notification copy; all per-frame geometry work reuses buffers.
      onSampleStats({ ...buffers.stats })
    }
  })

  return <group name="Illustrative ABM walking preview">
    <instancedMesh ref={bodies} args={[undefined, undefined, Math.max(1, capacity)]} frustumCulled={false}>
      <cylinderGeometry args={[0.22, 0.27, 1.15, 5]} />
      <meshStandardMaterial color="#ffffff" roughness={0.9} />
    </instancedMesh>
    <instancedMesh ref={heads} args={[undefined, undefined, Math.max(1, capacity)]} frustumCulled={false}>
      <sphereGeometry args={[0.22, 5, 3]} />
      <meshStandardMaterial color="#e7b890" roughness={0.9} />
    </instancedMesh>
  </group>
}
