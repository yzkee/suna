---
name: kortix-connectors
description: "Kortix connectors: SQLite-backed registry of what's connected where. Auto-created for Pipedream OAuth. Covers Pipedream, CLI, API keys."
---

# Connectors

SQLite-backed registry in `.kortix/kortix.db`. Single source of truth.

## RULES

1. **NEVER tell the user to go somewhere.** Handle it, show the link.
2. **NEVER assume status.** Run `list` first.
3. **Connected → use immediately.**
4. **Not connected → `connect` → show links → user clicks → auto-creates in DB.**

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List connectors from DB |
| `connector_get` | Get one connector |
| `connector_setup` | Create connectors (CLI/API-key only) |
| `connector_remove` | Delete connectors by name |

---

## Standard Protocol

Every connector interaction follows this exact flow. No variation.

### Step 1: Find the script (once per session, reuse the variable)

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)
```

### Step 2: Check what's live

```bash
bun run "$SCRIPT" list
```

### Step 3a: Use connected services

```bash
bun run "$SCRIPT" request '{"app":"APP","method":"GET","url":"..."}'
bun run "$SCRIPT" exec '{"app":"APP","code":"const r = await proxyFetch(\"...\"); return await r.json();"}'
```

### Step 3b: Connect missing services (batch, one call)

```bash
bun run "$SCRIPT" connect '{"apps":["gmail","slack","stripe","github"]}'
```

Then show ALL links in ONE output:

```
show({
  type: "markdown",
  title: "Connect your services — click each link to authorize",
  content: "| Service | |\n|---|---|\n| Gmail | [Connect →](url) |\n| Slack | [Connect →](url) |\n| Stripe | [Connect →](url) |\n| GitHub | [Connect →](url) |"
})
```

### Step 4: For CLI/API-key services (after auth succeeds)

```
connector_setup(connectors='[{"name":"github","description":"kortix-ai org","source":"cli"}]')
```

---

**Token efficiency:** One `SCRIPT=...` per session. One `list` call. One batch `connect`. One `show`. That's it — 4 tool calls max for any number of services.
