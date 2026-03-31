---
name: pipedream
description: "Pipedream OAuth integrations — connect 2000+ apps via OAuth. Use when a service needs OAuth and no CLI/API-key option exists."
type: pipedream
status: disconnected
credentials:
  - env: PIPEDREAM_CLIENT_ID
    source: "https://pipedream.com/settings/apps — create an OAuth app"
    required: true
  - env: PIPEDREAM_CLIENT_SECRET
    source: "Same page as client ID"
    required: true
  - env: PIPEDREAM_PROJECT_ID
    source: "Pipedream project settings — format: proj_xxxxx"
    required: true
  - env: PIPEDREAM_ENVIRONMENT
    source: "development or production"
    required: false
---

# Pipedream Integrations

OAuth middleware for 2000+ apps. Handles token management, refresh flows, and pre-built actions.

**When to use:** Service requires OAuth (Gmail, Google Sheets, Slack, etc.) and no better CLI or API-key option exists.

**When NOT to use:** A CLI does the job better (GitHub → `gh`, AWS → `aws`, Vercel → `vercel`, Cloudflare → `wrangler`).

## Setup

Set these 4 env vars in the secrets manager. The sandbox forwards them as headers to the Kortix API, which creates an ephemeral Pipedream provider using YOUR credentials (not the global Kortix account).

```bash
# Required:
curl -s -X POST "http://localhost:8000/env/PIPEDREAM_CLIENT_ID" \
  -H "Content-Type: application/json" -d '{"value":"your-client-id","restart":true}'

curl -s -X POST "http://localhost:8000/env/PIPEDREAM_CLIENT_SECRET" \
  -H "Content-Type: application/json" -d '{"value":"your-client-secret","restart":true}'

curl -s -X POST "http://localhost:8000/env/PIPEDREAM_PROJECT_ID" \
  -H "Content-Type: application/json" -d '{"value":"proj_xxxxx","restart":true}'

# Optional (defaults to production):
curl -s -X POST "http://localhost:8000/env/PIPEDREAM_ENVIRONMENT" \
  -H "Content-Type: application/json" -d '{"value":"production","restart":true}'
```

## How it works

```
Sandbox → Kortix Master (reads PIPEDREAM_* from env, sends as x-pipedream-* headers)
       → Kortix Cloud API (uses YOUR Pipedream creds, not global)
       → Pipedream SDK → third-party app
```

Also requires `KORTIX_TOKEN` to authenticate to the cloud API.

## Usage

All commands via the integration script:

```bash
SCRIPT=$(find /opt/opencode ~/.opencode -name "integration.ts" 2>/dev/null | head -1)

# Search for apps
bun run "$SCRIPT" search '{"q":"gmail"}'

# Connect an app (returns OAuth URL for user)
bun run "$SCRIPT" connect '{"app":"gmail"}'

# List connected apps
bun run "$SCRIPT" list

# Make authenticated API call
bun run "$SCRIPT" request '{"app":"github","method":"GET","url":"https://api.github.com/user/repos"}'

# Discover pre-built actions
bun run "$SCRIPT" actions '{"app":"gmail","q":"send"}'

# Run an action
bun run "$SCRIPT" run '{"app":"gmail","action_key":"gmail-send-email","props":{"to":"x@y.com","subject":"Hi","body":"Hello"}}'

# Custom code with proxyFetch (auto-injects OAuth creds)
bun run "$SCRIPT" exec '{"app":"google_sheets","code":"..."}'
```

## Event Triggers

```bash
bun run "$SCRIPT" triggers_available '{"app":"gmail"}'
bun run "$SCRIPT" triggers_deploy '{"componentKey":"gmail-new-email-received","configuredProps":{...}}'
bun run "$SCRIPT" triggers_deployed
bun run "$SCRIPT" triggers_delete '{"id":"dc_xxxx"}'
```

## Common App Slugs

`gmail` · `google_sheets` · `google_drive` · `google_calendar` · `slack` · `linear` · `notion` · `airtable` · `jira` · `hubspot` · `salesforce`

## Verification

```bash
bun run "$SCRIPT" list
```

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| 401 from Kortix API | `KORTIX_TOKEN` not registered | Re-register sandbox |
| 403 from Pipedream | App not connected | `connect` → user authorizes |
| No Pipedream credentials | Env vars not set | Set `PIPEDREAM_CLIENT_ID` etc. |
