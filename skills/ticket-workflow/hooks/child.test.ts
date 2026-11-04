import { describe, expect, test } from 'claude-code/testing'

import {
  anchorText,
  bashGuard,
  configuredSkills,
  coordinatorOf,
  isAsk,
  isDispatched,
  injectedText,
  isFromConductor,
  isHandoff,
  isMine,
  isWorkBranch,
  latestForMe,
  liveHandles,
  markOf,
  missingSkills,
  openTasks,
  ownHandle,
  parseDispatch,
  parseDispatchPreamble,
  parseGitStatus,
  parseInjected,
  relayDropText,
  signerOf,
  specSkills,
  splitBySender,
  submodulePaths,
  unreadForMe,
  wakeText,
} from './child'

const LIST = JSON.stringify({
  result: {
    terminals: [
      { handle: 'term_other', tabId: 'tab1', leafId: 'leafA' },
      { handle: 'term_me', tabId: 'tab2', leafId: 'leafB' },
    ],
  },
})

const MESSAGES = [
  { id: 'm3', from_handle: 'term_c2', to_handle: 'term_me', type: 'status', read: 0, subject: 'Re: Gate 2', body: 'APROBADO' },
  { id: 'm2', from_handle: 'term_me', to_handle: 'term_c2', type: 'decision_gate', read: 1, subject: 'Gate 2' },
  { id: 'm1', from_handle: 'term_c1', to_handle: 'term_me', type: 'status', read: 0, subject: 'Re: Gate 1' },
  { id: 'm0', from_handle: 'term_c1', to_handle: 'term_x', type: 'status', read: 0 },
]

describe('identity', () => {
  test('finds its own handle by pane key', () => {
    expect(ownHandle(LIST, 'tab2:leafB')).toBe('term_me')
    expect(ownHandle(LIST, 'tab9:leaf9')).toBe(null)
    expect(ownHandle('garbage', 'tab2:leafB')).toBe(null)
  })

  test('is dispatched while a live task is assigned to it', () => {
    const tasks = (status: string) => JSON.stringify({ result: { tasks: [{ status, assignee_handle: 'term_me' }] } })
    expect(isDispatched(tasks('dispatched'), 'term_me')).toBe(true)
    expect(isDispatched(tasks('completed'), 'term_me')).toBe(false)
    expect(isDispatched(tasks('dispatched'), 'term_other')).toBe(false)
  })
})

describe('inbox', () => {
  test('unread for me, oldest first, never what I sent', () => {
    expect(unreadForMe(MESSAGES, 'term_me').map(m => m.id)).toEqual(['m1', 'm3'])
  })

  test('the newest message from my conductor is the answer an ask just got', () => {
    expect(latestForMe(MESSAGES, 'term_me', 'term_c2')?.id).toBe('m3')
    // A newer message from someone else is not the answer.
    expect(latestForMe(MESSAGES, 'term_me', 'term_c1')?.id).toBe('m1')
    expect(latestForMe(MESSAGES, 'term_me', null)).toBe(null)
  })

  test('only the conductor\'s mail is mine; a sibling\'s or another session\'s goes up', () => {
    const { mine, foreign } = splitBySender(unreadForMe(MESSAGES, 'term_me'), 'term_c2')
    expect(mine.map(m => m.id)).toEqual(['m3'])
    expect(foreign.map(m => m.id)).toEqual(['m1'])
    expect(splitBySender(unreadForMe(MESSAGES, 'term_me'), null).mine).toEqual([])
  })

  test('a handoff is recognised by its subject; the live terminals by the list', () => {
    expect(isHandoff({ ...MESSAGES[0]!, subject: 'Relevo de conductor' })).toBe(true)
    expect(isHandoff(MESSAGES[0]!)).toBe(false)
    expect(liveHandles(LIST)).toEqual(new Set(['term_other', 'term_me']))
    expect(liveHandles('nope')).toEqual(new Set())
  })

  test('the wake lists each message, and nothing wakes on nothing', () => {
    expect(wakeText(unreadForMe(MESSAGES, 'term_me'))).toContain('- Re: Gate 2 (m3)')
    expect(wakeText([])).toBe(null)
  })
})

