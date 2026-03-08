import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..")
export const RUNTIME_ROOT = path.join(PACKAGE_ROOT, "runtime")

export interface MaterializeOptions {
  clean?: boolean
}

export function materializeRuntime(targetDir: string, options: MaterializeOptions = {}): string {
  const absoluteTarget = path.resolve(targetDir)

  if (!existsSync(RUNTIME_ROOT)) {
    throw new Error(`Runtime root does not exist: ${RUNTIME_ROOT}`)
  }

  if (options.clean && existsSync(absoluteTarget)) {
    rmSync(absoluteTarget, { recursive: true, force: true })
  }

  mkdirSync(path.dirname(absoluteTarget), { recursive: true })
  cpSync(RUNTIME_ROOT, absoluteTarget, { recursive: true })
  return absoluteTarget
}

export function linkRuntime(targetPath: string): string {
  const absoluteTarget = path.resolve(targetPath)

  if (!existsSync(RUNTIME_ROOT)) {
    throw new Error(`Runtime root does not exist: ${RUNTIME_ROOT}`)
  }

  if (existsSync(absoluteTarget) || lstatSafe(absoluteTarget)) {
    rmSync(absoluteTarget, { recursive: true, force: true })
  }

  mkdirSync(path.dirname(absoluteTarget), { recursive: true })
  symlinkSync(RUNTIME_ROOT, absoluteTarget, "dir")
  return absoluteTarget
}

function lstatSafe(targetPath: string): boolean {
  try {
    lstatSync(targetPath)
    return true
  } catch {
    return false
  }
}
