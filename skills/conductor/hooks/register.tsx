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
import { healthLabel, healthOf, healthWake, nudgeText, parseTail, parseTerminals, ASK_MS, STALL_MS } from './health'
import type { Health } from './health'
import { withoutHeartbeats } from './inject'
import { anchorSection, dispatchGuard, isForbidden, modelsSent, parseCommand, parseRouting, runsOn, statusText, withRouting } from './routing'

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
const routing = atom({ plugin: 'conductor', key: 'routing' } as const, { enabled: false, conductor: null, child: null, childHeavy: null, forbidden: [] })
const modelSentTo = atom({ plugin: 'conductor', key: 'modelSentTo' } as const, {})
const isModelPending = atom({ plugin: 'conductor', key: 'isModelPending' } as const, false)
const heartbeats = atom({ plugin: 'conductor', key: 'heartbeats' } as const, {})
const isInjected = atom({ plugin: 'conductor', key: 'isInjected' } as const, false)
const isComposed = atom({ plugin: 'conductor', key: 'isComposed' } as const, false)
const health = atom({ plugin: 'conductor', key: 'health' } as const, {})
const childNudges = atom({ plugin: 'conductor', key: 'childNudges' } as const, {})

// A stalled child is nudged at most this often, and this many times per stall.
const NUDGE_EVERY_MS = 5 * 60_000
const MAX_CHILD_NUDGES = 3

// What the anchor says about each child: measured, never assumed.
async function healthSection($: EngineInterface): Promise<string> {
  const map = await read($, health)
  const lines = (await read($, rows)).flatMap(row => (map[row.id] ? [`- ${row.name}: ${map[row.id]}`] : []))
  if (lines.length === 0) return ''

  return ['Estado real de los hijos (medido en Orca cada minuto; no digas "está trabajando" sin esto):', ...lines].join('\n')
}

// The batch, the cycle and the model routing, re-read on every request.
async function anchor($: EngineInterface): Promise<string> {
  const now = await $.clock.now()

  const children = await healthSection($)

  return `${anchorText(summarize(await read($, rows), now), now, await read($, handle), await read($, isInjected))}\n\n${anchorSection(await read($, routing))}${children ? `\n\n${children}` : ''}`
}

// Measures every active child in Orca, nudges the stalled ones itself, and
// returns the lines the conductor has to act on (dead, blocked, owed an answer).
async function checkChildren($: EngineInterface, open: Row[], now: number): Promise<string[]> {
  const children = open.filter(row => row.handle !== null && !row.isCleaned)
  if (children.length === 0) return []
  let listed: ReturnType<typeof parseTerminals> = null
  try {
    const { exitCode, stdout } = await $.process.run(['orca-ide', 'terminal', 'list', '--json'])
    if (exitCode === 0) listed = parseTerminals(stdout)
  } catch {
    return []
  }
  if (listed === null) return []
  const byHandle = new Map(listed.map(t => [t.handle, t]))

  const verdicts: Record<string, string> = {}
  const lines: string[] = []
  const seen = new Set(await read($, woken))
  const fresh: string[] = []
  for (const row of children) {
    const handleOf = row.handle as string
    const terminal = byHandle.get(handleOf)
    let tail = ''
    const quiet = terminal?.lastOutputAt == null ? 0 : now - terminal.lastOutputAt
    if (terminal && (/^\s*✳/.test(terminal.title) || quiet >= Math.min(STALL_MS, ASK_MS))) {
      try {
        const { exitCode, stdout } = await $.process.run(['orca-ide', 'terminal', 'read', '--terminal', handleOf, '--limit', '30', '--json'])
        if (exitCode === 0) tail = parseTail(stdout)
      } catch {
        // unreadable: judge by the title alone
      }
    }
    const verdict: Health = healthOf(row, terminal, tail, now)
    verdicts[row.id] = healthLabel(verdict)

    const nudges = (await read($, childNudges))[handleOf] ?? { count: 0, at: 0 }
    if (verdict.kind === 'stalled') {
      if (nudges.count < MAX_CHILD_NUDGES && now - nudges.at >= NUDGE_EVERY_MS) {
        try {
          await $.process.run(['orca-ide', 'terminal', 'send', '--terminal', handleOf, '--text', nudgeText(row), '--enter', '--json'])
          await update($, childNudges, map => ({ ...map, [handleOf]: { count: nudges.count + 1, at: now } }))
          $.ui.toast(`${row.name}: estaba parado, le dije que siga (${nudges.count + 1}/${MAX_CHILD_NUDGES}).`, { timeoutMs: 8000 })
        } catch {
          // the send failed: the conductor hears about it below once the nudges run out
        }
      }
    } else if (nudges.count > 0) {
      await update($, childNudges, map => {
        const { [handleOf]: _dropped, ...rest } = map

        return rest
      })
    }

    const line = healthWake(row, verdict, nudges.count)
    // Each condition wakes the conductor once; an unanswered ask, again every 15 minutes.
    const bucket = verdict.kind === 'asking' ? Math.floor(verdict.sinceMin / 15) : verdict.kind === 'stalled' ? nudges.count : 0
    const key = `health:${row.id}:${verdict.kind}:${bucket}`
    if (line !== null && !seen.has(key)) {
      lines.push(line)
      fresh.push(key)
    }
  }
  await update($, health, () => verdicts)
  if (fresh.length > 0) await update($, woken, list => [...list, ...fresh].slice(-500))

  return lines
}

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

