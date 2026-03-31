---
name: kortix-memory
description: "Kortix memory system: global USER.md + MEMORY.md always injected, project CONTEXT.md injected for linked sessions, deeper notes referenced via subfiles. Covers CRUD via read/write/edit, token-efficient memory design, and when to store information globally vs per-project."
---

# Kortix Memory

Kortix memory is intentionally simple.

## Always-injected memory

Every chat turn gets these files injected automatically:

### Global
- `.kortix/USER.md` — user preferences, communication style, workflow habits
- `.kortix/MEMORY.md` — global stack, tools, accounts, recurring rules, environment facts

### Per-project
- `{project}/.kortix/CONTEXT.md` — injected automatically **when the session is linked to that project**

This is live, not frozen: if you update one of these files, the updated content appears on the next turn.

## Deeper notes

Keep the injected files short.

Put deeper details in subfiles and reference them from the top-level file:

- global deeper notes → `.kortix/memory/*.md`
- project deeper notes → `{project}/.kortix/docs/*.md`

Examples:

```md
# Global Memory

## Stack
- Uses Supabase + Stripe + Vercel

## References
- Billing edge cases: [billing](memory/billing.md)
- Auth migration notes: [auth-migration](memory/auth-migration.md)
```

```md
# Project Context

## Architecture
- FastAPI backend
- Next.js frontend

## References
- Deployment runbook: [deploy](docs/deploy.md)
- Schema notes: [db-schema](docs/db-schema.md)
```

The top-level files are the index. The subfiles hold the depth.

## CRUD model

Memory is just files. CRUD is done with normal file tools:

- `read` → inspect current memory/context
- `edit` → update a section without rewriting everything
- `write` → create or replace when needed

There is no special memory tool right now.

## What belongs where

### `USER.md`
Save:
- tone preferences
- formatting preferences
- workflow habits
- likes/dislikes
- identity details the agent should remember every session

Do not save:
- project architecture
- stack details
- tool config

### `MEMORY.md`
Save:
- global stack
- accounts/tools inventory
- connector status patterns
- recurring environment facts
- global conventions that matter across projects

Do not save:
- deep docs
- large logs
- project-specific details that belong in project context

### `CONTEXT.md`
Save:
- project architecture
- conventions
- setup notes
- important decisions
- references to deeper docs

Do not save:
- global user preferences
- unrelated projects
- raw debugging logs

## Token-efficiency rules

1. Keep injected files concise
2. Use bullets and short sections
3. Put depth into referenced subfiles
4. Avoid duplicates between USER.md, MEMORY.md, and CONTEXT.md
5. Only keep information that is useful across many future turns

## Practical workflow

1. Read the relevant top-level memory file first
2. Update only the needed section
3. If detail is too long, create a referenced subfile instead
4. Re-read to confirm the write succeeded

## Rule of thumb

- Personal preference? → `USER.md`
- Global recurring fact? → `MEMORY.md`
- Project-specific knowledge? → `CONTEXT.md`
- Too detailed for injection? → subfile referenced from one of the above
