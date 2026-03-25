import path from "node:path"
import type { MinimalOpenCodeClient, AgentTriggersPluginOptions, CronTriggerConfig, DiscoveredAgent, TriggerSyncResult, WebhookDispatchResult, WebhookTriggerConfig, CronTriggerRecord, EventListenerRecord } from "./types.js"
import { CronClient } from "./cron-client.js"
import { CronManager } from "./cron-manager.js"
import { CronStore } from "./cron-store.js"
import { ListenerStore } from "./listener-store.js"
import { discoverAgentsWithTriggers } from "./parser.js"
import { WebhookTriggerServer, type WebhookRoute } from "./webhook-server.js"

const KORTIX_MASTER_URL = "http://localhost:8000"

function parseModel(modelId?: string): { providerID: string; modelID: string } | undefined {
  if (!modelId) return undefined
  const [providerID, ...rest] = modelId.split("/")
  if (!providerID || rest.length === 0) return { providerID: "kortix", modelID: modelId }
  return { providerID, modelID: rest.join("/") }
}

function getPathValue(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[part]
  }, input)
}

function renderPrompt(template: string, values: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => {
    const value = values[key]
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    return JSON.stringify(value)
  })
}

export class TriggerManager {
  private readonly cronClient: CronClient
  private readonly cronManager: CronManager
  private readonly webhookServer: WebhookTriggerServer
  private readonly listenerStore: ListenerStore
  private discovered: DiscoveredAgent[] = []
  private readonly reusedSessions = new Map<string, string>()
  private started = false

  constructor(
    private readonly client: MinimalOpenCodeClient,
    private readonly options: AgentTriggersPluginOptions = {},
  ) {
    const host = options.webhookHost ?? "0.0.0.0"
    const port = options.webhookPort ?? 8099
    const statePath = options.cronStatePath
      ?? path.join(options.directory ?? process.cwd(), ".opencode", "agent-triggers", "cron-state.json")
    const listenerStatePath = options.listenerStatePath
      ?? path.join(options.directory ?? process.cwd(), ".opencode", "agent-triggers", "listener-state.json")
    const cronStore = new CronStore(statePath)
    this.cronManager = new CronManager(cronStore, (trigger, event) => this.dispatchCron(trigger, event))
    this.cronClient = new CronClient(this.cronManager)
    this.listenerStore = new ListenerStore(listenerStatePath)
    this.webhookServer = new WebhookTriggerServer(host, port, (route, payload) => this.dispatchWebhook(route, payload))
    this.webhookServer.setPipedreamHandler((listenerId, payload) => this.dispatchPipedreamEvent(listenerId, payload))
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.logger?.(level, message)
  }

  public getPublicBaseUrl(): string {
    return this.options.publicBaseUrl ?? `http://localhost:${this.options.webhookPort ?? 8099}`
  }

  public async start(): Promise<TriggerSyncResult> {
    if (!this.started) {
      this.cronManager.start()
      await this.webhookServer.start()
      this.started = true
    }
    try {
      return await this.sync()
    } catch (err) {
      // Don't let agent-markdown parse errors prevent the plugin from loading.
      // The webhook server and cron scheduler are already running — tools should
      // still be available for manual listener management.
      this.log("error", `[agent-triggers] Initial sync failed (tools still available): ${err instanceof Error ? err.message : String(err)}`)
      return {
        discoveredAgents: 0,
        cronRegistered: 0,
        cronUpdated: 0,
        cronRemoved: 0,
        webhookRegistered: 0,
        pipedreamDeployed: 0,
        pipedreamUpdated: 0,
        pipedreamRemoved: 0,
        details: [`Initial sync error: ${err instanceof Error ? err.message : String(err)}`],
      }
    }
  }

  public async stop(): Promise<void> {
    this.cronManager.stop()
    await this.webhookServer.stop()
    this.started = false
  }

  public discover(): DiscoveredAgent[] {
    try {
      this.discovered = discoverAgentsWithTriggers(this.options)
    } catch (err) {
      this.log("error", `[agent-triggers] Agent discovery failed: ${err instanceof Error ? err.message : String(err)}`)
      this.discovered = []
    }
    return this.discovered
  }

  // ─── Webhook dispatch (existing) ────────────────────────────────────────────

