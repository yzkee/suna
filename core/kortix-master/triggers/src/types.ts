export type TriggerKind = "cron" | "webhook" | "pipedream"

export interface TriggerExecutionConfig {
  prompt: string
  agentName?: string
  modelId?: string
  sessionMode?: "new" | "reuse"
}

export interface TriggerContextConfig {
  extract?: Record<string, string>
  includeRaw?: boolean
}

export interface TriggerBase {
  name: string
  enabled?: boolean
  execution: TriggerExecutionConfig
  context?: TriggerContextConfig
}

export interface CronSourceConfig {
  type: "cron"
  expr: string
  timezone?: string
}

export interface CronTriggerConfig extends TriggerBase {
  source: CronSourceConfig
}

export interface WebhookSourceConfig {
  type: "webhook"
  path: string
  method?: string
  secret?: string
}

export interface PipedreamSourceConfig {
  type: "pipedream"
  /** Pipedream trigger component key, e.g. "github-new-pull-request" */
  componentKey: string
  /** App slug, e.g. "github", "gmail", "slack" */
  app: string
  /** Component-specific configuration props */
  configuredProps?: Record<string, unknown>
}

export interface WebhookTriggerConfig extends TriggerBase {
  source: WebhookSourceConfig
}

export interface PipedreamTriggerConfig extends TriggerBase {
  source: PipedreamSourceConfig
}

export type AgentTriggerConfig = CronTriggerConfig | WebhookTriggerConfig | PipedreamTriggerConfig

export interface DiscoveredAgent {
  name: string
  filePath: string
  triggers: AgentTriggerConfig[]
}

export interface CronTriggerRecord {
  id?: string
  name: string
  cron_expr: string
  prompt: string
  timezone?: string
  agent_name?: string | null
  model_id?: string
  source?: string
  session_mode?: string
  is_active?: boolean
  last_run_at?: string | null
  next_run_at?: string | null
  session_id?: string | null
  metadata?: Record<string, unknown>
}

export type CronExecutionStatus = "running" | "completed" | "failed" | "skipped"

export interface CronExecutionRecord {
  execution_id: string
  trigger_id: string
  status: CronExecutionStatus
  session_id?: string | null
  error_message?: string | null
  retry_count: number
  metadata: Record<string, unknown>
  created_at: string
  started_at: string
  completed_at?: string | null
  duration_ms?: number | null
}

export interface TriggerSyncResult {
  discoveredAgents: number
  cronRegistered: number
  cronUpdated: number
  cronRemoved: number
  webhookRegistered: number
  pipedreamDeployed: number
  pipedreamUpdated: number
  pipedreamRemoved: number
  details: string[]
}

export interface AgentTriggersPluginOptions {
  agentPaths?: string[]
  listenerStatePath?: string
  webhookPort?: number
  webhookHost?: string
  publicBaseUrl?: string
  autoSync?: boolean
  syncDelayMs?: number
  directory?: string
  homeDir?: string
  logger?: (level: "info" | "warn" | "error", message: string) => void
}

export interface MinimalOpenCodeClient {
  app?: {
    log?: (input: { body: { service: string; level: string; message: string } }) => Promise<unknown>
  }
  session: {
    create: (parameters?: { body?: { directory?: string; title?: string } }) => Promise<{ data?: { id: string } } | { id: string }>
    promptAsync: (parameters: {
      path?: { id: string }
      body?: {
        agent?: string
        model?: { providerID: string; modelID: string }
        parts: Array<{ type: "text"; text: string }>
      }
    }) => Promise<unknown>
  }
}

export interface PluginContextShape {
  client: MinimalOpenCodeClient
  directory?: string
}

export interface WebhookDispatchResult {
  sessionId: string
}

/** Persisted record for an active Pipedream event listener */
export interface EventListenerRecord {
  /** Internal listener ID (UUID) */
  id: string
  /** Human-readable name */
  name: string
  /** Agent that receives events */
  agentName: string
  /** Pipedream app slug */
  app: string
  /** Pipedream trigger component key */
  componentKey: string
  /** Pipedream deployed trigger ID (dc_xxx, hi_xxx, etc.) */
  deployedTriggerId: string
  /** Configured props passed to Pipedream */
  configuredProps?: Record<string, unknown>
  /** Prompt template with {{ var }} placeholders */
  prompt: string
  /** Context extraction config */
  context?: TriggerContextConfig
  /** Session mode */
  sessionMode?: "new" | "reuse"
  /** Override agent name for execution */
  executionAgentName?: string
  /** Override model ID for execution */
  modelId?: string
  /** Whether listener is active */
  isActive: boolean
  /** Source: "manual" (tool call) or "agent:<name>" (markdown) */
  source: string
  /** External user ID used with Pipedream */
  externalUserId: string
  /** Webhook URL registered with Pipedream */
  webhookUrl: string
  /** ISO timestamp */
  createdAt: string
  /** ISO timestamp */
  updatedAt: string
  /** Last event received ISO timestamp */
  lastEventAt?: string | null
  /** Total events received */
  eventCount: number
}
