import type { AbmConfig, AbmResult, ServiceStation } from '../runtime-types'
import { createConfigHash } from '../abm/worker-protocol.ts'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
export const reportMoney = (value: number) => idr.format(value)

function sum(values: readonly (number | null)[]): number | null {
  return values.some(value => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

export function reportCosts(plan: unknown) {
  const data = row(plan)
  const staffing = row(data.staff)
  const items = row(row(data.constraints).equipment).items
  const roles = rows(staffing.roles)
  const headcount = Array.isArray(staffing.roles) ? sum(roles.map(role => count(role.count))) : null
  const wages = headcount === null ? null : sum(roles.map(role => {
    const staffCount = count(role.count), rate = count(role.rate_idr_per_shift)
    return staffCount === null || rate === null ? null : staffCount * rate
  }))
  const allowance = count(staffing.meal_allowance_idr_per_person)
  const meals = headcount === null || allowance === null ? null : headcount * allowance
  const equipment = Array.isArray(items) ? sum(rows(items).map(item => count(item.committed_cost_idr))) : null
  return { headcount, wages, meals, equipment, total: sum([wages, meals, equipment]) }
}

export function reportShowtime(plan: unknown): string | null {
  const clock = row(row(row(plan).event).schedule).main_act
  return typeof clock === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : null
}

export function hasOneWayAdmission(plan: unknown): boolean {
  return row(row(plan).spatial_context).one_way_admission === true
}

export function reportPlanChanges(from: unknown, to: unknown): string[] {
  const previous = row(from), current = row(to)
  const previousLayout = row(row(previous.venue).layout), currentLayout = row(row(current.venue).layout)
  const priorGates = new Map(rows(previousLayout.gates).map(gate => [gate.id, gate]))
  const changes: string[] = []
  const lanes = (gate: Row) => sum(rows(gate.lanes).map(lane => count(lane.count)))
  for (const gate of rows(currentLayout.gates)) {
    const old = priorGates.get(gate.id)
    const label = String(gate.name ?? gate.id)
    if (!old) changes.push(`${label} added.`)
    else {
      if (lanes(old) !== lanes(gate)) changes.push(`${label} staffed lanes · ${lanes(old) ?? '—'} → ${lanes(gate) ?? '—'}.`)
      if (old.opens !== gate.opens || old.closes !== gate.closes) {
        changes.push(`${label} hours · ${old.opens ?? '—'}–${old.closes ?? '—'} → ${gate.opens ?? '—'}–${gate.closes ?? '—'} WIB.`)
      }
    }
    priorGates.delete(gate.id)
  }
  for (const gate of priorGates.values()) changes.push(`${gate.name ?? gate.id} removed.`)

  const previousCosts = reportCosts(from), currentCosts = reportCosts(to)
  if (previousCosts.headcount !== currentCosts.headcount) changes.push(`Staff headcount · ${previousCosts.headcount ?? '—'} → ${currentCosts.headcount ?? '—'}.`)
  const previousStaff = row(previous.staff), currentStaff = row(current.staff)
  const previousRoles = new Map(rows(previousStaff.roles).map(role => [role.id, role]))
  const roleChanges: string[] = []
  for (const role of rows(currentStaff.roles)) {
    const old = previousRoles.get(role.id)
    const label = String(role.name ?? role.id)
    if (!old) {
      roleChanges.push(`${label} role added.`)
      continue
    }
    previousRoles.delete(role.id)
    const oldRate = count(old.rate_idr_per_shift), newRate = count(role.rate_idr_per_shift)
    if (old.count !== role.count) roleChanges.push(`${label} headcount · ${old.count ?? '—'} → ${role.count ?? '—'}.`)
    if (oldRate !== newRate) {
      roleChanges.push(`${label} wage per shift · ${oldRate === null ? '—' : reportMoney(oldRate)} → ${newRate === null ? '—' : reportMoney(newRate)}.`)
    }
  }
  for (const role of previousRoles.values()) roleChanges.push(`${role.name ?? role.id} role removed.`)
  if (roleChanges.length > 0) changes.push(...roleChanges)
  else if (different(previousStaff.roles, currentStaff.roles)) changes.push('Staff role or assignment details changed.')
  if (different(previousStaff.shifts, currentStaff.shifts)) changes.push('Staff shifts changed.')
  if (previousStaff.meal_allowance_idr_per_person !== currentStaff.meal_allowance_idr_per_person) changes.push('Staff meal allowance changed.')
  if (reportShowtime(from) !== reportShowtime(to)) {
    changes.push(`Main act · ${reportShowtime(from) ?? '—'} → ${reportShowtime(to) ?? '—'} WIB.`)
  }
  if (different(row(previous.event).ticket_categories, row(current.event).ticket_categories)
    || different(row(previous.event).capacity, row(current.event).capacity)) changes.push('Ticket categories or attendance inputs changed.')
  if (different(previous.demand, current.demand) || different(previous.behavior_context, current.behavior_context)) changes.push('Arrival or attendee behavior assumptions changed.')
  if (different(previous.process_steps, current.process_steps) || different(previousLayout.service_points, currentLayout.service_points)) changes.push('Checkpoint or service inputs changed.')
  if (different(row(previous.constraints).equipment, row(current.constraints).equipment)) changes.push('Equipment quantities or commitments changed.')
  if (different(row(previous.constraints).budget, row(current.constraints).budget)) changes.push('Budget caps changed.')
  const previousSpatial = row(previous.spatial_context), currentSpatial = row(current.spatial_context)
  if (different(previousSpatial.placements, currentSpatial.placements)) changes.push('Equipment placement changed.')
  if (different(previousSpatial.navigation, currentSpatial.navigation)) changes.push('Routes or waypoints changed.')
  return changes
}

function different(a: unknown, b: unknown): boolean {
  return a !== b && createConfigHash(a ?? null) !== createConfigHash(b ?? null)
}

export const reportStages = [
  { id: 'help', label: 'Ticket help desk' },
  { id: 'security', label: 'Security screening' },
  { id: 'scan', label: 'Ticket scan and wristband' },
] as const

type Stage = NonNullable<ServiceStation['admissionStage']>
type CheckpointMetrics = { peak: number; p90WaitSeconds: number | null; processed: number }

export type ReportRun = {
  seed: number
  arrivals: number
  admittedByShowtime: number | null
  admittedByRunEnd: number | null
  p90GateWaitSeconds: number | null
  gateWaitSample: number
  checkpoints: Partial<Record<Stage, CheckpointMetrics>>
}

function p90(samples: number[]): number | null {
  if (!samples.length) return null
  samples.sort((a, b) => a - b)
  return samples[Math.ceil(samples.length * .9) - 1]
}

function peakQueue(arrivals: number[], starts: number[]): number {
  arrivals.sort((a, b) => a - b)
  starts.sort((a, b) => a - b)
  let peak = 0, started = 0
  for (const [index, time] of arrivals.entries()) {
    while (started < starts.length && starts[started] <= time) started++
    peak = Math.max(peak, index + 1 - started)
  }
  return peak
}

const clockSeconds = (value: string) => Number(value.slice(0, 2)) * 3600 + Number(value.slice(3, 5)) * 60

export function summarizeReportRun(config: AbmConfig, result: AbmResult, showtime: string | null): ReportRun {
  const stageByStation = new Map(config.serviceStations?.map(station => [station.id, station.admissionStage]))
  const stages = new Map<Stage, { arrivals: number[]; starts: number[]; waits: number[]; processed: number }>()
  for (const stage of stageByStation.values()) if (stage && !stages.has(stage)) {
    stages.set(stage, { arrivals: [], starts: [], waits: [], processed: 0 })
  }
  const cutoff = showtime === null ? null : clockSeconds(showtime) - clockSeconds(config.timeOrigin.slice(11, 16))
  const end = config.horizonSeconds
  const totalWaits: number[] = []
  let admittedByShowtime = 0, admittedByRunEnd = 0
  for (const journey of result.journeys) {
    const completion = journey.completionSeconds
    const complete = completion != null && completion <= end
    if (complete) {
      admittedByRunEnd++
      if (cutoff !== null && completion <= cutoff) admittedByShowtime++
    }
    let gateWait = 0
    let measured = false
    for (const stop of journey.serviceStops ?? []) {
      if (stop.arrivalSeconds > end) continue
      const stage = stageByStation.get(stop.stationId)
      const metrics = stage ? stages.get(stage) : undefined
      const start = stop.startSeconds
      if (start !== null && start <= end) {
        const wait = Math.max(0, start - stop.arrivalSeconds)
        gateWait += wait
        measured = true
        metrics?.waits.push(wait)
      }
      if (metrics) {
        metrics.arrivals.push(stop.arrivalSeconds)
        if (start !== null && start <= end) metrics.starts.push(start)
        if (stop.endSeconds !== null && stop.endSeconds <= end) metrics.processed++
      }
    }
    if (complete && measured) totalWaits.push(gateWait)
  }
  const hasAdmission = stageByStation.size > 0
  const checkpoints: ReportRun['checkpoints'] = {}
  for (const [id, stage] of stages) checkpoints[id] = {
    peak: peakQueue(stage.arrivals, stage.starts), p90WaitSeconds: p90(stage.waits), processed: stage.processed,
  }
  return {
    seed: result.seed, arrivals: result.generatedCount,
    admittedByShowtime: hasAdmission && cutoff !== null && cutoff >= 0 && cutoff <= end ? admittedByShowtime : null,
    admittedByRunEnd: hasAdmission ? admittedByRunEnd : null,
    p90GateWaitSeconds: p90(totalWaits), gateWaitSample: totalWaits.length, checkpoints,
  }
}
