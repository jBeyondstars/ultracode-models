import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentSpawnInput, HookStream, On, TurnStepInput, UiOpenResult, UiPane } from 'claude-code'
import type { AgentRow, Config } from '../types'

const PLUGIN = 'ultracode-models'
const PANE = 'ultracode-models'
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const ALIASES: Record<string, string> = { haiku: HAIKU, sonnet: SONNET, opus: OPUS, fable: 'claude-fable-5-1' }

/** An Agent tool call from the main conversation. */
const SPAWN: AgentSpawnInput = {
  tool_use_id: 'toolu_agent',
  prompt: 'Look at the auth module.',
  description: 'Explore auth',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: OPUS,
  background: false,
  fork: false,
}
const inWorkflow = (agentIndex: number, patch: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  ...SPAWN,
  tool_use_id: 'toolu_workflow',
  description: 'review:auth',
  subagentType: 'workflow-subagent',
  background: true,
  workflow: { runId: 'wf_test', agentIndex },
  ...patch,
})

const HAIKU_MEDIUM: Config = { enabled: true, model: 'haiku', effort: 'medium' }

/** A row a previous load of the module left in $.state for a subagent still running. */
const RUNNING: AgentRow = {
  agentId: 'agent-7',
  runId: 'wf_before',
  index: 2,
  label: 'read:core',
  type: 'workflow-subagent',
  from: OPUS,
  plan: { model: 'haiku', effort: 'low' },
  note: 'mod setting',
  status: 'running',
}

type Sent = { agentId?: string; index: number; model: string; effort?: TurnStepInput['effort'] }
type Seed = { store?: Record<string, unknown>; env?: Record<string, string>; agents?: AgentRow[]; clock?: boolean }

