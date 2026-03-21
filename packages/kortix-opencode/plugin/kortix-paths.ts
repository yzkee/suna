import { existsSync, mkdirSync } from "node:fs"
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
