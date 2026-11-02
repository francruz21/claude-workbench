import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState } from '../types'
import {
  AGENT_DENIED,
  ASK_USER_DENIED,
  FOREIGN_SUBJECT,
  RELAY_SUBJECT,
  anchorText,
  askContext,
  bashGuard,
  coordinatorOf,
  foreignBody,
  foreignContext,
  injectedText,
  isAsk,
  isDispatched,
  isFromConductor,
  isHandoff,
  isWorkBranch,
  latestForMe,
  liveHandles,
  ownHandle,
  parseGitStatus,
  parseInjected,
  parseMessages,
  relayBody,
  relayDropText,
  repoLine,
  signerOf,
  splitBySender,
  submodulePaths,
  unreadForMe,
  wakeText,
} from './child'
import type { Message } from '../types'

const INBOX_MS = 60_000

const isArmed = atom({ plugin: 'ticket-workflow', key: 'isArmed' } as const, false)
const dispatched = atom({ plugin: 'ticket-workflow', key: 'isDispatched' } as const, false)
const handle = atom({ plugin: 'ticket-workflow', key: 'handle' } as const, null)
const conductor = atom({ plugin: 'ticket-workflow', key: 'conductor' } as const, null)
const repos = atom({ plugin: 'ticket-workflow', key: 'repos' } as const, [])
const woken = atom({ plugin: 'ticket-workflow', key: 'woken' } as const, [])
const isComposed = atom({ plugin: 'ticket-workflow', key: 'isComposed' } as const, false)

async function run($: EngineInterface, argv: string[], cwd?: string): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run(argv, cwd === undefined ? {} : { cwd })

    return exitCode === 0 ? stdout : null
  } catch {
    return null
  }
}

const orca = ($: EngineInterface, ...args: string[]) => run($, ['orca-ide', ...args, '--json'])

async function inbox($: EngineInterface, me: string) {
  return parseMessages((await orca($, 'orchestration', 'inbox', '--terminal', me, '--limit', '50')) ?? '')
}

// Who this terminal is, and whether a coordinator dispatched work to it.
async function identify($: EngineInterface): Promise<void> {
  const paneKey = await $.env.get('ORCA_PANE_KEY')
  if (!paneKey) return
  const me = ownHandle((await orca($, 'terminal', 'list')) ?? '', paneKey)
  await update($, handle, () => me)
  if (me === null) return
  const tasks = (await orca($, 'orchestration', 'task-list')) ?? ''
  await update($, dispatched, () => isDispatched(tasks, me))
  // The superior is whoever dispatched the live task, never whoever wrote last.
  if ((await read($, conductor)) === null) await update($, conductor, () => coordinatorOf(tasks, me))
}

const INBOX_CHECK = /\borca(?:-ide)?\s+orchestration\s+(?:check|inbox)\b/

// The worktree's repos on a work branch: the root and each submodule.
async function refreshGit($: EngineInterface): Promise<void> {
  const top = (await run($, ['git', 'rev-parse', '--show-toplevel']))?.trim()
  if (!top) return
  const paths = ['.', ...submodulePaths((await run($, ['git', 'submodule', 'status'], top)) ?? '')]
  const states: GitState[] = []

  for (const path of paths) {
    const dir = path === '.' ? top : `${top}/${path}`
    const status = parseGitStatus((await run($, ['git', 'status', '--porcelain=v2', '--branch'], dir)) ?? '')
    if (status === null || !isWorkBranch(status.branch)) continue
    const unpublished = Number((await run($, ['git', 'rev-list', '--count', 'HEAD', '--not', '--remotes'], dir))?.trim() ?? 0)
    // ls-remote, not @{u}: a branch cut with `checkout -b` tracks its base and looks published.
    const remote = await run($, ['git', 'ls-remote', '--heads', 'origin', status.branch], dir)
    states.push({
      repo: path === '.' ? (top.split('/').pop() ?? top) : path,
      branch: status.branch,
      unpublished: Number.isNaN(unpublished) ? 0 : unpublished,
      dirty: status.dirty,
      isPublished: (remote ?? '').trim() !== '',
    })
  }
  await update($, repos, () => states)
}

const armedKey = async ($: EngineInterface) => `armed:${await $.session.id()}`

