/**
 * SQLite-backed CronStore using bun:sqlite.
 * Drop-in replacement for the JSON-file CronStore.
 * Schema auto-migrates on first use.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"
import { Cron } from "croner"

// bun:sqlite is only available at runtime in Bun. Use dynamic typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunDatabase = any
import type { CronExecutionRecord, CronExecutionStatus, CronTriggerRecord } from "./types.js"

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function isValidCronExpression(expr: string): boolean {
  try { new Cron(expr); return true } catch { return false }
}

export function getNextRun(expr: string, timezone = "UTC"): Date | null {
  try { return new Cron(expr, { timezone }).nextRun() ?? null } catch { return null }
}

export function describeCron(expr: string): string {
  try {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 6) return expr
    const [sec, min, hour, day, month, weekday] = parts as [string, string, string, string, string, string]
    if (sec.startsWith("*/") && min === "*" && hour === "*") return `Every ${sec.slice(2)} seconds`
    if (sec === "0" && min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} minutes`
    if (sec === "0" && min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`
    if (sec === "0" && !min.includes("*") && !hour.includes("*") && day === "*" && month === "*" && weekday === "*") {
      return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`
    }
    return expr
  } catch { return expr }
}

export class CronStoreSqlite {
  private db: BunDatabase

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true })
    // Dynamic import: bun:sqlite is only available in Bun runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite")
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        cron_expr TEXT NOT NULL,
        prompt TEXT NOT NULL,
        timezone TEXT DEFAULT 'UTC',
        agent_name TEXT,
        model_id TEXT,
        session_mode TEXT DEFAULT 'new',
        source TEXT,
        is_active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        session_id TEXT,
        last_run_at TEXT,
        next_run_at TEXT
      );

      CREATE TABLE IF NOT EXISTS cron_executions (
        execution_id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        retry_count INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        session_id TEXT,
        error_message TEXT,
        FOREIGN KEY (trigger_id) REFERENCES cron_triggers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_executions_trigger ON cron_executions(trigger_id);
      CREATE INDEX IF NOT EXISTS idx_executions_created ON cron_executions(created_at DESC);
    `)
  }

  private rowToTrigger(row: Record<string, unknown>): CronTriggerRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      cron_expr: String(row.cron_expr),
      prompt: String(row.prompt),
      timezone: row.timezone ? String(row.timezone) : "UTC",
      agent_name: row.agent_name ? String(row.agent_name) : null,
      model_id: row.model_id ? String(row.model_id) : null as unknown as string | undefined,
      session_mode: (row.session_mode as "new" | "reuse") ?? "new",
      source: row.source ? String(row.source) : undefined,
      is_active: row.is_active === 1,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : {},
      session_id: row.session_id ? String(row.session_id) : null,
      last_run_at: row.last_run_at ? String(row.last_run_at) : null,
      next_run_at: row.next_run_at ? String(row.next_run_at) : null,
    }
  }

  private rowToExecution(row: Record<string, unknown>): CronExecutionRecord {
    return {
      execution_id: String(row.execution_id),
      trigger_id: String(row.trigger_id),
      status: String(row.status) as CronExecutionStatus,
      retry_count: Number(row.retry_count ?? 0),
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : {},
      created_at: String(row.created_at),
      started_at: String(row.started_at),
      completed_at: row.completed_at ? String(row.completed_at) : null,
      duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
      session_id: row.session_id ? String(row.session_id) : null,
      error_message: row.error_message ? String(row.error_message) : null,
    }
  }

  listTriggers(active?: boolean): CronTriggerRecord[] {
    const sql = active === undefined
      ? "SELECT * FROM cron_triggers ORDER BY id DESC"
      : "SELECT * FROM cron_triggers WHERE is_active = ? ORDER BY id DESC"
    const rows = active === undefined
      ? this.db.query(sql).all()
      : this.db.query(sql).all(active ? 1 : 0)
    return (rows as Record<string, unknown>[]).map((r) => this.rowToTrigger(r))
  }

  getTrigger(triggerId: string): CronTriggerRecord | null {
    const row = this.db.query("SELECT * FROM cron_triggers WHERE id = ? OR name = ?").get(triggerId, triggerId)
    return row ? this.rowToTrigger(row as Record<string, unknown>) : null
  }

  createTrigger(input: Omit<CronTriggerRecord, "id" | "last_run_at" | "next_run_at" | "session_id">): CronTriggerRecord {
    const id = crypto.randomUUID()
    const nextRun = getNextRun(input.cron_expr, input.timezone ?? "UTC")?.toISOString() ?? null
    this.db.query(`
      INSERT INTO cron_triggers (id, name, cron_expr, prompt, timezone, agent_name, model_id, session_mode, source, is_active, metadata, session_id, last_run_at, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    `).run(
      id, input.name, input.cron_expr, input.prompt,
      input.timezone ?? "UTC", input.agent_name ?? null, input.model_id ?? null,
      input.session_mode ?? "new", input.source ?? null,
      (input.is_active ?? true) ? 1 : 0, JSON.stringify(ensureObject(input.metadata)),
      nextRun,
    )
    return this.getTrigger(id)!
  }

  updateTrigger(triggerId: string, patch: Partial<CronTriggerRecord>): CronTriggerRecord | null {
    const current = this.getTrigger(triggerId)
    if (!current) return null
    const merged = { ...current, ...patch, id: current.id }
    merged.next_run_at = (merged.is_active ?? true)
      ? getNextRun(merged.cron_expr, merged.timezone ?? "UTC")?.toISOString() ?? null
      : null
    this.db.query(`
      UPDATE cron_triggers SET name=?, cron_expr=?, prompt=?, timezone=?, agent_name=?, model_id=?, session_mode=?, source=?, is_active=?, metadata=?, session_id=?, last_run_at=?, next_run_at=?
      WHERE id = ?
    `).run(
      merged.name, merged.cron_expr, merged.prompt, merged.timezone ?? "UTC",
      merged.agent_name ?? null, merged.model_id ?? null, merged.session_mode ?? "new",
      merged.source ?? null, (merged.is_active ?? true) ? 1 : 0,
      JSON.stringify(ensureObject(merged.metadata)),
      merged.session_id ?? null, merged.last_run_at ?? null, merged.next_run_at ?? null,
      current.id,
    )
    return this.getTrigger(current.id!)
  }

  deleteTrigger(triggerId: string): boolean {
    // CASCADE deletes executions
    const result = this.db.query("DELETE FROM cron_triggers WHERE id = ? OR name = ?").run(triggerId, triggerId)
    return (result as { changes: number }).changes > 0
  }

  createExecution(triggerId: string, input?: { status?: CronExecutionStatus; retry_count?: number; metadata?: Record<string, unknown> }): CronExecutionRecord {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    this.db.query(`
      INSERT INTO cron_executions (execution_id, trigger_id, status, retry_count, metadata, created_at, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, triggerId, input?.status ?? "running", input?.retry_count ?? 0, JSON.stringify(ensureObject(input?.metadata)), now, now)
    return this.getExecution(id)!
  }

  updateExecution(executionId: string, patch: Partial<CronExecutionRecord>): CronExecutionRecord | null {
    const current = this.getExecution(executionId)
    if (!current) return null
    const merged = { ...current, ...patch, execution_id: current.execution_id }
    this.db.query(`
      UPDATE cron_executions SET status=?, retry_count=?, metadata=?, completed_at=?, duration_ms=?, session_id=?, error_message=?
      WHERE execution_id = ?
    `).run(
      merged.status, merged.retry_count, JSON.stringify(ensureObject(merged.metadata)),
      merged.completed_at ?? null, merged.duration_ms ?? null, merged.session_id ?? null, merged.error_message ?? null,
      executionId,
    )
    return this.getExecution(executionId)
  }

  getExecution(executionId: string): CronExecutionRecord | null {
    const row = this.db.query("SELECT * FROM cron_executions WHERE execution_id = ?").get(executionId)
    return row ? this.rowToExecution(row as Record<string, unknown>) : null
  }

  listExecutions(filter?: { triggerId?: string; limit?: number; offset?: number }): { data: CronExecutionRecord[]; total: number } {
    const where = filter?.triggerId ? "WHERE trigger_id = ?" : ""
    const params = filter?.triggerId ? [filter.triggerId] : []
    const countRow = this.db.query(`SELECT COUNT(*) as cnt FROM cron_executions ${where}`).get(...params) as { cnt: number }
    const total = countRow.cnt
    const limit = filter?.limit ?? 50
    const offset = filter?.offset ?? 0
    const rows = this.db.query(`SELECT * FROM cron_executions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[]
    return { data: rows.map((r) => this.rowToExecution(r)), total }
  }

  markTriggerRun(triggerId: string, sessionId?: string | null): CronTriggerRecord | null {
    const trigger = this.getTrigger(triggerId)
    if (!trigger) return null
    return this.updateTrigger(triggerId, {
      last_run_at: new Date().toISOString(),
      next_run_at: getNextRun(trigger.cron_expr, trigger.timezone ?? "UTC")?.toISOString() ?? null,
      session_id: sessionId === undefined ? trigger.session_id : sessionId ?? null,
    })
  }
}
