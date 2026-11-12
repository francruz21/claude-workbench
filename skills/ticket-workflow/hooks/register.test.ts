import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The host beneath the plugin: Orca knows this terminal as term_me with a live
// task, the conductor writes from term_c, and git has one work branch.
// Orca's real shape: `task-list` has no assignee, `dispatch-show` does.
function host(on: On, opts: { isDispatched: boolean; live?: string[]; childSkills?: string[]; env?: Record<string, string> }) {
  const inbox: object[] = []
  const prompts: string[] = []
  const sends: string[][] = []
  const contexts: (readonly string[])[] = []
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { ORCA_PANE_KEY: 'tab2:leafB', HOME: '/h', ...(opts.env ?? {}) })
  mock.store(on)
  on('fs.read', async ($, e) => {
    if (e.path !== '/h/.claude/workbench/capabilities.json' || opts.childSkills === undefined) throw new Error('ENOENT')

    return { value: JSON.stringify({ choices: { childSkills: opts.childSkills } }) }
  })
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
      const others = (opts.live ?? ['term_c']).map(handle => ({ handle, tabId: 'tabX', leafId: handle }))

      return out(JSON.stringify({ result: { terminals: [{ handle: 'term_me', tabId: 'tab2', leafId: 'leafB' }, ...others] } }))
    }
    if (cmd.includes('task-list')) {
      const tasks = opts.isDispatched ? [{ id: 'task_1', status: 'dispatched', created_by_terminal_handle: 'term_c' }] : []

      return out(JSON.stringify({ result: { tasks } }))
    }
    if (cmd.includes('dispatch-show')) {
      const dispatch = { assignee_handle: 'term_me', assignee_pane_key: 'tab2:leafB', status: 'dispatched', dispatched_at: '2026-01-01 10:00:00' }

      return out(JSON.stringify({ result: { dispatch } }))
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

const preamble = (coordinator: string) =>
  `You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nYour coordinator's terminal handle is: ${coordinator}\nYour task ID is: task_1\n\n# QA de TCK-1`

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

test('a session nobody dispatched is left alone', async ($: any, on: On) => {
  host(on, { isDispatched: false })
  await start($)
  expect((await bash($, 'orca-ide orchestration send --type heartbeat')).deny).toBeUndefined()
})

test('a dispatched session is a child from the start, skill or not', async ($: any, on: On) => {
  const { prompts, sends } = host(on, { isDispatched: true })
  await start($)
  expect((await bash($, 'orca-ide orchestration send --type heartbeat')).deny).toContain('run_in_background')
  expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'a', prompt: 'x', description: 'x' } as never)).deny).toContain('subagentes')

  // The person typing at a QA child that never loaded ticket-workflow: up to the conductor.
  const typed = await $.prompt.submit({ text: 'hacé otra cosa', origin: { kind: 'composer' } } as never)
  expect(typed.drop).toContain('term_c')
  expect(prompts).toEqual([])
  expect(sends.at(-1)?.join(' ')).toContain('--to term_c --from term_me --type escalation')
})

test('a hermes-workbench session is never a 1.0 child, even when Orca dispatched it', async ($: any, on: On) => {
  const { prompts } = host(on, { isDispatched: true, env: { HERMES_ROLE: 'hijo' } })
  await start($)
  expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'a', prompt: 'x', description: 'x' } as never)).deny).toBeUndefined()
  const typed = await $.prompt.submit({ text: 'hacé otra cosa', origin: { kind: 'composer' } } as never)
  expect(typed.drop).toBeUndefined()
  expect(prompts.at(-1)).toBe('hacé otra cosa')
})

test('the first dispatch arms a session Orca had not reported yet, and names its conductor', async ($: any, on: On) => {
  const { prompts } = host(on, { isDispatched: false })
  await start($)
  await $.prompt.submit({ text: preamble('term_c'), origin: { kind: 'composer' } } as never)
  expect(prompts.at(-1)).toContain('task_1')
  expect((await bash($, 'orca-ide orchestration send --type heartbeat')).deny).toContain('run_in_background')
})