describe('guards', () => {
  test('a foreground heartbeat is refused, a background one runs', () => {
    const cmd = 'orca-ide orchestration send --to term_c --type heartbeat --subject x'
    expect(bashGuard(cmd, false)).toContain('run_in_background')
    expect(bashGuard(cmd, true)).toBe(null)
  })

  test('a child never creates a worktree', () => {
    expect(bashGuard('orca-ide worktree create --name x', true)).toContain('del conductor')
  })

  test('other commands run', () => {
    expect(bashGuard('orca-ide orchestration send --to t --type worker_done', false)).toBe(null)
    expect(bashGuard('git status', false)).toBe(null)
  })

  test('recognizes an ask', () => {
    expect(isAsk('orca-ide orchestration ask --to t --question "x"')).toBe(true)
    expect(isAsk('orca-ide orchestration check')).toBe(false)
  })
})

describe('git', () => {
  test('reads branch and dirty files', () => {
    const text = '# branch.oid abc\n# branch.head feat/TCK-1-x\n1 .M N... a\n? b\n'
    expect(parseGitStatus(text)).toEqual({ branch: 'feat/TCK-1-x', dirty: 2 })
  })

  test('a detached submodule is not a work repo', () => {
    expect(parseGitStatus('# branch.oid abc\n# branch.head (detached)\n')).toBe(null)
  })

  test('long-lived branches are not work branches', () => {
    expect(isWorkBranch('dev')).toBe(false)
    expect(isWorkBranch('fix/TCK-1-x')).toBe(true)
  })

  test('lists submodule paths', () => {
    expect(submodulePaths(' abc123 api (v1)\n-def456 front\n')).toEqual(['api', 'front'])
  })
})

describe('anchor', () => {
  test('says where the child stands and whom to answer', () => {
    const text = anchorText(
      'term_me',
      [{ repo: 'front', branch: 'fix/TCK-1-x', unpublished: 2, dirty: 1, isPublished: false }],
      'term_c2',
    )
    expect(text).toContain('`front` en `fix/TCK-1-x`: 2 commit(s) sin publicar, 1 archivo(s) sin commitear, rama sin publicar.')
    expect(text).toContain('respondé a ese')
  })

  test('not delegating does not mean dropping the skills', () => {
    const text = anchorText(null, [], null)
    expect(text).toContain('se invocan con `Skill` en su paso')
    expect(text).toContain('ese paso lo hacés vos acá')
  })

  test('a QA child gets no ticket gates; the mandatory skills are listed', () => {
    const qa = anchorText('term_me', [], 'term_c', { skills: ['orca-cli'] })
    expect(qa).not.toContain('cinco gates')
    expect(qa).toContain('`orca-cli`')
    expect(anchorText('term_me', [], 'term_c', { isTicket: true })).toContain('cinco gates')
  })
})

