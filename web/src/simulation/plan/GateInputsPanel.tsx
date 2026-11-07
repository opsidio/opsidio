import type { EditableGate, GateInputs } from './operatingInputs'
import '../ui/OperationPanels.css'

export default function GateInputsPanel({ gates, edits, error, onChange, onReset, onClose }: {
  gates: readonly EditableGate[]
  edits: Readonly<Record<string, GateInputs>>
  error?: string | null
  onChange: (id: string, edit: GateInputs) => void
  onReset: () => void
  onClose?: () => void
}) {
  return <section className="gate-operations-panel" aria-label="Gate operations">
    <header><strong>Gate operations</strong>{onClose && <button type="button" aria-label="Close gate operations" onClick={onClose}>×</button>}</header>
    <p>Each staffed lane uses one security officer and one scan operator. Available lanes come from the layout.</p>
    {error && <p role="alert">{error}</p>}
    {gates.length ? gates.map(gate => {
      const current = edits[gate.id] ?? gate
      return <fieldset className="gate-inputs" key={gate.id}>
        <legend>{gate.label}</legend>
        <label>Staffed lanes <select value={current.lanes} onChange={event => onChange(gate.id, { ...current, lanes: Number(event.target.value) })}>
          {Array.from({ length: gate.maxLanes }, (_, index) => <option value={index + 1} key={index}>{index + 1}</option>)}
        </select></label>
        <label>Open <input type="time" value={current.opens} onChange={event => { if (event.target.value) onChange(gate.id, { ...current, opens: event.target.value }) }} /></label>
        <label>Close <input type="time" value={current.closes} onChange={event => { if (event.target.value) onChange(gate.id, { ...current, closes: event.target.value }) }} /></label>
      </fieldset>
    }) : <p>This plan needs authored security and scan positions before staffing can be changed here.</p>}
    <button onClick={onReset} disabled={!Object.keys(edits).length}>Reset gate inputs</button>
  </section>
}
