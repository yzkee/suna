# Kortix Skill Pack

This directory is the built-in skill pack for `computer/packages/kortix-opencode`.

## What lives here

- Built-in operational skills that ship with the Kortix OpenCode config
- Each skill keeps `SKILL.md` small and pushes long-form docs into `references/` subfolders
- `KORTIX-system/` is the unified platform reference — sandbox, framework, memory, integrations, channels, tunnel, triggers, registry, and operations

## Layout

- `*/SKILL.md` — discovery surface and loading instructions
- `*/references/` — deep documentation loaded on demand with `read`
- `*/scripts/` — executable helpers when a skill needs them
- `*/assets/` — static supporting files

## Built-in skills

| Skill | Purpose |
|---|---|
| `KORTIX-system/` | Complete platform reference (12 reference files covering all subsystems) |
| `agent-browser/` | Browser automation CLI |
| `agent-harness/` | Agent engineering — build, configure, wire up agents |
| `presentations/` | HTML slide deck creation, export, preview |

## KORTIX-system structure

Unified reference with 12 topical files:

| File | Covers |
|---|---|
| `references/01-architecture.md` | Container, paths, services, ports, auth, runtimes |
| `references/02-persistence.md` | What survives restarts, safe install patterns |
| `references/03-environment-and-secrets.md` | Env vars, secret API, encryption |
| `references/04-opencode-framework.md` | Agents, skills, tools, commands, sessions, providers, config, API |
| `references/05-memory-and-sessions.md` | Memory plugin, LTM, session search (plugin, SQL, grep, lss) |
| `references/06-integrations.md` | OAuth, Pipedream actions, proxyFetch |
| `references/07-channels.md` | Slack/Telegram/Discord bridge, session tracking |
| `references/08-agent-tunnel.md` | Local machine control via tunnel |
| `references/09-agent-triggers.md` | Cron, webhook, Pipedream event triggers |
| `references/10-registry.md` | OCX registry, skill discovery & install |
| `references/11-skill-authoring.md` | Skill layout, SKILL.md format |
| `references/12-operations.md` | Init scripts, health checks, Docker dev |

## Registry skills (installable via `ocx add`)

Additional skills live in the OCX registry and are installed on demand:
`deep-research`, `docx`, `domain-research`, `elevenlabs`, `email`, `fullstack-vite-convex`, `legal-writer`, `logo-creator`, `openalex-paper-search`, `paper-creator`, `pdf`, `remotion`, `replicate`, `woa`, `xlsx`
