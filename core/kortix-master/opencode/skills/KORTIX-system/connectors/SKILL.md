---
name: kortix-connectors
description: "Kortix connectors: internal registry of what's connected where. Connector files are auto-created when connecting via Pipedream. Covers Pipedream OAuth, CLI-maxxing, API keys."
---

# Connectors

Internal registry of what's connected where. Connector files (`.opencode/connectors/<name>/CONNECTOR.md`) are created automatically — you don't scaffold them upfront.

- **Pipedream services** → connector file auto-created when OAuth completes
- **CLI services** → create connector file after CLI auth succeeds
- **API key services** → create connector file after saving the key

---

## RULES

1. **NEVER tell the user to go somewhere to connect a service.** Run `connect` yourself, show the OAuth link in chat.
2. **NEVER trust connector files for connection status.** Run Pipedream `list` to check what's actually live.
3. **If connected on Pipedream, use it immediately** — even if no connector file exists yet.
4. **If NOT connected, connect it yourself** — `connect` → show link → user clicks → done. The connector file auto-creates.

---

## Tools

| Tool | Purpose |
|---|---|
| `connector_list` | List registered connectors |
| `connector_get` | Get one connector's metadata |
| `connector_setup` | Manually create connectors (for CLI/API-key services only) |

---

## When the user asks to use a service

```bash
SCRIPT=$(find /opt/opencode ~/.opencode /workspace /ephemeral -name "integration.ts" 2>/dev/null | head -1)

# Check what's actually connected
bun run "$SCRIPT" list
```

**Connected → use it:**
```bash
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"https://www.googleapis.com/drive/v3/files?pageSize=10"}'
```

**Not connected → connect it (connector file auto-creates):**
```bash
bun run "$SCRIPT" search '{"q":"google drive"}'
bun run "$SCRIPT" connect '{"app":"google_drive"}'
# Show the returned URL to the user via show tool
```

---

## Using connected services

```bash
# Authenticated request
bun run "$SCRIPT" request '{"app":"google_drive","method":"GET","url":"..."}'

# Programmatic code with proxyFetch
bun run "$SCRIPT" exec '{"app":"google_drive","code":"const r = await proxyFetch(\"...\"); return await r.json();"}'
```

---

## CLI services

After CLI auth succeeds, create the connector file:
```
connector_setup(connectors='[{"name":"github","description":"kortix-ai org","source":"cli"}]')
```
Load `cli-maxxing` skill for PTY auth patterns.

## API key services

After user pastes key and it's saved, create the connector file:
```bash
curl -s -X POST "http://localhost:8000/env/STRIPE_SECRET_KEY" \
  -H "Content-Type: application/json" -d '{"value":"sk_live_...","restart":true}'
```
```
connector_setup(connectors='[{"name":"stripe","description":"production account","source":"api-key"}]')
```
