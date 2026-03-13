# Agent Triggers — Cron, Webhook & Event-Based Triggers

The `@kortix/opencode-agent-triggers` plugin enables agents to react to scheduled events (cron), inbound HTTP requests (webhooks), and external app events (Pipedream event triggers). All three types create new agent sessions automatically when triggered.

## Overview

| Type | How it works | Use case |
|---|---|---|
| **Cron** | Embedded scheduler runs inside the sandbox | Daily reports, hourly health checks, periodic tasks |
| **Webhook** | HTTP server on port 8099 receives POSTs | Custom integrations, CI/CD callbacks, internal automation |
| **Event (Pipedream)** | Pipedream watches external apps and POSTs events to sandbox | New email, GitHub PR, Slack message, Notion update |

## Tools

| Tool | Description |
|---|---|
| `agent_triggers` | List all triggers defined in agent.md files and their registration status |
| `sync_agent_triggers` | Re-sync triggers from agent.md files to the embedded scheduler and webhook runtime |
| `cron_triggers` | Manage cron triggers programmatically (create, list, update, delete, pause, resume, run, executions) |
| `event_triggers` | Manage Pipedream event-driven triggers (list_available, setup, list, get, remove, pause, resume) |

---

## Declarative Triggers (in Agent Markdown)

Add a `triggers` array to any agent's YAML frontmatter. The plugin parses these on startup and registers them automatically.

```yaml
---
description: "My Agent"
mode: primary
triggers:
  - name: "Daily Report"
    enabled: true
    source:
      type: "cron"
      expr: "0 0 9 * * *"
      timezone: "America/New_York"
    execution:
      prompt: "Generate the daily report"
      model_id: "kortix/power"
      session_mode: "reuse"
  - name: "Inbound Webhook"
    enabled: true
    source:
      type: "webhook"
      path: "/hooks/deploy"
      method: "POST"
      secret: "my-secret"
    execution:
      prompt: "Handle the deployment webhook"
      session_mode: "new"
---
```

### Trigger Properties

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Human-readable name (unique within agent) |
| `source.type` | Yes | `cron`, `webhook`, or `pipedream` |
| `source.expr` | Cron only | 6-field cron expression (second minute hour day month weekday) |
| `source.timezone` | No | IANA timezone (default: UTC) |
| `source.path` | Webhook only | HTTP endpoint path (e.g. `/hooks/deploy`) |
| `source.method` | Webhook only | HTTP method (default: POST) |
| `source.secret` | Webhook only | Shared secret — checked via `x-kortix-trigger-secret` header |
| `execution.prompt` | Yes | Prompt template sent to agent when triggered. Supports `{{ key }}` variables. |
| `execution.model_id` | No | Override model for triggered sessions |
| `execution.session_mode` | No | `new` (default) creates a fresh session. `reuse` reuses a single session per trigger. |
| `context.extract` | No | Map prompt template variables from event data (e.g. `title: "body.pull_request.title"`) |
| `context.include_raw` | No | Include the full raw event in the prompt |
| `enabled` | No | Set to `false` to disable without deleting |

### Prompt Templates

Prompts support `{{ key }}` substitution (Mustache-style). For cron triggers, no variables are available. For webhook and event triggers, top-level fields from the event payload are available.

The full raw event payload is **always appended** as `<trigger_event>` XML, regardless of the template.

---

## Cron Triggers

### How They Work

1. On plugin startup, the plugin reads all agent markdown files and syncs cron triggers to its embedded scheduler
2. Each cron trigger is registered with name `{agent_name}:{trigger_name}`
3. When a cron fires, a new session is created and the prompt is sent
4. Cron state persists at `/tmp/kortix-agent-triggers/cron-state.json`

### Cron Expression Format

6-field: `second minute hour day month weekday`

| Expression | Meaning |
|---|---|
| `0 0 9 * * *` | Every day at 9:00 AM |
| `0 0 * * * *` | Every hour |
| `0 */15 * * * *` | Every 15 minutes |
| `0 0 10 * * 1` | Every Monday at 10:00 AM |
| `0 30 9 1 * *` | 1st of every month at 9:30 AM |

### Programmatic Cron Management

Use the `cron_triggers` tool for runtime cron management:

```
cron_triggers action=create name="Nightly Cleanup" cron_expr="0 0 3 * * *" prompt="Run nightly cleanup tasks"
cron_triggers action=list
cron_triggers action=pause trigger_id="..."
cron_triggers action=resume trigger_id="..."
cron_triggers action=run trigger_id="..."       # Fire immediately
cron_triggers action=executions trigger_id="..."  # View execution history
cron_triggers action=delete trigger_id="..."
```

---

## Webhook Triggers

### How They Work

