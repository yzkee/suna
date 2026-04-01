/**
 * Connectors REST API — SQLite-backed CRUD.
 * Single source of truth for what's connected where.
 */
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

let _db: Database | null = null

function getDb(): Database {
  if (_db) return _db
  const root = process.env.KORTIX_WORKSPACE || '/workspace'
  const dbPath = `${root}/.kortix/kortix.db`
  _db = new Database(dbPath)
  _db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000")
  // Ensure table exists (idempotent)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      source TEXT,
      pipedream_slug TEXT,
      env_keys TEXT,
      notes TEXT,
      auto_generated INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return _db
}

interface ConnectorRow {
  id: string
  name: string
  description: string | null
  source: string | null
  pipedream_slug: string | null
  env_keys: string | null
  notes: string | null
  auto_generated: number
  created_at: string
  updated_at: string
}

const connectorsRouter = new Hono()

// List all
connectorsRouter.get('/', (c) => {
  const db = getDb()
  const rows = db.query('SELECT * FROM connectors ORDER BY name').all() as ConnectorRow[]
  return c.json({
    connectors: rows.map(r => ({
      ...r,
      env_keys: r.env_keys ? JSON.parse(r.env_keys) : null,
      auto_generated: !!r.auto_generated,
    })),
  })
})

// Get one
connectorsRouter.get('/:name', (c) => {
  const db = getDb()
  const row = db.query('SELECT * FROM connectors WHERE name = ?').get(c.req.param('name')) as ConnectorRow | null
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({
    ...row,
    env_keys: row.env_keys ? JSON.parse(row.env_keys) : null,
    auto_generated: !!row.auto_generated,
  })
})

// Create or upsert (single or batch)
connectorsRouter.post('/', async (c) => {
  const db = getDb()
  const body = await c.req.json()
  const items: Array<Record<string, any>> = Array.isArray(body) ? body : [body]
  const results: string[] = []

  const stmt = db.prepare(`
    INSERT INTO connectors (id, name, description, source, pipedream_slug, env_keys, notes, auto_generated, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = COALESCE(excluded.description, connectors.description),
      source = COALESCE(excluded.source, connectors.source),
      pipedream_slug = COALESCE(excluded.pipedream_slug, connectors.pipedream_slug),
      env_keys = COALESCE(excluded.env_keys, connectors.env_keys),
      notes = COALESCE(excluded.notes, connectors.notes),
      auto_generated = excluded.auto_generated,
      updated_at = excluded.updated_at
  `)

  const now = new Date().toISOString()
  for (const item of items) {
    if (!item.name) continue
    const name = item.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '')
    stmt.run(
      randomUUID(),
      name,
      item.description || null,
      item.source || null,
      item.pipedream_slug || null,
      item.env_keys ? JSON.stringify(item.env_keys) : null,
      item.notes || null,
      item.auto_generated ? 1 : 0,
      now,
      now,
    )
    results.push(name)
  }

  return c.json({ created: results.length, connectors: results })
})

// Delete one
connectorsRouter.delete('/:name', (c) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM connectors WHERE name = ?').run(c.req.param('name'))
  return c.json({ deleted: result.changes > 0 })
})

export default connectorsRouter
