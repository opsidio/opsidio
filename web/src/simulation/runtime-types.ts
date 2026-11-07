import type { Placement, Point } from './types'

export type NavigationNode = {
  id: string
  role: 'arrival' | 'waypoint' | 'checkpoint' | 'destination'
  position: Point
  entryAreaId?: string
  attachment?: { placementId: string; offset: Point }
}

export type NavigationEdge = { id: string; from: string; to: string; basis?: string }

export type LayoutRevision = {
  schemaVersion: 'opsidio-editor/0.1'
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
  categoryId?: string
  segmentId?: string
  originId?: string
  count: number
  arrivalNodeId: string
  destinationNodeId: string
  windows: ArrivalWindow[]
  groupSize?: number
  walkSpeedMps?: number
  laneCheckpointIds?: string[]
  helpDesk?: { passNodeId: string; checkpointNodeId: string; visitPercent: number }
}

export type ServiceStation = {
  id: string
  nodeId: string
  operatorId: string
  serviceSeconds: number
  opensSeconds: number
  closesSeconds: number
  queueStartNodeId?: string
  queueEndNodeId?: string
  admissionStage?: 'help' | 'security' | 'scan'
}
export type ServiceStop = {
  stationId: string
  operatorId: string
  distanceM: number
  queueStartDistanceM?: number
  queueEndDistanceM?: number
  /** Arrival at the authored queue entrance, or at the checkpoint if it has no queue geometry. */
  arrivalSeconds: number
  startSeconds: number | null
  endSeconds: number | null
  queueIndex: number
}

export type AbmConfig = {
  seed: number
  timeOrigin: string
  horizonSeconds: number
  walkSpeedMps: number
  nodes: NavigationNode[]
  edges: NavigationEdge[]
  cohorts: CohortDemand[]
  serviceStations?: ServiceStation[]
}

export type AgentJourney = {
  id: string
  cohortId: string
  groupId: string
  onsiteArrivalSeconds: number
  /** Walking-only estimate for the first mandatory checkpoint. Service stops carry scheduled arrivals. */
  checkpointArrivalSeconds: number
  routeNodeIds: string[]
  points: Point[]
  walkSeconds: number
  serviceStops?: ServiceStop[]
  completionSeconds?: number | null
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
