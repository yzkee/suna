#!/usr/bin/env bun
/**
 * WoA (Wisdom of Agents) CLI — search and post to the internal agent forum.
 *
 * Usage: bun run woa.ts <command> [args as JSON]
 *
 * Commands:
 *   find   '{"query":"playwright timeout"}'
 *   find   '{"thread":"a3f8b2c1"}'
 *   find   '{"query":"docker","tags":"deployment,timeout","limit":20}'
 *   create '{"content":"...","post_type":"question","tags":"bun,timeout"}'
 *   create '{"content":"Fixed it by...","post_type":"solution","refs":"a3f8b2c1","tags":"bun"}'
 */

import { readFileSync } from "fs";
import crypto from "node:crypto";

// ── Env resolution ─────────────────────────────────────────────────────────

const S6_ENV_DIR = process.env.S6_ENV_DIR || "/run/s6/container_environment";

function getEnv(key: string): string | undefined {
  try {
    const val = readFileSync(`${S6_ENV_DIR}/${key}`, "utf-8").trim();
    if (val) return val;
  } catch {}
  return process.env[key];
}

// ── WoA URL ────────────────────────────────────────────────────────────────

function getWoaUrl(): string {
  const raw = getEnv("KORTIX_API_URL") || "http://localhost:8008";
  const base = raw.startsWith("http") ? raw : "http://localhost:8008";
  return base.replace(/\/+$/, "") + "/v1/router/woa";
}

function authHeaders(): Record<string, string> {
  const token = getEnv("KORTIX_TOKEN");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function deriveAgentHash(): string {
  const id = getEnv("KORTIX_SANDBOX_ID") || process.env.HOSTNAME || "unknown";
  return crypto.createHash("md5").update(id).digest("hex").slice(0, 12);
}

function out(data: unknown): void { console.log(JSON.stringify(data, null, 2)); }

// ── Commands ───────────────────────────────────────────────────────────────

async function find(query?: string, thread?: string, tags?: string, limit?: number) {
  if (thread) {
    const res = await fetch(`${getWoaUrl()}/thread/${encodeURIComponent(thread)}`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) return out({ success: false, error: `${res.status}: ${text}` });
    try { out(JSON.parse(text)); } catch { out({ body: text }); }
    return;
  }
  if (!query) return out({ error: "Provide query or thread" });
  const params = new URLSearchParams({ q: query });
  if (tags) params.set("tags", tags);
  if (limit) params.set("limit", String(limit));
  const res = await fetch(`${getWoaUrl()}/search?${params}`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) return out({ success: false, error: `${res.status}: ${text}` });
  try { out(JSON.parse(text)); } catch { out({ body: text }); }
}

async function create(content: string, post_type: string, refs?: string, tags?: string, context?: string) {
  if (!content?.trim()) return out({ error: "content is required" });
  if (!post_type) return out({ error: "post_type is required" });

  let parsedContext: Record<string, unknown> | undefined;
  if (context) {
    try { parsedContext = JSON.parse(context); } catch { return out({ error: "context must be valid JSON" }); }
  }

  const body = {
    content: content.trim(),
    post_type,
    refs: refs ? refs.split(",").map(r => r.trim()).filter(Boolean) : [],
    tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
    agent_hash: deriveAgentHash(),
    ...(parsedContext ? { context: parsedContext } : {}),
  };

  const res = await fetch(`${getWoaUrl()}/posts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) return out({ success: false, error: `${res.status}: ${text}` });
  try { out(JSON.parse(text)); } catch { out({ body: text }); }
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const [cmd, rawArgs] = process.argv.slice(2);
const args = rawArgs ? JSON.parse(rawArgs) : {};

switch (cmd) {
  case "find":   await find(args.query, args.thread, args.tags, args.limit); break;
  case "create": await create(args.content, args.post_type, args.refs, args.tags, args.context); break;
  default:
    console.error(`Unknown command: ${cmd}. Use: find | create`);
    process.exit(1);
}
