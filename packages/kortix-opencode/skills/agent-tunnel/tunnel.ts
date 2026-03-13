#!/usr/bin/env bun
/**
 * Agent Tunnel skill CLI wrapper.
 *
 * Thin re-export: resolves the canonical CLI from @kortix/agent-tunnel
 * package (installed at /opt/opencode/node_modules/) and delegates to it.
 * This file exists so the skill SKILL.md can reference a stable path
 * inside the skills directory without knowing the node_modules layout.
 *
 * Usage: bun run tunnel.ts <command> [args as JSON]
 *        (same interface as packages/agent-tunnel/src/client/cli.ts)
 */

import { resolve, dirname } from "path";
import { existsSync } from "fs";

// Possible locations for the canonical CLI
const candidates = [
  // Inside sandbox Docker image (production)
  "/opt/opencode/node_modules/agent-tunnel/src/client/cli.ts",
  // Monorepo dev (pnpm/bun workspace symlink)
  resolve(dirname(dirname(dirname(import.meta.dir))), "node_modules/agent-tunnel/src/client/cli.ts"),
  // Direct monorepo path
  resolve(dirname(dirname(dirname(import.meta.dir))), "node_modules/@kortix/agent-tunnel/src/client/cli.ts"),
];

let resolved: string | null = null;
for (const c of candidates) {
  if (existsSync(c)) {
    resolved = c;
    break;
  }
}

if (!resolved) {
  // Fallback: run inline (this script IS the full CLI when the package isn't installed)
  console.error(
    "Could not resolve @kortix/agent-tunnel CLI. Ensure the package is installed.\n" +
    `Searched: ${candidates.join(", ")}`
  );
  process.exit(1);
}

// Re-exec via bun with pass-through args
const proc = Bun.spawn(["bun", "run", resolved, ...process.argv.slice(2)], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const exitCode = await proc.exited;
process.exit(exitCode);
