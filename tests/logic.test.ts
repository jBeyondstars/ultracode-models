import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_CONFIG,
  code,
  describeConfig,
  formatDuration,
  formatTokens,
  isNoop,
  modelFamily,
  modelNote,
  normalizeConfig,
  originalModel,
  planFor,
  printable,
  resolveModel,
  rowLine,
  runCommand,
  shares,
  statsText,
  statsTotal,
  statusLine,
  tokenize,
  totalTokens,
} from '../hooks/logic'
import type { AgentRow, Config } from '../types'

const OPUS = 'claude-opus-5-5'
const config = (patch: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, ...patch })

describe('planFor', () => {
  test('changes nothing by default', () => {
    expect(planFor(DEFAULT_CONFIG)).toEqual({ note: 'hérité' })
    expect(isNoop(DEFAULT_CONFIG)).toBe(true)
  })

  test('one model and one effort for every subagent', () => {
    expect(planFor(config({ model: 'haiku', effort: 'medium' }))).toEqual({ plan: { model: 'haiku', effort: 'medium' }, note: 'réglage du mod' })
    expect(planFor(config({ model: 'haiku' }))).toEqual({ plan: { model: 'haiku' }, note: 'réglage du mod' })
    expect(planFor(config({ effort: 'low' }))).toEqual({ plan: { effort: 'low' }, note: 'réglage du mod' })
  })

  test('a disabled mod changes nothing', () => {
    expect(planFor(config({ enabled: false, model: 'haiku' }))).toEqual({ note: 'mod désactivé' })
  })
})

describe('models', () => {
  test('an alias maps to the current id', () => {
    expect(resolveModel('sonnet', OPUS)).toBe('claude-sonnet-5-5')
    expect(resolveModel('fable', OPUS)).toBe('claude-fable-5-1')
  })

  test('a full id is kept as given', () => {
    expect(resolveModel('claude-opus-4-8', OPUS)).toBe('claude-opus-4-8')
  })

  test('an alias follows the person ANTHROPIC_DEFAULT_<ALIAS>_MODEL', () => {
    expect(resolveModel('sonnet', OPUS, { sonnet: 'my-sonnet' })).toBe('my-sonnet')
  })

  test('a provider prefix is kept, a date dropped', () => {
    expect(resolveModel('haiku', 'us.anthropic.claude-opus-5-5')).toBe('us.anthropic.claude-haiku-5-5')
    expect(resolveModel('haiku', 'claude-opus-4-5@20251101')).toBe('claude-haiku-5-5')
  })

  test('an unknown spelling falls back to the plain id', () => {
    expect(resolveModel('opus', 'some-gateway-model')).toBe('claude-opus-5-5')
  })

  test('a family ignores what a provider adds around the id', () => {
    expect(modelFamily('us.anthropic.claude-opus-5-5-v1:0')).toBe('claude-opus-5-5')
    expect(modelFamily('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
    expect(modelFamily('my-gateway')).toBe('my-gateway')
  })
})

describe('runCommand', () => {
  test('no argument toggles the pane', () => {
    expect(runCommand(DEFAULT_CONFIG, '  ')).toEqual({ kind: 'toggle' })
  })

  test('<model> [effort] sets every subagent and enables', () => {
    expect(runCommand(config({ enabled: false }), 'haiku')).toMatchObject({ kind: 'set', config: { enabled: true, model: 'haiku', effort: 'inherit' } })
    expect(runCommand(DEFAULT_CONFIG, 'sonnet high')).toMatchObject({ kind: 'set', config: { model: 'sonnet', effort: 'high' } })
    expect(runCommand(DEFAULT_CONFIG, 'effort low')).toMatchObject({ kind: 'set', config: { model: 'inherit', effort: 'low' } })
  })

  test('full ids: with claude- directly, any id through model', () => {
    expect(runCommand(DEFAULT_CONFIG, 'claude-opus-4-8')).toMatchObject({ kind: 'set', config: { model: 'claude-opus-4-8' } })
    expect(runCommand(DEFAULT_CONFIG, 'model my-gateway-sonnet low')).toMatchObject({ kind: 'set', config: { model: 'my-gateway-sonnet', effort: 'low' } })
    expect(runCommand(DEFAULT_CONFIG, 'my-gateway-sonnet')).toMatchObject({ kind: 'error', message: expect.stringContaining('Modèle inconnu') })
    expect(runCommand(DEFAULT_CONFIG, 'sonnet extreme').kind).toBe('error')
  })

  test('switches, status, the log, and no presets or rules any more', () => {
    expect(runCommand(DEFAULT_CONFIG, 'off')).toMatchObject({ kind: 'set', config: { enabled: false } })
    expect(runCommand(config({ model: 'haiku' }), 'reset')).toMatchObject({ kind: 'set', config: DEFAULT_CONFIG })
    expect(runCommand(DEFAULT_CONFIG, 'status')).toEqual({ kind: 'show' })
    expect(runCommand(DEFAULT_CONFIG, 'log clear')).toEqual({ kind: 'clear-log' })
    expect(runCommand(DEFAULT_CONFIG, 'preset eco')).toMatchObject({ kind: 'error', usage: true })
    expect(runCommand(DEFAULT_CONFIG, 'rule verify opus')).toMatchObject({ kind: 'error', usage: true })
  })
})

describe('normalizeConfig', () => {
  test('rebuilds a stored value, an older one with presets and rules included', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({ model: 'haiku', effort: 'loud' })).toEqual({ enabled: true, model: 'haiku', effort: 'inherit' })
    expect(
      normalizeConfig({ enabled: true, mode: 'force', model: 'haiku', effort: 'medium', rules: [{ pattern: '^verify', model: 'sonnet', effort: 'medium' }], nested: true }),
    ).toEqual({ enabled: true, model: 'haiku', effort: 'medium' })
  })
})

