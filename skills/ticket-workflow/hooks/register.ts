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
  configuredSkills,
  coordinatorOf,
  foreignBody,
  foreignContext,
  injectedText,
  isAsk,
  isDispatched,
  isFromConductor,
  cededTo,
  isHandoff,
  isMine,
  isWorkBranch,
  latestForMe,
  liveHandles,
  missingSkills,
  openTasks,
  ownHandle,
  parseDispatch,
  parseDispatchPreamble,
  parseGitStatus,
  parseInjected,
  parseMessages,
  relayBody,
  relayDropText,
  repoLine,
  signerOf,
  skillsFirstText,
  specSkills,
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
const isTicket = atom({ plugin: 'ticket-workflow', key: 'isTicket' } as const, false)
const required = atom({ plugin: 'ticket-workflow', key: 'requiredSkills' } as const, [])
const loaded = atom({ plugin: 'ticket-workflow', key: 'loadedSkills' } as const, [])

// Tools a child may use before its mandatory skills are loaded: the ones that load them.
const BEFORE_SKILLS = new Set(['Skill', 'ToolSearch'])
const MAX_LOOKUPS = 10

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

// Who this terminal is, and whether a coordinator dispatched work to it. Orca
// keeps a task's assignee in its dispatch context (`dispatch-show`), not in
// `task-list`; the second is read too, for an Orca that puts it there.
async function identify($: EngineInterface): Promise<void> {
  const paneKey = await $.env.get('ORCA_PANE_KEY')
  if (!paneKey) return
  const me = ownHandle((await orca($, 'terminal', 'list')) ?? '', paneKey)
  await update($, handle, () => me)
  const tasks = (await orca($, 'orchestration', 'task-list')) ?? ''
  let isMineFound = me !== null && isDispatched(tasks, me)
  let creator = me !== null ? coordinatorOf(tasks, me) : null

  if (!isMineFound) {
    const found: { createdBy: string | null; at: string }[] = []
    for (const task of openTasks(tasks).slice(-MAX_LOOKUPS)) {
      const dispatch = parseDispatch((await orca($, 'orchestration', 'dispatch-show', '--task', task.id)) ?? '')
      if (dispatch !== null && isMine(dispatch, me, paneKey)) found.push({ createdBy: task.createdBy, at: dispatch.at })
    }
    // The first dispatch names the conductor; a later one by someone else does not replace it.
    found.sort((x, y) => x.at.localeCompare(y.at))
    if (found.length > 0) {
      isMineFound = true
      creator = found[0]?.createdBy ?? null
    }
  }
  // Once dispatched, a child stays one: a finished task does not hand it to the person.
  if (isMineFound) await update($, dispatched, () => true)
  if ((await read($, conductor)) === null && creator !== null) await setConductor($, creator)
}

const keyOf = async ($: EngineInterface, name: string) => `${name}:${await $.session.id()}`

async function setConductor($: EngineInterface, to: string): Promise<void> {
  await update($, conductor, () => to)
  await $.store.set(await keyOf($, 'conductor'), to)
}

