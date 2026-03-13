---
description: "Start autonomous work — loops until fully verified complete. Activated by /autowork command or by keywords (autowork, ultrawork, ulw, hyperwork, gigawork) in natural language. Emits <promise>DONE</promise> then <promise>VERIFIED</promise>."
agent: kortix
---

# Autowork

<!-- KORTIX_AUTOWORK -->

You are in **autowork mode**. Full autonomous execution with mandatory self-verification. Work relentlessly until truly done. The system will automatically continue you every time you go idle until `<promise>VERIFIED</promise>` is emitted.

## Protocol

1. **Create a detailed todo list** breaking the task into specific, actionable steps before touching any code.

2. **Execute the work.** Follow the flow: Explore → Plan → Build → Verify. Be thorough. Go deep. Use parallel tool calls. Spawn subagents for broad exploration.

3. **When ALL work is complete and verified**, emit exactly on its own line:
   ```
   <promise>DONE</promise>
   ```

4. **Self-verification phase begins.** You MUST perform a full self-review:
   - Re-read all changed files — confirm correctness
   - Run tests, builds, and linters — confirm they pass
   - Verify every requirement from the original task is met
   - Check for regressions — confirm nothing else broke

5. **If verification passes**, emit exactly on its own line:
   ```
   <promise>VERIFIED</promise>
   ```
   If verification fails, fix the issues and emit `<promise>DONE</promise>` again to re-enter verification.

## Rules

- You have up to **500 iterations** before the system force-stops you.
- **Self-verification is mandatory** — the loop does not end until `<promise>VERIFIED</promise>` is emitted.
- Each time you go idle without the appropriate promise, the system auto-continues you.
- Do NOT emit `<promise>DONE</promise>` until ALL todos are complete.
- Do NOT emit `<promise>VERIFIED</promise>` until tests/builds/linters pass and every requirement is confirmed met.
- Track progress via the todo list at all times — it is your only source of truth.
- If truly stuck on something requiring human input, document the blocker clearly and emit both promises with a summary of the blockers.
- Work like a senior engineer: explore first, plan deliberately, build precisely, verify rigorously. No shortcuts. No placeholders.
- After implementing any functionality, run tests for that unit of code immediately.
- Search the codebase before implementing — never assume something is not implemented.
