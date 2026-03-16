/**
 * Kortix Autowork — Configuration
 *
 * Single unified autowork mode. Always self-verifies. Always uses the maximum
 * iteration limit. No "light" mode — autowork means full autonomous execution.
 *
 * Keyword detection: autowork, ultrawork, ulw, hyperwork, gigawork in user
 * messages auto-activate the loop and set variant=max.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Regex that detects autowork activation keywords in user messages */
export const AUTOWORK_KEYWORDS = /\b(autowork|ultrawork|ulw|hyperwork|gigawork)\b/i

/** Marker appended to all system-injected continuation prompts.
 *  Prevents keyword detection from re-triggering on injected messages. */
export const INTERNAL_MARKER = "<!-- KORTIX_INTERNAL -->"

/** Strip code blocks before keyword detection */
export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

// ─── Feature Toggles ─────────────────────────────────────────────────────────

export interface ContinuationFeatures {
	/** Enable the continuation engine (session.idle → auto-continue) */
	continuation: boolean
	/** Enable the todo enforcer (check for unfinished tracked work) */
	todoEnforcer: boolean
	/** Enable the intent gate (classify user turns before continuing) */
	intentGate: boolean
	/** Enable the planner (auto-create plan files for complex tasks) */
	planner: boolean
}

// ─── Thresholds & Limits ─────────────────────────────────────────────────────

export interface ContinuationThresholds {
	/** Base cooldown (ms) between continuation attempts — exponentially backed off on failures */
	baseCooldownMs: number
	/** Max consecutive failures before entering hard pause */
	maxConsecutiveFailures: number
	/** How long (ms) to pause after hitting maxConsecutiveFailures */
	failureResetWindowMs: number
	/** Grace period (ms) after abort events — skip continuation during this window */
	abortGracePeriodMs: number
	/** Min time (ms) the agent must have been working before continuation kicks in */
	minWorkDurationMs: number
	/** Max total continuations per session (absolute safety cap for passive mode) */
	maxSessionContinuations: number
	/** Max consecutive aborts/empty responses before passive continuation gives up */
	maxConsecutiveAborts: number
	/** Cooldown (ms) between passive continuation attempts — prevents spam */
	passiveCooldownMs: number
}

// ─── Full Config ──────────────────────────────────────────────────────────────

