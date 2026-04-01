---
name: kortix-channels
description: "Kortix channels reference: Slack, Telegram, and Discord bridge architecture, session tracking, APIs, adapters, and messaging rules."
---

# Channels — Messaging Platform Bridge

Bidirectional bridge between Slack, Telegram, Discord and OpenCode agent sessions.

---

## Architecture

```
External Platform (Slack / Telegram / Discord)
        │  webhook / polling
        ▼
┌──────────────────────────────┐
│  kortix-api (:8008)          │
│  /webhooks/slack             │  ← Slack events
│  /webhooks/telegram          │  ← Telegram webhook
│  /v1/channels/*              │  ← CRUD + session API
└──────────────┬───────────────┘
               │  proxy + credentials
               ▼
┌──────────────────────────────────────────────┐
│  opencode-channels (:3456)                    │
│  ┌─────────────┐  ┌──────────────────┐       │
│  │ Slack adapter│  │ Telegram adapter │       │
│  └──────┬──────┘  └────────┬─────────┘       │
│         └────────┬─────────┘                  │
│       ┌──────────▼──────────┐                │
│       │   SessionManager    │ ← threadId → sessionId mapping
│       └──────────┬──────────┘                │
│       ┌──────────▼──────────┐                │
│       │   OpenCodeClient    │                │
│       │  POST /session      │                │
│       │  POST /session/{id}/prompt_async     │
│       │  GET  /event (SSE)  │                │
│       └─────────────────────┘                │
└──────────────────────────────────────────────┘
```

---

## Detecting Channel Context

When responding to a channel message, your prompt ALREADY contains:

1. **`[Channel Context]`** — static: platform, channel type, config ID
2. **`[Live Channel Context — this message]`** — THIS message's platform, thread ID, chat ID

**NEVER ask the user for chat IDs, channel names, or thread IDs.** They're in your prompt.

---

## Sending Messages (Agent → Platform)

### HTTP POST (recommended)

```bash
# Telegram
curl -X POST http://localhost:3456/send \
  -H "Content-Type: application/json" \
  -d '{"platform":"telegram","to":"CHAT_ID","text":"Hello from the agent!"}'

# Slack
curl -X POST http://localhost:3456/send \
  -d '{"platform":"slack","to":"#general","text":"Build passed!"}'

# Discord
curl -X POST http://localhost:3456/send \
  -d '{"platform":"discord","to":"CHANNEL_ID","text":"Done!"}'
```

Response: `{ "ok": true, "platform": "telegram", "messageId": "42", "chatId": "123456789" }`

### Thread Replies

```bash
# Slack thread
curl -X POST http://localhost:3456/send \
  -d '{"platform":"slack","to":"#general","text":"Done!","threadTs":"1234567890.123456"}'

# Telegram reply
curl -X POST http://localhost:3456/send \
  -d '{"platform":"telegram","to":"CHAT_ID","text":"Here you go","replyTo":42}'
```

### CLI Alternative

```bash
bun run /ephemeral/kortix-master/channels/src/cli.ts send telegram --to "CHAT_ID" --text "message"
bun run /ephemeral/kortix-master/channels/src/cli.ts send slack --to "#channel" --text "message"
```

---

## Session Tracking

### Strategy

| Strategy | Behavior |
|---|---|
| `per-thread` | Each Slack thread / Telegram chat / Discord channel gets one session (default) |
| `per-message` | New session per message |
| `per-user` | One session per platform user |
| `single` | All messages share one session |

### Querying Sessions

```bash
# All sessions for a channel
curl "http://localhost:8008/v1/channels/{channelConfigId}/sessions" \
  -H "Authorization: Bearer $KORTIX_TOKEN"

# Reverse lookup — is this session from a channel?
curl "http://localhost:8008/v1/channels/sessions/{sessionId}" \
  -H "Authorization: Bearer $KORTIX_TOKEN"
# Returns { data: { platform, channelName, chatId... } } or { data: null }
```

