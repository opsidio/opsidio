import type { NavigationNode } from '../runtime-types'
import type { WaypointTraceResult } from './traceWaypoint'
import './WaypointTrace.css'

type TraceNode = Pick<NavigationNode, 'id' | 'role' | 'entryAreaId'> & { label?: string }
type WaypointTraceProps = {
  nodes: readonly TraceNode[]
  entryAreas: readonly { id: string; label: string }[]
  selectedId: string | null
  trace: WaypointTraceResult | null
  onSelect: (id: string | null) => void
  onFocus: () => void
  showRoutes: boolean
  onShowRoutesChange: (show: boolean) => void
  shownOriginId?: string | null
  onShownOriginChange?: (id: string | null) => void
}

const checkpointLabels: Record<string, string> = {
  arrival: 'Forecourt arrival',
  'help-pass': 'Pass help desk',
  help_checkpoint: 'Help desk',
  'help-release': 'Help desk exit',
  'help-rejoin': 'Rejoin the entrance route',
  queue: 'Queue approach',
  queue_wait_tail: 'Queue entrance',
  queue_wait_head: 'Queue front',
  queue_exit: 'Queue exit',
  'queue-exit': 'Queue exit',
  security_checkpoint: 'Security',
  walkway: 'Walk to ticket scan',
  'north-walkway': 'Walk to ticket scan',
  scan_checkpoint: 'Ticket scan',
  'entry-approach': 'Walk to handover',
  destination: 'Admitted area',
}
const defaultLane = new Set(['queue', 'queue_wait_tail', 'queue_wait_head', 'queue-exit', 'security_checkpoint', 'north-walkway', 'scan_checkpoint'])

export function waypointLabel(node: TraceNode) {
  if (node.label) return node.label
  if (node.id === 'approach_osm_309878212') return 'Jalan Plaza Selatan · Ring road junction'
  if (node.id.startsWith('approach_osm_')) return `OSM waypoint ${node.id.slice('approach_osm_'.length)}`
  const areaPrefix = `${node.entryAreaId}_`
  const id = node.id.startsWith(areaPrefix) ? node.id.slice(areaPrefix.length) : node.id
  const lane = /^lane_(\d+)_(.+)$/.exec(id)
  const label = checkpointLabels[lane?.[2] ?? id]
  if (lane && label) return `Lane ${lane[1]} · ${label}`
  if (label) return defaultLane.has(id) ? `Lane 2 · ${label}` : label
  if (id.startsWith('destination_')) return `Handover · ${id.slice('destination_'.length).replaceAll('_', ' ')}`
  return id.replace(/[_-]/g, ' ').replace(/^./, char => char.toUpperCase())
}

export default function WaypointTrace({
  nodes, entryAreas, selectedId, trace, onSelect, onFocus, showRoutes, onShowRoutesChange,
  shownOriginId, onShownOriginChange,
}: WaypointTraceProps) {
  const groups = entryAreas.map(area => ({ ...area, nodes: nodes.filter(node => node.entryAreaId === area.id) }))
  const localIds = new Set(entryAreas.map(area => area.id))
  const shared = nodes.filter(node => !localIds.has(node.entryAreaId ?? ''))
  const selectOptions = (items: readonly TraceNode[]) => items.map(node => <option key={node.id} value={node.id}>{waypointLabel(node)}</option>)
  const tracedOrigins = trace?.origins.filter(origin => origin.routes.length > 0) ?? []

  return <section className="waypoint-trace" aria-label="Waypoint trace">
    <h3>Waypoint trace</h3>
    <label className="waypoint-trace-field">
      Waypoint
      <select value={selectedId ?? ''} onChange={event => onSelect(event.currentTarget.value || null)}>
        <option value="">Select a waypoint</option>
        {groups.map(group => group.nodes.length > 0 && <optgroup key={group.id} label={group.label}>{selectOptions(group.nodes)}</optgroup>)}
        {shared.length > 0 && <optgroup label="Shared approaches">{selectOptions(shared)}</optgroup>}
      </select>
    </label>
    {selectedId && <>
      <div className="waypoint-trace-actions">
        <button type="button" onClick={onFocus}>Focus waypoint</button>
        <label><input type="checkbox" checked={showRoutes} disabled={!trace?.routes.length}
          onChange={event => onShowRoutesChange(event.currentTarget.checked)} /> Show routes to waypoint</label>
      </div>
      <div className="waypoint-trace-results" aria-live="polite">
        {trace === null ? <p>Run the simulation to see which origins feed this waypoint.</p> : trace.total === 0 ?
          <p>No generated journeys use this waypoint.</p> : <>
            <p><strong>{trace.total.toLocaleString()}</strong> people routed through this waypoint</p>
            <ul>
              {trace.origins.map(origin => <li key={origin.id}>
                <span className="waypoint-trace-swatch" style={{ backgroundColor: origin.color }} aria-hidden="true" />
                <span>{origin.label}</span><strong>{origin.count.toLocaleString()}</strong>
              </li>)}
            </ul>
            <p>Totals cover the generated run. Playback time affects who has reached the waypoint.</p>
          </>}
      </div>
      {showRoutes && onShownOriginChange && tracedOrigins.length > 1 && <label className="waypoint-trace-field">
        Origin routes to show
        <select value={shownOriginId ?? ''} onChange={event => onShownOriginChange(event.currentTarget.value || null)}>
          <option value="">All origins</option>
          {tracedOrigins.map(origin => <option key={origin.id} value={origin.id}>{origin.label}</option>)}
        </select>
      </label>}
    </>}
  </section>
}
