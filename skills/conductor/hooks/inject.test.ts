import { describe, expect, test } from 'claude-code/testing'

import { parseInjected, withoutHeartbeats } from './inject'

const msg = (handle: string, type: string, subject: string) =>
  [
    `──── From: ${handle.toUpperCase()} (${handle}) (${type}) ────`,
    `Subject: ${subject}`,
    'cuerpo',
    `[Reply: orca orchestration reply --id m_${subject} --body "..."]`,
    '────────────────────────────────────────────────────────────',
  ].join('\n')

const block = (...messages: string[]) => `--- Orchestration Messages (${messages.length}) ---\n${messages.join('\n\n')}\n---`

describe('parseInjected', () => {
  test('reads each message with its handle and type', () => {
    const parsed = parseInjected(block(msg('term_a', 'heartbeat', 'alive'), msg('term_b', 'decision_gate', 'Gate 2')))
    expect(parsed?.map(m => [m.handle, m.type])).toEqual([
      ['term_a', 'heartbeat'],
      ['term_b', 'decision_gate'],
    ])
  })

  test('a person prompt is never an Orca block', () => {
    expect(parseInjected('heartbeat de term_a, ¿qué hago?')).toBeNull()
    expect(parseInjected('--- Orchestration Messages (1) ---\nhola\n---')).toBeNull()
  })
})

describe('withoutHeartbeats', () => {
  test('anything else goes through untouched', () => {
    expect(withoutHeartbeats('hola')).toBeNull()
    const gate = block(msg('term_b', 'decision_gate', 'Gate 2'))
    expect(withoutHeartbeats(gate)).toEqual({ text: gate, heartbeats: [] })
  })

  test('only heartbeats: nothing to let through', () => {
    expect(withoutHeartbeats(block(msg('term_a', 'heartbeat', 'alive'), msg('term_b', 'heartbeat', 'alive')))).toEqual({
      text: null,
      heartbeats: ['term_a', 'term_b'],
    })
  })

  test('mixed: the heartbeats leave and the count follows', () => {
    const filtered = withoutHeartbeats(block(msg('term_a', 'heartbeat', 'alive'), msg('term_b', 'decision_gate', 'Gate 2')))
    expect(filtered?.heartbeats).toEqual(['term_a'])
    expect(filtered?.text).toContain('--- Orchestration Messages (1) ---')
    expect(filtered?.text).toContain('Subject: Gate 2')
    expect(filtered?.text).not.toContain('alive')
  })
})
