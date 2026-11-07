import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { KitPreset, MapArea, Placement, Point, SceneProps, VenuePack } from '../simulation/types'

const palette = { grass: '#667b5e', lawn: '#7c936c', concrete: '#b6b5a9', road: '#777f7d', ivory: '#e8e4d5', steel: '#7b9392', red: '#ad4c40', ink: '#183d44', cyan: '#27c5bb', amber: '#e9aa46' }

function bounds(points: readonly Point[]) {
  const xs = points.map(p => p[0]), zs = points.map(p => p[2])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

function ringGeometry(rx: number, rz: number, innerRx: number, innerRz: number, outerY = 0, innerY = 0) {
  const vertices: number[] = [], indices: number[] = []
  const count = 160
  for (let i = 0; i <= count; i++) {
    const angle = i / count * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle)
    vertices.push(rx * c, outerY, rz * s, innerRx * c, innerY, innerRz * s)
    if (i < count) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices); geometry.computeVertexNormals()
  return geometry
}

function Ring({ rx, rz, innerRx, innerRz, outerY = 0, innerY = 0, color }: { rx: number; rz: number; innerRx: number; innerRz: number; outerY?: number; innerY?: number; color: string }) {
  const geometry = useMemo(() => ringGeometry(rx, rz, innerRx, innerRz, outerY, innerY), [rx, rz, innerRx, innerRz, outerY, innerY])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.88} /></mesh>
}

function Box({ size, position, color, ...rest }: { size: [number, number, number]; position: [number, number, number]; color: string; rotation?: [number, number, number] }) {
  return <mesh position={position} {...rest} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
}

function Stadium({ venue }: { venue: VenuePack }) {
  const b = bounds(venue.stadiumOutline)
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
  const rx = Math.max((b.maxX - b.minX) / 2, 95), rz = Math.max((b.maxZ - b.minZ) / 2, 115)
  const pitchScale = Math.min(1, rx / 115, rz / 145)
  return <group position={[cx, 0, cz]}>
    <Ring rx={rx + 9} rz={rz + 9} innerRx={0} innerRz={0} color="#c5c3b7" outerY={0.13} innerY={0.13} />
    <Ring rx={rx * 0.99} rz={rz * 0.99} innerRx={rx * 0.5} innerRz={rz * 0.63} color="#9caa9a" outerY={2} innerY={2} />
    <group scale={[pitchScale, 1, pitchScale]}>
      <Ring rx={62} rz={103} innerRx={0} innerRz={0} color="#a65b4c" outerY={2.2} innerY={2.2} />
      {Array.from({ length: 7 }, (_, i) => <Ring key={i} rx={61 - i * 1.25} rz={102 - i * 1.25} innerRx={60.85 - i * 1.25} innerRz={101.85 - i * 1.25} color="#dbb7a0" outerY={2.24} innerY={2.24} />)}
      <Ring rx={51} rz={92} innerRx={0} innerRz={0} color="#75955d" outerY={2.26} innerY={2.26} />
      <Box size={[68, 0.12, 105]} position={[0, 2.3, 0]} color="#4f8055" />
      {Array.from({ length: 10 }, (_, i) => <Box key={i} size={[68, 0.02, 10.5]} position={[0, 2.37, -47.25 + i * 10.5]} color={i % 2 ? '#56885b' : '#5d8d60'} />)}
      <Line points={[[-34, 2.4, -52.5], [34, 2.4, -52.5], [34, 2.4, 52.5], [-34, 2.4, 52.5], [-34, 2.4, -52.5]]} color="#ebeed7" lineWidth={1} />
      <Line points={[[-34, 2.4, 0], [34, 2.4, 0]]} color="#ebeed7" lineWidth={1} />
      <Line points={Array.from({ length: 65 }, (_, i) => [Math.cos(i / 64 * Math.PI * 2) * 9.15, 2.4, Math.sin(i / 64 * Math.PI * 2) * 9.15] as [number, number, number])} color="#ebeed7" lineWidth={1} />
      {[-1, 1].map(s => <group key={s}>
        <Line points={[[-20.16, 2.4, s * 52.5], [-20.16, 2.4, s * 36], [20.16, 2.4, s * 36], [20.16, 2.4, s * 52.5]]} color="#ebeed7" lineWidth={1} />
        <Line points={[[-3.66, 2.4, s * 52.5], [-3.66, 4.84, s * 52.5], [3.66, 4.84, s * 52.5], [3.66, 2.4, s * 52.5]]} color="#f7f5e8" lineWidth={2} />
      </group>)}
    </group>
    {Array.from({ length: 15 }, (_, i) => {
      const t = i / 15, next = (i + 1) / 15
      return <Ring key={i} rx={rx * (0.58 + next * 0.35)} rz={rz * (0.69 + next * 0.24)} innerRx={rx * (0.58 + t * 0.35)} innerRz={rz * (0.69 + t * 0.24)} outerY={5 + next * 21} innerY={5 + t * 21} color={i === 7 ? '#dedacc' : i % 3 === 0 ? '#ab4940' : '#bd5a4d'} />
    })}
    {Array.from({ length: 48 }, (_, i) => {
      const a = i / 48 * Math.PI * 2
      return <group key={i}>
        <Line points={[[rx * 0.58 * Math.cos(a), 5.1, rz * 0.69 * Math.sin(a)], [rx * 0.93 * Math.cos(a), 26.1, rz * 0.93 * Math.sin(a)]]} color="#c5bba9" lineWidth={2} />
        <Box position={[rx * 0.97 * Math.cos(a), 14, rz * 0.97 * Math.sin(a)]} size={[1.6, 28, 1.6]} color={palette.ivory} />
      </group>
    })}
    <Ring rx={rx} rz={rz} innerRx={rx * 0.93} innerRz={rz * 0.93} outerY={25} innerY={25} color="#e5e0d0" />
    <Ring rx={rx * 1.04} rz={rz * 1.04} innerRx={rx * 0.77} innerRz={rz * 0.81} outerY={29} innerY={33} color="#e8e4d7" />
    <Ring rx={rx * 1.045} rz={rz * 1.045} innerRx={rx * 1.036} innerRz={rz * 1.036} outerY={29.3} innerY={27.4} color="#c6c9bc" />
    {Array.from({ length: 64 }, (_, i) => {
      const a = i / 64 * Math.PI * 2
      return <Line key={i} points={[[rx * 0.77 * Math.cos(a), 33.15, rz * 0.81 * Math.sin(a)], [rx * 1.04 * Math.cos(a), 29.15, rz * 1.04 * Math.sin(a)]]} color="#c9c9bb" lineWidth={0.65} />
    })}
  </group>
}

