import { describe, expect, test } from 'claude-code/testing'

import { brief, changes, ledgerPath, parseLedger, staleReport, statusLine, summarize } from './ledger'

const NOW = Date.parse('2026-10-13T12:00:00Z')

const ledgerText = JSON.stringify({
  version: 1,
  workspace: '/w',
  tickets: {
    'TCK-1': {
      name: 'TCK-1 · activo',
      state: 'open',
      qaTurn: 'held',
      updatedAt: '2026-10-13T11:50:00Z',
      prs: [{ repo: 'org/front', number: 10, gate: 'GREEN' }],
      announced: null,
      notes: [{ at: '2026-10-13T11:50:00Z', text: 'en QA' }],
    },
    'TCK-2': {
      name: 'TCK-2 · viejo',
      state: 'open',
      updatedAt: '2026-09-20T10:00:00Z',
      prs: [],
      announced: null,
      notes: [{ at: '2026-09-20T10:00:00Z', text: 'queda abierto por el anuncio' }],
    },
    'TCK-3': { name: 'TCK-3 · cerrado', state: 'closed', announcedAt: '2026-09-01T00:00:00Z' },
  },
})

describe('ledgerPath', () => {
  test('uses the same key the script derives', () => {
    expect(ledgerPath('/s', '/srv/repo')).toBe('/s/conductor-srv-repo.json')
  })
})

describe('parseLedger', () => {
  test('keeps open tickets only', () => {
    const rows = parseLedger(ledgerText)
    expect(rows?.map(row => row.id)).toEqual(['TCK-1', 'TCK-2'])
    expect(rows?.[0]?.prs).toEqual([{ repo: 'front', number: 10, gate: 'GREEN' }])
  })

  test('is null for text that is not a ledger', () => {
    expect(parseLedger('not json')).toBe(null)
    expect(parseLedger('{"x":1}')).toBe(null)
  })

  test('reads both announced shapes', () => {
    const rows = parseLedger(
      JSON.stringify({
        tickets: {
          A: { state: 'open', announcedAt: '2026-10-01T00:00:00Z' },
          B: { state: 'open', announced: { at: '2026-10-01T00:00:00Z' } },
          C: { state: 'open', announced: null },
        },
      }),
    )
    expect(rows?.map(row => row.isAnnounced)).toEqual([true, true, false])
  })
})

describe('summarize', () => {
  test('splits active from stale by last update', () => {
    const summary = summarize(parseLedger(ledgerText) ?? [], NOW)
    expect(summary.active.map(row => row.id)).toEqual(['TCK-1'])
    expect(summary.stale.map(row => row.id)).toEqual(['TCK-2'])
  })

  test('a cleaned worktree is stale however recent', () => {
    const rows = (parseLedger(ledgerText) ?? []).map(row => ({ ...row, qaTurn: null, isCleaned: row.id === 'TCK-1' }))
    expect(summarize(rows, NOW).stale.map(row => row.id)).toEqual(['TCK-1', 'TCK-2'])
  })

  test('a ticket paused over a weekend stays active', () => {
    const rows = (parseLedger(ledgerText) ?? []).map(row => ({ ...row, qaTurn: null, updatedAt: '2026-10-09T22:00:00Z' }))
    expect(summarize(rows, NOW).active.map(row => row.id)).toEqual(['TCK-1', 'TCK-2'])
  })

  test('a ticket holding the QA turn is never stale', () => {
    const rows = (parseLedger(ledgerText) ?? []).map(row => ({ ...row, updatedAt: '2026-01-01T00:00:00Z' }))
    expect(summarize(rows, NOW).active.map(row => row.id)).toEqual(['TCK-1'])
  })
})

describe('text', () => {
  const summary = summarize(parseLedger(ledgerText) ?? [], NOW)

  test('status line names the QA turn and the green unannounced', () => {
    expect(statusLine(summary)).toBe('tanda 1 · QA TCK-1 · 1 verde sin anunciar')
  })

  test('status line clears with nothing active', () => {
    expect(statusLine({ active: [], stale: summary.stale })).toBe(undefined)
  })

  test('brief points at the stale list', () => {
    expect(brief(summary, NOW)).toContain('+ 1 abiertos viejos')
  })

  test('stale report carries the last note', () => {
    expect(staleReport(summary, NOW)).toContain('queda abierto por el anuncio')
  })
})

describe('changes', () => {
  const before = parseLedger(ledgerText) ?? []

  test('reports a gate turning red, the QA turn released and a close', () => {
    const after = before
      .filter(row => row.id !== 'TCK-2')
      .map(row => ({ ...row, qaTurn: null, prs: row.prs.map(pr => ({ ...pr, gate: 'RED' as const })) }))
    expect(changes(before, after)).toEqual([
      'TCK-1: front#10 → RED',
      'TCK-1: liberó el turno de QA',
      'TCK-2: cerrado',
    ])
  })

  test('reports an announcement and ignores PENDING', () => {
    const after = before.map(row => ({
      ...row,
      isAnnounced: row.id === 'TCK-1',
      prs: row.prs.map(pr => ({ ...pr, gate: 'PENDING' as const })),
    }))
    expect(changes(before, after)).toEqual(['TCK-1: anunciado'])
  })

  test('nothing changed, nothing reported', () => {
    expect(changes(before, before)).toEqual([])
  })
})
