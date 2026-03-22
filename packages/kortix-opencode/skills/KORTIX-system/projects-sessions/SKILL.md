---
name: kortix-projects-sessions
description: "Kortix projects + sessions reference: project CRUD, worker session spawning, DONE/VERIFIED protocol, prompt memory files, session retrieval, background orchestration, and SQLite inspection."
---

# Kortix Projects + Sessions

Kortix runs two complementary systems: a **session continuity layer** for memory and history retrieval, and a **projects + orchestration layer** for long-running autonomous work. This skill covers both.

---

## Mental Model

Three continuity layers:

| Layer | Purpose | Default behavior |
|---|---|---|
| **Merged memory files** | Tiny stable preferences and facts | Injected as a small merged prompt block every turn |
| **Session tools** | Past conversation and tool history | Retrieved on demand |
| **Skills and files on disk** | Reusable workflows and detailed durable notes | Loaded only when needed |

Tiny hot memory. Sessions as the historical record. Procedural knowledge in skills and files. No giant ambient memory dump every turn.

---

## Tiny Prompt Memory

Four markdown files are durable prompt memory, auto-merged and injected each turn:

| Scope | File | Purpose |
|---|---|---|
| Global | `.kortix/USER.md` | User-wide preferences and communication style |
| Global | `.kortix/MEMORY.md` | Cross-project facts and recurring rules |
| Project | `<project>/.kortix/USER.md` | Project-specific user preferences |
| Project | `<project>/.kortix/MEMORY.md` | Project conventions, commands, architecture notes |

**Merge order** (project overrides global, duplicates removed):
1. project `USER.md`
2. project `MEMORY.md`
3. global `USER.md`
4. global `MEMORY.md`

**Write to memory files:**
- stable preferences, recurring repo conventions, durable environment facts, small rules

**Do NOT write to memory files:**
- task progress, raw tool output, logs, debugging trails, large historical context, secrets

### Where `.kortix/` lives

The global `.kortix/` directory is resolved at runtime:

1. `KORTIX_DIR` env var (explicit override)
2. `KORTIX_WORKSPACE` env var → `{KORTIX_WORKSPACE}/.kortix/`
3. `OPENCODE_CONFIG_DIR` env var → parent directory → `.kortix/`
4. Git repo root of the plugin anchor dir → `.kortix/`
5. Fallback: `$HOME/.kortix/`

On a local macOS dev machine with the heyagi repo, the global `.kortix/` is at `/Users/<user>/Projects/heyagi/.opencode/.kortix/`. The orchestrator DB (`kortix.db`) lives inside it.

---

## Session Retrieval Tools

### `session_list`

Browse recent sessions by metadata.

```text
session_list()
session_list({ search: "auth" })
session_list({ limit: 50 })
```

Returns: ID, title, timestamps, file change summary, parent ID.

### `session_search`

Full-text search over session titles, messages, and part payloads.

```text
session_search({ query: "auth redirect" })
session_search({ query: "memory simplification", limit: 3 })
```

Returns: compact session-level hits with reason and snippet.

### `session_get`

Retrieve one session with TTC compression (semantic transcript compression).

```text
session_get({ session_id: "ses_abc123" })
session_get({ session_id: "ses_abc123", aggressiveness: 0.7 })
```

Returns: metadata, todos, lineage summary, conversation transcript.
Requires `TTC_API_KEY` env var; falls back to uncompressed if not set.

### `session_lineage`

Trace parent/child continuation chains via OpenCode's `parentID` links.

```text
session_lineage({ session_id: "ses_abc123" })
```

Use when a conversation continued across compression or resumed sessions.

---

## Projects System

Projects are named, path-bound work contexts managed by the Kortix Orchestrator plugin. Each project has its own directory structure, `.kortix/` metadata, and a session delegation log.

### Project Tools

| Tool | Description |
|---|---|
| `project_create(name, description, path)` | Register a directory. Creates scaffold if new. Idempotent. |
| `project_list()` | List all projects. Auto-discovers `.kortix/project.json` markers on disk. |
| `project_get(name)` | Get one project. Accepts name (fuzzy) or absolute path. |
| `project_update(project, name, description)` | Update name or description. Syncs to OpenCode and `project.json`. |

### Project Directory Scaffold

When `project_create` makes a new project, it creates:

```
<project>/
├── .kortix/
│   ├── project.json        # identity marker { name, description, created }
│   ├── context.md          # shared project context — read by every worker session
│   ├── USER.md             # project-level user preferences (prompt memory)
│   ├── MEMORY.md           # project-level conventions (prompt memory)
│   ├── plans/              # plans and roadmaps
│   ├── docs/               # shared docs for cross-session context
│   └── sessions/           # persisted session results (auto-written on completion)
├── .opencode/
│   ├── agents/
│   ├── skills/
│   ├── commands/
│   └── opencode.jsonc
└── .gitignore
```

A git repo is initialized automatically if one doesn't exist.

### Project Discovery

`project_list()` uses three sources in order:

1. **Filesystem scan** — walks up to 2 levels from workspace root looking for `.kortix/project.json`
2. **OpenCode project sync** — queries the OpenCode API to register any OC projects missing from Kortix, and link `opencode_id` bidirectionally
3. **Unlinked resolution** — triggers OC registration for projects with `.git` but no `opencode_id`

### Kortix Orchestrator Database

The orchestrator plugin stores its state in SQLite:

```text
<workspace-root>/.kortix/kortix.db
```

Two tables:
- `projects` — id, name, path, description, created_at, opencode_id
- `delegations` — session_id, project_id, prompt, agent, parent_session_id, status, result, created_at, completed_at

Query directly when you need raw access:

```bash
sqlite3 /path/to/.kortix/kortix.db \
  "SELECT session_id, status, substr(prompt,1,80) FROM delegations ORDER BY created_at DESC LIMIT 10;"
```

---

## Background Sessions (Orchestration)

Background sessions are the primary mechanism for parallel autonomous work. They run the `/autowork` loop and report back when done.

### Primary Tools

| Tool | Scope | Notes |
|---|---|---|
| `session_start_background` | New: project-scoped. Resume: session-scoped | Preferred tool |
| `session_list_background` | Optional project scope | With `project` → filters; without → cross-project |
| `session_read` | Session-scoped | Reads running or completed sessions |
| `session_message` | Session-scoped | Sends message into a running session |

### Compatibility Aliases

- `session_spawn` = `session_start_background`
- `session_list_spawned` = `session_list_background`

### Spawn vs Resume

**New session** — pass `project` (name or path), `prompt`, optionally `agent`, `model`, `command`:

```text
session_start_background({
  project: "my-project",
  description: "Short label",
  prompt: "Implement X feature with tests...",
  agent: "",        // "" = kortix (default)
  model: "",        // "" = agent default
  command: "",      // "" = /autowork (default)
  session_id: "",   // "" = create new
  subagent_type: "" // alias for agent
})
```

**Resume existing session** — pass `session_id` instead of (or alongside) `project`:

```text
session_start_background({
  session_id: "ses_abc123",
  prompt: "Continue from where you left off, now also handle edge case X",
  project: "",  // can be omitted when resuming
  ...
})
```

### Command Variants

- `""` or `"/autowork"` — full autowork loop with DONE/VERIFIED protocol
- `"none"` — one-shot (no continuation loop)
- Any other command string — that command is prepended to the assignment

### Worker Session Assignment

Every spawned session receives a structured prompt that includes:

```
/autowork  (or the specified command)

## Assignment

**Project:** <name> — `<path>`
**Session:** <session_id>

## Session Work

<the prompt you provided>

## Project Context

<contents of .kortix/context.md>

## Other Active Sessions in This Project

<list of sibling sessions and their prompts>

## Rules

1. Working directory: `<project path>` — use workdir on bash commands.
2. Stay in your lane. Only modify files within your task scope.
3. TDD: Write tests FIRST. Implement to pass. Verify after every change.
4. Update `.kortix/context.md` with discoveries and decisions.
5. Write docs to `.kortix/docs/` for shared context.
6. Include test results in your final message.
7. When done, emit <promise>DONE</promise> then <promise>VERIFIED</promise>.
```

Sibling session awareness prevents file conflicts when multiple workers run in parallel.

### Reporting Model

On completion or failure, the orchestrator:

1. Waits for 10 seconds of continuous idle (debounced — active autowork resets the timer)
2. Scans assistant messages for `<promise>DONE</promise>` and `<promise>VERIFIED</promise>`
3. Sets status: `complete` (VERIFIED), `failed` (DONE without VERIFIED or no DONE), or `failed` (timed out idle)
4. Persists result to `.kortix/sessions/<session_id_last_12_chars>.md` in the project
5. Sends `<session-report>` back to the parent session

**Session report format:**

```xml
<session-report>
<session-id>ses_abc123</session-id>
<status>COMPLETE</status>
<project>my-project</project>
<prompt>Implement X feature...</prompt>
<result>
Last assistant output (up to 3000 chars)
</result>
</session-report>
```