---

## REST API

All `/v1/channels/*` require user JWT auth unless noted.

### Channel Configs

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/channels` | List all configs |
| `GET` | `/v1/channels?sandbox_id=<id>` | Filter by sandbox |
| `POST` | `/v1/channels` | Create config |
| `GET` | `/v1/channels/:id` | Get one |
| `PATCH` | `/v1/channels/:id` | Update |
| `DELETE` | `/v1/channels/:id` | Delete |
| `POST` | `/v1/channels/:id/link` | Link to sandbox |
| `POST` | `/v1/channels/:id/unlink` | Unlink |
| `POST` | `/v1/channels/:id/enable` | Enable |
| `POST` | `/v1/channels/:id/disable` | Disable |

### Messages & Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/channels/:id/messages` | List raw platform messages |
| `GET` | `/v1/channels/:id/sessions` | List sessions for channel |
| `GET` | `/v1/channels/sessions/:sessionId` | Reverse lookup |

---

## DB Schema

### channel_configs

| Column | Type | Notes |
|---|---|---|
| `channel_config_id` | uuid | PK |
| `account_id` | uuid | Owner |
| `sandbox_id` | uuid | Linked sandbox (nullable) |
| `channel_type` | enum | `slack`, `telegram`, `discord`, `whatsapp`, `teams`, `voice`, `email`, `sms` |
| `name` | varchar | Human-readable |
| `enabled` | boolean | Active? |
| `session_strategy` | enum | `per-thread`, `per-user`, `per-message`, `single` |
| `system_prompt` | text | Custom prompt injected before every message |
| `agent_name` | text | Specific agent override |
| `platform_config` | jsonb | Platform-specific config |

### channel_sessions

| Column | Type | Notes |
|---|---|---|
| `channel_session_id` | uuid | PK |
| `channel_config_id` | uuid | FK |
| `strategy_key` | varchar | Thread identifier (e.g. `telegram:123456789`) |
| `session_id` | text | OpenCode session ID |
| `last_used_at` | timestamp | Last activity |

### channel_messages

| Column | Type | Notes |
|---|---|---|
| `channel_message_id` | uuid | PK |
| `direction` | varchar | `inbound` / `outbound` |
| `session_id` | text | Associated session |
| `content` | text | Message text |
| `platform_user` | jsonb | `{ id, name, avatar }` |

### channel_identity_map

Maps platform users to Kortix users. `allowed` boolean controls access.

---

## Adapter Credentials

Auto-set when channel is configured via Kortix UI:

| Platform | Env Var | Setup |
|---|---|---|
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Kortix UI → Channels → Slack → OAuth wizard |
| Telegram | `TELEGRAM_BOT_TOKEN` | Kortix UI → Channels → Telegram → enter token |
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` | Manual env vars |

---

## Service Details

- **Service:** `svc-opencode-channels` on port `3456`
- **Entry:** `/ephemeral/kortix-master/channels/src/index.ts` (Bun)
- **Restarts:** Always (s6-rc.d, 1.5s delay)
- **Health:** `GET http://localhost:3456/health`
- **Reload:** `POST http://localhost:3456/reload` (after credential changes)

---

## Bot Commands

### Slack: `/oc <command>`

`help`, `models`, `model <name>`, `agents`, `agent <name>`, `status`, `reset`, `diff`, `link`

### Telegram: `/<command>`

`start`, `help`, `models`, `model <name>`, `agents`, `agent <name>`, `status`, `reset`, `new`, `diff`, `link`

### Bang Commands (any platform)

`!reset`, `!clear`, `!help`, `!model <name>`, `!agent <name>`

---

## Rules for Channel Agents

1. **NEVER** ask the user for chat ID, channel name, or thread ID — it's in your prompt
2. Keep responses **SHORT** — chat ≠ essays
3. Use `/send` endpoint for proactive messages
4. Context flows automatically — platform + chat ID + thread ID are always available
