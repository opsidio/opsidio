import KitModel from './KitModel'
import StadiumModel from './StadiumModel'
import LandscapeContext from './LandscapeContext'
import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Point, SceneProps, VenuePack } from '../simulation/types'

const palette = { grass: '#667b5e', lawn: '#7c936c', concrete: '#b6b5a9', road: '#777f7d', ivory: '#e8e4d5', steel: '#7b9392', red: '#ad4c40', ink: '#183d44', cyan: '#27c5bb', amber: '#e9aa46' }

function bounds(points: readonly Point[]) {
  const xs = points.map(p => p[0]), zs = points.map(p => p[2])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

function CameraRig(props: SceneProps) {
  const { venue, view } = props
  const { set, size } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  const perspective = useMemo(() => new THREE.PerspectiveCamera(42, 1, 2, 4000), [])
  const orthographic = useMemo(() => new THREE.OrthographicCamera(-500, 500, 500, -500, 2, 4000), [])
  const flat = view === 'map' || view === 'layout'
  const camera = flat || view === 'isometric' ? orthographic : perspective

  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1)
    perspective.aspect = aspect
    perspective.updateProjectionMatrix()
    const span = view === 'layout' ? 95 : view === 'isometric' ? 620 : 900
    const halfHeight = span / Math.min(aspect, 1)
    orthographic.left = -halfHeight * aspect
    orthographic.right = halfHeight * aspect
    orthographic.top = halfHeight
    orthographic.bottom = -halfHeight
    orthographic.updateProjectionMatrix()
  }, [size.width, size.height, view, orthographic, perspective])

  useEffect(() => {
    const stadium = bounds(venue.stadiumOutline)
    const cx = (stadium.minX + stadium.maxX) / 2
    const cz = (stadium.minZ + stadium.maxZ) / 2
    const entry = view === 'entry' || view === 'layout'
    const target = new THREE.Vector3(entry ? 12 : cx, 0, entry ? -260 : cz)
    camera.up.set(0, 1, 0)
    if (flat) {
      camera.position.set(target.x, 1400, target.z + 0.01)
    } else if (view === 'isometric') {
      camera.position.set(cx + 800, 800, cz + 800)
    } else if (entry) {
      camera.position.set(70, 66, -350)
    } else {
      camera.position.set(cx + 510, 620, cz + 650)
    }
    camera.lookAt(target)
    set({ camera })
    if (controls.current) {
      controls.current.target.copy(target)
      controls.current.update()
    }
  }, [camera, flat, set, venue.id, view])

  return <OrbitControls ref={controls} camera={camera} makeDefault
    minDistance={6} maxDistance={2400} minZoom={0.5} maxZoom={30}
    maxPolarAngle={Math.PI / 2 - 0.04}
    enableRotate={!flat && view !== 'isometric'} screenSpacePanning
    mouseButtons={{ LEFT: flat || view === 'isometric' || props.panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    autoRotate={props.autoRotate && view === 'orbit'} autoRotateSpeed={0.35}
    onStart={props.onCameraInteraction} enableDamping dampingFactor={0.09} />
}

function Scene(props: SceneProps & { showGuides?: boolean }) {
  const { venue, catalogue, placements, routes, nodes, selectedId, onSelect, onMove } = props
  const allPoints = [...venue.stadiumOutline, ...venue.areas.flatMap(a => a.ring), ...venue.paths.flatMap(p => p.points)]
  const world = bounds(allPoints), size = Math.max(world.maxX - world.minX, world.maxZ - world.minZ, 700) + 500
  const centre: [number, number, number] = [(world.minX + world.maxX) / 2, -0.02, (world.minZ + world.maxZ) / 2]
  const moveOnGround = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return
    e.stopPropagation()
    if (props.showGuides && selectedId && props.view === 'layout') {
      const { minX, maxX, minZ, maxZ } = venue.editBounds
      onMove(selectedId, [Math.max(minX, Math.min(maxX, e.point.x)), 0, Math.max(minZ, Math.min(maxZ, e.point.z))])
    } else onSelect(null)
  }
  return <>
    <color attach="background" args={['#dbe5df']} />
    <ambientLight intensity={1.3} />
    <hemisphereLight args={['#f8f6df', '#4b695a', 1.5]} />
    <directionalLight position={[-180, 350, -200]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-400} shadow-camera-right={400} shadow-camera-top={400} shadow-camera-bottom={-400} shadow-camera-far={1000} shadow-bias={-0.0004} shadow-normalBias={0.15} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={centre} receiveShadow onClick={moveOnGround}><planeGeometry args={[size, size]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} /></mesh>
    <group onClick={moveOnGround}>
      <LandscapeContext venue={venue} />
    </group>
    <StadiumModel venue={venue} />
    {props.showLabels && venue.landmarks.filter(landmark => /Indonesia Arena|Tennis Indoor|Istana Olahraga|Stadion Madya|Stadion Utama|Aquatic|Akuatik/.test(landmark.label)).map(landmark =>
      <Html key={landmark.id} position={[landmark.position[0], /Stadion Utama/.test(landmark.label) ? 38 : 18, landmark.position[2]]} center distanceFactor={undefined} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <span className="venue-label">{landmark.label.replace('Istana Olahraga Gelora Bung Karno', 'Istora').replace('Stadion Utama Gelora Bung Karno', 'Stadion Utama GBK')}</span>
      </Html>)}
    {props.showGuides && props.view === 'layout' && <gridHelper args={[600, 120, '#84988b', '#92a18c']} position={[0, 0.16, 0]} />}
    {props.showGuides && routes.filter(r => r.points.length > 1).map(route => <Line key={route.id} points={route.points.map(p => [p[0], 0.35, p[2]])} color={route.kind === 'entry' ? palette.cyan : palette.amber} lineWidth={3} dashed={route.kind === 'exception'} dashSize={1.2} gapSize={0.7} />)}
    {props.showGuides && nodes.map(node => <group key={node.id} position={[node.position[0], 0.4, node.position[2]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.7, 1.05, 24]} /><meshBasicMaterial color={node.role === 'checkpoint' ? palette.amber : palette.cyan} side={THREE.DoubleSide} /></mesh>
      {props.view === 'layout' && <Html position={[0, 1, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', font: '500 10px system-ui', color: '#173c3d', background: '#f5f4e5e8', padding: '2px 5px', borderRadius: 3 }}>{node.label}</Html>}
    </group>)}
    {placements.map(placement => {
      const preset = catalogue.find(p => p.id === placement.presetId)
      return preset ? <KitModel key={placement.id} preset={preset} placement={placement} selected={!!props.showGuides && selectedId === placement.id} onSelect={props.showGuides ? onSelect : () => {}} /> : null
    })}
    <CameraRig {...props} />
  </>
}

/** Samples completed frames without scheduling React renders or changing the scene. */
function PerformanceMonitor({ output }: { output: RefObject<HTMLDivElement | null> }) {
  const sample = useRef({ seconds: 0, frames: 0, calls: 0, triangles: 0 })
  useFrame(({ gl }, delta) => {
    if (delta > 1) { sample.current = { seconds: 0, frames: 0, calls: 0, triangles: 0 }; return }
    const s = sample.current
    s.seconds += delta; s.frames++; s.calls += gl.info.render.calls; s.triangles += gl.info.render.triangles
    if (s.seconds < 0.5 || !output.current) return
    const fps = Math.round(s.frames / s.seconds), calls = Math.round(s.calls / s.frames), triangles = Math.round(s.triangles / s.frames)
    output.current.textContent = `${fps} fps · ${calls} draws · ${(triangles / 1000).toFixed(1)}k tris`
    output.current.dataset.fps = String(fps); output.current.dataset.drawCalls = String(calls); output.current.dataset.triangles = String(triangles)
    sample.current = { seconds: 0, frames: 0, calls: 0, triangles: 0 }
  })
  return null
}

/** Fresh schematic GBK bowl over the supplied mapped ground frame. Click a kit,
 * then click ground in layout view to commit one move (always at y = 0). */
export default function GbkCanvas(props: SceneProps & { debug?: boolean; showGuides?: boolean }) {
  const performance = useRef<HTMLDivElement>(null)
  return <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [350, 350, 450], fov: 42, near: 2, far: 4000 }} gl={{ antialias: true }} style={{ width: '100%', height: '100%', background: '#e8ebe1' }}>
      <Suspense fallback={null}><Scene {...props} />{props.debug && <PerformanceMonitor output={performance} />}</Suspense>
    </Canvas>
    {props.debug && <div ref={performance} data-scene-performance aria-label="Scene rendering performance" title="Half-second average: rendered frames per second, renderer draw calls including shadows, and triangles. Depends on browser, device and view." style={{ position: 'absolute', right: 12, bottom: 10, pointerEvents: 'none', color: '#38534b', background: '#eef1e7d9', padding: '4px 7px', borderRadius: 4, font: '10px ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>Measuring scene…</div>}
  </div>
}
