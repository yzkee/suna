---
name: integrations
description: "OAuth integration tools for connecting and calling third-party APIs (Gmail, Slack, Google Sheets, GitHub, etc.) via Pipedream. Also manages Pipedream event triggers (deploy, list, delete). Load this skill when you need to connect apps, make authenticated API calls, execute Pipedream actions, deploy event triggers, or run custom code against a connected integration."
---

# Integrations

All OAuth + trigger operations via a single script. Run with bash — no tool primitive needed.

```
SCRIPT=/opt/opencode/skills/integrations/integration.ts
# or:
SCRIPT=~/.opencode/skills/integrations/integration.ts
```

## OAuth Commands

### search — find app slugs
```bash
bun run "$SCRIPT" search '{"q":"gmail"}'
```

### connect — get OAuth URL for user to click
```bash
bun run "$SCRIPT" connect '{"app":"gmail"}'
# Returns connectUrl — show it to the user, they click to authorize
```

### list — show connected apps in this sandbox
```bash
bun run "$SCRIPT" list
```

### request — single authenticated HTTP call
```bash
bun run "$SCRIPT" request '{"app":"github","method":"GET","url":"https://api.github.com/user/repos"}'
bun run "$SCRIPT" request '{"app":"gmail","method":"POST","url":"https://...","body":{"to":"x@y.com"}}'
```

### actions — list Pipedream actions for an app
```bash
bun run "$SCRIPT" actions '{"app":"gmail","q":"send"}'
# Returns action keys + required/optional params
```

### run — execute a Pipedream action (no URL needed)
```bash
bun run "$SCRIPT" run '{"app":"gmail","action_key":"gmail-send-email","props":{"to":"x@y.com","subject":"Hi","body":"Hello"}}'
```

### exec — run custom Node.js code with proxyFetch
```bash
bun run "$SCRIPT" exec '{"app":"google_sheets","code":"const r = await proxyFetch(\"https://sheets.googleapis.com/v4/spreadsheets/ID/values/Sheet1!A1:D10\"); console.log(JSON.stringify(await r.json()))"}'
```

In `exec` code, use `proxyFetch(url, init)` for authenticated calls — auth injected automatically. Never set Authorization headers. Use regular `fetch()` for public requests. Output via `console.log()`.

## Trigger Commands (Pipedream Event Triggers)

### triggers_available — find trigger components for an app
```bash
bun run "$SCRIPT" triggers_available '{"app":"github","q":"new pull request"}'
bun run "$SCRIPT" triggers_available '{"app":"gmail"}'
```

Returns available event trigger components (e.g. `github-new-pull-request`, `gmail-new-email`) with their configurable props.

### triggers_deploy — deploy an event trigger
```bash
bun run "$SCRIPT" triggers_deploy '{"componentKey":"github-new-pull-request","configuredProps":{"repo":"owner/repo"}}'
bun run "$SCRIPT" triggers_deploy '{"componentKey":"gmail-new-email","webhookUrl":"https://..."}'
```

Deploys a Pipedream trigger that fires events when something happens (new email, new PR, etc.). Events are delivered to the webhook URL.

### triggers_deployed — list active triggers
```bash
bun run "$SCRIPT" triggers_deployed
```

Returns all deployed triggers with their IDs, status, and configuration.

### triggers_delete — remove a deployed trigger
```bash
bun run "$SCRIPT" triggers_delete '{"id":"dc_xxxx"}'
```

### triggers_update — pause/resume a trigger
```bash
bun run "$SCRIPT" triggers_update '{"id":"dc_xxxx","active":false}'
bun run "$SCRIPT" triggers_update '{"id":"dc_xxxx","active":true}'
```

## Decision Tree

```
Find app slug?              → search
Connect new app?            → connect → show URL to user → list to verify
What's connected?           → list
Simple REST call?           → request
Use a Pipedream action?     → actions (discover key) → run (execute)
Complex multi-call logic?   → exec (write Node.js inline)
Set up event trigger?       → triggers_available → triggers_deploy
List active triggers?       → triggers_deployed
Remove/pause trigger?       → triggers_delete / triggers_update
```

## Common Slugs

`gmail` · `google_sheets` · `google_drive` · `google_calendar` · `slack` · `github` · `linear` · `notion` · `airtable` · `jira` · `hubspot` · `salesforce`

## Error Codes

| Status | Meaning | Fix |
|--------|---------|-----|
| 403 | Not connected | `connect` → user authorizes |
| 400 | Bad params | Check action key/props via `actions` |
| 401 | Token expired | Re-`connect` |
| 502 | Upstream error | kortix-api may be down, retry |
