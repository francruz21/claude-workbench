// Whether each child is actually working, measured in Orca rather than assumed:
// a conductor that says "está trabajando" about a dead or paused child leaves
// the ticket stopped for hours. The verdict and the nudge text are pure; the
// register runs the Orca calls and acts on them.

import type { Row } from '../types'

export type Terminal = {
  handle: string
  title: string
  connected: boolean
  orphaned: boolean
  lastOutputAt: number | null
}

export type Health =
  // The spinner is on: the model or a tool is running.
  | { kind: 'working' }
  // Idle on purpose: its QA turn is queued, or a stack/monitor it started is still running.
  | { kind: 'waiting'; why: string }
  // Blocked on an `ask` to the conductor: the conductor owes the answer.
  | { kind: 'asking'; sinceMin: number }
  // Idle with nothing running and nothing owed: it stopped working.
  | { kind: 'stalled'; sinceMin: number }
  // A permission prompt holds it.
  | { kind: 'permission'; prompt: string }
  // The terminal is gone, orphaned or disconnected.
  | { kind: 'dead'; why: string }

// Claude Code titles an idle session with "✳" and a busy one with a spinner.
const IDLE_GLYPH = /^\s*✳/
// Its footer while background work runs: "1 shell, 1 monitor still running".
const BACKGROUND = /\b\d+\s+(shells?|monitors?|agents?|tasks?)\b/i
const PERMISSION = /(Do you want to (proceed|make this edit|create|allow)|❯\s*1\.\s*Yes|Allow (once|always))/i
const ASKING = /orchestration\s+ask\b/

// After this long idle with nothing running, a child counts as stalled.
export const STALL_MS = 3 * 60_000
// An `ask` the conductor has not answered in this long gets the conductor woken.
export const ASK_MS = 5 * 60_000

export function parseTerminals(listJson: string): Terminal[] | null {
  try {
    const data = JSON.parse(listJson) as { result?: { terminals?: unknown } }
    const raw = data.result?.terminals
    if (!Array.isArray(raw)) return null

    return raw.flatMap((t: Record<string, unknown>) =>
      typeof t.handle === 'string'
        ? [{
            handle: t.handle,
            title: typeof t.title === 'string' ? t.title : '',
            connected: t.connected !== false,
            orphaned: t.orphaned === true,
            lastOutputAt: typeof t.lastOutputAt === 'number' ? t.lastOutputAt : null,
          }]
        : [],
    )
  } catch {
    return null
  }
}

// The last lines of `orca-ide terminal read --json`.
export function parseTail(readJson: string): string {
  try {
    const data = JSON.parse(readJson) as { result?: { terminal?: { tail?: unknown } } }
    const tail = data.result?.terminal?.tail

    return Array.isArray(tail) ? tail.map(String).join('\n') : typeof tail === 'string' ? tail : ''
  } catch {
    return ''
  }
}

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000))

// The verdict for one child. `tail` is only read for an idle or long-quiet
// terminal; pass '' when it was not.
export function healthOf(row: Row, terminal: Terminal | undefined, tail: string, nowMs: number): Health {
  if (terminal === undefined) return { kind: 'dead', why: 'su terminal ya no está en Orca' }
  if (terminal.orphaned) return { kind: 'dead', why: 'su terminal quedó huérfana' }
  if (!terminal.connected) return { kind: 'dead', why: 'su terminal está desconectada' }

  const last = tail.split('\n').slice(-25).join('\n')
  const prompt = last.match(PERMISSION)
  if (prompt) return { kind: 'permission', prompt: prompt[0] }

  const quietMs = terminal.lastOutputAt === null ? 0 : nowMs - terminal.lastOutputAt
  if (!IDLE_GLYPH.test(terminal.title)) {
    // Busy: either working, or a tool call blocked on the conductor's answer.
    if (ASKING.test(last.split('\n').slice(-12).join('\n')) && quietMs >= ASK_MS) {
      return { kind: 'asking', sinceMin: minutes(quietMs) }
    }

    return { kind: 'working' }
  }

  if (row.qaTurn === 'queued') return { kind: 'waiting', why: 'espera su turno de QA' }
  if (row.prs.length > 0) return { kind: 'waiting', why: 'entregó: PR abierta, espera CI o review' }
  if (BACKGROUND.test(last.split('\n').slice(-6).join('\n'))) return { kind: 'waiting', why: 'tiene un stack o monitor corriendo' }
  if (quietMs < STALL_MS) return { kind: 'working' }

  return { kind: 'stalled', sinceMin: minutes(quietMs) }
}

export function healthLabel(health: Health): string {
  switch (health.kind) {
    case 'working':
      return 'trabajando'
    case 'waiting':
      return `esperando: ${health.why}`
    case 'asking':
      return `te espera (ask sin respuesta hace ${health.sinceMin} min)`
    case 'stalled':
      return `PARADO hace ${health.sinceMin} min`
    case 'permission':
      return `TRABADO en un permiso ("${health.prompt}")`
    case 'dead':
      return `MUERTO: ${health.why}`
  }
}

// What the mod types into a stalled child. A standing order, not a question.
export function nudgeText(row: Row): string {
  return [
    `[conductor] ${row.name}: seguí con el ticket hasta entregarlo (PR publicada y worker_done). No te detengas.`,
    'Lo menor lo decidís vos con tu recomendación y lo dejás escrito en la PR. Si necesitás un permiso, tu turno de QA o un dato que solo tengo yo, pedilo con `orchestration ask` y mientras seguí con lo que no dependa de eso.',
    'Esperar solo vale para tu turno de QA o un stack que está levantando, con su monitor armado.',
  ].join(' ')
}

// What wakes the conductor about one child, or null when the mod handles it alone.
export function healthWake(row: Row, health: Health, nudges: number): string | null {
  switch (health.kind) {
    case 'dead':
      return `- ${row.name}: MUERTO (${health.why}). Retomalo ya: reconciliá con el registro (agents.md, *Reconciliar una tanda*) y despachá un hijo nuevo con el spec de retoma.`
    case 'permission':
      return `- ${row.name}: TRABADO en un permiso ("${health.prompt}"). Leé su terminal y destrabalo vos (\`terminal send\`): si es algo que podés autorizar, autorizalo.`
    case 'asking':
      return `- ${row.name}: te espera hace ${health.sinceMin} min con un \`ask\` sin respuesta. Contestale ahora (inbox, \`reply\`).`
    case 'stalled':
      return nudges >= 2
        ? `- ${row.name}: sigue PARADO después de ${nudges} empujones. Leé su terminal y destrabalo.`
        : null
    default:
      return null
  }
}
