/**
 * Sandbox toolbox test utility.
 *
 * Usage:
 *   bun run test-exec.ts status    <sandboxId>
 *   bun run test-exec.ts update    <sandboxId> <version>
 *   bun run test-exec.ts downgrade <sandboxId> <version>   (alias for update)
 *   bun run test-exec.ts exec      <sandboxId> <command>
 *   bun run test-exec.ts config    <sandboxId>             # show container config
 *   bun run test-exec.ts verify    <sandboxId>             # full diagnostic
 */

import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from './src/shared/db';
import { getProvider, type ProviderName } from './src/platform/providers';
import { execOnHost } from './src/update/exec';
import {
  readContainerConfig,
  writeContainerConfig,
  buildFromInspect,
  buildDockerRunCommand,
  type ContainerConfig,
} from './src/update/container-config';
import type { ResolvedEndpoint } from './src/platform/providers';

async function resolveEndpoint(sandboxId: string): Promise<{ endpoint: ResolvedEndpoint; row: any }> {
  const [row] = await db.select().from(sandboxes).where(eq(sandboxes.sandboxId, sandboxId)).limit(1);
  if (!row) { console.error('Sandbox not found:', sandboxId); process.exit(1); }
  const provider = getProvider(row.provider as ProviderName);
  const endpoint = await provider.resolveEndpoint(row.externalId!);
  return { endpoint, row };
}

async function getConfig(endpoint: ResolvedEndpoint): Promise<ContainerConfig> {
  const fromFile = await readContainerConfig(endpoint);
  if (fromFile) return fromFile;
  const fromInspect = await buildFromInspect(endpoint);
  if (fromInspect) {
    await writeContainerConfig(endpoint, fromInspect);
    console.log('(migrated legacy container to config file)');
    return fromInspect;
  }
  throw new Error('No container config found');
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdStatus(sandboxId: string) {
  const { endpoint, row } = await resolveEndpoint(sandboxId);
  const config = await getConfig(endpoint);

  console.log('Sandbox:', sandboxId);
  console.log('External ID:', row.externalId);
  console.log('Provider:', row.provider);
  console.log('Container:', config.name);
  console.log('Image:', config.image);

  const imageId = await execOnHost(endpoint, `docker inspect --format='{{.Image}}' ${config.name}`, 10);
  console.log('Image SHA:', imageId.stdout?.trim());

  const uptime = await execOnHost(endpoint, `docker inspect --format='{{.State.StartedAt}}' ${config.name}`, 10);
  console.log('Started at:', uptime.stdout?.trim());
}

async function cmdUpdate(sandboxId: string, targetVersion: string) {
  const { endpoint } = await resolveEndpoint(sandboxId);
  const config = await getConfig(endpoint);
  const currentVersion = config.image.split(':').pop()!;

  const base = config.image.split(':')[0];
  const targetImage = `${base}:${targetVersion}`;

  if (config.image === targetImage) {
    console.log('Already running', targetImage);
    return;
  }

  console.log(`Updating ${currentVersion} → ${targetVersion}`);

  // Pull (skip if already cached locally)
  const exists = await execOnHost(endpoint, `docker image inspect ${targetImage} >/dev/null 2>&1 && echo cached`, 10);
  if (exists.stdout?.trim() === 'cached') {
    console.log('Image already cached locally, skipping pull');
  } else {
    console.log('Pulling', targetImage, '(detached)...');
    await execOnHost(endpoint, `systemd-run --unit=kortix-image-pull docker pull ${targetImage}`, 15);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await execOnHost(endpoint, `docker image inspect ${targetImage} >/dev/null 2>&1 && echo ready`, 10);
      if (check.stdout?.trim() === 'ready') { console.log('Pull: OK'); break; }
      if (i === 59) { console.error('Pull timed out'); return; }
      process.stdout.write('.');
    }
  }

  // Checkpoint
  console.log('Checkpointing SQLite...');
  await execOnHost(endpoint, `docker exec ${config.name} python3 -c "import sqlite3,glob
for db in glob.glob('/workspace/.local/share/opencode/*.db'):
 c=sqlite3.connect(db);c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()" 2>/dev/null || true`, 10);

  // Stop + start as one detached unit (survives connection drop)
  console.log('Stopping and restarting...');
  const updatedConfig: ContainerConfig = { ...config, image: targetImage };
  const runCmd = buildDockerRunCommand(updatedConfig);
  const scriptLines = [
    '#!/bin/bash',
    'set -e',
    'systemctl disable --now justavps-docker 2>/dev/null || true',
    'systemctl disable --now kortix-sandbox 2>/dev/null || true',
    `docker stop -t 10 ${config.name} 2>/dev/null || true`,
    `docker rm -f ${config.name} 2>/dev/null || true`,
    `for i in $(seq 1 10); do docker inspect ${config.name} >/dev/null 2>&1 || break; sleep 1; done`,
    runCmd,
  ].join('\n');
  const b64 = Buffer.from(scriptLines).toString('base64');
  await execOnHost(endpoint, `echo '${b64}' | base64 -d > /tmp/kortix-update.sh && chmod +x /tmp/kortix-update.sh`, 5);
  const unitName = `kortix-test-${Date.now()}`;
  await execOnHost(endpoint, `systemctl reset-failed kortix-test-restart 2>/dev/null || true`, 5);
  const restart = await execOnHost(endpoint, `systemd-run --unit=${unitName} /tmp/kortix-update.sh`, 15);
  console.log('Restart:', restart.exitCode === 0 ? 'OK' : '(expected — connection dropped)');

  // Wait
  console.log('Waiting for container...');
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await execOnHost(endpoint, `docker inspect --format='{{.Config.Image}}' ${updatedConfig.name}`, 10);
    const running = check.stdout?.trim().replace(/'/g, '');
    console.log(`  Attempt ${i + 1}: ${running || '(not running)'}`);
    if (check.exitCode === 0 && running === targetImage) {
      await writeContainerConfig(endpoint, updatedConfig);
      console.log(`Done — now running ${targetVersion}`);
      return;
    }
  }
  console.error('Timed out waiting for container');
}