/** The test's hooks stand for the engine beneath the plugin, and record what reaches it. */
function engine(on: On, seed: Seed = {}) {
  const w = {
    /** The model each spawn reached the engine with (undefined: none asked). */
    spawned: [] as (string | undefined)[],
    sent: [] as Sent[],
    contexts: [] as (readonly string[] | undefined)[],
    stored: [] as unknown[],
    statuses: [] as (string | undefined)[],
    toasts: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
    sleeps: [] as number[],
    panes: [] as UiPane[],
    placement: { isPlaced: true } as UiOpenResult,
    drop: undefined as string | undefined,
    held: { rows: seed.agents ?? [], version: seed.agents === undefined ? 0 : 1 },
    clock: undefined as MockClock | undefined,
    gate: undefined as { arrive: () => void; opened: Promise<void> } | undefined,
    /** Holds the next spawns at the bottom: `reached` once one arrived, `release()` lets them start. */
    hold() {
      let arrive = () => {}
      let release = () => {}
      const reached = new Promise<void>(resolve => {
        arrive = resolve
      })
      const opened = new Promise<void>(resolve => {
        release = resolve
      })
      w.gate = { arrive, opened }
      return {
        reached,
        release: () => {
          w.gate = undefined
          release()
        },
      }
    },
  }
  let count = 0
  on('store.set', { key: 'config' }, async ($, e, next) => {
    w.stored.push(e.value)
    return next(e)
  })
  mock.store(on, seed.store ?? {})
  mock.env(on, seed.env ?? {})
  if (seed.clock === true) {
    on('clock.sleep', { ms: 800 }, async ($, e, next) => {
      w.sleeps.push(e.ms)
      return next(e)
    })
    w.clock = mock.clock(on)
  }
  if (seed.agents !== undefined) {
    // $.state survives a reload; the module's own variables do not.
    on('state.get', { plugin: 'ultracode-models', key: 'agents' }, () => ({ value: { value: w.held.rows, version: w.held.version } }))
    on('state.set', { plugin: 'ultracode-models', key: 'agents' }, ($, e) => {
      if (e.ifVersion !== undefined && e.ifVersion !== w.held.version) return { value: { isSet: false, version: w.held.version } }
      w.held = { rows: e.value, version: w.held.version + 1 }
      return { value: { isSet: true, version: w.held.version } }
    })
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: w.placement }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('agent.spawn', async ($, e) => {
    const gate = w.gate
    if (gate !== undefined) {
      gate.arrive()
      await gate.opened
    }
    w.spawned.push(e.model)
    if (e.description === 'denied') return { deny: 'refused by policy' }
    // Like core: a fork always inherits; otherwise the call's model, else the parent's.
    const model = e.fork || e.model === undefined ? e.parentModel : (ALIASES[e.model] ?? e.model)
    return { model, agentId: `agent-${++count}` }
  })
  on('turn.step', async function* ($, e) {
    w.sent.push({
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
      index: e.index,
      model: e.model,
      ...(e.effort === undefined ? {} : { effort: e.effort }),
    })
    yield { kind: 'text', index: 0, text: 'ok' }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'Summary.', toolUses: [] }] }))
  on('prompt.submit', ($, e) => {
    w.contexts.push(e.context)
    const drop = w.drop
    if (drop !== undefined) {
      w.drop = undefined
      return { drop }
    }
    return { text: e.text, ...(e.context === undefined ? {} : { context: e.context }) }
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const run = async ($: Engine, args: string) => {
  const { text } = await $.command.run({ command: 'ultramodels', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  return text ?? ''
}

const drain = async <C, R>(stream: HookStream<C, R>): Promise<R> => {
  let last = await stream.next()
  while (!last.done) last = await stream.next()
  return last.value
}

/** One model request as the engine would send it: on the subagent's own model, at the session's effort. */
const step = ($: Engine, agentId: string | undefined, effort: TurnStepInput['effort'] = 'high', index = 0, model = OPUS) =>
  drain($.turn.step({ turnId: `turn-${agentId ?? 'main'}`, index, model, effort, messageCount: 1, ...(agentId === undefined ? {} : { agentId }) }))

const complete = ($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error') =>
  $.turn.complete({ agentId, reason, answer: '', durationMs: 10, isAborted: reason === 'aborted', turnId: `turn-${agentId}` })

const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const status = async ($: Engine) => String((await $.tool.call({ tool: 'mcp__ultracode-models__status' })).result)

const configure = async ($: Engine, command: unknown) => String((await $.tool.call({ tool: 'mcp__ultracode-models__configure', command })).result)

const props = { title: 'Subagent models', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

describe('every subagent runs on the chosen model', () => {
  test('an Agent tool subagent takes it at spawn, and the effort at each request', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku medium')
    const agent = await $.agent.spawn(SPAWN)
    await step($, agent.agentId, 'high', 0, HAIKU)
    await step($, agent.agentId, 'high', 1, HAIKU)
    expect(w.spawned).toEqual(['haiku'])
    expect(w.sent).toEqual([
      { agentId: 'agent-1', index: 0, model: HAIKU, effort: 'medium' },
      { agentId: 'agent-1', index: 1, model: HAIKU, effort: 'medium' },
    ])
  })

  test('even one whose call asked for another model', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku')
    await $.agent.spawn({ ...SPAWN, model: 'opus' })
    expect(w.spawned).toEqual(['haiku'])
  })

  test('a workflow agent cannot be changed at spawn: each of its requests is', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku medium')
    const agent = await $.agent.spawn(inWorkflow(1, { model: 'opus' }))
    await step($, agent.agentId, 'max', 0)
    expect(w.spawned).toEqual(['opus'])
    expect(w.sent).toEqual([{ agentId: 'agent-1', index: 0, model: HAIKU, effort: 'medium' }])
  })

  test('a fork keeps its spawn, and its requests are rewritten', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku medium')
    const fork = await $.agent.spawn({ ...SPAWN, fork: true, subagentType: 'fork' })
    await step($, fork.agentId)
    expect(w.spawned).toEqual([undefined])
    expect(w.sent).toEqual([{ agentId: 'agent-1', index: 0, model: HAIKU, effort: 'medium' }])
  })

  test('the subagents of a subagent too, workflow or not', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku')
    const parent = await $.agent.spawn(inWorkflow(1))
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_child', parentAgentId: parent.agentId ?? '' })
    expect(w.spawned).toEqual([undefined, 'haiku'])
  })

  test('the main conversation is never changed', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku low')
    await step($, undefined, 'max')
    expect(w.sent).toEqual([{ index: 0, model: OPUS, effort: 'max' }])
  })

  test('off, or everything inherited, leaves them alone; they are listed all the same', async ($, on) => {
    const w = engine(on)
    await start($)
    const inherited = await $.agent.spawn(inWorkflow(1))
    await step($, inherited.agentId)
    await run($, 'haiku low')
    await run($, 'off')
    const off = await $.agent.spawn(SPAWN)
    await step($, off.agentId)
    expect(w.spawned).toEqual([undefined, undefined])
    expect(w.sent).toEqual([
      { agentId: 'agent-1', index: 0, model: OPUS, effort: 'high' },
      { agentId: 'agent-2', index: 0, model: OPUS, effort: 'high' },
    ])
    const listed = await status($)
    expect(listed).toContain('"why":"inherited"')
    expect(listed).toContain('"why":"mod off"')
  })

  test('a running subagent keeps the plan it was spawned with', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'sonnet medium')
    const first = await $.agent.spawn(inWorkflow(1))
    await step($, first.agentId, 'high', 0)
    await run($, 'haiku low')
    await step($, first.agentId, 'high', 1)
    expect(w.sent.map(one => [one.model, one.effort])).toEqual([
      [SONNET, 'medium'],
      [SONNET, 'medium'],
    ])
  })

  test('an alias follows ANTHROPIC_DEFAULT_HAIKU_MODEL', async ($, on) => {
    const w = engine(on, { env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5' } })
    await start($)
    await run($, 'haiku')
    const agent = await $.agent.spawn(inWorkflow(1))
    await step($, agent.agentId)
    expect(w.sent[0]?.model).toBe('claude-haiku-4-5')
  })

  test('a fallback model the engine picks is left alone', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'sonnet')
    const agent = await $.agent.spawn(inWorkflow(1))
    await step($, agent.agentId, 'high', 0)
    await step($, agent.agentId, 'high', 1, HAIKU)
    expect(w.sent.map(one => one.model)).toEqual([SONNET, HAIKU])
  })

  test('a stored setting applies from the start, an older one with presets and rules too', async ($, on) => {
    const w = engine(on, {
      store: { config: { enabled: true, mode: 'force', model: 'haiku', effort: 'medium', rules: [{ pattern: '^verify', model: 'sonnet', effort: 'medium' }], nested: true } },
    })
    await start($)
    const verifier = await $.agent.spawn(inWorkflow(1, { description: 'verify:auth' }))
    await step($, verifier.agentId)
    expect(w.sent).toEqual([{ agentId: 'agent-1', index: 0, model: HAIKU, effort: 'medium' }])
  })

  test('a refused spawn is not listed and leaves no wait behind', async ($, on) => {
    const w = engine(on, { clock: true })
    await start($)
    await run($, 'haiku')
    const refused = await $.agent.spawn(inWorkflow(1, { description: 'denied' }))
    expect(refused.deny).toBe('refused by policy')
    await step($, 'agent-x')
    expect(w.sleeps).toEqual([])
    expect(w.sent).toEqual([{ agentId: 'agent-x', index: 0, model: OPUS, effort: 'high' }])
    expect(await status($)).toContain('(none yet)')
  })
})

