---
name: kortix-connectors
description: "Kortix connectors: SQLite-backed registry of what's connected where. Auto-created for Pipedream OAuth. Covers Pipedream, CLI, API keys."
---

# Connectors

SQLite-backed registry in `.kortix/kortix.db`. Single source of truth.

Pipedream connectors auto-create when OAuth completes. CLI/API-key connectors created after auth via `connector_setup`.

---

## RULES

1. **NEVER tell the user to go somewhere to connect.** Run `connect`, show the link.
2. **NEVER assume connection status.** Run Pipedream `list` to check.
3. **Connected → use it immediately.**
4. **Not connected → `connect` → show link → auto-creates in DB.**

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List all connectors from DB |
| `connector_get` | Get one connector's metadata |
| `connector_setup` | Create/update connectors (CLI/API-key only, Pipedream auto-creates) |

---

## Using a service

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)
bun run "$SCRIPT" list
```

Connected → use:
```bash
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"..."}'
bun run "$SCRIPT" exec '{"app":"google_drive","code":"const r = await proxyFetch(\"...\"); return await r.json();"}'
```

Not connected → connect:
```bash
bun run "$SCRIPT" connect '{"app":"google_drive"}'
```

---

## CLI/API-key

After auth:
```
connector_setup(connectors='[{"name":"github","description":"kortix-ai org","source":"cli"}]')
```

After saving key:
```
connector_setup(connectors='[{"name":"stripe","description":"production","source":"api-key","env_keys":["STRIPE_SECRET_KEY"]}]')
```
