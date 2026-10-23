import { describe, expect, test } from 'claude-code/testing'

import {
  anchorText,
  bashGuard,
  isAsk,
  isDispatched,
  isWorkBranch,
  latestForMe,
  ownHandle,
  parseGitStatus,
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

  test('the newest message to me is the answer an ask just got', () => {
    expect(latestForMe(MESSAGES, 'term_me')?.id).toBe('m3')
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
})
