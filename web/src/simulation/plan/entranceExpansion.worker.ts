import { generateAbm } from '../abm/generator.ts'
import { reportShowtime, summarizeReportRun, type ReportRun } from '../ui/simulationReportData.ts'
import { compileSimulationPlan } from './compile.ts'
import { expansionPlans, type Expansion } from './entranceExpansion.ts'
import { editableGates } from './operatingInputs.ts'

export type ExpansionRequest = { activePlan: unknown; authoredPlan: unknown; gateId: string }
export type ExpansionRun = Expansion & { metrics: ReportRun }
export type ExpansionResult = { baseline: ReportRun; proposals: ExpansionRun[]; recommendedLanes: number | null; skipped: string[] }
export type ExpansionResponse = ExpansionResult | { error: string }

function simulate(plan: unknown, gateId: string): ReportRun {
  const { config, nodes, operators } = compileSimulationPlan(plan)
  const gateOperators = operators.filter(operator => operator.pointId === gateId)
  const areaId = gateOperators[0]?.entryAreaId
  const destinations = new Set(nodes.filter(node => node.entryAreaId === areaId && node.role === 'destination').map(node => node.id))
  const operatorIds = new Set(operators.filter(operator => operator.entryAreaId === areaId).map(operator => operator.id))
  const gateConfig = { ...config, cohorts: config.cohorts.filter(cohort => destinations.has(cohort.destinationNodeId)),
    serviceStations: config.serviceStations?.filter(station => operatorIds.has(station.operatorId)) }
  if (!gateConfig.cohorts.some(cohort => cohort.count > 0)) throw new Error('There are no planned attendees at this entrance.')
  const result = generateAbm(gateConfig)
  if (result.issues.length) throw new Error(result.issues[0])
  return summarizeReportRun(gateConfig, result, reportShowtime(plan))
}

export const peakEntryQueue = (run: ReportRun) => Math.max(run.checkpoints.security?.peak ?? 0, run.checkpoints.scan?.peak ?? 0)

function performance(run: ReportRun) {
  return [
    run.admittedByShowtime ?? 0, run.admittedByRunEnd ?? 0, -peakEntryQueue(run),
    -(run.p90GateWaitSeconds ?? Infinity),
  ]
}

function compare(left: ReportRun, right: ReportRun) {
  const a = performance(left), b = performance(right)
  for (const [index, value] of a.entries()) if (value !== b[index]) return value > b[index] ? 1 : -1
  return 0
}

export function optimizeEntrance({ activePlan, authoredPlan, gateId }: ExpansionRequest): ExpansionResult {
  const baseline = simulate(activePlan, gateId)
  const { proposals, skipped } = expansionPlans(activePlan, authoredPlan, gateId)
  const active = editableGates(activePlan).find(gate => gate.id === gateId)!
  let best = { lanes: active.lanes, metrics: baseline }
  const runs = proposals.flatMap(proposal => {
    try {
      const metrics = simulate(proposal.plan, gateId)
      if (metrics.arrivals !== baseline.arrivals || metrics.seed !== baseline.seed) throw new Error('The proposed simulation did not match baseline demand.')
      if (compare(metrics, best.metrics) > 0) best = { lanes: proposal.lanes, metrics }
      return [{ ...proposal, metrics }]
    } catch (error) {
      skipped.push(`${proposal.lanes} lanes: ${error instanceof Error ? error.message : 'Could not simulate this layout.'}`)
      return []
    }
  })
  return { baseline, proposals: runs, recommendedLanes: best.lanes === active.lanes ? null : best.lanes, skipped }
}

if (typeof self !== 'undefined') {
  self.onmessage = (event: MessageEvent<ExpansionRequest>) => {
    try {
      self.postMessage(optimizeEntrance(event.data) satisfies ExpansionResponse)
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : 'The entrance comparison failed.' } satisfies ExpansionResponse)
    }
  }
}
