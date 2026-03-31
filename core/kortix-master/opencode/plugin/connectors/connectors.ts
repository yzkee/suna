/**
 * Kortix Connectors Plugin
 *
 * File-based connector discovery. Each connector is a CONNECTOR.md with
 * YAML frontmatter describing what a service is, where its secrets live,
 * and how to use it.
 *
 * Discovery:
 *   .opencode/connectors/<name>/CONNECTOR.md
 *   ~/.config/opencode/connectors/<name>/CONNECTOR.md
 *
 * Tools: connector_list, connector_get, connector_create
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import { resolveKortixWorkspaceRoot } from "../kortix-paths"

// ── Types ────────────────────────────────────────────────────────────────────

interface Connector {
	name: string
	description: string
	type: string
	status: string
	credentials: Array<{ env: string; source?: string }>
	location: string
	content: string
	dir: string
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

function parse(raw: string): { data: Record<string, any>; content: string } {
	const t = raw.trimStart()
	if (!t.startsWith("---")) return { data: {}, content: raw }
	const end = t.indexOf("---", 3)
	if (end === -1) return { data: {}, content: raw }

	const yaml = t.slice(3, end).trim()
	const content = t.slice(end + 3).trim()
	const data: Record<string, any> = {}
	const lines = yaml.split("\n")
	let key = ""
	let arr: any[] | null = null

	for (const line of lines) {
		const s = line.trimEnd()

		if (arr !== null && /^\s+-\s/.test(s)) {
			const item = s.replace(/^\s+-\s*/, "")
			if (item.includes(":")) {
				const obj: Record<string, any> = {}
				const [k, ...rest] = item.split(":")
				obj[k!.trim()] = rest.join(":").trim().replace(/^["']|["']$/g, "")
				arr.push(obj)
			} else {
				arr.push(item.replace(/^["']|["']$/g, ""))
			}
			continue
		}

		if (arr !== null && arr.length > 0 && /^\s{4,}\w/.test(s)) {
			const last = arr[arr.length - 1]
			if (typeof last === "object" && last !== null) {
				const [k, ...rest] = s.trim().split(":")
				if (k && rest.length > 0) last[k.trim()] = rest.join(":").trim().replace(/^["']|["']$/g, "")
			}
			continue
		}

		if (arr !== null && !/^\s/.test(s)) { data[key] = arr; arr = null }

		const match = s.match(/^(\w[\w-]*)\s*:\s*(.*)$/)
		if (match) {
			key = match[1]!
			const val = match[2]!.trim().replace(/^["']|["']$/g, "")
			if (!val) { arr = [] } else { data[key] = val }
		}
	}
	if (arr !== null && key) data[key] = arr
	return { data, content }
}

// ── Discovery ────────────────────────────────────────────────────────────────

function discover(root: string): Connector[] {
	const dirs = [
		path.join(root, ".opencode", "connectors"),
		path.join(homedir(), ".config", "opencode", "connectors"),
	]
	const out: Connector[] = []
	const seen = new Set<string>()

	for (const base of dirs) {
		if (!existsSync(base) || !statSync(base).isDirectory()) continue
		for (const entry of readdirSync(base)) {
			const dir = path.join(base, entry)
			const file = path.join(dir, "CONNECTOR.md")
			if (!existsSync(file)) continue
			const { data, content } = parse(readFileSync(file, "utf8"))
			const name = (data.name as string) || entry
			if (seen.has(name)) continue
			seen.add(name)
			out.push({
				name,
				description: (data.description as string) || "",
				type: (data.type as string) || "custom",
				status: (data.status as string) || "unknown",
				credentials: Array.isArray(data.credentials)
					? data.credentials.map((c: any) => ({ env: c?.env || "", source: c?.source || "" }))
					: [],
				location: file, content, dir,
			})
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ── Templates ────────────────────────────────────────────────────────────────

function template(type: string, name: string): string {
	const upper = name.toUpperCase().replace(/-/g, "_")
	const base = `---
name: ${name}
description: "${name} connector"
type: ${type}
status: disconnected
credentials:
  - env: ${upper}_${type === "api-key" ? "API_KEY" : "TOKEN"}
    source: "TBD"
---

# ${name}

## Authentication

TODO: Document how to authenticate.

## Secrets

| Env var | Source | Required |
|---|---|---|
| \`${upper}_${type === "api-key" ? "API_KEY" : "TOKEN"}\` | TBD | yes |

Save via secrets manager:
\`\`\`bash
curl -s -X POST "http://localhost:8000/env/${upper}_${type === "api-key" ? "API_KEY" : "TOKEN"}" \\
  -H "Content-Type: application/json" -d '{"value":"...","restart":true}'
\`\`\`

## Usage

TODO: Document key commands or API patterns.

## Verification

TODO: Document how to verify the connection works.
`
	return base
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const ConnectorsPlugin: Plugin = async (ctx) => {
	const root = resolveKortixWorkspaceRoot(import.meta.dir)
	const list = () => discover(root)

	return {
		tool: {
			connector_list: tool({
				description: "List all discovered connectors — shows what services are configured, their type, status, and where secrets live.",
				args: {
					filter: tool.schema.string().describe('"" for all. Or filter by type/status/name.'),
				},
				async execute(args: { filter: string }): Promise<string> {
					let connectors = list()
					const f = args.filter?.toLowerCase().trim()
					if (f) connectors = connectors.filter(c => c.type === f || c.status === f || c.name.includes(f))
					if (!connectors.length) return "No connectors found."
					const rows = connectors.map(c => {
						const creds = c.credentials.map(cr => cr.env).join(", ") || "none"
						return `| ${c.name} | ${c.type} | ${c.status} | ${creds} | ${c.description.slice(0, 60)} |`
					})
					return `| Name | Type | Status | Secrets | Description |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n${connectors.length} connector(s).`
				},
			}),

			connector_get: tool({
				description: "Load a connector's full documentation — auth instructions, secrets, usage patterns, verification.",
				args: {
					name: tool.schema.string().describe("Connector name."),
				},
				async execute(args: { name: string }): Promise<string> {
					const connectors = list()
					const c = connectors.find(x => x.name === args.name) || connectors.find(x => x.name.includes(args.name))
					if (!c) return `Not found: "${args.name}". Available: ${connectors.map(x => x.name).join(", ") || "none"}`
					const creds = c.credentials.map(cr => `\`${cr.env}\` (${cr.source || "?"})`).join(", ") || "none"
					return `<connector name="${c.name}">\n**Type:** ${c.type} | **Status:** ${c.status} | **Secrets:** ${creds}\n\n${c.content.trim()}\n</connector>`
				},
			}),

			connector_create: tool({
				description: "Scaffold a new connector. Creates .opencode/connectors/<name>/CONNECTOR.md with a template.",
				args: {
					name: tool.schema.string().describe('Lowercase, hyphens. E.g. "stripe", "vercel".'),
					type: tool.schema.string().describe('"cli", "pipedream", "api-key", "browser", or "custom".'),
				},
				async execute(args: { name: string; type: string }): Promise<string> {
					const name = args.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "")
					if (!name) return "Invalid name."
					const file = path.join(root, ".opencode", "connectors", name, "CONNECTOR.md")
					if (existsSync(file)) return `Already exists: ${file}`
					mkdirSync(path.dirname(file), { recursive: true })
					writeFileSync(file, template(args.type || "custom", name), "utf8")
					return `Created: ${file}\nEdit it with real auth/secrets/usage docs.`
				},
			}),
		},


	}
}

export default ConnectorsPlugin
