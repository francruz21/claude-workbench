import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row } from '../types'
import { ago, brief, changes, ledgerPath, parseLedger, prLabel, staleReport, statusLine, summarize } from './ledger'

const PANE = 'conductor-tanda'
const POLL_MS = 5000

const ledger = atom({ plugin: 'conductor', key: 'ledger' } as const, null)
const rows = atom({ plugin: 'conductor', key: 'rows' } as const, [])

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

async function refresh($: EngineInterface, path: string, isFirst: boolean): Promise<void> {
  const text = await readText($, path)
  const next = text === null ? [] : (parseLedger(text) ?? [])
  const prev = await read($, rows)
  if (JSON.stringify(prev) === JSON.stringify(next)) return

  await update($, rows, () => next)
  if (!isFirst) for (const line of changes(prev, next)) $.ui.toast(line, { timeoutMs: 8000 })
  $.ui.status(statusLine(summarize(next, await $.clock.now())))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const home = await $.env.get('HOME')
    const stateDir = (await $.env.get('WORKBENCH_STATE_DIR')) ?? `${home}/.claude/workbench/state`
    const path = ledgerPath(stateDir, await workspaceOf($, e.cwd))
    const text = await readText($, path)
    const open = text === null ? null : parseLedger(text)

    // No ledger, or nothing open: a child's worktree or an unrelated repo. Stay silent.
    if (open === null || open.length === 0) {
      await update($, ledger, () => null)

      return started
    }

    await update($, ledger, () => path)
    await $.command.register({
      name: 'tanda',
      description: 'Estado de la tanda del conductor (pane); "/tanda viejos" lista los abiertos viejos',
    })
    await refresh($, path, true)
    $.clock.every(POLL_MS, () => void refresh($, path, false))
    if (summarize(open, await $.clock.now()).active.length > 0) {
      void $.ui.open({ id: PANE, title: 'Tanda' })
    }

    return started
  })

  on('command.run', { command: 'tanda' }, async ($, e) => {
    const path = await read($, ledger)
    if (path === null) return { text: 'Esta sesión no tiene un registro de conductor.' }
    await refresh($, path, true)
    const now = await $.clock.now()
    const summary = summarize(await read($, rows), now)

    if (e.args.trim() === 'viejos') return { text: staleReport(summary, now) }

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
        {summary.stale.length > 0 && (
          <Text dimColor>
            + {summary.stale.length} abiertos viejos (/tanda viejos)
          </Text>
        )}
      </Box>
    )
  })
}
