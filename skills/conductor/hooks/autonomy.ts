// What keeps the conductor moving without the person reminding it: the rules
// re-anchored in the system prompt every request, the wake-up text when a
// child needs it, and the guards on the mistakes it keeps repeating. Pure, no `$`.

import type { Row } from '../types'

import { brief, type Summary } from './ledger'

// The message types a child raises that the conductor has to act on.
export const ACTIONABLE = ['worker_done', 'escalation', 'decision_gate'] as const

export type InboxMessage = {
  id: string
  from_handle: string
  type: string
  read: number | boolean
  subject?: string
}

export type Pending = { id: string; ticket: string; type: string; subject: string }

// Unread actionable messages from the children of open tickets. A message from
// a handle the ledger does not hold (a closed batch, another session) is ignored:
// that is exactly the stale message `check --wait` without `--types` delivers.
export function pendingFromChildren(messages: InboxMessage[], children: Row[]): Pending[] {
  const ticketOf = new Map(children.flatMap(row => (row.handle ? [[row.handle, row.id] as const] : [])))

  return messages.flatMap(message => {
    const ticket = ticketOf.get(message.from_handle)
    const isUnread = message.read === 0 || message.read === false
    if (!ticket || !isUnread || !(ACTIONABLE as readonly string[]).includes(message.type)) return []

    return [{ id: message.id, ticket, type: message.type, subject: message.subject ?? '' }]
  })
}

export function parseInbox(text: string): InboxMessage[] {
  try {
    const data = JSON.parse(text) as { result?: { messages?: unknown } }
    const messages = data.result?.messages

    return Array.isArray(messages) ? (messages as InboxMessage[]) : []
  } catch {
    return []
  }
}

// Tickets whose PRs are all GREEN and that are not announced yet.
export function readyToAnnounce(rows: Row[]): string[] {
  return rows
    .filter(row => !row.isAnnounced && row.prs.length > 0 && row.prs.every(pr => pr.gate === 'GREEN'))
    .map(row => row.id)
}

export function wakeText(pending: Pending[], announce: string[]): string | null {
  if (pending.length === 0 && announce.length === 0) return null
  const lines = ['[conductor] Hay trabajo de la tanda esperándote; seguí tu ciclo sin esperar al usuario.']
  for (const p of pending) lines.push(`- ${p.ticket}: ${p.type}${p.subject ? ` (${p.subject})` : ''} sin atender (${p.id})`)
  for (const id of announce) lines.push(`- ${id}: PRs en GREEN, sin anunciar`)
  lines.push('Leelo con `inbox` (no consume), resolvé con tu recomendación, y reportá en una línea por ticket. No le repitas al usuario lo que ya le preguntaste.')

  return lines.join('\n')
}

export function idleText(summary: Summary, nowMs: number): string {
  return [
    '[conductor] Pasó un rato sin actividad y la tanda tiene tickets activos.',
    'Revisá el estado de cada hijo (`terminal read` / `inbox`), destrabá lo que esté parado decidiendo vos, y reportá solo lo que cambió. Si nada cambió, no escribas nada al usuario: no le repitas decisiones pendientes.',
    '',
    brief(summary, nowMs),
  ].join('\n')
}

// Re-read on every request, so it survives compaction and a long session.
// With Orca injecting the mail, the messages arrive as turns of their own and are
// read on arrival: a `check --wait` then returns empty, so the injection rules.
export function anchorText(summary: Summary, nowMs: number, handle: string | null = null, isInjected = false): string {
  const mail = isInjected
    ? 'Mensajes de los hijos: Orca te los inyecta en el prompt y quedan leídos al llegar. **No armes `check --wait`** (vuelve vacío aunque hayan llegado gates); para releer, `orca-ide orchestration inbox` (no consume). Los heartbeats no te llegan: el mod los saca y los muestra en el pane.'
    : `Mensajes de los hijos: \`orca-ide orchestration check --terminal ${handle ?? '<tu handle>'} --types worker_done,escalation,decision_gate\`. Para releer, \`inbox\` (no consume); \`check\` sí consume.`

  return `# Conductor: la tanda y tu ciclo

Sos el conductor de esta tanda (skill \`conductor\`)${handle ? `; tu handle en esta sesión es \`${handle}\` (si te reabrieron, los hijos pueden seguir escribiéndole al viejo: el despertador los mira igual)` : ''}. El registro dice:

${brief(summary, nowMs)}