describe('a first request racing its spawn', () => {
  test('waits for the spawn to be recorded, then is rewritten', async ($, on) => {
    const w = engine(on, { clock: true })
    await start($)
    await run($, 'sonnet medium')
    const held = w.hold()
    const spawning = $.agent.spawn(inWorkflow(1))
    await held.reached
    const stepping = step($, 'agent-1')
    await w.clock?.settle()
    expect(w.sleeps).toEqual([800])
    expect(w.sent).toEqual([])
    held.release()
    await spawning
    await stepping
    expect(w.sent).toEqual([{ agentId: 'agent-1', index: 0, model: SONNET, effort: 'medium' }])
  })

  test('goes out unchanged after 0.8 s; the next requests are rewritten', async ($, on) => {
    const w = engine(on, { clock: true })
    await start($)
    await run($, 'sonnet medium')
    const held = w.hold()
    const spawning = $.agent.spawn(inWorkflow(1))
    await held.reached
    const stepping = step($, 'agent-1')
    await w.clock?.advance(800)
    await stepping
    held.release()
    await spawning
    await step($, 'agent-1', 'high', 1)
    expect(w.sent).toEqual([
      { agentId: 'agent-1', index: 0, model: OPUS, effort: 'high' },
      { agentId: 'agent-1', index: 1, model: SONNET, effort: 'medium' },
    ])
  })
})