async function cmdExec(sandboxId: string, command: string) {
  const { endpoint } = await resolveEndpoint(sandboxId);
  const result = await execOnHost(endpoint, command);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

async function cmdConfig(sandboxId: string) {
  const { endpoint } = await resolveEndpoint(sandboxId);
  const config = await getConfig(endpoint);
  console.log(JSON.stringify(config, null, 2));
}

async function cmdVerify(sandboxId: string) {
  const { endpoint, row } = await resolveEndpoint(sandboxId);

  console.log('=== Sandbox Info ===');
  console.log('ID:', sandboxId);
  console.log('External:', row.externalId);
  console.log('Provider:', row.provider);

  console.log('\n=== Container Config ===');
  const config = await getConfig(endpoint);
  console.log('Name:', config.name);
  console.log('Image:', config.image);
  console.log('Volumes:', config.volumes.join(', '));
  console.log('Ports:', config.ports.length, 'mapped');

  console.log('\n=== Running Container ===');
  const imageId = await execOnHost(endpoint, `docker inspect --format='{{.Image}}' ${config.name}`, 10);
  console.log('SHA:', imageId.stdout?.trim());

  console.log('\n=== Local Images ===');
  const base = config.image.split(':')[0];
  const images = await execOnHost(endpoint, `docker images ${base} --format '{{.Tag}} {{.ID}}' | head -5`, 10);
  console.log(images.stdout?.trim());

  console.log('\n=== Disk ===');
  const disk = await execOnHost(endpoint, 'df -h / | tail -1', 10);
  console.log(disk.stdout?.trim());

  console.log('\n=== Docker Disk ===');
  const dockerDisk = await execOnHost(endpoint, "docker system df --format '{{.Type}}: {{.Size}} (reclaimable: {{.Reclaimable}})'", 10);
  console.log(dockerDisk.stdout?.trim());
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const [command, sandboxId, ...rest] = process.argv.slice(2);

if (!command || !sandboxId) {
  console.log(`Usage:
  bun run test-exec.ts status    <sandboxId>
  bun run test-exec.ts update    <sandboxId> <version>
  bun run test-exec.ts downgrade <sandboxId> <version>   (alias for update)
  bun run test-exec.ts exec      <sandboxId> <command>
  bun run test-exec.ts config    <sandboxId>
  bun run test-exec.ts verify    <sandboxId>`);
  process.exit(1);
}

const handlers: Record<string, () => Promise<void>> = {
  status: () => cmdStatus(sandboxId),
  update: () => cmdUpdate(sandboxId, rest[0]!),
  downgrade: () => cmdUpdate(sandboxId, rest[0]!),
  exec: () => cmdExec(sandboxId, rest.join(' ')),
  config: () => cmdConfig(sandboxId),
  verify: () => cmdVerify(sandboxId),
};

const handler = handlers[command];
if (!handler) {
  console.error('Unknown command:', command);
  process.exit(1);
}

handler().catch(console.error).finally(() => process.exit(0));
