---
name: kortix-connectors
description: "Kortix connectors: internal registry of what's connected where. Freeform YAML frontmatter per service. Covers connector_setup, Pipedream via API, CLI-maxxing, API keys."
---

# Connectors

Internal registry of what's connected where. A connector = freeform YAML frontmatter in a `CONNECTOR.md`. Only `name` is required.

Nothing ships by default. Scaffolded on demand via `connector_setup`.

---

## Format

No enforced schema. Just key-value pairs:

```yaml
---
name: gmail-personal
description: "personal gmail account"
source: pipedream
pipedream_slug: gmail
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

## Connecting Services

### Default: Pipedream for everything

Pipedream is always configured. Use it by default for every service. Run `connect`, it returns an OAuth URL, user clicks it, done.

The integration script is bundled with this skill at `connectors/integration.ts`:

```bash
SCRIPT=$(find /opt/opencode ~/.opencode -name "integration.ts" 2>/dev/null | head -1)

# Search for an app
bun run "$SCRIPT" search '{"q":"stripe"}'

# Connect — returns connectUrl for user to click
bun run "$SCRIPT" connect '{"app":"stripe"}'

# List connected apps
bun run "$SCRIPT" list
```

Show the connect URL to the user:
```
show({ type: "url", url: "<connectUrl>", title: "Connect Stripe — click to authorize" })
```

**When presenting to the user:**

> "I'll connect these via Pipedream — just click each link and authorize. It's the fastest way. For services you use heavily, we can upgrade to a direct CLI or API connection later for tighter integration. Let's get going now and revisit later."

For each service:
1. Search for it: `GET /api/pipedream/search-apps?q=name`
2. If found → connect: `POST /api/pipedream/connect` → show link
3. If not on Pipedream → CLI or API key

### Upgrade path: direct connections

For heavy usage, direct connections are stronger:

- **CLI** (`gh`, `aws`, `vercel`, `wrangler`) — pagination, streaming, complex workflows. Load `cli-maxxing` skill.
- **API key** — user pastes in chat, agent saves.

> "This is connected via Pipedream. If you want tighter integration later, we can set up the CLI / paste your API key and go direct — faster, no middleman."

---

## Using Pipedream-connected services

After connecting, use `exec` with `proxyFetch` — authenticated `fetch()`:

```bash
# Programmatic API call
bun run "$SCRIPT" exec '{"app":"stripe","code":"const r = await proxyFetch(\"https://api.stripe.com/v1/customers?limit=5\"); return await r.json();"}'

# Authenticated HTTP request
bun run "$SCRIPT" request '{"app":"stripe","method":"GET","url":"https://api.stripe.com/v1/customers?limit=5"}'

# Discover pre-built actions
bun run "$SCRIPT" actions '{"app":"stripe","q":"list"}'

# Run a pre-built action
bun run "$SCRIPT" run '{"app":"stripe","action_key":"stripe-list-customers","props":{"limit":10}}'
```

---

## CLI auth

Load `cli-maxxing` skill:
```bash
gh auth login
aws configure
vercel login
```

---

## API keys

User pastes key in chat. Agent saves:
```bash
curl -s -X POST "http://localhost:8000/env/KEY_NAME" \
  -H "Content-Type: application/json" -d '{"value":"...","restart":true}'
```

---

## Workflow

1. User lists their tools
2. Agent scaffolds all connectors via `connector_setup`
3. For each: search on Pipedream → if found, `connect` → show OAuth link to user
4. User clicks each link, authorizes
5. Services not on Pipedream: CLI auth or API key
6. Update connector status
7. Offer to upgrade high-usage services to direct connections later