export interface ContinuationConfig {
	features: ContinuationFeatures
	thresholds: ContinuationThresholds
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_FEATURES: ContinuationFeatures = {
	continuation: true,      // passive continuation ON by default — todo enforcer drives it
	todoEnforcer: true,
	intentGate: true,
	planner: false,
}

export const DEFAULT_THRESHOLDS: ContinuationThresholds = {
	baseCooldownMs: 3_000,         // 3s minimum spacing between injections
	maxConsecutiveFailures: 5,
	failureResetWindowMs: 5 * 60_000,  // 5-minute hard pause after 5 consecutive failures
	abortGracePeriodMs: 3_000,    // 3s grace after abort events
	minWorkDurationMs: 8_000,     // agent must have worked at least 8s before passive kick-in
	maxSessionContinuations: 50,  // raised from 20 — passive mode is the safety net
	maxConsecutiveAborts: 3,      // 3 consecutive aborts/empty responses → stop passive continuation
	passiveCooldownMs: 5_000,     // 5s minimum between passive continuation attempts
}

export const DEFAULT_CONFIG: ContinuationConfig = {
	features: { ...DEFAULT_FEATURES },
	thresholds: { ...DEFAULT_THRESHOLDS },
}

// ─── Runtime State ────────────────────────────────────────────────────────────

/**
 * Mutable runtime state for the passive continuation engine.
 * Separate from LoopState which tracks the active autowork loop.
 */
export interface ContinuationState {
	/** Current session ID being tracked */
	sessionId: string | null
	/** Total continuations this session */
	totalSessionContinuations: number
	/** Timestamp when the current work cycle started (reset on user message) */
	workCycleStartedAt: number
	/** Consecutive aborted/empty responses — circuit breaker for passive mode */
	consecutiveAborts: number
	/** Timestamp of last abort in passive mode — for grace period */
	lastAbortAt: number
	/** Timestamp of last passive continuation attempt — for cooldown */
	lastContinuationAt: number
	/** Whether a continuation prompt is currently in-flight (prevents double-fire) */
	inflight: boolean
}

export function createInitialState(): ContinuationState {
	return {
		sessionId: null,
		totalSessionContinuations: 0,
		workCycleStartedAt: 0,
		consecutiveAborts: 0,
		lastAbortAt: 0,
		lastContinuationAt: 0,
		inflight: false,
	}
}

// ─── Config Helpers ───────────────────────────────────────────────────────────

/** Merge partial config into defaults */
export function mergeConfig(partial: Partial<ContinuationConfig>): ContinuationConfig {
	return {
		features: {
			...DEFAULT_FEATURES,
			...partial.features,
		},
		thresholds: {
			...DEFAULT_THRESHOLDS,
			...partial.thresholds,
		},
	}
}

// ─── Autowork Algorithm Types ─────────────────────────────────────────────────

/**
 * Algorithm identifiers for autowork variants.
 *
 * - `kraemer` (autowork)   — Original algorithm. Binary DONE/VERIFIED promise loop.
 * - `kubet`   (autowork1)  — Validator pipeline (levels 0-3) + async process critic.
 * - `ino`     (autowork2)  — Kanban board flow. Per-card lifecycle with stage gates.
 * - `saumya`  (autowork3)  — Entropy-scheduled: diverge → branch → attack → rank → compress.
 */
export type AutoworkAlgorithm = "kraemer" | "kubet" | "ino" | "saumya"

/** Maps slash command names to algorithm IDs */
export const COMMAND_TO_ALGORITHM: Record<string, AutoworkAlgorithm> = {
	autowork: "kraemer",
	autowork1: "kubet",
	autowork2: "ino",
	autowork3: "saumya",
}

// ─── Kubet Algorithm — Validator Levels ───────────────────────────────────────

/**
 * Validator levels for the Kubet algorithm end-validation pipeline.
 * Each level is a strict superset of the previous one.
 *
 * 0 = Off          — No validation, loop stops on first DONE
 * 1 = Format       — Structural correctness: files exist, syntax OK, builds clean
 * 2 = Quality OK   — Level 1 + tests pass, requirements traced, no anti-patterns
 * 3 = Top Notch    — Level 2 + adversarial review, edge cases, perf, docs, regressions
 */
export type KubetValidatorLevel = 0 | 1 | 2 | 3

export const KUBET_CONFIG = {
	/** Default validator level — top notch by default */
	defaultValidatorLevel: 3 as KubetValidatorLevel,
	/** How often (in iterations) the async critic evaluates process efficiency */
	criticIntervalIterations: 3,
	/** Max critic interventions before it backs off */
	maxCriticInterventions: 20,
} as const

// ─── Ino Algorithm — Kanban Stages ────────────────────────────────────────────

/**
 * Kanban card stages for the Ino algorithm.
 * Cards progress: backlog → in_progress → review → testing → done
 */
export type KanbanStage = "backlog" | "in_progress" | "review" | "testing" | "done"

export const KANBAN_STAGES: readonly KanbanStage[] = [
	"backlog",
	"in_progress",
	"review",
	"testing",
	"done",
] as const

export const INO_CONFIG = {
	/** Max cards in progress simultaneously (1 for single-agent) */
	maxWip: 1,
	/** Whether to run a final integration check after all cards are done */
	finalIntegrationCheck: true,
} as const

// ─── Saumya Algorithm — Entropy-Scheduled Phases ──────────────────────────────

/**
 * Entropy phases for the Saumya algorithm.
 * The agent is driven through these in strict order:
 *
 * expand  (high entropy)   — Reframe, diverge, generate wide possibility surface
 * branch  (high entropy)   — Split into 3-5 materially different candidate paths
 * attack  (medium entropy) — Cross-attack candidates, find failure modes, merge best
 * rank    (low entropy)    — Score, select, state what was discarded and why
 * compress (minimal entropy)— Execute the winning approach with TDD
 */
export type SaumyaPhase = "expand" | "branch" | "attack" | "rank" | "compress"

export const SAUMYA_PHASES: readonly SaumyaPhase[] = [
	"expand",
	"branch",
	"attack",
	"rank",
	"compress",
] as const

export const SAUMYA_CONFIG = {
	/** Max iterations the agent can spend in a single phase before force-advancing */
	maxIterationsPerPhase: 30,
} as const

// ─── Autowork Loop Configuration ──────────────────────────────────────────────

/** Single unified autowork loop config — always self-verifies, 500 max iterations */
export const AUTOWORK_LOOP_CONFIG = {
	maxIterations: 500,
	completionPromise: "<promise>DONE</promise>",
	verificationPromise: "<promise>VERIFIED</promise>",
	selfVerify: true,
} as const

/** Runtime state of an active (or inactive) autowork loop */
export interface LoopState {
	/** Whether a loop is currently active */
	active: boolean
	/** The original task prompt that started the loop */
	taskPrompt: string | null
	/** Current iteration count */
	iteration: number
	/** Session ID the loop is running in */
	sessionId: string | null
	/** Timestamp when the loop was started */
	startedAt: number
	/** Whether currently in self-verification phase */
	inVerification: boolean
	/** Number of messages at loop start — scan from here for promise detection */
	messageCountAtStart: number
	/** Consecutive injection failures — drives exponential backoff */
	consecutiveFailures: number
	/** Timestamp of last failure */
	lastFailureAt: number
	/** Timestamp of last successful injection */
	lastInjectedAt: number
	/** Whether continuation was explicitly stopped by /autowork-stop */
	stopped: boolean
	/** Timestamp of last detected abort event (for grace period) */
	lastAbortAt: number
	/** Which algorithm is driving this loop */
	algorithm: AutoworkAlgorithm
	/** Kubet: current validator level (0-3) */
	kubetValidatorLevel: KubetValidatorLevel
	/** Kubet: number of async critic interventions so far */
	kubetCriticCount: number
	/** Kubet: iteration at which the last critic ran */
	kubetLastCriticAt: number
	/** Ino: current kanban stage being tracked (derived from card states) */
	inoCurrentStage: KanbanStage | null
	/** Saumya: current entropy phase */
	saumyaPhase: SaumyaPhase
	/** Saumya: iteration at which the current phase started */
	saumyaPhaseStartedAt: number
}

/** Create a fresh loop state (no active loop) */
export function createInitialLoopState(): LoopState {
	return {
		active: false,
		taskPrompt: null,
		iteration: 0,
		sessionId: null,
		startedAt: 0,
		inVerification: false,
		messageCountAtStart: 0,
		consecutiveFailures: 0,
		lastFailureAt: 0,
		lastInjectedAt: 0,
		stopped: false,
		lastAbortAt: 0,
		algorithm: "kraemer",
		kubetValidatorLevel: KUBET_CONFIG.defaultValidatorLevel,
		kubetCriticCount: 0,
		kubetLastCriticAt: 0,
		inoCurrentStage: null,
		saumyaPhase: "expand",
		saumyaPhaseStartedAt: 0,
	}
}
