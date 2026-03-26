import type { ResolvedEndpoint } from '../platform/providers';
import type { StepResult } from './types';
import { execOnHost } from './exec';

export function getCurrentImage(endpoint: ResolvedEndpoint, containerName: string): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `docker inspect --format='{{.Config.Image}}' ${containerName}`,
    10,
  );
}

export function pullImage(endpoint: ResolvedEndpoint, image: string): Promise<StepResult> {
  return execOnHost(endpoint, `docker pull ${image}`, 300);
}

export async function checkpointSqlite(endpoint: ResolvedEndpoint, containerName: string): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `docker exec ${containerName} python3 -c "import sqlite3,glob
for db in glob.glob('/workspace/.local/share/opencode/*.db'):
 c=sqlite3.connect(db);c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()" 2>/dev/null || true`,
    10,
  );
}

export async function stopAndStartContainer(
  endpoint: ResolvedEndpoint,
  containerName: string,
  runCommand: string,
): Promise<StepResult> {
  const scriptLines = [
    '#!/bin/bash',
    'set -e',
    'systemctl stop justavps-docker 2>/dev/null || true',
    'systemctl stop kortix-sandbox 2>/dev/null || true',
    `docker stop -t 10 ${containerName} 2>/dev/null || true`,
    `docker rm -f ${containerName} 2>/dev/null || true`,
    runCommand,
  ].join('\n');

  const b64 = Buffer.from(scriptLines).toString('base64');

  // Write script to temp file, then run it via systemd-run (survives connection drop)
  await execOnHost(
    endpoint,
    `echo '${b64}' | base64 -d > /tmp/kortix-update.sh && chmod +x /tmp/kortix-update.sh`,
    5,
  );

  const result = await execOnHost(
    endpoint,
    `systemd-run --unit=kortix-update-restart --description="Kortix sandbox update" /tmp/kortix-update.sh`,
    15,
  );

  if (!result.success && (result.stderr.includes('502') || result.stderr.includes('aborted') || result.stderr.includes('timed out'))) {
    return { success: true, stdout: '', stderr: '', exitCode: 0, durationMs: result.durationMs };
  }
  return result;
}

export async function verifyContainer(
  endpoint: ResolvedEndpoint,
  expectedImage: string,
  containerName: string,
  retries = 15,
): Promise<StepResult> {
  for (let i = 0; i < retries; i++) {
    const result = await execOnHost(
      endpoint,
      `docker inspect --format='{{.Config.Image}}' ${containerName}`,
      10,
    );
    const running = result.stdout.trim().replace(/'/g, '');
    if (result.success && running === expectedImage) return result;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return {
    success: false,
    stdout: '',
    stderr: `Container not running expected image ${expectedImage} after ${retries} retries`,
    exitCode: -1,
    durationMs: 0,
  };
}
