/**
 * Shared LLM Infrastructure
 *
 * Provides a unified interface for calling LLMs.
 *
 * Provider resolution priority:
 *   1. Cached provider config from the running OpenCode session
 *      (captured via chat.params hook — uses whatever model the user selected)
 *   2. SDK client.config.providers() lookup (startup fallback)
 *   3. Environment variables: ANTHROPIC_API_KEY, KORTIX_API_URL+KORTIX_TOKEN (legacy fallback)
 *
 * This ensures the memory plugin always works with whatever LLM provider is
 * actively running the agent — no separate env var config required.
 */

import type { LogFn } from "./types"

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_MAX_TOKENS = 2000
const ANTHROPIC_VERSION = "2023-06-01"

// Models to use for memory operations (lightweight — consolidation/enrichment)
// These are overridden if the running provider uses a different model.
const FALLBACK_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929"
const FALLBACK_OPENAI_COMPAT_MODEL = "anthropic/claude-sonnet-4-6"

/**
 * Validate that a URL string is a real http(s) URL, not an unresolved
 * `{env:...}` template or other garbage that would crash fetch().
 */
function isValidUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "http:" || parsed.protocol === "https:"
	} catch {
		return false
	}
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LLMConfig {
	type: "anthropic" | "openai-compat"
	baseURL: string
	apiKey: string
	model: string
}

export interface LLMOptions {
	/** Model ID override (e.g. "anthropic/claude-sonnet-4-6") */
	model?: string
	maxTokens?: number
}

/**
 * Captured provider configuration from the running OpenCode session.
 * Set via setActiveProvider() when chat.params fires.
 */
export interface ActiveProviderInfo {
	providerID: string
	modelID: string
	apiKey: string
	baseURL?: string
	/** Additional options from provider config */
	options?: Record<string, unknown>
}

// ─── Cached Provider State ───────────────────────────────────────────────────

let cachedProvider: ActiveProviderInfo | null = null

/**
 * Set the active provider info. Called from the plugin's chat.params hook
 * whenever the user sends a message — this captures the exact provider
 * credentials being used to run the agent.
 */
export function setActiveProvider(info: ActiveProviderInfo): void {
	cachedProvider = info
}

/**
 * Get the currently cached provider info (for debugging/logging).
 */
export function getActiveProvider(): ActiveProviderInfo | null {
	return cachedProvider
}

// ─── Provider Resolution ─────────────────────────────────────────────────────

/**
 * Determine the provider type from the provider ID.
 */
function classifyProvider(providerID: string): "anthropic" | "openai-compat" {
	const lower = providerID.toLowerCase()
	if (lower === "anthropic" || lower.includes("anthropic")) return "anthropic"
	// Everything else (openrouter, openai, local, kortix, etc.) uses OpenAI-compatible API
	return "openai-compat"
}

/**
 * Get the default base URL for known providers.
 */
function defaultBaseURL(providerID: string): string {
	const lower = providerID.toLowerCase()
	if (lower === "anthropic" || lower.includes("anthropic")) return "https://api.anthropic.com"
	if (lower === "openrouter" || lower.includes("openrouter")) return "https://openrouter.ai/api"
	if (lower === "openai" || lower.includes("openai")) return "https://api.openai.com"
	// Fallback for unknown providers
	return "https://api.anthropic.com"
}

/**
 * Pick a suitable model for memory operations.
 * We prefer a smaller/cheaper model than what the user may be running
 * (e.g. if they're on opus, we still use sonnet for enrichment/consolidation).
 */
function pickMemoryModel(providerID: string, userModel: string): string {
	const lower = providerID.toLowerCase()

	if (lower === "anthropic" || lower.includes("anthropic")) {
		// Use sonnet for memory ops regardless of what the user is running
		return FALLBACK_ANTHROPIC_MODEL
	}

	// For OpenAI-compatible providers, use the user's model as-is
	// (we don't know what models they have available)
	return userModel
}

/**
 * Resolve the best available LLM provider.
 *
 * Priority:
 *   1. Cached provider from chat.params hook (the running session's provider)
 *   2. Environment variables (legacy fallback)
 */
