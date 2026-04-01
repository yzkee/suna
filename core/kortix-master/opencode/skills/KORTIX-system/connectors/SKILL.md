---
name: kortix-connectors
description: "Kortix connectors: internal registry of what's connected where. Freeform YAML frontmatter per service. Covers connector_setup, Pipedream proxyFetch, CLI-maxxing, API keys."
---

# Connectors

Internal registry of what's connected where. A connector = freeform YAML frontmatter in a `CONNECTOR.md`. Only `name` is required.

Nothing ships by default. Scaffolded on demand via `connector_setup`.

---

## Format

No enforced schema. Just key-value pairs:

```yaml
---
name: google-drive
description: "Google Drive — company shared drive"
source: pipedream
pipedream_slug: google_drive
status: connected
---
```

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List all connectors |
| `connector_get` | Get one connector's metadata |
| `connector_setup` | Batch-scaffold from JSON array |

---

## CRITICAL: Always verify actual connection status

**Do NOT trust the `status` field in CONNECTOR.md files.** It's a cached hint, not a live source of truth.

Before telling the user something is connected or disconnected, **always run `list`** to check actual Pipedream connection status:

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)
bun run "$SCRIPT" list
```

This returns the actual connected apps from Pipedream. If `list` shows the app as connected, it IS connected — regardless of what the CONNECTOR.md file says.

**When the user asks to use a Pipedream-connected service:**
1. Run `list` to verify it's actually connected
2. If connected → use it immediately via `request` or `exec`
3. If not connected → run `connect` to get the OAuth URL

**After verifying or connecting, update the CONNECTOR.md status** so it stays in sync.

---

## Connecting Services

### Default: Pipedream for everything

Pipedream is always configured. Use it by default. One-click OAuth for the user.

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)

# Check what's ACTUALLY connected right now
bun run "$SCRIPT" list

# Search for an app
bun run "$SCRIPT" search '{"q":"stripe"}'

# Connect — returns OAuth URL for user to click
bun run "$SCRIPT" connect '{"app":"stripe"}'
```

Show the connect URL to the user:
```
show({ type: "url", url: "<connectUrl>", title: "Connect Stripe — click to authorize" })
```

**Pipedream is maximum convenience** — one-click OAuth, no key management. For dev-heavy services (GitHub, AWS, Vercel, Cloudflare), direct CLI/API is tighter long-term but takes more setup. Default to Pipedream, upgrade later if needed.

### CLI (when the CLI is significantly better)

Load `cli-maxxing` skill:
```bash
gh auth login
aws configure
vercel login
```

### API keys (when not on Pipedream and no useful CLI)

User pastes key in chat. Agent saves:
```bash
curl -s -X POST "http://localhost:8000/env/KEY_NAME" \
  -H "Content-Type: application/json" -d '{"value":"...","restart":true}'
```

---

## Using Pipedream-connected services

After connecting, use `exec` with `proxyFetch` — authenticated `fetch()`:

```bash
# Programmatic API call
bun run "$SCRIPT" exec '{"app":"google_drive","code":"const r = await proxyFetch(\"https://www.googleapis.com/drive/v3/files?pageSize=10\"); return await r.json();"}'

# Simple authenticated HTTP request
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"https://www.googleapis.com/drive/v3/files?pageSize=10"}'
```

---

## Workflow

1. User asks about or wants to use a service
2. **Run `list` to check actual connection status**
3. If connected → use it immediately
4. If not connected → `search` → `connect` → show OAuth link
5. After connecting, update the CONNECTOR.md status to `connected`
6. For CLI services → CLI auth (load `cli-maxxing`)
7. For API key services → user pastes in chat
