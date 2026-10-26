import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-13T12:00:00Z')

// The same ticket before it has a PR: its child is still on the hook to deliver.
const LEDGER_NO_PR = JSON.stringify({
  tickets: { 'TCK-1': { name: 'TCK-1 · uno', state: 'open', updatedAt: '2026-10-13T11:58:00Z', child: { handle: 'term_a' }, prs: [] } },
})

const LEDGER = JSON.stringify({
  tickets: {
    'TCK-1': {
      name: 'TCK-1 · uno',
      state: 'open',
      updatedAt: '2026-10-13T11:58:00Z',
      child: { handle: 'term_a' },
      prs: [{ repo: 'o/front', number: 7, gate: 'PENDING' }],
    },
  },
})

// The host beneath the plugin: a workspace at /w with one open ticket, an Orca
// inbox the test fills, and every prompt the plugin submits recorded.
function host(on: On, ledgerText = LEDGER) {
  const inbox: object[] = []
  const prompts: string[] = []
  const contexts: (readonly string[])[] = []
  // Orca's terminals (null: the list answers like the inbox, as before), the
  // tail every `terminal read` returns, and the handles a nudge was typed into.
  let terminals: object[] | null = null
  let tail = ''
  const sent: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/h', WORKBENCH_WORKSPACE: '/w' })
  mock.store(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.read', async ($, e) => {
    if (e.path !== '/h/.claude/workbench/state/conductor-w.json') throw new Error('ENOENT')

    return { value: ledgerText }
  })
  on('process.run', async ($, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.includes('terminal send')) sent.push(e.argv[e.argv.indexOf('--terminal') + 1] ?? '')
    const stdout = cmd.includes('terminal list') && terminals !== null
      ? JSON.stringify({ result: { terminals } })
      : cmd.includes('terminal read')
        ? JSON.stringify({ result: { terminal: { tail: tail.split('\n') } } })
        : JSON.stringify({ result: { messages: inbox } })

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('skill.prompt', async ($, e) => ({ text: e.text }))
  on('prompt.submit', async ($, e) => {
    prompts.push(e.text)
    contexts.push(e.context ?? [])

    return { text: e.text } as never
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'core', text: 'core', scope: 'shared' as const }] }))
  on('tool.call', async () => ({ result: 'ran' }) as never)

  const orca = {
    set: (list: object[] | null, screen = '') => {
      terminals = list
      tail = screen
    },
  }

  return { inbox, prompts, contexts, clock, sent, orca }
}

// The tests drive the engine with partial inputs, so `$` is loosely typed here.
const start = ($: any) =>
  $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

const compose = ($: any) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)

test('an unarmed session gets no anchor, no guard and no wake', async ($: any, on: On) => {
  const { inbox, prompts, clock } = host(on)
  await start($)

  const composed = await compose($)
  expect(composed.sections.map((s: { id: string }) => s.id)).toEqual(['core'])

  const ran = await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'orca orchestration check --wait' } as never)
  expect(ran.deny).toBeUndefined()

  inbox.push({ id: 'm1', from_handle: 'term_a', type: 'decision_gate', read: 0, subject: 'Gate 2' })
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts).toEqual([])
})

test('loading the conductor skill arms the session', async ($: any, on: On) => {
  const { inbox, prompts, clock } = host(on)
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })

  const composed = await compose($)
  const anchor = composed.sections.find((s: { id: string }) => s.id === 'conductor:anchor')
  expect(anchor?.text).toContain('TCK-1 · uno')

  const denied = await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'orca orchestration check --wait' } as never)
  expect(denied.deny).toContain('--types')

  const asked = await $.tool.call({
    tool: 'AskUserQuestion',
    tool_use_id: 't2',
    questions: [{ question: '¿A o B?', header: 'Approach', options: [], multiSelect: false }],
  } as never)
  expect(asked.deny).toContain('Sos el conductor')

  inbox.push({ id: 'm1', from_handle: 'term_a', type: 'decision_gate', read: 0, subject: 'Gate 2' })
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('TCK-1: decision_gate (Gate 2) sin atender (m1)')

  // The same message never wakes it twice.
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts.length).toBe(1)
})

// Seven 31-minute jumps run some 2,600 poll ticks: it sits near the default 5 s.
test('idle nudges stop after three in a row and restart when the person speaks', { timeoutMs: 15_000 }, async ($: any, on: On) => {
  const { prompts, clock } = host(on)
  on('turn.complete', async ($, e) => ({ text: e.answer }))
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' } as never)

  for (let i = 0; i < 6; i++) {
    await clock.advance(31 * 60_000)
    await clock.settle()
  }
  expect(prompts.length).toBe(3)
  expect(prompts[0]).toContain('Pasó un rato sin actividad')

  await $.prompt.submit({ text: 'hola', origin: { kind: 'composer' } } as never)
  await clock.advance(31 * 60_000)
  await clock.settle()
  expect(prompts.filter(text => text.includes('Pasó un rato')).length).toBe(4)
})

