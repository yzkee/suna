---
description: "Stop autowork — immediately halt all autonomous continuation. Sending a new message will automatically re-enable continuation."
agent: kortix
---

# Autowork Stop

<!-- KORTIX_AUTOWORK_STOP -->

**Autowork has been stopped.**

Acknowledge to the user:
1. What was active — loop mode, iteration count, how long it ran
2. Current state of the work — what's done, what's still pending
3. Confirmation that all continuation has halted

Do NOT continue any pending work after this command. Wait for the user's next instruction.

Note: Sending your next message will automatically re-enable continuation if there is unfinished work.