  private buildExecutionText(route: WebhookRoute, payload: { body: string; headers: Record<string, string>; method: string; path: string }): string {
    const parsedBody = (() => {
      try {
        return JSON.parse(payload.body)
      } catch {
        return payload.body
      }
    })()
    const event = {
      type: "webhook.request",
      trigger: route.trigger.name,
      agent: route.agentName,
      data: {
        method: payload.method,
        path: payload.path,
        headers: payload.headers,
        body: parsedBody,
      },
    }

    const extracted: Record<string, unknown> = {}
    for (const [key, path] of Object.entries(route.trigger.context?.extract ?? {})) {
      extracted[key] = getPathValue(event, path)
    }

    const sections = [renderPrompt(route.trigger.execution.prompt, extracted)]
    if (Object.keys(extracted).length > 0) {
      sections.push("", "<trigger_context_values>", JSON.stringify(extracted, null, 2), "</trigger_context_values>")
    }
    if (route.trigger.context?.includeRaw !== false) {
      sections.push("", "<trigger_event>", JSON.stringify(event, null, 2), "</trigger_event>")
    }
    return sections.join("\n")
  }

  private buildCronExecutionText(trigger: CronTriggerRecord, event: { type: "cron.tick"; manual: boolean; timestamp: string }): string {
    const normalizedEvent = {
      type: event.type,
      trigger: trigger.name,
      data: {
        timestamp: event.timestamp,
        manual: event.manual,
      },
    }
    return [
      trigger.prompt,
      "",
      "<trigger_event>",
      JSON.stringify(normalizedEvent, null, 2),
      "</trigger_event>",
    ].join("\n")
  }

