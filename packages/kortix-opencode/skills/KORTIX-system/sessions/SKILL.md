---
name: kortix-sessions
description: "Kortix session reference: prompt memory files, session retrieval, background sessions, and direct SQLite session inspection."
---

# Kortix Sessions

Kortix uses a session-first continuity model.

It keeps only tiny always-available memory in markdown files, and retrieves everything larger from OpenCode sessions on demand.

## Mental Model

Kortix has three continuity layers:

| Layer | Purpose | Default behavior |
|---|---|---|
| **Merged memory files** | Tiny stable preferences and facts | Injected as a small merged prompt block |
| **Session tools** | Past conversation and tool history | Retrieved on demand |
| **Skills and files on disk** | Reusable workflows and detailed durable notes | Loaded only when needed |

This is intentionally close to Hermes's design:

- tiny hot memory
- sessions as the historical record
- procedural knowledge in skills and files
- no giant ambient memory dump every turn

## Tiny Prompt Memory

Kortix keeps only four markdown files as durable prompt memory:

| Scope | File | Purpose |
|---|---|---|
| Global | `.kortix/USER.md` | User-wide preferences and communication style |
| Global | `.kortix/MEMORY.md` | Cross-project facts and recurring rules |
| Project | `<project>/.kortix/USER.md` | Project-specific user preferences |
| Project | `<project>/.kortix/MEMORY.md` | Project conventions, commands, architecture notes |

They are auto-created and merged into one prompt block in this order:

1. project `USER.md`
2. project `MEMORY.md`
3. global `USER.md`
4. global `MEMORY.md`

Project-local content overrides conflicting global content. Duplicate lines are removed.

### Put these in memory files

- stable preferences
- recurring repo conventions
- durable environment facts
- small rules worth carrying into every session

### Do not put these in memory files

- task progress
- raw tool output
- logs
- transient debugging trails
- large historical context
- secrets or tokens

If it is large, historical, or specific to one past task, keep it in sessions or files instead of prompt memory.

## Core Session Tools

### `session_list`

Browse likely sessions by metadata.

```text
session_list()
session_list({ search: "auth" })
session_list({ limit: 50 })
```

Returns: ID, title, timestamps, file change summary, and parent ID.

### `session_search`

Search prior sessions by title, message content, and part content.

```text
session_search({ query: "auth redirect" })
session_search({ query: "memory simplification", limit: 3 })
```

Returns: compact session-level hits with reason and snippet.

### `session_get`

Inspect one session deeply in compressed, structured form.

```text
session_get({ session_id: "ses_abc123" })
session_get({ session_id: "ses_abc123", aggressiveness: 0.7 })
```

Returns: metadata, todos, lineage summary, and conversation transcript.

### `session_lineage`

Follow parent/child continuation chains.

```text
session_lineage({ session_id: "ses_abc123" })
```

Use this when a conversation continued across compression or resumed sessions.

## Background Sessions

Kortix also has project-aware background sessions for substantial parallel work.

### Primary tools

| Tool | Scope model | Notes |
|---|---|---|
| `session_start_background` | Project-scoped for new sessions; session-scoped for resume | Preferred tool |
| `session_list_background` | Optional project scope | With `project`, shows one project's background sessions; without it, shows cross-project orchestration scope |
| `session_read` | Session-scoped | Reads any readable background session by `session_id` |
| `session_message` | Session-scoped | Sends a message into a running background session |

### Compatibility aliases

- `session_spawn` = `session_start_background`
- `session_list_spawned` = `session_list_background`

### Scoping rules

1. For new background work, pass `project`.
2. For resume, pass `session_id`.
3. `session_read` and `session_message` are always session-scoped.
4. Omitting `project` on `session_list_background` means cross-project orchestration scope, not a default project.

### Reporting model

- completion returns a `<session-report>` to the parent session
- background work is session-native, not task-native

## Prompt Behavior

When a session is running, Kortix exposes only:

- `<session_context>` with the current session id
- `<memory>` with the merged tiny memory-file block

The prompt does not carry a large synthesized observation or long-term-memory block.

## Filesystem Persistence

The filesystem is still the most reliable long-term storage for high-fidelity information.

Use files for:

- plans
- handoff notes
- decisions
- findings
- architecture writeups

Rule of thumb:

- if any future session might need to read the exact content, write a file
- if the value is conversation history, use session tools
- if the value is a tiny recurring preference or rule, use `USER.md` or `MEMORY.md`

## Raw SQLite Queries

Database path:

```text
/workspace/.local/share/opencode/opencode.db
```

Examples:

```bash
sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT id, title FROM session ORDER BY time_updated DESC LIMIT 10;"

sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT s.id, s.title FROM message m JOIN session s ON s.id = m.session_id WHERE m.data LIKE '%auth%';"
```

## Stored JSON and Grep

OpenCode also stores session/message/part JSON on disk.

Use grep when you need raw exact matches across stored content:

```bash
grep -rl 'middleware/auth.ts' /workspace/.local/share/opencode/storage/
grep -rl '"tool":"Write"' /workspace/.local/share/opencode/storage/
```

## LSS

For semantic retrieval over files or SQLite, load the standalone `lss` skill.

Keep the split clear:

- `kortix-sessions` = prompt memory + session tools + background session behavior
- `lss` = semantic and hybrid search over files and SQLite

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
  → session_start_background

Need exact structured queries?
  → sqlite3 on opencode.db

Need semantic recall?
  → load `lss`
```
