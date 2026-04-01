import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ServiceManager, detectFramework, getFrameworkCommands, type RegisteredServiceSpec } from '../../src/services/service-manager'

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

describe('ServiceManager — Framework Detection', () => {
  it('detects nextjs from package.json', () => {
    const dir = makeTempDir('service-manager-fw-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }))
    expect(detectFramework(dir)).toBe('nextjs')
  })

  it('detects vite from scoped vite plugin', () => {
    const dir = makeTempDir('service-manager-fw-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@vitejs/plugin-react': '4.0.0' } }))
    expect(detectFramework(dir)).toBe('vite')
  })

  it('detects python from pyproject', () => {
    const dir = makeTempDir('service-manager-fw-')
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname="demo"\n')
    expect(detectFramework(dir)).toBe('python')
  })

  it('detects static from index.html', () => {
    const dir = makeTempDir('service-manager-fw-')
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    expect(detectFramework(dir)).toBe('static')
  })

  it('returns expected framework commands', () => {
    const dir = makeTempDir('service-manager-cmds-')
    mkdirSync(dir, { recursive: true })
    const vite = getFrameworkCommands('vite', dir)
    expect(vite.install).toBe('npm install')
    expect(vite.build).toBe('npm run build')
    expect(vite.start).toContain('vite preview')
  })
})

describe('ServiceManager — Managed project services', () => {
  it('deploys, lists, logs, and stops a simple Bun service', async () => {
    const storageDir = makeTempDir('service-manager-store-')
    const appDir = makeTempDir('service-manager-app-')
    writeFileSync(join(appDir, 'server.js'), `
      Bun.serve({
        port: Number(process.env.PORT),
        fetch() {
          return new Response('service-manager-ok')
        },
      })
      console.log('ready:' + process.env.PORT)
    `)

    const manager = createManager(storageDir)
    const deployId = `svc-${Date.now()}`
    const result = await manager.deployLegacyService({
      deploymentId: deployId,
      sourceType: 'files',
      sourcePath: appDir,
      framework: 'node',
      entrypoint: 'bun server.js',
    })

    expect(result.success).toBe(true)
    expect(result.port).toBeDefined()
    expect(result.pid).toBeDefined()

    const response = await fetch(`http://127.0.0.1:${result.port}`)
    expect(await response.text()).toBe('service-manager-ok')

    const services = await manager.listServices({ includeSystem: true, includeStopped: true })
    const service = services.find((entry) => entry.id === deployId)
    expect(service).toBeDefined()
    expect(service?.status).toBe('running')

    await Bun.sleep(200)
    const logs = await manager.getLogs(deployId)
    expect(logs.error).toBeUndefined()
    expect(logs.logs.length).toBeGreaterThan(0)

    const stopped = await manager.stopService(deployId)
    expect(stopped.ok).toBe(true)

    const status = await manager.getService(deployId)
    expect(status?.status).toBe('stopped')
  }, 30000)

  it('rehydrates persisted running services across manager restart', async () => {
    const storageDir = makeTempDir('service-manager-store-')
    const appDir = makeTempDir('service-manager-app-')
    writeFileSync(join(appDir, 'server.js'), `
      Bun.serve({
        port: Number(process.env.PORT),
        fetch() {
          return new Response('persistent-ok')
        },
      })
      console.log('persistent:' + process.env.PORT)
    `)

    const firstManager = createManager(storageDir)
    const serviceId = `persist-${Date.now()}`
    const deployed = await firstManager.deployLegacyService({
      deploymentId: serviceId,
      sourceType: 'files',
      sourcePath: appDir,
      framework: 'node',
      entrypoint: 'bun server.js',
    })

    expect(deployed.success).toBe(true)
    expect(deployed.port).toBeDefined()

    const secondManager = createManager(storageDir)
    await secondManager.start()

    const adopted = await secondManager.getService(serviceId)
    expect(adopted).toBeDefined()
    expect(adopted?.status).toBe('running')
    expect(adopted?.port).toBe(deployed.port)

    const response = await fetch(`http://127.0.0.1:${deployed.port}`)
    expect(await response.text()).toBe('persistent-ok')

    const stopped = await secondManager.stopService(serviceId)
    expect(stopped.ok).toBe(true)

    await Bun.sleep(400)
    let stoppedFetchFailed = false
    try {
      await fetch(`http://127.0.0.1:${deployed.port}`, { signal: AbortSignal.timeout(1000) })
    } catch {
      stoppedFetchFailed = true
    }
    expect(stoppedFetchFailed).toBe(true)
  }, 30000)
})
