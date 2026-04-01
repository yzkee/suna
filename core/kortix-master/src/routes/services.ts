import { Hono } from 'hono'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ListeningProcess } from '../services/port-scanner'
import { serviceManager } from '../services/service-manager'
import { initiateRuntimeReload, type ReloadMode } from '../services/runtime-reload'

const servicesRouter = new Hono()

export interface ServiceEntry {
  id: string
  name: string
  port: number
  pid: number
  framework: string
  sourcePath: string
  startedAt: string
  status: 'running' | 'stopped' | 'starting' | 'failed' | 'backoff'
  managed: boolean
  adapter?: 'spawn' | 's6'
  scope?: 'bootstrap' | 'core' | 'project' | 'session'
  desiredState?: 'running' | 'stopped'
  builtin?: boolean
  autoStart?: boolean
}

function guessFramework(command: string, cmdline: string, cwd?: string): string {
  const cmd = command.toLowerCase()
  const args = cmdline.toLowerCase()

  if (cmd === 'go' || cmd.startsWith('go-') || args.includes('go run') || args.includes('go build')) return 'go'
  if (cmd === 'python' || cmd === 'python3' || cmd === 'uvicorn' || cmd === 'gunicorn') return 'python'
  if (cmd === 'ruby' || cmd === 'rails' || cmd === 'puma') return 'ruby'
  if (cmd === 'java' || cmd === 'javac') return 'java'
  if (cmd === 'rust' || cmd === 'cargo') return 'rust'
  if (args.includes('next')) return 'nextjs'
  if (args.includes('vite')) return 'vite'
  if (args.includes('react-scripts')) return 'cra'
  if (args.includes('express') || args.includes('fastify') || args.includes('hono')) return 'node'
  if (args.includes('serve ') || args.includes('http-server')) return 'static'
  if (cmd === 'node' || cmd === 'bun' || cmd === 'deno') return 'node'

  if (cwd && cwd.startsWith('/workspace')) {
    const dirsToCheck = [cwd]
    const binaryPath = cmdline.split(/\s+/)[0]
    if (binaryPath) {
      const binDir = binaryPath.replace(/\/[^/]+$/, '')
      if (binDir && binDir !== cwd && binDir.startsWith('/workspace')) dirsToCheck.push(binDir)
    }
    for (const dir of dirsToCheck) {
      try {
        if (existsSync(join(dir, 'go.mod'))) return 'go'
        if (existsSync(join(dir, 'Cargo.toml'))) return 'rust'
        if (existsSync(join(dir, 'Gemfile'))) return 'ruby'
        if (existsSync(join(dir, 'pom.xml')) || existsSync(join(dir, 'build.gradle'))) return 'java'
        if (existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'pyproject.toml'))) return 'python'
        if (existsSync(join(dir, 'package.json'))) return 'node'
      } catch {
        // ignore filesystem errors
      }
    }
  }

  return 'unknown'
}

function guessName(command: string, cmdline: string, cwd: string, port: number): string {
  if (cwd && cwd !== '/' && cwd !== '/workspace') {
    const relative = cwd.replace(/^\/workspace\/?/, '')
    const dirName = relative.split('/').filter(Boolean).pop()
    if (dirName) return dirName
  }

  const binaryPath = cmdline.split(/\s+/)[0]
  if (binaryPath && binaryPath.startsWith('/workspace/')) {
    const relative = binaryPath.replace(/^\/workspace\/?/, '')
    const parts = relative.split('/').filter(Boolean)
    if (parts.length > 1) return parts[0]
  }

  const cmd = command.toLowerCase()
  if (cmd === 'go' || cmdline.includes('go run') || cmdline.includes('go build')) {
    const match = cmdline.match(/go\s+run\s+(\S+)/)
    if (match) {
      const file = match[1].replace(/\.\w+$/, '')
      if (file !== 'main' && file !== '.') return file
    }
  }
  if (cmd === 'python' || cmd === 'python3') {
    const match = cmdline.match(/python3?\s+(\S+)/)
    if (match) {
      const file = match[1].replace(/\.\w+$/, '')
      if (file && file !== '-m') return file
    }
  }

  if (command && !['node', 'python3', 'python', 'sh', 'bash', 'bun'].includes(cmd)) {
    return command
  }

  return `service:${port}`
}

