import { useEffect, useId, useRef, useState } from 'react'
import type { KitKind, KitPreset, LaneCheck, LanePlan, Placement } from '../types'
import './LayoutInspector.css'

export type LayoutInspectorProps = {
  catalogue: readonly KitPreset[]
  placements: readonly Placement[]
  selectedId: string | null
  lanePlan: LanePlan
  laneCheck: LaneCheck
  message: string | null
  onSelect: (id: string | null) => void
  onChange: (placement: Placement) => void
  onAdd: (presetId: string) => void
  onRemove: (id: string) => void
  onLanePlanChange: (plan: LanePlan) => void
}

function NumberField({ label, value, unit, min, integer, onCommit }: {
  label: string; value: number; unit?: string; min?: number; integer?: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const canceled = useRef(false)
  const id = useId()
  useEffect(() => setDraft(String(value)), [value])
  return <label className="gli-field" htmlFor={id}>
    <span>{label}</span>
    <span className="gli-input-wrap">
      <input id={id} type="number" value={draft} min={min} step={integer ? 1 : 'any'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') {
            event.preventDefault(); canceled.current = true; event.currentTarget.blur()
          }
        }}
        onBlur={() => {
          const next = Number(draft)
          if (!canceled.current && draft.trim() !== '' && Number.isFinite(next)
            && (min === undefined || next >= min) && (!integer || Number.isInteger(next))
            && next !== value) onCommit(next)
          canceled.current = false
          setDraft(String(value))
        }} />
      {unit && <span className="gli-unit" aria-hidden="true">{unit}</span>}
    </span>
  </label>
}

function KitIcon({ kind }: { kind: KitKind }) {
  const paths: Record<KitKind, string> = {
    pagoda: 'M3 10 12 3l9 7H3Zm3 0v11m12-11v11M6 18h12',
    roder: 'm2 10 6-6 14 3v13H2V10Zm0 0h14l6-3M16 10v10M8 4l8 6',
    rowing: 'M3 7h18M5 7v13m7-13v13m7-13v13M3 14h18',
    table: 'M3 7h18v5H3V7Zm2 5v8m14-8v8',
    detector: 'M6 21V3h12v18m-9 0V6h6v15M4 21h6m4 0h6',
  }
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>
}

