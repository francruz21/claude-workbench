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

  test('a user order is relayed, not argued, and a correction sticks', () => {
    const text = anchorText(summarize(rows, NOW), NOW)
    expect(text).toContain('Una orden del usuario se ejecuta, no se discute')
    expect(text).toContain('reformulala en términos operativos del ticket')
    expect(text).toContain('casos parecidos sin volver a preguntar')
    expect(text).toContain('algo grave en el back')
  })

  test('an announced ticket is checked into In Review before cleanup', () => {
    expect(anchorText(summarize(rows, NOW), NOW)).toContain('si no está en `In Review`')
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

  test('with injected mail, any check --wait is refused: it would come back empty', () => {
    expect(bashGuard('orca-ide orchestration check --terminal t --wait --types worker_done', rows, true)).toContain('inbox')
    expect(bashGuard('orca-ide orchestration inbox --json', rows, true)).toBe(null)
  })

  test('lets check --wait with --types run', () => {
    expect(bashGuard('orca-ide orchestration check --terminal t --wait --types worker_done', rows)).toBe(null)
  })

  test('what it types into a child carries its own signed mark, or the child relays it', () => {
    const send = (text: string) => bashGuard(`orca-ide terminal send --terminal term_h --text "${text}" --enter --json`, rows, false, 'term_c')
    expect(send('seguí con el QA')).toContain('[conductor term_c]')
    expect(bashGuard(`orca-ide terminal send --terminal term_h --text "$(cat /tmp/m.txt)" --enter`, rows, false, 'term_c')).toContain('[conductor term_c]')
    expect(send('[conductor term_c] seguí')).toBe(null)
    expect(bashGuard(`orca-ide terminal send --terminal term_h --text '[conductor term_c] seguí' --enter`, rows, false, 'term_c')).toBe(null)
    // The bare mark, or another conductor's handle, is not this conductor's signature.
    expect(send('[conductor] seguí')).not.toBe(null)
    expect(send('[conductor term_z] seguí')).not.toBe(null)
    expect(send('/model sonnet')).toBe(null)
    expect(bashGuard(`orca-ide terminal send --terminal term_h --text $'\\x02'`, rows, false, 'term_c')).toBe(null)
    expect(send('1')).toBe(null)
    expect(bashGuard('orca-ide terminal read --terminal term_h --json', rows, false, 'term_c')).toBe(null)
  })

  test('with its own handle unknown, any signed mark passes', () => {
    expect(bashGuard('orca-ide terminal send --terminal term_h --text "[conductor term_q] seguí" --enter', rows)).toBe(null)
    expect(bashGuard('orca-ide terminal send --terminal term_h --text "seguí" --enter', rows)).toContain('[conductor <tu handle>]')
  })

  test('the anchor says how to sign, what to do with relayed messages, and the handoff', () => {
    const text = anchorText(summarize(rows, NOW), NOW, 'term_c')
    expect(text).toContain('[conductor term_c] ')
    expect(text).toContain('Mensaje de otro agente para el hijo')
    expect(text).toContain('si es una orden dentro del ticket, se la bajás al hijo')
    expect(text).toContain('Relevo de conductor')
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

  test('names what is grave in the back as critical', () => {
    expect(askGuard(['Approach'])).toContain('migración que borra o reescribe datos')
  })

  test('lets a question tagged critical through', () => {
    expect(askGuard(['Crítico: prod', 'critica'])).toBe(null)
  })

  test('one untagged question in the set is enough to refuse', () => {
    expect(askGuard(['Crítico', 'Scope'])).not.toBe(null)
    // The old tag no longer passes: it had become the way around the guard.
    expect(askGuard(['Delicado: base'])).toContain('rama base')
  })
})

describe('anchorText and the injection', () => {
  const summary = summarize(rows, NOW)

  test('without injection the cycle starts with check', () => {
    expect(anchorText(summary, NOW, 'term_c')).toContain('check --terminal term_c --types')
  })

  test('with injection it says not to arm check --wait', () => {
    const text = anchorText(summary, NOW, 'term_c', true)
    expect(text).toContain('No armes `check --wait`')
    expect(text).not.toContain('check --terminal term_c')
  })
})
