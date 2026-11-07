import type { Bounds, KitPreset, LaneCheck, LanePlan, Placement, Point } from './types'

export const catalogue: readonly KitPreset[] = [
  { id: 'pagoda-3', name: 'Sarnafil 3 × 3', kind: 'pagoda', widthM: 3, depthM: 3, heightM: 4.1, eaveM: 2.6, sourceUrl: 'https://yuntutent.com/product/pagoda-tent/', notes: 'Reference product dimensions. Anchors and ballast need site confirmation.' },
  { id: 'pagoda-5', name: 'Sarnafil 5 × 5', kind: 'pagoda', widthM: 5, depthM: 5, heightM: 5.25, eaveM: 2.6, sourceUrl: 'https://yuntutent.com/product/pagoda-tent/' },
  { id: 'roder-10', name: 'Roder 10 m span', kind: 'roder', widthM: 10, depthM: 10, bayLengthM: 5, heightM: 5, eaveM: 4, sourceUrl: 'https://amiratent.id/produk/tenda-roder/', notes: 'Length changes in 5 m bays.' },
  { id: 'barrier-230', name: 'Rowing panel 2.3 m', kind: 'rowing', widthM: 2.3, depthM: 0.46, heightM: 1.1, sourceUrl: 'https://securasite.com/product/galvanised-pedestrian-barrier/', notes: 'Foot depth included. Reference product; local panel variants differ.' },
  { id: 'table-183', name: 'Check-in table', kind: 'table', widthM: 1.8288, depthM: 0.762, heightM: 0.7366, sourceUrl: 'https://www.lifetime.com/lifetime-280857-6-foot-fold-in-half-table-light-commercial' },
  { id: 'detector-90', name: 'Walk-through detector', kind: 'detector', widthM: 0.9, depthM: 0.58, heightM: 2.21, sourceUrl: 'https://garrett.com/pd-6500i-walk-through-metal-detector/', notes: '30-inch passage model. Installation separation remains an assumption.' },
]

export type Draft = { version: 1; revision: number; placements: Placement[]; lanePlan: LanePlan }

export function initialDraft(): Draft {
  const placements: Placement[] = [
    { id: 'scan_tent', label: 'Ticket scan', presetId: 'roder-10', position: [12, 0, -275], yawDeg: 0, bays: 2 },
    { id: 'security_tent', label: 'Security check', presetId: 'roder-10', position: [12, 0, -228], yawDeg: 0, bays: 2 },
    { id: 'help_tent', label: 'Ticket exceptions', presetId: 'pagoda-3', position: [18, 0, -258], yawDeg: 0 },
    { id: 'scan_table', label: 'Scan counter', presetId: 'table-183', position: [15, 0, -275], yawDeg: 0 },
    { id: 'help_table', label: 'Help desk', presetId: 'table-183', position: [18, 0, -258.7], yawDeg: 0 },
  ]
  for (const [row, x] of [7.85, 9.51, 11.17, 12.83, 14.49, 16.15].entries()) {
    for (const [panel, z] of [-299.85, -297.55, -295.25].entries()) {
      placements.push({ id: `row_${row}_${panel}`, label: `Queue row ${row + 1} · panel ${panel + 1}`, presetId: 'barrier-230', position: [x, 0, z], yawDeg: 90 })
    }
  }
  return { version: 1, revision: 1, placements, lanePlan: { planned: 4, scanners: 4, crew: 5 } }
}

export function dimensions(placement: Placement): [number, number] {
  const preset = catalogue.find(item => item.id === placement.presetId)!
  return [preset.widthM, preset.kind === 'roder' ? (placement.bays ?? 1) * (preset.bayLengthM ?? preset.depthM) : preset.depthM]
}

function corners(placement: Placement): Point[] {
  const [width, depth] = dimensions(placement)
  const angle = placement.yawDeg * Math.PI / 180
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const x = sx * width / 2, z = sz * depth / 2
    return [placement.position[0] + Math.cos(angle) * x + Math.sin(angle) * z, 0,
      placement.position[2] - Math.sin(angle) * x + Math.cos(angle) * z]
  })
}

