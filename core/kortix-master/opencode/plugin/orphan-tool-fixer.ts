/**
 * Orphan Tool-Call Fixer Plugin (v4)
 *
 * Prevents orphaned tool_use blocks that lack corresponding tool_result blocks.
 * This happens when tool execution is aborted mid-flight (cancellation, timeout,
 * crash, dispose) and the session resumes — the Anthropic API rejects the
 * conversation because every tool_use must have a matching tool_result.
 *
 * Runs in the `experimental.chat.messages.transform` hook (before every LLM call).
 *
 * Strategy (three-layer defense + persistence):
 *
 *   Layer 1 — STRIP broken tool parts:
 *     Remove tool parts where input is empty/missing (call was aborted before
 *     args were parsed). These produce tool_use blocks with `input: {}` that
 *     break the OpenAI→Anthropic conversion — the tool_result gets dropped
 *     and Anthropic rejects with "tool_use ids found without tool_result".
 *     Stripped parts are replaced with a text note so context isn't silently lost.
 *
 *   Layer 2 — NORMALIZE incomplete tool parts:
 *     Tool parts stuck in pending/running state are patched to error status
 *     with a synthetic error message. toModelMessages converts error → output-error
 *     UI state, which the AI SDK handles correctly (tool-call + tool-result pair).
 *
 *   Layer 3 — CLEAR message-level errors:
 *     If an assistant message has info.error (non-AbortedError), toModelMessages
 *     skips the entire message via `continue`. For messages with tool parts,
 *     skipping drops tool_use blocks. We clear the error so the message is included.
 *
 *   Persistence — WRITE FIXES TO DB:
 *     After fixing parts in-memory, the plugin writes the same fix to the
 *     OpenCode SQLite database. This makes the fix permanent — the broken part
 *     is rewritten as a text note in the `part` table, so it never triggers
 *     the fixer again. Similarly, normalized parts and cleared message errors
 *     are persisted so the repair is a one-time operation.
 */

import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import os from "node:os"

// bun:sqlite is available at runtime but not in tsc — use dynamic import
let SqliteDatabase: any = null
async function loadSqlite() {
	if (SqliteDatabase) return SqliteDatabase
	try {
		const mod = await import("bun:sqlite")
		SqliteDatabase = mod.Database ?? mod.default
		return SqliteDatabase
	} catch {
		return null
	}
}

// ── Types matching the transform hook's message shape ────────────────────────

interface ToolState {
	status?: string
	error?: string
	input?: Record<string, unknown>
	output?: string
	raw?: string
	title?: string
	metadata?: Record<string, unknown>
	time?: { start?: number; end?: number; compacted?: number }
	attachments?: unknown[]
}

interface ChatMessagePart {
	id?: string
	sessionID?: string
	messageID?: string
	type?: string
	callID?: string
	tool?: string
	state?: ToolState
	text?: string
	[key: string]: unknown
}

interface MessageError {
	name?: string
	data?: { message?: string; [key: string]: unknown }
	[key: string]: unknown
}

interface ChatMessage {
	info?: {
		role?: string
		id?: string
		sessionID?: string
		error?: MessageError
		[key: string]: unknown
	}
	parts?: ChatMessagePart[]
	[key: string]: unknown
}

// ── Database ────────────────────────────────────────────────────────────────

const DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")

function getDb(DBClass: any): any | null {
	try {
		return new DBClass(DB_PATH, { readwrite: true })
	} catch {
		return null
	}
}

/**
 * Persist a stripped tool part → text part replacement to the DB.
 * Rewrites the part's `data` column from a tool JSON to a text JSON.
 */
function persistStripToDb(db: any, part: ChatMessagePart, replacementText: string): void {
	if (!part.id) return
	const newData = JSON.stringify({
		type: "text",
		text: replacementText,
	})
	db.prepare("UPDATE part SET data = $data, time_updated = $now WHERE id = $id").run({
		$data: newData,
		$now: Date.now(),
		$id: part.id,
	})
}

/**
 * Persist a normalized tool part (pending/running → error) to the DB.
 */
function persistNormalizeToDb(db: any, part: ChatMessagePart): void {
	if (!part.id || !part.state) return
	// Re-read the full row to preserve fields we don't track in our local type
	const row = db.prepare("SELECT data FROM part WHERE id = $id").get({ $id: part.id }) as
		| { data: string }
		| null
	if (!row) return
	try {
		const existing = JSON.parse(row.data)
		existing.state = part.state
		db.prepare("UPDATE part SET data = $data, time_updated = $now WHERE id = $id").run({
			$data: JSON.stringify(existing),
			$now: Date.now(),
			$id: part.id,
		})
	} catch {
		// JSON parse failed — skip persistence, in-memory fix still works
	}
}

/**
 * Persist cleared message-level error to the DB.
 */
