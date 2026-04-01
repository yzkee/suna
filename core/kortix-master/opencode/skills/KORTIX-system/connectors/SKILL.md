---
name: kortix-connectors
description: "Kortix connectors: internal registry of what's connected where. Freeform YAML frontmatter per service. Covers connector_setup, Pipedream via API, CLI-maxxing, API keys."
---

# Connectors

Internal registry of what's connected where. A connector = freeform YAML frontmatter in a `CONNECTOR.md`. Only `name` is required. Everything else is freeform — describe what it is and how to use it.

Nothing ships by default. Scaffolded on demand via `connector_setup`.

---

## Format

Just key-value pairs describing what the service is:

```yaml
---
name: google-drive
description: "Company shared drive"
source: pipedream
---
```

That's it. No slugs, no status, no credentials list. The file just documents that this service exists and how it's connected.

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List registered connectors |
| `connector_get` | Get one connector's metadata |
| `connector_setup` | Batch-scaffold from JSON array |

---

## Checking what's actually connected

**Before using any service, check both:**

### 1. Pipedream (live status)

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)
bun run "$SCRIPT" list
```

This is the truth. If a service appears here, it's connected and usable — even if no CONNECTOR.md exists for it. Use it immediately.

### 2. Connector files (registry)

```
connector_list(filter="")
```

This shows what's been registered. A service can be connected via Pipedream but not have a connector file, or have a file but not be connected. **Both should be checked and synced.**

### Syncing

When you find a mismatch (Pipedream says connected but no connector file, or vice versa), fix it:

- Connected on Pipedream but no file → scaffold one via `connector_setup`
- Has a file but not connected → either connect it or note it in the file

---

## Connecting Services

### Pipedream (default)

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)

# What's connected right now
bun run "$SCRIPT" list

# Search
bun run "$SCRIPT" search '{"q":"stripe"}'

# Connect — returns OAuth URL for user
bun run "$SCRIPT" connect '{"app":"stripe"}'
```

Pipedream is maximum convenience — one click. For dev-heavy services, direct CLI is tighter but more setup. Default to Pipedream, upgrade later.

### CLI

Load `cli-maxxing` skill. `gh`, `aws`, `vercel`, `wrangler`.

### API keys

User pastes in chat. Agent saves:
```bash
curl -s -X POST "http://localhost:8000/env/KEY_NAME" \
  -H "Content-Type: application/json" -d '{"value":"...","restart":true}'
```

---

## Using connected services

```bash
# Authenticated API call via Pipedream
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"https://www.googleapis.com/drive/v3/files?pageSize=10"}'

# Programmatic code with proxyFetch
bun run "$SCRIPT" exec '{"app":"google_drive","code":"const r = await proxyFetch(\"https://www.googleapis.com/drive/v3/files?pageSize=10\"); return await r.json();"}'
```

---

## Workflow

1. User asks to use a service
2. Run Pipedream `list` — if it's there, use it immediately
3. If not connected → `search` → `connect` → show OAuth link
4. Sync: ensure a connector file exists for anything that's connected
