import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput } from 'claude-code'

import type { AgentRow, Config, EffortChoice, Plan, Stats } from '../types'
import {
  DEFAULT_CONFIG,
  EFFORTS,
  MODELS,
  USAGE,
  describeConfig,
  isNoop,
  modelFamily,
  modelLabel,
  modelNote,
  normalizeConfig,
  planFor,
  printable,
  resolveModel,
  rowLine,
  runCommand,
  sameFamily,
  shortModel,
  statsText,
  statusLine,
  totalTokens,
} from './logic'
import type { Alias } from './logic'
import { ROW_HEIGHT, STATS_HEIGHT, rowsSvg, statsSvg } from './svg'

const PANE = 'ultracode-models'
const TITLE = 'Modèles des sous-agents'
const STORE_KEY = 'config'
/** Finished subagents the pane's log keeps. */
const MAX_ROWS = 60
/** Subagents the pane shows. */
const SHOWN_ROWS = 12
/** Subagents (running ones included) the mod keeps track of. */
const MAX_TRACKED = 500
/** How long a subagent's first request waits for its own spawn to be recorded. */
const SPAWN_WAIT_MS = 800

const CONFIG = { plugin: 'ultracode-models', key: 'config' } as const
const config = atom(CONFIG, DEFAULT_CONFIG)
const agents = atom({ plugin: 'ultracode-models', key: 'agents' } as const, [])
const stats = atom({ plugin: 'ultracode-models', key: 'stats' } as const, { agents: 0, tokens: {} })
const announced = atom({ plugin: 'ultracode-models', key: 'announced' } as const, '')

/** A subagent as the hooks follow it. */
type Tracked = {
  label: string
  /** The model core started it on: a step on another family is the engine's own fallback. */
  from: string
  runId: string
  plan?: Plan
  /** Tokens of its requests since its last finished turn, by model family. */
  usage: Record<string, number>
}

/** What the hooks share for this load of the module. */
type Session = {
  current: Config
  pinned: Partial<Record<Alias, string>>
  loading: Promise<void> | undefined
  tracked: Map<string, Tracked>
  /** Spawns not yet recorded, whose subagent may already be stepping. */
  spawning: Set<Promise<void>>
  /** Failures already toasted, by run and model. */
  toasted: Set<string>
  /** The settings note the model was given, as known in memory: prompts that arrive together tell it once. */
  told: string | undefined
}

/** The model buttons: inherit, the four families, and a full id the person set, if any. */
function modelChoices(current: string): { value: string; label: string; hotkey?: string }[] {
  const choices: { value: string; label: string; hotkey?: string }[] = [
    { value: 'inherit', label: 'Hérité', hotkey: 'i' },
    ...MODELS.map(one => ({ value: one.alias, label: shortModel(one.alias), hotkey: one.alias.charAt(0) })),
  ]
  return choices.some(one => one.value === current) ? choices : [...choices, { value: current, label: shortModel(current) }]
}

const EFFORT_CHOICES: { value: EffortChoice; label: string; hotkey: string }[] = [
  { value: 'inherit', label: 'Hérité', hotkey: '0' },
  ...EFFORTS.map((value, index) => ({ value, label: value, hotkey: String(index + 1) })),
]

async function quietly<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read
  } catch {
    return undefined
  }
}

/** Drops the oldest entries past `max`. */
function bound<K>(entries: Map<K, unknown> | Set<K>, max: number): void {
  for (const oldest of entries.keys()) {
    if (entries.size <= max) return
    entries.delete(oldest)
  }
}

function remember(s: Session, agentId: string, entry: Tracked): void {
  s.tracked.delete(agentId)
  s.tracked.set(agentId, entry)
  bound(s.tracked, MAX_TRACKED)
}

/** Keeps every running subagent (they hold plans a reload needs) and the newest finished ones. */
function trimRows(list: AgentRow[]): AgentRow[] {
  const running = new Set(list.filter(row => row.status === 'running').slice(-MAX_TRACKED).map(row => row.agentId))
  const finished = new Set(list.filter(row => row.status !== 'running').slice(-MAX_ROWS).map(row => row.agentId))
  return list.filter(row => running.has(row.agentId) || finished.has(row.agentId))
}

