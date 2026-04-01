---
name: opencode-framework
description: "OpenCode framework reference: agents, skills, tools, commands, sessions, providers, plugins, configuration, REST API, and SSE."
---

# OpenCode Framework

The AI agent framework that powers the Kortix environment. Manages agents, skills, tools, commands, sessions, providers, and plugins.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  OpenCode                                            │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Agents   │  │  Skills   │  │  Tools    │          │
│  │ (.md)     │  │ (SKILL.md)│  │ (.ts)     │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                 │
│  ┌────▼──────────────▼──────────────▼─────┐          │
│  │              Session Engine              │          │
│  │  (prompt → model → tool calls → text)   │          │
│  └────────────────┬───────────────────────┘          │
│                   │                                   │
│  ┌────────────────▼───────────────────────┐          │
│  │            Provider Layer               │          │
│  │  (Anthropic, OpenAI, Kortix router)     │          │
│  └────────────────────────────────────────┘          │
│                                                      │
│  Config: opencode.jsonc  │  Plugins  │  MCP Servers  │
└─────────────────────────────────────────────────────┘
```

---

## Agents

An agent is a **persona** — system prompt + permission rules + model preferences. Defined as `.md` files with YAML frontmatter in `agents/`.

### Definition File

```markdown
---
description: "Short description shown in UI and Task tool"
model: provider/model-id
mode: primary
permission:
  bash: allow
  edit: allow
  read: allow
  task: allow
  skill: allow
---

# Agent Name

System prompt content. This entire markdown body becomes the agent's system prompt.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | Yes | Shown in UI and Task tool |
| `mode` | `primary` / `subagent` / `all` | Yes | Controls visibility |
| `model` | string | No | Default model (`provider/model-id`) |
| `permission` | object | No | Tool permissions (`allow` / `deny`) |
| `temperature` | number | No | Model temperature |
| `topP` | number | No | Top-P sampling |
| `steps` | number | No | Max tool-use steps per turn |
| `hidden` | boolean | No | Hide from UI |

### Agent Modes

| Mode | User-selectable | Task tool | Use case |
|---|---|---|---|
| `primary` | Yes | Hidden from list, but **can be spawned by name** | Main user-facing agent |
| `subagent` | No | Listed and spawnable | Specialist agents |
| `all` | Yes | Yes | Available everywhere |

**Key:** `Agent.get()` has no mode guard — a primary agent CAN self-spawn by name via `subagent_type`.

### Name Derivation

Filename without `.md`. Nested paths: only filename matters (`agents/special/my-agent.md` → `my-agent`).

### Loading Order

1. Built-in agents (compaction, title, summary — hidden infrastructure)
2. Config directory agents (`agents/*.md`)
3. Config overrides from `opencode.jsonc` `"agent"` section

### Disabling Built-in Agents

```jsonc
{ "agent": { "build": { "disable": true }, "plan": { "disable": true } } }
```

---

## Skills

A skill is a **knowledge package** — domain instructions injected into context when loaded via `skill()`.

### Structure

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: supplementary docs
└── assets/           # Optional: templates, images
```

### SKILL.md Format

```markdown
---
name: my-skill
description: "Detailed trigger description."
---

