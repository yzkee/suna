# Using Scripts In Skills

Use this reference when a skill needs bundled automation or repeated shell logic.

## When To Bundle A Script

- the agent keeps rewriting the same helper logic
- a command is too complex to trust inline every time
- validation should be reusable and deterministic
- parsing or transformation logic is repeated across tasks

## Script Placement

- Put reusable scripts in `scripts/` inside the skill directory.
- Reference them with relative paths from the skill root.
- List them in `SKILL.md` so the agent knows they exist.

## Script Design Rules

- no interactive prompts
- provide `--help`
- use clear error messages
- prefer structured stdout
- send diagnostics to stderr
- support safe defaults, dry-run flags, and idempotent behavior when relevant
- keep output sizes predictable

## Inline Dependency Patterns

Prefer self-contained scripts when practical:
- Python: `uv run` with PEP 723 inline metadata
- Bun: `bun run` for Bun-native scripts
- Deno: `deno run` with explicit imports

## One-Off Commands

Inline commands are fine when they are short, reproducible, and already supported by the environment.

Good candidates:
- `bunx eslint@9 --fix .`
- `uv run scripts/extract.py`

If a command becomes fragile or repetitive, promote it into a bundled script.