export default function LayoutInspector(props: LayoutInspectorProps) {
  const { catalogue, placements, selectedId, lanePlan, laneCheck, message,
    onSelect, onChange, onAdd, onRemove, onLanePlanChange } = props
  const selected = placements.find(item => item.id === selectedId)
  const preset = catalogue.find(item => item.id === selected?.presetId)
  const selectId = useId()
  const presetId = useId()
  const depth = preset?.kind === 'roder'
    ? (preset.bayLengthM ?? preset.depthM) * (selected?.bays ?? 1) : preset?.depthM

  return <aside className="gli-inspector" aria-label="Layout inspector">
    <header className="gli-header">
      <div><span className="gli-eyebrow">LAYOUT WORKSPACE</span><h2>Build your checkpoint</h2></div>
      <span className="gli-assumption">Fictional scenario</span>
      <p>Explore kit placement and lane capacity. Planning assumptions, not an operating plan.</p>
    </header>

    <section className="gli-section" aria-labelledby="gli-kit-heading">
      <div className="gli-section-title"><h3 id="gli-kit-heading">Kit palette</h3><span>Click to add</span></div>
      <div className="gli-palette">
        {catalogue.map(item => <button type="button" className="gli-kit" key={item.id} onClick={() => onAdd(item.id)} aria-label={`Add ${item.name}`}>
          <span className="gli-kit-icon"><KitIcon kind={item.kind} /></span>
          <span className="gli-kit-copy"><strong>{item.name}</strong><small>{item.widthM} × {item.depthM} m</small></span>
          <span className="gli-plus" aria-hidden="true">+</span>
        </button>)}
      </div>
    </section>

    <section className="gli-section" aria-labelledby="gli-placement-heading">
      <div className="gli-section-title"><h3 id="gli-placement-heading">Selected object</h3><span>{placements.length} placed</span></div>
      <label className="gli-field" htmlFor={selectId}><span className="gli-sr-only">Select object by label</span>
        <select id={selectId} value={selected?.id ?? ''} onChange={event => onSelect(event.target.value || null)}>
          <option value="">Choose an object…</option>
          {placements.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {selected ? <div className="gli-placement" key={selected.id}>
        <label className="gli-field" htmlFor={presetId}><span>Kit preset</span>
          <select id={presetId} value={selected.presetId} onChange={event => {
            const next = catalogue.find(item => item.id === event.target.value)
            if (!next) return
            const { bays: previousBays, ...base } = selected
            onChange({ ...base, presetId: next.id, ...(next.kind === 'roder' ? { bays: previousBays ?? 1 } : {}) })
          }}>{catalogue.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </label>
        <div className="gli-fields gli-fields-three">
          <NumberField label="X position" unit="m" value={selected.position[0]} onCommit={x => onChange({ ...selected, position: [x, selected.position[1], selected.position[2]] })} />
          <NumberField label="Z position" unit="m" value={selected.position[2]} onCommit={z => onChange({ ...selected, position: [selected.position[0], selected.position[1], z] })} />
          <NumberField label="Rotation" unit="°" value={selected.yawDeg} onCommit={yawDeg => onChange({ ...selected, yawDeg })} />
        </div>
        {preset?.kind === 'roder' && <NumberField label="Roder bays" unit="bays" min={1} integer value={selected.bays ?? 1} onCommit={bays => onChange({ ...selected, bays })} />}
        {preset && <div className="gli-source">
          <div><strong>{preset.widthM} × {depth} × {preset.heightM} m</strong><span>Width × depth × height</span></div>
          <a href={preset.sourceUrl} target="_blank" rel="noreferrer">Kit source ↗</a>
          {preset.notes && <p>{preset.notes}</p>}
        </div>}
        <div className="gli-edit-footer"><span>Enter or blur to apply · Esc to cancel</span><button type="button" className="gli-remove" onClick={() => onRemove(selected.id)}>Remove</button></div>
      </div> : <div className="gli-empty">Select a kit on the map or choose its label above to edit position and size.</div>}
    </section>

    <section className="gli-section gli-lanes" aria-labelledby="gli-lane-heading">
      <div className="gli-section-title"><h3 id="gli-lane-heading">Lane capacity</h3><span className={`gli-status ${laneCheck.valid ? 'gli-status-ok' : 'gli-status-blocked'}`}>{laneCheck.valid ? 'Within limits' : 'Blocked'}</span></div>
      <div className="gli-fields gli-fields-three">
        <NumberField label="Planned lanes" min={1} integer value={lanePlan.planned} onCommit={planned => onLanePlanChange({ ...lanePlan, planned })} />
        <NumberField label="Scanners" min={0} integer value={lanePlan.scanners} onCommit={scanners => onLanePlanChange({ ...lanePlan, scanners })} />
        <NumberField label="Crew" min={0} integer value={lanePlan.crew} onCommit={crew => onLanePlanChange({ ...lanePlan, crew })} />
      </div>
      <dl className="gli-capacity"><div><dt>Physical room</dt><dd>{laneCheck.physical}<small> lanes</small></dd></div><div><dt>Feasible now</dt><dd>{laneCheck.feasible}<small> lanes</small></dd></div></dl>
      <div className={`gli-lane-result ${laneCheck.valid ? '' : 'gli-lane-result-blocked'}`} aria-live="polite">
        <strong>{laneCheck.valid ? `${lanePlan.planned} planned lanes fit available capacity.` : `${lanePlan.planned} planned · ${laneCheck.feasible} feasible`}</strong>
        {laneCheck.limiting.length > 0 && <ul>{laneCheck.limiting.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>}
      </div>
      <button type="button" className="gli-demo" onClick={() => onLanePlanChange({ ...lanePlan, planned: 5, scanners: 4 })}>Try 5 lanes with 4 scanners <span aria-hidden="true">→</span></button>
    </section>
    {message && <div className="gli-message" role="status">{message}</div>}
  </aside>
}