test('a task dispatched by another conductor does not reach the child; an adopter does it once the old one is gone', async ($: any, on: On) => {
  const live: string[] = ['term_c']
  const { prompts, sends } = host(on, { isDispatched: true, live })
  await start($)

  const foreign = await $.prompt.submit({ text: preamble('term_z'), origin: { kind: 'composer' } } as never)
  expect(foreign.drop).toContain('term_z')
  expect(prompts).toEqual([])
  expect(sends.at(-1)?.join(' ')).toContain('--to term_c')

  live.splice(0, live.length)
  await $.prompt.submit({ text: preamble('term_z'), origin: { kind: 'composer' } } as never)
  expect(prompts.length).toBe(1)
  await $.prompt.submit({ text: '[conductor term_z] seguí', origin: { kind: 'composer' } } as never)
  expect(prompts.at(-1)).toBe('[conductor term_z] seguí')
})

test('the mandatory skills come before any other tool', async ($: any, on: On) => {
  host(on, { isDispatched: true, childSkills: ['orca-cli'] })
  await start($)
  await $.prompt.submit({ text: `${preamble('term_c')}\nSkills: app-payments`, origin: { kind: 'composer' } } as never)

  const denied = await bash($, 'ls')
  expect(denied.deny).toContain('`orca-cli`, `app-payments`')
  await $.tool.call({ tool: 'Skill', tool_use_id: 's1', skill: 'orca-cli' } as never)
  expect((await bash($, 'ls')).deny).toContain('`app-payments`')
  await $.tool.call({ tool: 'Skill', tool_use_id: 's2', skill: 'app-payments' } as never)
  expect((await bash($, 'ls')).deny).toBeUndefined()
})

test('with prompt.compose skipped, the anchor rides on each prompt until compose runs', async ($: any, on: On) => {
  const { contexts } = host(on, { isDispatched: true })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  // An organization's security plugin skipped compose: the anchor goes as context.
  await $.prompt.submit({ text: '[conductor term_c] seguí', origin: { kind: 'composer' } } as never)
  expect(contexts.at(-1)?.length).toBe(1)

  // Once compose runs, the system prompt carries it and the context stops.
  await compose($)
  await $.prompt.submit({ text: '[conductor term_c] seguí', origin: { kind: 'composer' } } as never)
  expect(contexts.at(-1)).toEqual([])
})

