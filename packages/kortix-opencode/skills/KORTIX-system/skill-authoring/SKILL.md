---
name: kortix-skill-authoring
description: "Kortix skill authoring reference: SKILL.md format, discovery, descriptions, progressive disclosure, scripts, evaluation, and registry publishing."
---

# Skill Authoring

Creating and refactoring skills for the Kortix / OpenCode platform.

---

## Recommended Layout

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: executable helpers
├── references/       # Optional: supplementary docs
└── assets/           # Optional: templates, images
```

Use `references/` for deeper guidance that should not load every time. In this skill:
- `references/best-practices.md` covers scope, progressive disclosure, gotchas, defaults, and reusable instruction patterns
- `references/descriptions.md` covers trigger-surface writing and description evals
- `references/evals.md` covers output-quality evaluation loops
- `references/scripts.md` covers bundled script design and execution guidance

---

## Discovery And Placement

OpenCode-compatible skills are discovered from:

- `.opencode/skills/<name>/SKILL.md`
- `~/.config/opencode/skills/<name>/SKILL.md`
- `.claude/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

For project-local paths, OpenCode walks up from the current working directory to the git worktree and loads matching skill directories along the way.

---

## SKILL.md Format

```markdown
---
name: my-skill
description: "Comprehensive trigger description. This is what discovery sees."
---

# Skill Title

Instructions loaded when the skill is triggered.
```

The file must start with the opening `---` frontmatter delimiter at byte 0. Do not put a title, comment, or blank line before it.

### Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Skill identifier (used in `skill({ name: "..." })`) |
| `description` | Yes | Trigger description — agent reads this to decide when to load |

### Naming Rules

- Keep `name` between 1 and 64 characters
- Use lowercase letters, numbers, and hyphens only
- Match the directory name exactly
- Do not start or end with a hyphen
- Do not use consecutive hyphens

Valid examples:
- `pdf-processing`
- `code-review`
- `data-analysis`

Invalid examples:
- `-my-skill`
- `my--skill`
- `My_Skill`

### Description Rules

- State what the skill does
- State when it should be used
- Include concrete keywords and trigger phrases that improve discovery
- Prefer a specific trigger description over a vague summary

Better:
- `Use when the user mentions PDFs, forms, or document extraction`

Worse:
- `Helps with PDFs`

If you are refining a trigger description, read `references/descriptions.md`.

---

## Authoring Principles

1. **Keep SKILL.md concise.** Move long docs into `references/`
2. **Trigger surface matters.** Treat `name` and `description` as the discovery API
3. **Prefer examples** over long explanation blocks
4. **Progressive disclosure.** Only load what's needed — the agent reads references on demand
5. **Scripts stay close.** Put executable helpers in `scripts/` within the skill directory

If you are authoring a new skill from scratch, start from a real successful run, correction history, or project artifact set rather than generic LLM knowledge. Read `references/best-practices.md` for the full guidance.

---

## Creation Workflow

1. Understand what the skill should accomplish and when it should be used.
2. Choose a descriptive lowercase hyphenated name.
3. Write a discovery-friendly `description` with real trigger language.
4. Write clear instructions that another agent can follow without extra context.
5. Create the skill directory and `SKILL.md`.
6. If the skill needs helpers, references, or assets, add them inside the same skill directory.
7. If the skill is intended for registry distribution, follow the registry publishing flow below.
8. If the skill will be reused heavily, add evals and iterate against real execution traces.

---

## Common Mistakes

**`SKILL.md` does not start with frontmatter**

- Wrong: title before `---`
- Wrong: blank line before `---`
- Correct: file starts immediately with `---`

**Invalid skill name**

- Check lowercase formatting
- Check hyphen rules
- Check directory name matches `name`

**Weak description**

- If discovery would miss the skill, the description is too vague
- Add concrete user phrases, domains, and trigger words

**Overgrown root file**

- If the root `SKILL.md` turns into a manual, split it into `references/`
- If the root file contains generic background the agent already knows, cut it
- If the skill gives many equal options instead of a default, tighten it

---

## When To Split Into References

- Skill exceeds ~200 lines → split into topical reference files
- Multiple distinct domains covered → one reference per domain
- FAQ or troubleshooting grows large → move it to its own file

---

## Practical Guidance

- If a skill becomes a long reference manual → split into `references/`
- If the skill needs executable helpers → keep them in `scripts/`
- If the skill answers architecture questions → make source-of-truth files explicit in SKILL.md
- If the skill is reusable across projects → consider publishing to the OCX registry
- If the description does not trigger reliably → evaluate it with positive and negative prompt sets
- If the workflow is fragile or repetitive → add a validation loop or a bundled script

---

## Permissions And Visibility

- Skill loading can be allowed, denied, or set to ask via OpenCode permission config
- Permissions can be overridden per agent
- If the `skill` tool is disabled for an agent, the skill catalog is omitted entirely

If a skill does not show up:
1. Verify `SKILL.md` is all caps
2. Check required frontmatter fields
3. Check that the `name` matches the directory
4. Check for duplicate names across locations
5. Check skill permissions

---

## When To Read The References

- Read `references/best-practices.md` when designing the skill boundary, deciding what to include, or extracting a skill from prior work.
- Read `references/descriptions.md` when the skill exists but does not trigger reliably enough.
- Read `references/evals.md` when you want to measure whether the skill actually improves outcomes.
- Read `references/scripts.md` when the skill needs bundled automation or repeated command logic.

---

## Publishing To The Registry

1. Create skill directory in `skills/<name>/` in the registry repo
2. Add `SKILL.md` with proper frontmatter
3. Update `registry.json` with a new component entry
4. Build: `bun run build` (generates `public/` output)
5. Deploy: `bun run deploy` (Cloudflare Workers)
