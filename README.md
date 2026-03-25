# Kortix

**The Autonomous Company Operating System**

A cloud computer where AI agents run your company. Full Linux sandbox, persistent memory, 78 skills, 3,000+ integrations, cron/webhook triggers, multi-channel access. Agents work 24/7 — code, APIs, documents, infrastructure — whether you're there or not.

Everything is files — markdown agents, TypeScript tools, JSON config — git-trackable, grep-searchable. The agent runtime is [OpenCode](https://github.com/nichochar/opencode).

```bash
curl -fsSL https://kortix.com/install | bash
```

## Key Internals

**Agents** — Markdown files. Frontmatter defines model, tools, permissions, triggers. Body is the system prompt. One file = one autonomous worker.

**Skills** — 78 reusable knowledge packs (14 system + 64 domain). Markdown + scripts. Loaded on demand. Covers: coding, browser automation, deep research, legal writing, spreadsheets, presentations, email, finance, compliance, and more.

**Plugins** — `opencode-pty` (persistent terminals), `opencode-morph-plugin` (multi-hunk edits), `kortix-orchestrator` (project/session management), `kortix-sessions` (persistence + search), `kortix-continuation` (session resume), `worktree` (git isolation), `anthropic-auth`.

**Triggers** — Cron schedules and webhooks defined in agent frontmatter. Fire agents automatically on time or event.

**Memory** — Filesystem-based in `/workspace/.kortix/`. Four tiers: core (every session), long-term (on demand), episodic (journals), knowledge base. Semantic search via LSS.

**Model Router** — 8 models across 5 providers (Anthropic, OpenAI, xAI, Moonshot, MiniMax, Zhipu). Unified routing through kortix-api.

## Sandbox

Docker container on `linuxserver/webtop:latest`. Multi-stage build (Rust → Alpine). Runs as user `abc` (UID 911) via s6-overlay.

| Service | Port | What |
|---------|------|------|
| `kortix-master` | 3456 | Request proxy |
| `opencode-serve` | 3111 | Agent API |
| `opencode-web` | 3210 | Web UI |
| `opencode-channels` | 8000 | Chat bridges |
| `agent-browser-*` | 9222–9224 | Browser automation |
| `sshd` | 22 | SSH |
| KDE/Selkies | 6080 | Desktop stream |

Baked binaries: OpenCode v1.2.25, agent-browser v0.19.0, OCX v2.0.0, LSS v0.5.5.

## Development

Requires: Node.js 20+, pnpm 8+, Bun 1.1+, Docker.

```bash
pnpm dev               # Frontend + API
pnpm dev:frontend      # SolidJS on Vite
pnpm dev:api           # Hono on Bun
pnpm dev:sandbox       # Sandbox with hot reload
pnpm dev:sandbox:build # Rebuild sandbox
pnpm build             # Build all
pnpm ship <version>    # Release (bump, Docker, GitHub)
pnpm nuke              # Tear down Docker
pnpm nuke:start        # Nuke + restart
```

## License

[Elastic License 2.0](LICENSE) — source-available, self-host or cloud
