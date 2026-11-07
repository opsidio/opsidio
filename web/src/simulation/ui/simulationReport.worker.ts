import { generateAbm } from '../abm/generator'
import { compileSimulationPlan } from '../plan/compile'
import { reportShowtime, summarizeReportRun } from './simulationReportData'
import type { ReportRun } from './simulationReportData'

export type ReportRequest = { plans: unknown[]; seed: number }
export type ReportResponse = { runs: ReportRun[] } | { error: string }

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<ReportRequest>) => void) | null
  postMessage: (response: ReportResponse) => void
}

worker.onmessage = ({ data }) => {
  try {
    const runs = data.plans.map(plan => {
      const { config } = compileSimulationPlan(plan)
      const matchedConfig = { ...config, seed: data.seed }
      const result = generateAbm(matchedConfig)
      if (result.issues.length) throw new Error(result.issues[0])
      return summarizeReportRun(matchedConfig, result, reportShowtime(plan))
    })
    worker.postMessage({ runs })
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : 'The report run failed.' })
  }
}