function load($: EngineInterface, s: Session): Promise<void> {
  s.loading ??= (async () => {
    const held = await $.state.get(CONFIG)
    let value = held.value
    if (value === undefined) {
      value = normalizeConfig(await quietly($.store.get(STORE_KEY)))
      await $.state.set(CONFIG, value)
    }
    s.current = normalizeConfig(value)
    s.pinned = {
      haiku: await quietly($.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')),
      sonnet: await quietly($.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL')),
      opus: await quietly($.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL')),
    }
    // A reload keeps $.state: subagents still running keep their plan.
    for (const row of await read($, agents)) {
      if (row.status !== 'running' || s.tracked.has(row.agentId)) continue
      remember(s, row.agentId, { label: row.label, from: row.from, runId: row.runId, usage: {}, ...(row.plan === undefined ? {} : { plan: row.plan }) })
    }
    $.ui.status(statusLine(s.current))
  })().catch(error => {
    s.loading = undefined
    throw error
  })
  return s.loading
}

async function change($: EngineInterface, s: Session, edit: (cfg: Config) => Config): Promise<Config> {
  await load($, s)
  const saved = await update($, config, cfg => normalizeConfig(edit(normalizeConfig(cfg))))
  s.current = saved
  $.ui.status(statusLine(saved))
  await $.store.set(STORE_KEY, saved)
  return saved
}

async function togglePane($: EngineInterface): Promise<string> {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane?.isShown && pane.isPlaced) {
    await $.ui.close({ id: PANE })
    return 'Panneau des modèles des sous-agents fermé.'
  }
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, columns: 76, rows: 20 })
  return opened.isPlaced ? 'Panneau des modèles des sous-agents ouvert.' : `Panneau ouvert, en attente de place : ${opened.reason}`
}

async function clearLog($: EngineInterface): Promise<void> {
  await update($, agents, list => list.filter(row => row.status === 'running'))
}

/** Runs `/ultramodels <args>` (or the configure tool) and says what it did, in markdown. */
async function command($: EngineInterface, s: Session, args: string, canToggle: boolean): Promise<string> {
  await load($, s)
  const outcome = runCommand(s.current, args)
  if (outcome.kind === 'toggle') return canToggle ? togglePane($) : describeConfig(s.current)
  if (outcome.kind === 'show') return describeConfig(s.current)
  if (outcome.kind === 'clear-log') {
    await clearLog($)
    return 'Sous-agents terminés retirés de la liste.'
  }
  if (outcome.kind === 'error') return outcome.usage ? `${outcome.message}\n\n\`\`\`text\n${USAGE}\n\`\`\`` : outcome.message

  // Applied again to the value as it is now, so a pane edit made meanwhile is kept.
  let message = outcome.message
  const saved = await change($, s, cfg => {
    const again = runCommand(cfg, args)
    if (again.kind !== 'set') return cfg
    message = again.message
    return again.config
  })
  return `${message}\n\n${describeConfig(saved)}`
}

/** Holds a subagent's first request until its own spawn is recorded, briefly. */
async function waitForSpawn($: EngineInterface, s: Session, agentId: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const stop = new AbortController()
  const abort = () => stop.abort()
  signal.addEventListener('abort', abort)
  try {
    const timeUp = $.clock.sleep(SPAWN_WAIT_MS, { signal: stop.signal }).then(
      () => true,
      () => true,
    )
    while (!s.tracked.has(agentId) && s.spawning.size > 0) {
      const isTimeUp = await Promise.race([timeUp, Promise.race([...s.spawning]).then(() => false)])
      if (isTimeUp) break
    }
  } finally {
    stop.abort()
    signal.removeEventListener('abort', abort)
  }
}

