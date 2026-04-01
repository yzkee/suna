/**
 * Kortix Connectors Plugin
 *
 * Internal registry of what's connected where. A connector is just YAML
 * frontmatter in a CONNECTOR.md — name, description, source, and whatever
 * else is relevant. No enforced schema beyond a name.
 *
 * Connection status is NOT stored in the file — it's checked live via
 * the Pipedream integration script or CLI auth commands.
 *
 * Nothing ships by default. Scaffolded on demand via connector_setup.
 *
 * Tools: connector_list, connector_get, connector_setup
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"

// ── Workspace root ───────────────────────────────────────────────────────────

function resolveWorkspaceRoot(): string {
	const explicit = process.env.KORTIX_WORKSPACE?.trim()
	if (explicit) return explicit
	const configDir = process.env.OPENCODE_CONFIG_DIR?.trim()
	if (configDir) {
		const normalized = path.resolve(configDir)
		if (normalized.endsWith(".opencode") || normalized.endsWith("opencode")) return path.dirname(normalized)
	}
	return process.cwd()
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Connector {
	name: string
	fields: Record<string, string>
	location: string
	content: string
}

// ── Frontmatter parse ────────────────────────────────────────────────────────

function parse(raw: string): { fields: Record<string, string>; content: string } {
	const t = raw.trimStart()
	if (!t.startsWith("---")) return { fields: {}, content: raw }
	const end = t.indexOf("---", 3)
	if (end === -1) return { fields: {}, content: raw }
	const yaml = t.slice(3, end).trim()
	const content = t.slice(end + 3).trim()
	const fields: Record<string, string> = {}
	for (const line of yaml.split("\n")) {
		const match = line.match(/^(\w[\w_-]*)\s*:\s*(.*)$/)
		if (match) fields[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, "")
	}
	return { fields, content }
}

// ── Discovery ────────────────────────────────────────────────────────────────

let _logged = false

function discover(root: string): Connector[] {
	const dirs = [
		path.join(root, ".opencode", "connectors"),
		path.join(homedir(), ".config", "opencode", "connectors"),
	]
	if (!_logged) {
		_logged = true
		console.log(`[connectors] root=${root}, scanning: ${dirs.join(", ")}`)
	}
	const out: Connector[] = []
	const seen = new Set<string>()
	for (const base of dirs) {
		if (!existsSync(base) || !statSync(base).isDirectory()) continue
		for (const entry of readdirSync(base)) {
			const dir = path.join(base, entry)
			const file = path.join(dir, "CONNECTOR.md")
			if (!existsSync(file)) continue
			const { fields, content } = parse(readFileSync(file, "utf8"))
			const name = fields.name || entry
			if (seen.has(name)) continue
			seen.add(name)
			out.push({ name, fields, location: file, content })
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const ConnectorsPlugin: Plugin = async () => {
	const root = resolveWorkspaceRoot()
	const baseDir = path.join(root, ".opencode", "connectors")
	const list = () => discover(root)

	return {
		tool: {
			connector_list: tool({
				description: "List all connectors — shows what's connected, how, and where.",
				args: {
					filter: tool.schema.string().describe('"" for all. Or filter by type/status/name.'),
				},
				async execute(args: { filter: string }): Promise<string> {
					let connectors = list()
					const f = args.filter?.toLowerCase().trim()
					if (f) connectors = connectors.filter(c =>
						c.name.includes(f) || Object.values(c.fields).some(v => v.toLowerCase().includes(f))
					)
					if (!connectors.length) return "No connectors found."
					const rows = connectors.map(c => {
						const desc = c.fields.description || ""
						const source = c.fields.source || "—"
						return `| ${c.name} | ${desc} | ${source} |`
					})
					return `| Name | Description | Source |\n|---|---|---|\n${rows.join("\n")}`
				},
			}),

			connector_get: tool({
				description: "Get a connector's full metadata.",
				args: { name: tool.schema.string().describe("Connector name.") },
				async execute(args: { name: string }): Promise<string> {
					const connectors = list()
					const c = connectors.find(x => x.name === args.name) || connectors.find(x => x.name.includes(args.name))
					if (!c) return `Not found: "${args.name}". Available: ${connectors.map(x => x.name).join(", ") || "none"}`
					const lines = Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`)
					if (c.content.trim()) lines.push("", c.content.trim())
					return lines.join("\n")
				},
			}),

			connector_setup: tool({
				description: `Batch-scaffold connectors. Pass a JSON array of objects. Only "name" is required — everything else is optional freeform fields (description, source, env, account, url, whatever is relevant). Overwrites existing.`,
				args: {
					connectors: tool.schema.string().describe('JSON array. E.g. [{"name":"google-drive","description":"company shared drive","source":"pipedream"},{"name":"github","description":"kortix-ai org","source":"cli"}]'),
				},
				async execute(args: { connectors: string }): Promise<string> {
					let items: Array<Record<string, string>>
					try { items = JSON.parse(args.connectors) } catch { return "Invalid JSON." }
					if (!Array.isArray(items) || items.length === 0) return "Pass a non-empty array."

					const results: string[] = []

					for (const item of items) {
						const name = item.name?.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "")
						if (!name) continue

						let fm = "---\n"
						for (const [k, v] of Object.entries(item)) {
							if (v !== undefined && v !== null && v !== "") {
								fm += `${k}: ${typeof v === "string" && v.includes(" ") ? `"${v}"` : v}\n`
							}
						}
						fm += "---\n"

						const dir = path.join(baseDir, name)
						mkdirSync(dir, { recursive: true })
						writeFileSync(path.join(dir, "CONNECTOR.md"), fm, "utf8")
						results.push(`${name} (${item.source || "custom"})`)
					}

					return `Scaffolded ${results.length} connectors:\n${results.join("\n")}`
				},
			}),
		},
	}
}

export default ConnectorsPlugin