function persistClearErrorToDb(db: any, messageId: string): void {
	const row = db.prepare("SELECT data FROM message WHERE id = $id").get({ $id: messageId }) as
		| { data: string }
		| null
	if (!row) return
	try {
		const existing = JSON.parse(row.data)
		delete existing.error
		db.prepare("UPDATE message SET data = $data, time_updated = $now WHERE id = $id").run({
			$data: JSON.stringify(existing),
			$now: Date.now(),
			$id: messageId,
		})
	} catch {
		// JSON parse failed — skip
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ABORTED_ERROR_NAME = "MessageAbortedError"

function isAbortedMessageError(error: MessageError | undefined): boolean {
	if (!error) return false
	return error.name === ABORTED_ERROR_NAME
}

function isToolPart(part: ChatMessagePart): boolean {
	return part.type === "tool" && typeof part.callID === "string" && part.callID.length > 0
}

function hasEmptyInput(part: ChatMessagePart): boolean {
	const input = part.state?.input
	if (!input) return true
	if (typeof input !== "object") return true
	return Object.keys(input).length === 0
}

function isIncompleteToolPart(part: ChatMessagePart): boolean {
	if (!isToolPart(part)) return false
	const status = part.state?.status
	return status !== "completed" && status !== "error"
}

function shouldStripToolPart(part: ChatMessagePart): boolean {
	if (!isToolPart(part)) return false
	if (!part.state) return true
	// Only strip empty-input tools if they never ran — zero-arg tools
	// (e.g. project_list, pty_list) legitimately have input: {} when executed.
	// Completed or errored tools already have a tool_result pair, so stripping
	// them would create orphaned tool_results that break Anthropic's API.
	if (hasEmptyInput(part) && part.state.status !== "completed" && part.state.status !== "error") return true
	return false
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const OrphanToolFixerPlugin: Plugin = async (_ctx) => {
	console.error("[orphan-tool-fixer] Plugin loaded (v4 — persistent)")

	// Pre-load sqlite so the first transform isn't slow
	loadSqlite().catch(() => {})

	return {
		"experimental.chat.messages.transform": async (_input, output) => {
			const messages = output.messages as ChatMessage[]
			if (!messages?.length) return

			let strippedParts = 0
			let normalizedParts = 0
			let clearedErrors = 0
			const now = Date.now()

			// Collect DB writes — batch them after in-memory fixes
			const dbWrites: Array<(db: any) => void> = []

			for (const message of messages) {
				if (message.info?.role !== "assistant") continue
				if (!Array.isArray(message.parts) || message.parts.length === 0) continue

				const toolParts = message.parts.filter(isToolPart)
				if (toolParts.length === 0) continue

				// ── Layer 3: Clear message-level non-AbortedError ────────
				if (message.info?.error && !isAbortedMessageError(message.info.error)) {
					const msgId = message.info.id
					console.error(
						`[orphan-tool-fixer] Clearing message-level error (${message.info.error.name}) on ${msgId}`,
					)
					delete message.info.error
					clearedErrors++
					if (msgId) {
						dbWrites.push((db) => persistClearErrorToDb(db as any, msgId))
					}
				}

				// ── Layer 1: Strip broken tool parts ─────────────────────
				for (let i = message.parts.length - 1; i >= 0; i--) {
					const part = message.parts[i]!
					if (!isToolPart(part)) continue
					if (!shouldStripToolPart(part)) continue

					const toolName = part.tool ?? "unknown"
					const callID = part.callID ?? "?"
					const status = part.state?.status ?? "unknown"
					const replacementText = `[Tool call "${toolName}" was aborted before execution (call ${callID})]`

					console.error(
						`[orphan-tool-fixer] Stripping broken tool part: ${toolName} (${callID}) status=${status} input=empty`,
					)

					// Capture part ref before splice for DB write
					const partRef = { ...part }
					dbWrites.push((db) => persistStripToDb(db as any, partRef, replacementText))

					// Replace in-memory with text note
					message.parts.splice(i, 1, {
						type: "text",
						text: replacementText,
					})
					strippedParts++
				}

				// ── Layer 2: Normalize pending/running → error ───────────
				for (const part of message.parts) {
					if (!isToolPart(part)) continue
					if (!isIncompleteToolPart(part)) continue

					const prevStatus = part.state?.status ?? "unknown"
					const prevInput = part.state?.input ?? {}

					part.state = {
						status: "error",
						input: prevInput,
						error: `[Tool execution interrupted — was ${prevStatus} when session was aborted]`,
						time: {
							start: part.state?.time?.start ?? now,
							end: now,
						},
					}
					normalizedParts++

					const partRef = part
					dbWrites.push((db) => persistNormalizeToDb(db as any, partRef))
				}
			}

			// ── Persist all fixes to DB ──────────────────────────────────
			if (dbWrites.length > 0) {
				console.error(
					`[orphan-tool-fixer] Fixed: ${strippedParts} stripped, ${normalizedParts} normalized, ${clearedErrors} msg errors cleared — persisting ${dbWrites.length} DB writes`,
				)

				const DBClass = await loadSqlite()
				let db: any = null
				try {
					db = DBClass ? getDb(DBClass) : null
					if (db) {
						db.exec("BEGIN")
						for (const write of dbWrites) {
							write(db)
						}
						db.exec("COMMIT")
						console.error(`[orphan-tool-fixer] Persisted ${dbWrites.length} fix(es) to DB`)
					} else {
						console.error("[orphan-tool-fixer] Could not open DB — fixes are in-memory only this run")
					}
				} catch (err) {
					console.error(`[orphan-tool-fixer] DB persist failed: ${(err as Error).message} — in-memory fixes still active`)
					try {
						db?.exec("ROLLBACK")
					} catch {
						// ignore rollback failure
					}
				} finally {
					try {
						db?.close()
					} catch {
						// ignore close failure
					}
				}
			}
		},
	}
}

export default OrphanToolFixerPlugin
