import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row } from '../types'
import {
  anchorText,
  askGuard,
  bashGuard,
  idleText,
  ownHandle,
  parseInbox,
  pendingFromChildren,
  readyToAnnounce,
  wakeText,
} from './autonomy'
import { ago, brief, changes, ledgerPath, parseLedger, prLabel, staleReport, statusLine, summarize } from './ledger'

const PANE = 'conductor-tanda'
const POLL_MS = 5000
const INBOX_MS = 60_000
// With active tickets and no turn for this long, the conductor is nudged to look,
// at most MAX_IDLE_NUDGES times in a row: past that, only a child's message or the
// person wakes it, so an idle night does not burn a turn every half hour.
const IDLE_MS = 30 * 60_000
const MAX_IDLE_NUDGES = 3

const ledger = atom({ plugin: 'conductor', key: 'ledger' } as const, null)
const rows = atom({ plugin: 'conductor', key: 'rows' } as const, [])
const isArmed = atom({ plugin: 'conductor', key: 'isArmed' } as const, false)
const woken = atom({ plugin: 'conductor', key: 'woken' } as const, [])
const lastTurnAt = atom({ plugin: 'conductor', key: 'lastTurnAt' } as const, 0)
const idleNudges = atom({ plugin: 'conductor', key: 'idleNudges' } as const, 0)
const handle = atom({ plugin: 'conductor', key: 'handle' } as const, null)

// The ledger's text, or null when the file is missing or unreadable.
async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// The workspace is the git toplevel of the session's cwd, as the script resolves it.
async function workspaceOf($: EngineInterface, cwd: string): Promise<string> {
  const override = await $.env.get('WORKBENCH_WORKSPACE')
  if (override) return override
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    if (exitCode === 0 && stdout.trim() !== '') return stdout.trim()
  } catch {
    // not a git checkout: fall back to the cwd
  }

  return cwd
}

const armedKey = async ($: EngineInterface) => `armed:${await $.session.id()}`

// This session's own Orca terminal, so the anchor names the handle to check.
async function identify($: EngineInterface): Promise<void> {
  const paneKey = await $.env.get('ORCA_PANE_KEY')
  if (!paneKey) return
  try {
    const { exitCode, stdout } = await $.process.run(['orca-ide', 'terminal', 'list', '--json'])
    if (exitCode === 0) {
      const me = ownHandle(stdout, paneKey)
      await update($, handle, () => me)
    }
  } catch {
    // no Orca on this host
  }
}

async function arm($: EngineInterface, on: boolean): Promise<void> {
  await update($, isArmed, () => on)
  if (on) await identify($)
  await $.store.set(await armedKey($), on)
  if (on) {
    await update($, lastTurnAt, () => 0)
    void $.ui.open({ id: PANE, title: 'Tanda' })
  }
}

async function refresh($: EngineInterface, path: string, isFirst: boolean): Promise<void> {
  const text = await readText($, path)
  const next = text === null ? [] : (parseLedger(text) ?? [])
  const prev = await read($, rows)
  if (JSON.stringify(prev) === JSON.stringify(next)) return

  await update($, rows, () => next)
  if (!isFirst && (await read($, isArmed))) {
    for (const line of changes(prev, next)) $.ui.toast(line, { timeoutMs: 8000 })
  }
  $.ui.status(statusLine(summarize(next, await $.clock.now())))
}

