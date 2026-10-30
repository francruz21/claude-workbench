import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The host beneath the plugin: Orca knows this terminal as term_me with a live
// task, the conductor writes from term_c, and git has one work branch.
function host(on: On, opts: { isDispatched: boolean }) {
  const inbox: object[] = []
  const prompts: string[] = []
  const sends: string[][] = []
  const contexts: (readonly string[])[] = []
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { ORCA_PANE_KEY: 'tab2:leafB' })
  mock.store(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('skill.prompt', async ($, e) => ({ text: e.text }))
  on('prompt.submit', async ($, e) => {
    prompts.push(e.text)
    contexts.push(e.context ?? [])

    return { text: e.text } as never
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'core', text: 'core', scope: 'shared' as const }] }))
  on('tool.call', async () => ({ result: { stdout: '...último renglón de la respuesta', stderr: '', interrupted: false } }) as never)
  on('process.run', async ($, e) => {
    const cmd = e.argv.join(' ')
    const out = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (cmd.includes('terminal list')) {
      return out(JSON.stringify({ result: { terminals: [{ handle: 'term_me', tabId: 'tab2', leafId: 'leafB' }] } }))
    }
    if (cmd.includes('task-list')) {
      const tasks = opts.isDispatched ? [{ status: 'dispatched', assignee_handle: 'term_me', created_by_terminal_handle: 'term_c' }] : []

      return out(JSON.stringify({ result: { tasks } }))
    }
    if (cmd.includes('orchestration inbox')) return out(JSON.stringify({ result: { messages: inbox } }))
    if (cmd.includes('orchestration send')) {
      sends.push([...e.argv])

      return out(JSON.stringify({ ok: true }))
    }
    if (cmd === 'git rev-parse --show-toplevel') return out('/wt/repo\n')
    if (cmd === 'git submodule status') return out('')
    if (cmd.startsWith('git status')) return out('# branch.head fix/TCK-1-x\n1 .M N... a\n')
    if (cmd.startsWith('git rev-list')) return out('2\n')
    if (cmd.startsWith('git ls-remote')) return out('')

    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { inbox, prompts, sends, contexts, clock }
}

const start = ($: any) => $.session.start({ cwd: '/wt/repo', surface: 'terminal', isInteractive: true })
const compose = ($: any) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
const bash = ($: any, command: string, extra: object = {}) =>
  $.tool.call({ tool: 'Bash', tool_use_id: 't', command, ...extra } as never)

test('a dispatched child is anchored, guarded and woken', async ($: any, on: On) => {
  const { inbox, prompts, clock } = host(on, { isDispatched: true })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  const anchor = (await compose($)).sections.find((s: { id: string }) => s.id === 'ticket-workflow:anchor')
  expect(anchor?.text).toContain('term_me')
  expect(anchor?.text).toContain('`repo` en `fix/TCK-1-x`: 2 commit(s) sin publicar')

  expect((await bash($, 'orca-ide orchestration send --to term_c --type heartbeat')).deny).toContain('run_in_background')
  expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'a', prompt: 'x', description: 'x' } as never)).deny).toContain('subagentes')
  expect((await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [] } as never)).deny).toContain('conductor')

  // The ask's output is cut; the mod hands the whole answer from the inbox.
  inbox.unshift({ id: 'm1', from_handle: 'term_c', to_handle: 'term_me', type: 'status', read: 0, subject: 'Re: Gate 2', body: '1. GATE 2 APROBADO\n2. resto' })
  const asked = await bash($, 'orca-ide orchestration ask --to term_c --question "Gate 2"')
  expect(asked.context?.[0]).toContain('1. GATE 2 APROBADO')

  // What the ask already brought back does not wake it; a new message does, once.
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts).toEqual([])
  inbox.unshift({ id: 'm2', from_handle: 'term_c', to_handle: 'term_me', type: 'status', read: 0, subject: 'Re: QA' })
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Re: QA (m2)')
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts.length).toBe(1)
})

test('without a conductor the person is the one it talks to: no anchor, no guards', async ($: any, on: On) => {
  host(on, { isDispatched: false })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  expect((await compose($)).sections.map((s: { id: string }) => s.id)).toEqual(['core'])
  expect((await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [] } as never)).deny).toBeUndefined()
})

test('a session that never loaded the skill is left alone', async ($: any, on: On) => {
  host(on, { isDispatched: true })
  await start($)
  expect((await bash($, 'orca-ide orchestration send --type heartbeat')).deny).toBeUndefined()
})

test('with prompt.compose skipped, the anchor rides on each prompt until compose runs', async ($: any, on: On) => {
  const { contexts } = host(on, { isDispatched: true })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  // An organization's security plugin skipped compose: the anchor goes as context.
  await $.prompt.submit({ text: '[conductor] seguí', origin: { kind: 'composer' } } as never)
  expect(contexts.at(-1)?.length).toBe(1)

  // Once compose runs, the system prompt carries it and the context stops.
  await compose($)
  await $.prompt.submit({ text: '[conductor] seguí', origin: { kind: 'composer' } } as never)
  expect(contexts.at(-1)).toEqual([])
})

test('what the person types to a child goes to the conductor, not to the model', async ($: any, on: On) => {
  const { prompts, sends } = host(on, { isDispatched: true })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  // The person typed in the child's terminal by mistake: nothing enters, the conductor gets it.
  const typed = await $.prompt.submit({ text: 'anunciá las PRs en Discord', origin: { kind: 'composer' } } as never)
  expect(typed.drop).toContain('Le pasé tu mensaje al conductor (term_c)')
  expect(prompts).toEqual([])
  expect(sends.length).toBe(1)
  expect(sends[0]).toContain('escalation')
  expect(sends[0].join(' ')).toContain('--to term_c --from term_me')
  expect(sends[0].at(sends[0].indexOf('--body') + 1)).toContain('anunciá las PRs en Discord')

  // The conductor's own words, and the dispatch Orca injects, still reach it.
  await $.prompt.submit({ text: '[conductor] seguí con el QA', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'Task t1 · when done send worker_done to term_c', origin: { kind: 'composer' } } as never)
  expect(prompts).toEqual(['[conductor] seguí con el QA', 'Task t1 · when done send worker_done to term_c'])
  expect(sends.length).toBe(1)

  // A slash command is not a message: /hijo off still works from the keyboard.
  await $.prompt.submit({ text: '/hijo off', command: { name: 'hijo', args: 'off' }, origin: { kind: 'composer' } } as never)
  expect(sends.length).toBe(1)
})

test('without a conductor, what the person types reaches the session', async ($: any, on: On) => {
  const { prompts, sends } = host(on, { isDispatched: false })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  await $.prompt.submit({ text: 'seguí', origin: { kind: 'composer' } } as never)
  expect(prompts).toEqual(['seguí'])
  expect(sends).toEqual([])
})
