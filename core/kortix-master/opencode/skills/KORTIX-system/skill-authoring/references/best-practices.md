# Skill Authoring Best Practices

Use this reference when designing or refactoring a skill's actual content.

## Start From Real Expertise

- Prefer extracting a skill from a successful real task, not from a generic prompt.
- Pull from corrections, execution traces, project conventions, incident notes, code review comments, and real failure cases.
- The most useful skill content usually captures what the base model would otherwise miss.

## Scope The Skill Carefully

- A skill should cover one coherent unit of work.
- If a skill is too narrow, many skills must load together.
- If a skill is too broad, discovery gets noisy and instructions conflict.
- Prefer moderate detail over giant manuals.

## Spend Context Wisely

- Add what the agent lacks.
- Omit generic background the agent already knows.
- Keep the root `SKILL.md` focused on the instructions needed every time.
- Move detailed support material into `references/` and tell the agent exactly when to read it.

## Progressive Disclosure

- Keep `SKILL.md` short enough to be useful on every load.
- Put troubleshooting, API specifics, examples, and long workflows in separate reference files.
- Never say only "see references for more"; say exactly when each file should be read.

## Calibrate Control

- Be prescriptive when the workflow is fragile, destructive, or sequence-sensitive.
- Give freedom where multiple approaches are valid.
- Prefer defaults over menus. Pick the default tool or workflow and mention alternatives briefly.

## High-Value Patterns

- **Gotchas:** concrete mistakes the agent will make unless warned
- **Templates:** explicit output structures when formatting matters
- **Checklists:** for multi-step workflows with dependencies
- **Validation loops:** do work -> validate -> fix -> re-run
- **Plan-validate-execute:** for destructive or batch operations

## Iteration Loop

- Run the skill on real tasks.
- Read execution traces, not just final outputs.
- Add corrections where the agent wastes time, misses a constraint, or over-applies a rule.
- Cut instructions that do not actually help.
