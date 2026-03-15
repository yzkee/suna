/**
 * Autowork Loop — State machine for autonomous work continuation
 *
 * Supports concurrent sessions: each session's state is persisted independently
 * to .kortix/loop-states/{sessionId}.json. Always self-verifies, 500 max iterations.
 *
 * Robustness features:
 *   - Exponential backoff: baseCooldown * 2^min(failures, 5)
 *   - 5-minute hard pause after 5 consecutive failures (auto-resets)
 *   - Scan ALL assistant messages since loop start for promise detection
 *     (not just the last message — can't miss a promise buried in history)
 *   - Abort grace period: skip continuation for 3s after abort events
 *   - Internal marker on all injected prompts prevents keyword re-triggering
 *
 * Decision flow on session.idle:
 *   1. Not active → stop
 *   2. Stopped flag → skip (re-enabled on next user message)
 *   3. Abort grace period → skip
 *   4. Exponential backoff cooldown → skip
 *   5. Max consecutive failures → skip until reset window
 *   6. Max iterations → force stop
 *   7. DONE + VERIFIED found in message history → stop (complete)
 *   8. DONE found (not yet verified) → enter verification
 *   9. In verification, no VERIFIED → continue (fix issues)
 *  10. Default → continue working
 *
 * E2E Verification mandate:
 *   VERIFIED is only valid after the agent has provably tested the work
 *   end-to-end: curl/HTTP requests, browser automation, CLI smoke tests,
 *   or equivalent human-like validation that the thing actually WORKS.
 *   "Re-reading files" and "running unit tests" alone are NOT sufficient.
 */

import type { LoopState, AutoworkAlgorithm, KubetValidatorLevel } from "./config"
import { AUTOWORK_LOOP_CONFIG, INTERNAL_MARKER, createInitialLoopState, KUBET_CONFIG, INO_CONFIG } from "./config"
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { evaluateTodos, formatRemainingWork } from "./todo-enforcer"
import type { Todo } from "@opencode-ai/sdk"

// ─── Constants ────────────────────────────────────────────────────────────────

const KORTIX_DIR = process.env.KORTIX_DIR || join(process.cwd(), ".kortix")
const LOOP_STATE_DIR = `${KORTIX_DIR}/loop-states`
/** @deprecated kept for migration from single-file to per-session persistence */
const LEGACY_LOOP_STATE_PATH = `${KORTIX_DIR}/loop-state.json`

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Get the per-session state file path */
function loopStatePath(sessionId: string): string {
	return join(LOOP_STATE_DIR, `${sessionId}.json`)
}

/** Write loop state to disk for crash recovery (per-session) */
export function persistLoopState(state: LoopState): void {
	try {
		if (!state.sessionId) return
		if (!existsSync(LOOP_STATE_DIR)) mkdirSync(LOOP_STATE_DIR, { recursive: true })
		writeFileSync(loopStatePath(state.sessionId), JSON.stringify(state, null, 2), "utf-8")
	} catch {
		/* non-fatal — in-memory state is authoritative */
	}
}

/** Read persisted loop state from disk for a specific session */
export function loadPersistedLoopState(sessionId?: string): LoopState | null {
	try {
		// If sessionId provided, load from per-session file
		if (sessionId) {
			const path = loopStatePath(sessionId)
			if (existsSync(path)) {
				const raw = readFileSync(path, "utf-8")
				const parsed = JSON.parse(raw) as LoopState
				if (typeof parsed.active === "boolean") return parsed
			}
		}
		// Fallback: try legacy single-file (migration path)
		if (existsSync(LEGACY_LOOP_STATE_PATH)) {
			const raw = readFileSync(LEGACY_LOOP_STATE_PATH, "utf-8")
			const parsed = JSON.parse(raw) as LoopState
			if (typeof parsed.active !== "boolean") return null
			// Migrate: write to per-session file and delete legacy
			if (parsed.sessionId) {
				persistLoopState(parsed)
				try { unlinkSync(LEGACY_LOOP_STATE_PATH) } catch { /* non-fatal */ }
			}
			return parsed
		}
		return null
	} catch {
		return null
	}
}

/** Load all persisted loop states from disk (for startup recovery) */
export function loadAllPersistedLoopStates(): Map<string, LoopState> {
	const states = new Map<string, LoopState>()
	try {
		if (!existsSync(LOOP_STATE_DIR)) return states
		const files = readdirSync(LOOP_STATE_DIR).filter(f => f.endsWith(".json"))
		for (const file of files) {
			try {
				const raw = readFileSync(join(LOOP_STATE_DIR, file), "utf-8")
				const parsed = JSON.parse(raw) as LoopState
				if (typeof parsed.active === "boolean" && parsed.sessionId) {
					states.set(parsed.sessionId, parsed)
				}
			} catch { /* skip invalid files */ }
		}
	} catch { /* non-fatal */ }
	// Also check legacy single-file
	try {
		if (existsSync(LEGACY_LOOP_STATE_PATH)) {
			const raw = readFileSync(LEGACY_LOOP_STATE_PATH, "utf-8")
			const parsed = JSON.parse(raw) as LoopState
			if (typeof parsed.active === "boolean" && parsed.sessionId && !states.has(parsed.sessionId)) {
				states.set(parsed.sessionId, parsed)
				// Migrate
				persistLoopState(parsed)
				try { unlinkSync(LEGACY_LOOP_STATE_PATH) } catch { /* non-fatal */ }
			}
		}
	} catch { /* non-fatal */ }
	return states
}

