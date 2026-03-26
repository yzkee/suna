import type { ResolvedEndpoint } from '../platform/providers';
import type { StepResult } from './types';
import { execOnHost } from './exec';

export function getCurrentImage(endpoint: ResolvedEndpoint): Promise<StepResult> {
  return execOnHost(
    endpoint,
    "docker inspect --format='{{.Config.Image}}' justavps-workload",
    10,
  );
}

export function pullImage(endpoint: ResolvedEndpoint, image: string): Promise<StepResult> {
  return execOnHost(endpoint, `docker pull ${image}`, 300);
}

export function patchStartScript(
  endpoint: ResolvedEndpoint,
  oldBase64: string,
  newBase64: string,
): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `sed -i "s|${oldBase64}|${newBase64}|" /usr/local/bin/justavps-docker-start.sh`,
    10,
  );
}

export async function checkpointSqlite(endpoint: ResolvedEndpoint): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `docker exec justavps-workload python3 -c "import sqlite3,glob
for db in glob.glob('/workspace/.local/share/opencode/*.db'):
 c=sqlite3.connect(db);c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()" 2>/dev/null || true`,
    10,
  );
}

export async function stopAndRestart(endpoint: ResolvedEndpoint): Promise<StepResult> {
  const script = [
    'docker stop -t 10 justavps-workload 2>/dev/null || docker rm -f justavps-workload 2>/dev/null || true',
    'fuser -k 3456/tcp 2>/dev/null || true',
    'systemctl restart justavps-docker',
  ].join(' && ');

  const result = await execOnHost(
    endpoint,
    `systemd-run --unit=justavps-update-restart --description="Sandbox update restart" bash -c '${script}'`,
    15,
  );

  if (!result.success && (result.stderr.includes('502') || result.stderr.includes('aborted'))) {
    return { success: true, stdout: '', stderr: '', exitCode: 0, durationMs: result.durationMs };
  }
  return result;
}

export async function verifyContainer(
  endpoint: ResolvedEndpoint,
  expectedImage: string,
  retries = 10,
): Promise<StepResult> {
  for (let i = 0; i < retries; i++) {
    const result = await execOnHost(
      endpoint,
      "docker inspect --format='{{.Config.Image}}' justavps-workload",
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