// The capabilities file, where `choices.modelRouting` lives next to the other choices.
async function capabilitiesPath($: EngineInterface): Promise<string> {
  const override = await $.env.get('WORKBENCH_CAPABILITIES')
  if (override) return override

  return `${await $.env.get('HOME')}/.claude/workbench/capabilities.json`
}

async function refreshRouting($: EngineInterface): Promise<void> {
  const next = parseRouting(await readText($, await capabilitiesPath($)))
  if (JSON.stringify(next) !== JSON.stringify(await read($, routing))) await update($, routing, () => next)
}

// An armed conductor moves itself to its routed model, once per arming. It runs
// from the poll, not from a hook the turn waits on, where `command.run` is refused.
async function applyConductorModel($: EngineInterface): Promise<void> {
  if (!(await read($, isArmed)) || !(await read($, isModelPending))) return
  await update($, isModelPending, () => false)
  const { enabled, conductor } = await read($, routing)
  if (!enabled || conductor === null) return
  if (runsOn(await $.session.model(), conductor)) return
  try {
    await $.command.run({ command: 'model', args: conductor })
    $.ui.toast(`Ruteo de modelos: el conductor pasa a ${conductor}.`, { timeoutMs: 8000 })
  } catch {
    // the session is busy past a Stop or the host refused: the next arming retries
  }
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
    await update($, isModelPending, () => true)
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

  const now = await $.clock.now()
  const childLines = await checkChildren($, open, now)
  const seen = new Set(await read($, woken))
  const pending = pendingFromChildren(messages, open).filter(p => !seen.has(p.id))
  const announce = readyToAnnounce(open).filter(id => !seen.has(`announce:${id}`))
  const base = wakeText(pending, announce)
  const text =
    childLines.length === 0
      ? base
      : [base ?? '[conductor] Un hijo no está trabajando; destrabalo sin esperar al usuario.', '', 'Estado real de los hijos (medido en Orca):', ...childLines].join('\n')

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
    await update($, isModelPending, () => wasArmed)
    await refreshRouting($)
    await $.command.register({
      name: 'tanda',
      description: 'Pane de la tanda del conductor; "/tanda viejos" lista los abiertos viejos, "/tanda on|off" arma o desarma esta sesión',
    })
    await $.command.register({
      name: 'model-routing',
      description: 'Qué modelo usa cada agente de la tanda: "/model-routing on|off|status", "/model-routing set <conductor|child|childHeavy> <modelo>"',
    })
    await refresh($, path, true)
    $.clock.every(POLL_MS, () => {
      void refresh($, path, false)
      void refreshRouting($).then(() => applyConductorModel($))
    })
    $.clock.every(INBOX_MS, () => void wake($))
    if (await read($, isArmed)) void $.ui.open({ id: PANE, title: 'Tanda' })

    return started
  })

  // An organization's security plugin can skip skill.prompt: the Skill tool call
  // and the slash command arm the session too.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (/(^|:)conductor$/.test(e.skill) && result.deny === undefined) await arm($, true)

    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'conductor' }, async ($, e, next) => {
    await arm($, true)

    return next(e)
  }).catch(($, e, next) => next(e))

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

  on('prompt.submit', async ($, e, next) => {
    const filtered = e.command === undefined ? withoutHeartbeats(e.text) : null
    // The person spoke: the idle nudges start counting again.
    // An organization's security plugin can skip a user plugin's prompt.compose.
    // Until compose is seen running, the anchor rides on each prompt as context.
    const withAnchor = async (input: typeof e) =>
      input.command === undefined && (await read($, isArmed)) && !(await read($, isComposed))
        ? { ...input, context: [...(input.context ?? []), await anchor($)] }
        : input
    if (filtered === null) {
      if (e.origin.kind === 'composer') await update($, idleNudges, () => 0)

      return next(await withAnchor(e))
    }

    // Orca's injected mail: seeing it once tells the session the injection rules,
    // and its heartbeats go to the pane instead of costing the conductor a turn.
    await update($, isInjected, () => true)
    if (!(await read($, isArmed)) || filtered.heartbeats.length === 0) return next(await withAnchor(e))

    const now = await $.clock.now()
    await update($, heartbeats, map => ({ ...map, ...Object.fromEntries(filtered.heartbeats.map(h => [h, now])) }))
    if (filtered.text === null) return { drop: `conductor: ${filtered.heartbeats.length} heartbeat(s) al pane, sin turno.` }

    return next(await withAnchor({ ...e, text: filtered.text }))
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isArmed))) return composed
    await update($, isComposed, () => true)
    const section = { id: 'conductor:anchor', text: await anchor($), scope: 'session' } as const

    return { ...composed, sections: [...composed.sections, section] }
  })

  // The guards are a reminder, not a lock: if one fails, the call goes on.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await read($, isArmed))) return next(e)
    const reason = bashGuard(e.command, await read($, rows), await read($, isInjected)) ?? dispatchGuard(e.command, await read($, routing), await read($, modelSentTo))
    if (reason !== null) return { deny: `conductor: ${reason}` }
    const result = await next(e)
    const sent = modelsSent(e.command)
    if (sent.length > 0) {
      await update($, modelSentTo, map => ({ ...map, ...Object.fromEntries(sent.map(s => [s.handle, s.model])) }))
    }

    return result
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

  on('command.run', { command: 'model-routing' }, async ($, e) => {
    const parsed = parseCommand(e.args)
    if (parsed.kind === 'error') return { text: parsed.text }
    const path = await capabilitiesPath($)
    if (parsed.kind === 'set' && isForbidden(parsed.model, (await read($, routing)).forbidden)) {
      return { text: `${parsed.model} está prohibido (choices.modelRouting.forbidden): no lo asigno a ${parsed.role}.` }
    }
    if (parsed.kind !== 'status') {
      const patch = parsed.kind === 'toggle' ? { enabled: parsed.on } : { [parsed.role]: parsed.model }
      try {
        await $.fs.write(path, withRouting(await readText($, path), patch))
      } catch {
        return { text: `No pude escribir ${path}: no es JSON válido o no se puede escribir. No lo toqué.` }
      }
      if (parsed.kind === 'toggle' && parsed.on) await update($, isModelPending, () => true)
    }
    await refreshRouting($)

    return { text: statusText(await read($, routing)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const summary = summarize(await read($, rows), now)
    const beats = await read($, heartbeats)
    const alive = (row: Row) => {
      const at = row.handle === null ? undefined : beats[row.handle]

      return at === undefined ? '' : `  ♥ ${ago(new Date(at).toISOString(), now)}`
    }
    const line = (row: Row) => (
      <Box flexDirection="column" key={row.id}>
        <Text bold>{row.name}</Text>
        <Text>
          {row.qaTurn !== null ? `QA: ${row.qaTurn}  ` : ''}
          {row.prs.length === 0 ? 'sin PR' : row.prs.map(prLabel).join('  ')}
          {'  '}
          {row.isAnnounced ? '✓ anunciado' : '✗ sin anunciar'}
        </Text>
        <Text dimColor>
          {ago(row.updatedAt, now)}
          {alive(row)}
        </Text>
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
