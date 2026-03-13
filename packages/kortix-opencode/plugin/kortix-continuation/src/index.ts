export {
	type ContinuationConfig,
	type ContinuationFeatures,
	type ContinuationThresholds,
	type ContinuationState,
	type LoopState,
	DEFAULT_CONFIG,
	DEFAULT_FEATURES,
	DEFAULT_THRESHOLDS,
	AUTOWORK_LOOP_CONFIG,
	AUTOWORK_KEYWORDS,
	INTERNAL_MARKER,
	CODE_BLOCK_PATTERN,
	INLINE_CODE_PATTERN,
	createInitialState,
	createInitialLoopState,
	mergeConfig,
} from "./config"

export {
	type Intent,
	type IntentResult,
	classifyIntent,
} from "./intent-gate"

export {
	type TodoVerdict,
	type TodoEnforcerResult,
	evaluateTodos,
	formatRemainingWork,
} from "./todo-enforcer"

export {
	type ContinuationAction,
	type ContinuationDecision,
	evaluate,
} from "./continuation-engine"

export {
	type PlanSection,
	type PlanItem,
	getPlanPath,
	planExists,
	readPlan,
	writePlan,
	generatePlanTemplate,
	planHasUnfinishedWork,
} from "./planner"

export {
	type LoopAction,
	type LoopDecision,
	evaluateLoop,
	startLoop,
	stopLoop,
	markStopped,
	clearStopped,
	recordAbort,
	advanceIteration,
	recordFailure,
	enterVerification,
	exitVerification,
	checkLoopSafetyGates,
	persistLoopState,
	loadPersistedLoopState,
} from "./loop"
