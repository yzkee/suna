# OAuth Integrations

Connecting third-party apps (Gmail, Slack, GitHub, Sheets, etc.) via Pipedream. OAuth flows, API calls, and event triggers.

---

## Architecture

```
Agent tool → Kortix Master (/api/integrations/*) → Kortix API → Pipedream → third-party app
```

---

## Script Location

```bash
SCRIPT=/opt/opencode/skills/integrations/integration.ts
# or:
SCRIPT=~/.opencode/skills/integrations/integration.ts
```

All commands run via `bun run "$SCRIPT" <command> '<json-args>'`.

---

## OAuth Commands

### search — find app slugs

```bash
bun run "$SCRIPT" search '{"q":"gmail"}'
```

### connect — get OAuth URL

```bash
bun run "$SCRIPT" connect '{"app":"gmail"}'
# Returns connectUrl — show to user to authorize
```

### list — show connected apps

```bash
bun run "$SCRIPT" list
```

### request — single authenticated HTTP call

```bash
bun run "$SCRIPT" request '{"app":"github","method":"GET","url":"https://api.github.com/user/repos"}'
```

### actions — discover Pipedream actions for an app

```bash
bun run "$SCRIPT" actions '{"app":"gmail","q":"send"}'
# Returns action keys + required/optional params
```

### run — execute a Pipedream action

```bash
bun run "$SCRIPT" run '{"app":"gmail","action_key":"gmail-send-email","props":{"to":"x@y.com","subject":"Hi","body":"Hello"}}'
```

### exec — run custom Node.js with proxyFetch

```bash
bun run "$SCRIPT" exec '{"app":"google_sheets","code":"const r = await proxyFetch(\"https://sheets.googleapis.com/v4/spreadsheets/ID/values/Sheet1!A1:D10\"); console.log(JSON.stringify(await r.json()))"}'
```

**`proxyFetch()`** auto-injects OAuth credentials. Never set Authorization headers manually. Use regular `fetch()` for public requests.

---

## Trigger Commands (Pipedream Event Triggers)

### triggers_available — find trigger components

```bash
bun run "$SCRIPT" triggers_available '{"app":"github","q":"new pull request"}'
bun run "$SCRIPT" triggers_available '{"app":"gmail"}'
```

### triggers_deploy — deploy an event trigger

```bash
bun run "$SCRIPT" triggers_deploy '{"componentKey":"github-new-pull-request","configuredProps":{"repo":"owner/repo"}}'
```

### triggers_deployed — list active triggers

```bash
bun run "$SCRIPT" triggers_deployed
```

### triggers_delete — remove a trigger

```bash
bun run "$SCRIPT" triggers_delete '{"id":"dc_xxxx"}'
```

### triggers_update — pause/resume

```bash
bun run "$SCRIPT" triggers_update '{"id":"dc_xxxx","active":false}'
bun run "$SCRIPT" triggers_update '{"id":"dc_xxxx","active":true}'
```

---

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

---

## Common App Slugs

`gmail` · `google_sheets` · `google_drive` · `google_calendar` · `slack` · `github` · `linear` · `notion` · `airtable` · `jira` · `hubspot` · `salesforce`

---

## Error Codes

| Status | Meaning | Fix |
|---|---|---|
| 403 | Not connected | `connect` → user authorizes |
| 400 | Bad params | Check action key/props via `actions` |
| 401 | Token expired | Re-`connect` |
| 502 | Upstream error | Retry (kortix-api may be down) |