# Skill Title
Instructions loaded into context.
```

### Discovery (loaded in order, later overwrites earlier)

1. Global: `~/.claude/skills/**/SKILL.md`, `~/.agents/skills/**/SKILL.md`
2. Project: Walk up from project dir for `.claude/skills/`, `.agents/skills/`
3. Config dirs: `{config}/skills/**/SKILL.md`
4. Additional paths: `opencode.jsonc` → `skills.paths`
5. URL downloads: `opencode.jsonc` → `skills.urls`

### Loading Flow

1. Startup: scan all SKILL.md, extract **name + description** (~100 tokens each)
2. Descriptions listed in `skill` tool's available_skills
3. Agent decides when to load based on descriptions
4. `skill({ name: "..." })` → full SKILL.md body injected into context
5. Bundled files listed but not loaded — agent reads as needed

---

## Tools

### Built-in Tools

| Tool | Description |
|---|---|
| `bash` | Execute shell commands |
| `read` | Read files |
| `edit` | Edit files (string replacement) |
| `write` | Write/create files |
| `glob` | File pattern matching |
| `grep` | Content search |
| `task` | Spawn subagent sessions |
| `skill` | Load skills |
| `todowrite` | Manage task list |
| `todoread` | Read task list |
| `question` | Ask user questions |

### Custom Tools

TypeScript files in `tools/*.ts`:

```typescript
import { Tool } from "opencode/tool"
import z from "zod"

export default Tool.define("my-tool", async (ctx) => {
  return {
    description: "What this tool does",
    parameters: z.object({ input: z.string() }),
    async execute(params, ctx) {
      return { title: "Result", output: "Output text" }
    },
  }
})
```

### MCP Tools

External tools via Model Context Protocol servers:

```jsonc
{ "mcp": { "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" } } }
```

### Permission System

Checked per-tool-call: agent-level → session-level → global. With `"permission": "allow"`, all auto-approved.

---

## Commands

Slash-triggered workflows. Markdown files in `commands/`:

```markdown
---
description: "What this command does"
agent: kortix
---

Prompt template. $ARGUMENTS replaced with user input after command name.
```

Routing: `/work-loop fix auth` → load `commands/work-loop.md` → send to specified agent.

---

## Sessions

### Lifecycle

```
CREATE → PROMPT → BUSY (tool calls, text) → IDLE → PROMPT again...
                                            → ABORT / DELETE
```

### Subagent Sessions

Task tool spawns child session with `parentID` → applies restrictions (todowrite/todoread denied) → sends prompt → waits → returns last text part.

### Storage Layout

```
.local/share/opencode/storage/
├── session/global/ses_*.json     # Session metadata
├── message/ses_*/msg_*.json      # Messages
├── part/msg_*/prt_*.json         # Content parts (text, tool calls)
├── todo/ses_*.json               # Todo lists
└── tool-output/tool_*            # Large tool outputs
```

---

## Configuration

### opencode.jsonc

Main config file. In sandbox: `$OPENCODE_CONFIG_DIR/opencode.jsonc`

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow",
  "default_agent": "kortix",
  "autoupdate": true,
  "plugin": ["opencode-pty", "./plugin/worktree.ts", "./plugin/memory.ts"],
  "agent": { "build": { "disable": true } },
  "provider": {
    "kortix": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "{env:KORTIX_API_URL}/v1/router", "apiKey": "{env:KORTIX_TOKEN}" },
      "models": { "kortix/power": { "name": "Kortix Power", "cost": { "input": 5, "output": 25 } } }
    }
  },
  "mcp": { "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" } }
}
```

### Config Discovery (merged in order)

1. `.opencode/` in CWD and parent directories
2. `$OPENCODE_CONFIG_DIR` (e.g., `/ephemeral/kortix-master/opencode/`)
3. Global: `~/.config/opencode/`

### Environment Variable Interpolation

`{env:VAR_NAME}` in config values: `{ "baseURL": "{env:KORTIX_API_URL}/v1/router" }`

---

## Provider System

```jsonc
{
  "provider": {
    "name": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "...", "apiKey": "..." },
      "models": {
        "name/model": { "name": "Display", "cost": { "input": 3, "output": 15 }, "limit": { "context": 200000 } }
      }
    }
  }
}
```

Models referenced as `provider/model-id` everywhere.

---

## REST API

Base URL: `http://localhost:3111` (or via Kortix Master at `localhost:8000`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/session` | List all sessions |
| `POST` | `/session` | Create session |
| `GET` | `/session/{id}` | Get session |
| `DELETE` | `/session/{id}` | Delete session |
| `GET` | `/session/{id}/message` | All messages with parts |
| `POST` | `/session/{id}/message` | Send message (sync) |
| `POST` | `/session/{id}/prompt_async` | Send prompt (fire-and-forget) |
| `GET` | `/session/{id}/children` | List subagent sessions |
| `POST` | `/session/{id}/abort` | Abort running session |
| `GET` | `/session/status` | Map of busy sessions |
| `GET` | `/config` | Full config |
| `GET` | `/agent` | All agents |
| `GET` | `/provider` | Providers and models |
| `GET` | `/skill` | All skills with content |
| `GET` | `/event` | SSE event stream |

### SSE Events

`GET /event` returns Server-Sent Events:

Event types: `server.connected`, `session.status`, `session.idle`, `session.updated`, `message.updated`, `message.part.updated`, `session.diff`, `file.edited`, `command.executed`

---

## Key Files

| Path | Description |
|---|---|
| `opencode.jsonc` | Main configuration |
| `agents/*.md` | Agent definitions |
| `skills/*/SKILL.md` | Skill definitions |
| `tools/*.ts` | Custom tool implementations |
| `commands/*.md` | Slash command definitions |
| `plugin/*.ts` | Local plugins |