export const register: Register = on => {
  const s: Session = {
    current: DEFAULT_CONFIG,
    pinned: {},
    loading: undefined,
    tracked: new Map(),
    spawning: new Set(),
    toasted: new Set(),
    told: undefined,
  }

  on('session.start', async ($, e, next) => {
    await quietly(load($, s))
    await $.command.register({
      name: 'ultramodels',
      description: 'Modèle et effort de tous les sous-agents (panneau, ou /ultramodels haiku medium)',
      argumentHint: '[modèle [effort] | model <identifiant> | effort … | on|off | status | reset | log clear]',
    })
    await $.tool.register({
      name: 'status',
      description:
        'Shows the model and effort every subagent is set to run on (ultracode-models mod), the session totals, and the recent subagents with the model each one was sent to.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'configure',
      description: `Changes the model and effort of every subagent, only when the person asks for it. Takes the arguments of the /ultramodels command:\n${USAGE}`,
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'For example "haiku", "sonnet medium", "effort low", "off", "reset".' } },
        required: ['command'],
      },
    })
    return next(e)
  })

  // A /clear or a resume starts a new session id: the host empties $.state, so load again.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      s.loading = undefined
      s.told = undefined
    }
    return ended
  })

  // A compaction may summarize the settings note away: give it again with the next prompt.
  on('session.compact', { trigger: ['manual', 'auto'] }, async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && compacted.skip === undefined) {
      s.told = ''
      await quietly(update($, announced, () => ''))
    }
    return compacted
  })

  on('command.run', { command: 'ultramodels' }, async ($, e) => ({ text: await command($, s, e.args, true) }))

  on('tool.call', { tool: 'mcp__ultracode-models__status' }, async $ => {
    await load($, s)
    const rows = (await read($, agents)).slice(-20)
    const lines = rows.map(row =>
      JSON.stringify({
        label: printable(row.label),
        type: row.type,
        ...(row.index > 0 ? { workflowIndex: row.index } : {}),
        status: row.status,
        askedModel: row.asked,
        spawnedOn: row.from,
        sentTo: row.sent,
        effort: row.effort,
        answeredBy: row.answered,
        tokens: row.tokens,
        why: row.note,
      }),
    )
    const totals = statsText(await read($, stats))
    return { result: `${describeConfig(s.current)}\n\n${totals}\n\nRecent subagents (oldest first):\n${lines.join('\n') || '(none yet)'}` }
  })

  on('tool.call', { tool: 'mcp__ultracode-models__configure' }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'Refused: only the main conversation changes these settings, when the person asks.' }
    const args = typeof e.command === 'string' ? e.command : ''
    return { result: await command($, s, args, false) }
  })

  // Every subagent: an ordinary one takes the model at spawn; a workflow agent or a fork
  // cannot be changed here, so its requests are rewritten at turn.step.
  on('agent.spawn', async ($, e, next) => {
    await quietly(load($, s))
    const decision = planFor(s.current)
    const plan = decision.plan
    const canSetModel = e.workflow === undefined && !e.fork
    const asked = plan?.model !== undefined && canSetModel ? { ...e, model: plan.model } : e

    let settle = () => {}
    const recorded = new Promise<void>(resolve => {
      settle = resolve
    })
    const release = () => {
      settle()
      s.spawning.delete(recorded)
    }
    s.spawning.add(recorded)
    try {
      const started = await next(asked)
      if (started.deny !== undefined || started.agentId === undefined) return started

      const agentId = started.agentId
      const label = printable(e.description) || e.subagentType
      const runId = e.workflow?.runId ?? ''
      remember(s, agentId, { label, from: started.model, runId, usage: {}, ...(plan === undefined ? {} : { plan }) })
      release()

      const startedAt = await quietly($.clock.now())
      const row: AgentRow = {
        agentId,
        runId,
        index: e.workflow?.agentIndex ?? 0,
        label,
        type: e.subagentType,
        ...(e.model === undefined ? {} : { asked: e.model }),
        from: started.model,
        ...(plan === undefined ? {} : { plan }),
        note: decision.note,
        status: 'running',
        ...(e.parentAgentId === undefined ? {} : { parentId: e.parentAgentId }),
        ...(startedAt === undefined ? {} : { startedAt }),
      }
      await quietly(update($, agents, list => trimRows([...list.filter(one => one.agentId !== agentId), row])))
      await quietly(update($, stats, sums => ({ ...sums, agents: sums.agents + 1 })))
      return started
    } finally {
      release()
    }
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    // The main conversation is never changed.
    if (agentId === undefined) return yield* next(e)

    await quietly(load($, s))
    if (!s.tracked.has(agentId) && e.index === 0 && s.spawning.size > 0) await waitForSpawn($, s, agentId, next.signal)
    const entry = s.tracked.get(agentId)
    if (entry === undefined) return yield* next(e)

    const plan = entry.plan
    // A step on another family than the subagent started on is the engine's own fallback: leave it.
    const isFallback = !sameFamily(e.model, entry.from)
    const model = plan?.model === undefined || isFallback ? e.model : resolveModel(plan.model, e.model, s.pinned)
    const effort = plan?.effort === undefined || isFallback ? e.effort : plan.effort
    const down: TurnStepInput = model === e.model && effort === e.effort ? e : { ...e, model, ...(effort === undefined ? {} : { effort }) }
    const answered = yield* next(down)

    // The tokens the API counted for this request, kept until the subagent's turn ends.
    if (answered.usage) {
      const family = modelFamily(answered.usage.model)
      entry.usage[family] = (entry.usage[family] ?? 0) + totalTokens(answered.usage)
    }

    if (e.index === 0) {
      const by = answered.usage?.model
      await quietly(
        update($, agents, list =>
          list.map(row =>
            row.agentId !== agentId
              ? row
              : {
                  ...row,
                  sent: down.model,
                  ...(down.effort === undefined ? {} : { effort: String(down.effort) }),
                  ...(by === undefined ? {} : { answered: by }),
                },
          ),
        ),
      )
    }
    return answered
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) return next(e)
    await quietly(load($, s))
    const entry = s.tracked.get(agentId)
    if (entry !== undefined) {
      const status: AgentRow['status'] = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'aborted' : 'failed'
      const by = e.usage?.model
      // The requests' own counts, else the turn's sum (after a reload, the requests before it went uncounted here).
      const byModel = Object.keys(entry.usage).length > 0 ? entry.usage : e.usage ? { [modelFamily(e.usage.model)]: totalTokens(e.usage) } : {}
      entry.usage = {}
      const used = Object.values(byModel).reduce((sum, one) => sum + one, 0)
      const endedAt = await quietly($.clock.now())
      await quietly(
        update($, agents, list =>
          list.map(row =>
            row.agentId !== agentId
              ? row
              : {
                  ...row,
                  status,
                  ...(by === undefined ? {} : { answered: by }),
                  ...(used > 0 ? { tokens: (row.tokens ?? 0) + used } : {}),
                  ...(endedAt === undefined ? {} : { endedAt }),
                },
          ),
        ),
      )
      if (used > 0) {
        await quietly(
          update($, stats, sums => {
            const tokens = { ...sums.tokens }
            for (const [family, count] of Object.entries(byModel)) tokens[family] = (tokens[family] ?? 0) + count
            return { ...sums, tokens }
          }),
        )
      }
      const planned = entry.plan?.model
      const toast = `${entry.runId || agentId}:${planned}`
      if (e.reason === 'error' && planned !== undefined && !s.toasted.has(toast)) {
        s.toasted.add(toast)
        bound(s.toasted, MAX_TRACKED)
        $.ui.toast(`Sous-agents en échec sur ${modelLabel(planned)} (erreur d’API). Si ce modèle ne vous est pas accessible, changez-le avec /ultramodels.`, {
          timeoutMs: 8000,
        })
      }
    }
    return next(e)
  })

  // The model learns the settings beside the next prompt once they changed.
  on('prompt.submit', async ($, e, next) => {
    await load($, s)
    const note = modelNote(s.current)
    if (s.told === undefined) {
      const held = await read($, announced)
      // Checked again after the read: a prompt arriving together may have claimed the note meanwhile.
      s.told ??= held
    }
    const last = s.told
    if (last === '' ? isNoop(s.current) : last === note) return next(e)

    // Claimed before the prompt enters, so a prompt arriving meanwhile does not carry it again.
    s.told = note
    const entered = await next({ ...e, context: [...(e.context ?? []), note] })
    if (entered.drop !== undefined) {
      if (s.told === note) s.told = last
      return entered
    }
    await update($, announced, () => note)
    return entered
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // After a /clear the host has emptied $.state until the next load: draw what the hooks apply.
    const cfg = normalizeConfig((await $.state.get(CONFIG)).value ?? s.current)
    const rows = await read($, agents)
    const sums: Stats = await read($, stats)
    const { Box, Text, Button } = $.ui.resolve(e)

    const choose = (edit: (c: Config) => Config) => async () => {
      await change($, s, edit)
    }
    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text bold>Sous-agents</Text>
          <Text color={cfg.enabled ? 'success' : 'inactive'}>{cfg.enabled ? '● Actif' : '○ Désactivé'}</Text>
          <Button
            key="enabled"
            label={cfg.enabled ? 'Désactiver' : 'Activer'}
            hotkey="a"
            onPress={choose(c => ({ ...c, enabled: !c.enabled }))}
          />
        </Box>
        <Text dimColor>
          {!cfg.enabled
            ? 'Les sous-agents gardent les modèles prévus par Claude Code.'
            : isNoop(cfg)
              ? 'Tout est hérité : rien n’est changé.'
              : 'Outil Agent, agents des workflows et leurs sous-agents.'}
        </Text>
      </Box>
    )
    const models = (
      <Box flexDirection="column">
        <Text dimColor>Modèle</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {modelChoices(cfg.model).map(one => (
            <Button
              key={`model-${one.value}`}
              label={one.label}
              {...(one.value === cfg.model ? { variant: 'primary' as const } : {})}
              {...(one.hotkey === undefined ? {} : { hotkey: one.hotkey })}
              onPress={choose(c => ({ ...c, model: one.value }))}
            />
          ))}
        </Box>
      </Box>
    )
    const efforts = (
      <Box flexDirection="column">
        <Text dimColor>Effort</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {EFFORT_CHOICES.map(one => (
            <Button
              key={`effort-${one.value}`}
              label={one.label}
              {...(one.value === cfg.effort ? { variant: 'primary' as const } : {})}
              hotkey={one.hotkey}
              onPress={choose(c => ({ ...c, effort: one.value }))}
            />
          ))}
        </Box>
      </Box>
    )
    const recent = rows.slice(-SHOWN_ROWS).reverse()
    const recentHeader = (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Text bold>Récents</Text>
        {rows.some(row => row.status !== 'running') && <Button key="clear" label="Effacer" hotkey="c" onPress={() => clearLog($)} />}
      </Box>
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column" rowGap={1}>
          {header}
          <Text dimColor wrap="truncate-end">
            {statsText(sums)}
          </Text>
          {models}
          {efforts}
          <Box flexDirection="column">
            {recentHeader}
            {recent.length === 0 && <Text dimColor>Aucun sous-agent récent.</Text>}
            {recent.map(row => (
              <Text wrap="truncate-end" dimColor={row.status !== 'running'}>
                {rowLine(row)}
              </Text>
            ))}
          </Box>
        </Box>
      )
    }

    // Desktop, VS Code and mobile draw the numbers and the list as SVG, in the surface's own theme.
    const { Svg } = $.ui.resolve(e)
    const width = Math.max(240, Math.min(900, (e.props.bodyColumns || 60) * 8 - 8))
    return (
      <Box flexDirection="column" rowGap={1}>
        {header}
        <Svg key="stats" source={statsSvg(sums, width)} alt={statsText(sums)} width={width} height={STATS_HEIGHT} />
        {models}
        {efforts}
        <Box flexDirection="column">
          {recentHeader}
          {recent.length === 0 ? (
            <Text dimColor>Aucun sous-agent récent.</Text>
          ) : (
            <Svg key="rows" source={rowsSvg(recent, width)} alt={recent.map(rowLine).join('\n')} width={width} height={recent.length * ROW_HEIGHT} />
          )}
        </Box>
      </Box>
    )
  })
}
