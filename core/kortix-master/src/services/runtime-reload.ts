import { serviceManager } from './service-manager'

export type ReloadMode = 'dispose-only' | 'full'

export interface ReloadResult {
  success: boolean
  mode: ReloadMode
  steps: string[]
  errors: string[]
}

export async function initiateRuntimeReload(mode: ReloadMode): Promise<ReloadResult> {
  const result: ReloadResult = {
    success: true,
    mode,
    steps: [],
    errors: [],
  }

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
    return result
  }

  result.steps.push(
    'Full reload initiated — the service manager will stop and rehydrate all managed services',
    'Kortix Master will be restarted by s6',
    'All registered spawn and s6-backed services will be reconciled back to desired state on boot',
    'All in-memory state (caches, singletons, module cache) will be cleared',
  )

  setTimeout(async () => {
    console.log('[runtime-reload] Preparing managed services for full reload...')
    try {
      const prepared = await serviceManager.prepareForFullReload()
      console.log(`[runtime-reload] Prepared ${prepared.stopped.length} managed service(s) for reload`)
    } catch (err) {
      console.error('[runtime-reload] Failed to prepare services for reload:', err)
    }

    console.log('[runtime-reload] Restarting kortix-master via s6 — goodbye!')
    try {
      Bun.spawn(['bash', '-c', 'sudo s6-svc -r /run/service/svc-kortix-master'], {
        stdout: 'inherit',
        stderr: 'inherit',
      })
    } catch {}

    setTimeout(() => {
      console.log('[runtime-reload] s6 restart did not kill us — exiting as fallback')
      process.exit(0)
    }, 3000)
  }, 200)

  return result
}