export function resolveLLMConfig(opts?: LLMOptions): LLMConfig | null {
	// ── Priority 1: Cached provider from the running session ──
	if (cachedProvider?.apiKey) {
		const providerType = classifyProvider(cachedProvider.providerID)
		const baseURL = cachedProvider.baseURL
			? (isValidUrl(cachedProvider.baseURL) ? cachedProvider.baseURL : defaultBaseURL(cachedProvider.providerID))
			: defaultBaseURL(cachedProvider.providerID)

		const model = opts?.model ?? pickMemoryModel(cachedProvider.providerID, cachedProvider.modelID)

		return {
			type: providerType,
			baseURL: baseURL.replace(/\/+$/, ""),
			apiKey: cachedProvider.apiKey,
			model,
		}
	}

	// ── Priority 2: Environment variables (legacy) ──

	// Kortix router
	const kortixUrl = process.env.KORTIX_API_URL
	const kortixToken = process.env.KORTIX_TOKEN
	if (kortixUrl && kortixToken && isValidUrl(kortixUrl)) {
		return {
			type: "openai-compat",
			baseURL: kortixUrl.replace(/\/+$/, ""),
			apiKey: kortixToken,
			model: opts?.model ?? FALLBACK_OPENAI_COMPAT_MODEL,
		}
	}

	// Anthropic API key
	const anthropicKey = process.env.ANTHROPIC_API_KEY
	if (anthropicKey) {
		const rawBaseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
		const baseURL = isValidUrl(rawBaseUrl) ? rawBaseUrl : "https://api.anthropic.com"
		return {
			type: "anthropic",
			baseURL: baseURL.replace(/\/+$/, ""),
			apiKey: anthropicKey,
			model: opts?.model ?? FALLBACK_ANTHROPIC_MODEL,
		}
	}

	return null
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

/**
 * Call an LLM with the given system prompt and user message.
 * Routes to the correct API format based on config.type.
 * Returns the raw text response or null on error.
 */
export async function callLLM(
	config: LLMConfig,
	system: string,
	userMessage: string,
	log: LogFn,
	maxTokens?: number,
): Promise<string | null> {
	try {
		if (config.type === "anthropic") {
			return await callAnthropicAPI(config, system, userMessage, log, maxTokens)
		} else {
			return await callOpenAICompatible(config, system, userMessage, log, maxTokens)
		}
	} catch (err) {
		log("warn", `[memory:llm] LLM call failed (${config.type}/${config.model}): ${err}`)
		return null
	}
}

// ─── Provider Implementations ────────────────────────────────────────────────

async function callOpenAICompatible(
	config: LLMConfig,
	system: string,
	userMessage: string,
	log: LogFn,
	maxTokens?: number,
): Promise<string | null> {
	// Build the URL — handle various base URL formats
	let url = config.baseURL
	if (url.endsWith("/v1/router")) {
		url = `${url}/chat/completions`
	} else if (url.endsWith("/v1")) {
		url = `${url}/chat/completions`
	} else if (url.endsWith("/api")) {
		url = `${url}/v1/chat/completions`
	} else if (!url.includes("/chat/completions")) {
		url = `${url}/v1/chat/completions`
	}

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: userMessage },
			],
		}),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		log("warn", `[memory:llm] OpenAI-compat API error ${response.status} (${url}): ${text.slice(0, 200)}`)
		return null
	}

	const data = await response.json() as any
	const text = data?.choices?.[0]?.message?.content
	return text?.trim() ?? null
}

async function callAnthropicAPI(
	config: LLMConfig,
	system: string,
	userMessage: string,
	log: LogFn,
	maxTokens?: number,
): Promise<string | null> {
	const url = `${config.baseURL}/v1/messages`
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": config.apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
			system,
			messages: [{ role: "user", content: userMessage }],
		}),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		log("warn", `[memory:llm] Anthropic API error ${response.status}: ${text.slice(0, 200)}`)
		return null
	}

	const data = await response.json() as any
	const text = data?.content?.[0]?.text
	return text?.trim() ?? null
}

// ─── JSON Extraction Helper ──────────────────────────────────────────────────

/**
 * Extract JSON from an LLM response that may contain markdown fences or preamble.
 */
export function extractJson(text: string): string {
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
	if (fenceMatch?.[1]) return fenceMatch[1].trim()
	const objMatch = text.match(/\{[\s\S]*\}/)
	if (objMatch) return objMatch[0]
	return text
}
