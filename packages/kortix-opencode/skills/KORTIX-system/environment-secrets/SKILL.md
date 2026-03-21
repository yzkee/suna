---
name: kortix-environment-secrets
description: "Kortix environment and secrets reference: cloud mode, env propagation, secret API usage, encryption, and common key categories."
---

# Environment and Secrets

Setting API keys, env propagation, secret management, and cloud vs local runtime.

---

## Cloud Mode

| Variable | Description |
|---|---|
| `ENV_MODE` | `local` or `cloud` |
| `KORTIX_API_URL` | Base URL for Kortix API services |
| `KORTIX_TOKEN` | Outbound auth token (sandbox → Kortix API) |
| `INTERNAL_SERVICE_KEY` | Inbound auth token (external → sandbox) |
| `SANDBOX_ID` | Sandbox identifier |
| `PROJECT_ID` | Current project identifier |

When `ENV_MODE=cloud`, tool SDK base URLs route through the Kortix API proxy for metering.

---

## Secret Management

**Rule:** When the user provides a secret or API key, set it immediately through the API — never leave it in files.

### Set one key

```bash
curl -X POST http://localhost:8000/env/KEY_NAME \
  -H "Content-Type: application/json" \
  -d '{"value": "the-secret-value", "restart": true}'
```

### Set multiple keys

```bash
curl -X POST http://localhost:8000/env \
  -H "Content-Type: application/json" \
  -d '{
    "keys": {
      "ANTHROPIC_API_KEY": "sk-ant-...",
      "OPENAI_API_KEY": "sk-..."
    },
    "restart": true
  }'
```

### List, get, delete

```bash
curl http://localhost:8000/env                    # List all
curl http://localhost:8000/env/KEY_NAME           # Get one
curl -X DELETE http://localhost:8000/env/KEY_NAME  # Delete (always restarts)
```

`DELETE` always restarts services. `POST`/`PUT` restart only when `restart: true`.

---

## Encryption

- **Algorithm:** AES-256-GCM
- **Key derivation:** `scryptSync(KORTIX_TOKEN || 'default-key', salt, 32)`
- **Salt path:** `/workspace/.secrets/.salt`
- **Secret store:** `/workspace/.secrets/.secrets.json`
- **Runtime propagation:** `/run/s6/container_environment/KEY`

---

## Common Secret Categories

| Category | Keys |
|---|---|
| LLM providers | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY` |
| Tool providers | `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `SERPER_API_KEY`, `REPLICATE_API_TOKEN`, `CONTEXT7_API_KEY`, `ELEVENLABS_API_KEY`, `MORPH_API_KEY` |
| Email | `KORTIX_AGENT_EMAIL_INBOX_*` |
| Browser | `AGENT_BROWSER_PROXY` |