async function capabilitiesText($: EngineInterface): Promise<string | null> {
  const path = (await $.env.get('WORKBENCH_CAPABILITIES')) || `${await $.env.get('HOME')}/.claude/workbench/capabilities.json`
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// The mandatory skills: the person's list for every child plus the spec's `Skills:` line.
async function requireSkills($: EngineInterface, spec: string): Promise<void> {
  const next = [...new Set([...(await read($, required)), ...configuredSkills(await capabilitiesText($)), ...specSkills(spec)])]
  await update($, required, () => next)
  await $.store.set(await keyOf($, 'required'), next)
}

async function pendingSkills($: EngineInterface): Promise<string[]> {
  return missingSkills(await read($, required), await read($, loaded))
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

const armedKey = async ($: EngineInterface) => keyOf($, 'armed')

async function arm($: EngineInterface, on: boolean): Promise<void> {
  await update($, isArmed, () => on)
  await $.store.set(await armedKey($), on)
  if (on) {
    await identify($)
    await requireSkills($, '')
    await refreshGit($)
  }
}

const anchorOf = async ($: EngineInterface) =>
  anchorText(await read($, handle), await read($, repos), await read($, conductor), {
    isTicket: await read($, isTicket),
    skills: await read($, required),
  })

// Until prompt.compose is seen running, the anchor rides on each prompt as context.
async function anchored<E extends { context?: string[] }>($: EngineInterface, e: E): Promise<E> {
  if (await read($, isComposed)) return e
  const text = await anchorOf($)

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
  const superior = await superiorOf($)
  // Or the live conductor hands it over itself.
  const ceded = cededTo(message, superior)
  if (ceded !== null) {
    await setConductor($, ceded)

    return true
  }
  if (!isHandoff(message) || message.from_handle === superior) return false
  if (superior !== null && liveHandles((await orca($, 'terminal', 'list')) ?? '').has(superior)) return false
  await setConductor($, message.from_handle)

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
  if (!(await read($, isArmed))) {
    // A dispatched session is a child whether or not it loaded a skill.
    await identify($)
    if (!(await read($, dispatched))) return
    await arm($, true)
  }
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
    const kept = await $.store.get(await keyOf($, 'conductor'))
    if (typeof kept === 'string') await update($, conductor, () => kept)
    const keptLoaded = await $.store.get(await keyOf($, 'loaded'))
    if (Array.isArray(keptLoaded)) await update($, loaded, () => keptLoaded as string[])
    const keptRequired = await $.store.get(await keyOf($, 'required'))
    if (Array.isArray(keptRequired)) await update($, required, () => keptRequired as string[])
    await identify($)
    if (!wasArmed && (await read($, dispatched))) await arm($, true)
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
    // An attempt counts: a skill that does not exist here must not lock the child out.
    const next_ = [...new Set([...(await read($, loaded)), e.skill])]
    await update($, loaded, () => next_)
    await $.store.set(await keyOf($, 'loaded'), next_)
    if (/(^|:)ticket-workflow$/.test(e.skill) && result.deny === undefined) {
      await update($, isTicket, () => true)
      await arm($, true)
    }

    return result
  }).catch(($, e, next) => next(e))

  // The mandatory skills come first: until they are loaded, every other tool is refused.
  on('tool.call', async ($, e, next) => {
    if (BEFORE_SKILLS.has(e.tool) || !(await isChild($))) return next(e)
    const missing = await pendingSkills($)

    return missing.length > 0 ? { deny: `ticket-workflow: ${skillsFirstText(missing)}` } : next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ticket-workflow' }, async ($, e, next) => {
    await update($, isTicket, () => true)
    await arm($, true)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Loading the skill is what makes this session a child on a ticket.
  on('skill.prompt', { skill: 'ticket-workflow' }, async ($, e, next) => {
    const result = await next(e)
    await update($, isTicket, () => true)
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
    const text = await anchorOf($)

    return { ...composed, sections: [...composed.sections, { id: 'ticket-workflow:anchor', text, scope: 'session' } as const] }
  })

  // An organization's security plugin can skip a user plugin's prompt.compose.
  // Until compose is seen running, the anchor rides on each prompt as context.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const dispatch = parseDispatchPreamble(e.text)
    if (dispatch !== null && !(await isChild($))) {
      // The first dispatch makes this session a child, and its coordinator the conductor.
      await identify($)
      if ((await read($, conductor)) === null) await setConductor($, dispatch.coordinator)
      await update($, dispatched, () => true)
      await arm($, true)
    }
    if (!(await isChild($))) return next(e)
    if (dispatch !== null) {
      const superior = await superiorOf($)
      if (dispatch.coordinator !== superior) {
        // Another conductor's task: only an adopter takes over, once the old one is gone.
        const isAlive = superior !== null && liveHandles((await orca($, 'terminal', 'list')) ?? '').has(superior)
        if (isAlive) {
          const sent = await relay($, FOREIGN_SUBJECT, foreignBody(e.text, dispatch.coordinator, await read($, handle)))

          return { drop: `ticket-workflow: tarea despachada por ${dispatch.coordinator}, que no es el conductor de este hijo. ${sent.isSent ? `Se la pasé a ${sent.to}` : 'No pude pasársela al conductor'}; no se ejecuta.` }
        }
        await setConductor($, dispatch.coordinator)
      }
      await requireSkills($, e.text)

      return next(await anchored($, e))
    }
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
      `skills obligatorias: ${(await read($, required)).join(', ') || 'ninguna'}; faltan: ${(await pendingSkills($)).join(', ') || 'ninguna'}`,
    ]

    return { text: lines.join('\n') }
  })
}
