import type { Plugin } from "@opencode-ai/plugin"
import type { Config } from "@opencode-ai/sdk"
import { PTYPlugin as PtyPlugin } from "opencode-pty/plugin"
import EnvsitterGuardPlugin from "envsitter-guard"
import WorktreePlugin from "./worktree"
import TunnelPlugin from "./agent-tunnel/index"
import MorphPlugin from "./morph"
import OrphanToolFixerPlugin from "./orphan-tool-fixer"
import KortixMemoryPlugin from "./kortix-sys/src/index"

// ── Plugin helpers ──────────────────────────────────────────────────────────

type PluginOutput = Record<string, any>
type PluginValue = any

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function chainHandlers(first: PluginValue, second: PluginValue): PluginValue {
  if (typeof first === "function" && typeof second === "function") {
    return async (...args: unknown[]) => {
      await first(...(args as any[]))
      await second(...(args as any[]))
    }
  }
  if (isObject(first) && isObject(second)) return mergeOutputs(first, second)
  return second
}

function mergeOutputs(...outputs: Array<PluginOutput | undefined>): PluginOutput {
  const merged: PluginOutput = {}
  for (const output of outputs) {
    if (!output) continue
    for (const [key, value] of Object.entries(output)) {
      const existing = merged[key]
      merged[key] = existing === undefined ? value : chainHandlers(existing, value)
    }
  }
  return merged
}

// ── Config ──────────────────────────────────────────────────────────────────
// Agents (agents/*.md), commands (commands/*.md), skills (skills/), and
// tools (tools/*.ts) are all discovered natively by OpenCode from the
// config directory. This hook only configures things that can't be
// expressed in opencode.jsonc: provider baseURLs, MCP, extra skill paths.

function applyKortixConfig(config: Config): void {
  const cfg = config as Config & {
    default_agent?: string
    skills?: { paths?: string[] }
    mcp?: Record<string, Record<string, unknown>>
    provider?: Record<string, Record<string, unknown>>
  }

  cfg.default_agent ??= "kortix"

  // Extra skill paths: memory plugin skills + user-installed (marketplace)
  const skillPaths = new Set(cfg.skills?.paths ?? [])
  skillPaths.add("plugin/kortix-sys/skills")
  skillPaths.add(".opencode/skills")
  cfg.skills = { ...(cfg.skills ?? {}), paths: [...skillPaths] }

  // Context7 MCP server
  const existingContext7 = isObject(cfg.mcp?.context7) ? cfg.mcp?.context7 : {}
  cfg.mcp = {
    ...(cfg.mcp ?? {}),
    context7: {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      headers: { CONTEXT7_API_KEY: "{env:CONTEXT7_API_KEY}" },
      enabled: true,
      ...existingContext7,
    },
  }

  // Provider baseURLs — OpenCode doesn't resolve {env:...} in baseURL
  const providerDefaults: Record<string, string> = {
    anthropic: "https://api.anthropic.com/v1",
    openai: "https://api.openai.com/v1",
    xai: "https://api.x.ai/v1",
    google: "https://generativelanguage.googleapis.com/v1beta",
    groq: "https://api.groq.com/openai/v1",
  }
  cfg.provider ??= {}
  for (const [providerId, defaultUrl] of Object.entries(providerDefaults)) {
    const existing = isObject(cfg.provider[providerId]) ? cfg.provider[providerId] as Record<string, unknown> : {}
    const existingOptions = isObject(existing.options) ? existing.options : {}
    const existingHeaders = isObject(existingOptions.headers) ? existingOptions.headers : {}
    cfg.provider[providerId] = {
      ...existing,
      options: {
        ...existingOptions,
        baseURL: defaultUrl,
        headers: { "X-Kortix-Token": "{env:KORTIX_TOKEN}", ...existingHeaders },
      },
    }
  }
}

// ── Main plugin ─────────────────────────────────────────────────────────────

const KortixOcPlugin: Plugin = async (ctx) => {
  const outputs = await Promise.all([
    PtyPlugin(ctx),
    EnvsitterGuardPlugin(ctx),
    WorktreePlugin(ctx),
    KortixMemoryPlugin(ctx),
    TunnelPlugin(ctx),
    MorphPlugin(ctx),
    OrphanToolFixerPlugin(ctx),
  ])

  const merged = mergeOutputs(...outputs)
  const upstreamConfig = merged.config

  merged.config = async (input: Config) => {
    if (typeof upstreamConfig === "function") await upstreamConfig(input)
    applyKortixConfig(input)
  }

  return merged
}

export default KortixOcPlugin
