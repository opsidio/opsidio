import { useEffect, useMemo, useRef, useState } from 'react'
import { catalogue as defaultCatalogue, initialDraft } from '../model'
import type { LayoutRevision, NavigationNode } from '../runtime-types'
import type { KitPreset, Placement, Point } from '../types'
import {
  createLayoutRevision, DEFAULT_ASSUMPTIONS, DEMO_REQUIRED_ROUTES, exportLayoutJSON,
  importLayoutJSON, inspectLayoutShape, localToWorld, nodeRemovalIssue, persistLayout,
  placementRemovalIssue, restoreLayout, validateLayout, worldToLocal,
  type LayoutIssue, type LayoutValidationOptions,
} from './core'

export const DEFAULT_STORAGE_KEY = 'opsidio-editor:0.1:gbk-north'
export const createInitialLayout = (): LayoutRevision => createLayoutRevision(initialDraft().placements)
export type LayoutEditorOptions = Omit<LayoutValidationOptions, 'catalogue'> & {
  catalogue?: readonly KitPreset[]
  initialLayout?: LayoutRevision
  /** null disables browser persistence. No storage access is required for the editor. */
  storageKey?: string | null
  onChange?: (layout: LayoutRevision) => void
}
type State = {
  layout: LayoutRevision
  selectedPlacementId: string | null
  selectedNodeId: string | null
  actionIssues: LayoutIssue[]
  message: string | null
  changed: boolean
  history: LayoutRevision[]
  recoveryJSON: string | null
}
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const rounded = (point: Point): Point => [Math.round(point[0] * 100) / 100, 0, Math.round(point[2] * 100) / 100]

