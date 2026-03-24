#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const RELEASE_JSON = path.join(ROOT, 'sandbox', 'release.json')
const API_ENV_PATH = path.join(ROOT, 'kortix-api', '.env')

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const versionArg = args.find((arg) => !arg.startsWith('--') && /^\d+\.\d+\.\d+$/.test(arg))

const FORCE = flags.has('--yes') || flags.has('--force') || flags.has('-y')
const DRY_RUN = flags.has('--dry-run')
const HELP = flags.has('--help') || flags.has('-h')
const NO_VERIFY = flags.has('--no-verify')

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const C = '\x1b[36m'
const B = '\x1b[1m'
const X = '\x1b[0m'

const ok = (msg) => console.log(`  ${G}✓${X} ${msg}`)
const info = (msg) => console.log(`  ${C}▸${X} ${msg}`)
const warn = (msg) => console.log(`  ${Y}!${X} ${msg}`)
const fail = (msg) => {
  console.error(`  ${R}✗${X} ${msg}`)
  process.exit(1)
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const rawValue = trimmed.slice(idx + 1)
    if (!(key in process.env)) process.env[key] = rawValue
  }
}

function writeEnvValue(filePath, key, value) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const lines = content.split(/\r?\n/)
  let found = false
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true
      return `${key}=${value}`
    }
    return line
  })
  if (!found) nextLines.push(`${key}=${value}`)
  fs.writeFileSync(filePath, `${nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line === '')).join('\n')}\n`)
}

function getRequiredEnv(key) {
  const value = process.env[key]
  if (!value) fail(`Missing ${key}`)
  return value
}

function getVersion() {
  if (versionArg) return versionArg
  const release = JSON.parse(fs.readFileSync(RELEASE_JSON, 'utf8'))
  return release.version
}

if (HELP) {
  console.log(`
Usage:
  pnpm image [version]            Build a JustAVPS image for the release version
  pnpm image --dry-run [version]  Validate config without creating resources
  pnpm image --yes [version]      Replace any existing image with the same release name
  pnpm image --no-verify [version]  Skip booting a verification machine from the new image

Env used from kortix-api/.env:
  JUSTAVPS_API_URL
  JUSTAVPS_API_KEY
  JUSTAVPS_IMAGE_ID
  JUSTAVPS_DEFAULT_SERVER_TYPE
  JUSTAVPS_DEFAULT_LOCATION
  JUSTAVPS_IMAGE_BUILD_SERVER_TYPE   (optional)
  JUSTAVPS_IMAGE_BUILD_LOCATION      (optional)
`)
  process.exit(0)
}

async function api(pathname, options = {}) {
  const baseUrl = getRequiredEnv('JUSTAVPS_API_URL').replace(/\/$/, '')
  const apiKey = getRequiredEnv('JUSTAVPS_API_KEY')
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const error = new Error(`JustAVPS API ${options.method || 'GET'} ${pathname} -> ${response.status}: ${text.slice(0, 500)}`)
    error.status = response.status
    error.body = text
    throw error
  }

  if (response.status === 204) return null
  return response.json()
}

