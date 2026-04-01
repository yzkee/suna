import { Hono } from 'hono'
import { describeRoute } from 'hono-openapi'
import { resolver } from 'hono-openapi'
import { coreSupervisor } from '../services/core-supervisor'
import { z } from 'zod'

const reloadRouter = new Hono()

const ReloadModeSchema = z.enum(['dispose-only', 'full'])
type ReloadMode = z.infer<typeof ReloadModeSchema>

const ReloadResultSchema = z.object({
  success: z.boolean(),
  mode: ReloadModeSchema,
  steps: z.array(z.string()),
  errors: z.array(z.string()),
})
type ReloadResult = z.infer<typeof ReloadResultSchema>

/**
 * POST /kortix/reload
 *
 * Reloads the sandbox runtime.
 *
 * Modes:
 * - "dispose-only": Calls OpenCode's /instance/dispose to rescan skills, agents,
 *   plugins, tools, and config from disk. Does NOT restart any processes.
 *   Use when you only changed files under .opencode/ (agents, skills, tools, config).
 *
 * - "full" (default): TRUE full restart — equivalent to a container restart.
 *   Sends the response, then restarts kortix-master via s6 which:
 *     - Kills the current kortix-master process (clears ALL in-memory state, Bun module cache)
 *     - s6 respawns kortix-master, which re-reads all source files from disk
 *     - kortix-master's core supervisor restarts opencode-serve (fresh process)
 *     - Channels, cron, auth-sync, secret store — all re-initialized from scratch
 *
 *   This is the dev-mode alternative to rebuilding the Docker container.
 *   Changed kortix-master source? Changed routes? Changed channels code?
 *   Full reload picks it all up — just like a fresh container start.
 */
reloadRouter.post('/',
  describeRoute({
    tags: ['System'],
    summary: 'Reload the sandbox runtime',
    description: 'mode=dispose-only rescans OpenCode config. mode=full (default) restarts all processes — equivalent to a container restart without rebuilding.',
    responses: {
      200: { description: 'Reload initiated', content: { 'application/json': { schema: resolver(ReloadResultSchema) } } },
      500: { description: 'Reload failed' },
    },
  }),
  async (c) => {
    const body = await c.req.json<{ mode?: ReloadMode }>()
      .catch(() => ({}) as { mode?: ReloadMode })
    const mode: ReloadMode = body.mode || 'full'

    const result: ReloadResult = {
      success: true,
      mode,
      steps: [],
      errors: [],
    }

    // ── Dispose-only mode: just rescan OpenCode config ──────────────────
    if (mode === 'dispose-only') {
      try {
        const disposeRes = await fetch('http://localhost:4096/instance/dispose', {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        })
        await disposeRes.arrayBuffer().catch(() => {})
        result.steps.push('OpenCode instance disposed — config rescanned')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.success = false
        result.errors.push(`OpenCode dispose failed: ${msg}`)
      }
      return c.json(result)
    }

    // ── Full reload mode: restart everything ────────────────────────────
    //
    // Strategy: We MUST restart kortix-master itself to clear Bun's module
    // cache and all in-memory state (cron singleton, secret store, auth-sync,
    // openCodeReady flag, spec cache, deployer state, etc.).
    //
    // Sequence:
    //   1. Send response to the client immediately (so they know it's happening)
    //   2. Stop opencode-serve gracefully (so it releases the SQLite DB)
    //   3. Restart channels via s6 (independent process)
    //   4. Restart kortix-master via s6 (kills us — but response is already sent)
    //
    // When kortix-master comes back up, its core supervisor will re-launch
    // opencode-serve automatically (autoStart: true in service-spec.json).

    result.steps.push(
      'Full reload initiated — all processes will restart',
      'kortix-master will be killed and respawned by s6',
      'opencode-serve will be re-launched by the core supervisor on startup',
      'Channels will be restarted via s6',
      'All in-memory state (caches, singletons, module cache) will be cleared',
    )

    // Schedule the actual restart AFTER the response is sent.
    // We use setImmediate/setTimeout so Hono can flush the HTTP response first.
    setTimeout(async () => {
      console.log('[reload] Full reload: stopping opencode-serve...')
      try {
        // Gracefully stop opencode-serve first so it releases its SQLite locks.
        // The core supervisor will NOT auto-restart it because we stop the supervisor
        // when kortix-master dies (it runs in-process).
        await coreSupervisor.stopService('opencode-serve')
        console.log('[reload] opencode-serve stopped')
      } catch (err) {
        console.error('[reload] Failed to stop opencode-serve:', err)
      }

      // Restart channels (independent s6 service)
      console.log('[reload] Restarting channels...')
      try {
        const proc = Bun.spawn(['bash', '-c', 'sudo s6-svc -r /run/service/svc-opencode-channels 2>/dev/null || true'], {
          stdout: 'inherit', stderr: 'inherit',
        })
        await proc.exited
      } catch {}

      // Now restart kortix-master itself — this kills our process.
      // s6 will respawn us, which re-initializes everything from scratch:
      //   - Fresh Bun process → all .ts files re-compiled from disk
      //   - SecretStore re-loaded
      //   - auth-sync re-initialized
      //   - CronManager re-created
      //   - Core supervisor re-starts opencode-serve
      //   - openCodeReady = false (re-probed)
      //   - cachedSpec = null
      console.log('[reload] Restarting kortix-master via s6 — goodbye!')
      try {
        const proc = Bun.spawn(['bash', '-c', 'sudo s6-svc -r /run/service/svc-kortix-master'], {
          stdout: 'inherit', stderr: 'inherit',
        })
        // Don't await — we'll be killed
      } catch {}

      // Fallback: if s6 isn't available (e.g. local dev), exit and let the
      // process manager (docker restart policy, nodemon, etc.) restart us.
      setTimeout(() => {
        console.log('[reload] s6 restart did not kill us — exiting as fallback')
        process.exit(0)
      }, 3000)
    }, 200) // 200ms delay — enough for Hono to flush the response

    return c.json(result)
  },
)

/**
 * POST /kortix/reload/full
 *
 * Convenience alias — equivalent to POST /kortix/reload { mode: "full" }.
 */
reloadRouter.post('/full',
  describeRoute({
    tags: ['System'],
    summary: 'Full reload (convenience alias)',
    description: 'Restarts all processes. Equivalent to POST /kortix/reload with mode=full.',
    responses: {
      200: { description: 'Full reload initiated' },
      500: { description: 'Reload failed' },
    },
  }),
  async (c) => {
    // Construct an internal request to the main handler
    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/\/full$/, '')
    const internalReq = new Request(url.toString(), {
      method: 'POST',
      headers: c.req.raw.headers,
      body: JSON.stringify({ mode: 'full' }),
    })
    return reloadRouter.fetch(internalReq, c.env)
  },
)

export default reloadRouter
