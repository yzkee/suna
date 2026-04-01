---
name: kortix-connectors
description: "Kortix connectors: internal registry of what's connected where. Freeform YAML frontmatter per service. Covers connector_setup, Pipedream via API, CLI-maxxing, API keys."
---

# Connectors

Internal registry of what's connected where. A connector = freeform YAML frontmatter in a `CONNECTOR.md`. Only `name` is required. No `status` field — connection status is always checked live.

Nothing ships by default. Scaffolded on demand via `connector_setup`.

---

## Format

Just key-value pairs. No enforced schema:

```yaml
---
name: google-drive
description: "Company shared drive"
source: pipedream
pipedream_slug: google_drive
---
```

```yaml
---
name: github
description: "kortix-ai org"
source: cli
---
```

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List registered connectors (what's set up, not whether it's live) |
| `connector_get` | Get one connector's metadata |
| `connector_setup` | Batch-scaffold from JSON array |

---

## Checking Pipedream connection status

**This is the only source of truth for whether a Pipedream service is actually connected:**

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)
bun run "$SCRIPT" list
```

Returns the actual connected apps with their real status. Always run this before telling the user whether something is connected or before trying to use a service.

If a service shows as connected in `list` → it works. Use it.
If not → run `connect` to get the OAuth URL.

---

## Connecting Services

### Pipedream (default for most services)

Pipedream is always configured. One-click OAuth for the user.

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)

# Check what's actually connected
bun run "$SCRIPT" list

# Search for an app
bun run "$SCRIPT" search '{"q":"stripe"}'

# Connect — returns OAuth URL
bun run "$SCRIPT" connect '{"app":"stripe"}'
```

Show the OAuth URL to the user via `show`. Pipedream is maximum convenience — one click. For dev-heavy services (GitHub, AWS, Vercel), direct CLI is tighter long-term but takes more setup. Default to Pipedream, upgrade later.

### CLI (when the CLI is significantly better)

Load `cli-maxxing` skill. GitHub (`gh`), AWS (`aws`), Vercel (`vercel`), Cloudflare (`wrangler`).

### API keys (when not on Pipedream and no useful CLI)

User pastes key in chat. Agent saves:
```bash
curl -s -X POST "http://localhost:8000/env/KEY_NAME" \
  -H "Content-Type: application/json" -d '{"value":"...","restart":true}'
```

---

## Using Pipedream-connected services

Use `exec` with `proxyFetch` — authenticated `fetch()`:

```bash
bun run "$SCRIPT" exec '{"app":"google_drive","code":"const r = await proxyFetch(\"https://www.googleapis.com/drive/v3/files?pageSize=10\"); return await r.json();"}'

bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"https://www.googleapis.com/drive/v3/files?pageSize=10"}'
```

---

## Workflow

1. User asks about or wants to use a service
2. **Run `list` to check actual Pipedream status**
3. Connected → use it immediately via `request` or `exec`
4. Not connected → `search` → `connect` → show OAuth link
5. For CLI services → CLI auth (load `cli-maxxing`)
6. For API key services → user pastes in chat