async function arm($: EngineInterface, on: boolean): Promise<void> {
  await update($, isArmed, () => on)
  await $.store.set(await armedKey($), on)
  if (on) {
    await identify($)
    await refreshGit($)
  }
}

// Until prompt.compose is seen running, the anchor rides on each prompt as context.
async function anchored<E extends { context?: string[] }>($: EngineInterface, e: E): Promise<E> {
  if (await read($, isComposed)) return e
  const text = anchorText(await read($, handle), await read($, repos), await read($, conductor))

  return { ...e, context: [...(e.context ?? []), text] }
}

const isChild = async ($: EngineInterface) => (await read($, isArmed)) && (await read($, dispatched))

// The person's own gesture: typed at this terminal, or through Remote Control.
const isTyped = (origin: { kind: string } | undefined) => origin?.kind === 'composer' || origin?.kind === 'bridge'

async function superiorOf($: EngineInterface): Promise<string | null> {
  if ((await read($, conductor)) === null) await identify($)

  return read($, conductor)
}

// Anything not from the conductor reaches the conductor instead of the model:
// the conductor decides whether it becomes an order, and the child never acts on it.
async function relay($: EngineInterface, subject: string, body: string): Promise<{ to: string | null; isSent: boolean }> {
  const me = await read($, handle)
  const to = await superiorOf($)
  const isSent =
    me !== null &&
    to !== null &&
    (await orca($, 'orchestration', 'send', '--to', to, '--from', me, '--type', 'escalation', '--subject', subject, '--body', body)) !== null

  return { to, isSent }
}

async function relayPerson($: EngineInterface, text: string): Promise<{ drop: string }> {
  const signer = signerOf(text)
  const me = await read($, handle)
  // A mark with someone else's handle is another conductor, not the person.
  const sent = signer
    ? await relay($, FOREIGN_SUBJECT, foreignBody(text, signer, me))
    : await relay($, RELAY_SUBJECT, relayBody(text, me))

  return { drop: relayDropText(sent.to, sent.isSent) }
}

// A rotated conductor's successor takes over only once the old one's terminal is gone:
// a second conductor running in parallel cannot claim a live conductor's child.
async function acceptHandoff($: EngineInterface, message: Message): Promise<boolean> {
  const superior = await read($, conductor)
  if (!isHandoff(message) || message.from_handle === superior) return false
  if (superior !== null && liveHandles((await orca($, 'terminal', 'list')) ?? '').has(superior)) return false
  await update($, conductor, () => message.from_handle)

  return true
}

// Splits the unread mail: the conductor's (and an accepted handoff) wakes the
// child; the rest goes to the conductor once, and is marked as handled.
async function sortMail($: EngineInterface, unread: Message[]): Promise<{ mine: Message[]; foreign: Message[] }> {
  const me = await read($, handle)
  for (const m of unread) if (isHandoff(m)) await acceptHandoff($, m)
  const { mine, foreign } = splitBySender(unread, await superiorOf($))
  for (const m of foreign) await relay($, FOREIGN_SUBJECT, foreignBody(`${m.subject ?? m.type}\n\n${m.body ?? ''}`, m.from_handle, me))
  if (foreign.length > 0) await update($, woken, list => [...list, ...foreign.map(m => m.id)].slice(-500))

  return { mine, foreign }
}

