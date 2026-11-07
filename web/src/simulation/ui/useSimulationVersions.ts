import { useEffect, useState } from 'react'
import { createConfigHash } from '../abm/worker-protocol'
import { compileSimulationPlan } from '../plan/compile'

const STORAGE_KEY = 'opsidio-simulation-versions:0.1'
const BASELINE_ID = 'baseline'

const sourceLabels = {
  baseline: 'Baseline',
  form: 'Form snapshot',
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
  comparisonVersionId?: string
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

function version(id: string, number: number, source: VersionSource, snapshot: ReturnType<typeof snapshotPlan>, eventId?: string, comparisonVersionId?: string): SimulationVersion {
  const layoutStorageKey = source === 'baseline'
    ? `opsidio-v1-all:${eventId ? `${eventId}:` : ''}${snapshot.layoutId}:${createConfigHash(snapshot.plan)}`
    : `opsidio-version-layout:0.1:${id}`
  return Object.freeze({ id, number, label: `V${number} · ${sourceLabels[source]}`, source, layoutStorageKey, comparisonVersionId, ...snapshot })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isVersionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 1
}

function isSavedSource(value: unknown): value is SavedVersionSource {
  return value === 'form' || value === 'saved' || value === 'imported' || value === 'optimized'
}

function storageKey(eventId?: string): string {
  return eventId ? `${STORAGE_KEY}:event:${eventId}` : STORAGE_KEY
}

function storedCatalog(eventId?: string) {
  const stored = window.localStorage.getItem(storageKey(eventId))
  if (stored === null) return null
  const catalog: unknown = JSON.parse(stored)
  if (!isObject(catalog) || !Array.isArray(catalog.versions)) throw new Error('Invalid saved version catalog.')
  return { highestNumber: isVersionNumber(catalog.highestNumber) ? catalog.highestNumber : 1, versions: catalog.versions.filter(isObject) }
}

export function readEventBaseline(eventId: string): unknown {
  return readEventVersionPlan(eventId, BASELINE_ID)
}

export function readEventVersionPlan(eventId: string, versionId: string): unknown {
  return storedCatalog(eventId)?.versions.find(entry => entry.id === versionId)?.plan
}

export function eventWorkspaceHref(eventId: string, versionId: string, panel = 'controls'): string {
  const query = new URLSearchParams({ event: eventId, version: versionId, view: 'isometric', panel })
  return `/simulation/workspace?${query}`
}

export function eventSimulationVersions(eventId: string) {
  try {
    return (storedCatalog(eventId)?.versions ?? []).flatMap(entry => {
      const { id, number, source } = entry
      const baseline = id === BASELINE_ID && number === 1 && source === 'baseline'
      if (typeof id !== 'string' || typeof number !== 'number' || !baseline && (!isVersionNumber(number) || !isSavedSource(source))) return []
      return [{ id, number, source, label: `V${number} · ${sourceLabels[source as VersionSource]}` }]
    }).sort((a, b) => a.number - b.number)
  } catch {
    return []
  }
}

/** Publish a form revision as an immutable snapshot in its event's version catalog. */
export function saveEventFormVersion(eventId: string, input: unknown): string {
  const snapshot = snapshotPlan(input)
  const catalog = storedCatalog(eventId)
  const versions = catalog?.versions ?? []
  const previous = versions.find(entry => typeof entry.id === 'string' && (entry.source === 'form' || entry.source === 'baseline')
    && JSON.stringify(entry.plan) === JSON.stringify(snapshot.plan))
  if (previous) return previous.id as string
  const first = versions.length === 0
  const highest = versions.reduce((value, entry) => isVersionNumber(entry.number) ? Math.max(value, entry.number) : value, catalog?.highestNumber ?? 1)
  if (highest >= Number.MAX_SAFE_INTEGER) throw new Error('The saved version number is out of range. Export the plan to keep it.')
  const number = first ? 1 : highest + 1
  const id = first ? BASELINE_ID : crypto.randomUUID()
  const source = first ? 'baseline' : 'form'
  window.localStorage.setItem(storageKey(eventId), JSON.stringify({ highestNumber: number, versions: [...versions, { id, number, source, plan: snapshot.plan }] }))
  return id
}

function initialCatalog(baselinePlan: unknown, eventId?: string): Catalog {
  const versions = [version(BASELINE_ID, 1, 'baseline', snapshotPlan(baselinePlan), eventId)]
  let highestNumber = 1
  let readError: string | null = null
  let selectedId = BASELINE_ID
  if (typeof window !== 'undefined') {
    try {
      const catalog = storedCatalog(eventId)
      if (catalog) {
        highestNumber = catalog.highestNumber
        const ids = new Set([BASELINE_ID])
        const numbers = new Set([1])
        for (const entry of catalog.versions) {
          if (eventId && entry.id === BASELINE_ID && entry.number === 1 && entry.source === 'baseline') continue
          if (isObject(entry) && isVersionNumber(entry.number)) highestNumber = Math.max(highestNumber, entry.number)
          try {
            if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
              || !isVersionNumber(entry.number) || numbers.has(entry.number) || !isSavedSource(entry.source)) {
              throw new Error('Invalid saved version record.')
            }
            versions.push(version(entry.id, entry.number, entry.source, snapshotPlan(entry.plan), eventId,
              typeof entry.comparisonVersionId === 'string' ? entry.comparisonVersionId : undefined))
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

function persistVersions(versions: readonly SimulationVersion[], highestNumber: number, eventId?: string) {
  window.localStorage.setItem(storageKey(eventId), JSON.stringify({
    highestNumber,
    versions: versions.filter(item => eventId || item.source !== 'baseline').map(({ id, number, source, plan, comparisonVersionId }) => ({ id, number, source, plan, comparisonVersionId })),
  }))
}

/** A version holds the saved plan. The mounted workspace owns that version's unsaved draft. */
export function useSimulationVersions(baselinePlan: unknown, eventId?: string) {
  const [catalog, setCatalog] = useState(() => initialCatalog(baselinePlan, eventId))
  const [saveError, setSaveError] = useState<string | null>(null)
  const { versions, highestNumber, needsSave, readError } = catalog

  useEffect(() => {
    if (!needsSave || typeof window === 'undefined') return
    try {
      persistVersions(versions, highestNumber, eventId)
      setSaveError(null)
    } catch {
      setSaveError('New versions are available in this tab, but browser storage could not save them. Export the plan to keep it.')
    }
  }, [versions, highestNumber, needsSave, eventId])

  const selected = versions.find(item => item.id === catalog.selectedId) ?? versions[0]

  function selectVersion(id: string) {
    if (!versions.some(item => item.id === id)) return
    setCatalog(current => ({ ...current, selectedId: id }))
    setVersionParam(id)
  }

  function addVersion(plan: unknown, source: SavedVersionSource, comparisonPlan?: unknown) {
    const snapshot = snapshotPlan(plan)
    const id = crypto.randomUUID()
    if (eventId || comparisonPlan !== undefined) {
      const latest = initialCatalog(baselinePlan, eventId)
      let number = Math.max(highestNumber, latest.highestNumber)
      const eventVersions = [...latest.versions]
      let comparisonVersionId: string | undefined
      if (comparisonPlan !== undefined) {
        const serialized = JSON.stringify(comparisonPlan)
        comparisonVersionId = eventVersions.find(item => JSON.stringify(item.plan) === serialized)?.id
        if (!comparisonVersionId) {
          if (number >= Number.MAX_SAFE_INTEGER - 1) throw new Error('The saved version number is out of range.')
          comparisonVersionId = crypto.randomUUID()
          eventVersions.push(version(comparisonVersionId, ++number, 'saved', snapshotPlan(comparisonPlan), eventId))
        }
      }
      number++
      if (!Number.isSafeInteger(number)) throw new Error('The saved version number is out of range. Export the plan to keep it.')
      eventVersions.push(version(id, number, source, snapshot, eventId, comparisonVersionId))
      persistVersions(eventVersions, number, eventId)
      setCatalog({ ...latest, versions: eventVersions, selectedId: id, highestNumber: number })
      setSaveError(null)
      setVersionParam(id)
      return
    }
    if (highestNumber >= Number.MAX_SAFE_INTEGER) throw new Error('The saved version number is out of range. Export the plan to keep it.')
    setCatalog(current => {
      const number = current.highestNumber + 1
      const next = version(id, number, source, snapshot)
      return { ...current, versions: [...current.versions, next], selectedId: id, highestNumber: number, needsSave: true }
    })
    setVersionParam(id)
  }

  return { versions, selected, selectVersion, addVersion, storageError: saveError ?? readError }
}
