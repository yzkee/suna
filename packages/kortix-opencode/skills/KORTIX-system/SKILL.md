---
name: kortix-system
description: "Router skill for the Kortix platform. Load this when you need to choose the right standalone Kortix/OpenCode skill for sandbox internals, framework behavior, session orchestration, integrations, channels, triggers, operations, or agent harness design."
---

# Kortix System Router

Use this skill as the top-level map for the Kortix platform. It should route you to the most specific standalone skill as quickly as possible instead of keeping the whole platform manual in one file.

## Load the Most Specific Skill

| Domain | Load this skill | Covers |
|---|---|---|
| Sandbox architecture, paths, services, ports | `kortix-architecture` | Container image, key paths, services, ports, auth model, runtimes |
| Persistence, package survival, boot flow | `kortix-persistence` | What persists vs resets, safe install patterns, boot flow |
| Env vars, secrets, encryption, cloud mode | `kortix-environment-secrets` | Env vars, cloud mode, secret API, encryption |
| Agents, skills, tools, commands, sessions, providers, plugins, API | `opencode-framework` | Framework architecture, config, REST API, SSE |
| Kortix background sessions and orchestration tools | `kortix-session-orchestration` | `session_start_background`, `session_list_background`, aliases, scoping, session-report flow |
| Memory, observations, LTM, session search, SQLite, lss | `kortix-memory-sessions` | Memory plugin, filesystem persistence, session retrieval |
| OAuth apps, Pipedream actions, authenticated API calls | `kortix-integrations` | Integrations, actions, proxyFetch, trigger management |
| Slack, Telegram, Discord bridge | `kortix-channels` | Messaging bridge, session tracking, adapter setup, APIs |
| Local machine control on the user's computer | `agent-tunnel` | Files, shell, screenshots, mouse, keyboard, accessibility tree |
| Browser automation in websites and web apps | `agent-browser` | Navigation, snapshots, interaction, auth, capture, verification |
| Scheduled or event-driven agent execution | `kortix-agent-triggers` | Cron, webhook, Pipedream triggers, frontmatter, runtime |
| OCX marketplace discovery and installs | `ocx-registry` | Registry search, preview, install, load workflow |
| Creating or refactoring skills | `kortix-skill-authoring` | Skill layout, SKILL.md format, progressive disclosure |
| Operations, health checks, Docker, debugging | `kortix-operations` | Init scripts, health checks, common issues, Docker dev |
| Agent design, permissions, composition, harness engineering | `kortix-agent-harness` | Identity, permissions, tools, triggers, composition patterns |

## Routing Rules

1. Prefer the narrow standalone skill over `kortix-system` whenever the question is clearly about one domain.
2. Load multiple skills only when the task truly spans multiple subsystems.
3. Keep this router short; detailed operational knowledge belongs in the standalone skills.
4. For local-machine work use `agent-tunnel`; for browser work use `agent-browser`.
5. For platform-wide questions, start with the closest skill above and add `kortix-system` only as the router.

## Escalation Hints

- Questions about sandbox internals usually start with `kortix-architecture` or `kortix-persistence`.
- Questions about how OpenCode itself works usually start with `opencode-framework`.
- Questions about `session_start_background`, `session_list_background`, `session_read`, `session_message`, or project-vs-session scope should start with `kortix-session-orchestration`.
- Questions about automation often combine `kortix-agent-triggers` with `kortix-integrations` or `kortix-agent-harness`.
- Questions about authoring or refactoring platform knowledge should load `kortix-skill-authoring`.