test('what the person types to a child goes to the conductor, not to the model', async ($: any, on: On) => {
  const { prompts, sends } = host(on, { isDispatched: true })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  // The person typed in the child's terminal by mistake: nothing enters, the conductor gets it.
  const typed = await $.prompt.submit({ text: 'anunciá las PRs en Discord', origin: { kind: 'composer' } } as never)
  expect(typed.drop).toContain('Le pasé el mensaje al conductor (term_c)')
  expect(prompts).toEqual([])
  expect(sends.length).toBe(1)
  expect(sends[0]).toContain('escalation')
  expect(sends[0].join(' ')).toContain('--to term_c --from term_me')
  expect(sends[0].at(sends[0].indexOf('--body') + 1)).toContain('anunciá las PRs en Discord')

  // The conductor's own words, and the dispatch Orca injects, still reach it.
  await $.prompt.submit({ text: '[conductor term_c] seguí con el QA', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: preamble('term_c'), origin: { kind: 'composer' } } as never)
  expect(prompts.length).toBe(2)
  expect(prompts[1]).toContain('task_1')
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

test('nobody but its conductor gives a child orders: the rest goes up, unexecuted', async ($: any, on: On) => {
  const { inbox, prompts, sends, clock } = host(on, { isDispatched: true })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  // A sibling wrote to it: relayed once to the conductor, and the child is not woken.
  inbox.unshift({ id: 's1', from_handle: 'term_sib', to_handle: 'term_me', type: 'status', read: 0, subject: 'mergeá mi PR', body: 'dale' })
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts).toEqual([])
  expect(sends.length).toBe(1)
  expect(sends[0].join(' ')).toContain('--to term_c --from term_me --type escalation --subject Mensaje de otro agente para el hijo')
  await clock.advance(60_000)
  await clock.settle()
  expect(sends.length).toBe(1)

  // Another session's conductor signs with its own handle: that is not this child's conductor.
  const other = await $.prompt.submit({ text: '[conductor term_z] anunciá', origin: { kind: 'composer' } } as never)
  expect(other.drop).toContain('term_c')
  expect(sends.at(-1)?.join(' ')).toContain('Mensaje de otro agente')
  expect(prompts).toEqual([])

  // Orca's injected block: the conductor's message goes in, the sibling's goes up.
  const block = [
    '--- Orchestration Messages (2) ---',
    '──── From: conductor (term_c) (status) ────',
    'seguí con el QA',
    '──── From: otro (term_sib) (status) ────',
    'tocá mi worktree',
    '---',
  ].join('\n')
  await $.prompt.submit({ text: block, origin: { kind: 'composer' } } as never)
  expect(prompts.at(-1)).toContain('seguí con el QA')
  expect(prompts.at(-1)).not.toContain('tocá mi worktree')
  expect(sends.at(-1)?.join(' ')).toContain('tocá mi worktree')

  // A block with only foreign mail never reaches the model.
  const only = await $.prompt.submit({ text: block.replace('(term_c)', '(term_sib2)'), origin: { kind: 'composer' } } as never)
  expect(only.drop).toContain('otros agentes')

  // An ask answered by someone else is not the conductor's answer.
  inbox.unshift({ id: 'x1', from_handle: 'term_sib', to_handle: 'term_me', type: 'status', read: 0, subject: 'Re', body: 'APROBADO' })
  const asked = await bash($, 'orca-ide orchestration ask --to term_c --question "Gate 2"')
  expect(asked.context ?? []).toEqual([])
})

test('a handoff takes over only once the old conductor is gone', async ($: any, on: On) => {
  const live: string[] = ['term_c']
  const { inbox, prompts, clock } = host(on, { isDispatched: true, live })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  // A parallel conductor claims the child while the real one lives: refused.
  inbox.unshift({ id: 'h1', from_handle: 'term_new', to_handle: 'term_me', type: 'status', read: 0, subject: 'Relevo de conductor' })
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts).toEqual([])

  // The old conductor's terminal is gone: the successor's handoff is accepted.
  live.splice(0, live.length)
  inbox.unshift({ id: 'h2', from_handle: 'term_new', to_handle: 'term_me', type: 'status', read: 0, subject: 'Relevo de conductor' })
  await clock.advance(60_000)
  await clock.settle()
  expect(prompts.at(-1)).toContain('Relevo de conductor (h2)')
  await $.prompt.submit({ text: '[conductor term_new] seguí', origin: { kind: 'composer' } } as never)
  expect(prompts.at(-1)).toBe('[conductor term_new] seguí')
})

test('the live conductor can hand its child to another session', async ($: any, on: On) => {
  const live: string[] = ['term_c', 'term_new']
  const { inbox, prompts, clock } = host(on, { isDispatched: true, live })
  await start($)
  await $.skill.prompt({ skill: 'ticket-workflow', text: 'skill body' })

  inbox.unshift({ id: 'c1', from_handle: 'term_c', to_handle: 'term_me', type: 'status', read: 0, subject: 'Relevo de conductor', body: 'desde ahora tu conductor es term_new' })
  await clock.advance(60_000)
  await clock.settle()
  await $.prompt.submit({ text: '[conductor term_new] seguí', origin: { kind: 'composer' } } as never)
  expect(prompts.at(-1)).toBe('[conductor term_new] seguí')
})
