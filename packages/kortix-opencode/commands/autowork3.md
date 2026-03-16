---
description: "Start autonomous work (Saumya algorithm) — entropy-scheduled execution. Diverge wide, branch candidates, cross-attack, rank, then compress into one hard final output."
agent: kortix
---

# Autowork — Saumya Algorithm

<!-- KORTIX_AUTOWORK -->

You are in **autowork mode** using the **Saumya algorithm**. The system drives you through **5 entropy-scheduled phases**. You do NOT choose when to transition — the system detects your phase markers and advances you.

## Core Principle

**Maximize entropy in the search phase, not in the final answer phase.**

Branch wide. Force conceptual diversity. Delay commitment. Then crush everything back into one hard final output.

The flow is: **diverge → branch → attack → rank → compress**

Early certainty is suspicious. The first plausible answer is the local optimum you must escape.

---

## Phase 1 — EXPAND (high entropy)

Generate a wide possibility surface. Do NOT converge.

Required actions:
- Reframe the task at least **5 materially different ways**
- List hidden assumptions that might be wrong
- List constraints that may be false
- Generate several **solution families** (not minor variations — different strategies)
- Include non-obvious, adversarial, and minimalist approaches
- Consider opposite assumptions
- View the task through multiple lenses: systems design, game theory, first principles, failure analysis

**Ban premature convergence.** Do not commit to any approach. Treat early certainty as a red flag.

When you have generated a genuinely wide possibility surface, emit:
```
<phase>expand-done</phase>
```

---

## Phase 2 — BRANCH (high entropy)

Split into **3-5 serious candidate paths**. Candidates must differ in **strategy**, not wording.

For EACH candidate:
- Define the approach clearly
- State why it might **win** (best case)
- State why it might **fail** (worst case)
- List required assumptions
- Include one conventional, one adversarial, one minimalist, and one hybrid approach

The goal: true search width, not fake verbosity.

When all candidates are defined, emit:
```
<phase>branch-done</phase>
```

---

## Phase 3 — ATTACK (medium entropy)

Make branches **attack each other**.

Required actions:
- Critique each candidate **from the perspective of the others**
- Find failure modes and blind spots for each
- Identify which parts are strongest across candidates
- Merge strongest parts where useful — create hybrid approaches
- Challenge the problem framing itself: is there a reframe that makes a candidate irrelevant?

This keeps entropy useful instead of ornamental.

When cross-attack is complete, emit:
```
<phase>attack-done</phase>
```

---

## Phase 4 — RANK (low entropy)

Now reduce entropy. Score and select.

Required actions:
- Rank candidates by **robustness**, **novelty**, and **feasibility**
- Select the best path under the stated objective
- Provide a **fallback** if the top path fails
- State what was discarded and **why** — the reasoning matters
- If two candidates tie, state the tiebreaker criterion

Do NOT present multiple options. Pick one. Own the decision.

When ranking is complete, emit:
```
<phase>rank-done</phase>
```

---

## Phase 5 — COMPRESS (minimal entropy)

Execute the winning approach. Pure implementation.

- Write tests FIRST (TDD). Confirm they fail. Then implement.
- Run tests after every change.
- No exploration. No second-guessing the ranked decision. Just build.
- When ALL work is complete and verified, emit: `<promise>DONE</promise>`
- Then self-verify and emit: `<promise>VERIFIED</promise>`

---

## System Enforcement

The system tracks your current phase. You will receive phase-appropriate continuation prompts:
- In EXPAND/BRANCH: the system reinforces divergent thinking and rejects premature convergence
- In ATTACK: the system demands adversarial critique, not agreement
- In RANK: the system demands a single clear decision
- In COMPRESS: the system demands implementation, not discussion

If you emit `<promise>DONE</promise>` before completing all phases, it will be **rejected**.

## Rules

- Up to **500 iterations** before force-stop
- **You cannot skip phases.** The system enforces the sequence.
- In EXPAND/BRANCH: generate diversity, not style variations. Strategy must differ.
- In ATTACK: be adversarial, not polite. Kill weak lines.
- In RANK: commit. No hedging. Pick one path.
- In COMPRESS: just build. TDD. No re-exploring.
- Track progress via the todo list.
- NEVER delete or weaken tests to make them pass.
