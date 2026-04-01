import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureGlobalMemoryFiles, ensureKortixDir, renderMergedMemoryContext, renderProjectContext, resolveKortixDir, resolveKortixWorkspaceRoot } from "./kortix-paths"

const envKeys = ["KORTIX_DIR", "KORTIX_WORKSPACE", "OPENCODE_STORAGE_BASE", "OPENCODE_CONFIG_DIR", "HOME"] as const
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>
const tempRoots: string[] = []

afterEach(() => {
	for (const key of envKeys) {
		const value = originalEnv[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
	for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix))
	tempRoots.push(dir)
	return dir
}

describe("kortix path resolution", () => {
	test("resolves to repo root .kortix from nested directories", () => {
		const repoRoot = makeTempDir("kortix-paths-repo-")
		mkdirSync(path.join(repoRoot, ".git"))
		const nested = path.join(repoRoot, "packages", "feature", "src")
		mkdirSync(nested, { recursive: true })

		delete process.env.KORTIX_DIR
		delete process.env.KORTIX_WORKSPACE
		delete process.env.OPENCODE_STORAGE_BASE

		expect(resolveKortixWorkspaceRoot(nested)).toBe(repoRoot)
		expect(resolveKortixDir(nested)).toBe(path.join(repoRoot, ".kortix"))
	})

	test("explicit KORTIX_DIR wins", () => {
		const explicit = makeTempDir("kortix-paths-explicit-")
		process.env.KORTIX_DIR = path.join(explicit, "runtime-kortix")

		expect(resolveKortixDir(path.join(explicit, "anywhere"))).toBe(path.join(explicit, "runtime-kortix"))
		expect(ensureKortixDir(path.join(explicit, "anywhere"))).toBe(path.join(explicit, "runtime-kortix"))
	})

	test("OPENCODE_STORAGE_BASE maps back to workspace root", () => {
		const workspace = makeTempDir("kortix-paths-storage-")
		const storageBase = path.join(workspace, ".local", "share", "opencode")
		mkdirSync(storageBase, { recursive: true })
		writeFileSync(path.join(storageBase, "placeholder.txt"), "ok")

		delete process.env.KORTIX_DIR
		delete process.env.KORTIX_WORKSPACE
		process.env.OPENCODE_STORAGE_BASE = storageBase

		expect(resolveKortixWorkspaceRoot(path.join(workspace, "nested"))).toBe(workspace)
		expect(resolveKortixDir(path.join(workspace, "nested"))).toBe(path.join(workspace, ".kortix"))
	})

	test("OPENCODE_CONFIG_DIR maps back to the core root", () => {
		const workspace = makeTempDir("kortix-paths-config-")
		const configDir = path.join(workspace, ".opencode")
		mkdirSync(configDir, { recursive: true })

		delete process.env.KORTIX_DIR
		delete process.env.KORTIX_WORKSPACE
		delete process.env.OPENCODE_STORAGE_BASE
		process.env.OPENCODE_CONFIG_DIR = configDir

		expect(resolveKortixWorkspaceRoot(path.join(workspace, "some", "other", "project"))).toBe(workspace)
		expect(resolveKortixDir(path.join(workspace, "some", "other", "project"))).toBe(path.join(workspace, ".kortix"))
	})

	test("auto-creates global USER.md and MEMORY.md", () => {
		const workspace = makeTempDir("kortix-paths-memory-global-")
		process.env.KORTIX_WORKSPACE = workspace

		const files = ensureGlobalMemoryFiles(path.join(workspace, "nested"))

		expect(existsSync(files.userPath)).toBe(true)
		expect(existsSync(files.memoryPath)).toBe(true)
		expect(existsSync(files.memoryDir)).toBe(true)
		expect(readFileSync(files.userPath, "utf8")).toContain("# User Profile")
		expect(readFileSync(files.memoryPath, "utf8")).toContain("# Global Memory")
	})

	test("renderMergedMemoryContext returns USER.md and MEMORY.md content", () => {
		const workspace = makeTempDir("kortix-paths-memory-render-")
		process.env.KORTIX_WORKSPACE = workspace

		const globalFiles = ensureGlobalMemoryFiles(workspace)
		writeFileSync(globalFiles.userPath, "# User Profile\n\n## Preferences\n\n- concise responses\n- no builds unless asked\n")
		writeFileSync(globalFiles.memoryPath, "# Global Memory\n\n## Stack\n\n- uses Supabase\n- prefers bun\n\n## References\n\n- [billing notes](memory/billing.md)\n")

		const merged = renderMergedMemoryContext(workspace)
		expect(merged).toContain("## User")
		expect(merged).toContain("## Memory")
		expect(merged).toContain("concise responses")
		expect(merged).toContain("no builds unless asked")
		expect(merged).toContain("uses Supabase")
		expect(merged).toContain("[billing notes](memory/billing.md)")
	})

	test("renderProjectContext returns project CONTEXT.md content", () => {
		const workspace = makeTempDir("kortix-paths-project-render-")
		const project = path.join(workspace, "project-a")
		mkdirSync(path.join(project, ".kortix"), { recursive: true })
		writeFileSync(
			path.join(project, ".kortix", "CONTEXT.md"),
			"# Project A\n\n## Architecture\n\n- Next.js frontend\n- FastAPI backend\n\n## References\n\n- [deploy notes](docs/deploy.md)\n",
		)

		const ctx = renderProjectContext(project)
		expect(ctx).toContain("## Project")
		expect(ctx).toContain("Next.js frontend")
		expect(ctx).toContain("[deploy notes](docs/deploy.md)")
	})

	test("renderMergedMemoryContext returns empty for skeleton files", () => {
		const workspace = makeTempDir("kortix-paths-memory-empty-")
		process.env.KORTIX_WORKSPACE = workspace

		ensureGlobalMemoryFiles(workspace)
		const merged = renderMergedMemoryContext(workspace)
		expect(merged).toBe("")
	})
})
