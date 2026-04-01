import { Hono } from 'hono'
import { describeRoute } from 'hono-openapi'
import { coreSupervisor } from '../services/core-supervisor'

const coreRouter = new Hono()

coreRouter.get('/status',
  describeRoute({
    tags: ['System'],
    summary: 'Core supervisor status',
    description: 'Returns current core supervisor state and managed service statuses.',
    responses: { 200: { description: 'Core status' } },
  }),
  (c) => {
    return c.json(coreSupervisor.getStatus())
  },
)

coreRouter.post('/reconcile',
  describeRoute({
    tags: ['System'],
    summary: 'Reconcile core services from disk',
    description: 'Reloads /ephemeral/metadata/core/service-spec.json and reconciles running services.',
    responses: { 200: { description: 'Reconcile result' }, 500: { description: 'Reconcile failed' } },
  }),
  async (c) => {
    try {
      const result = await coreSupervisor.reconcileFromDisk()
      if (!result.ok) return c.json({ success: false, error: result.output }, 500)
      return c.json({ success: true, output: result.output, status: coreSupervisor.getStatus() })
    } catch (e) {
      return c.json({ success: false, error: String(e) }, 500)
    }
  },
)

coreRouter.post('/restart/:service',
  describeRoute({
    tags: ['System'],
    summary: 'Restart a core-managed service',
    description: 'Restarts a single service managed by the core supervisor.',
    responses: { 200: { description: 'Restart result' }, 404: { description: 'Service not found' }, 500: { description: 'Restart failed' } },
  }),
  async (c) => {
    const service = c.req.param('service')
    const result = await coreSupervisor.restartService(service)
    if (!result.ok && result.output.includes('Unknown service')) {
      return c.json({ success: false, error: result.output }, 404)
    }
    if (!result.ok) {
      return c.json({ success: false, error: result.output }, 500)
    }
    return c.json({ success: true, output: result.output, status: coreSupervisor.getStatus() })
  },
)

// Debug: run a shell command and return stdout+stderr (internal/localhost only)
coreRouter.post('/exec',
  describeRoute({
    tags: ['System'],
    summary: 'Run a shell command (debug)',
    description: 'Runs a bash command and returns the output. Intended for diagnostics only.',
    responses: { 200: { description: 'Command output' } },
  }),
  async (c) => {
    const body = await c.req.json<{ cmd: string }>()
    if (!body?.cmd) return c.json({ error: 'cmd required' }, 400)
    try {
      const proc = Bun.spawn(['bash', '-c', body.cmd], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, HOME: '/workspace' },
      })
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const code = await proc.exited
      return c.json({ code, stdout, stderr })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  },
)

export default coreRouter
