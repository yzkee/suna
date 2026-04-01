import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'

export interface RuntimeFixture {
  root: string
  workspaceRoot: string
  s6EnvDir: string
  secretFilePath: string
  saltFilePath: string
  authJsonPath: string
  bootstrapPath: string
}

export function createRuntimeFixture(prefix: string): RuntimeFixture {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const workspaceRoot = join(root, 'workspace')
  const s6EnvDir = join(root, 's6-env')
  mkdirSync(join(workspaceRoot, '.secrets'), { recursive: true })
  mkdirSync(join(workspaceRoot, '.local', 'share', 'opencode'), { recursive: true })
  mkdirSync(s6EnvDir, { recursive: true })
  return {
    root,
    workspaceRoot,
    s6EnvDir,
    secretFilePath: join(workspaceRoot, '.secrets', '.secrets.json'),
    saltFilePath: join(workspaceRoot, '.secrets', '.salt'),
    authJsonPath: join(workspaceRoot, '.local', 'share', 'opencode', 'auth.json'),
    bootstrapPath: join(workspaceRoot, '.secrets', '.bootstrap-env.json'),
  }
}

export async function cleanupRuntimeFixture(fixture: RuntimeFixture): Promise<void> {
  rmSync(fixture.root, { recursive: true, force: true })
}

export interface StartedServer {
  process: ChildProcess
  stop: () => Promise<void>
}

export async function waitForHttp(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      await res.text().catch(() => '')
      return
    } catch {}
    await Bun.sleep(200)
  }
  throw new Error(`Server startup timeout for ${url}`)
}

export async function startDummyOpenCode(port: number): Promise<{ stop: () => Promise<void> }> {
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/session') return Response.json([])
      return Response.json({ ok: true })
    },
  })
  await waitForHttp(`http://127.0.0.1:${port}/session`)
  return {
    stop: async () => {
      await server.stop(true)
    },
  }
}

export async function startKortixMaster(port: number, fixture: RuntimeFixture, extraEnv: Record<string, string> = {}): Promise<StartedServer> {
  const proc = spawn('bun', ['run', 'src/index.ts'], {
    cwd: '/Users/markokraemer/Projects/heyagi/computer/core/kortix-master',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SECRET_FILE_PATH: fixture.secretFilePath,
      SALT_FILE_PATH: fixture.saltFilePath,
      AUTH_JSON_PATH: fixture.authJsonPath,
      BOOTSTRAP_PATH: fixture.bootstrapPath,
      KORTIX_WORKSPACE_ROOT: fixture.workspaceRoot,
      S6_ENV_DIR: fixture.s6EnvDir,
      KORTIX_MASTER_PORT: String(port),
      OPENCODE_HOST: '127.0.0.1',
      OPENCODE_PORT: String(port + 1000),
      KORTIX_DISABLE_CORE_SUPERVISOR: 'true',
      KORTIX_DISABLE_AUTH_SYNC: 'true',
      ...extraEnv,
    },
  })

  proc.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (text) console.error('Server error:', text)
  })

  await waitForHttp(`http://127.0.0.1:${port}/docs`)

  return {
    process: proc,
    stop: async () => {
      if (!proc.killed) proc.kill()
      await new Promise((resolve) => setTimeout(resolve, 300))
    },
  }
}
