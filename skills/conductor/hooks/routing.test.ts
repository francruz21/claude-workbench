import { describe, expect, test } from 'claude-code/testing'

import {
  anchorSection,
  dispatchGuard,
  missing,
  modelsSent,
  OFF,
  parseCommand,
  parseRouting,
  runsOn,
  statusText,
  withRouting,
} from './routing'

const caps = (modelRouting?: unknown) =>
  JSON.stringify({ detected: { gh: true }, choices: { tracker: 'linear', ...(modelRouting === undefined ? {} : { modelRouting }) } })

const ON = { enabled: true, conductor: 'opus', child: 'sonnet', childHeavy: 'opus' }

describe('parseRouting', () => {
  test('a missing file or key is off, as today', () => {
    expect(parseRouting(null)).toEqual(OFF)
    expect(parseRouting(caps())).toEqual(OFF)
    expect(parseRouting('not json')).toEqual(OFF)
  })

  test('reads the roles and drops a value that is not a model', () => {
    expect(parseRouting(caps({ enabled: true, conductor: 'opus', child: 'sonnet; rm -rf ~', childHeavy: 'claude-opus-5-5[1m]' }))).toEqual({
      enabled: true,
      conductor: 'opus',
      child: null,
      childHeavy: 'claude-opus-5-5[1m]',
    })
  })
})

describe('withRouting', () => {
  test('merges into choices and keeps everything else', () => {
    const next = JSON.parse(withRouting(caps({ enabled: true, child: 'sonnet' }), { enabled: false }))
    expect(next.detected).toEqual({ gh: true })
    expect(next.choices.tracker).toBe('linear')
    expect(next.choices.modelRouting).toEqual({ enabled: false, child: 'sonnet' })
  })

  test('refuses to overwrite a file that is not JSON', () => {
    expect(() => withRouting('{ broken', { enabled: true })).toThrow()
  })
})

describe('missing and statusText', () => {
  test('off needs nothing', () => {
    expect(missing(OFF)).toEqual([])
    expect(statusText(OFF)).toContain('off')
  })

  test('on without models names what is missing; childHeavy is optional', () => {
    const routing = { ...OFF, enabled: true, child: 'sonnet' }
    expect(missing(routing)).toEqual(['conductor'])
    expect(statusText(routing)).toContain('Faltan: conductor')
  })
})

describe('anchorSection', () => {
  test('off tells the conductor not to send /model', () => {
    expect(anchorSection(OFF)).toContain('No le mandes `/model`')
  })

  test('on with a gap asks instead of filling it', () => {
    expect(anchorSection({ ...ON, conductor: null })).toContain('choices.modelRouting.conductor')
  })

  test('on names both child models and the order of the steps', () => {
    const text = anchorSection(ON)
    expect(text).toContain('Hijo: `sonnet`')
    expect(text).toContain('hijo pesado: `opus`')
    expect(text).toContain('ANTES del `dispatch --inject`')
  })
})

describe('modelsSent', () => {
  test('reads the handle and model of a /model send', () => {
    expect(modelsSent('orca-ide terminal send --terminal term_a --text "/model sonnet" --enter --json')).toEqual([
      { handle: 'term_a', model: 'sonnet' },
    ])
  })

  test('ignores any other text', () => {
    expect(modelsSent('orca-ide terminal send --terminal term_a --text "seguí" --enter')).toEqual([])
  })
})

describe('dispatchGuard', () => {
  const dispatch = 'orca-ide orchestration dispatch --task t1 --to term_a --inject --json'

  test('off never refuses', () => {
    expect(dispatchGuard(dispatch, OFF, {})).toBeNull()
  })

  test('refuses an inject to a child that got no /model', () => {
    expect(dispatchGuard(dispatch, ON, {})).toContain('term_a no recibió su /model')
  })

  test('lets it run once the /model was sent, before or in the same command', () => {
    expect(dispatchGuard(dispatch, ON, { term_a: 'sonnet' })).toBeNull()
    expect(dispatchGuard(`orca-ide terminal send --terminal term_a --text "/model sonnet" --enter && ${dispatch}`, ON, {})).toBeNull()
  })

  test('a dispatch without --inject is tracking only', () => {
    expect(dispatchGuard('orca-ide orchestration dispatch --task t1 --to term_a --json', ON, {})).toBeNull()
  })

  test('on with a missing role refuses and points at resolve.md', () => {
    expect(dispatchGuard(dispatch, { ...ON, child: null }, { term_a: 'sonnet' })).toContain('core/resolve.md')
  })
})

describe('runsOn', () => {
  test('an alias matches the id that names it', () => {
    expect(runsOn('claude-opus-5-5[1m]', 'opus')).toBe(true)
    expect(runsOn('claude-sonnet-5-5', 'opus')).toBe(false)
  })

  test('a full id matches itself, context suffix aside', () => {
    expect(runsOn('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(true)
    expect(runsOn('claude-opus-5-5', 'claude-opus-4-7')).toBe(false)
  })
})

describe('parseCommand', () => {
  test('status by default, on and off, and set', () => {
    expect(parseCommand('')).toEqual({ kind: 'status' })
    expect(parseCommand('off')).toEqual({ kind: 'toggle', on: false })
    expect(parseCommand('set child sonnet')).toEqual({ kind: 'set', role: 'child', model: 'sonnet' })
  })

  test('rejects an unknown role or a model with junk', () => {
    expect(parseCommand('set boss opus').kind).toBe('error')
    expect(parseCommand('set child "sonnet; ls"').kind).toBe('error')
    expect(parseCommand('maybe').kind).toBe('error')
  })
})
