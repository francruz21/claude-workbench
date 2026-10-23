// Which model each kind of agent of the batch runs on: the children that
// implement on a fast one, the conductor that reviews diffs and decides gates on
// a stronger one. The switch lives in `choices.modelRouting` of the capabilities
// file, so the skill honours it even where this mod is not loaded. Pure, no `$`.

import type { Routing } from '../types'

export const ROLES = ['conductor', 'child', 'childHeavy'] as const
export type Role = (typeof ROLES)[number]

export const OFF: Routing = { enabled: false, conductor: null, child: null, childHeavy: null, forbidden: [] }

// An alias the `/model` command takes (`sonnet`, `opus`) or a full model id.
const MODEL = /^[a-z0-9][a-z0-9.\-]*(\[[a-z0-9]+\])?$/i

export function isModel(value: string): boolean {
  return MODEL.test(value)
}

// Whether `model` is one of the forbidden ones: `fable` matches `claude-fable-5-1`.
export function isForbidden(model: string, forbidden: string[]): boolean {
  const lower = model.toLowerCase()

  return forbidden.some(f => lower.includes(f))
}

function forbiddenOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string' && f.trim() !== '').map(f => f.trim().toLowerCase()) : []
}

// A forbidden model in a role counts as missing: it is asked again, never used.
function modelOf(value: unknown, forbidden: string[]): string | null {
  return typeof value === 'string' && isModel(value) && !isForbidden(value, forbidden) ? value : null
}

// The routing in the capabilities file's text; OFF when the file or the key is missing.
export function parseRouting(text: string | null): Routing {
  if (text === null) return OFF
  try {
    const data = JSON.parse(text) as { choices?: { modelRouting?: Record<string, unknown> } }
    const raw = data.choices?.modelRouting
    if (raw === undefined || raw === null || typeof raw !== 'object') return OFF

    const forbidden = forbiddenOf(raw.forbidden)

    return {
      enabled: raw.enabled === true,
      conductor: modelOf(raw.conductor, forbidden),
      child: modelOf(raw.child, forbidden),
      childHeavy: modelOf(raw.childHeavy, forbidden),
      forbidden,
    }
  } catch {
    return OFF
  }
}

// The capabilities text with `choices.modelRouting` merged, everything else kept.
// Throws on a file that is not JSON: overwriting it would lose the person's choices.
export function withRouting(text: string | null, patch: Partial<Routing>): string {
  const data = (text === null || text.trim() === '' ? {} : JSON.parse(text)) as {
    choices?: Record<string, unknown>
  }
  const choices = data.choices ?? {}
  const current = (choices.modelRouting ?? {}) as Record<string, unknown>
  const next = { ...current, ...patch }

  return `${JSON.stringify({ ...data, choices: { ...choices, modelRouting: next } }, null, 2)}\n`
}

// The roles an enabled routing still needs, in the order they are asked.
export function missing(routing: Routing): Role[] {
  if (!routing.enabled) return []

  return (['conductor', 'child'] as const).filter(role => routing[role] === null)
}

export function statusText(routing: Routing): string {
  const banned = routing.forbidden.length > 0 ? `\nProhibidos para cualquier rol: ${routing.forbidden.join(', ')}.` : ''
  if (!routing.enabled) return `Ruteo de modelos: off. Los hijos y el conductor heredan el modelo por defecto.${banned}`
  const lines = [
    'Ruteo de modelos: on.',
    `- conductor: ${routing.conductor ?? '(falta)'}`,
    `- hijo: ${routing.child ?? '(falta)'}`,
    `- hijo pesado: ${routing.childHeavy ?? `(sin definir: usa el del hijo)`}`,
  ]
  const gaps = missing(routing)
  if (gaps.length > 0) lines.push(`Faltan: ${gaps.join(', ')}. Completalo con /model-routing set <rol> <modelo>.`)

  return lines.join('\n') + banned
}