// Wakes the conductor when a child waits on it or a ticket is ready to announce.
// Each message and ticket wakes it once; the prompt queues until the session is idle.
async function wake($: EngineInterface): Promise<void> {
  if (!(await read($, isArmed))) return
  const open = await read($, rows)
  if (open.length === 0) return

  let messages: ReturnType<typeof parseInbox> = []
  try {
    const { exitCode, stdout } = await $.process.run(['orca-ide', 'orchestration', 'inbox', '--limit', '100', '--json'])
    if (exitCode === 0) messages = parseInbox(stdout)
  } catch {
    // no Orca on this host: the ledger half still runs
  }

  const seen = new Set(await read($, woken))
  const pending = pendingFromChildren(messages, open).filter(p => !seen.has(p.id))
  const announce = readyToAnnounce(open).filter(id => !seen.has(`announce:${id}`))
  const text = wakeText(pending, announce)
  const now = await $.clock.now()

  if (text !== null) {
    const ids = [...pending.map(p => p.id), ...announce.map(id => `announce:${id}`)]
    await update($, woken, list => [...list, ...ids].slice(-500))
    await update($, lastTurnAt, () => now)
    await update($, idleNudges, () => 0)
    await $.prompt.submit({ text })

    return
  }

  const summary = summarize(open, now)
  const last = await read($, lastTurnAt)
  const nudges = await read($, idleNudges)
  if (summary.active.some(row => row.handle !== null) && last > 0 && now - last > IDLE_MS && nudges < MAX_IDLE_NUDGES) {
    await update($, lastTurnAt, () => now)
    await update($, idleNudges, n => n + 1)
    await $.prompt.submit({ text: idleText(summary, now) })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const home = await $.env.get('HOME')
    const stateDir = (await $.env.get('WORKBENCH_STATE_DIR')) ?? `${home}/.claude/workbench/state`
    const path = ledgerPath(stateDir, await workspaceOf($, e.cwd))

    await update($, ledger, () => path)
    // A resumed conductor session stays armed across restarts.
    const wasArmed = (await $.store.get(await armedKey($))) === true
    await update($, isArmed, () => wasArmed)
    if (wasArmed) await identify($)
    await $.command.register({
      name: 'tanda',
      description: 'Pane de la tanda del conductor; "/tanda viejos" lista los abiertos viejos, "/tanda on|off" arma o desarma esta sesión',
    })
    await refresh($, path, true)
    $.clock.every(POLL_MS, () => void refresh($, path, false))
    $.clock.every(INBOX_MS, () => void wake($))
    if (await read($, isArmed)) void $.ui.open({ id: PANE, title: 'Tanda' })

    return started
  })

  // Loading the conductor skill is what makes this session the conductor.
  on('skill.prompt', { skill: 'conductor' }, async ($, e, next) => {
    const result = await next(e)
    await arm($, true)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    await update($, lastTurnAt, () => now)

    return result
  })

  // The person spoke: the idle nudges start counting again.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') await update($, idleNudges, () => 0)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isArmed))) return composed
    const now = await $.clock.now()
    const section = { id: 'conductor:anchor', text: anchorText(summarize(await read($, rows), now), now, await read($, handle)), scope: 'session' } as const

    return { ...composed, sections: [...composed.sections, section] }
  })

  // The guards are a reminder, not a lock: if one fails, the call goes on.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await read($, isArmed))) return next(e)
    const reason = bashGuard(e.command, await read($, rows))

    return reason === null ? next(e) : { deny: `conductor: ${reason}` }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await read($, isArmed))) return next(e)
    const reason = askGuard(e.questions.map(q => q.header))

    return reason === null ? next(e) : { deny: `conductor: ${reason}` }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'tanda' }, async ($, e) => {
    const path = await read($, ledger)
    if (path === null) return { text: 'Esta sesión no tiene un registro de conductor.' }
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await arm($, arg === 'on')

      return { text: arg === 'on' ? 'Sesión armada como conductor.' : 'Sesión desarmada: sin ancla, sin despertador, sin guardas.' }
    }
    await refresh($, path, true)
    const now = await $.clock.now()
    const summary = summarize(await read($, rows), now)

    if (arg === 'viejos') return { text: staleReport(summary, now) }

    const opened = await $.ui.open({ id: PANE, title: 'Tanda' })

    return opened.isPlaced ? { text: 'Pane de la tanda abierto.' } : { text: brief(summary, now) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const summary = summarize(await read($, rows), now)
    const line = (row: Row) => (
      <Box flexDirection="column" key={row.id}>
        <Text bold>{row.name}</Text>
        <Text>
          {row.qaTurn !== null ? `QA: ${row.qaTurn}  ` : ''}
          {row.prs.length === 0 ? 'sin PR' : row.prs.map(prLabel).join('  ')}
          {'  '}
          {row.isAnnounced ? '✓ anunciado' : '✗ sin anunciar'}
        </Text>
        <Text dimColor>{ago(row.updatedAt, now)}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {summary.active.length === 0 && <Text dimColor>Ningún ticket activo.</Text>}
        {summary.active.map(line)}
        {summary.stale.length > 0 && <Text dimColor>+ {summary.stale.length} abiertos viejos (/tanda viejos)</Text>}
      </Box>
    )
  })
}
