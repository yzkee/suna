---
name: kortix-system
description: "Complete Kortix platform reference. Covers: sandbox architecture (container, services, ports, filesystem), persistence, environment & secrets, OpenCode framework (agents, skills, tools, commands, sessions, providers, plugins, REST/SSE API), memory & session search (plugin, LTM, lss, SQLite, grep), OAuth integrations (Pipedream), channels (Slack/Telegram/Discord bridge), agent tunnel (local machine control), agent triggers (cron/webhook/pipedream), OCX registry (skill discovery & install), skill authoring, operations/debugging, and agent harness engineering. Load this skill for ANY Kortix system question."
---

# Kortix System Reference

The single source of truth for the entire Kortix platform. Read the relevant reference file below before answering system questions.

## Reference Map

| # | File | Covers |
|---|------|--------|
| 01 | `references/01-architecture.md` | Container image, key paths, services & ports, auth model, runtimes |
| 02 | `references/02-persistence.md` | What persists vs resets, safe install patterns, boot flow |
| 03 | `references/03-environment-and-secrets.md` | Env vars, cloud mode, secret API, encryption |
| 04 | `references/04-opencode-framework.md` | Agents, skills, tools, commands, sessions, providers, plugins, config, REST API, SSE |
| 05 | `references/05-memory-and-sessions.md` | Memory plugin, LTM, filesystem persistence, session search (plugin, SQL, REST, grep, lss) |
| 06 | `references/06-integrations.md` | OAuth apps, Pipedream actions, proxyFetch, trigger management |
| 07 | `references/07-channels.md` | Slack/Telegram/Discord bridge, sending messages, session tracking, DB schema |
| 08 | `references/08-agent-tunnel.md` | Local machine control: files, shell, screenshots, mouse/keyboard, accessibility tree |
| 09 | `references/09-agent-triggers.md` | Cron, webhook, Pipedream event triggers; declarative frontmatter; HTTP API |
| 10 | `references/10-registry.md` | OCX registry, skill discovery, install workflow |
| 11 | `references/11-skill-authoring.md` | Skill layout, SKILL.md format, progressive disclosure |
| 12 | `references/12-operations.md` | Init scripts, health checks, Docker dev, common issues |
| 13 | `references/13-agent-harness.md` | Agent engineering: identity, permissions, tools, triggers, composition patterns |

## Routing — Read the Right File

| Question domain | Read first |
|---|---|
| Sandbox architecture, paths, services, ports | `01-architecture.md` |
| What survives restarts, package installation | `02-persistence.md` |
| API keys, env vars, secrets, auth tokens | `03-environment-and-secrets.md` |
| How agents/skills/tools/commands work, API endpoints | `04-opencode-framework.md` |
| Memory, observations, LTM, session search/retrieval | `05-memory-and-sessions.md` |
| Gmail, Slack, GitHub OAuth, Pipedream actions | `06-integrations.md` |
| Slack/Telegram/Discord messaging bridge | `07-channels.md` |
| Controlling the user's local machine | `08-agent-tunnel.md` |
| Scheduled/automated agent execution | `09-agent-triggers.md` |
| Finding & installing marketplace skills | `10-registry.md` |
| Creating or refactoring skills | `11-skill-authoring.md` |
| Boot order, health checks, Docker, debugging | `12-operations.md` |
| Building/configuring agents, harness design, composition | `13-agent-harness.md` |

## Non-Negotiable Rules

1. If it must survive restarts → `/workspace`
2. Use the secret API for secrets — never write them to files
3. Use `pty_spawn` for manually started dev servers
4. Read the reference file before answering — don't rely on memory
5. Keep SKILL.md short — depth lives in references
