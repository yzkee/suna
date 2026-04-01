import { tool, type Plugin } from "@opencode-ai/plugin"
import { TriggerManager } from "./trigger-manager.js"
import type { AgentTriggersPluginOptions, PluginContextShape } from "./types.js"

function createLogger(client: PluginContextShape["client"], fallback?: AgentTriggersPluginOptions["logger"]) {
  return (level: "info" | "warn" | "error", message: string) => {
    fallback?.(level, message)
    try {
      client.app?.log?.({ body: { service: "opencode-agent-triggers", level, message } }).catch(() => undefined)
    } catch {
      // ignore log errors
    }
  }
}

export function createAgentTriggersPlugin(options: AgentTriggersPluginOptions = {}): Plugin {
  const plugin: Plugin = async (ctx) => {
    const shaped = ctx as unknown as PluginContextShape
    const logger = createLogger(shaped.client, options.logger)
    const manager = new TriggerManager(shaped.client, {
      ...options,
      directory: options.directory ?? shaped.directory,
      logger,
    })

    const autoSync = options.autoSync !== false
    if (autoSync) await manager.start()

    return {
      tool: {
        agent_triggers: tool({
          description: "List cron and webhook triggers defined directly in agent markdown files.",
          args: {},
          async execute() {
            const state = await manager.listState()
            const lines: string[] = [
              `=== AGENT TRIGGERS (${state.agents.length} agents) ===`,
              `Webhook base URL: ${state.publicBaseUrl}`,
              "",
            ]
            if (state.agents.length === 0) lines.push("No triggers discovered.")
            for (const agent of state.agents) {
              lines.push(`## ${agent.name} (${agent.filePath})`)
              for (const trigger of agent.triggers) {
                if (trigger.source.type === "cron") {
                  lines.push(`- [cron] ${trigger.name} | ${trigger.source.expr} | enabled=${trigger.enabled !== false}`)
                } else if (trigger.source.type === "webhook") {
                  const rawPath = trigger.source.path
                  const namespacedPath = rawPath.startsWith(`/${agent.name}/`) || rawPath === `/${agent.name}`
                    ? rawPath
                    : `/${agent.name}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`
                  lines.push(`- [webhook] ${trigger.name} | ${(trigger.source.method ?? "POST").toUpperCase()} ${state.publicBaseUrl}${namespacedPath} | enabled=${trigger.enabled !== false}`)
                }
              }
              lines.push("")
            }
            lines.push(`=== CRON BACKEND (${state.cron.length} registered) ===`)
            for (const item of state.cron) {
              lines.push(`- ${item.name} | ${item.cron_expr} | source=${item.source ?? "unknown"}`)
            }
            if (state.listeners.length > 0) {
              lines.push("")
              lines.push(`=== PIPEDREAM EVENT LISTENERS (${state.listeners.length}) ===`)
              for (const listener of state.listeners) {
                lines.push(`- [${listener.isActive ? "active" : "paused"}] ${listener.name} | ${listener.app}:${listener.componentKey} | agent=${listener.agentName} | events=${listener.eventCount}`)
              }
            }
            return lines.join("\n")
          },
        }),
        sync_agent_triggers: tool({
          description: "Re-read agent markdown files and sync cron/webhook triggers.",
          args: {},
          async execute() {
            const result = await manager.sync()
            return [
              `Discovered agents: ${result.discoveredAgents}`,
              `Cron registered: ${result.cronRegistered}`,
              `Cron updated: ${result.cronUpdated}`,
              `Cron removed: ${result.cronRemoved}`,
              `Webhook routes: ${result.webhookRegistered}`,
              "",
              ...result.details,
            ].join("\n")
          },
        }),
        cron_triggers: tool({
          description: "Manage scheduled cron triggers through the embedded opencode-agent-triggers scheduler. Actions: create, list, get, update, delete, pause, resume, run, executions.",
          args: {
            action: tool.schema.string(),
            trigger_id: tool.schema.string().optional(),
            name: tool.schema.string().optional(),
            cron_expr: tool.schema.string().optional(),
            prompt: tool.schema.string().optional(),
            timezone: tool.schema.string().optional(),
            agent_name: tool.schema.string().optional(),
            model_id: tool.schema.string().optional(),
            session_mode: tool.schema.string().optional(),
          },
          async execute(args) {
            const client = manager.getCronClient()
            switch (args.action) {
              case "list":
                return JSON.stringify(await client.list(), null, 2)
              case "create":
                if (!args.name || !args.cron_expr || !args.prompt) return "Error: name, cron_expr, and prompt are required."
                return JSON.stringify(await client.create(args.name, {
                  name: args.name,
                  source: {
                    type: "cron",
                    expr: args.cron_expr,
                    timezone: args.timezone,
                  },
                  execution: {
                    prompt: args.prompt,
                    agentName: args.agent_name,
                    modelId: args.model_id,
                    sessionMode: args.session_mode === "reuse" ? "reuse" : args.session_mode === "new" ? "new" : undefined,
                  },
                }, "manual"), null, 2)
              case "update":
                if (!args.trigger_id || !args.name || !args.cron_expr || !args.prompt) return "Error: trigger_id, name, cron_expr, and prompt are required."
                return JSON.stringify(await client.update(args.trigger_id, {
                  name: args.name,
                  source: {
                    type: "cron",
                    expr: args.cron_expr,
                    timezone: args.timezone,
                  },
                  execution: {
                    prompt: args.prompt,
                    agentName: args.agent_name,
                    modelId: args.model_id,
                    sessionMode: args.session_mode === "reuse" ? "reuse" : args.session_mode === "new" ? "new" : undefined,
                  },
                }, "manual"), null, 2)
              case "delete":
                if (!args.trigger_id) return "Error: trigger_id is required."
                return JSON.stringify(await client.remove(args.trigger_id), null, 2)
              case "pause":
                if (!args.trigger_id) return "Error: trigger_id is required."
                return JSON.stringify(await client.pause(args.trigger_id), null, 2)
              case "resume":
                if (!args.trigger_id) return "Error: trigger_id is required."
                return JSON.stringify(await client.resume(args.trigger_id), null, 2)
              case "run":
                if (!args.trigger_id) return "Error: trigger_id is required."
                return JSON.stringify(await client.run(args.trigger_id), null, 2)
              case "executions":
                if (!args.trigger_id) return "Error: trigger_id is required."
                return JSON.stringify(await client.executions(args.trigger_id), null, 2)
              case "get": {
                if (!args.trigger_id) return "Error: trigger_id is required."
                const items = await client.list()
                return JSON.stringify(items.find((item) => item.id === args.trigger_id || item.name === args.trigger_id) ?? null, null, 2)
              }
              default:
                return "Error: Unknown action. Use create, list, get, update, delete, pause, resume, run, executions."
            }
          },
        }),
        event_triggers: tool({
          description: `Manage Pipedream event-based triggers that automatically fire agent sessions when external events occur (e.g. new email, GitHub PR, Slack message).

HOW IT WORKS: Triggers run on Pipedream's infrastructure (not in the sandbox). Pipedream polls/watches the connected app and POSTs events to the sandbox webhook. A new agent session is created with the event payload.

PREREQUISITES: (1) App must be connected via OAuth (check with integration-list). (2) SANDBOX_PUBLIC_URL must be set so Pipedream can reach the sandbox.

ACTIONS:
- list_available: List trigger components for an app. Requires: app. Optional: query.
- setup: Deploy a new event listener. Requires: name, app, component_key, prompt. Optional: configured_props (JSON string), agent_name, model_id, session_mode.
- list: List all listeners. Optional: agent_name, app.
- get: Get listener details. Requires: listener_id.
- remove: Delete listener and its Pipedream trigger. Requires: listener_id.
- pause: Stop receiving events. Requires: listener_id.
- resume: Resume receiving events. Requires: listener_id.

PROMPT TEMPLATE: Use {{ key }} for top-level event fields (e.g. {{ subject }}, {{ from }}). The full raw event is always appended as <trigger_event> XML.

EXAMPLE (Gmail):
  1. event_triggers action=list_available app=gmail
  2. event_triggers action=setup name="New Email" app=gmail component_key=gmail-new-email-received prompt="New email from {{ from }}: {{ subject }}" configured_props='{"withTextPayload":true,"timer":{"intervalSeconds":60}}'`,
          args: {
            action: tool.schema.string(),
            app: tool.schema.string().optional(),
            query: tool.schema.string().optional(),
            name: tool.schema.string().optional(),
            component_key: tool.schema.string().optional(),
            configured_props: tool.schema.string().optional(),
            prompt: tool.schema.string().optional(),
            agent_name: tool.schema.string().optional(),
            model_id: tool.schema.string().optional(),
            session_mode: tool.schema.string().optional(),
            listener_id: tool.schema.string().optional(),
          },
          async execute(args) {
            try {
              switch (args.action) {
                case "list_available": {
                  if (!args.app) return "Error: app is required (e.g. 'github', 'gmail', 'slack')."
                  const result = await manager.listAvailableTriggers(args.app, args.query ?? undefined)
                  return JSON.stringify(result, null, 2)
                }
                case "setup": {
                  if (!args.name || !args.app || !args.component_key || !args.prompt) {
                    return "Error: name, app, component_key, and prompt are required."
                  }
                  let configuredProps: Record<string, unknown> = {}
                  if (args.configured_props) {
                    try {
                      configuredProps = JSON.parse(args.configured_props)
                    } catch {
                      return "Error: configured_props must be valid JSON."
                    }
                  }
                  const record = await manager.setupListener({
                    name: args.name,
                    agentName: args.agent_name ?? "kortix",
                    app: args.app,
                    componentKey: args.component_key,
                    configuredProps,
                    prompt: args.prompt,
                    sessionMode: args.session_mode === "reuse" ? "reuse" : "new",
                    executionAgentName: args.agent_name,
                    modelId: args.model_id,
                  })
                  return `Listener created successfully!\n${JSON.stringify(record, null, 2)}`
                }
                case "list": {
                  const listeners = manager.listListeners({
                    agentName: args.agent_name,
                    app: args.app,
                  })
                  if (listeners.length === 0) return "No event listeners configured."
                  const lines = [`=== EVENT LISTENERS (${listeners.length}) ===`, ""]
                  for (const l of listeners) {
                    lines.push(
                      `ID: ${l.id}`,
                      `Name: ${l.name}`,
                      `App: ${l.app} | Trigger: ${l.componentKey}`,
                      `Agent: ${l.agentName} | Status: ${l.isActive ? "active" : "paused"}`,
                      `Events: ${l.eventCount} | Last: ${l.lastEventAt ?? "never"}`,
                      `Created: ${l.createdAt}`,
                      "",
                    )
                  }
                  return lines.join("\n")
                }
                case "get": {
                  if (!args.listener_id) return "Error: listener_id is required."
                  const listener = manager.getListener(args.listener_id)
                  if (!listener) return `Error: Listener not found: ${args.listener_id}`
                  return JSON.stringify(listener, null, 2)
                }
                case "remove": {
                  if (!args.listener_id) return "Error: listener_id is required."
                  const removed = await manager.removeListener(args.listener_id)
                  return removed ? "Listener removed successfully." : `Error: Listener not found: ${args.listener_id}`
                }
                case "pause": {
                  if (!args.listener_id) return "Error: listener_id is required."
                  const paused = await manager.pauseListener(args.listener_id)
                  return paused ? `Listener paused: ${paused.name}` : `Error: Listener not found: ${args.listener_id}`
                }
                case "resume": {
                  if (!args.listener_id) return "Error: listener_id is required."
                  const resumed = await manager.resumeListener(args.listener_id)
                  return resumed ? `Listener resumed: ${resumed.name}` : `Error: Listener not found: ${args.listener_id}`
                }
                default:
                  return "Error: Unknown action. Use list_available, setup, list, get, remove, pause, resume."
              }
            } catch (err) {
              return `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          },
        }),
      },
    }
  }
  return plugin
}

export default createAgentTriggersPlugin