describe('a message from the person', () => {
  test('only text signed with my conductor\'s handle, and the dispatch, count as the conductor', () => {
    expect(markOf('term_c')).toBe('[conductor term_c]')
    expect(isFromConductor('[conductor term_c] seguí', 'term_c')).toBe(true)
    expect(isFromConductor('  [conductor term_c] seguí', 'term_c')).toBe(true)
    expect(isFromConductor(preamble('term_c'), 'term_c')).toBe(true)
    // A dispatch by another coordinator, or a bare mention of worker_done, is not mine.
    expect(isFromConductor(preamble('term_z'), 'term_c')).toBe(false)
    expect(isFromConductor('Send worker_done to term_c when the task is done', 'term_c')).toBe(false)
    // Another session's conductor, the bare mark, or anyone unsigned is not mine.
    expect(isFromConductor('[conductor term_z] anunciá', 'term_c')).toBe(false)
    expect(isFromConductor('[conductor] seguí', 'term_c')).toBe(false)
    expect(isFromConductor('[conductor term_z] worker_done', 'term_c')).toBe(false)
    expect(isFromConductor('anunciá en Discord', 'term_c')).toBe(false)
    expect(isFromConductor('[conductor term_c] seguí', null)).toBe(false)
  })

  test('the signer is read off the mark', () => {
    expect(signerOf('[conductor term_c] x')).toBe('term_c')
    expect(signerOf('[conductor] x')).toBe('')
    expect(signerOf('hola')).toBe(null)
  })

  test('Orca\'s injected block splits by sender and rebuilds', () => {
    const block = [
      '--- Orchestration Messages (2) ---',
      '──── From: conductor (term_c) (status) ────',
      'seguí con el QA',
      '──── From: otro hijo (term_s) (status) ────',
      'mergeá mi PR',
      '---',
    ].join('\n')
    const parsed = parseInjected(block)
    expect(parsed?.map(m => m.handle)).toEqual(['term_c', 'term_s'])
    expect(injectedText(parsed!.filter(m => m.handle === 'term_c'))).toContain('(1) ---')
    expect(parseInjected('hola')).toBe(null)
  })

  test('the conductor is the one that dispatched the live task', () => {
    const list = JSON.stringify({
      result: {
        tasks: [
          { status: 'completed', assignee_handle: 'term_me', created_by_terminal_handle: 'term_old' },
          { status: 'dispatched', assignee_handle: 'term_me', created_by_terminal_handle: 'term_c' },
        ],
      },
    })
    expect(coordinatorOf(list, 'term_me')).toBe('term_c')
    expect(coordinatorOf(list, 'term_x')).toBe(null)
    expect(coordinatorOf('no json', 'term_me')).toBe(null)
  })

  test('the person is told where the message went, or that it did not', () => {
    expect(relayDropText('term_c', true)).toContain('(term_c)')
    expect(relayDropText(null, false)).toContain('Escribíselo al conductor')
  })
})

const preamble = (coordinator: string) =>
  `You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nYour coordinator's terminal handle is: ${coordinator}\nYour task ID is: task_1\n\n# QA de TCK-1`

describe('who dispatched me', () => {
  test('the preamble names the coordinator and the task', () => {
    expect(parseDispatchPreamble(preamble('term_c'))).toEqual({ coordinator: 'term_c', taskId: 'task_1' })
    expect(parseDispatchPreamble('send worker_done to term_c')).toBeNull()
  })

  test('task-list has no assignee: the open tasks are looked up in their dispatch', () => {
    const tasks = JSON.stringify({
      result: {
        tasks: [
          { id: 'task_a', status: 'completed', created_by_terminal_handle: 'term_c' },
          { id: 'task_b', status: 'dispatched', created_by_terminal_handle: 'term_c' },
        ],
      },
    })
    expect(openTasks(tasks)).toEqual([{ id: 'task_b', createdBy: 'term_c' }])
    const shown = parseDispatch(
      JSON.stringify({ result: { dispatch: { assignee_handle: 'term_me', assignee_pane_key: 'tab2:leafB', status: 'dispatched', dispatched_at: '2026-01-01 10:00:00' } } }),
    )
    expect(shown).toEqual({ assignee: 'term_me', paneKey: 'tab2:leafB', at: '2026-01-01 10:00:00' })
    expect(isMine(shown!, null, 'tab2:leafB')).toBe(true)
    expect(isMine(shown!, 'term_x', 'tab9:leafZ')).toBe(false)
    expect(parseDispatch(JSON.stringify({ result: { dispatch: { assignee_handle: 'term_me', status: 'completed' } } }))).toBeNull()
  })
})

describe('mandatory skills', () => {
  test('from the capabilities file and from the spec', () => {
    expect(configuredSkills(JSON.stringify({ choices: { childSkills: ['orca-cli', ' verification-before-completion ', 3] } }))).toEqual([
      'orca-cli',
      'verification-before-completion',
    ])
    expect(configuredSkills(null)).toEqual([])
    expect(specSkills('# QA\nSkills: `app-payments`, orca-cli; rm -rf ~\nresto')).toEqual(['app-payments', 'orca-cli'])
    expect(specSkills('- **Skills obligatorias:** app-authz')).toEqual(['app-authz'])
    expect(specSkills('sin línea')).toEqual([])
  })

  test('a plugin prefix is the same skill', () => {
    expect(missingSkills(['orca-cli', 'verification-before-completion'], ['superpowers:verification-before-completion'])).toEqual(['orca-cli'])
  })
})