/** Remove persisted loop state for a session (cleanup after loop ends) */
export function removePersistedLoopState(sessionId: string): void {
	try {
		const path = loopStatePath(sessionId)
		if (existsSync(path)) unlinkSync(path)
	} catch { /* non-fatal */ }
}

// ─── Loop Lifecycle ───────────────────────────────────────────────────────────

/** Activate a new autowork loop */
export function startLoop(
	taskPrompt: string,
	sessionId: string,
	messageCountAtStart: number = 0,
	algorithm: AutoworkAlgorithm = "kraemer",
): LoopState {
	const state: LoopState = {
		...createInitialLoopState(),
		active: true,
		taskPrompt,
		sessionId,
		startedAt: Date.now(),
		messageCountAtStart,
		algorithm,
	}
	persistLoopState(state)
	return state
}

/** Deactivate the loop */
export function stopLoop(state: LoopState): LoopState {
	const updated: LoopState = { ...state, active: false }
	persistLoopState(updated)
	return updated
}

/**
 * Mark the loop as permanently stopped by user (/autowork-stop).
 * This is PERMANENT within the session — new user messages do NOT clear it.
 * The only way to re-enable is a fresh /autowork command.
 */
export function markStopped(state: LoopState): LoopState {
	const updated: LoopState = { ...state, stopped: true }
	persistLoopState(updated)
	return updated
}

/**
 * Clear the stopped flag.
 * NOTE: This is NOT called automatically on new user messages anymore.
 * It is only used if explicitly re-activating via /autowork.
 * A new /autowork call goes through startLoop() which resets all state anyway.
 */
export function clearStopped(state: LoopState): LoopState {
	const updated: LoopState = { ...state, stopped: false }
	persistLoopState(updated)
	return updated
}

/** Record an abort event timestamp */
export function recordAbort(state: LoopState): LoopState {
	const updated: LoopState = { ...state, lastAbortAt: Date.now() }
	persistLoopState(updated)
	return updated
}

/** Increment iteration counter and record successful injection */
export function advanceIteration(state: LoopState): LoopState {
	const updated: LoopState = {
		...state,
		iteration: state.iteration + 1,
		lastInjectedAt: Date.now(),
		consecutiveFailures: 0,  // reset on success
	}
	persistLoopState(updated)
	return updated
}

/** Record an injection failure (for exponential backoff) */
export function recordFailure(state: LoopState): LoopState {
	const updated: LoopState = {
		...state,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailureAt: Date.now(),
	}
	persistLoopState(updated)
	return updated
}

/** Enter the self-verification phase */
export function enterVerification(state: LoopState): LoopState {
	const updated: LoopState = { ...state, inVerification: true }
	persistLoopState(updated)
	return updated
}

/** Exit verification phase (back to work) */
export function exitVerification(state: LoopState): LoopState {
	const updated: LoopState = { ...state, inVerification: false }
	persistLoopState(updated)
	return updated
}

// ─── Safety Checks ────────────────────────────────────────────────────────────

/**
 * Check if continuation should be skipped due to safety constraints.
 * Returns a reason string if should skip, null if safe to proceed.
 */
export function checkLoopSafetyGates(
	state: LoopState,
	abortGracePeriodMs: number,
	maxConsecutiveFailures: number,
	failureResetWindowMs: number,
	baseCooldownMs: number,
): string | null {
	// Explicitly stopped by /autowork-stop — permanent until /autowork restarts
	if (state.stopped) {
		return "continuation stopped by user (/autowork-stop) — use /autowork to restart"
	}

	// Abort grace period
	if (state.lastAbortAt > 0) {
		const timeSinceAbort = Date.now() - state.lastAbortAt
		if (timeSinceAbort < abortGracePeriodMs) {
			return `abort grace period: ${Math.round((abortGracePeriodMs - timeSinceAbort) / 1000)}s remaining`
		}
	}

	// Auto-reset failure count after recovery window
	if (state.consecutiveFailures >= maxConsecutiveFailures) {
		if (state.lastFailureAt > 0 && Date.now() - state.lastFailureAt >= failureResetWindowMs) {
			// Will be reset by caller — signal that reset is needed
			return "__reset_failures__"
		}
		return `max consecutive failures (${state.consecutiveFailures}) — pausing for ${Math.round(failureResetWindowMs / 60000)} min`
	}

	// Exponential backoff on failures: baseCooldown * 2^min(failures, 5)
	if (state.lastInjectedAt > 0 && state.consecutiveFailures > 0) {
		const effectiveCooldown = baseCooldownMs * Math.pow(2, Math.min(state.consecutiveFailures, 5))
		const elapsed = Date.now() - state.lastInjectedAt
		if (elapsed < effectiveCooldown) {
			return `backoff cooldown: ${Math.round((effectiveCooldown - elapsed) / 1000)}s remaining (failure ${state.consecutiveFailures})`
		}
	}

	// Minimum spacing between injections even in happy path (prevents spam on rapid idle events)
	if (state.lastInjectedAt > 0 && state.consecutiveFailures === 0) {
		const elapsed = Date.now() - state.lastInjectedAt
		if (elapsed < baseCooldownMs) {
			return `minimum cooldown: ${Math.round((baseCooldownMs - elapsed) / 1000)}s remaining`
		}
	}

	return null
}

// ─── Loop Evaluation ──────────────────────────────────────────────────────────

export type LoopAction = "continue" | "verify" | "stop"

export interface LoopDecision {
	action: LoopAction
	prompt: string | null
	reason: string
}

