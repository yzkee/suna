/**
 * Sandbox toolbox test utility.
 *
 * Usage:
 *   bun run test-exec.ts status <sandboxId>
 *   bun run test-exec.ts update <sandboxId> <version>
 *   bun run test-exec.ts downgrade <sandboxId> <version>
 *   bun run test-exec.ts exec <sandboxId> <command>
 *   bun run test-exec.ts script <sandboxId>           # show start script image
 *   bun run test-exec.ts verify <sandboxId>           # full diagnostic
 */

import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from './src/shared/db';
import { getProvider, type ProviderName } from './src/platform/providers';
import { JustAVPSProvider } from './src/platform/providers/justavps';

type Endpoint = { url: string; headers: Record<string, string> };

function toBase64(str: string): string {
  return Buffer.from(str).toString('base64');
}

function imageForVersion(version: string): string {
  return `kortix/computer:${version}`;
}

async function exec(endpoint: Endpoint, command: string, timeout = 60) {
  const url = `${endpoint.url}/toolbox/process/execute`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...endpoint.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, timeout }),
    signal: AbortSignal.timeout((timeout + 15) * 1000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { exit_code: -1, stdout: '', stderr: `HTTP ${resp.status}: ${text}`, duration_ms: 0 };
  }
  return (await resp.json()) as { exit_code: number; stdout: string; stderr: string; duration_ms: number };
}

async function resolveEndpoint(sandboxId: string): Promise<{ endpoint: Endpoint; row: any }> {
  const [row] = await db.select().from(sandboxes).where(eq(sandboxes.sandboxId, sandboxId)).limit(1);
  if (!row) { console.error('Sandbox not found:', sandboxId); process.exit(1); }
  const provider = getProvider(row.provider as ProviderName) as JustAVPSProvider;
  const endpoint = await provider.resolveEndpoint(row.externalId!);
  return { endpoint, row };
}

async function getCurrentImage(endpoint: Endpoint): Promise<string> {
  const r = await exec(endpoint, "docker inspect --format='{{.Config.Image}}' justavps-workload");
  return r.stdout?.trim().replace(/'/g, '') ?? '';
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdStatus(sandboxId: string) {
  const { endpoint, row } = await resolveEndpoint(sandboxId);
  const image = await getCurrentImage(endpoint);
  const version = image.split(':').pop() ?? 'unknown';

  console.log('Sandbox:', sandboxId);
  console.log('External ID:', row.externalId);
  console.log('Provider:', row.provider);
  console.log('Base URL:', row.baseUrl);
  console.log('Running image:', image);
  console.log('Version:', version);

  const imageId = await exec(endpoint, "docker inspect --format='{{.Image}}' justavps-workload");
  console.log('Image SHA:', imageId.stdout?.trim());

  const uptime = await exec(endpoint, "docker inspect --format='{{.State.StartedAt}}' justavps-workload");
  console.log('Started at:', uptime.stdout?.trim());
}

async function cmdUpdate(sandboxId: string, targetVersion: string) {
  const { endpoint } = await resolveEndpoint(sandboxId);
  const currentImage = await getCurrentImage(endpoint);
  const currentVersion = currentImage.split(':').pop()!;
  const targetImage = imageForVersion(targetVersion);

  if (currentImage === targetImage) {
    console.log('Already running', targetImage);
    return;
  }

  console.log(`Updating ${currentVersion} → ${targetVersion}`);

  // Pull
  console.log('Pulling', targetImage, '...');
  const pull = await exec(endpoint, `docker pull ${targetImage}`, 300);
  if (pull.exit_code !== 0) { console.error('Pull failed:', pull.stderr); return; }
  console.log('Pull: OK');

  // Patch start script
  const oldBase64 = toBase64(imageForVersion(currentVersion));
  const newBase64 = toBase64(targetImage);
  const patch = await exec(endpoint, `sed -i "s|${oldBase64}|${newBase64}|" /usr/local/bin/justavps-docker-start.sh`);
  if (patch.exit_code !== 0) { console.error('Patch failed:', patch.stderr); return; }

  const verify = await exec(endpoint, `grep -c '${newBase64}' /usr/local/bin/justavps-docker-start.sh`);
  if (verify.stdout?.trim() !== '1') { console.error('Patch did not apply — base64 not found in script'); return; }
  console.log('Patch: OK');

  // Restart
  const unitName = `justavps-update-${Date.now()}`;
  // Checkpoint SQLite WAL before stopping
  await exec(endpoint, `docker exec justavps-workload python3 -c "import sqlite3,glob
for db in glob.glob('/workspace/.local/share/opencode/*.db'):
 c=sqlite3.connect(db);c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()" 2>/dev/null || true`, 10);

  const script = "docker stop -t 10 justavps-workload 2>/dev/null || docker rm -f justavps-workload 2>/dev/null || true && fuser -k 3456/tcp 2>/dev/null || true && systemctl restart justavps-docker";
  const restart = await exec(endpoint, `systemd-run --unit=${unitName} bash -c '${script}'`, 15);
  console.log('Restart:', restart.exit_code === 0 ? 'OK' : restart.stderr);

  // Wait
  console.log('Waiting for container...');
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const running = await getCurrentImage(endpoint);
    console.log(`  Attempt ${i + 1}: ${running || '(not running)'}`);
    if (running === targetImage) {
      console.log(`Done — now running ${targetVersion}`);
      return;
    }
  }
  console.error('Timed out waiting for container');
}

async function cmdExec(sandboxId: string, command: string) {
  const { endpoint } = await resolveEndpoint(sandboxId);
  const result = await exec(endpoint, command);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exit_code);
}

