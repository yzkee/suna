/**
 * opencode-hotreload — Watch /workspace/.opencode/ for changes and auto-dispose
 * the OpenCode instance so it rescans skills, agents, plugins, and config.
 *
 * Problem: OpenCode caches skills, agents, tools, and config at startup. When
 * anything changes on disk — marketplace installs, agent-created skills/agents,
 * config edits, plugin installs — the server doesn't pick it up until
 * instance.dispose() is called or the process restarts.
 *
 * Solution: Watch the entire /workspace/.opencode/ directory tree. When relevant
 * files change (skills, agents, config, plugins), debounce 1.5s then call
 * POST /instance/dispose on OpenCode serve. Ignores noisy files (sqlite, locks,
 * node_modules, logs) to avoid unnecessary reloads.
 */

import { watch, existsSync, mkdirSync } from 'fs'
import type { FSWatcher } from 'fs'
import { config } from '../config'

const WATCH_ROOT = '/workspace/.opencode'

/** Files/dirs that change frequently but don't affect OpenCode's cached state */
const IGNORE_PATTERNS = [
  /\.db$/,
  /\.db-wal$/,
  /\.db-shm$/,
  /\.lock$/,
  /\.log$/,
  /node_modules/,
  /\.cache/,
  /\.git/,
  /bun\.lock/,
  /\.ocx\//,        // ocx receipt files — not relevant to OpenCode
  /package-lock/,
]

const DEBOUNCE_MS = 1_500
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let watchers: FSWatcher[] = []
let disposeInFlight = false

function shouldIgnore(filename: string | null): boolean {
  if (!filename) return false // null filename = can't filter, trigger reload
  return IGNORE_PATTERNS.some(p => p.test(filename))
}

async function disposeInstance(): Promise<void> {
  if (disposeInFlight) return
  disposeInFlight = true
  try {
    const url = `http://${config.OPENCODE_HOST}:${config.OPENCODE_PORT}/instance/dispose`
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) {
      console.log('[hotreload] Disposed OpenCode instance (.opencode/ changed)')
    } else {
      console.warn(`[hotreload] instance/dispose returned ${res.status}`)
    }
    await res.arrayBuffer().catch(() => {})
  } catch (err) {
    // OpenCode might not be up yet — non-fatal
    console.warn('[hotreload] Failed to dispose instance:', (err as Error).message)
  } finally {
    disposeInFlight = false
  }
}

function scheduleDispose(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    disposeInstance()
  }, DEBOUNCE_MS)
}

export function startHotReload(): void {
  // Ensure watch root exists
  if (!existsSync(WATCH_ROOT)) {
    try { mkdirSync(WATCH_ROOT, { recursive: true }) } catch {}
  }
  if (!existsSync(WATCH_ROOT)) {
    console.warn('[hotreload] /workspace/.opencode does not exist, skipping')
    return
  }

  try {
    const watcher = watch(WATCH_ROOT, { recursive: true }, (_event, filename) => {
      if (shouldIgnore(filename)) return
      scheduleDispose()
    })
    watchers.push(watcher)
    console.log(`[hotreload] Watching ${WATCH_ROOT} (recursive)`)
  } catch (err) {
    console.warn(`[hotreload] Failed to watch ${WATCH_ROOT}:`, (err as Error).message)
  }
}

export function stopHotReload(): void {
  for (const w of watchers) {
    try { w.close() } catch {}
  }
  watchers = []
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
