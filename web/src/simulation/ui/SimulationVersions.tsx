import type { SimulationVersion } from './useSimulationVersions'
import './SimulationVersions.css'

export default function SimulationVersions({ versions, selectedId, onSelect }: {
  versions: readonly SimulationVersion[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return <label className="sim-version-picker">
    <span>Version</span>
    <select aria-label="Simulation version" title="Saved versions are available in this browser."
      value={selectedId} onChange={event => onSelect(event.target.value)}>
      {versions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>
}
