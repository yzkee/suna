import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureGlobalMemoryFiles, ensureKortixDir, ensureProjectMemoryFiles, renderMergedMemoryContext, resolveKortixDir, resolveKortixWorkspaceRoot } from "./kortix-paths"

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

	test("auto-creates global memory files", () => {
		const workspace = makeTempDir("kortix-paths-memory-global-")
		process.env.KORTIX_WORKSPACE = workspace

		const files = ensureGlobalMemoryFiles(path.join(workspace, "nested"))

		expect(existsSync(files.userPath)).toBe(true)
		expect(existsSync(files.memoryPath)).toBe(true)
		expect(readFileSync(files.userPath, "utf8")).toContain("# Global User Profile")
		expect(readFileSync(files.memoryPath, "utf8")).toContain("# Global Memory")
	})

	test("auto-creates project memory files", () => {
		const projectRoot = makeTempDir("kortix-paths-memory-project-")

		const files = ensureProjectMemoryFiles(projectRoot)

		expect(existsSync(files.userPath)).toBe(true)
		expect(existsSync(files.memoryPath)).toBe(true)
		expect(readFileSync(files.userPath, "utf8")).toContain("# Project User Profile")
		expect(readFileSync(files.memoryPath, "utf8")).toContain("# Project Memory")
	})

	test("merged memory context prefers project entries and deduplicates globals", () => {
		const workspace = makeTempDir("kortix-paths-memory-merge-")
		const projectRoot = path.join(workspace, "repo")
		mkdirSync(projectRoot, { recursive: true })
		process.env.KORTIX_WORKSPACE = workspace

		const globalFiles = ensureGlobalMemoryFiles(projectRoot)
		const projectFiles = ensureProjectMemoryFiles(projectRoot)
		writeFileSync(globalFiles.userPath, "# Global User Profile\n\n## Preferences\n\n- concise responses\n- no builds unless asked\n")
		writeFileSync(globalFiles.memoryPath, "# Global Memory\n\n## Cross-Project Rules\n\n- use session tools first\n")
		writeFileSync(projectFiles.userPath, "# Project User Profile\n\n## Preferences\n\n- no builds unless asked\n- lint frontend only\n")
		writeFileSync(projectFiles.memoryPath, "# Project Memory\n\n## Commands\n\n- repo uses Bun\n")

		const merged = renderMergedMemoryContext(projectRoot, projectRoot)
		expect(merged).toContain("## Project User")
		expect(merged).toContain("lint frontend only")
		expect(merged).toContain("use session tools first")
		expect(merged.match(/no builds unless asked/g)?.length).toBe(1)
	})
})
