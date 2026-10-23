import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-13T12:00:00Z')

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
function host(on: On) {
  const inbox: object[] = []
  const prompts: string[] = []
  const contexts: (readonly string[])[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/h', WORKBENCH_WORKSPACE: '/w' })
  mock.store(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.read', async ($, e) => {
    if (e.path !== '/h/.claude/workbench/state/conductor-w.json') throw new Error('ENOENT')

    return { value: LEDGER }
  })
  on('process.run', async ($, e) => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify({ result: { messages: inbox } }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
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

  return { inbox, prompts, contexts, clock }
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

test('idle nudges stop after three in a row and restart when the person speaks', async ($: any, on: On) => {
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
