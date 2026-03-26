import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../shared/db';
import { config } from '../config';
import { getProvider, type ProviderName } from '../platform/providers';
import { JustAVPSProvider, justavpsFetch } from '../platform/providers/justavps';
import { setPhase, clearUpdateStatus } from './status';
import {
  getCurrentImage,
  pullImage,
  patchStartScript,
  checkpointSqlite,
  stopAndRestart,
  verifyContainer,
} from './steps';

function imageForVersion(version: string): string {
  const current = config.SANDBOX_IMAGE;
  const colonIdx = current.lastIndexOf(':');
  const base = colonIdx > 0 ? current.slice(0, colonIdx) : current;
  return `${base}:${version}`;
}

function toBase64(str: string): string {
  return Buffer.from(str).toString('base64');
}

export async function executeUpdate(sandboxId: string, targetVersion: string): Promise<void> {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.sandboxId, sandboxId))
    .limit(1);

  if (!row) throw new Error('Sandbox not found');
  if (row.provider !== 'justavps') throw new Error('Update only supported for justavps sandboxes');
  if (!row.externalId) throw new Error('Sandbox has no external ID');

  const provider = getProvider(row.provider as ProviderName) as JustAVPSProvider;
  const endpoint = await provider.resolveEndpoint(row.externalId);
  const targetImage = imageForVersion(targetVersion);

  try {
    const currentResult = await getCurrentImage(endpoint);
    const inspectImage = currentResult.success ? currentResult.stdout.trim().replace(/'/g, '') : null;
    const previousVersion = inspectImage?.split(':').pop() ?? null;

    // ── Backup ──
    await setPhase(sandboxId, 'backing_up', 5, 'Creating backup...', {
      targetVersion,
      previousVersion,
      currentVersion: previousVersion,
      error: null,
      startedAt: new Date().toISOString(),
    });
    try {
      await justavpsFetch(`/machines/${row.externalId}/backups`, { method: 'POST' });
      console.log(`[UPDATE] Backup created for machine ${row.externalId}`);
    } catch (err) {
      console.warn(`[UPDATE] Backup failed (non-fatal):`, err instanceof Error ? err.message : err);
    }

    // ── Pull ──
    await setPhase(sandboxId, 'pulling', 15, `Pulling ${targetImage}...`);

    const pullResult = await pullImage(endpoint, targetImage);
    if (!pullResult.success) throw new Error(`Pull failed: ${pullResult.stderr}`);

    // ── Patch start script ──
    await setPhase(sandboxId, 'patching', 30, 'Patching start script...');

    const oldImage = previousVersion ? imageForVersion(previousVersion) : null;
    const oldBase64 = oldImage ? toBase64(oldImage) : null;
    const newBase64 = toBase64(targetImage);

    if (oldBase64) {
      const patchResult = await patchStartScript(endpoint, oldBase64, newBase64);
      if (!patchResult.success) throw new Error(`Patch script failed: ${patchResult.stderr}`);
    }

    // ── Checkpoint & stop ──
    await setPhase(sandboxId, 'stopping', 50, 'Saving state and stopping sandbox...');
    await checkpointSqlite(endpoint);

    await setPhase(sandboxId, 'restarting', 55, 'Restarting sandbox...');
    const restartResult = await stopAndRestart(endpoint);
    if (!restartResult.success) {
      console.warn(`[UPDATE] Restart warning (may be expected 502): ${restartResult.stderr}`);
    }

    // ── Verify ──
    await setPhase(sandboxId, 'verifying', 80, 'Verifying new container...');
    const verifyResult = await verifyContainer(endpoint, targetImage);
    if (!verifyResult.success) throw new Error(`Verify failed: ${verifyResult.stderr}`);

    // ── Complete ──
    await setPhase(sandboxId, 'complete', 100, `Updated to v${targetVersion}`, {
      currentVersion: targetVersion,
    });

    console.log(`[UPDATE] Sandbox ${sandboxId} updated to ${targetImage}`);

    setTimeout(async () => {
      try { await clearUpdateStatus(sandboxId, targetVersion); } catch {}
    }, 30_000);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await setPhase(sandboxId, 'failed', 0, `Update failed: ${errorMsg}`, { error: errorMsg });
    console.error(`[UPDATE] Sandbox ${sandboxId} update failed:`, errorMsg);
    throw err;
  }
}