test('in the armed session Orca heartbeats go to the pane and the rest goes through', async ($: any, on: On) => {
  const { prompts } = host(on)
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })

  const beat = '──── From: TERM_A (term_a) (heartbeat) ────\nSubject: alive\n────────'
  const gate = '──── From: TERM_A (term_a) (decision_gate) ────\nSubject: Gate 2\n────────'
  const dropped = await $.prompt.submit({ text: `--- Orchestration Messages (1) ---\n${beat}\n---`, origin: { kind: 'composer' } } as never)
  expect(dropped.drop).toContain('heartbeat')

  await $.prompt.submit({ text: `--- Orchestration Messages (2) ---\n${beat}\n${gate}\n---`, origin: { kind: 'composer' } } as never)
  expect(prompts.at(-1)).toContain('Subject: Gate 2')
  expect(prompts.at(-1)).not.toContain('alive')

  // Having seen the injection, a check --wait is refused: it would come back empty.
  const denied = await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'orca orchestration check --wait --types worker_done' } as never)
  expect(denied.deny).toContain('inbox')
})

test('with prompt.compose skipped, the anchor rides on each prompt until compose runs', async ($: any, on: On) => {
  const { contexts } = host(on)
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })

  // An organization's security plugin skipped compose: the anchor goes as context.
  await $.prompt.submit({ text: 'seguí', origin: { kind: 'composer' } } as never)
  expect(contexts.at(-1)?.length).toBe(1)

  // Once compose runs, the system prompt carries it and the context stops.
  await compose($)
  await $.prompt.submit({ text: 'seguí', origin: { kind: 'composer' } } as never)
  expect(contexts.at(-1)).toEqual([])
})

test('the Skill tool call arms the session, since skill.prompt can be skipped', async ($: any, on: On) => {
  host(on)
  await start($)
  await $.tool.call({ tool: 'Skill', tool_use_id: 's1', skill: 'conductor' } as never)

  const anchor = (await compose($)).sections.find((s: { id: string }) => s.id === 'conductor:anchor')
  expect(anchor?.text).toContain('TCK-1 · uno')
})

test('a stalled child is nudged by the mod, and the conductor hears only once nudges run out', async ($: any, on: On) => {
  const { prompts, clock, sent, orca } = host(on, LEDGER_NO_PR)
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })
  orca.set([{ handle: 'term_a', title: '✳ TCK-1 · uno', connected: true, orphaned: false, lastOutputAt: NOW - 10 * 60_000 }], '● listo, espero.')

  await clock.advance(60_000)
  await clock.settle()
  expect(sent).toEqual(['term_a'])
  expect(prompts.filter(p => p.includes('PARADO'))).toEqual([])

  // Two more stalls, five minutes apart: the third pass wakes the conductor.
  for (let i = 0; i < 2; i++) {
    await clock.advance(5 * 60_000)
    await clock.settle()
  }
  expect(sent.length).toBe(3)
  expect(prompts.some(p => p.includes('TCK-1 · uno: sigue PARADO'))).toBe(true)

  const anchor = (await compose($)).sections.find((s: { id: string }) => s.id === 'conductor:anchor')
  expect(anchor?.text).toContain('Estado real de los hijos')
  expect(anchor?.text).toContain('PARADO')
})

test('a child waiting on its own stack is left alone', async ($: any, on: On) => {
  const { prompts, clock, sent, orca } = host(on, LEDGER_NO_PR)
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })
  orca.set([{ handle: 'term_a', title: '✳ TCK-1 · uno', connected: true, orphaned: false, lastOutputAt: NOW - 20 * 60_000 }],
    '● Esperando que la api arranque.\n✻ done · 1 shell, 1 monitor still running')

  await clock.advance(60_000)
  await clock.settle()
  expect(sent).toEqual([])
  expect(prompts.filter(p => p.includes('Estado real'))).toEqual([])
})

test('a dead child wakes the conductor right away', async ($: any, on: On) => {
  const { prompts, clock, orca } = host(on)
  await start($)
  await $.skill.prompt({ skill: 'conductor', text: 'skill body' })
  orca.set([])

  await clock.advance(60_000)
  await clock.settle()
  expect(prompts.some(p => p.includes('TCK-1 · uno: MUERTO'))).toBe(true)
})
