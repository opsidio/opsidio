import { useEffect, useId, useRef, useState } from 'react'
import type { NavigationNode } from '../runtime-types'
import { placementDimensions, type EditorArea } from './core'
import type { LayoutEditorController } from './useLayoutEditor'
import './LayoutEditor.css'

function NumberField({ label, value, onChange, min, max, integer = false }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; integer?: boolean
}) {
  const [text, setText] = useState(String(value))
  const canceled = useRef(false)
  useEffect(() => setText(String(Number(value.toFixed(4)))), [value])
  return <label className="ole-field"><span>{label}</span><input type="number" value={text} min={min} max={max} step={integer ? 1 : 0.1}
    onChange={event => setText(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { canceled.current = true; event.currentTarget.blur() } }}
    onBlur={() => {
      const number = Number(text)
      if (!canceled.current && text.trim() && Number.isFinite(number) && (!integer || Number.isInteger(number)) && (min === undefined || number >= min) && (max === undefined || number <= max) && number !== value) onChange(number)
      canceled.current = false; setText(String(Number(value.toFixed(4))))
    }} /></label>
}

function LabelField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const canceled = useRef(false)
  useEffect(() => setDraft(value), [value])
  return <label className="ole-field"><span>Label</span><input value={draft} onChange={event => setDraft(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { canceled.current = true; event.currentTarget.blur() } }}
    onBlur={() => { if (!canceled.current && draft.trim() && draft !== value) onChange(draft.trim()); canceled.current = false; setDraft(value) }} /></label>
}

export type LayoutEditorProps = { editor: LayoutEditorController; className?: string; onClose?: () => void; onAreaChange?: (area: EditorArea | null) => void }