1. The plugin starts an HTTP server on port 8099 (inside the sandbox)
2. Webhook routes are registered from agent markdown trigger definitions
3. Inbound requests matching a route create agent sessions
4. Secret validation is optional — set `source.secret` and include `x-kortix-trigger-secret` header

### Accessing From Outside

Port 8099 is NOT exposed externally. Requests go through kortix-master on port 8000:
- From inside the sandbox: `curl http://localhost:8099/hooks/deploy`
- From outside: `curl https://p8000-{sandboxId}.kortix.cloud/hooks/deploy` (goes through kortix-master)

---

## Event-Based Triggers (Pipedream)

This is the most powerful trigger type. It connects to external apps (Gmail, GitHub, Slack, Notion, etc.) and fires agent sessions when events occur — without any polling from the sandbox.

### How It Works

**The trigger runs on Pipedream's servers, not in the sandbox.** The sandbox only receives events.

```
Setup (one-time):
  1. Agent calls event_triggers action=setup
  2. Plugin creates a local listener record (gets a UUID)
  3. Plugin calls Pipedream API via proxy chain:
     sandbox:8000 → kortix-api → Pipedream Connect API
  4. Pipedream deploys a polling worker on their infrastructure
  5. Pipedream is told: "POST events to {SANDBOX_PUBLIC_URL}/events/pipedream/{listenerId}"

When an event fires:
  1. External event occurs (e.g. new email in Gmail)
  2. Pipedream's worker detects it (polls every N seconds)
  3. Pipedream POSTs the event to our sandbox's public URL
  4. kortix-master receives it at /events/pipedream/{listenerId} (auth-exempt route)
  5. Forwards to webhook server on port 8099
  6. Webhook server looks up listener by UUID, builds prompt, calls OpenCode API
  7. New agent session is created with the event payload as prompt
```

### Prerequisites

1. **App must be connected**: User must have connected the app (e.g. Gmail) via Pipedream OAuth. Verify: `integration-list` tool or `GET /api/integrations/list`.
2. **KORTIX_TOKEN must be set**: Sandbox authenticates outbound requests to kortix-api. Injected at sandbox creation.
3. **Sandbox must be publicly reachable**: Pipedream needs to POST events to the sandbox. In production: `https://p8000-{sandboxId}.kortix.cloud`. Set via `SANDBOX_PUBLIC_URL` env var. In local dev: use a tunnel (ngrok/cloudflared) to the Docker-mapped port.
4. **Plugin must be loaded**: The `agent-triggers.ts` plugin must be active. Verify: `agent_triggers` tool. Webhook server runs on port 8099.

### `event_triggers` Tool Reference

#### Actions

| Action | Required Params | Optional Params | Description |
|---|---|---|---|
| `list_available` | `app` | `query` | List available trigger components for an app |
| `setup` | `name`, `app`, `component_key`, `prompt` | `configured_props`, `agent_name`, `model_id`, `session_mode` | Deploy a new event listener |
| `list` | — | `agent_name`, `app` | List all listeners |
| `get` | `listener_id` | — | Get listener details |
| `remove` | `listener_id` | — | Delete listener and Pipedream trigger |
| `pause` | `listener_id` | — | Stop receiving events |
| `resume` | `listener_id` | — | Resume receiving events |

#### Setup Parameters

| Parameter | Required | Description |
|---|---|---|
| `name` | Yes | Human-readable name for this listener |
| `app` | Yes | App slug: `gmail`, `github`, `slack`, `notion`, etc. |
| `component_key` | Yes | Pipedream trigger key (get from `list_available`) |
| `prompt` | Yes | Prompt template. Use `{{ key }}` for top-level event fields. Full event always appended as `<trigger_event>` XML. |
| `configured_props` | No | JSON string of component config (e.g. `{"withTextPayload": true, "timer": {"intervalSeconds": 60}}`) |
| `agent_name` | No | Agent to handle events (default: `"kortix"`) |
| `model_id` | No | Override model for triggered sessions |
| `session_mode` | No | `"new"` (default) or `"reuse"` |

### Step-by-Step: Gmail "New Email" Trigger

```
Step 1: Check Gmail is connected
  → integration-list
  → Should show: gmail / status: active

Step 2: List available Gmail triggers
  → event_triggers action=list_available app=gmail
  → Returns keys like:
     gmail-new-email-received
     gmail-new-sent-email
     gmail-new-labeled-email
     gmail-new-email-matching-search
     gmail-new-attachment-received

Step 3: Deploy the trigger
  → event_triggers action=setup
    name="New Email Alert"
    app=gmail
    component_key=gmail-new-email-received
    prompt="New email from {{ from }}. Subject: {{ subject }}. Analyze and summarize."
    configured_props="{\"withTextPayload\": true, \"timer\": {\"intervalSeconds\": 60}}"

  This does 3 things:
    a) Creates a listener record locally (gets a UUID)
    b) Calls Pipedream API to deploy the trigger with webhook_url pointing to sandbox
    c) Updates the listener record with the Pipedream deployedTriggerId

Step 4: Verify it's active
  → event_triggers action=list
  → Should show: [active] New Email Alert | gmail:gmail-new-email-received

Step 5: Events arrive automatically
  → When a new email arrives, Pipedream polls and detects it
  → Pipedream POSTs event to sandbox → new agent session created
  → Agent receives prompt with email content and processes it
```

