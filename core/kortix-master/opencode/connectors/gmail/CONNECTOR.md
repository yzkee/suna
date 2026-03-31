---
name: gmail
description: "Gmail email — send, receive, search, and manage via Pipedream OAuth"
type: pipedream
status: disconnected
credentials:
  - env: PIPEDREAM_OAUTH
    source: "OAuth via Pipedream"
---

# Gmail

## Authentication

OAuth via Pipedream. Gmail requires OAuth — there's no API key option.

```bash
SCRIPT=$(find /opt/opencode ~/.opencode -name "integration.ts" 2>/dev/null | head -1)

# Connect Gmail
bun run "$SCRIPT" connect '{"app":"gmail"}'
# → Show the returned connectUrl to the user to authorize
```

## Usage

### Send an email

```bash
bun run "$SCRIPT" run '{"app":"gmail","action_key":"gmail-send-email","props":{"to":"recipient@example.com","subject":"Subject here","body":"Email body here"}}'
```

### Search emails

```bash
bun run "$SCRIPT" request '{"app":"gmail","method":"GET","url":"https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:someone@example.com"}'
```

### Read a specific email

```bash
bun run "$SCRIPT" request '{"app":"gmail","method":"GET","url":"https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}?format=full"}'
```

### List labels

```bash
bun run "$SCRIPT" request '{"app":"gmail","method":"GET","url":"https://gmail.googleapis.com/gmail/v1/users/me/labels"}'
```

### Discover more actions

```bash
bun run "$SCRIPT" actions '{"app":"gmail"}'
```

## Event Triggers

```bash
# Watch for new emails
bun run "$SCRIPT" triggers_available '{"app":"gmail"}'
bun run "$SCRIPT" triggers_deploy '{"componentKey":"gmail-new-email-received","configuredProps":{"withTextPayload":true,"timer":{"intervalSeconds":60}}}'
```

## Verification

```bash
bun run "$SCRIPT" list
# Should show gmail as connected
```
