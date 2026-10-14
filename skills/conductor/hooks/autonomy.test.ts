import { describe, expect, test } from 'claude-code/testing'

import { anchorText, askGuard, bashGuard, parseInbox, pendingFromChildren, readyToAnnounce, wakeText } from './autonomy'
import { parseLedger, summarize } from './ledger'

const NOW = Date.parse('2026-10-13T12:00:00Z')

const rows =
  parseLedger(
    JSON.stringify({
      tickets: {
        'TCK-1': {
          name: 'TCK-1 · uno',
          state: 'open',
          updatedAt: '2026-10-13T11:00:00Z',
          child: { handle: 'term_a' },
          prs: [{ repo: 'o/front', number: 1, gate: 'GREEN' }],
        },
        'TCK-2': {
          name: 'TCK-2 · dos',
          state: 'open',
          updatedAt: '2026-10-13T11:00:00Z',
          child: { handle: 'term_b' },
          prs: [{ repo: 'o/api', number: 2, gate: 'PENDING' }],
        },
      },
    }),
  ) ?? []

describe('pendingFromChildren', () => {
  const messages = [
    { id: 'm1', from_handle: 'term_a', type: 'decision_gate', read: 0, subject: 'Gate 2' },
    { id: 'm2', from_handle: 'term_a', type: 'decision_gate', read: 1 },
    { id: 'm3', from_handle: 'term_b', type: 'status', read: 0 },
    { id: 'm4', from_handle: 'term_old', type: 'worker_done', read: 0 },
    { id: 'm5', from_handle: 'term_b', type: 'worker_done', read: false },
  ]

  test('keeps unread actionable messages from open children only', () => {
    expect(pendingFromChildren(messages, rows)).toEqual([
      { id: 'm1', ticket: 'TCK-1', type: 'decision_gate', subject: 'Gate 2' },
      { id: 'm5', ticket: 'TCK-2', type: 'worker_done', subject: '' },
    ])
  })
})

describe('parseInbox', () => {
  test('reads the orca --json envelope', () => {
    expect(parseInbox('{"result":{"messages":[{"id":"x"}]}}')).toEqual([{ id: 'x' }] as never)
  })

  test('is empty on garbage', () => {
    expect(parseInbox('error: not running')).toEqual([])
  })
})

describe('wake', () => {
  test('ready to announce means every PR GREEN and not announced', () => {
    expect(readyToAnnounce(rows)).toEqual(['TCK-1'])
  })

  test('no work, no wake', () => {
    expect(wakeText([], [])).toBe(null)
  })

  test('the wake names each ticket and what it waits on', () => {
    const text = wakeText([{ id: 'm1', ticket: 'TCK-2', type: 'escalation', subject: 'QA' }], ['TCK-1'])
    expect(text).toContain('TCK-2: escalation (QA) sin atender (m1)')
    expect(text).toContain('TCK-1: PRs en GREEN, sin anunciar')
  })
})

describe('anchorText', () => {
  test('carries the batch and the cycle', () => {
    const text = anchorText(summarize(rows, NOW), NOW)
    expect(text).toContain('TCK-1 · uno')
    expect(text).toContain('--types worker_done,escalation,decision_gate')
    expect(text).toContain('from_handle')
  })

  test('names the session handle when it is known', () => {
    const text = anchorText(summarize(rows, NOW), NOW, 'term_now')
    expect(text).toContain('tu handle en esta sesión es `term_now`')
    expect(text).toContain('check --terminal term_now --types')
  })
})

describe('bashGuard', () => {
  test('refuses check --wait without --types', () => {
    expect(bashGuard('orca-ide orchestration check --terminal t --wait', rows)).toContain('--types')
  })

  test('lets check --wait with --types run', () => {
    expect(bashGuard('orca-ide orchestration check --terminal t --wait --types worker_done', rows)).toBe(null)
  })

  test('judges each part of a compound command', () => {
    expect(bashGuard('cd /x && orca orchestration check --wait', rows)).not.toBe(null)
  })

  test('refuses a second worktree for an open ticket', () => {
    expect(bashGuard('orca-ide worktree create --name tck-1-uno --json', rows)).toContain('TCK-1 ya está abierto')
  })

  test('matches the id as a whole token', () => {
    expect(bashGuard('orca-ide worktree create --name tck-12-otro', rows)).toBe(null)
  })

  test('lets a worktree for a new ticket be created', () => {
    expect(bashGuard('orca-ide worktree create --name tck-9-nuevo', rows)).toBe(null)
  })

  test('ignores unrelated commands', () => {
    expect(bashGuard('git status', rows)).toBe(null)
  })
})

describe('askGuard', () => {
  test('refuses a routine question', () => {
    expect(askGuard(['Approach'])).toContain('Sos el conductor')
  })

  test('lets a question tagged delicate through', () => {
    expect(askGuard(['Delicado: prod', 'delicada'])).toBe(null)
  })

  test('one untagged question in the set is enough to refuse', () => {
    expect(askGuard(['Delicado', 'Scope'])).not.toBe(null)
  })
})
