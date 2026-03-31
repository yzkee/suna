import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const envKeys = ["KORTIX_WORKSPACE", "OPENCODE_CONFIG_DIR", "KORTIX_DIR"] as const
const originalEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]])) as Record<(typeof envKeys)[number], string | undefined>
let root = ""

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "kortix-sessions-"))
	process.env.KORTIX_WORKSPACE = root
	process.env.OPENCODE_CONFIG_DIR = path.join(root, ".opencode")
	mkdirSync(process.env.OPENCODE_CONFIG_DIR!, { recursive: true })
	mkdirSync(path.join(root, ".kortix"), { recursive: true })
})

afterEach(() => {
	for (const key of envKeys) {
		const value = originalEnv[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
	rmSync(root, { recursive: true, force: true })
})

function writeDb() {
	const db = new Database(path.join(root, ".kortix", "kortix.db"))
	db.exec(`
		CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, description TEXT, created_at TEXT, opencode_id TEXT);
		CREATE TABLE IF NOT EXISTS session_projects (session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, set_at TEXT NOT NULL);
	`)
	const projPath = path.join(root, "proj-a")
	mkdirSync(path.join(projPath, ".kortix"), { recursive: true })
	writeFileSync(path.join(projPath, ".kortix", "CONTEXT.md"), "# Project A\n\n## Architecture\n\n- API in FastAPI\n- Web in Next.js\n")
	db.prepare("INSERT INTO projects (id, name, path, description, created_at, opencode_id) VALUES (?, ?, ?, ?, ?, ?)")
		.run("p1", "proj-a", projPath, "", new Date().toISOString(), null)
	db.prepare("INSERT INTO session_projects (session_id, project_id, set_at) VALUES (?, ?, ?)")
		.run("ses_test_123", "p1", new Date().toISOString())
	db.close()
	return projPath
}

describe("kortix-sessions memory injection", () => {
	test("injects USER.md + MEMORY.md + project CONTEXT.md", async () => {
		writeFileSync(path.join(root, ".kortix", "USER.md"), "# User Profile\n\n## Preferences\n\n- concise\n")
		writeFileSync(path.join(root, ".kortix", "MEMORY.md"), "# Global Memory\n\n## Stack\n\n- uses Supabase\n")
		writeDb()

		const mod = await import("./kortix-sessions")
		const plugin = await mod.KortixSessionsPlugin({ client: {}, directory: root } as any)
		await plugin.hooks!.event!({ event: { type: "session.created", properties: { sessionID: "ses_test_123" } } as any })

		const output = {
			messages: [{ info: { role: "user", id: "u1", sessionID: "ses_test_123" }, parts: [{ type: "text", text: "hello" }] }],
		}

		await plugin.hooks!["experimental.chat.messages.transform"]!({} as any, output as any)
		const txt = output.messages[0]!.parts!.map((p: any) => p.text || "").join("\n")
		expect(txt).toContain("## User")
		expect(txt).toContain("concise")
		expect(txt).toContain("## Memory")
		expect(txt).toContain("uses Supabase")
		expect(txt).toContain("<project_context>")
		expect(txt).toContain("API in FastAPI")
	})
})