export function useLayoutEditor(options: LayoutEditorOptions) {
  const catalogue = options.catalogue ?? defaultCatalogue
  const requiredRoutes = options.requiredRoutes ?? DEMO_REQUIRED_ROUTES
  const assumptions = options.assumptions ?? DEFAULT_ASSUMPTIONS
  const validationOptions = useMemo(() => ({ bounds: options.bounds, catalogue, requiredRoutes, assumptions }), [options.bounds, catalogue, requiredRoutes, assumptions])
  const storageKey = options.storageKey === undefined ? DEFAULT_STORAGE_KEY : options.storageKey
  const initialRef = useRef(options.initialLayout ?? null)
  const [state, setState] = useState<State>(() => {
    const initial = options.initialLayout ?? createInitialLayout()
    let layout = initial, issues: LayoutIssue[] = [], message: string | null = null, recoveryJSON: string | null = null
    if (storageKey && typeof window !== 'undefined') {
      try {
        const restored = restoreLayout(window.localStorage, storageKey, validationOptions)
        issues = restored.layout ? [] : restored.issues
        if (restored.layout) { layout = restored.layout; message = 'Restored the browser draft; all geometry and graph checks were rerun.' }
        else if (restored.found) { recoveryJSON = restored.sourceJSON ?? null; message = 'Stored JSON could not be loaded. It is available in Save / import for repair and stays untouched until you edit the draft.' }
      } catch { issues = [{ code: 'storage_read', severity: 'error', path: 'storage', message: 'Browser storage is unavailable. JSON import/export still works.' }] }
    }
    return { layout, selectedPlacementId: null, selectedNodeId: null, actionIssues: issues, message, changed: false, history: [], recoveryJSON }
  })
  const [storageIssues, setStorageIssues] = useState<LayoutIssue[]>([])
  const validation = useMemo(() => validateLayout(state.layout, validationOptions), [state.layout, validationOptions])
  const onChangeRef = useRef(options.onChange)
  onChangeRef.current = options.onChange
  useEffect(() => { onChangeRef.current?.(state.layout) }, [state.layout])
  useEffect(() => {
    if (!state.changed || !storageKey || typeof window === 'undefined') return
    try { setStorageIssues(persistLayout(window.localStorage, storageKey, state.layout, validationOptions)) }
    catch { setStorageIssues([{ code: 'storage_write', severity: 'error', path: 'storage', message: 'Browser storage is unavailable. Export JSON to keep this draft.' }]) }
  }, [state.layout, state.changed, storageKey, validationOptions])

  function commit(change: (current: LayoutRevision) => LayoutRevision, message: string, selection?: Partial<Pick<State, 'selectedPlacementId' | 'selectedNodeId'>>) {
    setState(current => {
      const next = change(current.layout)
      if (next === current.layout) return current
      const shape = inspectLayoutShape(next)
      if (shape.length) return { ...current, actionIssues: shape, message: 'The change was not applied. Correct the reported values.' }
      return {
        ...current, ...selection, layout: { ...next, revision: Math.max(current.layout.revision, next.revision) + 1 },
        history: [...current.history.slice(-19), current.layout], actionIssues: [], message, changed: true,
      }
    })
  }
  function report(issue: LayoutIssue) { setState(current => ({ ...current, actionIssues: [issue], message: issue.message })) }
  function updatePlacement(next: Placement) {
    commit(layout => ({ ...layout, placements: layout.placements.map(item => item.id === next.id ? next : item) }), `${next.label} updated. Attached nodes and authored edges were rechecked.`)
  }
  function movePlacement(id: string, position: Point) {
    commit(layout => ({ ...layout, placements: layout.placements.map(item => item.id === id ? { ...item, position: rounded(position) } : item) }), 'Placement moved. Check the route validation before simulation.')
  }
  function addPlacement(presetId: string) {
    const preset = catalogue.find(item => item.id === presetId)
    if (!preset) return
    const placement: Placement = { id: newId('kit'), label: preset.name, presetId, position: [25, 0, -275], yawDeg: 0, ...(preset.kind === 'roder' ? { bays: 2 } : {}) }
    // Find a free prepared area. If full, add a repairable draft and report its actual checks.
    let found = false
    for (let z = options.bounds.minZ + 12; !found && z < options.bounds.maxZ - 12; z += 6) for (let x = options.bounds.maxX - 12; !found && x > options.bounds.minX + 12; x -= 6) {
      placement.position = [x, 0, z]
      const next = { ...state.layout, placements: [...state.layout.placements, placement] }
      found = !validateLayout(next, validationOptions).issues.some(issue => issue.severity === 'error' && issue.relatedIds?.includes(placement.id))
    }
    commit(layout => ({ ...layout, placements: [...layout.placements, placement] }), found ? 'Kit added. Select it and click the ground, or edit its coordinates.' : 'Kit added to the draft. Resolve its placement errors before simulation.', { selectedPlacementId: placement.id, selectedNodeId: null })
  }
  function removePlacement(id: string) {
    const issue = placementRemovalIssue(state.layout, id)
    if (issue) { report(issue); return }
    commit(layout => ({ ...layout, placements: layout.placements.filter(item => item.id !== id) }), 'Placement removed.', { selectedPlacementId: null })
  }
  function selectPlacement(id: string | null) { setState(current => ({ ...current, selectedPlacementId: id, selectedNodeId: null, actionIssues: [] })) }
  function selectNode(id: string | null) { setState(current => ({ ...current, selectedPlacementId: null, selectedNodeId: id, actionIssues: [] })) }
  function updateNode(next: NavigationNode) {
    commit(layout => ({ ...layout, nodes: layout.nodes.map(node => node.id === next.id ? next : node) }), `${next.id} updated. Directed routes were rechecked.`)
  }
  function moveNode(id: string, point: Point) {
    commit(layout => {
      const position = rounded(point)
      return { ...layout, nodes: layout.nodes.map(node => {
        if (node.id !== id) return node
        const placement = layout.placements.find(item => item.id === node.attachment?.placementId)
        return { ...node, position, ...(node.attachment && placement ? { attachment: { ...node.attachment, offset: worldToLocal(position, placement) } } : {}) }
      }) }
    }, 'Waypoint moved. Authored edges were rechecked.')
  }
  function attachNode(id: string, placementId: string | null) {
    commit(layout => ({ ...layout, nodes: layout.nodes.map(node => {
      if (node.id !== id) return node
      const oldPlacement = layout.placements.find(item => item.id === node.attachment?.placementId)
      const position = oldPlacement && node.attachment ? localToWorld(node.attachment.offset, oldPlacement) : node.position
      const placement = layout.placements.find(item => item.id === placementId)
      const { attachment: _previous, ...base } = node
      return { ...base, position, ...(placement ? { attachment: { placementId: placement.id, offset: worldToLocal(position, placement) } } : {}) }
    }) }), placementId ? 'Node attached; its world position is preserved.' : 'Node detached; its world position is preserved.')
  }
  function addNode(role: NavigationNode['role'] = 'waypoint') {
    const node: NavigationNode = { id: newId(role), role, position: [25, 0, -285] }
    commit(layout => ({ ...layout, nodes: [...layout.nodes, node] }), 'Waypoint added. Connect it with directed edges to complete its route.', { selectedNodeId: node.id, selectedPlacementId: null })
  }
  function removeNode(id: string) {
    const issue = nodeRemovalIssue(state.layout, id, requiredRoutes)
    if (issue) { report(issue); return }
    commit(layout => ({ ...layout, nodes: layout.nodes.filter(node => node.id !== id) }), 'Waypoint removed.', { selectedNodeId: null })
  }
  function connectNodes(from: string, to: string) {
    if (!from || !to) return
    commit(layout => ({ ...layout, edges: [...layout.edges, { id: newId('edge'), from, to }] }), 'Directed edge added. Its clearance and connectivity were checked.')
  }
  function removeEdge(id: string) {
    commit(layout => ({ ...layout, edges: layout.edges.filter(edge => edge.id !== id) }), 'Directed edge removed. Repair any disconnected routes before simulation.')
  }
  function importJSON(json: string): boolean {
    const result = importLayoutJSON(json, validationOptions)
    if (!result.layout) { setState(current => ({ ...current, actionIssues: result.issues, message: 'Import was not applied. The current draft and source JSON were kept for repair.' })); return false }
    commit(() => result.layout!, result.validation?.valid ? 'JSON imported and checked.' : 'JSON imported as a repairable draft. Resolve its errors before simulation.', { selectedPlacementId: null, selectedNodeId: null })
    return true
  }
  function undo() {
    setState(current => {
      const previous = current.history.at(-1)
      return previous ? { ...current, layout: { ...previous, revision: current.layout.revision + 1 }, history: current.history.slice(0, -1), selectedPlacementId: null, selectedNodeId: null, actionIssues: [], changed: true, message: 'Previous edit restored as a new revision.' } : current
    })
  }
  function reset() { commit(() => structuredClone(initialRef.current ?? createInitialLayout()), 'Prepared layout restored as a new revision.', { selectedPlacementId: null, selectedNodeId: null }) }

  const selectedPlacementId = state.layout.placements.some(item => item.id === state.selectedPlacementId) ? state.selectedPlacementId : null
  const selectedNodeId = state.layout.nodes.some(item => item.id === state.selectedNodeId) ? state.selectedNodeId : null
  return {
    layout: state.layout, catalogue, assumptions, requiredRoutes, validation, graph: validation.graph,
    /** Pass only this graph to ABM. Invalid drafts remain visible but cannot be run. */
    runnableGraph: validation.valid ? validation.graph : null,
    selectedPlacementId, selectedNodeId, selectedId: selectedPlacementId ?? selectedNodeId,
    message: state.message, recoveryJSON: state.recoveryJSON, actionIssues: [...state.actionIssues, ...storageIssues], canUndo: state.history.length > 0,
    selectPlacement, selectNode, updatePlacement, movePlacement, addPlacement, removePlacement,
    updateNode, moveNode, attachNode, addNode, removeNode, connectNodes, removeEdge,
    importJSON, exportJSON: () => exportLayoutJSON(state.layout), undo, reset,
    onSelect: selectPlacement,
    onMove: (id: string, position: Point) => { if (state.layout.placements.some(item => item.id === id)) movePlacement(id, position); else moveNode(id, position) },
  }
}
export type LayoutEditorController = ReturnType<typeof useLayoutEditor>
