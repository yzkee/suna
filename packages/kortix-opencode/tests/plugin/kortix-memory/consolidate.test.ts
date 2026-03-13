import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { unlinkSync } from "node:fs"
import { initDb, insertObservation, getAllLTM, getRecentLTM, ensureSession, insertLTM } from "../../../plugin/kortix-memory/src/db"
import { consolidateMemories } from "../../../plugin/kortix-memory/src/consolidate"
import { setActiveProvider } from "../../../plugin/kortix-memory/src/llm"
import type { CreateObservationInput } from "../../../plugin/kortix-memory/src/types"
import type { Database } from "bun:sqlite"

const TEST_DB_PATH = "/tmp/kortix-memory-consolidate-test.db"
let db: Database

const noopLog = () => {}

function makeObs(overrides: Partial<CreateObservationInput> = {}): CreateObservationInput {
	return {
		sessionId: "ses_test",
		type: "discovery",
		title: "Read some file",
		narrative: "Read a file to understand the codebase",
		facts: ["Found auth module"],
		concepts: ["auth"],
		filesRead: ["/src/auth.ts"],
		filesModified: [],
		toolName: "read",
		promptNumber: 1,
		...overrides,
	}
}

/**
 * Set up a fake provider so consolidateMemories can resolve an LLM config.
 * The actual LLM call is intercepted by the mocked fetch.
 */
function setTestProvider() {
	setActiveProvider({
		providerID: "anthropic",
		modelID: "claude-sonnet-4-5-20250929",
		apiKey: "test-key",
		baseURL: "http://localhost",
	})
}

/**
 * Clear the active provider so no LLM config can be resolved.
 */
function clearTestProvider() {
	// Set with empty key to simulate no provider
	setActiveProvider({
		providerID: "",
		modelID: "",
		apiKey: "",
	})
}

beforeEach(() => {
	try { unlinkSync(TEST_DB_PATH) } catch { /* */ }
	db = initDb(TEST_DB_PATH)
	ensureSession(db, "ses_test")
})

afterEach(() => {
	db.close()
	try { unlinkSync(TEST_DB_PATH) } catch { /* */ }
	clearTestProvider()
})

// ─── Mock LLM response ──────────────────────────────────────────────────────

function mockFetchWith(response: object) {
	return mock((url: string | URL | Request, init?: RequestInit) => {
		return Promise.resolve(new Response(JSON.stringify(response), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}))
	})
}

