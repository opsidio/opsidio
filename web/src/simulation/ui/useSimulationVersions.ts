import { useEffect, useState } from 'react'
import { createConfigHash } from '../abm/worker-protocol'
import { compileSimulationPlan } from '../plan/compile'

const STORAGE_KEY = 'opsidio-simulation-versions:0.1'
const BASELINE_ID = 'baseline'

const sourceLabels = {
  baseline: 'Baseline',
  saved: 'Edited plan',
  imported: 'Imported plan',
  optimized: 'Optimized candidate',
} as const

type VersionSource = keyof typeof sourceLabels
export type SavedVersionSource = Exclude<VersionSource, 'baseline'>

export type SimulationVersion = Readonly<{
  id: string
  number: number
  label: string
  source: VersionSource
  plan: unknown
  layoutId: string
  layoutRevision: number
  layoutStorageKey: string
}>

type Catalog = {
  versions: readonly SimulationVersion[]
  selectedId: string
  highestNumber: number
  needsSave: boolean
  readError: string | null
}

function freezeJson(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

function snapshotPlan(input: unknown) {
  const json = JSON.stringify(input)
  if (json === undefined) throw new Error('Select a valid plan JSON document.')
  const plan: unknown = JSON.parse(json)
  const { layoutId, layoutRevision } = compileSimulationPlan(plan)
  return { plan: freezeJson(plan), layoutId, layoutRevision }
}

function version(id: string, number: number, source: VersionSource, snapshot: ReturnType<typeof snapshotPlan>): SimulationVersion {
  const layoutStorageKey = source === 'baseline'
    ? `opsidio-v1-all:${snapshot.layoutId}:${createConfigHash(snapshot.plan)}`
    : `opsidio-version-layout:0.1:${id}`
  return Object.freeze({ id, number, label: `V${number} · ${sourceLabels[source]}`, source, layoutStorageKey, ...snapshot })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isVersionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 1
}

function isSavedSource(value: unknown): value is SavedVersionSource {
  return value === 'saved' || value === 'imported' || value === 'optimized'
}

function initialCatalog(baselinePlan: unknown): Catalog {
  const versions = [version(BASELINE_ID, 1, 'baseline', snapshotPlan(baselinePlan))]
  let highestNumber = 1
  let readError: string | null = null
  let selectedId = BASELINE_ID
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored !== null) {
        const catalog: unknown = JSON.parse(stored)
        if (!isObject(catalog) || !Array.isArray(catalog.versions)) throw new Error('Invalid saved version catalog.')
        if (isVersionNumber(catalog.highestNumber)) highestNumber = catalog.highestNumber
        const ids = new Set([BASELINE_ID])
        const numbers = new Set([1])
        for (const entry of catalog.versions as unknown[]) {
          if (isObject(entry) && isVersionNumber(entry.number)) highestNumber = Math.max(highestNumber, entry.number)
          try {
            if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
              || !isVersionNumber(entry.number) || numbers.has(entry.number) || !isSavedSource(entry.source)) {
              throw new Error('Invalid saved version record.')
            }
            versions.push(version(entry.id, entry.number, entry.source, snapshotPlan(entry.plan)))
            ids.add(entry.id)
            numbers.add(entry.number)
          } catch {
            readError = 'Some saved versions could not be restored in this browser.'
          }
        }
      }
    } catch {
      readError = 'Saved versions could not be read from this browser.'
    }
    const requestedId = new URLSearchParams(window.location.search).get('version')
    if (requestedId && versions.some(item => item.id === requestedId)) selectedId = requestedId
  }
  versions.sort((a, b) => a.number - b.number)
  return { versions, selectedId, highestNumber, needsSave: false, readError }
}

function setVersionParam(id: string) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('version', id)
  window.history.replaceState(window.history.state, '', url)
}

/** A version holds the saved plan. The mounted workspace owns that version's unsaved draft. */
export function useSimulationVersions(baselinePlan: unknown) {
  const [catalog, setCatalog] = useState(() => initialCatalog(baselinePlan))
  const [saveError, setSaveError] = useState<string | null>(null)
  const { versions, highestNumber, needsSave, readError } = catalog

  useEffect(() => {
    if (!needsSave || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        highestNumber,
        versions: versions.filter(item => item.source !== 'baseline').map(({ id, number, source, plan }) => ({ id, number, source, plan })),
      }))
      setSaveError(null)
    } catch {
      setSaveError('New versions are available in this tab, but browser storage could not save them. Export the plan to keep it.')
    }
  }, [versions, highestNumber, needsSave])

  const selected = versions.find(item => item.id === catalog.selectedId) ?? versions[0]

  function selectVersion(id: string) {
    if (!versions.some(item => item.id === id)) return
    setCatalog(current => ({ ...current, selectedId: id }))
    setVersionParam(id)
  }

  function addVersion(plan: unknown, source: SavedVersionSource) {
    const snapshot = snapshotPlan(plan)
    if (highestNumber >= Number.MAX_SAFE_INTEGER) throw new Error('The saved version number is out of range. Export the plan to keep it.')
    const id = crypto.randomUUID()
    setCatalog(current => {
      const number = current.highestNumber + 1
      const next = version(id, number, source, snapshot)
      return { ...current, versions: [...current.versions, next], selectedId: id, highestNumber: number, needsSave: true }
    })
    setVersionParam(id)
  }

  return { versions, selected, selectVersion, addVersion, storageError: saveError ?? readError }
}
