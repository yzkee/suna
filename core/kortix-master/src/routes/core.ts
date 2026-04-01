import { Hono } from 'hono'
import { describeRoute } from 'hono-openapi'
import { serviceManager } from '../services/service-manager'

const coreRouter = new Hono()

coreRouter.get('/status',
  describeRoute({
    tags: ['System'],
    summary: 'Central service manager status',
    description: 'Returns Kortix Master service-manager state for core and bootstrap services.',
    responses: { 200: { description: 'Core service status' } },
  }),
  async (c) => {
    return c.json(await serviceManager.getCoreStatus())
  },
)

coreRouter.post('/reconcile',
  describeRoute({
    tags: ['System'],
    summary: 'Reconcile central service registry',
    description: 'Reloads the service registry from disk when requested and reconciles managed services.',
    responses: { 200: { description: 'Reconcile result' }, 500: { description: 'Reconcile failed' } },
  }),
  async (c) => {
    try {
      const reload = c.req.query('reload') === 'true'
      const result = reload
        ? await serviceManager.reloadFromDiskAndReconcile()
        : await serviceManager.reconcile()
      if (!result.ok) return c.json({ success: false, error: result.output }, 500)
      return c.json({ success: true, output: result.output, status: await serviceManager.getCoreStatus() })
    } catch (e) {
      return c.json({ success: false, error: String(e) }, 500)
    }
  },
)

coreRouter.post('/restart/:service',
  describeRoute({
    tags: ['System'],
    summary: 'Restart a managed service',
    description: 'Restarts a single service managed by Kortix Master.',
    responses: { 200: { description: 'Restart result' }, 404: { description: 'Service not found' }, 500: { description: 'Restart failed' } },
  }),
  async (c) => {
    const service = c.req.param('service')
    const result = await serviceManager.restartService(service)
    if (!result.ok && result.output.includes('Unknown service')) {
      return c.json({ success: false, error: result.output }, 404)
    }
    if (!result.ok) {
      return c.json({ success: false, error: result.output }, 500)
    }
    return c.json({ success: true, output: result.output, status: await serviceManager.getCoreStatus() })
  },
)

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
