import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState } from '../types'
import {
  AGENT_DENIED,
  ASK_USER_DENIED,
  anchorText,
  askContext,
  bashGuard,
  isAsk,
  isDispatched,
  isWorkBranch,
  latestForMe,
  ownHandle,
  parseGitStatus,
  parseMessages,
  repoLine,
  submodulePaths,
  unreadForMe,
  wakeText,
} from './child'

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
  const isMine = isDispatched((await orca($, 'orchestration', 'task-list')) ?? '', me)
  await update($, dispatched, () => isMine)
}

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

const isChild = async ($: EngineInterface) => (await read($, isArmed)) && (await read($, dispatched))

// Wakes the child when the conductor wrote to it and it did not read it: the
// usual reason a child sits idle after an answer.
async function poll($: EngineInterface): Promise<void> {
  if (!(await read($, isArmed))) return
  if ((await read($, handle)) === null) await identify($)
  const me = await read($, handle)
  if (me === null || !(await read($, dispatched))) return

  const messages = await inbox($, me)
  const latest = latestForMe(messages, me)
  if (latest) await update($, conductor, () => latest.from_handle)

  const seen = new Set(await read($, woken))
  const unread = unreadForMe(messages, me).filter(m => !seen.has(m.id))
  const text = wakeText(unread)
  if (text === null) return
  await update($, woken, list => [...list, ...unread.map(m => m.id)].slice(-500))
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
    if (e.command !== undefined || (await read($, isComposed)) || !(await isChild($))) return next(e)
    const text = anchorText(await read($, handle), await read($, repos), await read($, conductor))

    return next({ ...e, context: [...(e.context ?? []), text] })
  }).catch(($, e, next) => next(e))

  // The guards are a reminder, not a lock: if one fails, the call goes on.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await isChild($))) return next(e)
    const reason = bashGuard(e.command, e.run_in_background === true)
    if (reason !== null) return { deny: `ticket-workflow: ${reason}` }

    const ran = await next(e)
    const me = await read($, handle)
    if (!isAsk(e.command) || me === null || ran.deny !== undefined) return ran

    // `ask` may print only the tail of the answer: hand the model the whole body.
    const latest = latestForMe(await inbox($, me), me)
    if (latest === null || !latest.body) return ran
    await update($, woken, list => [...list, latest.id].slice(-500))
    await update($, conductor, () => latest.from_handle)

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
