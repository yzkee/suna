---
name: lss
description: "LSS reference: local semantic search over files and SQLite. Covers search, indexing, watch mode, filters, providers, and when to use BM25 vs hybrid search."
---

# LSS

LSS is the local search layer for files and SQLite databases.

Use it when you need:

- semantic recall over a codebase or docs
- hybrid BM25 + embedding search
- search over a SQLite database without building a custom adapter
- watch mode for continuously indexed local content

## Mental Model

```text
files / sqlite db
  → extract
  → normalize
  → chunk or row-documentize
  → FTS5 index
  → optional embeddings
  → hybrid search
```

SQLite is first-class:

- `.sqlite`, `.sqlite3`, `.db`, `.db3`, `.s3db`
- validated by SQLite file header
- indexed per row, not as one binary blob

## When To Use LSS

Use LSS for:

- fuzzy or semantic retrieval
- searching across many files quickly
- searching SQLite content by meaning
- repeated local search where indexing cost is worth paying once

Do not use LSS for:

- one-file exact lookups where `grep` is simpler
- structured SQL questions better answered by direct `sqlite3`
- raw filesystem reads where you already know the exact file

## Core Commands

### Search

```bash
lss "auth redirect"
lss "jwt refresh" /path/to/project
lss "session lineage" /path/to/opencode.db --json
lss "config" -k 5
```

### Index

```bash
lss index /path/to/project
lss index /path/to/opencode.db
```

### Status and inventory

```bash
lss status
lss ls
```

### Watch mode

```bash
lss watch add /path/to/project
lss-sync
```

## Filters

```bash
lss "auth" -e .py -e .ts
lss "config" -E .json -E .yaml
lss "user data" -x '\d{4}-\d{2}-\d{2}'
```

- `-e` include extensions
- `-E` exclude extensions
- `-x` exclude matching content regex

## SQLite Usage

Use LSS on SQLite when you want semantic or broad recall over DB content.

```bash
lss "Hermes vs Kortix memory" /Users/name/.local/share/opencode/opencode.db --json
lss "session lineage" /path/to/app.db
```

LSS will:

- detect real SQLite files
- inspect tables
- skip internal or obviously derived tables
- index row-level text documents with table and row metadata
- redact likely secrets before indexing

## Result Choice

Use this rough rule:

- exact structured query → `sqlite3`
- exact string in known files → `grep`
- fuzzy or semantic retrieval → `lss`

## Providers

Default provider behavior:

- `OPENAI_API_KEY` set → OpenAI embeddings
- otherwise local provider if configured
- otherwise BM25-only fallback where supported

Useful commands:

```bash
lss config provider local
lss config provider openai
```

## Data Location

Default LSS data dir:

```text
~/.lss
```

Main DB:

```text
~/.lss/lss.db
```

## Good Defaults

- use `--json` when another tool or agent will consume the output
- use `lss index` before repeated searches on a large directory or database
- use `lss-sync` when a project changes often
- use LSS on OpenCode session DBs when `session_search` needs semantic backup

## For Kortix

LSS is the deep search layer, not the session API.

- `kortix-sessions` handles prompt memory and session tools
- `lss` handles semantic retrieval over files and SQLite

Keep those roles separate.
