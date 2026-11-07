import type { Placement, Point } from './types'

export type NavigationNode = {
  id: string
  role: 'arrival' | 'waypoint' | 'checkpoint' | 'destination'
  position: Point
  entryAreaId?: string
  attachment?: { placementId: string; offset: Point }
}

export type NavigationEdge = { id: string; from: string; to: string }

export type LayoutRevision = {
  schemaVersion: 'opsidio-layout/0.1'
  id: string
  revision: number
  placements: Placement[]
  nodes: NavigationNode[]
  edges: NavigationEdge[]
}

export type ArrivalWindow = {
  startSeconds: number
  endSeconds: number
  sharePercent: number
}

export type CohortDemand = {
  id: string
  count: number
  arrivalNodeId: string
  destinationNodeId: string
  windows: ArrivalWindow[]
  groupSize?: number
}

export type AbmConfig = {
  seed: number
  timeOrigin: string
  horizonSeconds: number
  walkSpeedMps: number
  nodes: NavigationNode[]
  edges: NavigationEdge[]
  cohorts: CohortDemand[]
}

export type AgentJourney = {
  id: string
  cohortId: string
  groupId: string
  onsiteArrivalSeconds: number
  checkpointArrivalSeconds: number
  routeNodeIds: string[]
  points: Point[]
  walkSeconds: number
}

export type ArrivalBucket = {
  cohortId: string
  startSeconds: number
  endSeconds: number
  onsiteArrivals: number
  checkpointArrivals: number
}

export type AbmResult = {
  seed: number
  timeOrigin: string
  generatedCount: number
  journeys: AgentJourney[]
  arrivalBuckets: ArrivalBucket[]
  issues: string[]
}
