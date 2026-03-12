import { execFile } from 'node:child_process'
import { access, cp, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { Hono } from 'hono'

const marketplaceRouter = new Hono()
const execFileAsync = promisify(execFile)

const KORTIX_MARKETPLACE_NAMESPACE = 'kortix'
const KORTIX_MARKETPLACE_REGISTRY_URL = 'https://master.kortix-registry.pages.dev'

function getWorkspacePaths() {
  const workspaceRoot = process.env.KORTIX_WORKSPACE || '/workspace'
  const opencodeDir = path.join(workspaceRoot, '.opencode')
  return {
    workspaceRoot,
    opencodeDir,
    legacyOpencodeDir: path.join(workspaceRoot, '.kortix', '.opencode'),
    ocxConfigPath: path.join(opencodeDir, 'ocx.jsonc'),
    opencodeConfigPath: path.join(opencodeDir, 'opencode.jsonc'),
  }
}

interface InstalledComponentRecord {
  name: string
  registry?: string
}

interface OcxInstalledListResponse {
  success?: boolean
  data?: {
    components?: InstalledComponentRecord[]
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureRealWorkspaceOpencodeDir(): Promise<void> {
  const { opencodeDir, legacyOpencodeDir } = getWorkspacePaths()

  await mkdir(path.dirname(legacyOpencodeDir), { recursive: true })

  try {
    const stat = await lstat(opencodeDir)
    if (stat.isSymbolicLink()) {
      const resolved = await realpath(opencodeDir).catch(() => null)
      await rm(opencodeDir, { force: true })
      await mkdir(opencodeDir, { recursive: true })
      if (resolved) {
        await cp(resolved, opencodeDir, { recursive: true, force: false, errorOnExist: false }).catch(() => undefined)
      }
    }
  } catch {
    await mkdir(opencodeDir, { recursive: true })
  }

  if (await fileExists(legacyOpencodeDir)) {
    await cp(legacyOpencodeDir, opencodeDir, { recursive: true, force: false, errorOnExist: false }).catch(() => undefined)
  }

  await mkdir(opencodeDir, { recursive: true })
  await mkdir(path.join(opencodeDir, 'skills'), { recursive: true })
}

async function runOcx(args: string[]) {
  const { workspaceRoot } = getWorkspacePaths()
  return execFileAsync('ocx', [...args, '--cwd', workspaceRoot], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function ensureWorkspaceConfigFiles(): Promise<void> {
  const { ocxConfigPath, opencodeConfigPath } = getWorkspacePaths()
  await ensureRealWorkspaceOpencodeDir()

  const [hasOcxConfig, hasOpencodeConfig] = await Promise.all([
    fileExists(ocxConfigPath),
    fileExists(opencodeConfigPath),
  ])

  if (!hasOcxConfig || !hasOpencodeConfig) {
    await runOcx(['init'])
  }
}

async function ensureKortixRegistry(): Promise<void> {
  const { ocxConfigPath } = getWorkspacePaths()
  const configText = await readFile(ocxConfigPath, 'utf8').catch(() => '')
  const hasKortixRegistry =
    configText.includes('"kortix"') && configText.includes(KORTIX_MARKETPLACE_REGISTRY_URL)

  if (!hasKortixRegistry) {
    await runOcx([
      'registry',
      'add',
      KORTIX_MARKETPLACE_REGISTRY_URL,
      '--name',
      KORTIX_MARKETPLACE_NAMESPACE,
    ])
  }
}

async function ensureMarketplaceWorkspaceReady(): Promise<void> {
  const { opencodeDir } = getWorkspacePaths()
  await ensureWorkspaceConfigFiles()
  await mkdir(path.join(opencodeDir, 'skills'), { recursive: true })
}

async function listInstalledMarketplaceComponents(): Promise<string[]> {
  await ensureMarketplaceWorkspaceReady()
  const { stdout } = await runOcx(['list', '--installed', '--json'])
  const payload = JSON.parse(stdout) as OcxInstalledListResponse
  const components = payload.data?.components ?? []
  return components
    .filter((component) => component.name.startsWith(`${KORTIX_MARKETPLACE_NAMESPACE}/`))
    .map((component) => component.name.replace(/^kortix\//, ''))
    .sort((a, b) => a.localeCompare(b))
}

marketplaceRouter.get('/status', async (c) => {
  try {
    const { workspaceRoot, opencodeDir, ocxConfigPath, opencodeConfigPath } = getWorkspacePaths()
    await ensureMarketplaceWorkspaceReady()
    const installedComponents = await listInstalledMarketplaceComponents()
    const ocxConfigText = await readFile(ocxConfigPath, 'utf8').catch(() => '')
    const registryConfigured =
      ocxConfigText.includes('"kortix"') && ocxConfigText.includes(KORTIX_MARKETPLACE_REGISTRY_URL)

    return c.json({
      success: true,
      status: {
        workspaceRoot,
        opencodeDir,
        ocxConfigPath,
        opencodeConfigPath,
        registryUrl: KORTIX_MARKETPLACE_REGISTRY_URL,
        registryConfigured,
        installedComponents,
      },
    })
  } catch (error) {
    console.error('[Marketplace] Status error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load marketplace status' }, 500)
  }
})

marketplaceRouter.get('/installed', async (c) => {
  try {
    const components = await listInstalledMarketplaceComponents()
    return c.json({ success: true, components })
  } catch (error) {
    console.error('[Marketplace] Installed list error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list installed components' }, 500)
  }
})

marketplaceRouter.post('/install', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as {
      skillName?: string
      componentName?: string
      namespace?: string
    }

    const namespace = body.namespace || KORTIX_MARKETPLACE_NAMESPACE
    const componentName = body.skillName || body.componentName
    if (!componentName) {
      return c.json({ error: 'skillName or componentName is required' }, 400)
    }

    await ensureMarketplaceWorkspaceReady()
    await ensureKortixRegistry()
    const qualifiedName = `${namespace}/${componentName}`
    const result = await runOcx(['add', qualifiedName])

    return c.json({
      success: true,
      componentName,
      namespace,
      message: `Component ${componentName} installed successfully`,
      output: result.stdout.trim(),
      stderr: result.stderr.trim(),
    })
  } catch (error) {
    console.error('[Marketplace] Install error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Failed to install component' }, 500)
  }
})

export default marketplaceRouter
