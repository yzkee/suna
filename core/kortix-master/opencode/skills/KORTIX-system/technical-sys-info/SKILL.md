---
name: technical-sys-info
description: "Kortix technical system reference: container/runtime model, what persists, key paths, ports, and basic operational checks."
---

# Technical System Info

Kortix runs inside a Docker-backed sandbox container.

Use this skill when you need the minimum truthful model for:

- where the agent is running
- what persists across restarts
- which paths matter
- which ports/services exist
- how to do basic health checks

## Core Model

- runtime: Docker-backed sandbox container
- durable area: `/workspace`
- ephemeral area: almost everything outside `/workspace`
- built-in OpenCode config: `/opt/opencode`
- user/project OpenCode config: `/workspace/.opencode`

## Persistence Rule

Only `/workspace` should be treated as durable.

If something must survive restarts, store it under `/workspace`.

Important durable paths:

- `/workspace/.opencode/` — user-installed config and skills
- `/workspace/.local/share/opencode/` — sessions and OpenCode runtime data
- `/workspace/.kortix/` — Kortix state
- `/workspace/.lss/` — LSS index
- `/workspace/.browser-profile/` — browser profile
- `/workspace/.secrets/` — secret storage

## Key Paths

| Path | Purpose |
|---|---|
| `/workspace` | durable working area |
| `/opt/opencode` | built-in agents, skills, plugins, commands |
| `/workspace/.opencode` | user/project overrides and installed skills |
| `/workspace/.local/share/opencode/opencode.db` | OpenCode session database |
| `/workspace/.lss/lss.db` | LSS database |

## Ports and Services

These are the main local services to care about:

| Service | Port | Purpose |
|---|---|---|
| Kortix Master | `8000` | proxy, health, env, pipedream, connector routes |
| OpenCode static/web service | `3211` or proxied routes | UI/assets depending on runtime setup |
| Channels | `3456` | Slack/Telegram/Discord bridge |
| Agent Browser stream | `9223` | browser automation stream |

Treat exact port exposure as environment-specific when unsure; verify with the running process or health endpoints.

## Basic Checks

```bash
ps aux | grep -E "(opencode|kortix|lss-sync)"
curl http://localhost:8000/kortix/health
curl http://localhost:8000/lss/status
lsof -nP -iTCP -sTCP:LISTEN
```

## Install / Persistence Rules

- write durable files under `/workspace`
- prefer persistent user-level installs over ephemeral system mutation
- do not assume `/opt`, `/tmp`, or `/etc` changes will survive restart

## Practical Rule of Thumb

- need durable notes, outputs, state, or config → put it in `/workspace`
- need built-in platform code or bundled defaults → look in `/opt/opencode`
- need session history → use OpenCode session tools or inspect `opencode.db`
- need semantic search → use `lss`