describe('after a reload', () => {
  test('the plans of running subagents come back from $.state', async ($, on) => {
    const w = engine(on, { agents: [{ ...RUNNING, agentId: 'agent-6', status: 'done' }, RUNNING], store: { config: HAIKU_MEDIUM } })
    await start($)
    await step($, 'agent-7')
    await step($, 'agent-6')
    expect(w.sent).toEqual([
      { agentId: 'agent-7', index: 0, model: HAIKU, effort: 'low' },
      { agentId: 'agent-6', index: 0, model: OPUS, effort: 'high' },
    ])
  })

  test('a request that comes before the reload’s session.start still gets its plan', async ($, on) => {
    const w = engine(on, { agents: [RUNNING], store: { config: HAIKU_MEDIUM } })
    await step($, 'agent-7', 'high', 3)
    expect(w.sent).toEqual([{ agentId: 'agent-7', index: 3, model: HAIKU, effort: 'low' }])
  })

  test('an end that comes before the reload’s session.start is still recorded', async ($, on) => {
    const w = engine(on, { agents: [RUNNING], store: { config: HAIKU_MEDIUM } })
    await complete($, 'agent-7', 'answer')
    expect(w.held.rows.find(row => row.agentId === 'agent-7')?.status).toBe('done')
  })
})

describe('the end of a subagent', () => {
  test('a failure on the chosen model is toasted once per run and model', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'fable')
    const one = await $.agent.spawn(inWorkflow(1, { description: 'review:a' }))
    const two = await $.agent.spawn(inWorkflow(2, { description: 'review:b' }))
    const three = await $.agent.spawn(inWorkflow(3, { description: 'review:c' }))
    const four = await $.agent.spawn(inWorkflow(4, { description: 'review:d' }))
    await complete($, one.agentId ?? '', 'error')
    await complete($, two.agentId ?? '', 'error')
    await complete($, three.agentId ?? '', 'aborted')
    await complete($, four.agentId ?? '', 'answer')
    expect(w.toasts).toEqual([expect.stringContaining('failed on Fable 5.1')])
    const listed = await status($)
    expect(listed).toContain('"label":"review:a","type":"workflow-subagent","workflowIndex":1,"status":"failed"')
    expect(listed).toContain('"label":"review:c","type":"workflow-subagent","workflowIndex":3,"status":"aborted"')
    expect(listed).toContain('"label":"review:d","type":"workflow-subagent","workflowIndex":4,"status":"done"')
  })

  test('no toast when its model was not changed', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'effort low')
    const agent = await $.agent.spawn(SPAWN)
    await complete($, agent.agentId ?? '', 'error')
    expect(w.toasts).toEqual([])
  })
})

describe('the model is told', () => {
  test('once beside the next prompt after a change, and when it is off', async ($, on) => {
    const w = engine(on)
    await start($)
    await submit($, 'hello')
    await run($, 'haiku medium')
    await submit($, 'go')
    await submit($, 'again')
    await run($, 'off')
    await submit($, 'and now')
    expect(w.contexts[0]).toBeUndefined()
    expect(w.contexts[1]?.[0]).toContain('every subagent to run on: model haiku, effort medium')
    expect(w.contexts[2]).toBeUndefined()
    expect(w.contexts[3]?.[0]).toContain('Off')
  })

  test('only once when prompts arrive together', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku')
    await Promise.all([submit($, 'a'), submit($, 'b'), submit($, 'c')])
    expect(w.contexts.filter(one => one?.[0]?.includes('model haiku') ?? false)).toHaveLength(1)
  })

  test('again after a prompt that was dropped', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku')
    w.drop = 'busy'
    expect((await submit($, 'first')).drop).toBe('busy')
    await submit($, 'second')
    await submit($, 'third')
    expect(w.contexts.map(one => one?.[0]?.includes('model haiku') ?? false)).toEqual([true, true, false])
  })

  test('again after a compaction', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku')
    await submit($, 'one')
    await submit($, 'two')
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'one', toolUses: [] }] })
    await submit($, 'three')
    expect(w.contexts.map(one => one?.[0]?.includes('model haiku') ?? false)).toEqual([true, false, true])
  })
})

