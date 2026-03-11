import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..")
export const RUNTIME_ROOT = path.join(PACKAGE_ROOT, "runtime")
const MATERIALIZED_RUNTIME_FILES = ["ocx.jsonc", "opencode.jsonc", "package.json", "tsconfig.json"] as const

export interface MaterializeOptions {
  clean?: boolean
}

function rewriteOpencodeConfig(targetDir: string): void {
  const opencodeConfigPath = path.join(targetDir, "opencode.jsonc")
  const relativeRuntimeRoot = path.relative(targetDir, RUNTIME_ROOT).split(path.sep).join("/")

  let config = readFileSync(opencodeConfigPath, "utf8")
  config = config.replaceAll("./plugin/kortix-oc.ts", `${relativeRuntimeRoot}/plugin/kortix-oc.ts`)
  config = config.replaceAll("./plugin/agent-triggers.ts", `${relativeRuntimeRoot}/plugin/agent-triggers.ts`)
  writeFileSync(opencodeConfigPath, config)
}

function copyRuntimeFile(relativePath: string, targetDir: string): void {
  const sourcePath = path.join(RUNTIME_ROOT, relativePath)
  const targetPath = path.join(targetDir, relativePath)

  mkdirSync(path.dirname(targetPath), { recursive: true })
  cpSync(sourcePath, targetPath, { recursive: true })
}

export function materializeRuntime(targetDir: string, options: MaterializeOptions = {}): string {
  const absoluteTarget = path.resolve(targetDir)

  if (!existsSync(RUNTIME_ROOT)) {
    throw new Error(`Runtime root does not exist: ${RUNTIME_ROOT}`)
  }

  if (options.clean && existsSync(absoluteTarget)) {
    rmSync(absoluteTarget, { recursive: true, force: true })
  }

  mkdirSync(absoluteTarget, { recursive: true })
  for (const relativePath of MATERIALIZED_RUNTIME_FILES) {
    copyRuntimeFile(relativePath, absoluteTarget)
  }
  rewriteOpencodeConfig(absoluteTarget)
  return absoluteTarget
}