function overlaps(a: Placement, b: Placement): boolean {
  const ca = corners(a), cb = corners(b)
  for (const placement of [a, b]) {
    const angle = placement.yawDeg * Math.PI / 180
    for (const [x, z] of [[Math.cos(angle), -Math.sin(angle)], [Math.sin(angle), Math.cos(angle)]]) {
      const pa = ca.map(p => p[0] * x + p[2] * z), pb = cb.map(p => p[0] * x + p[2] * z)
      if (Math.max(...pa) <= Math.min(...pb) + 0.001 || Math.max(...pb) <= Math.min(...pa) + 0.001) return false
    }
  }
  return true
}

export function placementIssue(next: Placement, others: readonly Placement[], bounds: Bounds): string | null {
  const preset = catalogue.find(item => item.id === next.presetId)
  if (!preset || !next.position.every(Number.isFinite) || !Number.isFinite(next.yawDeg)
    || !Number.isInteger(next.bays ?? 1) || (next.bays ?? 1) < 1 || (next.bays ?? 1) > 12) return 'Enter a valid preset, position, and bay count (1–12).'
  if (corners(next).some(p => p[0] < bounds.minX || p[0] > bounds.maxX || p[2] < bounds.minZ || p[2] > bounds.maxZ)) return 'The complete equipment footprint must stay inside the demo work area.'
  const tent = preset.kind === 'pagoda' || preset.kind === 'roder'
  for (const other of others) {
    if (other.id === next.id) continue
    const otherPreset = catalogue.find(item => item.id === other.presetId)
    if (!otherPreset) continue
    const otherTent = otherPreset.kind === 'pagoda' || otherPreset.kind === 'roder'
    // A canopy covers equipment; its roof footprint is traversable.
    if (tent !== otherTent) continue
    if (overlaps(next, other)) return `Placement overlaps ${other.label}. The previous position was kept.`
  }
  return null
}

export function checkLanes(placements: readonly Placement[], plan: LanePlan): LaneCheck {
  const scan = placements.find(p => p.id === 'scan_tent')
  const preset = catalogue.find(p => p.id === scan?.presetId)
  const physical = preset && (preset.kind === 'roder' || preset.kind === 'pagoda')
    ? Math.max(0, Math.floor((preset.widthM - 0.8 - 0.46) / (1.2 + 0.46))) : 0
  const feasible = Math.min(physical, plan.scanners, plan.crew)
  const limiting: string[] = []
  if (plan.planned > physical) limiting.push(`Room for ${physical} lanes under the scan canopy, using an assumed 1.2 m clear width.`)
  if (plan.planned > plan.scanners) limiting.push(`${plan.scanners} scanners available. Each active lane needs one scanner.`)
  if (plan.planned > plan.crew) limiting.push(`${plan.crew} scan crew assigned. Each active lane needs one crew member in this scenario.`)
  return { physical, feasible, limiting, valid: limiting.length === 0 }
}

export function restoreDraft(value: string | null): Draft {
  if (!value) return initialDraft()
  try {
    const saved = JSON.parse(value)
    if (saved.version !== 1 || !Number.isInteger(saved.revision) || saved.revision < 1 || !Array.isArray(saved.placements)) return initialDraft()
    const ids = new Set<string>()
    for (const item of saved.placements) {
      if (!item || typeof item.id !== 'string' || typeof item.label !== 'string' || ids.has(item.id)
        || !catalogue.some(p => p.id === item.presetId) || !Array.isArray(item.position) || item.position.length !== 3
        || !item.position.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) || !Number.isFinite(item.yawDeg)
        || !Number.isInteger(item.bays ?? 1) || (item.bays ?? 1) < 1 || (item.bays ?? 1) > 12) return initialDraft()
      ids.add(item.id)
    }
    if (![saved.lanePlan?.planned, saved.lanePlan?.scanners, saved.lanePlan?.crew].every(n => Number.isInteger(n) && n >= 0 && n <= 100)) return initialDraft()
    return saved as Draft
  } catch { return initialDraft() }
}
