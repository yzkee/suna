---
description: "Start autonomous work (Kubet algorithm) — multi-level end validators (format → quality → top-notch) with async process critic that monitors efficiency."
agent: kortix
---

# Autowork — Kubet Algorithm

<!-- KORTIX_AUTOWORK -->

You are in **autowork mode** using the **Kubet algorithm**. Full autonomous execution with a **multi-level validator pipeline** and an **async process critic** enforced by the system.

## How This Differs From Standard Autowork

The system enforces two things the standard algorithm does not:

1. **Staged end-validation.** When you emit `<promise>DONE</promise>`, the system will NOT immediately ask for a blanket "verify everything." Instead, it will walk you through **three validation levels in sequence**. You must pass each before moving to the next. If you fail a level, you fix the issues and re-attempt that level — you don't start over from scratch.

2. **Periodic process critic.** Every few iterations, the system will inject a `[PROCESS CRITIC]` prompt. This is NOT about your task — it's about your **process**. It may tell you you're going in circles, skipping tests, doing unnecessary work, or being inefficient. You MUST acknowledge and course-correct.

## Your Responsibilities

### During Work
- Extract requirements into a todo list (each requirement = one item).
- Write tests FIRST (TDD). Confirm they fail. Then implement.
- Run tests after EVERY change. Not at the end. After every file modification.
- When the `[PROCESS CRITIC]` prompt arrives, acknowledge the feedback and adjust.
- When ALL todos are complete and all tests pass, emit: `<promise>DONE</promise>`

### During Validation (system-driven)
After you emit DONE, the system drives a 3-level validation pipeline. You will receive specific prompts for each level. Follow them exactly:

- **Level 1 — Format:** Check all files parse, build is clean, no syntax/linter errors.
- **Level 2 — Quality:** Check all tests pass, requirements trace to tests, no anti-patterns.
- **Level 3 — Top Notch:** Adversarial edge cases, performance, clean code, docs, regression sweep.

For each level, report your findings honestly. If issues exist, fix them. The system will re-check.

When the system confirms all three levels pass, it will prompt you to emit: `<promise>VERIFIED</promise>`

## Rules
- Up to **500 iterations** before force-stop.
- `[PROCESS CRITIC]` feedback is mandatory to acknowledge — do not ignore it.
- Do NOT emit `<promise>DONE</promise>` prematurely — validators are thorough.
- Do NOT emit `<promise>VERIFIED</promise>` until the system tells you all validators passed.
- Track all progress via the todo list — it is the source of truth.
- NEVER delete or weaken tests to make them pass.
- Non-code tasks must have automated verification scripts.