/** The host opts in by mounting this panel. It does not mount or change any scene/camera. */
export function LayoutEditor({ editor, className = '', onClose, onAreaChange }: LayoutEditorProps) {
  const [tab, setTab] = useState<'kit' | 'graph' | 'json'>('kit')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [json, setJSON] = useState(editor.recoveryJSON ?? ''), [fileError, setFileError] = useState<string | null>(null)
  const [newRole, setNewRole] = useState<NavigationNode['role']>('waypoint')
  const titleId = useId()
  const area = editor.areas.find(item => item.id === editor.activeAreaId)
  const marker = editor.layout.markers?.find(item => item.id === editor.selectedMarkerId)
  const visibleMarkers = (editor.layout.markers ?? []).filter(item => !editor.activeAreaId || item.entryAreaId === editor.activeAreaId)
  const selected = editor.layout.placements.find(item => item.id === editor.selectedPlacementId)
  const preset = editor.catalogue.find(item => item.id === selected?.presetId)
  const node = editor.layout.nodes.find(item => item.id === editor.selectedNodeId)
  const resolvedNode = editor.graph.nodes.find(item => item.id === node?.id)
  const dimensions = selected ? placementDimensions(selected, editor.catalogue) : null
  const errors = editor.validation.issues.filter(issue => issue.severity === 'error')
  const warnings = editor.validation.issues.filter(issue => issue.severity === 'warning')
  const issues = [...editor.actionIssues, ...editor.validation.issues]
  useEffect(() => { if (editor.selectedNodeId) setTab('graph') }, [editor.selectedNodeId])
  function download() {
    const url = URL.createObjectURL(new Blob([editor.exportJSON()], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${editor.layout.id}-r${editor.layout.revision}.json`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <aside className={`ole-panel ${className}`} aria-labelledby={titleId} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <header className="ole-header"><div><small>LAYOUT EDITOR · REV {editor.layout.revision}</small><h2 id={titleId}>{area?.label ?? (editor.areas.length ? 'Whole venue layout' : 'Entry layout')}</h2></div>{onClose && <button type="button" className="ole-close" onClick={onClose} aria-label="Close layout editor">×</button>}</header>
    {editor.areas.length > 0 && <div className="ole-scope"><label className="ole-field"><span>Editing area</span><select value={editor.activeAreaId ?? ''} onChange={event => { const id = event.target.value || null; editor.selectArea(id); setFrom(''); setTo(''); onAreaChange?.(editor.areas.find(item => item.id === id) ?? null) }}><option value="">All areas and connections</option>{editor.areas.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><p className="ole-note">Choose an area, then select equipment or a waypoint. Ground clicks move the selected item; coordinates also work. Existing source positions are retained until you edit them.</p></div>}
    <div className="ole-status" data-valid={editor.validation.valid} role="status"><strong>{editor.validation.valid ? 'Geometry checks passed' : `${errors.length} issue${errors.length === 1 ? '' : 's'} to repair`}</strong><span>{warnings.length ? `${warnings.length} review warning${warnings.length === 1 ? '' : 's'}` : 'Fictional scenario · metres'}</span></div>
    <nav className="ole-tabs" aria-label="Layout editing sections">{(['kit', 'graph', 'json'] as const).map(item => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>{item === 'kit' ? 'Equipment' : item === 'graph' ? 'Waypoints' : 'Save / import'}</button>)}</nav>
    <div className="ole-body">
      {tab === 'kit' && <>
        <div className="ole-palette">{editor.catalogue.map(item => <button key={item.id} type="button" onClick={() => editor.addPlacement(item.id)}><strong>+ {item.name}</strong><small>{item.widthM} × {item.kind === 'roder' ? `${item.bayLengthM ?? item.depthM} / bay` : item.depthM} m</small></button>)}</div>
        <label className="ole-field"><span>Placement · {editor.visiblePlacements.length} objects</span><select value={selected?.id ?? ''} onChange={event => editor.selectPlacement(event.target.value || null)}><option value="">Select on scene or choose here</option>{editor.visiblePlacements.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {selected ? <div className="ole-stack" key={selected.id}>
          <LabelField value={selected.label} onChange={label => editor.updatePlacement({ ...selected, label })} />
          <label className="ole-field"><span>Kit preset</span><select value={selected.presetId} onChange={event => {
            const next = editor.catalogue.find(item => item.id === event.target.value)
            if (!next) return
            const { bays: previous, ...base } = selected
            editor.updatePlacement({ ...base, presetId: next.id, ...(next.kind === 'roder' ? { bays: previous ?? 2 } : {}) })
          }}>{!preset && <option value={selected.presetId}>Unknown: {selected.presetId}</option>}{editor.catalogue.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="ole-grid"><NumberField label="X east (m)" value={selected.position[0]} onChange={x => editor.updatePlacement({ ...selected, position: [x, 0, selected.position[2]] })} /><NumberField label="Z south (m)" value={selected.position[2]} onChange={z => editor.updatePlacement({ ...selected, position: [selected.position[0], 0, z] })} /><NumberField label="Yaw (°)" value={selected.yawDeg} onChange={yawDeg => editor.updatePlacement({ ...selected, yawDeg })} /></div>
          {preset?.kind === 'roder' && <NumberField label={`Roder bays (${preset.bayLengthM ?? preset.depthM} m each)`} value={selected.bays ?? 1} min={1} max={12} integer onChange={bays => editor.updatePlacement({ ...selected, bays })} />}
          {preset && dimensions && <p className="ole-note">{dimensions[0].toFixed(2)} × {dimensions[1].toFixed(2)} m footprint · {preset.heightM} m high. <a href={preset.sourceUrl} target="_blank" rel="noreferrer">Catalogue source ↗</a></p>}
          <div className="ole-row"><code title={selected.id}>{selected.id}</code><button type="button" className="ole-danger" onClick={() => editor.removePlacement(selected.id)}>Remove</button></div>
          <p className="ole-note">Select an object, then click the ground to move it. Enter or blur applies numeric fields. Esc cancels.</p>
        </div> : <p className="ole-note">Choose a placement to move, rotate, or resize it.</p>}
      </>}
      {tab === 'graph' && <>
        <div className="ole-row"><strong>Authored directed graph</strong></div>
        <div className="ole-grid ole-grid-two"><label className="ole-field"><span>New node role</span><select value={newRole} onChange={event => setNewRole(event.target.value as NavigationNode['role'])}><option value="waypoint">Waypoint</option><option value="arrival">Entry / arrival</option><option value="destination">Destination</option><option value="checkpoint">Checkpoint</option></select></label><button type="button" onClick={() => editor.addNode(newRole)}>+ Add node</button></div>
        <p className="ole-note">Move an existing entry or destination to keep demand assignments. New nodes need directed connections; adding a node does not assign attendees. For the shared drop-off, select Shared origins, then origin_dropoff.</p>
        {visibleMarkers.length > 0 && <section className="ole-connect"><h3>Gate location marker</h3><label className="ole-field"><span>Visual marker only</span><select value={marker?.id ?? ''} onChange={event => editor.selectMarker(event.target.value || null)}><option value="">Choose gate marker…</option>{visibleMarkers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{marker && <div className="ole-grid ole-grid-two"><NumberField label="Marker X (m)" value={marker.position[0]} onChange={x => editor.moveMarker(marker.id, [x, 0, marker.position[2]])} /><NumberField label="Marker Z (m)" value={marker.position[2]} onChange={z => editor.moveMarker(marker.id, [marker.position[0], 0, z])} /></div>}<p className="ole-note">Moving this sign does not relocate flow or equipment. Move the entry, checkpoints and destination waypoints to change the route.</p></section>}
        <label className="ole-field"><span>Node · {editor.visibleNodes.length} nodes</span><select value={node?.id ?? ''} onChange={event => editor.selectNode(event.target.value || null)}><option value="">Choose a waypoint or checkpoint</option>{editor.visibleNodes.map(item => <option key={item.id} value={item.id}>{item.id} · {item.role}</option>)}</select></label>
        {node && <div className="ole-stack" key={node.id}>
          <label className="ole-field"><span>Role</span><select value={node.role} onChange={event => editor.updateNode({ ...node, role: event.target.value as NavigationNode['role'] })}>{['arrival', 'waypoint', 'checkpoint', 'destination'].map(role => <option key={role} value={role}>{role}</option>)}</select></label>
          <div className="ole-grid ole-grid-two"><NumberField label="World X (m)" value={(resolvedNode ?? node).position[0]} onChange={x => editor.moveNode(node.id, [x, 0, (resolvedNode ?? node).position[2]])} /><NumberField label="World Z (m)" value={(resolvedNode ?? node).position[2]} onChange={z => editor.moveNode(node.id, [(resolvedNode ?? node).position[0], 0, z])} /></div>
          <label className="ole-field"><span>Attachment</span><select value={node.attachment?.placementId ?? ''} onChange={event => editor.attachNode(node.id, event.target.value || null)}><option value="">Fixed ground coordinate</option>{node.attachment && !editor.layout.placements.some(item => item.id === node.attachment!.placementId) && <option value={node.attachment.placementId}>Missing: {node.attachment.placementId}</option>}{editor.visiblePlacements.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {node.attachment && <p className="ole-note">Follows placement yaw and movement. Local offset: {node.attachment.offset.map(value => value.toFixed(2)).join(', ')} m. Moving the node changes its offset.</p>}
          <p className="ole-note">Area binding: {node.entryAreaId ?? 'Unassigned'}. IDs and operational assignments stay stable while positions change.</p>
          <div className="ole-row"><code title={node.id}>{node.id}</code><button type="button" className="ole-danger" onClick={() => editor.removeNode(node.id)}>Remove node</button></div>
          <p className="ole-note">Select a node here, then click the ground to move it. Required nodes and referenced placements are protected.</p>
        </div>}
        <section className="ole-connect"><h3>Connect two nodes · one way</h3><div className="ole-grid ole-grid-two"><label className="ole-field"><span>From</span><select value={from} onChange={event => setFrom(event.target.value)}><option value="">Choose…</option>{editor.layout.nodes.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label><label className="ole-field"><span>To</span><select value={to} onChange={event => setTo(event.target.value)}><option value="">Choose…</option>{editor.layout.nodes.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label></div><button type="button" disabled={!from || !to || from === to} onClick={() => editor.connectNodes(from, to)}>Connect {from ? '→' : 'nodes'}</button></section>
        <div className="ole-edge-list" aria-label="Directed edges">{editor.visibleEdges.map(edge => <div className="ole-edge" key={edge.id}><span title={edge.id}>{edge.from} <b>→</b> {edge.to}</span><button type="button" aria-label={`Remove edge ${edge.from} to ${edge.to}`} onClick={() => editor.removeEdge(edge.id)}>×</button></div>)}</div>
        <p className="ole-note">From → To creates only that direction. Select endpoints from any area to connect shared origins and entries. Remove obsolete edges explicitly; no automatic detours are created. Missing or blocked edges prevent simulation.</p>
      </>}
      {tab === 'json' && <>
        <p className="ole-note">The browser keeps edited revisions when storage is available. JSON includes stable IDs, placements, node attachments, and directed edges. Invalid geometry can be saved as a draft; it cannot be simulated.</p>
        <div className="ole-row"><button type="button" onClick={download}>Download JSON</button><button type="button" onClick={() => setJSON(editor.exportJSON())}>Show current JSON</button></div>
        <label className="ole-field"><span>Open a layout JSON file</span><input type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]
          if (!file) return
          if (file.size > 2_000_000) { setFileError('Layout JSON is limited to 2 MB.'); return }
          try { setJSON(await file.text()); setFileError(null) } catch { setFileError('Could not read the selected file.') }
          event.target.value = ''
        }} /></label>
        <label className="ole-field"><span>Layout JSON</span><textarea rows={14} value={json} spellCheck={false} onChange={event => setJSON(event.target.value)} placeholder="Paste JSON or open a file, then import." /></label>
        {fileError && <p role="alert">{fileError}</p>}
        <button type="button" disabled={!json.trim()} onClick={() => editor.importJSON(json)}>Import and validate</button>
        <details className="ole-assumptions"><summary>Scenario geometry assumptions</summary><p>Ground plane Y = 0 m. Routes use {editor.assumptions.routeClearanceM} m clearance beyond solid footprints. Barrier depth includes its feet. Canopy interiors and detector passages are open; support feet remain obstacles. Tent feet use illustrative {editor.assumptions.pagodaFootWidthM} m pagoda bases and {editor.assumptions.roderFootWidthM} × {editor.assumptions.roderFootDepthM} m Roder bases. Canopy overlaps need roof and rigging review. Site terrain, ballast, crowd clearance and operating approval are not checked.</p></details>
      </>}
      {issues.length > 0 && <details className="ole-issues" open><summary>Validation · {issues.length}</summary><ul>{issues.slice(0, 30).map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`} data-severity={issue.severity}><strong>{issue.code.replaceAll('_', ' ')}</strong><span>{issue.message}</span></li>)}</ul>{issues.length > 30 && <p>{issues.length - 30} more issues. Repair the listed references first.</p>}</details>}
    </div>
    <footer className="ole-footer"><div className="ole-row"><button type="button" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button><button type="button" onClick={editor.reset}>Reset draft</button><span>1 unit = 1 m</span></div>{editor.message && <p role="status">{editor.message}</p>}</footer>
  </aside>
}
export default LayoutEditor