Tu ciclo, sin esperar a que el usuario te lo recuerde:
1. ${mail}
2. Cada gate lo decidís vos con tu recomendación —también contratos, permisos, auth, arquitectura, alcance o A/B—, con una condición de freno para el hijo y la decisión escrita en la PR, y lo reportás en una línea. Al usuario solo le subís lo crítico: escribir fuera de local (prod, ambientes compartidos), push/merge, crear o editar tickets (salvo la parte N de un recorte), tocar un repo que el ticket no nombra, o algo que necesita a otra persona. Si con AskUserQuestion, cada header empieza con "Crítico". Lo ya preguntado no se repite.
3. Un ticket con todas sus PRs en GREEN y sin anunciar: se anuncia (cola por ticket, \`announce-arm\` primero).
4. Anunciado: se limpia el worktree y se cierra el ticket, sin esperar el merge.
5. Turno de QA: se concede de a uno y se anota con \`conductor-ledger.sh set <ticket> qaTurn held|queued\` (\`""\` al liberarlo).

Mensajería: respondé al \`from_handle\` del último mensaje del hijo, no al del preamble; \`reply\` y \`terminal send\` van en la misma llamada.`
}

const ORCH_CHECK = /\borca(?:-ide)?\s+orchestration\s+check\b/
const WORKTREE_CREATE = /\borca(?:-ide)?\s+worktree\s+create\b/

// A reason to refuse this Bash command, or null to let it run.
export function bashGuard(command: string, rows: Row[], isInjected = false): string | null {
  for (const part of command.split(/&&|\|\||;|\n/)) {
    if (isInjected && ORCH_CHECK.test(part) && /--wait\b/.test(part)) {
      return 'en esta sesión Orca te inyecta los mensajes de los hijos y quedan leídos al llegar: un check --wait vuelve vacío aunque hayan llegado gates. No hace falta esperar; para releer, orca-ide orchestration inbox (no consume).'
    }
    if (ORCH_CHECK.test(part) && /--wait\b/.test(part) && !/--types\b/.test(part)) {
      return 'check --wait sin --types entrega mensajes viejos de otras tandas como si fueran la respuesta. Agregá --types worker_done,escalation,decision_gate.'
    }
    if (WORKTREE_CREATE.test(part)) {
      const lower = part.toLowerCase()
      // The id as a whole token: EDW-80 must not match edw-802.
      const taken = rows.find(row => {
        const id = row.id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        return new RegExp(`(^|[^a-z0-9])${id}(?![0-9])`).test(lower)
      })
      if (taken) {
        return `${taken.id} ya está abierto en el registro (${taken.name}). Reconciliá con el hijo existente (conductor-ledger.sh brief) en vez de crear otro worktree.`
      }
    }
  }

  return null
}

export const CRITICAL = /^\s*cr[ií]tic[oa]\b/i

// The conductor decides whatever has a recommendation. A question it still has
// to ask is critical, and tagged by starting its header with "Crítico".
export function askGuard(headers: string[]): string | null {
  if (headers.length > 0 && headers.every(header => CRITICAL.test(header))) return null

  return 'Sos el conductor: decidí con tu recomendación, ponele al hijo una condición de freno, pedile que lo deje escrito en la PR, y reportá en una línea. NO son críticos y se deciden: la rama base (sin label, project.baseBranch), un contrato, permisos, auth, arquitectura, el alcance, un plan, dos opciones con recomendación. Crítico es solo: escribir fuera de local (prod, ambientes compartidos), push/merge, crear o editar tickets (salvo la parte N de un recorte), tocar un repo que el ticket no nombra, o algo que necesita a otra persona. Si y solo si es eso, cada header empieza con "Crítico".'
}

// This terminal's handle in `orca-ide terminal list --json`, by the pane key
// Orca puts in its environment (`<tabId>:<leafId>`).
export function ownHandle(listJson: string, paneKey: string): string | null {
  try {
    const data = JSON.parse(listJson) as { result?: { terminals?: unknown } }
    const terminals = data.result?.terminals
    if (!Array.isArray(terminals)) return null
    const mine = terminals.find(
      (t: { tabId?: unknown; leafId?: unknown }) => `${String(t.tabId)}:${String(t.leafId)}` === paneKey,
    ) as { handle?: unknown } | undefined

    return typeof mine?.handle === 'string' ? mine.handle : null
  } catch {
    return null
  }
}
