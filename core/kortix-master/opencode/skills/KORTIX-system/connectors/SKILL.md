---
name: kortix-connectors
description: "Kortix connectors: file-based system for documenting service integrations — where secrets live, how to authenticate, how to use. Covers CONNECTOR.md format, discovery, tools, and the Pipedream OAuth subsystem."
---

# Connectors

Simple file-based system. Each connector is a `CONNECTOR.md` that documents:
- What the service is
- Where the secrets/credentials live (env vars, secrets manager)
- How to authenticate (CLI, API key, Pipedream OAuth, browser)
- How to use it

Secrets go in `.env` / secrets manager — never in the files themselves.

---

## Structure

```
.opencode/connectors/
├── github/CONNECTOR.md       # CLI (gh)
├── pipedream/CONNECTOR.md    # Pipedream OAuth subsystem
├── cloudflare/CONNECTOR.md   # API key
├── gmail/CONNECTOR.md        # Pipedream OAuth
└── stripe/CONNECTOR.md       # API key
```

Discovery paths:
1. `.opencode/connectors/<name>/CONNECTOR.md`
2. `~/.config/opencode/connectors/<name>/CONNECTOR.md`

---

## CONNECTOR.md Format

```markdown
---
name: service-name
description: "What this connector does"
type: cli | pipedream | api-key | browser | custom
status: connected | pending | disconnected
credentials:
  - env: ENV_VAR_NAME
    source: "Where to get it"
---

# Service Name

## Authentication
How to authenticate.

## Secrets
Table of env vars, where to get them, how to save them.

## Usage
Key commands or API patterns.

## Verification
How to verify it works.
```

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List all connectors with status and secrets |
| `connector_get` | Load a connector's full docs |
| `connector_create` | Scaffold a new connector from template |

---

## Pipedream OAuth Subsystem

For services that need OAuth (Gmail, Slack, Google Sheets, etc.), Pipedream handles token management.

### Pipedream Credentials

Set these in the secrets manager — the sandbox forwards them to the Kortix API:

| Env Var | Required | Description |
|---|---|---|
| `PIPEDREAM_CLIENT_ID` | Yes | OAuth app client ID |
| `PIPEDREAM_CLIENT_SECRET` | Yes | OAuth app client secret |
| `PIPEDREAM_PROJECT_ID` | Yes | Pipedream project (format: `proj_xxxxx`) |
| `PIPEDREAM_ENVIRONMENT` | No | `development` or `production` (default) |

These get sent as `x-pipedream-*` headers to the Kortix cloud API, which creates an ephemeral Pipedream provider using YOUR credentials.

### Flow

```
Sandbox env vars → Kortix Master (x-pipedream-* headers) → Kortix API → Pipedream SDK → third-party app
```

Also requires `KORTIX_TOKEN` to authenticate to the cloud API.

### Commands

```bash
SCRIPT=$(find /opt/opencode ~/.opencode -name "integration.ts" 2>/dev/null | head -1)

bun run "$SCRIPT" search '{"q":"gmail"}'       # Find app slugs
bun run "$SCRIPT" connect '{"app":"gmail"}'     # Get OAuth URL
bun run "$SCRIPT" list                           # Show connected apps
bun run "$SCRIPT" request '{"app":"...","method":"GET","url":"..."}'
bun run "$SCRIPT" actions '{"app":"...","q":"..."}'
bun run "$SCRIPT" run '{"app":"...","action_key":"...","props":{...}}'
```

---

## Decision Tree

```
Need to use a service?
├─ Has a CLI? (gh, aws, vercel, wrangler)  → type: cli, use the CLI
├─ Uses API keys? (Stripe, Cloudflare)     → type: api-key, save in secrets manager
├─ Needs OAuth? (Gmail, Slack, Sheets)     → type: pipedream, use Pipedream subsystem
├─ Web-only login?                         → type: browser, use agent-browser
└─ Something else?                         → type: custom

Connector exists?
├─ Yes, connected  → connector_get → follow usage docs
├─ Yes, not yet    → connector_get → follow auth docs
└─ No              → connector_create → fill in docs → authenticate
```
