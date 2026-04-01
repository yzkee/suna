---
name: kortix-connectors
description: "Kortix connectors: internal registry of what's connected where. Freeform YAML frontmatter per service. Covers connector_setup, Pipedream via API, CLI-maxxing, API keys."
---

# Connectors

Internal registry of what's connected where. A connector = freeform YAML frontmatter in a `CONNECTOR.md`. Only `name` is required.

Nothing ships by default. Scaffolded on demand via `connector_setup`.

---

## RULES — read these first

1. **NEVER tell the user to go somewhere to connect a service.** Always run the connect command yourself and show them the OAuth link directly in chat.

2. **NEVER trust connector files for connection status.** Always run the Pipedream `list` command to check what's actually connected.

3. **If a service is connected on Pipedream, use it immediately** — even if no connector file exists.

4. **If a service is NOT connected, connect it yourself** — run `connect`, get the OAuth URL, show it to the user with `show`. One click for them, done.

---

## Format

```yaml
---
name: google-drive
description: "Company shared drive"
source: pipedream
---
```

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List registered connectors |
| `connector_get` | Get one connector's metadata |
| `connector_setup` | Batch-scaffold from JSON array |

---

## When the user asks to use a service

**Always follow this exact flow:**

```bash
# Step 1: Find the integration script
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)

# Step 2: Check what's ACTUALLY connected right now
bun run "$SCRIPT" list
```

**If the service appears in the list → it's connected. Use it immediately.** Also ensure a connector file exists — if not, create one:

```bash
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"https://www.googleapis.com/drive/v3/files?pageSize=10"}'
```

```
# Create the connector file if it doesn't exist yet
connector_setup(connectors='[{"name":"google-drive","description":"connected via Pipedream","source":"pipedream"}]')
```

**If the service is NOT in the list → connect it NOW and show the link:**

```bash
# Search for the app slug
bun run "$SCRIPT" search '{"q":"google drive"}'

# Connect — this returns a URL
bun run "$SCRIPT" connect '{"app":"google_drive"}'

# Show the URL to the user so they can click it directly
# Use the show tool: show({ type: "url", url: "<connectUrl>", title: "Connect Google Drive — click to authorize" })
```

**NEVER say "go to settings" or "go to the integrations page."** The user should never leave the chat. You handle the connection flow, show them the link, they click, done.

---

## Using connected services

```bash
# Authenticated API call
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"https://www.googleapis.com/drive/v3/files?pageSize=10"}'

# Programmatic code with proxyFetch
bun run "$SCRIPT" exec '{"app":"google_drive","code":"const r = await proxyFetch(\"https://www.googleapis.com/drive/v3/files?pageSize=10\"); return await r.json();"}'
```

---

## Connecting via CLI or API key

### CLI

Load `cli-maxxing` skill. `gh`, `aws`, `vercel`, `wrangler`.

### API keys

User pastes in chat. Agent saves:
```bash
curl -s -X POST "http://localhost:8000/env/KEY_NAME" \
  -H "Content-Type: application/json" -d '{"value":"...","restart":true}'
```

---

## Syncing

When you discover a service is connected on Pipedream but has no connector file, scaffold one:

```
connector_setup(connectors='[{"name":"google-drive","description":"connected via Pipedream","source":"pipedream"}]')
```