/**
 * Evaluate whether the loop should continue, enter verification, or stop.
 *
 * @param state - Current loop state
 * @param allAssistantTexts - ALL assistant message texts since loop start
 *                            (not just the last one — critical for promise detection)
 * @param todos - Current todo list from the session (optional — for enforcement)
 */
export function evaluateLoop(
	state: LoopState,
	allAssistantTexts: string[],
	todos?: Todo[],
): LoopDecision {
	if (!state.active) {
		return { action: "stop", prompt: null, reason: "no active loop" }
	}

	const config = AUTOWORK_LOOP_CONFIG

	// Hard limit: max iterations (applies to all algorithms)
	if (state.iteration >= config.maxIterations) {
		return {
			action: "stop",
			prompt: null,
			reason: `max iterations reached (${config.maxIterations})`,
		}
	}

	// Dispatch to algorithm-specific evaluator
	switch (state.algorithm) {
		case "kubet":
			return evaluateKubetLoop(state, allAssistantTexts, todos)
		case "ino":
			return evaluateInoLoop(state, allAssistantTexts, todos)
		case "kraemer":
		default:
			return evaluateKraemerLoop(state, allAssistantTexts, todos)
	}
}

// ─── Kraemer Algorithm (original autowork) ────────────────────────────────────

function evaluateKraemerLoop(
	state: LoopState,
	allAssistantTexts: string[],
	todos?: Todo[],
): LoopDecision {
	const config = AUTOWORK_LOOP_CONFIG

	// Scan ALL messages since loop start for promises
	const combinedText = allAssistantTexts.join("\n")
	const hasCompletionPromise = combinedText.includes(config.completionPromise)
	const hasVerificationPromise = combinedText.includes(config.verificationPromise)

	// Both promises found → fully done
	if (hasCompletionPromise && hasVerificationPromise) {
		return {
			action: "stop",
			prompt: null,
			reason: "both DONE and VERIFIED promises detected — loop complete",
		}
	}

	// DONE found — but first check: do todos say otherwise?
	if (hasCompletionPromise && !state.inVerification) {
		if (todos && todos.length > 0) {
			const todoResult = evaluateTodos(todos)
			if (todoResult.verdict === "unfinished") {
				return {
					action: "continue",
					prompt: buildPrematureDonePrompt(state, todoResult),
					reason: `DONE claimed but ${todoResult.reason} — continuing`,
				}
			}
		}
		return {
			action: "verify",
			prompt: buildVerificationPrompt(state, todos),
			reason: "DONE promise detected — entering E2E verification",
		}
	}

	// In verification phase: check if verified
	if (state.inVerification) {
		if (hasVerificationPromise) {
			return {
				action: "stop",
				prompt: null,
				reason: "VERIFIED promise detected — loop complete",
			}
		}
		if (hasCompletionPromise) {
			if (todos && todos.length > 0) {
				const todoResult = evaluateTodos(todos)
				if (todoResult.verdict === "unfinished") {
					return {
						action: "continue",
						prompt: buildPrematureDonePrompt(state, todoResult),
						reason: `DONE re-emitted but todos still unfinished — continuing`,
					}
				}
			}
			return {
				action: "verify",
				prompt: buildVerificationPrompt(state, todos),
				reason: "DONE re-emitted during verification — re-verifying E2E",
			}
		}
		return {
			action: "continue",
			prompt: buildVerificationContinuationPrompt(state),
			reason: "in E2E verification phase — no promises yet, continue fixing",
		}
	}

	// Default: keep working
	return {
		action: "continue",
		prompt: buildLoopContinuationPrompt(state, todos),
		reason: `iteration ${state.iteration + 1}/${AUTOWORK_LOOP_CONFIG.maxIterations}`,
	}
}

// ─── Kubet Algorithm — Validator Pipeline + Async Critic ──────────────────────

/**
 * Check if the async process critic should run this iteration.
 * Returns true every N iterations (KUBET_CONFIG.criticIntervalIterations).
 */
export function kubetShouldRunCritic(state: LoopState): boolean {
	if (state.algorithm !== "kubet") return false
	if (state.kubetCriticCount >= KUBET_CONFIG.maxCriticInterventions) return false
	if (state.iteration === 0) return false // never on first iteration
	const iterationsSinceLastCritic = state.iteration - state.kubetLastCriticAt
	return iterationsSinceLastCritic >= KUBET_CONFIG.criticIntervalIterations
}

/** Record that the critic ran */
export function kubetRecordCritic(state: LoopState): LoopState {
	const updated: LoopState = {
		...state,
		kubetCriticCount: state.kubetCriticCount + 1,
		kubetLastCriticAt: state.iteration,
	}
	persistLoopState(updated)
	return updated
}

/** Advance to the next validator level */
export function kubetAdvanceValidatorLevel(state: LoopState): LoopState {
	const nextLevel = Math.min(state.kubetValidatorLevel, 3) as KubetValidatorLevel
	const updated: LoopState = { ...state, kubetValidatorLevel: nextLevel }
	persistLoopState(updated)
	return updated
}

