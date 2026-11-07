import type { ReactNode } from 'react'
import { Brand } from '../../brand/Brand'
import './SimulationChrome.css'

export type SimulationTool = 'editor' | 'controls' | 'report' | 'optimize'

const tools: readonly { id: SimulationTool; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'controls', label: 'Control Panel' },
  { id: 'report', label: 'Report' },
  { id: 'optimize', label: 'Optimize' },
]

export function SimulationToolbar({ active, revision, versionPicker, eventName, backToPlan, onSelect }: {
  active: SimulationTool | null
  revision: number
  versionPicker?: ReactNode
  eventName?: string
  backToPlan?: string
  onSelect: (tool: SimulationTool) => void
}) {
  return <header className="sim-toolbar">
    <div className="sim-toolbar-identity">
      <Brand />
      <div className="sim-toolbar-context"><strong>{eventName || 'GBK Simulation'}</strong>
        <small>{backToPlan ? <a href={backToPlan}>Back to plan</a> : 'Coldplay demo'} · Revision {revision}</small>
      </div>
    </div>
    {versionPicker && <div className="sim-toolbar-version">{versionPicker}</div>}
    <nav className="sim-toolbar-actions" aria-label="Simulation tools">
      {tools.map(({ id, label }) => <button key={id} type="button" data-tool={id} aria-expanded={active === id} aria-controls={`simulation-${id}`} onClick={() => onSelect(id)}>{label}</button>)}
    </nav>
  </header>
}

export function SimulationDrawer({ tool, active, description, onClose, children }: {
  tool: SimulationTool
  active: boolean
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const title = tools.find(item => item.id === tool)?.label
  return <section className="sim-drawer" id={`simulation-${tool}`} aria-labelledby={`simulation-${tool}-title`} hidden={!active}
    onKeyDown={event => {
      if (event.defaultPrevented || event.key !== 'Escape' || event.target instanceof HTMLElement && event.target.matches('input, select, textarea, [contenteditable="true"]')) return
      onClose()
    }}>
    <header className="sim-drawer-header">
      <div><h2 id={`simulation-${tool}-title`}>{title}</h2>{description && <p>{description}</p>}</div>
      <button type="button" className="sim-drawer-close" aria-label={`Close ${title}`} onClick={onClose}>×</button>
    </header>
    <div className="sim-drawer-body">{children}</div>
  </section>
}