async function cmdScript(sandboxId: string) {
  const { endpoint } = await resolveEndpoint(sandboxId);
  const r = await exec(endpoint, "grep -oP \"printf '%s' '\\K[^']+\" /usr/local/bin/justavps-docker-start.sh | head -1");
  const b64 = r.stdout?.trim();
  if (!b64) { console.log('No base64 image found in start script'); return; }
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  console.log('Base64 in script:', b64);
  console.log('Decoded image:', decoded);
}

async function cmdVerify(sandboxId: string) {
  const { endpoint, row } = await resolveEndpoint(sandboxId);

  console.log('=== Sandbox Info ===');
  console.log('ID:', sandboxId);
  console.log('External:', row.externalId);
  console.log('Provider:', row.provider);
  console.log('Endpoint:', endpoint.url);

  console.log('\n=== Running Container ===');
  const image = await getCurrentImage(endpoint);
  console.log('Image:', image);

  const imageId = await exec(endpoint, "docker inspect --format='{{.Image}}' justavps-workload");
  console.log('SHA:', imageId.stdout?.trim());

  console.log('\n=== Start Script ===');
  const scriptB64 = await exec(endpoint, "grep -oP \"printf '%s' '\\K[^']+\" /usr/local/bin/justavps-docker-start.sh | head -1");
  const b64 = scriptB64.stdout?.trim();
  if (b64) {
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');
    console.log('Script image:', decoded);
    console.log('Matches running:', decoded === image ? 'YES' : `NO (running: ${image})`);
  } else {
    console.log('Could not read script base64');
  }

  console.log('\n=== Local Images ===');
  const images = await exec(endpoint, "docker images kortix/computer --format '{{.Tag}} {{.ID}}' | head -5");
  console.log(images.stdout?.trim());

  console.log('\n=== Disk ===');
  const disk = await exec(endpoint, "df -h / | tail -1");
  console.log(disk.stdout?.trim());

  console.log('\n=== Docker Disk ===');
  const dockerDisk = await exec(endpoint, "docker system df --format '{{.Type}}: {{.Size}} (reclaimable: {{.Reclaimable}})'");
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
  bun run test-exec.ts script    <sandboxId>
  bun run test-exec.ts verify    <sandboxId>`);
  process.exit(1);
}

const handlers: Record<string, () => Promise<void>> = {
  status: () => cmdStatus(sandboxId),
  update: () => cmdUpdate(sandboxId, rest[0]!),
  downgrade: () => cmdUpdate(sandboxId, rest[0]!),
  exec: () => cmdExec(sandboxId, rest.join(' ')),
  script: () => cmdScript(sandboxId),
  verify: () => cmdVerify(sandboxId),
};

const handler = handlers[command];
if (!handler) {
  console.error('Unknown command:', command);
  process.exit(1);
}

handler().catch(console.error).finally(() => process.exit(0));