function evaluateKubetLoop(
	state: LoopState,
	allAssistantTexts: string[],
	todos?: Todo[],
): LoopDecision {
	const config = AUTOWORK_LOOP_CONFIG
	const combinedText = allAssistantTexts.join("\n")
	const hasCompletionPromise = combinedText.includes(config.completionPromise)
	const hasVerificationPromise = combinedText.includes(config.verificationPromise)

	// Both promises → done
	if (hasCompletionPromise && hasVerificationPromise) {
		return {
			action: "stop",
			prompt: null,
			reason: "[kubet] both DONE and VERIFIED detected — loop complete",
		}
	}

	// DONE found — enter staged validation pipeline
	if (hasCompletionPromise && !state.inVerification) {
		// Check todos first
		if (todos && todos.length > 0) {
			const todoResult = evaluateTodos(todos)
			if (todoResult.verdict === "unfinished") {
				return {
					action: "continue",
					prompt: buildPrematureDonePrompt(state, todoResult),
					reason: `[kubet] DONE rejected — ${todoResult.reason}`,
				}
			}
		}
		// Enter verification — start at level 1
		return {
			action: "verify",
			prompt: buildKubetValidatorPrompt(state, 1, todos),
			reason: "[kubet] DONE accepted — entering validator level 1 (format)",
		}
	}

	// In verification — walk through validator levels
	if (state.inVerification) {
		if (hasVerificationPromise) {
			return {
				action: "stop",
				prompt: null,
				reason: "[kubet] VERIFIED detected — loop complete",
			}
		}

		// Check what the last assistant message says about validation results
		const lastText = allAssistantTexts.length > 0 ? allAssistantTexts[allAssistantTexts.length - 1] : ""
		const passedLevel = detectKubetValidatorPass(lastText)

		if (passedLevel !== null) {
			const nextLevel = (passedLevel + 1) as KubetValidatorLevel
			if (nextLevel > KUBET_CONFIG.defaultValidatorLevel) {
				// All levels passed — tell agent to emit VERIFIED
				return {
					action: "continue",
					prompt: buildKubetAllValidatorsPassedPrompt(state),
					reason: `[kubet] all ${KUBET_CONFIG.defaultValidatorLevel} validator levels passed — prompting for VERIFIED`,
				}
			}
			// Advance to next level
			return {
				action: "verify",
				prompt: buildKubetValidatorPrompt(state, nextLevel, todos),
				reason: `[kubet] validator level ${passedLevel} passed — advancing to level ${nextLevel}`,
			}
		}

		// DONE re-emitted during verification (found issues, fixed them)
		if (hasCompletionPromise) {
			if (todos && todos.length > 0) {
				const todoResult = evaluateTodos(todos)
				if (todoResult.verdict === "unfinished") {
					return {
						action: "continue",
						prompt: buildPrematureDonePrompt(state, todoResult),
						reason: `[kubet] DONE re-emitted but todos unfinished`,
					}
				}
			}
			// Restart validation from level 1
			return {
				action: "verify",
				prompt: buildKubetValidatorPrompt(state, 1, todos),
				reason: "[kubet] DONE re-emitted — restarting validation from level 1",
			}
		}

		// Still validating — continue
		return {
			action: "continue",
			prompt: buildKubetValidationContinuationPrompt(state),
			reason: "[kubet] validation in progress — continue",
		}
	}

	// Default: keep working
	return {
		action: "continue",
		prompt: buildLoopContinuationPrompt(state, todos),
		reason: `[kubet] iteration ${state.iteration + 1}/${config.maxIterations}`,
	}
}

/** Detect if the agent reported passing a validator level */
function detectKubetValidatorPass(text: string): KubetValidatorLevel | null {
	// Agent should emit these markers when a level passes
	if (text.includes("<validator-pass>3</validator-pass>")) return 3
	if (text.includes("<validator-pass>2</validator-pass>")) return 2
	if (text.includes("<validator-pass>1</validator-pass>")) return 1
	return null
}

// ─── Ino Algorithm — Kanban Board Flow ────────────────────────────────────────

/** Parse kanban stage from a todo item's content */
function parseKanbanStage(content: string): { stage: string; title: string } | null {
	const match = content.match(/^\[(BACKLOG|IN PROGRESS|REVIEW|TESTING|DONE)\]\s*(.+)/i)
	if (!match) return null
	const rawStage = match[1].toUpperCase()
	const stageMap: Record<string, string> = {
		"BACKLOG": "backlog",
		"IN PROGRESS": "in_progress",
		"REVIEW": "review",
		"TESTING": "testing",
		"DONE": "done",
	}
	return { stage: stageMap[rawStage] || "backlog", title: match[2].trim() }
}

/** Analyze kanban board state from todos */
function analyzeKanbanBoard(todos: Todo[]): {
	cards: Array<{ content: string; stage: string; title: string; status: string }>
	byStage: Record<string, number>
	allDone: boolean
	hasNonKanban: boolean
} {
	const cards: Array<{ content: string; stage: string; title: string; status: string }> = []
	let hasNonKanban = false

	for (const todo of todos) {
		const content = (todo as any).content || ""
		const status = (todo as any).status || "pending"
		const parsed = parseKanbanStage(content)
		if (parsed) {
			cards.push({ content, stage: parsed.stage, title: parsed.title, status })
		} else if (status !== "completed" && status !== "cancelled") {
			hasNonKanban = true
		}
	}

	const byStage: Record<string, number> = {
		backlog: 0, in_progress: 0, review: 0, testing: 0, done: 0,
	}
	for (const card of cards) {
		byStage[card.stage] = (byStage[card.stage] || 0) + 1
	}

	const allDone = cards.length > 0 && cards.every((c) => c.stage === "done")

	return { cards, byStage, allDone, hasNonKanban }
}