function MapPolygon({ area }: { area: MapArea }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    area.ring.forEach((p, i) => i ? s.lineTo(p[0], -p[2]) : s.moveTo(p[0], -p[2])); s.closePath()
    return s
  }, [area.ring])
  const building = area.kind === 'building'
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} receiveShadow castShadow={building}>
    {building ? <extrudeGeometry args={[shape, { depth: area.heightM ?? 7, bevelEnabled: false }]} /> : <shapeGeometry args={[shape]} />}
    <meshStandardMaterial color={building ? '#c8c9bc' : area.kind === 'green' ? palette.lawn : area.kind === 'water' ? '#6da2a1' : '#c4c1b2'} roughness={0.95} />
  </mesh>
}

function TentRoof({ width, depth, eave, height, pagoda }: { width: number; depth: number; eave: number; height: number; pagoda: boolean }) {
  const geometry = useMemo(() => {
    const w = width / 2 + 0.12, d = depth / 2 + 0.12
    const vertices = pagoda
      ? [-w, eave, -d, w, eave, -d, 0, height, 0, w, eave, -d, w, eave, d, 0, height, 0, w, eave, d, -w, eave, d, 0, height, 0, -w, eave, d, -w, eave, -d, 0, height, 0]
      : [-w, eave, -d, 0, height, -d, -w, eave, d, 0, height, -d, 0, height, d, -w, eave, d, 0, height, -d, w, eave, -d, 0, height, d, w, eave, -d, w, eave, d, 0, height, d, -w, eave, -d, w, eave, -d, 0, height, -d, -w, eave, d, 0, height, d, w, eave, d]
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals(); return g
  }, [width, depth, eave, height, pagoda])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color="#f5eee0" side={THREE.DoubleSide} roughness={0.75} /></mesh>
}

