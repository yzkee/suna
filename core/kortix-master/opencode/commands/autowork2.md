---
description: "Start autonomous work (Ino algorithm) — kanban board flow. Each task card moves through backlog → in-progress → review → testing → done. Per-card verification, not bulk."
agent: kortix
---

# Autowork — Ino Algorithm

<!-- KORTIX_AUTOWORK -->

You are in **autowork mode** using the **Ino algorithm**. Full autonomous execution with a **kanban board workflow**. The system tracks your work as cards moving through stages.

## How This Differs From Standard Autowork

Instead of doing all the work and then verifying everything at the end, the Ino algorithm verifies **each piece of work individually** as it moves through stages. This catches problems early — you don't build 10 things and then discover the first one was wrong.

## Kanban Board Stages

Every piece of work is a **card** that moves through these stages in order:

```
BACKLOG → IN PROGRESS → REVIEW → TESTING → DONE
```

### Stage Rules

**BACKLOG** — Decomposed task items waiting to start.
- When you receive the task, immediately decompose it into discrete cards.
- Each card = one todo item. Prefix with the stage: `[BACKLOG] description`
- Cards should be small enough to implement AND verify independently.

**IN PROGRESS** — Currently being worked on.
- Pick the top priority card from BACKLOG. Update its prefix to `[IN PROGRESS]`.
- Only ONE card in IN PROGRESS at a time.
- Write tests first (TDD), then implement.
- When implementation is complete, move to REVIEW: update prefix to `[REVIEW]`.

**REVIEW** — Self-review checkpoint.
- Re-read your changes for this card with fresh eyes.
- Check: Does it actually satisfy the requirement? Any obvious bugs? Clean code?
- If issues found: move back to `[IN PROGRESS]` with review notes.
- If review passes: move to `[TESTING]`.

**TESTING** — Run verification for this specific card.
- Run the tests you wrote for this card.
- Run the build to check nothing broke.
- If tests fail: move back to `[IN PROGRESS]`.
- If all pass: move to `[DONE]`. Mark the todo item as completed.

**DONE** — Card is fully verified.
- A card in DONE should never need to be touched again.

## Protocol

1. **Decompose** the task into kanban cards (todo items with `[BACKLOG]` prefix).
2. **Pick** the highest priority BACKLOG card → move to `[IN PROGRESS]`.
3. **Work** on it: tests first, then implementation.
4. **Review** it: move to `[REVIEW]`, self-review, move back or forward.
5. **Test** it: move to `[TESTING]`, run tests, move back or forward.
6. **Complete** it: move to `[DONE]`, mark todo as completed.
7. **Repeat** steps 2-6 until all cards are DONE.
8. **Final integration check**: When all cards are `[DONE]`, run the full test suite and build one more time. Check nothing broke across cards.
9. If final integration passes: emit `<promise>DONE</promise>` then `<promise>VERIFIED</promise>`.
10. If final integration fails: create fix cards in BACKLOG and continue.

## System Enforcement

The system monitors your todo list for kanban stage prefixes. The continuation prompts you receive will be **stage-aware**:
- If a card is stuck in one stage too long, the system will nudge you.
- If you skip stages (e.g., go from IN PROGRESS directly to DONE), the system will push it back.
- The system will not accept `<promise>DONE</promise>` if any cards are not in `[DONE]` stage.

## Rules
- Up to **500 iterations** before force-stop.
- ONE card in `[IN PROGRESS]` at a time. Finish before starting the next.
- Every card MUST go through REVIEW and TESTING. No shortcuts.
- Do NOT emit `<promise>DONE</promise>` until ALL cards are in `[DONE]`.
- Track all progress via todo items with stage prefixes.
- NEVER delete or weaken tests to make them pass.
