import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Hono } from 'hono'
import { ServiceManager, type RegisteredServiceSpec } from '../../src/services/service-manager'

const tempDirs: string[] = []
const managers: ServiceManager[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createManager(storageDir: string) {
  const manager = new ServiceManager({
    registryFile: join(storageDir, 'registry.json'),
    logsDir: join(storageDir, 'logs'),
    gateDir: join(storageDir, 'enabled'),
    builtins: [] as RegisteredServiceSpec[],
  })
  managers.push(manager)
  return manager
}

afterAll(async () => {
  for (const manager of managers) {
    try { await manager.stop() } catch {}
  }
  await Bun.sleep(300)
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

const storageDir = makeTempDir('deploy-routes-store-')
const manager = createManager(storageDir)
const app = new Hono()

app.post('/kortix/deploy', async (c) => {
  const body = await c.req.json<any>()
  if (!body.deploymentId) return c.json({ error: 'deploymentId is required' }, 400)
  const result = await manager.deployLegacyService({
    deploymentId: body.deploymentId,
    sourceType: body.sourceType || 'files',
    sourceRef: body.sourceRef,
    sourcePath: body.sourcePath || '/workspace',
    framework: body.framework,
    envVarKeys: body.envVarKeys,
    buildConfig: body.buildConfig,
    entrypoint: body.entrypoint,
  })
  return c.json({
    success: result.success,
    port: result.port,
    pid: result.pid,
    framework: result.framework,
    error: result.error,
    logs: result.logs,
  }, result.success ? 200 : 500)
})

app.post('/kortix/deploy/:id/stop', async (c) => {
  const result = await manager.stopService(c.req.param('id'))
  if (!result.ok) return c.json({ success: false, error: result.output }, 404)
  return c.json({ success: true, output: result.output })
})

app.get('/kortix/deploy/:id/logs', async (c) => {
  const result = await manager.getLogs(c.req.param('id'))
  if (result.error) return c.json({ logs: [], error: result.error }, 404)
  return c.json({ logs: result.logs })
})

app.get('/kortix/deploy/:id/status', async (c) => {
  const service = await manager.getService(c.req.param('id'))
  if (!service) return c.json({ status: 'not_found' }, 404)
  return c.json({
    status: service.status === 'running' || service.status === 'starting' ? 'running' : 'stopped',
    port: service.port,
    pid: service.pid,
    framework: service.framework,
  })
})

app.get('/kortix/deploy', async (c) => {
  const services = await manager.listServices({ includeSystem: true, includeStopped: true })
  return c.json({
    deployments: services.filter((service) => service.scope === 'project').map((service) => ({
      id: service.id,
      status: service.status === 'running' || service.status === 'starting' ? 'running' : 'stopped',
      port: service.port,
      pid: service.pid,
      framework: service.framework,
    })),
  })
})

function jsonPost(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function jsonGet(path: string) {
  return app.request(path, { method: 'GET' })
}

describe('Deploy Routes — compatibility over ServiceManager', () => {
  it('returns 400 when deploymentId is missing', async () => {
    const res = await jsonPost('/kortix/deploy', { sourceType: 'files' })
    expect(res.status).toBe(400)
  })

  it('deploys a simple Bun server via API', async () => {
    const appDir = makeTempDir('deploy-routes-app-')
    writeFileSync(join(appDir, 'server.js'), `
      Bun.serve({
        port: Number(process.env.PORT),
        fetch() { return new Response('route-test') },
      })
    `)

    const res = await jsonPost('/kortix/deploy', {
      deploymentId: `route-test-${Date.now()}`,
      sourceType: 'files',
      sourcePath: appDir,
      framework: 'node',
      entrypoint: 'bun server.js',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.port).toBeDefined()

    const appRes = await fetch(`http://127.0.0.1:${body.port}`)
    expect(await appRes.text()).toBe('route-test')
  }, 30000)

  it('lists managed deployments', async () => {
    const res = await jsonGet('/kortix/deploy')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deployments).toBeArray()
    expect(body.deployments.length).toBeGreaterThanOrEqual(1)
  })

  it('returns status and logs for a running deployment', async () => {
    const list = await jsonGet('/kortix/deploy')
    const deployments = (await list.json()).deployments as Array<{ id: string }>
    const id = deployments[0].id

    const statusRes = await jsonGet(`/kortix/deploy/${id}/status`)
    expect(statusRes.status).toBe(200)
    const statusBody = await statusRes.json()
    expect(statusBody.status).toBe('running')

    await Bun.sleep(200)
    const logsRes = await jsonGet(`/kortix/deploy/${id}/logs`)
    expect(logsRes.status).toBe(200)
    const logsBody = await logsRes.json()
    expect(logsBody.logs).toBeArray()
  })

  it('stops a managed deployment and reports stopped status', async () => {
    const list = await jsonGet('/kortix/deploy')
    const deployments = (await list.json()).deployments as Array<{ id: string }>
    const id = deployments[0].id

    const stopRes = await jsonPost(`/kortix/deploy/${id}/stop`, {})
    expect(stopRes.status).toBe(200)

    const statusRes = await jsonGet(`/kortix/deploy/${id}/status`)
    expect(statusRes.status).toBe(200)
    const statusBody = await statusRes.json()
    expect(statusBody.status).toBe('stopped')
  })
})