describe('commands and tools', () => {
  test('the status line follows the settings', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'haiku medium')
    await run($, 'off')
    await run($, 'on')
    await run($, 'reset')
    expect(w.statuses).toEqual([undefined, 'Subagents: Haiku 5.5 · medium', undefined, 'Subagents: Haiku 5.5 · medium', undefined])
  })

  test('/ultramodels alone opens the pane, then closes it, and says when it waits', async ($, on) => {
    const w = engine(on)
    await start($)
    expect(await run($, '')).toBe('Subagent models pane opened.')
    w.panes = [{ id: PANE, title: 'Subagent models', isShown: true, isFocused: true, isPlaced: true }]
    expect(await run($, '  ')).toBe('Subagent models pane closed.')
    w.panes = [{ id: PANE, title: 'Subagent models', isShown: false, isFocused: false, isPlaced: true }]
    w.placement = { isPlaced: false, reason: 'terminal too narrow' }
    expect(await run($, '')).toBe('Pane opened, waiting for room: terminal too narrow')
    expect(w.opened).toEqual([PANE, PANE])
    expect(w.closed).toEqual([PANE])
  })

  test('the configure tool runs the command words and never opens the pane', async ($, on) => {
    const w = engine(on)
    await start($)
    expect(await configure($, 'haiku medium')).toContain('Every subagent: Haiku 5.5 · effort medium.')
    expect(await configure($, '')).toContain('- Model: Haiku 5.5')
    expect(await configure($, 42)).toContain('Subagent models: on')
    expect(await configure($, 'gpt-5')).toContain('Unknown model')
    expect(w.opened).toEqual([])
    expect(w.stored).toEqual([HAIKU_MEDIUM])
  })

  test('the status tool lists the subagents with the model each one was sent to', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'haiku')
    const agent = await $.agent.spawn(SPAWN)
    await step($, agent.agentId, 'high', 0, HAIKU)
    expect(await status($)).toContain('"label":"Explore auth","type":"general-purpose","status":"running","spawnedOn":"claude-haiku-5-5","sentTo":"claude-haiku-5-5"')
  })
})

describe('the session totals', () => {
  test('count the subagents and the tokens each model answered with, as the API reported them', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'haiku')
    const one = await $.agent.spawn(inWorkflow(1))
    const two = await $.agent.spawn(SPAWN)
    await step($, one.agentId, 'high', 0)
    await step($, one.agentId, 'high', 1)
    await step($, two.agentId, 'high', 0, HAIKU)
    await complete($, one.agentId ?? '', 'answer')
    await complete($, two.agentId ?? '', 'answer')
    expect(await status($)).toContain('This session: 2 subagents · 6 tokens (Haiku 100%)')
  })

  test('a turn whose requests went uncounted here takes the turn’s own sum', async ($, on) => {
    const w = engine(on, { agents: [RUNNING], store: { config: HAIKU_MEDIUM } })
    await start($)
    await $.turn.complete({
      agentId: 'agent-7',
      reason: 'answer',
      answer: '',
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-agent-7',
      usage: { model: HAIKU, input_tokens: 1_000, output_tokens: 200, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 0 },
    })
    expect(w.held.rows.find(row => row.agentId === 'agent-7')?.tokens).toBe(51_200)
  })

  test('how long a subagent ran comes from the clock', async ($, on) => {
    const w = engine(on, { clock: true })
    await start($)
    await run($, 'haiku')
    const agent = await $.agent.spawn(inWorkflow(1, { description: 'read:a' }))
    await w.clock?.advance(8_000)
    await complete($, agent.agentId ?? '', 'answer')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props })
    expect((await ui.find({ type: 'Text', text: /read:a/ }))?.text).toContain('· 8s')
  })
})