// Wakes the child when the conductor wrote to it and it did not read it: the
// usual reason a child sits idle after an answer.
async function poll($: EngineInterface): Promise<void> {
  if (!(await read($, isArmed))) return
  if ((await read($, handle)) === null) await identify($)
  const me = await read($, handle)
  if (me === null || !(await read($, dispatched))) return

  const seen = new Set(await read($, woken))
  const unread = unreadForMe(await inbox($, me), me).filter(m => !seen.has(m.id))
  const { mine } = await sortMail($, unread)
  const text = wakeText(mine)
  if (text === null) return
  await update($, woken, list => [...list, ...mine.map(m => m.id)].slice(-500))
  await $.prompt.submit({ text })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const wasArmed = (await $.store.get(await armedKey($))) === true
    await update($, isArmed, () => wasArmed)
    if (wasArmed) await identify($)
    await $.command.register({
      name: 'hijo',
      description: 'Estado del hijo de ticket-workflow en esta sesión; "/hijo on|off" lo arma o desarma',
    })
    $.clock.every(INBOX_MS, () => void poll($))

    return started
  })

  // An organization's security plugin can skip skill.prompt: the Skill tool call
  // and the slash command arm the session too.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (/(^|:)ticket-workflow$/.test(e.skill) && result.deny === undefined) await arm($, true)

    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ticket-workflow' }, async ($, e, next) => {
    await arm($, true)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Loading the skill is what makes this session a child on a ticket.
  on('skill.prompt', { skill: 'ticket-workflow' }, async ($, e, next) => {
    const result = await next(e)
    await arm($, true)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isArmed)) await refreshGit($)

    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await isChild($))) return composed
    await update($, isComposed, () => true)
    const text = anchorText(await read($, handle), await read($, repos), await read($, conductor))

    return { ...composed, sections: [...composed.sections, { id: 'ticket-workflow:anchor', text, scope: 'session' } as const] }
  })

  // An organization's security plugin can skip a user plugin's prompt.compose.
  // Until compose is seen running, the anchor rides on each prompt as context.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || !(await isChild($))) return next(e)
    const block = parseInjected(e.text)
    if (block !== null) {
      // Orca's injected mail: only the conductor's messages reach the model.
      const superior = await superiorOf($)
      const me = await read($, handle)
      const foreign = block.filter(m => m.handle !== superior)
      for (const m of foreign) await relay($, FOREIGN_SUBJECT, foreignBody(m.lines.join('\n'), m.handle, me))
      const kept = block.filter(m => m.handle === superior)
      if (kept.length === 0) return { drop: `ticket-workflow: ${foreign.length} mensaje(s) de otros agentes, pasados al conductor sin ejecutar.` }
      if (foreign.length > 0) return next(await anchored($, { ...e, text: injectedText(kept) }))
    } else if (isTyped(e.origin) && !isFromConductor(e.text, await superiorOf($))) {
      return relayPerson($, e.text)
    }

    return next(await anchored($, e))
  }).catch(($, e, next) => next(e))

  // The guards are a reminder, not a lock: if one fails, the call goes on.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await isChild($))) return next(e)
    const reason = bashGuard(e.command, e.run_in_background === true)
    if (reason !== null) return { deny: `ticket-workflow: ${reason}` }

    const ran = await next(e)
    const me = await read($, handle)
    if (me === null || ran.deny !== undefined) return ran

    if (INBOX_CHECK.test(e.command)) {
      // The model reads the mail itself: what is not from the conductor is flagged, and relayed once.
      const seen = new Set(await read($, woken))
      const unread = unreadForMe(await inbox($, me), me).filter(m => !seen.has(m.id))
      const { foreign } = await sortMail($, unread)
      if (foreign.length === 0) return ran
      const who = [...new Set(foreign.map(m => m.from_handle))].join(', ')

      return { ...ran, context: [...(ran.context ?? []), foreignContext(who)] }
    }
    if (!isAsk(e.command)) return ran

    // `ask` may print only the tail of the answer: hand the model the whole body.
    const latest = latestForMe(await inbox($, me), me, await superiorOf($))
    if (latest === null || !latest.body) return ran
    await update($, woken, list => [...list, latest.id].slice(-500))

    return { ...ran, context: [...(ran.context ?? []), askContext(latest)] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) =>
    (await isChild($)) ? { deny: `ticket-workflow: ${AGENT_DENIED}` } : next(e),
  ).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) =>
    (await isChild($)) ? { deny: `ticket-workflow: ${ASK_USER_DENIED}` } : next(e),
  ).catch(($, e, next) => next(e))

  on('command.run', { command: 'hijo' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await arm($, arg === 'on')

      return { text: arg === 'on' ? 'Sesión armada como hijo de ticket-workflow.' : 'Sesión desarmada: sin ancla, sin despertador, sin guardas.' }
    }
    if (!(await read($, isArmed))) return { text: 'Esta sesión no corre ticket-workflow (/hijo on para armarla).' }
    await refreshGit($)
    const me = await read($, handle)
    const lines = [
      `handle: ${me ?? 'desconocido'} · ${(await read($, dispatched)) ? 'despachado por un conductor' : 'sin conductor: el interlocutor es el usuario'}`,
      ...(await read($, repos)).map(repoLine),
    ]

    return { text: lines.join('\n') }
  })
}