function evaluateInoLoop(
	state: LoopState,
	allAssistantTexts: string[],
	todos?: Todo[],
): LoopDecision {
	const config = AUTOWORK_LOOP_CONFIG
	const combinedText = allAssistantTexts.join("\n")
	const hasCompletionPromise = combinedText.includes(config.completionPromise)
	const hasVerificationPromise = combinedText.includes(config.verificationPromise)

	// Both promises → done
	if (hasCompletionPromise && hasVerificationPromise) {
		return {
			action: "stop",
			prompt: null,
			reason: "[ino] both DONE and VERIFIED detected — loop complete",
		}
	}

	// VERIFIED without completing kanban flow — still accept it
	if (hasVerificationPromise) {
		return { action: "stop", prompt: null, reason: "[ino] VERIFIED detected" }
	}

	// Analyze kanban board state
	const board = todos ? analyzeKanbanBoard(todos) : null

	// If no kanban cards yet, instruct to decompose
	if (!board || board.cards.length === 0) {
		if (state.iteration === 0) {
			// First iteration — normal, agent hasn't decomposed yet
			return {
				action: "continue",
				prompt: buildInoDecomposePrompt(state),
				reason: "[ino] no kanban cards — prompting decomposition",
			}
		}
		// After a few iterations with no cards — still nudge
		if (state.iteration < 3) {
			return {
				action: "continue",
				prompt: buildInoDecomposePrompt(state),
				reason: "[ino] still no kanban cards — re-prompting decomposition",
			}
		}
		// Fall through to normal continuation if agent isn't using kanban prefixes
	}

	// DONE emitted — check board state
	if (hasCompletionPromise) {
		if (board && !board.allDone) {
			return {
				action: "continue",
				prompt: buildInoBoardIncompletePrompt(state, board),
				reason: `[ino] DONE rejected — not all cards in DONE stage`,
			}
		}
		// All cards done — run final integration check
		return {
			action: "verify",
			prompt: buildInoFinalIntegrationPrompt(state, board),
			reason: "[ino] all cards DONE — entering final integration check",
		}
	}

	// In verification (final integration)
	if (state.inVerification) {
		if (hasCompletionPromise) {
			return {
				action: "verify",
				prompt: buildInoFinalIntegrationPrompt(state, board),
				reason: "[ino] DONE re-emitted during integration — re-running",
			}
		}
		return {
			action: "continue",
			prompt: buildInoIntegrationContinuationPrompt(state),
			reason: "[ino] final integration in progress — continue",
		}
	}

	// Normal work — build stage-aware continuation prompt
	if (board && board.cards.length > 0) {
		return {
			action: "continue",
			prompt: buildInoKanbanPrompt(state, board, todos),
			reason: `[ino] kanban: ${board.byStage.done}/${board.cards.length} done — iteration ${state.iteration + 1}`,
		}
	}

	// Fallback to generic continuation
	return {
		action: "continue",
		prompt: buildLoopContinuationPrompt(state, todos),
		reason: `[ino] iteration ${state.iteration + 1}/${config.maxIterations}`,
	}
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildLoopContinuationPrompt(state: LoopState, todos?: Todo[]): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []
	const pct = Math.round((state.iteration / config.maxIterations) * 100)

	parts.push(`[SYSTEM REMINDER - AUTOWORK]`)
	parts.push(`You are in an active autowork loop. Iteration: ${state.iteration + 1} of ${config.maxIterations}.`)

	// Urgency escalation
	if (pct >= 80) {
		parts.push(``)
		parts.push(`**CRITICAL: You have used ${pct}% of your iteration budget.** Finish NOW or you will be force-stopped. Focus only on completing remaining work and verifying.`)
	} else if (pct >= 50) {
		parts.push(``)
		parts.push(`**WARNING: You have used ${pct}% of your iteration budget.** Prioritize completion. Do not start new exploratory work.`)
	}
	parts.push("")

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	// Inject live todo state if available
	if (todos && todos.length > 0) {
		const todoResult = evaluateTodos(todos)
		if (todoResult.verdict === "unfinished" && todoResult.remainingItems.length > 0) {
			parts.push(formatRemainingWork(todoResult))
			parts.push("")
		} else if (todoResult.verdict === "done") {
			parts.push(`[TODO STATUS] All ${todoResult.totalItems} items complete.`)
			parts.push("")
		}
	}

	parts.push(`Continue working on the next pending item.`)
	parts.push(`As you complete each step: verify it worked before moving to the next.`)
	parts.push(`Don't batch verification at the end — confirm each piece of output as you produce it.`)
	parts.push(`When ALL todos are done and every step has been verified, emit exactly:`)
	parts.push(config.completionPromise)
	parts.push(``)
	parts.push(`Do NOT emit this promise while any todo item is still pending or in-progress.`)
	parts.push(`Do NOT emit this promise based on intent — only on observed, confirmed results.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

function buildPrematureDonePrompt(state: LoopState, todoResult: ReturnType<typeof evaluateTodos>): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - AUTOWORK: PREMATURE DONE REJECTED]`)
	parts.push(``)
	parts.push(`You emitted <promise>DONE</promise> but your todo list CONTRADICTS this claim.`)
	parts.push(`Your DONE was REJECTED. The loop continues.`)
	parts.push(``)
	parts.push(`This is a hard enforcement — you CANNOT claim completion while tracked work remains unfinished.`)
	parts.push(`Do NOT emit DONE again until EVERY item below is completed or explicitly cancelled with a documented reason.`)
	parts.push("")

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	parts.push(formatRemainingWork(todoResult))
	parts.push("")
	parts.push(`REQUIRED ACTIONS:`)
	parts.push(`1. Complete every remaining item listed above`)
	parts.push(`2. Run tests/verification for each completed item`)
	parts.push(`3. Only THEN emit ${config.completionPromise}`)
	parts.push(``)
	parts.push(`If an item is genuinely impossible, mark it cancelled in your todos with a clear reason — do not leave it pending.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

function buildVerificationPrompt(state: LoopState, todos?: Todo[]): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - AUTOWORK: MANDATORY E2E VERIFICATION]`)
	parts.push(``)
	parts.push(`You claimed completion. The loop will NOT end until you PROVE your work is correct.`)
	parts.push(`Self-verification is adversarial — assume your implementation has bugs until proven otherwise.`)
	parts.push("")

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	if (todos && todos.length > 0) {
		const todoResult = evaluateTodos(todos)
		if (todoResult.completedItems > 0) {
			parts.push(`[TODO STATUS] ${todoResult.completedItems}/${todoResult.totalItems} items completed.`)
			parts.push("")
		}
	}

	parts.push(`## Phase 1: Adversarial Self-Critique (MANDATORY)`)
	parts.push(`Before running any verification, STOP and think critically:`)
	parts.push(`- List 3-5 things that COULD be wrong with your implementation`)
	parts.push(`- List edge cases you might have missed`)
	parts.push(`- List requirements from the original task you might have only partially addressed`)
	parts.push(`- Consider: "If a senior engineer reviewed this, what would they flag?"`)
	parts.push(`Write these concerns down, then verify EACH ONE.`)
	parts.push("")
	parts.push(`## Phase 2: Requirement Tracing (MANDATORY)`)
	parts.push(`Go back to the original task. For EACH stated requirement:`)
	parts.push(`- State the requirement`)
	parts.push(`- Point to the exact code/artifact that satisfies it`)
	parts.push(`- Run a test or command that PROVES it works`)
	parts.push(`- If any requirement is not demonstrably met, FIX IT before proceeding`)
	parts.push("")
	parts.push(`## Phase 3: E2E Verification (MANDATORY)`)
	parts.push(`1. Run ALL tests — unit, integration, e2e. Every failure must be fixed.`)
	parts.push(`2. Run builds and linters. Zero errors.`)
	parts.push(`3. Exercise the actual output — don't just re-read files.`)
	parts.push(`   Run it, observe real output, confirm it's correct.`)
	parts.push(`4. Trace the full flow a real user would take.`)
	parts.push(`5. Check for regressions — test what you might have broken.`)
	parts.push("")
	parts.push(`## Phase 4: Gate Decision`)
	parts.push(`ALL of these must be YES:`)
	parts.push(`- Every requirement from the original task is demonstrably satisfied?`)
	parts.push(`- Every concern from Phase 1 has been verified/addressed?`)
	parts.push(`- All tests pass? All builds clean?`)
	parts.push(`- No regressions detected?`)
	parts.push("")
	parts.push(`If ALL checks pass, emit exactly:`)
	parts.push(config.verificationPromise)
	parts.push("")
	parts.push(`If ANY check fails: fix the issues, then emit:`)
	parts.push(config.completionPromise)
	parts.push(`to re-enter verification.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

function buildVerificationContinuationPrompt(state: LoopState): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - AUTOWORK: VERIFICATION INCOMPLETE]`)
	parts.push(``)
	parts.push(`You are in the verification phase but have NOT yet emitted ${config.verificationPromise}.`)
	parts.push(`This means verification is not finished. Keep going.`)
	parts.push("")

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	parts.push(`What you must still do:`)
	parts.push(`1. If you haven't done the adversarial self-critique yet — do it NOW`)
	parts.push(`2. If you haven't traced every requirement back to the original task — do it NOW`)
	parts.push(`3. If you haven't run all tests/builds/linters — run them NOW`)
	parts.push(`4. If any test fails — fix it, don't skip it`)
	parts.push(`5. If any requirement is unmet — implement it, don't ignore it`)
	parts.push("")
	parts.push(`When EVERYTHING passes and every requirement is proven met:`)
	parts.push(`  emit ${config.verificationPromise}`)
	parts.push("")
	parts.push(`If you found and fixed issues, re-enter the full verification cycle:`)
	parts.push(`  emit ${config.completionPromise}`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

// ─── Kubet Prompt Builders ────────────────────────────────────────────────────

/** Build the async process critic prompt — injected periodically during work */
export function buildKubetCriticPrompt(state: LoopState, allAssistantTexts: string[]): string {
	const parts: string[] = []
	const recentTexts = allAssistantTexts.slice(-5).join("\n").slice(0, 2000) // last 5 messages, truncated

	parts.push(`[PROCESS CRITIC — Intervention #${state.kubetCriticCount + 1}]`)
	parts.push(``)
	parts.push(`This is NOT about your task. This is about your PROCESS.`)
	parts.push(`Analyze your recent work pattern and answer these questions honestly:`)
	parts.push(``)
	parts.push(`1. **Repetition check:** Are you repeating the same action or fix? If yes, try a completely different approach.`)
	parts.push(`2. **Test discipline:** Are you running tests after every change? If not, run them now.`)
	parts.push(`3. **Efficiency:** Could you achieve the same result with fewer steps? Are you gold-plating or yak-shaving?`)
	parts.push(`4. **Scope:** Are you doing work that wasn't asked for in the original task? If yes, stop.`)
	parts.push(`5. **Progress:** Compare iteration ${state.iteration + 1} to your remaining work. Are you on track to finish?`)
	parts.push(``)
	parts.push(`Based on your answers, STATE what you will change about your approach going forward.`)
	parts.push(`Then immediately continue working — do not spend more than one response on this reflection.`)
	parts.push(``)
	parts.push(`Recent work context (last few iterations):`)
	parts.push(`---`)
	parts.push(recentTexts || "(no recent text)")
	parts.push(`---`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

/** Build a validator prompt for a specific level (1, 2, or 3) */
function buildKubetValidatorPrompt(state: LoopState, level: KubetValidatorLevel, todos?: Todo[]): string {
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - KUBET VALIDATOR: LEVEL ${level}]`)
	parts.push(``)

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	if (level >= 1) {
		parts.push(`## Level 1 — Format Validation`)
		parts.push(`Check ALL of the following. Report each as PASS or FAIL:`)
		parts.push(`- [ ] All created/modified files exist and are syntactically valid`)
		parts.push(`- [ ] Code parses without errors (no syntax errors)`)
		parts.push(`- [ ] Build completes cleanly (run it — no compile/transpile errors)`)
		parts.push(`- [ ] No linter errors on modified files (run linter)`)
		parts.push(`- [ ] Config files are well-formed (JSON/YAML/TOML parse OK)`)
		parts.push("")
	}

	if (level >= 2) {
		parts.push(`## Level 2 — Quality Validation`)
		parts.push(`Check ALL of the following (in addition to Level 1):`)
		parts.push(`- [ ] All tests pass (existing + new) — run them`)
		parts.push(`- [ ] Every requirement from the task maps to at least one test or verification`)
		parts.push(`- [ ] No obvious anti-patterns (dead code, unused imports, hardcoded secrets, untracked TODOs)`)
		parts.push(`- [ ] Reasonable structure — no god files, no 500-line functions`)
		parts.push("")
	}

	if (level >= 3) {
		parts.push(`## Level 3 — Top Notch Validation`)
		parts.push(`Check ALL of the following (in addition to Levels 1-2):`)
		parts.push(`- [ ] Adversarial: List 5 ways this could break. Verify each is handled.`)
		parts.push(`- [ ] Performance: No O(n²) where O(n) is obvious. No unbounded memory growth.`)
		parts.push(`- [ ] Clean code: Meaningful names, consistent style, proper error handling.`)
		parts.push(`- [ ] Documentation: Public APIs have docstrings. Complex logic has "why" comments.`)
		parts.push(`- [ ] Regressions: Run FULL test suite. Verify nothing else broke.`)
		parts.push("")
	}

	parts.push(`## Instructions`)
	parts.push(`Run every check above. For each FAIL, fix the issue immediately.`)
	parts.push(`When ALL checks at level ${level} pass, emit exactly:`)
	parts.push(`<validator-pass>${level}</validator-pass>`)
	parts.push(``)
	parts.push(`If you find issues and need to fix them, fix them first, then re-run the checks.`)
	parts.push(`Do NOT emit the validator-pass marker until every check genuinely passes.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

/** All validator levels passed — prompt for VERIFIED */
function buildKubetAllValidatorsPassedPrompt(state: LoopState): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - KUBET: ALL VALIDATORS PASSED]`)
	parts.push(``)
	parts.push(`All ${KUBET_CONFIG.defaultValidatorLevel} validation levels have passed.`)
	parts.push(`Your work has been verified at the format, quality, and top-notch levels.`)
	parts.push(``)
	parts.push(`Emit exactly:`)
	parts.push(config.verificationPromise)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

/** Continue validation when no pass marker detected yet */
function buildKubetValidationContinuationPrompt(state: LoopState): string {
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - KUBET: VALIDATION IN PROGRESS]`)
	parts.push(``)
	parts.push(`You are in the validation phase but have not yet emitted a validator-pass marker.`)
	parts.push(`Continue running the validation checks and fixing any issues found.`)
	parts.push(``)
	parts.push(`When ALL checks at the current level pass, emit: <validator-pass>LEVEL</validator-pass>`)
	parts.push(`(where LEVEL is 1, 2, or 3)`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

// ─── Ino Prompt Builders ──────────────────────────────────────────────────────

/** Prompt agent to decompose task into kanban cards */
function buildInoDecomposePrompt(state: LoopState): string {
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - INO: DECOMPOSE INTO KANBAN CARDS]`)
	parts.push(``)

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	parts.push(`You are using the **Ino algorithm** — kanban board workflow.`)
	parts.push(``)
	parts.push(`FIRST STEP: Decompose your task into discrete work cards.`)
	parts.push(`Each card must be a todo item with a stage prefix:`)
	parts.push(``)
	parts.push(`  [BACKLOG] Implement user authentication`)
	parts.push(`  [BACKLOG] Create database schema`)
	parts.push(`  [BACKLOG] Write API endpoint tests`)
	parts.push(``)
	parts.push(`Rules:`)
	parts.push(`- Each card should be small enough to implement AND verify independently`)
	parts.push(`- Order them by priority/dependency (first card = highest priority)`)
	parts.push(`- Include a final card: [BACKLOG] Final integration verification`)
	parts.push(``)
	parts.push(`After creating the cards, pick the first one and move it to [IN PROGRESS].`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

/** Stage-aware continuation prompt based on kanban board state */
function buildInoKanbanPrompt(
	state: LoopState,
	board: ReturnType<typeof analyzeKanbanBoard>,
	todos?: Todo[],
): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []
	const pct = Math.round((state.iteration / config.maxIterations) * 100)

	parts.push(`[SYSTEM REMINDER - INO: KANBAN BOARD STATUS]`)
	parts.push(`Iteration ${state.iteration + 1} of ${config.maxIterations}.`)

	if (pct >= 80) {
		parts.push(`**CRITICAL: ${pct}% budget used. Finish remaining cards NOW.**`)
	} else if (pct >= 50) {
		parts.push(`**WARNING: ${pct}% budget used. Stay focused.**`)
	}
	parts.push(``)

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	// Board summary
	parts.push(`## Board State`)
	parts.push(`| Stage | Count |`)
	parts.push(`|-------|-------|`)
	parts.push(`| Backlog | ${board.byStage.backlog} |`)
	parts.push(`| In Progress | ${board.byStage.in_progress} |`)
	parts.push(`| Review | ${board.byStage.review} |`)
	parts.push(`| Testing | ${board.byStage.testing} |`)
	parts.push(`| Done | ${board.byStage.done} |`)
	parts.push(``)

	// Card details
	const activeCards = board.cards.filter((c) => c.stage !== "done")
	if (activeCards.length > 0) {
		parts.push(`## Active Cards`)
		for (const card of activeCards) {
			const stageIcon: Record<string, string> = {
				backlog: "📋", in_progress: "🔨", review: "🔍", testing: "🧪",
			}
			parts.push(`${stageIcon[card.stage] || "·"} [${card.stage.toUpperCase().replace("_", " ")}] ${card.title}`)
		}
		parts.push("")
	}

	// Stage-specific instructions
	if (board.byStage.in_progress > 0) {
		const wip = board.cards.filter((c) => c.stage === "in_progress")
		parts.push(`## Current Focus`)
		parts.push(`Continue working on: **${wip[0]?.title}**`)
		parts.push(`When implementation is complete, update its prefix to [REVIEW] and self-review it.`)
	} else if (board.byStage.review > 0) {
		const reviewing = board.cards.filter((c) => c.stage === "review")
		parts.push(`## Current Focus`)
		parts.push(`Self-review: **${reviewing[0]?.title}**`)
		parts.push(`Re-read your changes with fresh eyes. If issues found, move back to [IN PROGRESS].`)
		parts.push(`If review passes, move to [TESTING].`)
	} else if (board.byStage.testing > 0) {
		const testing = board.cards.filter((c) => c.stage === "testing")
		parts.push(`## Current Focus`)
		parts.push(`Test: **${testing[0]?.title}**`)
		parts.push(`Run the tests for this card. If pass, move to [DONE] and mark completed.`)
		parts.push(`If fail, move back to [IN PROGRESS] and fix.`)
	} else if (board.byStage.backlog > 0) {
		parts.push(`## Next Action`)
		parts.push(`Pick the next card from BACKLOG and move it to [IN PROGRESS].`)
	} else if (board.allDone) {
		parts.push(`## All Cards Done`)
		parts.push(`All cards are in DONE. Run the final integration check.`)
		parts.push(`If everything passes, emit: ${config.completionPromise}`)
	}
	parts.push("")

	if (board.byStage.in_progress > INO_CONFIG.maxWip) {
		parts.push(`**WARNING:** You have ${board.byStage.in_progress} cards in progress. Max WIP is ${INO_CONFIG.maxWip}. Finish one before starting another.`)
		parts.push("")
	}

	parts.push(INTERNAL_MARKER)
	return parts.join("\n")
}

/** DONE rejected because not all cards are in DONE stage */
function buildInoBoardIncompletePrompt(
	state: LoopState,
	board: ReturnType<typeof analyzeKanbanBoard>,
): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - INO: DONE REJECTED — BOARD INCOMPLETE]`)
	parts.push(``)
	parts.push(`You emitted ${config.completionPromise} but your kanban board has cards that are NOT in DONE stage.`)
	parts.push(``)

	const notDone = board.cards.filter((c) => c.stage !== "done")
	for (const card of notDone) {
		parts.push(`  [${card.stage.toUpperCase().replace("_", " ")}] ${card.title}`)
	}
	parts.push(``)
	parts.push(`Each card must go through: BACKLOG → IN PROGRESS → REVIEW → TESTING → DONE`)
	parts.push(`Complete the remaining cards before emitting DONE again.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

/** Final integration check prompt — all cards are done */
function buildInoFinalIntegrationPrompt(
	state: LoopState,
	board: ReturnType<typeof analyzeKanbanBoard> | null,
): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - INO: FINAL INTEGRATION CHECK]`)
	parts.push(``)
	parts.push(`All kanban cards are in DONE stage. Now verify everything works together.`)
	parts.push(``)

	if (state.taskPrompt) {
		parts.push(`Original task: ${state.taskPrompt}`)
		parts.push("")
	}

	parts.push(`## Integration Checklist`)
	parts.push(`1. Run the FULL test suite (not just individual card tests)`)
	parts.push(`2. Run the build — zero errors`)
	parts.push(`3. Verify cross-card interactions work correctly`)
	parts.push(`4. Trace the original requirements — is everything covered?`)
	parts.push(`5. Check for regressions across the entire codebase`)
	parts.push(``)
	parts.push(`If ALL pass, emit: ${config.verificationPromise}`)
	parts.push(`If ANY fail, create fix cards in BACKLOG and continue working.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

/** Integration check still in progress */
function buildInoIntegrationContinuationPrompt(state: LoopState): string {
	const config = AUTOWORK_LOOP_CONFIG
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - INO: INTEGRATION CHECK INCOMPLETE]`)
	parts.push(``)
	parts.push(`You are in the final integration check but have not yet emitted ${config.verificationPromise}.`)
	parts.push(`Continue running integration checks and fixing any issues found.`)
	parts.push(``)
	parts.push(`When everything passes: emit ${config.verificationPromise}`)
	parts.push(`If you found issues and created fix cards: work through them, then retry.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}
