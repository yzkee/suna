# Optimizing Skill Descriptions

Use this reference when a skill exists but does not trigger reliably.

## Description Is The Trigger Surface

The `description` field is what the agent sees before loading the full skill. If the description is weak, the skill will be missed or false-triggered.

## Description Writing Rules

- Use imperative phrasing: `Use this skill when...`
- Describe user intent, not internal implementation
- Include realistic trigger phrases and domain keywords
- Be concise but specific
- Stay within the 1024-character limit

## Evaluation Pattern

Create a prompt set with both:
- should-trigger prompts
- should-not-trigger prompts

Use realistic prompts with file paths, typos, context, and near-miss cases.

## Optimization Loop

1. Evaluate the current description on positive and negative prompts.
2. Identify misses and false triggers.
3. Revise the description in a generalized way, not by keyword overfitting.
4. Re-test.
5. Keep the best version, not necessarily the latest version.

## Good Description Shape

Better:

```yaml
description: >
  Analyze CSV and tabular data files — compute summary statistics,
  add derived columns, generate charts, and clean messy data. Use this
  skill when the user has a CSV, TSV, or Excel file and wants to
  explore, transform, or visualize the data.
```

Worse:

```yaml
description: Process CSV files.
```