const VALID_LLM_RESPONSE = {
	content: [{
		text: JSON.stringify({
			episodic: [
				{
					content: "Built authentication system with JWT",
					caption: "Built JWT auth system",
					context: "Session focused on auth module",
					tags: ["auth", "jwt"],
					files: ["/src/auth.ts"],
					source_observation_ids: [1],
				},
			],
			semantic: [
				{
					content: "The API uses JWT refresh tokens at /api/auth/refresh",
					caption: "API uses JWT refresh tokens",
					context: "Core architectural fact",
					tags: ["auth", "jwt", "api"],
					files: ["/src/auth.ts"],
					source_observation_ids: [1],
				},
			],
			procedural: [
				{
					content: "To test auth: run bun test src/auth.test.ts",
					caption: "Run bun test for auth",
					tags: ["testing", "auth"],
					files: ["/src/auth.test.ts"],
					source_observation_ids: [1],
				},
			],
			}),
	}],
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("consolidateMemories", () => {
	it("does nothing when session has no observations", async () => {
		setTestProvider()
		const originalFetch = globalThis.fetch
		globalThis.fetch = mockFetchWith(VALID_LLM_RESPONSE) as any

		const result = await consolidateMemories(db, "ses_test", noopLog)

		expect(result.newMemories).toHaveLength(0)

		globalThis.fetch = originalFetch
	})

	it("consolidates observations into LTM entries", async () => {
		setTestProvider()
		// Insert observations
		insertObservation(db, makeObs({ title: "Read auth.ts" }))
		insertObservation(db, makeObs({ title: "Edited auth.ts", type: "change" }))

		const originalFetch = globalThis.fetch
		globalThis.fetch = mockFetchWith(VALID_LLM_RESPONSE) as any

		const result = await consolidateMemories(db, "ses_test", noopLog)

		expect(result.newMemories.length).toBeGreaterThan(0)

		// Check that LTM entries were inserted into DB
		const allLTM = getAllLTM(db)
		expect(allLTM.length).toBeGreaterThan(0)

		// Should have at least one of each type
		const types = allLTM.map((m) => m.type)
		expect(types).toContain("episodic")
		expect(types).toContain("semantic")
		expect(types).toContain("procedural")

		globalThis.fetch = originalFetch
	})

	it("handles LLM failure gracefully — returns empty result", async () => {
		setTestProvider()
		insertObservation(db, makeObs())

		const originalFetch = globalThis.fetch
		globalThis.fetch = mock(() => Promise.resolve(new Response("Internal Server Error", { status: 500 }))) as any

		const result = await consolidateMemories(db, "ses_test", noopLog)

		expect(result.newMemories).toHaveLength(0)

		// No LTM entries should exist
		const allLTM = getAllLTM(db)
		expect(allLTM).toHaveLength(0)

		globalThis.fetch = originalFetch
	})

	it("handles malformed JSON response gracefully", async () => {
		setTestProvider()
		insertObservation(db, makeObs())

		const originalFetch = globalThis.fetch
		globalThis.fetch = mock(() => Promise.resolve(new Response(
			JSON.stringify({ content: [{ text: "not valid json" }] }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		))) as any

		const result = await consolidateMemories(db, "ses_test", noopLog)

		expect(result.newMemories).toHaveLength(0)

		globalThis.fetch = originalFetch
	})

	it("passes existing LTM to LLM for deduplication context", async () => {
		setTestProvider()
		// Pre-existing LTM
		insertLTM(db, {
			type: "semantic",
			content: "Existing fact about auth",
			tags: ["auth"],
		})

		insertObservation(db, makeObs())

		let capturedBody = ""
		const originalFetch = globalThis.fetch
		globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
			capturedBody = (init?.body as string) ?? ""
			return Promise.resolve(new Response(JSON.stringify(VALID_LLM_RESPONSE), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}))
		}) as any

		await consolidateMemories(db, "ses_test", noopLog)

		expect(capturedBody.length).toBeGreaterThan(0)
		expect(capturedBody).toContain("Existing fact about auth")

		globalThis.fetch = originalFetch
	})

	it("returns empty when no LLM provider is configured", async () => {
		clearTestProvider()
		insertObservation(db, makeObs())

		// Also clear env vars that might be set
		const savedAnthropicKey = process.env.ANTHROPIC_API_KEY
		const savedKortixUrl = process.env.KORTIX_API_URL
		const savedKortixToken = process.env.KORTIX_TOKEN
		delete process.env.ANTHROPIC_API_KEY
		delete process.env.KORTIX_API_URL
		delete process.env.KORTIX_TOKEN

		const result = await consolidateMemories(db, "ses_test", noopLog)

		expect(result.newMemories).toHaveLength(0)

		// Restore env vars
		if (savedAnthropicKey) process.env.ANTHROPIC_API_KEY = savedAnthropicKey
		if (savedKortixUrl) process.env.KORTIX_API_URL = savedKortixUrl
		if (savedKortixToken) process.env.KORTIX_TOKEN = savedKortixToken
	})

	it("sends correct Anthropic API format", async () => {
		setTestProvider()
		insertObservation(db, makeObs())

		let capturedUrl = ""
		let capturedHeaders: Record<string, string> = {}
		let capturedBody: Record<string, any> = {}

		const originalFetch = globalThis.fetch
		globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
			capturedUrl = String(url)
			capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries())
			capturedBody = JSON.parse((init?.body as string) ?? "{}")
			return Promise.resolve(new Response(JSON.stringify(VALID_LLM_RESPONSE), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}))
		}) as any

		await consolidateMemories(db, "ses_test", noopLog)

		expect(capturedUrl).toBe("http://localhost/v1/messages")
		expect(capturedHeaders["x-api-key"]).toBe("test-key")
		expect(capturedBody.messages).toHaveLength(1) // user only (system is separate for Anthropic)
		expect(capturedBody.messages[0].role).toBe("user")
		expect(capturedBody.system).toBeDefined()

		globalThis.fetch = originalFetch
	})
})
