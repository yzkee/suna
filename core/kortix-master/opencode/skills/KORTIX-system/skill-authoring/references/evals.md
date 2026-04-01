# Evaluating Skill Output Quality

Use this reference when you need to prove that a skill improves results.

## Core Idea

Test the skill against realistic prompts with and without the skill, then compare output quality, timing, and token cost.

## Recommended Eval Layout

Put test definitions in `evals/evals.json` inside the skill directory.

Each eval should include:
- a realistic prompt
- expected output description
- optional input files
- assertions once you know what good output looks like

## What To Compare

- with-skill output
- without-skill baseline, or previous skill version
- pass/fail assertion results
- human review notes
- timing and token data when available

## Good Assertions

- specific
- observable
- verifiable

Bad assertions are vague or brittle.

## Iteration Loop

1. Run the evals.
2. Grade assertions.
3. Review outputs as a human.
4. Read execution traces.
5. Improve the skill.
6. Re-run in a new iteration.

If a skill is not measurably helping, simplify it or remove it.
