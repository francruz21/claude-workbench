// Pure reading of the conductor ledger (tools/conductor-ledger.sh): no `$`,
// so every rule here is tested without a session.

import type { Gate, Pr, Row } from '../types'

export type { Gate, Pr, Row }

export type Summary = { active: Row[]; stale: Row[] }

// An open ticket is listed apart once its worktree was cleaned (it stays open
// only because `close` requires an announcement) or it went untouched this
// long. Shorter than this flags tickets merely paused over a weekend.
export const STALE_AFTER_MS = 10 * 24 * 60 * 60 * 1000

// Same key the script derives: the workspace path with "/" turned into "-".
export function ledgerPath(stateDir: string, workspace: string): string {
  return `${stateDir}/conductor${workspace.replaceAll('/', '-')}.json`
}

type RawTicket = {
  name?: unknown
  state?: unknown
  qaTurn?: unknown
  prs?: unknown
  announced?: unknown
  announcedAt?: unknown
  cleaned?: unknown
  updatedAt?: unknown
  notes?: unknown
  child?: unknown
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

function toPrs(value: unknown): Pr[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(pr => {
    if (typeof pr !== 'object' || pr === null) return []
    const { repo, number, gate } = pr as Record<string, unknown>
    if (typeof number !== 'number') return []
    const short = (asString(repo) ?? '').split('/').pop() ?? ''

    return [{ repo: short, number, gate: (asString(gate) as Gate | null) ?? null }]
  })
}

function lastNoteOf(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const last = value[value.length - 1] as { text?: unknown }

  return asString(last?.text)
}

// Open tickets only, or null when the text is not a ledger.
export function parseLedger(text: string): Row[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const tickets = (data as { tickets?: unknown }).tickets
  if (typeof tickets !== 'object' || tickets === null) return null

  return Object.entries(tickets as Record<string, RawTicket>)
    .filter(([, t]) => t?.state === 'open')
    .map(([id, t]) => ({
      id,
      name: asString(t.name) ?? id,
      qaTurn: asString(t.qaTurn),
      prs: toPrs(t.prs),
      // Older entries carry `announcedAt`; newer ones an `announced` object.
      isAnnounced: (t.announced != null && t.announced !== false) || asString(t.announcedAt) !== null,
      handle: asString((t.child as { handle?: unknown } | undefined)?.handle),
      isCleaned: t.cleaned != null && t.cleaned !== false,
      updatedAt: asString(t.updatedAt),
      lastNote: lastNoteOf(t.notes),
    }))
}

export function summarize(rows: Row[], nowMs: number): Summary {
  const isStale = (row: Row) => {
    if (row.qaTurn !== null) return false
    if (row.isCleaned) return true
    const at = row.updatedAt === null ? NaN : Date.parse(row.updatedAt)

    return Number.isNaN(at) || nowMs - at > STALE_AFTER_MS
  }
  const byRecent = (a: Row, b: Row) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')

  return {
    active: rows.filter(row => !isStale(row)).sort(byRecent),
    stale: rows.filter(isStale).sort(byRecent),
  }
}

const isGreenUnannounced = (row: Row) =>
  !row.isAnnounced && row.prs.length > 0 && row.prs.every(pr => pr.gate === 'GREEN')

export function statusLine(summary: Summary): string | undefined {
  if (summary.active.length === 0) return undefined
  const parts = [`tanda ${summary.active.length}`]
  const qa = summary.active.find(row => row.qaTurn === 'held')
  if (qa) parts.push(`QA ${qa.id}`)
  const green = summary.active.filter(isGreenUnannounced).length
  if (green > 0) parts.push(`${green} verde${green === 1 ? '' : 's'} sin anunciar`)

  return parts.join(' · ')
}

export function prLabel(pr: Pr): string {
  return `${pr.repo}#${pr.number} ${pr.gate ?? '?'}`
}

export function ago(iso: string | null, nowMs: number): string {
  if (iso === null) return '—'
  const minutes = Math.round((nowMs - Date.parse(iso)) / 60000)
  if (Number.isNaN(minutes)) return '—'
  if (minutes < 60) return `hace ${Math.max(0, minutes)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`

  return `hace ${Math.round(hours / 24)} d`
}

export function rowLine(row: Row, nowMs: number): string {
  const prs = row.prs.length === 0 ? 'sin PR' : row.prs.map(prLabel).join(' ')
  const qa = row.qaTurn === null ? '' : `  QA: ${row.qaTurn}`

  return `${row.name}${qa}  ${prs}  ${row.isAnnounced ? '✓' : '✗'} anunciado  ${ago(row.updatedAt, nowMs)}`
}

export function brief(summary: Summary, nowMs: number): string {
  if (summary.active.length === 0 && summary.stale.length === 0) return 'No hay tickets abiertos en la tanda.'
  const lines = summary.active.map(row => rowLine(row, nowMs))
  if (summary.active.length === 0) lines.push('Ningún ticket activo.')
  if (summary.stale.length > 0) lines.push(`+ ${summary.stale.length} abiertos viejos (/tanda viejos)`)

  return lines.join('\n')
}

export function staleReport(summary: Summary, nowMs: number): string {
  if (summary.stale.length === 0) return 'No hay abiertos viejos.'

  return summary.stale
    .map(row => `${row.name}  ${ago(row.updatedAt, nowMs)}\n  ${row.lastNote ?? '(sin notas)'}`)
    .join('\n')
}

// What changed between two reads, as one toast line per change. A ticket
// absent from `next` was closed (the ledger only drops it from the open set).
export function changes(prev: Row[], next: Row[]): string[] {
  const before = new Map(prev.map(row => [row.id, row]))
  const after = new Map(next.map(row => [row.id, row]))
  const out: string[] = []

  for (const row of next) {
    const old = before.get(row.id)
    if (!old) continue
    for (const pr of row.prs) {
      const oldGate = old.prs.find(p => p.repo === pr.repo && p.number === pr.number)?.gate
      if (oldGate !== pr.gate && (pr.gate === 'GREEN' || pr.gate === 'RED')) {
        out.push(`${row.id}: ${pr.repo}#${pr.number} → ${pr.gate}`)
      }
    }
    if (old.qaTurn !== row.qaTurn) {
      if (row.qaTurn === 'held') out.push(`${row.id}: tiene el turno de QA`)
      else if (old.qaTurn === 'held') out.push(`${row.id}: liberó el turno de QA`)
    }
    if (!old.isAnnounced && row.isAnnounced) out.push(`${row.id}: anunciado`)
  }
  for (const row of prev) if (!after.has(row.id)) out.push(`${row.id}: cerrado`)

  return out
}