async function scanUnmanagedServices(): Promise<ServiceEntry[]> {
  let scanned: ListeningProcess[] = []
  try {
    const { scanListeningProcesses } = await import('../services/port-scanner')
    scanned = scanListeningProcesses()
  } catch (err) {
    console.warn('[Services API] Port scanner failed:', err)
  }

  return scanned.map((proc) => ({
    id: `port-${proc.port}`,
    name: guessName(proc.command, proc.cmdline, proc.cwd, proc.port),
    port: proc.port,
    pid: proc.pid,
    framework: guessFramework(proc.command, proc.cmdline, proc.cwd),
    sourcePath: proc.cwd,
    startedAt: '',
    status: 'running',
    managed: false,
  }))
}

servicesRouter.get('/', async (c) => {
  try {
    const includeAll = c.req.query('all') === 'true'
    const managedServices = await serviceManager.listServices({
      includeSystem: includeAll,
      includeStopped: includeAll,
    })

    const results: ServiceEntry[] = managedServices.map((service) => ({
      id: service.id,
      name: service.name,
      port: service.port ?? 0,
      pid: service.pid ?? 0,
      framework: service.framework ?? 'unknown',
      sourcePath: service.sourcePath ?? '',
      startedAt: service.startedAt ?? '',
      status: service.status,
      managed: true,
      adapter: service.adapter,
      scope: service.scope,
      desiredState: service.desiredState,
      builtin: service.builtin,
      autoStart: service.autoStart,
    }))

    const seenPorts = new Set(results.map((service) => service.port).filter((port) => port > 0))
    const unmanaged = await scanUnmanagedServices()
    for (const service of unmanaged) {
      if (service.port > 0 && seenPorts.has(service.port)) continue
      results.push(service)
    }

    return c.json({ services: results })
  } catch (error) {
    console.error('[Services API] Error listing services:', error)
    return c.json({ error: 'Failed to list services', details: String(error) }, 500)
  }
})

servicesRouter.get('/templates', async (c) => {
  try {
    return c.json({ templates: serviceManager.listTemplates() })
  } catch (error) {
    return c.json({ error: 'Failed to list service templates', details: String(error) }, 500)
  }
})

servicesRouter.post('/register', async (c) => {
  try {
    const body = await c.req.json<{
      id: string
      name?: string
      adapter?: 'spawn' | 's6'
      scope?: 'bootstrap' | 'core' | 'project' | 'session'
      description?: string
      projectId?: string | null
      template?: string | null
      framework?: string | null
      sourcePath?: string | null
      startCommand?: string | null
      installCommand?: string | null
      buildCommand?: string | null
      envVarKeys?: string[]
      deps?: string[]
      port?: number | null
      desiredState?: 'running' | 'stopped'
      autoStart?: boolean
      restartPolicy?: 'always' | 'on-failure' | 'never'
      restartDelayMs?: number
      s6ServiceName?: string | null
      processPatterns?: string[]
      userVisible?: boolean
      healthCheck?: { type?: 'none' | 'tcp' | 'http'; path?: string; timeoutMs?: number }
      startNow?: boolean
    }>()

    if (!body?.id) return c.json({ error: 'id is required' }, 400)

    if (body.template && !body.startCommand && !body.s6ServiceName) {
      const template = serviceManager.listTemplates().find((entry) => entry.id === body.template)
      if (!template) return c.json({ error: `Unknown template: ${body.template}` }, 400)
      body.adapter = body.adapter || template.adapter
      body.framework = body.framework || template.framework || null
      body.installCommand = body.installCommand ?? template.installCommand ?? null
      body.buildCommand = body.buildCommand ?? template.buildCommand ?? null
      if (body.port == null && template.defaultPort != null) body.port = template.defaultPort
      if (template.startCommand) {
        body.startCommand = template.startCommand.replace(/__PORT__/g, String(body.port ?? template.defaultPort ?? 3000))
      }
    }

    const service = await serviceManager.registerService(body)
    let action: { ok: boolean; output: string } = { ok: true, output: 'registered' }
    if ((body.startNow ?? body.desiredState === 'running') && service.desiredState === 'running') {
      action = await serviceManager.startService(body.id)
    }

    return c.json({ success: action.ok, output: action.output, service: await serviceManager.getService(body.id) }, action.ok ? 200 : 500)
  } catch (error) {
    return c.json({ error: 'Failed to register service', details: String(error) }, 500)
  }
})