### Reading Session State

```text
session_read({ session_id: "ses_abc123", mode: "summary" })
session_read({ session_id: "ses_abc123", mode: "tools" })
session_read({ session_id: "ses_abc123", mode: "full" })
session_read({ session_id: "ses_abc123", mode: "search", pattern: "error|TypeError" })
```

Modes:
- `summary` (default) — status, stats, last 3 text outputs. Use this first.
- `tools` — every tool call with truncated I/O. See what the session did.
- `full` — complete transcript. Expensive.
- `search` — filter messages by regex. Find errors, specific output.

Works on any session ID, not just spawned ones.

### Scoping Rules

1. For new background work: pass `project`.
2. For resume: pass `session_id`.
3. `session_read` and `session_message` are always session-scoped.
4. Omitting `project` on `session_list_background` = cross-project orchestration view.

---

## Prompt Behavior

Each turn, Kortix injects a small block into the prompt:

```xml
<session_context>
Session ID: ses_abc123
</session_context>

<memory>
## Project User
...project USER.md content...

## Project Memory
...project MEMORY.md content...

## Global User
...global USER.md content...

## Global Memory
...global MEMORY.md content...
</memory>
```

Duplicates across files are removed. Empty sections are omitted.

---

## Filesystem Persistence

The filesystem is the most reliable long-term storage for high-fidelity information.

| What to store | Where |
|---|---|
| Plans, handoff notes, decisions, architecture | Files in project or `.kortix/docs/` |
| Conversation history | Session tools (`session_get`, `session_search`) |
| Tiny stable preferences and rules | `USER.md` / `MEMORY.md` |
| Worker session results | Auto-written to `.kortix/sessions/` on completion |

Rule of thumb:
- Future session needs exact content → write a file
- It's conversation history → use session tools
- It's a tiny recurring preference → use `USER.md` or `MEMORY.md`

---

## Direct SQLite Access

### Locate the databases first

The DB paths vary by environment. Always discover them rather than hardcoding:

```bash
# OpenCode session DB
OC_DB=$(find ~ -name "opencode.db" -path "*/opencode/*" 2>/dev/null | head -1)
echo "OpenCode DB: $OC_DB"

# Kortix orchestrator DB — lives in .kortix/ at the workspace/git root
KORTIX_DB=$(find ~ -name "kortix.db" -path "*/.kortix/*" 2>/dev/null | head -1)
echo "Kortix DB:   $KORTIX_DB"
```

Run that once per session and substitute `$OC_DB` / `$KORTIX_DB` in the queries below.

### OpenCode session DB queries

```bash
# Recent sessions
sqlite3 -readonly "$OC_DB" \
  "SELECT id, title FROM session ORDER BY time_updated DESC LIMIT 10;"

# Search by content
sqlite3 -readonly "$OC_DB" \
  "SELECT s.id, s.title FROM message m JOIN session s ON s.id = m.session_id WHERE m.data LIKE '%auth%';"
```

### Orchestrator DB queries

```bash
# Recent delegations
sqlite3 "$KORTIX_DB" \
  "SELECT session_id, status, substr(prompt,1,80) FROM delegations ORDER BY created_at DESC LIMIT 10;"

# All projects
sqlite3 "$KORTIX_DB" \
  "SELECT name, path, description FROM projects;"
```

### Stored JSON and Grep

```bash
# Find sessions that touched a specific file
OC_STORAGE=$(dirname "$OC_DB")/storage
grep -rl 'middleware/auth.ts' "$OC_STORAGE"/
grep -rl '"tool":"Write"' "$OC_STORAGE"/
```

---

## LSS

For semantic retrieval over files or SQLite rows, load the standalone `lss` skill.

Keep the split clear:
- `kortix-projects-sessions` = prompt memory + session tools + background session behavior + projects
- `lss` = semantic and hybrid search over files and SQLite

---

## Decision Guide

```text
Need one specific session?
  → session_get

Need to browse likely sessions?
  → session_list

Need to search prior work by text?
  → session_search

Need to understand continuation chains?
  → session_lineage

Need substantial parallel work?
  → session_start_background (new: pass project; resume: pass session_id)

Need to check worker status?
  → session_list_background (project name = filter; "" = all)

Need to read worker output?
  → session_read (summary mode first; full only if needed)

Need to steer a running worker?
  → session_message

Need raw DB queries?
  → sqlite3 on kortix.db (orchestrator) or opencode.db (sessions)

Need semantic recall?
  → load lss skill

Need to create/manage projects?
  → project_create / project_list / project_get / project_update
```