async function waitForMachineReady(machineId, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const machine = await api(`/machines/${machineId}`)
    if (machine.status === 'ready') return machine
    if (machine.status === 'error' || machine.status === 'deleted') {
      throw new Error(`Build machine ${machineId} entered '${machine.status}' state`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error(`Build machine ${machineId} did not become ready within ${Math.floor(timeoutMs / 1000)}s`)
}

async function waitForImageReady(imageId, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const image = await api(`/images/${imageId}`)
    if (image.status === 'ready' && image.provider_image_id) return image
    if (image.status === 'failed' || image.status === 'deleted') {
      const detail = image.description ? `: ${image.description}` : ''
      throw new Error(`Image ${imageId} entered '${image.status}' state${detail}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error(`Image ${imageId} did not become ready within ${Math.floor(timeoutMs / 1000)}s`)
}

async function deleteImageIfPresent(imageId) {
  if (!imageId) return
  try {
    await api(`/images/${imageId}`, { method: 'DELETE' })
    ok(`Deleted previous JustAVPS image ${imageId}`)
  } catch (error) {
    warn(`Failed to delete previous image ${imageId}: ${error.message}`)
  }
}

async function deleteMachineIfPresent(machineId) {
  if (!machineId) return
  try {
    await api(`/machines/${machineId}`, { method: 'DELETE' })
    ok(`Deleted machine ${machineId}`)
  } catch (error) {
    warn(`Failed to delete machine ${machineId}: ${error.message}`)
  }
}

async function main() {
  loadDotEnv(API_ENV_PATH)

  const version = getVersion()
  const dockerImage = `kortix/computer:${version}`
  const buildServerType = process.env.JUSTAVPS_IMAGE_BUILD_SERVER_TYPE || process.env.JUSTAVPS_DEFAULT_SERVER_TYPE || 'cpx31'
  const buildRegion = process.env.JUSTAVPS_IMAGE_BUILD_LOCATION || 'nbg1'
  const imageName = `kortix-computer-v${version}`
  const previousImageId = process.env.JUSTAVPS_IMAGE_ID || ''
  const machineTimeoutMs = Number(process.env.JUSTAVPS_IMAGE_BUILD_TIMEOUT_MS || 15 * 60 * 1000)
  const imageTimeoutMs = Number(process.env.JUSTAVPS_IMAGE_CREATE_TIMEOUT_MS || 15 * 60 * 1000)

  console.log('')
  console.log(`  ${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}`)
  console.log(`  ${B}Build JustAVPS Image v${version}${DRY_RUN ? ' [dry-run]' : ''}${X}`)
  console.log(`  ${B}Image Name:${X} ${imageName}`)
  console.log(`  ${B}Docker:${X}     ${dockerImage}`)
  console.log(`  ${B}Builder:${X}    ${buildServerType} @ ${buildRegion}`)
  console.log(`  ${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}`)
  console.log('')

  const images = await api('/images')
  const conflicting = (images.images || []).filter((image) => image.name === imageName && image.status !== 'deleted' && !image.is_template)
  if (conflicting.length > 0 && !FORCE && !DRY_RUN) {
    fail(`Image '${imageName}' already exists (${conflicting.map((img) => img.id).join(', ')}). Re-run with --yes to replace it.`)
  }

  if (DRY_RUN) {
    if (conflicting.length > 0) {
      warn(`Dry run: image '${imageName}' already exists (${conflicting.map((img) => img.id).join(', ')}). --yes would replace it.`)
    }
    ok('Dry run complete — configuration looks valid')
    return
  }

  for (const image of conflicting) {
    info(`Deleting existing image ${image.id} (${image.name})...`)
    await api(`/images/${image.id}`, { method: 'DELETE' })
    ok(`Deleted ${image.id}`)
  }

  let machineId = ''

  try {
    info('Creating temporary JustAVPS build machine...')
    const machine = await api('/machines', {
      method: 'POST',
      body: {
        provider: 'cloud',
        server_type: buildServerType,
        region: buildRegion,
        name: `kortix-image-builder-${version}`,
        docker_image: dockerImage,
        env_vars: {
          ENV_MODE: 'cloud',
          KORTIX_SANDBOX_VERSION: version,
        },
      },
    })

    if (!machine?.id) {
      fail('JustAVPS did not return a machine id')
    }
    machineId = machine.id
    ok(`Build machine created: ${machineId}`)

    info('Waiting for build machine to become ready...')
    const readyMachine = await waitForMachineReady(machineId, machineTimeoutMs)
    ok(`Build machine ready${readyMachine.ip ? ` (${readyMachine.ip})` : ''}`)

    info('Creating JustAVPS image from build machine...')
    const image = await api(`/machines/${machineId}/image`, {
      method: 'POST',
      body: { name: imageName },
    })

    if (!image?.id) {
      fail('JustAVPS did not return an image id')
    }
    ok(`Image creation started: ${image.id}`)

    info('Waiting for image to become ready...')
    const readyImage = await waitForImageReady(image.id, imageTimeoutMs)
    ok(`Image ready: ${readyImage.id} (provider image ${readyImage.provider_image_id})`)

    info(`Deleting temporary build machine ${machineId}...`)
    await deleteMachineIfPresent(machineId)
    machineId = ''

    if (!NO_VERIFY) {
      info('Verifying the new image by booting a fresh JustAVPS machine...')
      const verifyMachine = await api('/machines', {
        method: 'POST',
        body: {
          provider: 'cloud',
          image_id: readyImage.id,
          server_type: buildServerType,
          region: buildRegion,
          name: `kortix-image-verify-${version}`,
          docker_image: dockerImage,
          env_vars: {
            ENV_MODE: 'cloud',
            KORTIX_SANDBOX_VERSION: version,
          },
        },
      })
      if (!verifyMachine?.id) {
        fail('JustAVPS did not return a verification machine id')
      }
      const verifyMachineId = verifyMachine.id
      ok(`Verification machine created: ${verifyMachineId}`)
      try {
        const readyVerifyMachine = await waitForMachineReady(verifyMachineId, machineTimeoutMs)
        ok(`Verification machine ready${readyVerifyMachine.ip ? ` (${readyVerifyMachine.ip})` : ''}`)
      } finally {
        info(`Deleting verification machine ${verifyMachineId}...`)
        await deleteMachineIfPresent(verifyMachineId)
      }
    }

    writeEnvValue(API_ENV_PATH, 'JUSTAVPS_IMAGE_ID', readyImage.id)
    ok(`Updated kortix-api/.env → JUSTAVPS_IMAGE_ID=${readyImage.id}`)

    if (previousImageId && previousImageId !== readyImage.id) {
      info(`Deleting previously configured image ${previousImageId}...`)
      await deleteImageIfPresent(previousImageId)
    }

    console.log('')
    console.log(`  ${G}${B}✓ JustAVPS image ready${X}`)
    console.log(`  ${B}JustAVPS Image ID:${X} ${readyImage.id}`)
    console.log(`  ${B}Provider Image ID:${X} ${readyImage.provider_image_id}`)
    console.log(`  ${B}Note:${X} Restart any running kortix-api dev process to pick up the updated env.`)
    console.log('')
  } finally {
    if (machineId) {
      info(`Deleting temporary build machine ${machineId}...`)
      await deleteMachineIfPresent(machineId)
    }
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
