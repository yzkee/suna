import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"

function normalizeAbsolutePath(input: string): string {
	return isAbsolute(input) ? input : resolve(input)
}

function findWorkspaceRoot(startDir: string): string | null {
	let current = normalizeAbsolutePath(startDir)
	while (true) {
		if (existsSync(join(current, ".git"))) return current
		const parent = dirname(current)
		if (parent === current) return null
		current = parent
	}
}

export function resolveKortixWorkspaceRoot(anchorDir?: string): string {
	const explicitWorkspace = process.env.KORTIX_WORKSPACE?.trim()
	if (explicitWorkspace) return normalizeAbsolutePath(explicitWorkspace)

	const storageBase = process.env.OPENCODE_STORAGE_BASE?.trim()
	if (storageBase) return resolve(normalizeAbsolutePath(storageBase), "..", "..", "..")

	const configDir = process.env.OPENCODE_CONFIG_DIR?.trim()
	if (configDir) {
		const normalizedConfigDir = normalizeAbsolutePath(configDir)
		if (normalizedConfigDir.endsWith(`${sep}.opencode`) || normalizedConfigDir.endsWith(`${sep}opencode`)) {
			return dirname(normalizedConfigDir)
		}
	}

	const anchor = anchorDir?.trim() || process.cwd()
	const repoRoot = findWorkspaceRoot(anchor)
	if (repoRoot) return repoRoot

	const home = process.env.HOME?.trim() || homedir()
	return normalizeAbsolutePath(home)
}

export function resolveKortixDir(anchorDir?: string): string {
	const explicitDir = process.env.KORTIX_DIR?.trim()
	if (explicitDir) return normalizeAbsolutePath(explicitDir)
	return join(resolveKortixWorkspaceRoot(anchorDir), ".kortix")
}

export function ensureKortixDir(anchorDir?: string): string {
	const kortixDir = resolveKortixDir(anchorDir)
	mkdirSync(kortixDir, { recursive: true })
	return kortixDir
}

function ensureFile(filePath: string, content: string): string {
	if (!existsSync(filePath)) writeFileSync(filePath, content, "utf8")
	return filePath
}

export function ensureGlobalMemoryFiles(anchorDir?: string): { userPath: string; memoryPath: string } {
	const kortixDir = ensureKortixDir(anchorDir)
	return {
		userPath: ensureFile(join(kortixDir, "USER.md"), [
			"# Global User Profile",
			"",
			"## Preferences",
			"",
			"## Communication Style",
			"",
			"## Workflow Habits",
			"",
		].join("\n")),
		memoryPath: ensureFile(join(kortixDir, "MEMORY.md"), [
			"# Global Memory",
			"",
			"## Environment",
			"",
			"## Cross-Project Rules",
			"",
			"## Recurring Notes",
			"",
		].join("\n")),
	}
}

export function ensureProjectMemoryFiles(projectDir: string): { userPath: string; memoryPath: string } {
	const kortixDir = join(normalizeAbsolutePath(projectDir), ".kortix")
	mkdirSync(kortixDir, { recursive: true })
	return {
		userPath: ensureFile(join(kortixDir, "USER.md"), [
			"# Project User Profile",
			"",
			"## Preferences",
			"",
			"## Workflow Notes",
			"",
		].join("\n")),
		memoryPath: ensureFile(join(kortixDir, "MEMORY.md"), [
			"# Project Memory",
			"",
			"## Architecture",
			"",
			"## Commands",
			"",
			"## Conventions",
			"",
		].join("\n")),
	}
}

function readIfExists(filePath: string): string {
	if (!existsSync(filePath)) return ""
	try {
		return readFileSync(filePath, "utf8").trim()
	} catch {
		return ""
	}
}

function normalizeMemoryBody(text: string): string[] {
	const lines = text.split(/\r?\n/).map(line => line.trimEnd())
	const out: string[] = []
	let sectionHeading: string | null = null
	let sectionContent: string[] = []

	const flush = () => {
		if (sectionHeading && sectionContent.length > 0) {
			out.push(sectionHeading)
			out.push(...sectionContent)
		}
		sectionHeading = null
		sectionContent = []
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		if (i === 0 && line.startsWith("# ")) continue
		if (line.startsWith("## ")) {
			flush()
			sectionHeading = line
			continue
		}
		if (!line.trim()) continue
		sectionContent.push(line)
	}
	flush()
	return out
}

export function renderMergedMemoryContext(projectDir?: string, anchorDir?: string): string {
	const globalFiles = ensureGlobalMemoryFiles(anchorDir)
	const projectFiles = projectDir ? ensureProjectMemoryFiles(projectDir) : null

	const blocks = [
		projectFiles ? { label: "Project User", lines: normalizeMemoryBody(readIfExists(projectFiles.userPath)) } : null,
		projectFiles ? { label: "Project Memory", lines: normalizeMemoryBody(readIfExists(projectFiles.memoryPath)) } : null,
		{ label: "Global User", lines: normalizeMemoryBody(readIfExists(globalFiles.userPath)) },
		{ label: "Global Memory", lines: normalizeMemoryBody(readIfExists(globalFiles.memoryPath)) },
	].filter(Boolean) as Array<{ label: string; lines: string[] }>

	const seen = new Set<string>()
	const rendered: string[] = []
	for (const block of blocks) {
		const uniqueLines = block.lines.filter((line) => {
			const key = line.trim().toLowerCase()
			if (!key) return false
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
		if (uniqueLines.length === 0) continue
		rendered.push(`## ${block.label}`)
		rendered.push(...uniqueLines)
		rendered.push("")
	}

	return rendered.join("\n").trim()
}
