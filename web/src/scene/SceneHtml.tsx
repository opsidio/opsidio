import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { createRoot, type Root } from 'react-dom/client'
import { Vector3, type Group } from 'three'
import type { Point } from '../simulation/types'

export const SceneHtmlTarget = createContext<RefObject<HTMLDivElement | null> | null>(null)

const defaultZIndexRange = [30, 0] as const

type SceneHtmlProps = {
  children: ReactNode
  position?: Point
  center?: boolean
  style?: CSSProperties
  zIndexRange?: readonly [number, number]
}

/** Screen-space labels with a dedicated DOM container for each mounted root. */
export default function SceneHtml({ children, position, center, style, zIndexRange = defaultZIndexRange }: SceneHtmlProps) {
  const target = useContext(SceneHtmlTarget)
  const anchor = useRef<Group>(null)
  const overlay = useRef<{ element: HTMLDivElement; root: Root } | null>(null)
  const world = useRef(new Vector3()).current
  const projected = useRef(new Vector3()).current
  const cameraPosition = useRef(new Vector3()).current

  useLayoutEffect(() => {
    const layer = target?.current
    if (!layer) return
    const element = document.createElement('div')
    element.style.cssText = 'position:absolute;top:0;left:0;display:none;pointer-events:none;'
    layer.appendChild(element)
    const root = createRoot(element)
    overlay.current = { element, root }
    return () => {
      overlay.current = null
      element.remove()
      // Three's reconciler may still be committing. This detached container
      // belongs exclusively to this root until React DOM completes cleanup.
      queueMicrotask(() => root.unmount())
    }
  }, [target])

  useLayoutEffect(() => {
    overlay.current?.root.render(<div style={{ position: 'absolute', transform: center ? 'translate(-50%, -50%)' : undefined, ...style }}>{children}</div>)
  }, [center, children, style])

  useFrame(({ camera, size }) => {
    const element = overlay.current?.element
    if (!element || !anchor.current) return
    camera.updateMatrixWorld()
    anchor.current.getWorldPosition(world)
    projected.copy(world).project(camera)
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !(projected.z >= -1 && projected.z <= 1)) {
      element.style.display = 'none'
      return
    }
    const x = (1 + projected.x) * size.width / 2
    const y = (1 - projected.y) * size.height / 2
    element.style.transform = `translate3d(${x}px,${y}px,0)`
    element.style.display = 'block'
    if ('near' in camera && 'far' in camera) {
      const distance = world.distanceTo(cameraPosition.setFromMatrixPosition(camera.matrixWorld))
      const depth = Math.min(1, Math.max(0, (distance - camera.near) / (camera.far - camera.near)))
      element.style.zIndex = String(Math.round(zIndexRange[0] + depth * (zIndexRange[1] - zIndexRange[0])))
    }
  })

  return <group ref={anchor} position={position} />
}