describe('texts', () => {
  test('the status line shows only while the mod changes something', () => {
    expect(statusLine(DEFAULT_CONFIG)).toBeUndefined()
    expect(statusLine(config({ model: 'haiku', effort: 'medium' }))).toBe('Sous-agents : Haiku 5.5 · medium')
    expect(statusLine(config({ effort: 'low' }))).toBe('Sous-agents : modèle hérité · low')
    expect(statusLine(config({ model: 'haiku', enabled: false }))).toBeUndefined()
  })

  test('the model note says every subagent, and when it is off', () => {
    const note = modelNote(config({ model: 'haiku', effort: 'medium' }))
    expect(note).toContain('every subagent to run on: model haiku, effort medium')
    expect(note).toContain('Agent tool calls, Workflow agent() calls')
    expect(modelNote(DEFAULT_CONFIG)).toContain('Off')
  })

  test('the reply names the model and the effort', () => {
    const reply = describeConfig(config({ model: 'haiku', effort: 'medium' }))
    expect(reply).toContain('- Modèle : Haiku 5.5')
    expect(reply).toContain('- Effort : medium')
  })

  test('rows lead with the model, so a cut keeps it', () => {
    const row: AgentRow = {
      agentId: 'a',
      runId: 'wf_1',
      index: 3,
      label: 'verify:auth',
      type: 'workflow-subagent',
      from: OPUS,
      sent: 'claude-haiku-5-5',
      effort: 'medium',
      note: 'réglage du mod',
      status: 'done',
      startedAt: 1_000,
      endedAt: 9_400,
      tokens: 54_321,
    }
    expect(rowLine(row)).toBe('✓ #3 Opus 5.5 → Haiku 5.5 · verify:auth · medium · 8 s · 54 k tokens')
    const plain: AgentRow = { ...row, runId: '', index: 0, label: 'Explore the code', type: 'Explore', status: 'running', from: 'claude-haiku-5-5' }
    expect(rowLine(plain)).toBe('… Haiku 5.5 · Explore the code [Explore] · medium · en cours')
    expect(rowLine({ ...plain, status: 'aborted', asked: 'opus' })).toBe('■ Opus 5.5 → Haiku 5.5 · Explore the code [Explore] · medium · 8 s · 54 k tokens')
  })

  test('only a model known for sure shows as the one replaced', () => {
    const row: AgentRow = { agentId: 'a', runId: '', index: 0, label: 'x', type: 'Explore', from: 'claude-haiku-5-5', note: '', status: 'done' }
    expect(originalModel(row)).toBeUndefined()
    expect(originalModel({ ...row, asked: 'haiku' })).toBeUndefined()
    expect(originalModel({ ...row, asked: 'sonnet' })).toBe('claude-sonnet-5-5')
    expect(originalModel({ ...row, from: OPUS, answered: 'claude-haiku-5-5' })).toBe(OPUS)
  })

  test('numbers read the French way', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(54_321)).toBe('54 k')
    expect(formatTokens(999_700)).toBe('1,0 M')
    expect(formatTokens(1_234_567)).toBe('1,2 M')
    expect(formatTokens(12_600_000)).toBe('13 M')
    expect(formatDuration(400)).toBe('1 s')
    expect(formatDuration(8_400)).toBe('8 s')
    expect(formatDuration(65_000)).toBe('1 min 5 s')
    expect(formatDuration(3_725_000)).toBe('1 h 2 min')
  })

  test('the session totals: exact counts, and each model family’s share', () => {
    const stats = { agents: 3, tokens: { 'claude-haiku-5-5': 150_000, 'claude-haiku-4-5': 30_000, 'claude-opus-5-5': 20_000 } }
    expect(statsTotal(stats)).toBe(200_000)
    expect(shares(stats)).toEqual([
      { key: 'haiku', label: 'Haiku', tokens: 180_000, percent: 90 },
      { key: 'opus', label: 'Opus', tokens: 20_000, percent: 10 },
    ])
    expect(statsText(stats)).toBe('Cette session : 3 sous-agents · 200 k tokens (Haiku 90 %, Opus 10 %)')
    expect(statsText({ agents: 1, tokens: {} })).toBe('Cette session : 1 sous-agent')
    expect(statsText({ agents: 0, tokens: {} })).toBe('Cette session : aucun sous-agent pour l’instant.')
    expect(totalTokens({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: null })).toBe(115)
  })

  test('drawn texts lose escape sequences and control characters', () => {
    expect(printable('verify\u001b[31m:auth\u0007\n')).toBe('verify:auth')
  })

  test('replies quote words as code', () => {
    expect(code('a`b')).toBe('``a`b``')
  })

  test('tokenize keeps quoted words together', () => {
    expect(tokenize(`model "a b" 'c d' e`)).toEqual(['model', 'a b', 'c d', 'e'])
  })
})