  private async dispatchCron(trigger: CronTriggerRecord, event: { type: "cron.tick"; manual: boolean; timestamp: string }): Promise<{ sessionId: string; response: { accepted: true } }> {
    const reuseKey = `${trigger.name}`
    let sessionId = trigger.session_mode === "reuse" ? this.reusedSessions.get(reuseKey) ?? trigger.session_id ?? undefined : undefined

    if (!sessionId) {
      const created = await this.client.session.create({
        body: {
          directory: this.options.directory,
          title: trigger.name,
        },
      }) as { data?: { id: string }; id?: string }
      sessionId = created.data?.id ?? created.id
      if (!sessionId) throw new Error("session.create did not return an id")
      if (trigger.session_mode === "reuse") this.reusedSessions.set(reuseKey, sessionId)
    }

    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: trigger.agent_name ?? undefined,
        model: parseModel(trigger.model_id),
        parts: [{ type: "text", text: this.buildCronExecutionText(trigger, event) }],
      },
    })

    return { sessionId, response: { accepted: true } }
  }

  private async dispatchWebhook(route: WebhookRoute, payload: { body: string; headers: Record<string, string>; method: string; path: string }): Promise<WebhookDispatchResult> {
    const reuseKey = `${route.agentName}:${route.trigger.name}`
    let sessionId = route.trigger.execution.sessionMode === "reuse" ? this.reusedSessions.get(reuseKey) : undefined

    if (!sessionId) {
      const created = await this.client.session.create({
        body: {
          directory: this.options.directory,
          title: `${route.agentName}:${route.trigger.name}`,
        },
      }) as { data?: { id: string }; id?: string }
      sessionId = created.data?.id ?? created.id
      if (!sessionId) throw new Error("session.create did not return an id")
      if (route.trigger.execution.sessionMode === "reuse") this.reusedSessions.set(reuseKey, sessionId)
    }

    const bodyText = this.buildExecutionText(route, payload)

    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: route.trigger.execution.agentName ?? route.agentName,
        model: parseModel(route.trigger.execution.modelId),
        parts: [{ type: "text", text: bodyText }],
      },
    })

    return { sessionId }
  }

  // ─── Pipedream event dispatch ───────────────────────────────────────────────

  private async dispatchPipedreamEvent(listenerId: string, payload: { body: string; headers: Record<string, string> }): Promise<{ sessionId: string } | { error: string; status: number }> {
    const listener = this.listenerStore.get(listenerId)
    if (!listener) {
      return { error: `Unknown listener: ${listenerId}`, status: 404 }
    }
    if (!listener.isActive) {
      return { error: `Listener is paused: ${listenerId}`, status: 403 }
    }

    const parsedBody = (() => {
      try {
        return JSON.parse(payload.body)
      } catch {
        return payload.body
      }
    })()

    const event = {
      type: "pipedream.event",
      trigger: listener.name,
      agent: listener.agentName,
      app: listener.app,
      componentKey: listener.componentKey,
      data: parsedBody,
    }

    // Extract context values
    const extracted: Record<string, unknown> = {}
    if (listener.context?.extract) {
      for (const [key, extractPath] of Object.entries(listener.context.extract)) {
        extracted[key] = getPathValue(event, extractPath as string)
      }
    }

    // Build prompt
    const sections = [renderPrompt(listener.prompt, { ...extracted, ...flattenEventData(parsedBody) })]
    if (Object.keys(extracted).length > 0) {
      sections.push("", "<trigger_context_values>", JSON.stringify(extracted, null, 2), "</trigger_context_values>")
    }
    sections.push("", "<trigger_event>", JSON.stringify(event, null, 2), "</trigger_event>")
    const promptText = sections.join("\n")

    // Create or reuse session
    const reuseKey = `pipedream:${listener.agentName}:${listener.name}`
    let sessionId = listener.sessionMode === "reuse" ? this.reusedSessions.get(reuseKey) : undefined

    if (!sessionId) {
      const created = await this.client.session.create({
        body: {
          directory: this.options.directory,
          title: `${listener.agentName}:${listener.name}`,
        },
      }) as { data?: { id: string }; id?: string }
      sessionId = created.data?.id ?? created.id
      if (!sessionId) throw new Error("session.create did not return an id")
      if (listener.sessionMode === "reuse") this.reusedSessions.set(reuseKey, sessionId)
    }

    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: listener.executionAgentName ?? listener.agentName,
        model: parseModel(listener.modelId),
        parts: [{ type: "text", text: promptText }],
      },
    })

    // Record event
    this.listenerStore.recordEvent(listenerId)
    this.log("info", `[agent-triggers] Pipedream event dispatched: listener=${listener.name} agent=${listener.agentName} session=${sessionId}`)

    return { sessionId }
  }

  // ─── Listener management (for the event_triggers tool) ──────────────────────

  /**
   * List available triggers for an app by calling kortix-master → kortix-api → Pipedream.
   */
  public async listAvailableTriggers(app: string, query?: string): Promise<unknown> {
    const params = new URLSearchParams({ app })
    if (query) params.set("q", query)
    const res = await fetch(`${KORTIX_MASTER_URL}/api/integrations/triggers/available?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to list triggers (${res.status}): ${text}`)
    }
    return res.json()
  }

  /**
   * Deploy a new event listener.
   * 1. Pre-create listener record (get stable ID)
   * 2. Deploy trigger with webhook URL using that ID
   * 3. Update record with Pipedream's deployedTriggerId
   */
  public async setupListener(options: {
    name: string
    agentName: string
    app: string
    componentKey: string
    configuredProps?: Record<string, unknown>
    prompt: string
    context?: { extract?: Record<string, string>; includeRaw?: boolean }
    sessionMode?: "new" | "reuse"
    executionAgentName?: string
    modelId?: string
  }): Promise<EventListenerRecord> {
    // Step 1: Pre-create listener record to get a stable ID
    const record = this.listenerStore.create({
      name: options.name,
      agentName: options.agentName,
      app: options.app,
      componentKey: options.componentKey,
      deployedTriggerId: "pending", // will be updated after deploy
      configuredProps: options.configuredProps,
      prompt: options.prompt,
      context: options.context ? { extract: options.context.extract, includeRaw: options.context.includeRaw } : undefined,
      sessionMode: options.sessionMode,
      executionAgentName: options.executionAgentName,
      modelId: options.modelId,
      isActive: false, // will be activated after successful deploy
      source: "manual",
      externalUserId: "",
      webhookUrl: "", // will be updated
      lastEventAt: null,
    })

    // Step 2: Build webhook URL with the record's ID
    const webhookUrl = this.buildPipedreamWebhookUrl(record.id)

    // Step 3: Deploy via kortix-master → kortix-api → Pipedream
    let deployResult: { deployedTriggerId: string; active: boolean }
    try {
      const res = await fetch(`${KORTIX_MASTER_URL}/api/integrations/triggers/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: options.app,
          component_key: options.componentKey,
          configured_props: options.configuredProps ?? {},
          webhook_url: webhookUrl,
        }),
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        // Clean up the pre-created record
        this.listenerStore.delete(record.id)
        const text = await res.text()
        throw new Error(`Failed to deploy trigger (${res.status}): ${text}`)
      }

      deployResult = (await res.json()) as { deployedTriggerId: string; active: boolean }
    } catch (err) {
      // Clean up the pre-created record on any error
      this.listenerStore.delete(record.id)
      throw err
    }

    // Step 4: Update record with deploy result
    const updated = this.listenerStore.update(record.id, {
      deployedTriggerId: deployResult.deployedTriggerId,
      isActive: true,
      webhookUrl,
    })

    this.log("info", `[agent-triggers] Listener created: ${options.name} app=${options.app} trigger=${options.componentKey} id=${record.id}`)
    return updated!
  }

  /**
   * Remove a listener. Calls Pipedream to delete the deployed trigger, then removes local state.
   */
  public async removeListener(listenerId: string): Promise<boolean> {
    const listener = this.listenerStore.get(listenerId)
      ?? this.listenerStore.list().find((l: EventListenerRecord) => l.name === listenerId)
    if (!listener) return false

    // Delete from Pipedream via kortix-master
    if (listener.deployedTriggerId && listener.deployedTriggerId !== "pending") {
      try {
        await fetch(`${KORTIX_MASTER_URL}/api/integrations/triggers/deployed/${listener.deployedTriggerId}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(15_000),
        })
      } catch (err) {
        this.log("warn", `[agent-triggers] Failed to delete Pipedream trigger ${listener.deployedTriggerId}: ${err}`)
      }
    }

    this.listenerStore.delete(listener.id)
    this.log("info", `[agent-triggers] Listener removed: ${listener.name} id=${listener.id}`)
    return true
  }

  /**
   * Pause a listener.
   */
  public async pauseListener(listenerId: string): Promise<EventListenerRecord | null> {
    const listener = this.listenerStore.get(listenerId)
    if (!listener) return null

    if (listener.deployedTriggerId && listener.deployedTriggerId !== "pending") {
      try {
        await fetch(`${KORTIX_MASTER_URL}/api/integrations/triggers/deployed/${listener.deployedTriggerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: false }),
          signal: AbortSignal.timeout(15_000),
        })
      } catch (err) {
        this.log("warn", `[agent-triggers] Failed to pause Pipedream trigger ${listener.deployedTriggerId}: ${err}`)
      }
    }

    return this.listenerStore.update(listenerId, { isActive: false })
  }

  /**
   * Resume a listener.
   */
  public async resumeListener(listenerId: string): Promise<EventListenerRecord | null> {
    const listener = this.listenerStore.get(listenerId)
    if (!listener) return null

    if (listener.deployedTriggerId && listener.deployedTriggerId !== "pending") {
      try {
        await fetch(`${KORTIX_MASTER_URL}/api/integrations/triggers/deployed/${listener.deployedTriggerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: true }),
          signal: AbortSignal.timeout(15_000),
        })
      } catch (err) {
        this.log("warn", `[agent-triggers] Failed to resume Pipedream trigger ${listener.deployedTriggerId}: ${err}`)
      }
    }

    return this.listenerStore.update(listenerId, { isActive: true })
  }

  /**
   * List all active listeners.
   */
  public listListeners(filter?: { agentName?: string; app?: string }): EventListenerRecord[] {
    return this.listenerStore.list(filter)
  }

  /**
   * Get a single listener.
   */
  public getListener(listenerId: string): EventListenerRecord | null {
    return this.listenerStore.get(listenerId)
  }

  /**
   * Build the public webhook URL that Pipedream will POST events to.
   * Goes through: Internet → kortix-api proxy → kortix-master → port 8099
   * From inside the sandbox, the webhook server on port 8099 handles it directly.
   * But we need the PUBLIC URL for Pipedream. The kortix-master route at
   * /events/pipedream/:listenerId forwards to port 8099.
   * The actual public URL depends on the deployment — see publicBaseUrl option.
   */
  private buildPipedreamWebhookUrl(listenerId: string): string {
    // For local dev, Pipedream can't reach localhost, so we use the publicBaseUrl.
    // In production, the sandbox is reachable via the proxy.
    // The format: {publicBaseUrl}/events/pipedream/{listenerId}
    // publicBaseUrl should be something like https://p8000-{sandboxId}.kortix.cloud
    const base = this.options.publicBaseUrl ?? `http://localhost:${this.options.webhookPort ?? 8099}`
    return `${base}/events/pipedream/${listenerId}`
  }

  // ─── Sync (cron + webhook) ──────────────────────────────────────────────────

  private async syncCronTriggers(agents: DiscoveredAgent[], details: string[]): Promise<{ registered: number; updated: number; removed: number }> {
    const existing = await this.cronClient.list()
    const desired = new Map<string, { agentName: string; trigger: CronTriggerConfig }>()

    for (const agent of agents) {
      for (const trigger of agent.triggers) {
        if (trigger.source.type !== "cron" || trigger.enabled === false) continue
        desired.set(`${agent.name}:${trigger.name}`, { agentName: agent.name, trigger: trigger as CronTriggerConfig })
      }
    }

    let registered = 0
    let updated = 0
    let removed = 0
    const existingByName = new Map(existing.map((item) => [item.name, item]))

    for (const [name, config] of desired.entries()) {
      const source = `agent:${config.agentName}`
      const current = existingByName.get(name)
      if (!current) {
        await this.cronClient.create(name, config.trigger, source)
        registered++
        details.push(`registered cron ${name}`)
        continue
      }
      if (
        current.cron_expr !== config.trigger.source.expr ||
        current.prompt !== config.trigger.execution.prompt ||
        (current.timezone ?? "") !== (config.trigger.source.timezone ?? "") ||
        (current.session_mode ?? "") !== (config.trigger.execution.sessionMode ?? "") ||
        (current.model_id ?? "") !== (config.trigger.execution.modelId ?? "")
      ) {
        const id = current.id ?? name
        await this.cronClient.update(id, { ...config.trigger, name }, source)
        updated++
        details.push(`updated cron ${name}`)
      }
    }

    for (const item of existing) {
      if (!item.name.includes(":")) continue
      if (item.source && !String(item.source).startsWith("agent:")) continue
      if (!desired.has(item.name)) {
        const id = item.id ?? item.name
        await this.cronClient.remove(id)
        removed++
        details.push(`removed stale cron ${item.name}`)
      }
    }

    return { registered, updated, removed }
  }

  private syncWebhookRoutes(agents: DiscoveredAgent[]): number {
    const routes: WebhookRoute[] = []
    for (const agent of agents) {
      for (const trigger of agent.triggers) {
        if (trigger.source.type !== "webhook" || trigger.enabled === false) continue
        const webhookTrigger = trigger as WebhookTriggerConfig
        // Namespace webhook path with agent name to prevent collisions.
        // e.g. agent "ops" with path "/inbound" → "/ops/inbound"
        const rawPath = webhookTrigger.source.path
        const prefixed = rawPath.startsWith(`/${agent.name}/`) || rawPath === `/${agent.name}`
          ? rawPath
          : `/${agent.name}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`
        const namespacedTrigger: WebhookTriggerConfig = {
          ...webhookTrigger,
          source: { ...webhookTrigger.source, path: prefixed },
        }
        routes.push({ agentName: agent.name, trigger: namespacedTrigger })
      }
    }
    this.webhookServer.setRoutes(routes)
    return routes.length
  }

  public async sync(): Promise<TriggerSyncResult> {
    const agents = this.discover()
    const details: string[] = []
    const cron = await this.syncCronTriggers(agents, details)
    const webhookRegistered = this.syncWebhookRoutes(agents)
    const listeners = this.listenerStore.list({ isActive: true })
    details.push(`registered ${webhookRegistered} webhook route(s)`)
    details.push(`${listeners.length} active Pipedream listener(s)`)
    this.log("info", `[agent-triggers] sync complete: ${cron.registered} cron created, ${cron.updated} cron updated, ${cron.removed} cron removed, ${webhookRegistered} webhooks, ${listeners.length} Pipedream listeners`)
    return {
      discoveredAgents: agents.length,
      cronRegistered: cron.registered,
      cronUpdated: cron.updated,
      cronRemoved: cron.removed,
      webhookRegistered,
      pipedreamDeployed: 0, // only reflects this sync cycle
      pipedreamUpdated: 0,
      pipedreamRemoved: 0,
      details,
    }
  }

  public async listState(): Promise<{ agents: DiscoveredAgent[]; cron: Awaited<ReturnType<CronClient["list"]>>; listeners: EventListenerRecord[]; publicBaseUrl: string }> {
    return {
      agents: this.discover(),
      cron: await this.cronClient.list(),
      listeners: this.listenerStore.list(),
      publicBaseUrl: this.getPublicBaseUrl(),
    }
  }

  public getCronClient(): CronClient {
    return this.cronClient
  }

  public getListenerStore(): ListenerStore {
    return this.listenerStore
  }
}

/** Flatten top-level keys from event data for prompt template variables */
function flattenEventData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    flat[key] = value
  }
  return flat
}
