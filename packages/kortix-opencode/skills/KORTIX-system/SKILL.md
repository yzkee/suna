---
name: kortix-system
description: "Router skill for the Kortix platform. Load this when you need to choose the right standalone Kortix/OpenCode skill for sandbox internals, framework behavior, session orchestration, integrations, channels, triggers, operations, or agent harness design."
---

# Kortix System Router

Use this skill as the top-level map for the Kortix platform. It should route you to the most specific standalone skill as quickly as possible instead of keeping the whole platform manual in one file.

## Load the Most Specific Skill

| Domain | Load this skill | Covers |
|---|---|---|
| Container/runtime model, persistence, paths, ports, basic ops | `technical-sys-info` | Docker-backed sandbox model, durable paths, key services, simple health checks |
| Env vars, secrets, encryption, cloud mode | `kortix-environment-secrets` | Env vars, cloud mode, secret API, encryption |
| Agents, skills, tools, commands, sessions, providers, plugins, API | `opencode-framework` | Framework architecture, config, REST API, SSE |
| Sessions, prompt memory files, background sessions, SQLite | `kortix-sessions` | Tiny prompt memory, session retrieval, background sessions, filesystem persistence |
| Local semantic search over files and SQLite | `lss` | Hybrid BM25 + embedding search, indexing, watch mode, SQLite row search |
| OAuth apps, Pipedream actions, authenticated API calls | `kortix-integrations` | Integrations, actions, proxyFetch, trigger management |
| Slack, Telegram, Discord bridge | `kortix-channels` | Messaging bridge, session tracking, adapter setup, APIs |
| Local machine control on the user's computer | `agent-tunnel` | Files, shell, screenshots, mouse, keyboard, accessibility tree |
| Browser automation in websites and web apps | `agent-browser` | Navigation, snapshots, interaction, auth, capture, verification |
| Scheduled or event-driven agent execution | `kortix-agent-triggers` | Cron, webhook, Pipedream triggers, frontmatter, runtime |
| OCX marketplace discovery and installs | `ocx-registry` | Registry search, preview, install, load workflow |
| Creating or refactoring skills | `kortix-skill-authoring` | Skill layout, SKILL.md format, progressive disclosure |
| Agent design, permissions, composition, harness engineering | `kortix-agent-harness` | Identity, permissions, tools, triggers, composition patterns |

## Routing Rules

1. Prefer the narrow standalone skill over `kortix-system` whenever the question is clearly about one domain.
2. Load multiple skills only when the task truly spans multiple subsystems.
3. Keep this router short; detailed operational knowledge belongs in the standalone skills.
4. For local-machine work use `agent-tunnel`; for browser work use `agent-browser`.
5. For platform-wide questions, start with the closest skill above and add `kortix-system` only as the router.

## Escalation Hints

- Questions about sandbox internals, durable paths, ports, or basic service checks should start with `technical-sys-info`.
- Questions about how OpenCode itself works usually start with `opencode-framework`.
- Questions about `session_start_background`, `session_list_background`, `session_read`, `session_message`, `session_search`, `session_get`, or project-vs-session scope should start with `kortix-sessions`.
- Questions about automation often combine `kortix-agent-triggers` with `kortix-integrations` or `kortix-agent-harness`.
- Questions about authoring or refactoring platform knowledge should load `kortix-skill-authoring`.