function Kit({ preset, placement, selected, onSelect }: { preset: KitPreset; placement: Placement; selected: boolean; onSelect: SceneProps['onSelect'] }) {
  const w = preset.widthM, d = preset.kind === 'roder' ? (placement.bays ?? 1) * (preset.bayLengthM ?? preset.depthM) : preset.depthM, h = preset.heightM
  const eave = preset.eaveM ?? h * 0.68
  const tent = preset.kind === 'pagoda' || preset.kind === 'roder'
  return <group position={[...placement.position]} rotation={[0, placement.yawDeg * Math.PI / 180, 0]} onClick={e => { e.stopPropagation(); onSelect(placement.id) }}>
    <Box size={[w + 0.15, 0.08, d + 0.15]} position={[0, 0.05, 0]} color={selected ? '#3bcac0' : '#9aa99c'} />
    {tent ? <>
      <TentRoof width={w} depth={d} eave={eave} height={h} pagoda={preset.kind === 'pagoda'} />
      {Array.from({ length: preset.kind === 'roder' ? (placement.bays ?? 1) + 1 : 2 }, (_, i) => {
        const n = preset.kind === 'roder' ? (placement.bays ?? 1) : 1, z = -d / 2 + i / n * d
        return [-1, 1].map(side => <Box key={`${i}-${side}`} size={[0.09, eave, 0.09]} position={[side * w / 2, eave / 2, z]} color={palette.steel} />)
      })}
    </> : preset.kind === 'table' ? <>
      <Box size={[w, 0.07, d]} position={[0, h - 0.035, 0]} color="#b78d61" />
      {[-1, 1].flatMap(x => [-1, 1].map(z => <Box key={`${x}-${z}`} size={[0.045, h - 0.07, 0.045]} position={[x * (w / 2 - 0.09), (h - 0.07) / 2, z * (d / 2 - 0.09)]} color={palette.ink} />))}
    </> : preset.kind === 'detector' ? <>
      {[-1, 1].map(s => <Box key={s} size={[Math.min(w * 0.18, 0.2), h, d]} position={[s * (w / 2 - Math.min(w * 0.18, 0.2) / 2), h / 2, 0]} color="#385969" />)}
      <Box size={[w, 0.2, d]} position={[0, h - 0.1, 0]} color="#385969" />
      <Box size={[w * 0.35, 0.055, 0.02]} position={[0, h - 0.1, -d / 2 - 0.01]} color={palette.cyan} />
    </> : <>
      {[-1, 1].map(s => <Box key={s} size={[0.04, h, Math.min(d, 0.08)]} position={[s * (w / 2 - 0.04), h / 2, 0]} color={palette.steel} />)}
      {[0.25, 0.92].map(y => <Box key={y} size={[w, 0.04, 0.04]} position={[0, h * y, 0]} color={palette.steel} />)}
      {Array.from({ length: Math.max(3, Math.round(w / 0.16)) }, (_, i) => <Box key={i} size={[0.022, h * 0.67, 0.022]} position={[-w / 2 + (i + 0.5) / Math.max(3, Math.round(w / 0.16)) * w, h * 0.58, 0]} color={palette.steel} />)}
      {[-1, 1].map(s => <Box key={s} size={[0.1, 0.04, d]} position={[s * (w / 2 - 0.04), 0.04, 0]} color={palette.steel} />)}
    </>}
    {selected && <>
      <Line points={[[-w / 2 - 0.3, 0.14, -d / 2 - 0.3], [w / 2 + 0.3, 0.14, -d / 2 - 0.3], [w / 2 + 0.3, 0.14, d / 2 + 0.3], [-w / 2 - 0.3, 0.14, d / 2 + 0.3], [-w / 2 - 0.3, 0.14, -d / 2 - 0.3]]} color={palette.cyan} lineWidth={2} />
      <Html position={[0, h + 1.5, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', font: '600 11px system-ui', background: '#173d44', color: '#eef7ef', borderRadius: 5, padding: '5px 8px' }}>{placement.label} · {w} × {d} m</Html>
    </>}
  </group>
}

function CameraRig({ venue, view, placements }: Pick<SceneProps, 'venue' | 'view' | 'placements'>) {
  const { camera } = useThree()
  const controls = useRef<any>(null)
  const stadium = bounds(venue.stadiumOutline)
  const cx = (stadium.minX + stadium.maxX) / 2, cz = (stadium.minZ + stadium.maxZ) / 2
  const sceneSpan = Math.max(stadium.maxX - stadium.minX, stadium.maxZ - stadium.minZ, 250)
  useEffect(() => {
    const selectedArea = placements.length ? bounds(placements.map(p => p.position)) : venue.editBounds
    const tx = view === 'layout' ? (selectedArea.minX + selectedArea.maxX) / 2 : cx
    const tz = view === 'layout' ? (selectedArea.minZ + selectedArea.maxZ) / 2 : cz
    const span = view === 'layout' ? Math.max(selectedArea.maxX - selectedArea.minX, selectedArea.maxZ - selectedArea.minZ, 55) * 1.3 : sceneSpan
    camera.position.set(tx + (view === 'layout' ? 0 : span * 0.9), view === 'layout' ? span * 1.3 : span * 0.9, tz + (view === 'layout' ? 0.01 : span * 1.05))
    camera.lookAt(tx, 0, tz)
    if (controls.current) { controls.current.target.set(tx, 0, tz); controls.current.update() }
    // Reframe on view/venue changes, not every move: preserve the operator's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, venue.id, camera])
  return <OrbitControls ref={controls} makeDefault minDistance={5} maxDistance={2400} maxPolarAngle={Math.PI / 2 - 0.025} enableRotate={view === 'orbit'} enableDamping dampingFactor={0.09} />
}

function Scene(props: SceneProps) {
  const { venue, catalogue, placements, routes, nodes, selectedId, onSelect, onMove } = props
  const allPoints = [...venue.stadiumOutline, ...venue.areas.flatMap(a => a.ring), ...venue.paths.flatMap(p => p.points)]
  const world = bounds(allPoints), size = Math.max(world.maxX - world.minX, world.maxZ - world.minZ, 700) + 500
  const centre: [number, number, number] = [(world.minX + world.maxX) / 2, -0.02, (world.minZ + world.maxZ) / 2]
  const moveOnGround = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return
    e.stopPropagation()
    if (selectedId && props.view === 'layout') {
      const { minX, maxX, minZ, maxZ } = venue.editBounds
      onMove(selectedId, [Math.max(minX, Math.min(maxX, e.point.x)), 0, Math.max(minZ, Math.min(maxZ, e.point.z))])
    } else onSelect(null)
  }
  return <>
    <color attach="background" args={['#e8ebe1']} />
    <ambientLight intensity={1.3} />
    <hemisphereLight args={['#f8f6df', '#4b695a', 1.5]} />
    <directionalLight position={[-180, 350, -200]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-400} shadow-camera-right={400} shadow-camera-top={400} shadow-camera-bottom={-400} shadow-camera-far={1000} shadow-bias={-0.0005} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={centre} receiveShadow onClick={moveOnGround}><planeGeometry args={[size, size]} /><meshStandardMaterial color={palette.grass} roughness={1} /></mesh>
    <group onClick={moveOnGround}>
      {venue.areas.map(area => <MapPolygon key={area.id} area={area} />)}
      {venue.paths.filter(p => p.points.length > 1).map(path => <Line key={path.id} points={path.points.map(p => [p[0], 0.12, p[2]])} color={path.kind === 'road' ? palette.road : '#d4cfbc'} lineWidth={path.kind === 'road' ? 9 : 3} />)}
    </group>
    <Stadium venue={venue} />
    {props.view === 'layout' && <gridHelper args={[600, 120, '#84988b', '#92a18c']} position={[0, 0.16, 0]} />}
    {routes.filter(r => r.points.length > 1).map(route => <Line key={route.id} points={route.points.map(p => [p[0], 0.35, p[2]])} color={route.kind === 'entry' ? palette.cyan : palette.amber} lineWidth={3} dashed={route.kind === 'exception'} dashSize={1.2} gapSize={0.7} />)}
    {nodes.map(node => <group key={node.id} position={[node.position[0], 0.4, node.position[2]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.7, 1.05, 24]} /><meshBasicMaterial color={node.role === 'checkpoint' ? palette.amber : palette.cyan} side={THREE.DoubleSide} /></mesh>
      {props.view === 'layout' && <Html position={[0, 1, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', font: '500 10px system-ui', color: '#173c3d', background: '#f5f4e5e8', padding: '2px 5px', borderRadius: 3 }}>{node.label}</Html>}
    </group>)}
    {placements.map(placement => {
      const preset = catalogue.find(p => p.id === placement.presetId)
      return preset ? <Kit key={placement.id} preset={preset} placement={placement} selected={selectedId === placement.id} onSelect={onSelect} /> : null
    })}
    <CameraRig venue={venue} view={props.view} placements={placements} />
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
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [350, 350, 450], fov: 42, near: 0.1, far: 5000 }} gl={{ antialias: true }} style={{ width: '100%', height: '100%', background: '#e8ebe1' }}>
      <Suspense fallback={null}><Scene {...props} />{props.debug && <PerformanceMonitor output={performance} />}</Suspense>
    </Canvas>
    {props.debug && <div ref={performance} data-scene-performance aria-label="Scene rendering performance" title="Half-second average: rendered frames per second, renderer draw calls including shadows, and triangles. Depends on browser, device and view." style={{ position: 'absolute', right: 12, bottom: 10, pointerEvents: 'none', color: '#38534b', background: '#eef1e7d9', padding: '4px 7px', borderRadius: 4, font: '10px ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>Measuring scene…</div>}
  </div>
}
