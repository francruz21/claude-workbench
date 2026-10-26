import { describe, expect, test } from 'claude-code/testing'

import type { Row } from '../types'
import { healthOf, healthWake, nudgeText, parseTail, parseTerminals } from './health'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const row: Row = {
  id: 'TCK-1', name: 'TCK-1 · uno', qaTurn: null, prs: [], isAnnounced: false, isCleaned: false,
  handle: 'term_a', updatedAt: null, lastNote: null,
}
const term = (title: string, quietMin: number, extra: object = {}) => ({
  handle: 'term_a', title, connected: true, orphaned: false, lastOutputAt: NOW - quietMin * 60_000, ...extra,
})

describe('healthOf', () => {
  test('a missing, orphaned or disconnected terminal is dead', () => {
    expect(healthOf(row, undefined, '', NOW).kind).toBe('dead')
    expect(healthOf(row, term('✳ x', 1, { orphaned: true }), '', NOW).kind).toBe('dead')
    expect(healthOf(row, term('✳ x', 1, { connected: false }), '', NOW).kind).toBe('dead')
  })

  test('the spinner means working', () => {
    expect(healthOf(row, term('◐ TCK-1', 30), '', NOW).kind).toBe('working')
  })

  test('a busy terminal stuck on an ask is owed an answer', () => {
    const verdict = healthOf(row, term('◐ TCK-1', 8), 'Bash(orca-ide orchestration ask --to term_c --question "¿A o B?")\n  ⎿  Running…', NOW)
    expect(verdict).toEqual({ kind: 'asking', sinceMin: 8 })
  })

  test('idle with a stack or monitor running is waiting, not stalled', () => {
    expect(healthOf(row, term('✳ TCK-1', 20), '✻ done · 1 shell, 1 monitor still running', NOW).kind).toBe('waiting')
  })

  test('idle while its QA turn is queued is waiting', () => {
    expect(healthOf({ ...row, qaTurn: 'queued' }, term('✳ TCK-1', 20), '', NOW).kind).toBe('waiting')
  })

  test('idle after delivering (a PR registered) is waiting, not stalled', () => {
    const delivered = { ...row, prs: [{ repo: 'o/r', number: 7, gate: null }] }
    expect(healthOf(delivered, term('✳ TCK-1', 40), '', NOW).kind).toBe('waiting')
  })

  test('idle with nothing running past the threshold is stalled', () => {
    expect(healthOf(row, term('✳ TCK-1', 10), '● Listo, espero instrucciones.', NOW)).toEqual({ kind: 'stalled', sinceMin: 10 })
    expect(healthOf(row, term('✳ TCK-1', 1), '', NOW).kind).toBe('working')
  })

  test('a permission prompt holds it', () => {
    expect(healthOf(row, term('✳ TCK-1', 4), 'Do you want to proceed?\n❯ 1. Yes\n  2. No', NOW).kind).toBe('permission')
  })
})

describe('healthWake', () => {
  test('dead, blocked and owed an answer wake the conductor; a stall only after two nudges', () => {
    expect(healthWake(row, { kind: 'dead', why: 'x' }, 0)).toContain('MUERTO')
    expect(healthWake(row, { kind: 'permission', prompt: 'Do you want to proceed' }, 0)).toContain('TRABADO')
    expect(healthWake(row, { kind: 'asking', sinceMin: 7 }, 0)).toContain('Contestale')
    expect(healthWake(row, { kind: 'stalled', sinceMin: 4 }, 1)).toBeNull()
    expect(healthWake(row, { kind: 'stalled', sinceMin: 12 }, 2)).toContain('sigue PARADO')
    expect(healthWake(row, { kind: 'working' }, 0)).toBeNull()
  })
})

describe('the nudge and the parsers', () => {
  test('the nudge is an order to keep going, with the only valid waits', () => {
    const text = nudgeText(row)
    expect(text).toContain('seguí con el ticket hasta entregarlo')
    expect(text).toContain('turno de QA')
  })

  test('parses Orca terminal list and read', () => {
    expect(parseTerminals(JSON.stringify({ result: { terminals: [{ handle: 'h', title: 't', connected: true, lastOutputAt: 5 }] } }))?.[0]?.lastOutputAt).toBe(5)
    expect(parseTerminals('nope')).toBeNull()
    expect(parseTail(JSON.stringify({ result: { terminal: { tail: ['a', 'b'] } } }))).toBe('a\nb')
  })
})
