# Memory and Session Search

Memory plugin, long-term memory, filesystem persistence, session search & retrieval.

---

## Decision Tree

```
Need conversation content from a specific session?
  → session_get (compressed, structured)

Need to browse/filter sessions by title?
  → session_list (quick metadata scan)

Need to search INSIDE message content across sessions?
  → grep on legacy JSON, or SQL LIKE on messages table

Need to find sessions by semantic meaning?
  → lss over storage directory

Need cost/token stats or complex joins?
  → Direct SQLite queries

Need to check what's running right now?
  → REST API: GET /session/status
```

---

## 1. Memory Plugin (kortix-memory)

Automatic system that captures, consolidates, and recalls knowledge across sessions.

### Pipeline

```
Tool calls → Observations (automatic per call)
  → Stored in SQLite (~/.kortix/memory.db)
  → Compaction triggers LTM consolidation
    → LLM extracts episodic/semantic/procedural memories
    → Deduplicates against existing LTM
    → Stored in long_term_memories table
  → LTM auto-recalled every turn (relevant memories injected)
```

### Tools

| Tool | Purpose |
|---|---|
| `mem_search` | Search observations + LTM (LTM ranked higher) |
| `mem_save` | Manually persist to LTM (use sparingly — auto-pipeline handles most) |
| `session_list` | Browse sessions by metadata (IDs, titles, timestamps) |
| `session_get` | Retrieve full conversation (compressed via TTC) |

### Memory Categories

| Category | What | Example |
|---|---|---|
| **Episodic** | Events | "Migrated DB from Postgres to SQLite on Jan 15" |
| **Semantic** | Facts | "API rate limit is 100 req/min per user" |
| **Procedural** | How-to | "Deploy: `bun build` then `bun run deploy`" |

---

## 2. Filesystem Persistence

The filesystem is the most reliable long-term storage. `/workspace` persists across restarts.

### What to Write to Disk

- **Plans** — before starting complex multi-step work
- **Progress** — track what's done vs remaining
- **Handoff notes** — for continuation in another session
- **Decisions** — architectural choices with rationale
- **Findings** — research results, debugging discoveries

### How Filesystem + Memory Reinforce Each Other

```
Write a file → File on disk permanently (ground truth)
             → Write observation → compaction → LTM → auto-recalled
```

| System | Strength | Best for |
|---|---|---|
| **Filesystem** | Full fidelity, any session can read | Plans, progress, detailed notes |
| **Memory plugin** | Auto-surfaces relevant knowledge | Ambient context, cross-session recall |

**Rule:** If a future session might need to `cat` the info → write a file. If it's ambient context → let memory handle it. For critical items → do both.

---

## 3. Session Plugin Tools

### session_list

```
session_list()                          # 20 most recent
session_list({ search: "auth" })        # Filter by title
session_list({ limit: 50 })             # More results
```

Returns: ID (`ses_*`), title, timestamps, file change stats, parent ID, storage paths.

### session_get

```
session_get({ session_id: "ses_abc123" })                      # Default 0.3
session_get({ session_id: "ses_abc123", aggressiveness: 0.1 }) # Light compression
session_get({ session_id: "ses_abc123", aggressiveness: 0.7 }) # Heavy, just the gist
```

| Aggressiveness | Reduction | Use case |
|---|---|---|
| 0.1 | ~10% | Recent/important sessions, full detail |
| 0.3 | ~16% | Default balanced |
| 0.5 | ~22% | Older sessions, broad strokes |
| 0.7+ | ~31%+ | Scanning many, just the essence |

Requires `TTC_API_KEY`. Returns: metadata + compressed conversation + tool call summaries.

---

## 4. Raw SQLite Queries

**Database:** `/workspace/.local/share/opencode/opencode.db`

```bash
# List recent sessions
sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT id, title, created_at FROM session ORDER BY created_at DESC LIMIT 10;"

# Find by title keyword
sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT id, title FROM session WHERE title LIKE '%auth%';"

# Session cost summary
sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT m.session_id, s.title, SUM(m.cost) as total_cost
   FROM message m JOIN session s ON m.session_id = s.id
   GROUP BY m.session_id ORDER BY total_cost DESC LIMIT 10;"

# Sessions with most tool calls
sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT m.session_id, s.title, COUNT(*) as tool_count
   FROM part p JOIN message m ON p.message_id = m.id JOIN session s ON m.session_id = s.id
   WHERE p.type = 'tool'
   GROUP BY m.session_id ORDER BY tool_count DESC LIMIT 10;"

# Sessions that modified a specific file
sqlite3 -readonly /workspace/.local/share/opencode/opencode.db \
  "SELECT DISTINCT m.session_id, s.title
   FROM part p JOIN message m ON p.message_id = m.id JOIN session s ON m.session_id = s.id
   WHERE p.type = 'tool' AND p.tool = 'Write' AND p.input LIKE '%session.ts%';"
```

---

## 5. REST API

```bash
curl http://localhost:8000/session                       # List all
curl http://localhost:8000/session/SESSION_ID             # Get metadata
curl http://localhost:8000/session/SESSION_ID/message     # Get messages (raw)
curl http://localhost:8000/session/status                 # What's running
curl -X DELETE http://localhost:8000/session/SESSION_ID   # Delete
```

---

## 6. Grep on Legacy JSON

For exact keyword matches inside message content across all sessions.

**Storage layout:**

```
/workspace/.local/share/opencode/storage/
├── session/global/ses_*.json     # Session metadata
├── message/ses_*/msg_*.json      # Messages per session
├── part/msg_*/prt_*.json         # Content parts (text, tool calls, output)
└── todo/ses_*.json               # Todos per session
```

```bash
grep -rl '"title".*JWT' /workspace/.local/share/opencode/storage/session/global/
grep -rl '"tool":"Write"' /workspace/.local/share/opencode/storage/part/ | head -20
grep -rl 'middleware/auth.ts' /workspace/.local/share/opencode/storage/part/
```

**Use grep** for raw tool outputs or message text. **Use SQL** for structured queries.

---

## 7. Semantic Search (lss)

BM25 + embedding similarity. Continuously updated by `lss-sync`.

```bash
lss "your query" -p /workspace -k 10 --json
lss "auth logic" -p /workspace -e .py -e .ts -k 10 --json
lss "config" -p /workspace -E .json -E .yaml -k 10 --json
lss index /workspace/important-file.md
lss status
```

### HTTP API

```bash
curl "http://localhost:8000/lss/search?q=auth+logic&k=10&path=/workspace&ext=.ts,.py"
curl "http://localhost:8000/lss/status"
```

| Use lss | Use grep |
|---|---|
| Conceptual / fuzzy queries | Exact strings |
| Cross-file discovery | Known identifiers |
| Semantic similarity | Literal pattern matching |

---

## 8. Context Window Management

When context fills → **compaction** fires → older messages compressed → observations consolidated into LTM.

### Rules

1. Don't keep large file contents in conversation — read, act, move on
2. Don't repeat yourself — reference files instead
3. Persist early — write to disk so it survives compaction
4. Search before re-investigating — `mem_search` first
5. Write handoff notes proactively — after milestones, not just session end

---

## Combined Workflow

1. **session_list** — scan titles for candidates
2. **session_get** at 0.7 — quick compressed overview
3. **session_get** at 0.1 — full detail on most relevant
4. **grep** on parts — find specific tool calls verbatim
5. **SQL** — cost/token stats or cross-session aggregations
6. **lss** — when keyword search fails, search by meaning
