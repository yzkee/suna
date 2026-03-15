/**
 * Kortix Orchestrator Plugin — Simplified
 *
 * Projects + async session spawning. That's it.
 *
 * Storage: .kortix/kortix.db (SQLite)
 *   - projects: registry + auto-discovery via .kortix/project.json
 *   - delegations: which sessions were spawned, in which project, by whom
 *
 * Tools (8):
 *   project_create, project_list, project_get, project_update
 *   worker_spawn, worker_list, worker_read, worker_message
 *
 * Flow:
 *   1. Orchestrator calls worker_spawn(project, prompt) → fire & forget
 *   2. KortixWorker session runs autonomously (autowork loop)
 *   3. On completion/failure → <session-report> lands in orchestrator's thread
 *   4. Orchestrator processes, spawns next work
 */

import { Database } from "bun:sqlite"
import * as fs from "node:fs/promises"
import { mkdirSync, readdirSync, statSync, readFileSync, existsSync, unlinkSync } from "node:fs"
import * as path from "node:path"
import { type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectRow { id: string; name: string; path: string; description: string; created_at: string }
interface DelegationRow {
	session_id: string; project_id: string; prompt: string; agent: string
	parent_session_id: string; parent_agent: string
	status: string; result: string | null; created_at: string; completed_at: string | null
}
interface ProjectMarker { name: string; description: string; created: string }

// ── Database ─────────────────────────────────────────────────────────────────

function initDb(dbPath: string): Database {
	mkdirSync(path.dirname(dbPath), { recursive: true })
	// Clean orphaned WAL/SHM to prevent I/O errors from crashed processes
	try {
		if (!existsSync(dbPath) || statSync(dbPath).size === 0) {
			try { unlinkSync(dbPath + "-wal") } catch {}
			try { unlinkSync(dbPath + "-shm") } catch {}
			try { if (existsSync(dbPath) && statSync(dbPath).size === 0) unlinkSync(dbPath) } catch {}
		}
	} catch {}

	const db = new Database(dbPath)
	db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000")
	db.exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS delegations (
			session_id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id),
			prompt TEXT NOT NULL,
			agent TEXT NOT NULL DEFAULT 'KortixWorker',
			parent_session_id TEXT NOT NULL,
			parent_agent TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'running',
			result TEXT,
			created_at TEXT NOT NULL,
			completed_at TEXT
		);
	`)
	return db
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function projectId(name: string): string {
	return `proj-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`
}

function scanProjects(baseDir: string, maxDepth = 2, depth = 0): Array<{ dirPath: string; marker: ProjectMarker }> {
	const out: Array<{ dirPath: string; marker: ProjectMarker }> = []
	if (depth > maxDepth) return out
	let entries: string[]
	try { entries = readdirSync(baseDir) } catch { return out }
	for (const e of entries) {
		if (e === "node_modules" || e === ".git" || e === ".opencode") continue
		const fp = path.join(baseDir, e)
		try { if (!statSync(fp).isDirectory()) continue } catch { continue }
		try {
			const m = JSON.parse(readFileSync(path.join(fp, ".kortix", "project.json"), "utf8")) as ProjectMarker
			if (m.name) out.push({ dirPath: fp, marker: m })
		} catch {
			if (depth < maxDepth) out.push(...scanProjects(fp, maxDepth, depth + 1))
		}
	}
	return out
}

// ── Manager ──────────────────────────────────────────────────────────────────

class Manager {
	constructor(private client: any, private dir: string, private db: Database) {}

	// ── Projects ──

	async createProject(name: string, desc: string, customPath: string): Promise<ProjectRow> {
		const pp = customPath || path.join(this.dir, "projects", name)
		const existing = this.db.prepare("SELECT * FROM projects WHERE path=$p").get({ $p: pp }) as ProjectRow | null
		if (existing) {
			if (desc) { this.db.prepare("UPDATE projects SET description=$d WHERE id=$id").run({ $d: desc, $id: existing.id }); existing.description = desc }
			return existing
		}
		const wm = async (f: string, c: string) => { if (!existsSync(f)) await fs.writeFile(f, c, "utf8") }
		for (const d of [".opencode/agents", ".opencode/skills", ".opencode/commands", ".kortix/plans", ".kortix/docs", ".kortix/sessions"])
			await fs.mkdir(path.join(pp, d), { recursive: true })
		const marker: ProjectMarker = { name, description: desc || "", created: new Date().toISOString() }
		await wm(path.join(pp, ".kortix", "project.json"), JSON.stringify(marker, null, 2))
		await wm(path.join(pp, ".kortix", "context.md"), `# ${name}\n\n${desc || "No description."}\n\nCreated: ${marker.created}\n`)
		await wm(path.join(pp, ".gitignore"), "node_modules/\n.env\n.env.*\n!.env.example\n*.log\ndist/\n.DS_Store\n")
		await wm(path.join(pp, ".opencode", "opencode.jsonc"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2))
		if (!existsSync(path.join(pp, ".git"))) {
			try {
				await Bun.spawn(["git", "init"], { cwd: pp, stdout: "pipe", stderr: "pipe" }).exited
				await Bun.spawn(["git", "add", "-A"], { cwd: pp, stdout: "pipe", stderr: "pipe" }).exited
				await Bun.spawn(["git", "commit", "-m", "Init", "--allow-empty"], { cwd: pp, stdout: "pipe", stderr: "pipe" }).exited
			} catch {}
		}
		const id = projectId(name), now = new Date().toISOString()
		this.db.prepare("INSERT INTO projects (id,name,path,description,created_at) VALUES ($id,$n,$p,$d,$c)")
			.run({ $id: id, $n: name, $p: pp, $d: desc || "", $c: now })
		return { id, name, path: pp, description: desc || "", created_at: now }
	}

	listProjects(): ProjectRow[] {
		for (const { dirPath, marker } of scanProjects(this.dir)) {
			if (!this.db.prepare("SELECT 1 FROM projects WHERE path=$p").get({ $p: dirPath }))
				this.db.prepare("INSERT INTO projects (id,name,path,description,created_at) VALUES ($id,$n,$p,$d,$c)")
					.run({ $id: projectId(marker.name), $n: marker.name, $p: dirPath, $d: marker.description || "", $c: marker.created || new Date().toISOString() })
		}
		return this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[]
	}

	getProject(q: string): ProjectRow | null {
		return (this.db.prepare("SELECT * FROM projects WHERE path=$v").get({ $v: q })
			|| this.db.prepare("SELECT * FROM projects WHERE LOWER(name)=LOWER($v)").get({ $v: q })
			|| this.db.prepare("SELECT * FROM projects WHERE LOWER(name) LIKE LOWER($v)").get({ $v: `%${q}%` })
		) as ProjectRow | null
	}

	// ── Worker Sessions ──

	async spawn(project: ProjectRow, prompt: string, agent: string, parentSid: string, parentAgent: string): Promise<DelegationRow> {
		// Read project context
		let ctx = ""
		try { ctx = await fs.readFile(path.join(project.path, ".kortix", "context.md"), "utf8") } catch { ctx = "(none)" }

		// List other active sessions in this project for context
		const siblings = this.db.prepare("SELECT session_id, prompt, status FROM delegations WHERE project_id=$pid ORDER BY created_at DESC LIMIT 10")
			.all({ $pid: project.id }) as Array<{ session_id: string; prompt: string; status: string }>
		const siblingCtx = siblings.length > 0
			? siblings.map(s => `- [${s.status}] ${s.prompt.slice(0, 80)}`).join("\n")
			: "(none)"

		// Create child session
		const sess = await this.client.session.create({ body: { title: prompt.slice(0, 80), parentID: parentSid } })
		if (!sess.data?.id) throw new Error("Failed to create session")
		const sessionId = sess.data.id
		const agentName = agent || "KortixWorker"
		const now = new Date().toISOString()

		// Record delegation
		this.db.prepare(`INSERT INTO delegations (session_id,project_id,prompt,agent,parent_session_id,parent_agent,status,created_at)
			VALUES ($sid,$pid,$prompt,$agent,$psid,$pa,'running',$c)`)
			.run({ $sid: sessionId, $pid: project.id, $prompt: prompt, $agent: agentName, $psid: parentSid, $pa: parentAgent, $c: now })

		// Fire prompt — non-blocking
		const fullPrompt = `autowork

## Assignment

**Project:** ${project.name} — \`${project.path}\`
**Session:** ${sessionId}

## Task

${prompt}

## Project Context

${ctx}

## Other Sessions in This Project

${siblingCtx}

Check \`.kortix/sessions/\` for completed session results if you need shared context.

## Rules

1. **Working directory:** \`${project.path}\` — use \`workdir\` on bash commands.
2. **TDD:** Write tests FIRST. Implement to pass. Verify after every change. Run the FULL test suite before DONE.
3. Update \`.kortix/context.md\` with discoveries and decisions.
4. Write docs to \`.kortix/docs/\` for shared context.
5. Include test results in your final message.
6. When fully done and all tests pass, emit \`<promise>DONE</promise>\` then \`<promise>VERIFIED</promise>\`.
`

		this.client.session
			.prompt({ path: { id: sessionId }, body: { agent: agentName, parts: [{ type: "text", text: fullPrompt }] } })
			.catch((err: Error) => {
				this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
					.run({ $r: `Spawn error: ${err.message}`, $t: new Date().toISOString(), $sid: sessionId })
				this.notifyParent(sessionId)
			})

		return this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow
	}

	// ── Event Handlers ──

	async handleIdle(sessionId: string): Promise<void> {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid AND status='running'")
			.get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return

		try {
			const msgs = await this.client.session.messages({ path: { id: sessionId } })
			const data = (msgs.data ?? []) as any[]
			if (!data.length) return

			let hasVerified = false, hasDone = false
			for (const m of data) {
				if (m?.info?.role !== "assistant") continue
				for (const p of m.parts ?? [])
					if (p.type === "text" && typeof p.text === "string") {
						if (p.text.includes("<promise>VERIFIED</promise>")) hasVerified = true
						if (p.text.includes("<promise>DONE</promise>")) hasDone = true
					}
			}

			const now = new Date().toISOString()
			const result = this.extractResult(data)

			if (hasVerified) {
				this.db.prepare("UPDATE delegations SET status='complete',result=$r,completed_at=$t WHERE session_id=$sid")
					.run({ $r: result, $t: now, $sid: sessionId })
				this.persistResult(del, result)
				this.notifyParent(sessionId)
			} else if (hasDone) {
				// DONE but no VERIFIED = verification failed
				this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
					.run({ $r: `Verification failed. Last output:\n${result}`, $t: now, $sid: sessionId })
				this.persistResult(del, result)
				this.notifyParent(sessionId)
			}
		} catch {}
	}

	handleError(sessionId: string, error: string): void {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid AND status='running'")
			.get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return
		this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
			.run({ $r: `Session error: ${error}`, $t: new Date().toISOString(), $sid: sessionId })
		this.notifyParent(sessionId)
	}

	async sendMessage(sessionId: string, message: string): Promise<string> {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return `Session "${sessionId}" not found in delegations.`
		if (del.status !== "running") return `Session is ${del.status}, not running.`
		try {
			await this.client.session.prompt({
				path: { id: sessionId },
				body: { noReply: true, parts: [{ type: "text", text: `[Orchestrator]: ${message}` }] },
			})
			return `Message sent to ${sessionId}.`
		} catch (e) { return `Failed: ${e instanceof Error ? e.message : "unknown"}` }
	}

	listDelegations(projectId?: string): Array<DelegationRow & { project_name: string }> {
		let q = "SELECT d.*, p.name as project_name FROM delegations d LEFT JOIN projects p ON d.project_id=p.id WHERE 1=1"
		const params: Record<string, string> = {}
		if (projectId) { q += " AND d.project_id=$pid"; params.$pid = projectId }
		q += " ORDER BY d.created_at DESC LIMIT 30"
		return this.db.prepare(q).all(params) as Array<DelegationRow & { project_name: string }>
	}

	readResult(sessionId: string): string {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return `Session "${sessionId}" not found.`
		if (del.status === "running") return `Session is still running. You'll get a <session-report> when it completes.`
		return del.result || "(no result)"
	}

	// ── Internal ──

	private extractResult(msgs: any[]): string {
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m = msgs[i]; if (m?.info?.role !== "assistant") continue
			let t = ""; for (const p of m.parts ?? []) if (p.type === "text" && !p.synthetic && !p.ignored && typeof p.text === "string") t += p.text + "\n"
			if (t.trim()) return t.trim()
		}
		return "(no output)"
	}

	private persistResult(del: DelegationRow, result: string): void {
		try {
			const proj = this.db.prepare("SELECT path FROM projects WHERE id=$id").get({ $id: del.project_id }) as { path: string } | null
			if (!proj) return
			const dir = path.join(proj.path, ".kortix", "sessions")
			mkdirSync(dir, { recursive: true })
			Bun.write(path.join(dir, `${del.session_id.slice(-12)}.md`),
				`# Session Result\n\n**Session:** ${del.session_id}\n**Agent:** ${del.agent}\n**Status:** ${del.status}\n**Prompt:** ${del.prompt.slice(0, 200)}\n**Created:** ${del.created_at}\n**Completed:** ${del.completed_at || "-"}\n\n---\n\n${result}\n`)
		} catch {}
	}

	notifyParent(sessionId: string): void {
		try {
			const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null
			if (!del) return
			const proj = this.db.prepare("SELECT name FROM projects WHERE id=$id").get({ $id: del.project_id }) as { name: string } | null
			const label = del.status === "complete" ? "COMPLETE" : "FAILED"
			const body = (del.result || "(no output)").slice(0, 3000)

			this.client.session.prompt({
				path: { id: del.parent_session_id },
				body: { noReply: false, agent: del.parent_agent, parts: [{ type: "text", text:
					`<session-report>\n<session-id>${del.session_id}</session-id>\n<status>${label}</status>\n<project>${proj?.name || "?"}</project>\n<prompt>${del.prompt.slice(0, 200)}</prompt>\n<result>\n${body}\n</result>\n</session-report>\n\nSession **${label}** in project **${proj?.name || "?"}**. Use \`session_read("${del.session_id}")\` for full output, or \`session_get\` to inspect.` }] },
			}).catch(() => {})
		} catch {}
	}
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const KortixOrchestratorPlugin: Plugin = async (ctx) => {
	const { client, directory } = ctx
	const db = initDb(path.join(directory, ".kortix", "kortix.db"))
	const mgr = new Manager(client, directory, db)

	return {
		tool: {
			project_create: tool({
				description: "Register a directory as a project (new or existing). Never overwrites existing files.",
				args: {
					name: tool.schema.string().describe("Project name"),
					description: tool.schema.string().describe('Description. "" if none.'),
					path: tool.schema.string().describe('Absolute path. "" for default (projects/{name}).'),
				},
				async execute(args: { name: string; description: string; path: string }): Promise<string> {
					try {
						const p = await mgr.createProject(args.name, args.description, args.path)
						return `Project **${p.name}** at \`${p.path}\` (${p.id})`
					} catch (e) { return `Failed: ${e instanceof Error ? e.message : "unknown"}` }
				},
			}),

			project_list: tool({
				description: "List all projects. Auto-discovers .kortix/project.json markers.",
				args: {},
				async execute(): Promise<string> {
					const ps = mgr.listProjects()
					if (!ps.length) return "No projects. Use project_create."
					const lines = ps.map(p => {
						const cnt = (db.prepare("SELECT COUNT(*) as c FROM delegations WHERE project_id=$pid").get({ $pid: p.id }) as { c: number })?.c || 0
						return `| ${p.name} | \`${p.path}\` | ${cnt} | ${p.description || "-"} |`
					})
					return `| Name | Path | Sessions | Desc |\n|---|---|---|---|\n${lines.join("\n")}`
				},
			}),

			project_get: tool({
				description: "Get project details.",
				args: { name: tool.schema.string().describe("Name or path") },
				async execute(args: { name: string }): Promise<string> {
					const p = mgr.getProject(args.name)
					if (!p) return `Not found: "${args.name}"`
					const stats = db.prepare("SELECT status, COUNT(*) as c FROM delegations WHERE project_id=$pid GROUP BY status").all({ $pid: p.id }) as Array<{ status: string; c: number }>
					return `**${p.name}** (${p.id})\nPath: \`${p.path}\`\nDesc: ${p.description || "-"}\nSessions: ${stats.map(s => `${s.status}:${s.c}`).join(" ") || "none"}`
				},
			}),

			project_update: tool({
				description: "Update project name/description.",
				args: {
					project: tool.schema.string().describe("Name or path"),
					name: tool.schema.string().describe('"" to keep current'),
					description: tool.schema.string().describe('"" to keep current'),
				},
				async execute(args: { project: string; name: string; description: string }): Promise<string> {
					const p = mgr.getProject(args.project)
					if (!p) return "Not found."
					const n = args.name || p.name, d = args.description || p.description
					db.prepare("UPDATE projects SET name=$n,description=$d WHERE id=$id").run({ $n: n, $d: d, $id: p.id })
					try {
						const mp = path.join(p.path, ".kortix", "project.json")
						let marker: ProjectMarker = { name: n, description: d, created: p.created_at }
						if (existsSync(mp)) try { marker = { ...JSON.parse(readFileSync(mp, "utf8")), name: n, description: d } } catch {}
						await fs.writeFile(mp, JSON.stringify(marker, null, 2), "utf8")
					} catch {}
					return `Updated: **${n}**`
				},
			}),

			session_spawn: tool({
				description: `Spawn an async session in a project. Fire & forget — returns the session ID. You'll receive a <session-report> when it completes or fails. Runs autonomously in autowork mode.`,
				args: {
					project: tool.schema.string().describe("Project name or path"),
					prompt: tool.schema.string().describe("Detailed task description. Be thorough — the session starts with zero context beyond this + project's .kortix/context.md."),
					agent: tool.schema.string().describe('"" for default (KortixWorker).'),
				},
				async execute(args: { project: string; prompt: string; agent: string }, toolCtx: ToolContext): Promise<string> {
					if (!toolCtx?.sessionID) return "Error: no session context."
					const p = mgr.getProject(args.project)
					if (!p) return `Project "${args.project}" not found.`
					try {
						const del = await mgr.spawn(p, args.prompt, args.agent || "KortixWorker", toolCtx.sessionID, toolCtx.agent)
						const active = (db.prepare("SELECT COUNT(*) as c FROM delegations WHERE status='running'").get() as { c: number })?.c || 0
						return `Session spawned:\n- **Session:** ${del.session_id}\n- **Project:** ${p.name}\n- **Agent:** ${del.agent}\n- **Active:** ${active}\n\n<session-report> will arrive on completion/failure.`
					} catch (e) { return `Failed: ${e instanceof Error ? e.message : "unknown"}` }
				},
			}),

			session_list_spawned: tool({
				description: "List spawned sessions, optionally filtered by project.",
				args: {
					project: tool.schema.string().describe('"" for all projects.'),
				},
				async execute(args: { project: string }): Promise<string> {
					let pid: string | undefined
					if (args.project) { const p = mgr.getProject(args.project); if (!p) return "Project not found."; pid = p.id }
					const dels = mgr.listDelegations(pid)
					if (!dels.length) return "No worker sessions."
					const lines = dels.map(d => {
						const elapsed = d.status === "running" ? ` ${Math.round((Date.now() - new Date(d.created_at).getTime()) / 1000)}s` : ""
						return `| ${d.session_id.slice(-8)} | ${d.status}${elapsed} | ${d.project_name || "-"} | ${d.prompt.slice(0, 50)} |`
					})
					return `| Session | Status | Project | Prompt |\n|---|---|---|---|\n${lines.join("\n")}`
				},
			}),

			session_read: tool({
				description: "Read the result of a completed spawned session.",
				args: { session_id: tool.schema.string().describe("Session ID") },
				async execute(args: { session_id: string }): Promise<string> { return mgr.readResult(args.session_id) },
			}),

			session_message: tool({
				description: "Send a message into a running session. The agent sees it on its next iteration.",
				args: {
					session_id: tool.schema.string().describe("Session ID"),
					message: tool.schema.string().describe("Message content"),
				},
				async execute(args: { session_id: string; message: string }): Promise<string> { return mgr.sendMessage(args.session_id, args.message) },
			}),
		},

		event: async ({ event }: { event: Event }) => {
			const sid = (event as any).properties?.sessionID
			if (!sid) return
			if (event.type === "session.idle") await mgr.handleIdle(sid)
			if (event.type === "session.error" || (event.type as string) === "session.aborted") {
				const error = (event as any).properties?.error || (event as any).properties?.reason || "Session error"
				mgr.handleError(sid, String(error))
			}
		},

		"experimental.session.compacting": async (_input: any, output: { context: string[] }) => {
			const active = db.prepare("SELECT d.*,p.name as pn FROM delegations d LEFT JOIN projects p ON d.project_id=p.id WHERE d.status='running'").all() as Array<DelegationRow & { pn: string }>
			if (!active.length) return
			const s = ["<orchestrator-state>", "Active workers:"]
			for (const d of active) s.push(`- ${d.session_id.slice(-8)} [${d.agent}] in ${d.pn}: ${d.prompt.slice(0, 100)}`)
			s.push("</orchestrator-state>")
			output.context.push(s.join("\n"))
		},
	}
}

export default KortixOrchestratorPlugin
