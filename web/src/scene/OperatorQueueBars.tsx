import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import SceneHtml from './SceneHtml'
import { Color, DynamicDrawUsage, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import type { Group, InstancedMesh } from 'three'
import type { OperationsOperator } from './OperationsLayer'
import { createOperatorQueueStates, sampleOperatorQueueStates } from '../simulation/abm/sampling'
import type { JourneySampler } from '../simulation/abm/sampling'
import { QUEUE_BAR_BASE_M, queueBarHeightM, writeWaitColor } from '../simulation/abm/wait-visuals'

export type OperatorQueueBarsProps = {
  sampler: JourneySampler
  operators: readonly OperationsOperator[]
  clockRef: { current: number }
  showLabels?: boolean
}

const labelStyle: CSSProperties = {
  display: 'none', pointerEvents: 'none', whiteSpace: 'nowrap', textAlign: 'center',
  font: '600 9px/1.35 Inter, system-ui, sans-serif', color: '#243940', background: '#fffffff2',
  padding: '3px 5px', border: '1px solid #d8e1df', borderRadius: 4, boxShadow: '0 1px 4px #173b3726',
}
const noRaycast = () => {}

/**
 * Display annotations above the original operator X/Z positions. The 6 m baseline clears
 * the authored canopies; staff and operational coordinates stay on the ground.
 * Height is sqrt(queue), capped at 5,000 people. Color is the oldest current wait.
 */
export function OperatorQueueBars({ sampler, operators, clockRef, showLabels = true }: OperatorQueueBarsProps) {
  const { camera, size } = useThree()
  const bars = useRef<InstancedMesh>(null), stems = useRef<InstancedMesh>(null)
  const anchors = useRef<(Group | null)[]>([])
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const counts = useRef<(HTMLSpanElement | null)[]>([])
  const waits = useRef<(HTMLSpanElement | null)[]>([])
  const overflow = useRef<(HTMLSpanElement | null)[]>([])
  const buffers = useMemo(() => ({
    states: createOperatorQueueStates(sampler, operators.map(operator => operator.id)),
    matrix: new Matrix4(), color: new Color(), projected: new Vector3(),
    screenX: new Float32Array(operators.length), screenY: new Float32Array(operators.length),
    visibleLabels: new Uint32Array(operators.length), lastTime: NaN, lastLabelTime: -Infinity,
  }), [sampler, operators])

  useLayoutEffect(() => {
    const stemHeight = QUEUE_BAR_BASE_M - 1.8
    for (let index = 0; index < operators.length; index++) {
      const position = operators[index].position
      buffers.matrix.makeScale(0.035, stemHeight, 0.035).setPosition(position[0], position[1] + 1.8 + stemHeight / 2, position[2])
      stems.current?.setMatrixAt(index, buffers.matrix)
    }
    if (stems.current) { stems.current.count = operators.length; stems.current.instanceMatrix.needsUpdate = true }
    if (bars.current) { bars.current.count = 0; bars.current.instanceMatrix.setUsage(DynamicDrawUsage) }
    buffers.lastTime = NaN; buffers.lastLabelTime = -Infinity
  }, [buffers, operators])

  useFrame(({ clock }) => {
    const seconds = clockRef.current
    if (!bars.current || !Number.isFinite(seconds)) return
    if (buffers.lastTime !== seconds) {
      sampleOperatorQueueStates(sampler, seconds, buffers.states)
      for (let index = 0; index < operators.length; index++) {
        const state = buffers.states[index], position = operators[index].position
        const height = queueBarHeightM(state.queuedCount)
        buffers.matrix.makeScale(0.75, height, 0.75).setPosition(position[0], position[1] + QUEUE_BAR_BASE_M + height / 2, position[2])
        bars.current.setMatrixAt(index, buffers.matrix)
        if (state.queuedCount > 0) writeWaitColor(state.oldestWaitSeconds, buffers.color)
        else buffers.color.set(state.processing ? '#359c9b' : '#9aa9ae')
        bars.current.setColorAt(index, buffers.color)
        const anchor = anchors.current[index]
        if (anchor) anchor.position.y = position[1] + QUEUE_BAR_BASE_M + height + 0.75
      }
      bars.current.count = operators.length
      bars.current.instanceMatrix.needsUpdate = true
      if (bars.current.instanceColor) bars.current.instanceColor.needsUpdate = true
      buffers.lastTime = seconds
    }
    if (!showLabels || clock.elapsedTime - buffers.lastLabelTime < 0.2) return
    buffers.lastLabelTime = clock.elapsedTime
    let visible = 0
    for (let index = 0; index < operators.length; index++) {
      const element = labels.current[index], anchor = anchors.current[index]
      if (!element || !anchor) continue
      const state = buffers.states[index]
      const count = counts.current[index], wait = waits.current[index], offScene = overflow.current[index]
      if (count) count.textContent = `${state.queuedCount.toLocaleString()} queued`
      if (wait) wait.textContent = `${(state.oldestWaitSeconds / 60).toFixed(1)} min oldest`
      if (offScene) {
        offScene.textContent = state.overflowCount > 0 ? `${state.overflowCount.toLocaleString()} off-scene` : ''
        offScene.hidden = state.overflowCount === 0
      }
      element.dataset.queueCount = String(state.queuedCount)
      element.dataset.queueOverflow = String(state.overflowCount)
      element.dataset.oldestWaitSeconds = String(Math.round(state.oldestWaitSeconds))
      buffers.projected.copy(anchor.position)
      let pixelsPerMetre = 0
      if (camera instanceof OrthographicCamera) pixelsPerMetre = size.height * camera.zoom / (camera.top - camera.bottom)
      else if (camera instanceof PerspectiveCamera) {
        const distance = Math.max(1, camera.position.distanceTo(buffers.projected))
        pixelsPerMetre = size.height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance)
      }
      buffers.projected.project(camera)
      const x = (buffers.projected.x + 1) * size.width / 2, y = (1 - buffers.projected.y) * size.height / 2
      let show = pixelsPerMetre >= 5 && visible < 16 && Math.abs(buffers.projected.x) < 0.97
        && Math.abs(buffers.projected.y) < 0.95 && Math.abs(buffers.projected.z) <= 1
      // Reveal every label when space permits, without a pile of overlapping DOM at map scale.
      for (let previous = 0; show && previous < visible; previous++) {
        const other = buffers.visibleLabels[previous]
        if (Math.abs(x - buffers.screenX[other]) < 76 && Math.abs(y - buffers.screenY[other]) < 45) show = false
      }
      element.style.display = show ? 'block' : 'none'
      if (show) {
        buffers.screenX[index] = x; buffers.screenY[index] = y
        buffers.visibleLabels[visible++] = index
      }
    }
  })

  return <group name="operator-queue-annotations" userData={{ baselineM: QUEUE_BAR_BASE_M, meaning: 'height: queued people; color: oldest current wait' }}>
    <instancedMesh ref={stems} args={[undefined, undefined, Math.max(1, operators.length)]} frustumCulled={false} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#829194" transparent opacity={0.55} />
    </instancedMesh>
    <instancedMesh ref={bars} args={[undefined, undefined, Math.max(1, operators.length)]} frustumCulled={false} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ffffff" />
    </instancedMesh>
    {showLabels && operators.map((operator, index) => <group key={operator.id}
      ref={group => { anchors.current[index] = group }}
      position={[operator.position[0], operator.position[1] + QUEUE_BAR_BASE_M + 1, operator.position[2]]}>
      <SceneHtml center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={element => { labels.current[index] = element }} data-operator-queue={operator.id}
          title={`${operator.label}: height shows queue count; color shows oldest wait`} style={labelStyle}>
          <span ref={element => { counts.current[index] = element }} style={{ display: 'block' }}>0 queued</span>
          <span ref={element => { waits.current[index] = element }} style={{ display: 'block', fontWeight: 400 }}>0.0 min oldest</span>
          <span ref={element => { overflow.current[index] = element }} style={{ fontWeight: 400 }} hidden />
        </div>
      </SceneHtml>
    </group>)}
  </group>
}

export default OperatorQueueBars