servicesRouter.post('/reconcile', async (c) => {
  try {
    const reload = c.req.query('reload') === 'true'
    const result = reload
      ? await serviceManager.reloadFromDiskAndReconcile()
      : await serviceManager.reconcile()
    if (!result.ok) return c.json({ success: false, error: result.output }, 500)
    return c.json({ success: true, output: result.output, services: await serviceManager.listServices({ includeSystem: true, includeStopped: true }) })
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

servicesRouter.post('/system/reload', async (c) => {
  try {
    const body = await c.req.json<{ mode?: ReloadMode }>().catch(() => ({} as { mode?: ReloadMode }))
    const mode: ReloadMode = body.mode || 'full'
    return c.json(await initiateRuntimeReload(mode))
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

servicesRouter.get('/:id/logs', async (c) => {
  try {
    const id = c.req.param('id')
    const result = await serviceManager.getLogs(id)
    if (result.error) return c.json({ logs: [], error: result.error }, 404)
    return c.json({ logs: result.logs })
  } catch (error) {
    return c.json({ logs: [], error: String(error) }, 500)
  }
})

servicesRouter.get('/:id', async (c) => {
  try {
    const service = await serviceManager.getService(c.req.param('id'))
    if (!service) return c.json({ error: `Service not found: ${c.req.param('id')}` }, 404)
    return c.json({ service })
  } catch (error) {
    return c.json({ error: 'Failed to get service', details: String(error) }, 500)
  }
})

servicesRouter.post('/:id/start', async (c) => {
  try {
    const result = await serviceManager.startService(c.req.param('id'))
    if (!result.ok && result.output.includes('Unknown service')) return c.json({ success: false, error: result.output }, 404)
    return c.json({ success: result.ok, output: result.output, service: result.service }, result.ok ? 200 : 500)
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

servicesRouter.post('/:id/stop', async (c) => {
  try {
    const result = await serviceManager.stopService(c.req.param('id'))
    if (!result.ok && result.output.includes('Unknown service')) return c.json({ success: false, error: result.output }, 404)
    return c.json({ success: result.ok, output: result.output, service: result.service }, result.ok ? 200 : 500)
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

servicesRouter.post('/:id/restart', async (c) => {
  try {
    const result = await serviceManager.restartService(c.req.param('id'))
    if (!result.ok && result.output.includes('Unknown service')) return c.json({ success: false, error: result.output }, 404)
    return c.json({ success: result.ok, output: result.output, service: result.service }, result.ok ? 200 : 500)
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

servicesRouter.delete('/:id', async (c) => {
  try {
    const result = await serviceManager.unregisterService(c.req.param('id'))
    if (!result.ok && result.output.includes('Unknown service')) return c.json({ success: false, error: result.output }, 404)
    if (!result.ok && result.output.includes('builtin')) return c.json({ success: false, error: result.output }, 400)
    return c.json({ success: result.ok, output: result.output }, result.ok ? 200 : 500)
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

export default servicesRouter
