import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-13T12:00:00Z')

const PANE = {
  component: 'Pane',
  requestId: 'conductor-tanda',
  props: { title: 'Tanda', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const LEDGER = JSON.stringify({
  tickets: {
    'TCK-1': {
      name: 'TCK-1 · activo',
      state: 'open',
      updatedAt: '2026-10-13T11:58:00Z',
      prs: [{ repo: 'o/front', number: 7, gate: 'GREEN' }],
    },
    'TCK-2': { name: 'TCK-2 · viejo', state: 'open', updatedAt: '2026-09-01T00:00:00Z' },
  },
})

// The host beneath the plugin: a workspace at /w whose ledger holds `text`.
function host(on: On, text: string | null) {
  const disk = { text }
  const toasts: string[] = []
  const opened: string[] = []
  const statuses: (string | undefined)[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('skill.prompt', async ($, e) => ({ text: e.text }))
  mock.env(on, { HOME: '/h', WORKBENCH_WORKSPACE: '/w' })
  on('fs.read', async ($, e) => {
    if (disk.text === null || e.path !== '/h/.claude/workbench/state/conductor-w.json') throw new Error('ENOENT')

    return { value: disk.text }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.open', async ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.status', async ($, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', async ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return { disk, toasts, clock, opened, statuses }
}

test('the pane draws active tickets and counts the stale ones', async ($, on) => {
  host(on, LEDGER)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'conductor', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /TCK-1 · activo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /front#7 GREEN/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+ 1 abiertos viejos/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TCK-2/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('without a ledger the session stays silent', async ($, on) => {
  const { opened, statuses } = host(on, null)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual([])
  expect(statuses.filter(text => text !== undefined)).toEqual([])
})

test('in the armed session a gate that turns red raises a toast on the next poll', async ($, on) => {
  const { disk, toasts, clock } = host(on, LEDGER)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })
  expect(toasts).toEqual([])

  disk.text = LEDGER.replace('"GREEN"', '"RED"')
  await clock.advance(5000)
  await clock.settle()
  expect(toasts).toEqual(['TCK-1: front#7 → RED'])
})