describe('the pane', () => {
  test('one click picks the model and the effort, on terminal and desktop', async ($, on) => {
    const w = engine(on)
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props })
      await ui.press({ key: 'model-haiku' })
      await ui.press({ key: 'effort-medium' })
      expect((await ui.find({ key: 'model-haiku' }))?.props).toMatchObject({ variant: 'primary' })
      expect((await ui.find({ key: 'model-sonnet' }))?.props).not.toMatchObject({ variant: 'primary' })
      expect((await ui.find({ key: 'effort-medium' }))?.props).toMatchObject({ variant: 'primary' })
      expect(await ui.findAll({ type: 'Select' })).toHaveLength(0)
      await ui.press({ key: 'model-inherit' })
      await ui.unmount()
    }
    expect(w.stored).toContainEqual(HAIKU_MEDIUM)
    expect(w.stored.at(-1)).toEqual({ ...HAIKU_MEDIUM, model: 'inherit' })
  })

  test('a full model id the person set gets its own button', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'model my-gateway-sonnet')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props })
    expect((await ui.find({ key: 'model-my-gateway-sonnet' }))?.props).toMatchObject({ variant: 'primary' })
  })

  test('desktop draws the totals and the list as SVG; the terminal writes them', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'haiku')
    const agent = await $.agent.spawn(inWorkflow(1, { description: 'read:a' }))
    await step($, agent.agentId)
    await complete($, agent.agentId ?? '', 'answer')

    const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props })
    const drawings = await desktop.findAll({ type: 'Svg' })
    expect(drawings).toHaveLength(2)
    expect(String(drawings[0]?.props.alt)).toBe('This session: 1 subagent · 2 tokens (Haiku 100%)')
    expect(String(drawings[1]?.props.source)).toContain('read:a')
    await desktop.unmount()

    const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props })
    expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await terminal.find({ type: 'Text', text: /This session: 1 subagent/ })).toBeDefined()
    expect(await terminal.find({ type: 'Text', text: /Opus 5\.5 → Haiku 5\.5 · read:a/ })).toBeDefined()
  })

  test('the button turns the mod off and on', async ($, on) => {
    const w = engine(on)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props })
    await ui.press({ key: 'enabled' })
    expect((w.stored.at(-1) as Config).enabled).toBe(false)
    expect(await ui.find({ type: 'Text', text: '○ Off' })).toBeDefined()
    await ui.press({ key: 'enabled' })
    expect((w.stored.at(-1) as Config).enabled).toBe(true)
  })

  test('Clear drops finished subagents from the list and keeps the running ones', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'haiku')
    const finished = await $.agent.spawn(inWorkflow(1, { description: 'read:a' }))
    await $.agent.spawn(inWorkflow(2, { description: 'read:b' }))
    await complete($, finished.agentId ?? '', 'answer')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props })
    expect(await ui.find({ type: 'Text', text: /read:a/ })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /read:a/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /read:b/ })).toBeDefined()
  })

  test('mobile has the same buttons and drawings', async ($, on) => {
    const w = engine(on, { store: { config: HAIKU_MEDIUM } })
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'mobile', component: 'Pane', requestId: PANE, props })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
    await ui.press({ key: 'model-sonnet' })
    expect(w.stored.at(-1)).toEqual({ ...HAIKU_MEDIUM, model: 'sonnet' })
  })

  test('a label with an escape sequence still draws the pane', async ($, on) => {
    engine(on)
    await start($)
    await $.agent.spawn(inWorkflow(1, { description: 'verify\u001b[31m:auth\u0007' }))
    const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props })
    expect(await terminal.find({ type: 'Text', text: /verify:auth/ })).toBeDefined()
    await terminal.unmount()
    const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props })
    const list = (await desktop.findAll({ type: 'Svg' }))[1]
    expect(String(list?.props.source)).toContain('verify:auth')
    expect(String(list?.props.source)).not.toContain('\u001b')
  })
})
