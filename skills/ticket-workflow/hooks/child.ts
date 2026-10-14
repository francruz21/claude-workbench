// What keeps a dispatched child on its ticket without the person or the
// conductor reminding it. Pure, no `$`: every rule here is tested alone.

import type { GitState, Message } from '../types'

// The child's own terminal in `orca-ide terminal list --json`: the pane key
// Orca puts in its environment is `<tabId>:<leafId>`.
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

// Whether a coordinator dispatched a task to this handle: then the conductor,
// not the person, is the one the child talks to.
export function isDispatched(taskListJson: string, handle: string): boolean {
  try {
    const data = JSON.parse(taskListJson) as { result?: { tasks?: unknown } }
    const tasks = data.result?.tasks

    return (
      Array.isArray(tasks) &&
      tasks.some(
        (t: { status?: unknown; assignee_handle?: unknown; assignee?: unknown }) =>
          (t.assignee_handle === handle || t.assignee === handle) && t.status !== 'completed',
      )
    )
  } catch {
    return false
  }
}

export function parseMessages(text: string): Message[] {
  try {
    const data = JSON.parse(text) as { result?: { messages?: unknown } }
    const messages = data.result?.messages

    return Array.isArray(messages) ? (messages as Message[]) : []
  } catch {
    return []
  }
}

const isUnread = (m: Message) => m.read === 0 || m.read === false

// Unread messages addressed to this child, oldest first.
export function unreadForMe(messages: Message[], handle: string): Message[] {
  return messages.filter(m => m.to_handle === handle && isUnread(m)).reverse()
}

// The newest message addressed to this child: the answer an `ask` just got.
export function latestForMe(messages: Message[], handle: string): Message | null {
  return messages.find(m => m.to_handle === handle) ?? null
}

export function wakeText(unread: Message[]): string | null {
  if (unread.length === 0) return null
  const lines = ['[ticket-workflow] El conductor te escribió y no lo leíste:']
  for (const m of unread) lines.push(`- ${m.subject ?? m.type} (${m.id})`)
  lines.push(
    'Leé el cuerpo entero con `orca-ide orchestration inbox --terminal <tu handle> --json` (no consume) y seguí desde ahí. Si ya lo habías leído, seguí con tu paso actual.',
  )

  return lines.join('\n')
}

// The full answer, read back from the inbox, for the model to read after an `ask`
// whose output Orca may have cut to its last lines.
export function askContext(message: Message): string {
  return `Respuesta completa del conductor, leída del inbox (${message.id}). La salida de \`ask\` puede llegar cortada: actuá sobre esta.\n\n${message.body ?? ''}`
}

// Long-lived branches: a repo sitting on one of them is not where the ticket is worked.
const LONG_LIVED = new Set(['dev', 'stage', 'master', 'main', 'design'])

export function isWorkBranch(branch: string): boolean {
  return !LONG_LIVED.has(branch)
}

export function repoLine(git: GitState): string {
  return `\`${git.repo}\` en \`${git.branch}\`: ${git.unpublished} commit(s) sin publicar, ${git.dirty} archivo(s) sin commitear, rama ${git.isPublished ? 'publicada' : 'sin publicar'}.`
}

export function anchorText(handle: string | null, repos: GitState[], conductor: string | null): string {
  const where = repos.length === 0 ? 'Ningún repo en una rama de trabajo todavía.' : repos.map(repoLine).join('\n')

  return `# Ticket en curso: dónde estás

Sos un hijo despachado por el conductor (skill \`ticket-workflow\`). Tu handle: \`${handle ?? 'desconocido'}\`${conductor ? `; el último mensaje del conductor vino de \`${conductor}\`, respondé a ese` : ''}.
${where}

Lo que no cambia aunque se compacte la conversación:
- Los cinco gates se le preguntan al conductor con \`orchestration ask\`, de a uno. Al usuario no le hablás; un gate sin respuesta no está aprobado.
- La salida de \`ask\` puede llegar cortada: después de cada \`ask\` leé la respuesta entera (el mod te la agrega, y si no, \`inbox\`).
- El heartbeat va con \`run_in_background\`: en foreground traba tu shell y no te llegan las respuestas.
- No delegás: ni subagentes ni otros worktrees. Tu mundo es este worktree.
- QA en el navegador de Orca, pidiendo el turno antes de levantar el stack. Sin OK del QA no se commitea.`
}

const HEARTBEAT = /\borca(?:-ide)?\s+orchestration\s+send\b[^\n;&|]*--type[ =]heartbeat\b/
const WORKTREE_CREATE = /\borca(?:-ide)?\s+worktree\s+create\b/

export function bashGuard(command: string, isBackground: boolean): string | null {
  if (HEARTBEAT.test(command) && !isBackground) {
    return 'el heartbeat en foreground se queda corriendo y traba tu shell: lo que te contesten queda encolado. Correlo con run_in_background.'
  }
  if (WORKTREE_CREATE.test(command)) {
    return 'sos un hijo: tu worktree ya existe y es el único. Crear worktrees es del conductor.'
  }

  return null
}

export const AGENT_DENIED = 'sos un hijo: no delegás en subagentes. Todo lo de este ticket lo hacés vos, acá.'
export const ASK_USER_DENIED =
  'sos un hijo: al usuario no le hablás. Preguntale al conductor con `orca-ide orchestration ask`.'

export function isAsk(command: string): boolean {
  return /\borca(?:-ide)?\s+orchestration\s+ask\b/.test(command)
}

// `git status --porcelain=v2 --branch` of one repo → its branch and dirty count,
// or null when HEAD is detached (a submodule left on its pin).
export function parseGitStatus(text: string): { branch: string; dirty: number } | null {
  const head = /^# branch\.head (.+)$/m.exec(text)?.[1]
  if (!head || head === '(detached)') return null
  const dirty = text.split('\n').filter(line => line !== '' && !line.startsWith('#')).length

  return { branch: head, dirty }
}

// `git submodule status` → the submodule paths.
export function submodulePaths(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim().split(/\s+/)[1])
    .filter((path): path is string => typeof path === 'string' && path !== '')
}
