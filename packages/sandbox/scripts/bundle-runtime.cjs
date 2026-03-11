#!/usr/bin/env node
/**
 * bundle-runtime.cjs — Vendor runtime source packages into sandbox
 *
 * Copies kortix-oc, opencode-channels, and opencode-agent-triggers source
 * into packages/sandbox/vendor/ so they're bundled with @kortix/sandbox.
 *
 * Called by:
 *   - The Dockerfile prebake step (before npm install → postinstall.sh)
 *   - pnpm ship (before creating the OTA tarball)
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const sandboxRoot = path.resolve(__dirname, '..')
const sourceRoot = path.resolve(sandboxRoot, '..')
const vendorRoot = path.join(sandboxRoot, 'vendor')

const COPY_IGNORE = new Set([
  'node_modules', '.git', '.DS_Store', 'bun.lock', '.opencode',
])

function rm(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function copyDir(sourceDir, targetDir) {
  rm(targetDir)
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  const excludes = [
    '--exclude=node_modules', '--exclude=.git', '--exclude=.DS_Store',
    '--exclude=bun.lock', '--exclude=.opencode', '--exclude=*.tgz',
  ]
  try {
    execFileSync('rsync', ['-a', '--delete', ...excludes, `${sourceDir}/`, targetDir], { stdio: 'inherit' })
    return
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
  fs.mkdirSync(targetDir, { recursive: true })
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter(source) {
      const name = path.basename(source)
      if (name.endsWith('.tgz')) return false
      return !COPY_IGNORE.has(name)
    },
  })
}

function rewriteJson(filePath, updater) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const next = updater(json)
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`)
}

// Vendor source packages into sandbox/vendor/
copyDir(path.join(sourceRoot, 'kortix-oc'), path.join(vendorRoot, 'kortix-oc'))
copyDir(path.join(sourceRoot, 'opencode-channels'), path.join(vendorRoot, 'opencode-channels'))
copyDir(path.join(sourceRoot, 'opencode-agent-triggers'), path.join(vendorRoot, 'opencode-agent-triggers'))

// Wire file: dependency references
rewriteJson(path.join(sandboxRoot, 'kortix-master', 'package.json'), (pkg) => {
  pkg.dependencies['@kortix/opencode-agent-triggers'] = 'file:./vendor/opencode-agent-triggers'
  return pkg
})

copyDir(
  path.join(sourceRoot, 'opencode-agent-triggers'),
  path.join(sandboxRoot, 'kortix-master', 'vendor', 'opencode-agent-triggers'),
)

rewriteJson(path.join(vendorRoot, 'kortix-oc', 'runtime', 'package.json'), (pkg) => {
  pkg.dependencies['@kortix/opencode-agent-triggers'] = 'file:../opencode-agent-triggers'
  return pkg
})

console.log('[bundle-runtime] Synced sandbox runtime vendors from source packages')
