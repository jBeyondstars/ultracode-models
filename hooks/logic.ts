// The mod's pure logic: no `$` here, so tests drive it directly.
import type { AgentRow, Config, Effort, EffortChoice, Plan, Stats } from '../types'

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const MODELS = [
  { alias: 'haiku', id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { alias: 'sonnet', id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { alias: 'opus', id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { alias: 'fable', id: 'claude-fable-5-1', label: 'Fable 5.1' },
] as const

export type Alias = (typeof MODELS)[number]['alias']

/** An effort as a request carries it: a level, or an integer budget. */
export type StepEffort = Effort | number

/** The type of a workflow agent started with no opts.agentType. */
export const WORKFLOW_AGENT_TYPE = 'workflow-subagent'

export const DEFAULT_CONFIG: Config = { enabled: true, model: 'inherit', effort: 'inherit' }

export type Decision = { plan?: Plan; note: string }

/** The plan every subagent gets under these settings, or why it gets none. */
export function planFor(config: Config): Decision {
  if (!config.enabled) return { note: 'mod off' }
  const plan: Plan = {
    ...(config.model === 'inherit' ? {} : { model: config.model }),
    ...(config.effort === 'inherit' ? {} : { effort: config.effort }),
  }
  return plan.model === undefined && plan.effort === undefined ? { note: 'inherited' } : { plan, note: 'mod setting' }
}

const FAMILY = /claude-(?:haiku|sonnet|opus|fable|mythos)-\d+(?:-\d+)?/i

/** A model id's family and version (`claude-opus-5-5`), whatever a provider adds around it. */
export function modelFamily(id: string): string {
  return FAMILY.exec(id)?.[0].toLowerCase() ?? id.toLowerCase()
}

export function sameFamily(a: string, b: string): boolean {
  return modelFamily(a) === modelFamily(b)
}

/**
 * The model id a request is sent with for a choice. An alias follows the
 * person's ANTHROPIC_DEFAULT_<ALIAS>_MODEL when set, else takes the spelling
 * of the id the engine resolved (a provider's prefix or suffix kept).
 */
export function resolveModel(choice: string, current: string, pinned: Partial<Record<Alias, string>> = {}): string {
  const known = MODELS.find(one => one.alias === choice.toLowerCase())
  if (known === undefined) return choice

  const fromEnv = pinned[known.alias]
  if (fromEnv) return fromEnv

  const spelled = /claude-(?:haiku|sonnet|opus|fable|mythos)-\d+(?:-\d+)?(?:[-@]\d{8})?/
  return spelled.test(current) ? current.replace(spelled, known.id) : known.id
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** A text that one Text element draws: escape sequences and control characters out. */
export function printable(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim()
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

/** A stored value (an older shape included), checked field by field, with the defaults for what is off. */
export function normalizeConfig(value: unknown): Config {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_CONFIG }
  const raw = value as Record<string, unknown>
  const model = typeof raw.model === 'string' && raw.model.trim() !== '' && !CONTROL.test(raw.model) ? raw.model.trim() : 'inherit'
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
    model,
    effort: raw.effort === 'inherit' || isEffort(raw.effort) ? raw.effort : 'inherit',
  }
}

export function modelLabel(choice: string | undefined): string {
  if (choice === undefined || choice === 'inherit') return 'inherited'
  const lower = choice.toLowerCase()
  const known = MODELS.find(one => one.alias === lower || lower.includes(one.id))
  return known?.label ?? printable(choice)
}

export function effortLabel(choice: EffortChoice | StepEffort | undefined): string {
  if (choice === undefined || choice === 'inherit') return 'inherited'
  return String(choice)
}

/** Inline code for markdown, fenced longer than any backtick run inside. */
export function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

export function isNoop(config: Config): boolean {
  return planFor(config).plan === undefined
}

/** The status-bar line, or undefined while the mod changes nothing. */
export function statusLine(config: Config): string | undefined {
  if (isNoop(config)) return undefined
  const model = config.model === 'inherit' ? 'inherited model' : modelLabel(config.model)
  const effort = config.effort === 'inherit' ? 'inherited effort' : config.effort
  return `Subagents: ${model} · ${effort}`
}

/** The settings as a markdown reply. */
export function describeConfig(config: Config): string {
  return [
    `**Subagent models: ${config.enabled ? 'on' : 'off'}**`,
    '',
    `- Model: ${modelLabel(config.model)}`,
    `- Effort: ${effortLabel(config.effort)}`,
    '- Applies to every subagent: Agent tool calls, workflow agent() calls, and their own subagents.',
  ].join('\n')
}

/** What the model reads beside the next prompt once the settings changed. */
export function modelNote(config: Config): string {
  const head = '[ultracode-models mod]'
  if (isNoop(config)) {
    return `${head} Off: every subagent runs on the model and effort Claude Code gives it.`
  }
  const model = config.model === 'inherit' ? 'model inherited (unchanged)' : `model ${config.model}`
  const effort = config.effort === 'inherit' ? 'effort inherited (unchanged)' : `effort ${config.effort}`
  return [
    `${head} The person set every subagent to run on: ${model}, ${effort}.`,
    'This covers Agent tool calls, Workflow agent() calls and the subagents those spawn, whatever the Agent tool model parameter or opts.model / opts.effort say. The main conversation is not changed.',
  ].join('\n')
}

/** Which family a model belongs to, for its color and short name. */
export type ModelKey = Alias | 'other'

export function modelKey(id: string): ModelKey {
  const lower = id.toLowerCase()
  return MODELS.find(one => one.alias === lower || lower.includes(`claude-${one.alias}-`))?.alias ?? 'other'
}

/** A model's short name: Haiku, Sonnet, Opus, Fable, or its id. */
export function shortModel(id: string): string {
  const key = modelKey(id)
  return key === 'other' ? printable(id) : `${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

/** The model a subagent answered on, as far as it is known. */
export function shownModel(row: AgentRow): string {
  return row.answered ?? row.sent ?? row.from
}

/** The model a subagent would have run on without the mod, only where that is known for sure. */
export function originalModel(row: AgentRow): string | undefined {
  const shown = shownModel(row)
  // A workflow agent or a fork kept core's model at spawn: that is the one it would have run on.
  if (!sameFamily(row.from, shown)) return row.from
  // An ordinary subagent took the mod's model at spawn: only a model its call asked for is known.
  if (row.asked === undefined) return undefined
  const asked = MODELS.find(one => one.alias === row.asked?.toLowerCase())?.id ?? row.asked
  return sameFamily(asked, shown) ? undefined : asked
}

/** The four token counts of a request, as the API reports them. */
export type Usage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function totalTokens(usage: Usage): number {
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

/** A token count as the pane shows it: 999, 54k, 1.2M. */
export function formatTokens(count: number): string {
  if (count >= 999_500) {
    const millions = count / 1_000_000
    return `${millions >= 9.95 ? Math.round(millions).toString() : millions.toFixed(1)}M`
  }
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(Math.round(count))
}

/** A duration as the pane shows it: 8s, 1m 5s, 1h 2m. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export type Share = { key: ModelKey; label: string; tokens: number; percent: number }

/** The session's tokens by model family, largest first, with whole percents. */
export function shares(stats: Stats): Share[] {
  const byKey = new Map<ModelKey, number>()
  for (const [id, tokens] of Object.entries(stats.tokens)) {
    const key = modelKey(id)
    byKey.set(key, (byKey.get(key) ?? 0) + tokens)
  }
  const total = [...byKey.values()].reduce((sum, one) => sum + one, 0)
  if (total === 0) return []
  return [...byKey.entries()]
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, tokens]) => ({
      key,
      label: key === 'other' ? 'Other' : shortModel(key),
      tokens,
      percent: Math.round((tokens / total) * 100),
    }))
}

export function statsTotal(stats: Stats): number {
  return Object.values(stats.tokens).reduce((sum, one) => sum + one, 0)
}

/**
 * The share of the session's tokens the prompt cache served, in whole percents:
 * each request re-sends a subagent's whole context, and most of it comes back from the cache.
 */
export function cacheShare(stats: Stats): number | undefined {
  const cache = stats.cache
  return cache === undefined || cache.total <= 0 ? undefined : Math.round((cache.read / cache.total) * 100)
}

/** The session's numbers as one line: how many subagents, their tokens, each model's share and the cache's. */
export function statsText(stats: Stats): string {
  if (stats.agents === 0) return 'This session: no subagents yet.'
  const agents = `${stats.agents} subagent${stats.agents > 1 ? 's' : ''}`
  const total = statsTotal(stats)
  if (total === 0) return `This session: ${agents}`
  const split = shares(stats).map(one => `${one.label} ${one.percent}%`).join(', ')
  const cached = cacheShare(stats)
  return `This session: ${agents} · ${formatTokens(total)} tokens (${split})${cached === undefined ? '' : ` · ${cached}% from cache`}`
}

/** What a row says after its model: its effort, then how long it ran and what it used. */
export function rowMeta(row: AgentRow): string[] {
  const parts = row.effort === undefined ? [] : [row.effort]
  if (row.status === 'running') return [...parts, 'running']
  if (row.startedAt !== undefined && row.endedAt !== undefined) parts.push(formatDuration(row.endedAt - row.startedAt))
  if (row.tokens !== undefined && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tokens`)
  return parts
}

export function rowLabel(row: AgentRow): string {
  return printable(row.label) || printable(row.type)
}

export function rowLine(row: AgentRow): string {
  const mark = { running: '…', done: '✓', failed: '✗', aborted: '■' }[row.status]
  const index = row.index > 0 ? `#${row.index} ` : ''
  const original = originalModel(row)
  const model = `${original === undefined ? '' : `${modelLabel(original)} → `}${modelLabel(shownModel(row))}`
  const label = rowLabel(row)
  const type = row.type !== WORKFLOW_AGENT_TYPE && label !== row.type ? ` [${printable(row.type)}]` : ''
  return [`${mark} ${index}${model}`, `${label}${type}`, ...rowMeta(row)].join(' · ')
}

export type CommandOutcome =
  | { kind: 'toggle' }
  | { kind: 'show' }
  | { kind: 'clear-log' }
  | { kind: 'set'; config: Config; message: string }
  | { kind: 'error'; message: string; usage?: true }

export const USAGE = [
  '/ultramodels                          opens or closes the pane',
  '/ultramodels <model> [effort]         model of every subagent: haiku, sonnet, opus, fable,',
  '                                      inherit, or an id containing "claude-"',
  '/ultramodels model <id> [effort]      any model id (Bedrock ARN, gateway…)',
  '/ultramodels effort <effort>          low, medium, high, xhigh, max or inherit',
  '/ultramodels on | off | status | reset | log clear | help',
].join('\n')

const INHERIT = new Set(['inherit', 'default'])

function parseModel(word: string | undefined): string | undefined {
  if (word === undefined) return undefined
  const lower = word.toLowerCase()
  if (INHERIT.has(lower)) return 'inherit'
  if (MODELS.some(one => one.alias === lower)) return lower
  if (/^[a-z0-9][\w.:@/\[\]-]*$/i.test(word) && /claude-|anthropic\./i.test(word)) return word
  return undefined
}

function parseAnyModel(word: string | undefined): string | undefined {
  if (word === undefined) return undefined
  return parseModel(word) ?? (/^[a-z0-9][\w.:@/\[\]+-]*$/i.test(word) ? word : undefined)
}

function parseEffort(word: string | undefined): EffortChoice | undefined {
  if (word === undefined) return undefined
  const lower = word.toLowerCase()
  if (INHERIT.has(lower)) return 'inherit'
  return isEffort(lower) ? lower : undefined
}

/** Splits on spaces, keeping "quoted words" together. */
export function tokenize(text: string): string[] {
  const words: string[] = []
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    words.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return words
}

export function runCommand(config: Config, args: string): CommandOutcome {
  const [head, ...rest] = tokenize(args.trim())
  const verb = head?.toLowerCase()
  const set = (next: Config, message: string): CommandOutcome => ({ kind: 'set', config: next, message })
  const error = (message: string): CommandOutcome => ({ kind: 'error', message })

  if (verb === undefined) return { kind: 'toggle' }
  if (verb === 'status' || verb === 'show') return { kind: 'show' }
  if (verb === 'help') return { kind: 'error', message: 'Usage:', usage: true }
  if (verb === 'on') return set({ ...config, enabled: true }, 'Mod turned on.')
  if (verb === 'off') {
    return set({ ...config, enabled: false }, 'Mod turned off: subagents keep the models Claude Code gives them.')
  }
  if (verb === 'reset') return set({ ...DEFAULT_CONFIG }, 'Settings reset: everything is inherited.')
  if (verb === 'log' && rest[0]?.toLowerCase() === 'clear') return { kind: 'clear-log' }

  if (verb === 'effort') {
    const effort = parseEffort(rest[0])
    return effort === undefined
      ? error(`Unknown effort: ${code(rest[0] ?? '')}. Values: ${EFFORTS.join(', ')} or inherit.`)
      : set({ ...config, effort }, `Effort of every subagent: ${effortLabel(effort)}.`)
  }

  const explicit = verb === 'model'
  const modelWord = explicit ? rest[0] : head
  const model = explicit ? parseAnyModel(modelWord) : parseModel(modelWord)
  if (model !== undefined) {
    const effortWord = explicit ? rest[1] : rest[0]
    const effort = effortWord === undefined ? config.effort : parseEffort(effortWord)
    if (effort === undefined) return error(`Unknown effort: ${code(effortWord ?? '')}. Values: ${EFFORTS.join(', ')} or inherit.`)
    return set({ ...config, enabled: true, model, effort }, `Every subagent: ${modelLabel(model)} · effort ${effortLabel(effort)}.`)
  }

  if (explicit || (head !== undefined && /[-:/.@]/.test(head))) {
    return error(`Unknown model: ${code(modelWord ?? '')}. For an id without "claude-", type /ultramodels model <id>.`)
  }
  return { kind: 'error', message: `Unknown command: ${code(head ?? '')}.`, usage: true }
}
