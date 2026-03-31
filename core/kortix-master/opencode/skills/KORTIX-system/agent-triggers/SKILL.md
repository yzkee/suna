---
name: kortix-agent-triggers
description: "Kortix agent triggers reference: cron, webhook, and Pipedream event triggers, frontmatter configuration, runtime state, and management tools."
---

# Agent Triggers — Cron, Webhook, and Event-Driven Execution

Automated agent execution via scheduled, HTTP, or third-party event triggers.

---

## Overview

The `@kortix/opencode-agent-triggers` plugin supports three trigger types:

| Type | How it works | Use case |
|---|---|---|
| Cron | Embedded scheduler inside sandbox | Daily reports, periodic maintenance |
| Webhook | HTTP server on port `8099` | CI callbacks, internal events |
| Event (Pipedream) | External event workers POST into sandbox | Gmail, GitHub, Slack, Notion app events |

---

## Declarative Triggers in Agent Frontmatter

Agents declare triggers directly in YAML frontmatter:

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
    context:
      extract:
        sender: "data.body.sender"
      include_raw: true
    execution:
      prompt: "Handle deployment from {{ sender }}"
      session_mode: "new"
  - name: "New GitHub Issue"
    enabled: true
    source:
      type: "pipedream"
      componentKey: "github-new-issue"
      app: "github"
      configuredProps:
        repoFullName: "owner/repo"
    execution:
      prompt: "Triage new GitHub issue."
      session_mode: "new"
---
```

### Execution Fields

| Field | Description |
|---|---|
| `prompt` | Prompt sent to agent. Supports `{{ var }}` templates |
| `session_mode` | `new` (fresh session) or `reuse` (continue existing) |
| `agent_name` | Optional: override which agent executes |
| `model_id` | Optional: override model |

---

## Cron Triggers

### 6-field format

```
second minute hour day month weekday
0      */5    *    *   *     *        # Every 5 minutes
0      0      9    *   *     *        # Daily at 9am
0      0      8    *   *     1        # Mondays at 8am
```

### HTTP API

```bash
# Create
curl -X POST "http://localhost:8000/kortix/cron/triggers" \
  -H "Content-Type: application/json" \
  -d '{"name":"Daily Report","cron_expr":"0 0 9 * * *","prompt":"Generate the daily report"}'

# List
curl "http://localhost:8000/kortix/cron/triggers"

# Get one
curl "http://localhost:8000/kortix/cron/triggers/{id}"

# Update
curl -X PATCH "http://localhost:8000/kortix/cron/triggers/{id}" -d '{"prompt":"new prompt"}'

# Delete
curl -X DELETE "http://localhost:8000/kortix/cron/triggers/{id}"

# Pause / Resume / Run now
curl -X POST "http://localhost:8000/kortix/cron/triggers/{id}/pause"
curl -X POST "http://localhost:8000/kortix/cron/triggers/{id}/resume"
curl -X POST "http://localhost:8000/kortix/cron/triggers/{id}/run"
```

### cron_triggers tool

```
cron_triggers action=create name="Nightly Cleanup" cron_expr="0 0 3 * * *" prompt="Run cleanup"
cron_triggers action=list
cron_triggers action=pause trigger_id="..."
cron_triggers action=resume trigger_id="..."
cron_triggers action=run trigger_id="..."
cron_triggers action=executions trigger_id="..."
cron_triggers action=delete trigger_id="..."
```

---

## Webhook Triggers

- Internal server on port `8099`
- External traffic arrives through Kortix Master on `8000`
- If `source.secret` is set, callers must send `x-kortix-trigger-secret` header
- URL format: `<publicBaseUrl>/<agent-name><path>`

---

## Event Triggers (Pipedream)

Pipedream hosts the polling/trigger worker. The sandbox only receives normalized event deliveries.

### Prerequisites

1. App connected via Pipedream (see `kortix-connectors` skill)
2. `KORTIX_TOKEN` configured
3. `SANDBOX_PUBLIC_URL` configured
4. Trigger plugin loaded

### event_triggers tool

| Action | Purpose |
|---|---|
| `list_available` | List trigger components for an app |
| `setup` | Deploy a new listener |
| `list` | List active listeners |
| `get` | Get listener details |
| `remove` | Delete listener + remote trigger |
| `pause` | Stop accepting events |
| `resume` | Resume event delivery |

### Example: Gmail new email

```
event_triggers action=list_available app=gmail

event_triggers action=setup \
  name="New Email Alert" \
  app=gmail \
  component_key=gmail-new-email-received \
  prompt="New email from {{ from }}. Subject: {{ subject }}." \
  configured_props="{\"withTextPayload\": true, \"timer\": {\"intervalSeconds\": 60}}"
```

---

## Trigger Management Tools

| Tool | Description |
|---|---|
| `agent_triggers` | List trigger definitions and sync state |
| `sync_agent_triggers` | Re-read agent markdown and register triggers |
| `cron_triggers` | CRUD for cron triggers |
| `event_triggers` | Manage Pipedream event listeners |

---

## Runtime

- Cron state: `.opencode/agent-triggers/cron-state.json`
- Event listener state: `/tmp/kortix-agent-triggers/listener-state.json`
- Agents discovered from `.opencode/agents/` and `~/.config/opencode/agents/`
- Webhook server starts on plugin load (port 8099)
- Triggers namespaced as `{agent}:{trigger}` in the scheduler

**Note:** `/tmp` paths don't survive container restarts unless restored externally.