### Polling Intervals

Pipedream polling triggers check for new events at a configurable interval:

| Setting | Value |
|---|---|
| Default | 900 seconds (15 minutes) |
| Minimum | 60 seconds |
| Configure via | `configured_props: {"timer": {"intervalSeconds": 60}}` |

Some triggers support instant/webhook mode (e.g. `gmail-new-email-received` with `triggerType: "webhook"` — requires custom OAuth client).

### Common Apps and Trigger Keys

| App | Example Triggers |
|---|---|
| `gmail` | `gmail-new-email-received`, `gmail-new-sent-email`, `gmail-new-labeled-email`, `gmail-new-attachment-received` |
| `github` | `github-new-pull-request`, `github-new-issue`, `github-new-commit`, `github-new-star` |
| `slack` | `slack-new-message-in-channel`, `slack-new-direct-message`, `slack-new-reaction-added` |
| `notion` | `notion-page-or-subpage-updated`, `notion-new-database-item` |

Always use `event_triggers action=list_available app={app}` to get the real list — trigger keys and configurable props vary by app and version.

### Security

- The listener UUID in the webhook URL acts as a non-guessable secret
- `/events/pipedream/:listenerId` route is **auth-exempt** — Pipedream can't authenticate with our tokens
- Paused listeners reject events with 403
- Unknown listener IDs return 404

### Listener State

Persisted to `/tmp/kortix-agent-triggers/listener-state.json`. Each record tracks:
- `id`: UUID (used in webhook URL)
- `deployedTriggerId`: Pipedream's ID (e.g. `dc_K0unKO2`)
- `isActive`: Whether events are accepted
- `eventCount`: Total events received
- `lastEventAt`: Last event timestamp
- `prompt`: Template for session dispatch

**Note:** `/tmp` does not persist across container restarts. Deployed triggers remain active on Pipedream but the local listener record is lost. After restart, re-run `event_triggers action=setup` or restore the state file.

---

## Architecture Reference

### Proxy Chain (Trigger Management)

```
Agent tool call (event_triggers action=setup)
  → TriggerManager.setupListener()
    → fetch("http://localhost:8000/api/integrations/triggers/deploy")   [kortix-master]
      → fetch("{KORTIX_API_URL}/v1/integrations/triggers/deploy")       [kortix-api, auth: KORTIX_TOKEN]
        → Pipedream Connect API: POST /v1/connect/{project}/triggers/deploy
```

### Proxy Chain (Event Delivery)

```
External app event (e.g. new Gmail email)
  → Pipedream polling worker detects it
    → POST {SANDBOX_PUBLIC_URL}/events/pipedream/{listenerId}           [auth-exempt]
      → kortix-master forwards to localhost:8099/events/pipedream/{listenerId}
        → WebhookTriggerServer.pipedreamHandler()
          → ListenerStore.get(listenerId) — reads from disk
          → Builds prompt from template + event payload
          → POST /session/{id}/prompt_async — creates agent session
```

### Key Ports

| Port | Service | Exposed? |
|---|---|---|
| 8000 | kortix-master (reverse proxy) | Yes (Docker mapped) |
| 8099 | agent-triggers webhook server | No (internal only) |
| 4096 | OpenCode API server | No (proxied via 8000) |

### Key Files

| Path | Purpose |
|---|---|
| `/opt/opencode/plugin/agent-triggers.ts` | Plugin entry point |
| `/opt/opencode-agent-triggers/` | Package source |
| `/tmp/kortix-agent-triggers/cron-state.json` | Cron trigger state |
| `/tmp/kortix-agent-triggers/listener-state.json` | Event listener state |
| `/opt/opencode/agents/kortix.md` | Agent with trigger definitions |

### Environment Variables

| Variable | Purpose |
|---|---|
| `SANDBOX_PUBLIC_URL` | Public URL for Pipedream event delivery (e.g. `https://p8000-{id}.kortix.cloud`) |
| `KORTIX_TOKEN` | Auth token for outbound requests to kortix-api |
| `KORTIX_API_URL` | kortix-api base URL (default: `http://host.docker.internal:8008`) |
