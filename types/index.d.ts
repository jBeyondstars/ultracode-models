export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** An effort level, or `inherit` to leave the engine's. */
export type EffortChoice = 'inherit' | Effort

/** `haiku`, `sonnet`, `opus`, `fable`, a full model id, or `inherit`. */
export type ModelChoice = string

/** The one setting every subagent runs on. */
export type Config = {
  enabled: boolean
  model: ModelChoice
  effort: EffortChoice
}

/** What the mod does to one subagent's model requests, decided once at spawn. */
export type Plan = {
  /** A model choice (alias or id) sent in place of the engine's. */
  model?: ModelChoice
  /** An effort sent in place of the engine's. */
  effort?: Effort
}

/** One subagent the mod saw start, as the pane lists it. */
export type AgentRow = {
  agentId: string
  /** Its Workflow run, or '' outside one. */
  runId: string
  /** Its place among its run's agent() calls; 0 outside a workflow. */
  index: number
  label: string
  type: string
  /** The model its call asked for (the Agent tool's model, agent() opts.model), if any. */
  asked?: string
  /** The model core resolved for it at spawn. */
  from: string
  plan?: Plan
  /** Why it was or was not changed, as the pane shows it. */
  note: string
  /** The model and effort its first request was sent with. */
  sent?: string
  effort?: string
  /** The model the API reported answering. */
  answered?: string
  status: 'running' | 'done' | 'failed' | 'aborted'
  parentId?: string
  /** Tokens its finished turns used, as the API counted them. */
  tokens?: number
  /** When it started and last finished, in ms since the epoch. */
  startedAt?: number
  endedAt?: number
}

/** The session's subagents: how many, and the tokens each model answered with. */
export type Stats = {
  agents: number
  /** Tokens by model family (`claude-haiku-5-5`), as the API counted them. */
  tokens: Record<string, number>
  /**
   * How many of the tokens counted alongside (`total`) the prompt cache served (`read`).
   * Absent from totals an older version of the mod kept, which did not count it.
   */
  cache?: { read: number; total: number }
}

declare module 'claude-code' {
  interface PluginState {
    'ultracode-models': {
      config: Config
      agents: AgentRow[]
      stats: Stats
      /** The last settings note the model was given beside a prompt. */
      announced: string
    }
  }
}
