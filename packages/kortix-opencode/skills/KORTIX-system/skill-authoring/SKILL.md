---
name: kortix-skill-authoring
description: "Kortix skill authoring reference: SKILL.md format, layout, progressive disclosure, reference splitting, and registry publishing."
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

### Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Skill identifier (used in `skill({ name: "..." })`) |
| `description` | Yes | Trigger description — agent reads this to decide when to load |

---

## Authoring Principles

1. **Keep SKILL.md concise.** Move long docs into `references/`
2. **Trigger surface matters.** Treat `name` and `description` as the discovery API
3. **Prefer examples** over long explanation blocks
4. **Progressive disclosure.** Only load what's needed — the agent reads references on demand
5. **Scripts stay close.** Put executable helpers in `scripts/` within the skill directory

---

## When to Split into References

- Skill exceeds ~200 lines → split into topical reference files
- Multiple distinct domains covered → one reference per domain
- FAQ/troubleshooting section growing → move to its own file

---

## Practical Guidance

- If a skill becomes a long reference manual → split into `references/`
- If the skill needs executable helpers → keep them in `scripts/`
- If the skill answers architecture questions → make source-of-truth files explicit in SKILL.md
- If the skill is reusable across projects → consider publishing to the OCX registry

---

## Publishing to the Registry

1. Create skill directory in `skills/<name>/` in the registry repo
2. Add `SKILL.md` with proper frontmatter
3. Update `registry.json` with a new component entry
4. Build: `bun run build` (generates `public/` output)
5. Deploy: `bun run deploy` (Cloudflare Workers)
