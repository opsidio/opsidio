import type { ReactNode } from 'react'

export type Point = readonly [x: number, y: number, z: number]
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

export type MapPath = {
  id: string
  kind: 'road' | 'walk'
  points: readonly Point[]
}

export type MapArea = {
  id: string
  kind: 'building' | 'green' | 'water' | 'plaza'
  ring: readonly Point[]
  heightM?: number
}

export type VenuePack = {
  id: string
  name: string
  origin: { lon: number; lat: number }
  basis: 'mapped' | 'schematic'
  attribution: string
  sourceUrl: string
  stadiumOutline: readonly Point[]
  areas: readonly MapArea[]
  paths: readonly MapPath[]
  landmarks: readonly { id: string; label: string; position: Point }[]
  editBounds: Bounds
}

export type KitKind = 'pagoda' | 'roder' | 'rowing' | 'table' | 'detector'

export type KitPreset = {
  id: string
  name: string
  kind: KitKind
  widthM: number
  depthM: number
  heightM: number
  eaveM?: number
  bayLengthM?: number
  sourceUrl: string
  notes?: string
}

export type Placement = {
  id: string
  label: string
  presetId: string
  position: Point
  yawDeg: number
  bays?: number
}

export type RouteLine = {
  id: string
  points: readonly Point[]
  kind: 'entry' | 'exception' | 'connector' | 'public'
  color?: string
  segments?: boolean
}

export type RouteNode = {
  id: string
  label: string
  role: 'arrival' | 'waypoint' | 'checkpoint' | 'destination'
  position: Point
}

export type SceneView = 'orbit' | 'isometric' | 'entry' | 'map' | 'layout'

export type EntryAreaMarker = {
  id: string
  label: string
  position: Point
  attendees: number
  color: string
}

export type SceneProps = {
  children?: ReactNode
  focusPosition?: Point
  editBounds?: Bounds
  inspectWaypoints?: boolean
  focusYawDeg?: number
  entryAreas?: readonly EntryAreaMarker[]
  debug?: boolean
  autoRotate?: boolean
  panMode?: boolean
  showLabels?: boolean
  onCameraInteraction?: () => void
  showGuides?: boolean
  venue: VenuePack
  catalogue: readonly KitPreset[]
  placements: readonly Placement[]
  routes: readonly RouteLine[]
  nodes: readonly RouteNode[]
  view: SceneView
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, position: Point) => void
}

export type LanePlan = { planned: number; scanners: number; crew: number }
export type LaneCheck = { physical: number; feasible: number; limiting: readonly string[]; valid: boolean }