// The section the conductor's anchor carries, re-read on every request.
export function anchorSection(routing: Routing): string {
  if (!routing.enabled) {
    return 'Ruteo de modelos: off. No le mandes `/model` a ningún hijo: heredan el modelo por defecto, como siempre.'
  }
  const gaps = missing(routing)
  if (gaps.length > 0) {
    return `Ruteo de modelos: on, pero falta \`choices.modelRouting.${gaps[0]}\`. No lo completes en silencio: preguntalo (core/resolve.md) o pedí \`/model-routing set ${gaps[0]} <modelo>\`.`
  }
  const heavy = routing.childHeavy ?? routing.child

  return [
    `Ruteo de modelos: on. Hijo: \`${routing.child}\`; hijo pesado: \`${heavy}\` (ticket con decisiones de diseño, seguridad, migraciones o mucho alcance).`,
    'Al crear un hijo, con el `tui-idle` y ANTES del `dispatch --inject`: `orca-ide terminal send --terminal <handle> --text "/model <modelo>" --enter --json`. Sin eso el dispatch se niega.',
  ].join('\n')
}

const TERMINAL_SEND = /\borca(?:-ide)?\s+terminal\s+send\b/
const DISPATCH_INJECT = /\borca(?:-ide)?\s+orchestration\s+dispatch\b/

function flag(part: string, name: string): string | null {
  const match = part.match(new RegExp(`--${name}[ =]+(?:"([^"]*)"|'([^']*)'|(\\S+))`))

  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null
}

function parts(command: string): string[] {
  return command.split(/&&|\|\||;|\n/)
}

// The `/model` each `terminal send` of this command delivers, by handle.
export function modelsSent(command: string): { handle: string; model: string }[] {
  return parts(command).flatMap(part => {
    if (!TERMINAL_SEND.test(part)) return []
    const handle = flag(part, 'terminal')
    const text = flag(part, 'text')?.trim() ?? ''
    const model = text.match(/^\/model\s+(\S+)$/)?.[1]

    return handle && model && isModel(model) ? [{ handle, model }] : []
  })
}

// A reason to refuse this Bash command under routing, or null to let it run.
// `sent` is the handles this session already sent a `/model` to.
export function dispatchGuard(command: string, routing: Routing, sent: Record<string, string>): string | null {
  const sending = modelsSent(command)
  const banned = sending.find(s => isForbidden(s.model, routing.forbidden))
  if (banned) return `${banned.model} está prohibido (choices.modelRouting.forbidden). Elegí otro modelo para ${banned.handle}.`
  if (!routing.enabled) return null
  const delivered = new Set([...Object.keys(sent), ...sending.map(s => s.handle)])

  for (const part of parts(command)) {
    if (!DISPATCH_INJECT.test(part) || !/--inject\b/.test(part)) continue
    const gaps = missing(routing)
    if (gaps.length > 0) {
      return `el ruteo de modelos está on y falta choices.modelRouting.${gaps[0]}. Preguntalo (core/resolve.md) antes de despachar, o que el usuario lo apague con /model-routing off.`
    }
    const handle = flag(part, 'to')
    if (handle && !delivered.has(handle)) {
      return `el ruteo de modelos está on y ${handle} no recibió su /model. Primero: orca-ide terminal send --terminal ${handle} --text "/model ${routing.child}" --enter --json (o "/model ${routing.childHeavy ?? routing.child}" si el ticket es pesado), después el dispatch.`
    }
  }

  return null
}

// Whether the session already runs on the model `/model <wanted>` would pick:
// an alias matches any id that names it, a full id matches itself.
export function runsOn(current: string, wanted: string): boolean {
  const strip = (id: string) => id.toLowerCase().replace(/\[[a-z0-9]+\]$/, '')
  const want = strip(wanted)

  return want.includes('-') ? strip(current) === want : strip(current).includes(want)
}

// `/model-routing` arguments: on, off, status (default), or set <role> <model>.
export type RoutingCommand =
  | { kind: 'status' }
  | { kind: 'toggle'; on: boolean }
  | { kind: 'set'; role: Role; model: string }
  | { kind: 'error'; text: string }

export function parseCommand(args: string): RoutingCommand {
  const [verb = '', role, model, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (verb === '' || verb === 'status') return { kind: 'status' }
  if (verb === 'on' || verb === 'off') return { kind: 'toggle', on: verb === 'on' }
  if (verb === 'set') {
    if (!role || !(ROLES as readonly string[]).includes(role) || !model || rest.length > 0 || !isModel(model)) {
      return { kind: 'error', text: `Uso: /model-routing set <${ROLES.join('|')}> <modelo>, por ejemplo /model-routing set child sonnet.` }
    }

    return { kind: 'set', role: role as Role, model }
  }

  return { kind: 'error', text: 'Uso: /model-routing on|off|status, o /model-routing set <rol> <modelo>.' }
}
