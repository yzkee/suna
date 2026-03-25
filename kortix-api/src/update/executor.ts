import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../shared/db';
import { config } from '../config';
import { getProvider, type ProviderName } from '../platform/providers';
import { JustAVPSProvider } from '../platform/providers/justavps';
import {
  pullImage,
  patchStartScript,
  stopContainer,
  restartService,
  verifyContainer,
  getCurrentImage,
  type StepResult,
} from './steps';

export type UpdatePhase =
  | 'idle'
  | 'pulling'
  | 'stopping'
  | 'restarting'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface UpdateStatus {
  phase: UpdatePhase;
  progress: number;
  message: string;
  targetVersion: string | null;
  previousVersion: string | null;
  currentVersion: string | null;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

const IDLE_STATUS: UpdateStatus = {
  phase: 'idle',
  progress: 0,
  message: '',
  targetVersion: null,
  previousVersion: null,
  currentVersion: null,
  error: null,
  startedAt: null,
  updatedAt: null,
};

function imageForVersion(version: string): string {
  const current = config.SANDBOX_IMAGE;
  const colonIdx = current.lastIndexOf(':');
  const base = colonIdx > 0 ? current.slice(0, colonIdx) : current;
  return `${base}:${version}`;
}

function toBase64(str: string): string {
  return Buffer.from(str).toString('base64');
}

async function setMetadata(
  sandboxId: string,
  update: Partial<UpdateStatus>,
  existing: Record<string, unknown>,
) {
  const status: UpdateStatus = {
    ...IDLE_STATUS,
    ...(existing.updateStatus as UpdateStatus | undefined),
    ...update,
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(sandboxes)
    .set({
      metadata: { ...existing, updateStatus: status },
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, sandboxId));
}

export async function getUpdateStatus(sandboxId: string): Promise<UpdateStatus> {
  const [row] = await db
    .select({ metadata: sandboxes.metadata })
    .from(sandboxes)
    .where(eq(sandboxes.sandboxId, sandboxId))
    .limit(1);

  if (!row) return { ...IDLE_STATUS };
  const meta = (row.metadata as Record<string, unknown>) ?? {};
  return (meta.updateStatus as UpdateStatus) ?? { ...IDLE_STATUS };
}

export function resetUpdateStatus(sandboxId: string): Promise<void> {
  return setMetadata(sandboxId, { ...IDLE_STATUS }, {}).then(() => {});
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
  const meta = (row.metadata as Record<string, unknown>) ?? {};
  const targetImage = imageForVersion(targetVersion);

  const set = (update: Partial<UpdateStatus>) => setMetadata(sandboxId, update, meta);

  try {
    const currentResult = await getCurrentImage(endpoint);
    const previousImage = currentResult.success ? currentResult.stdout.trim().replace(/'/g, '') : null;
    const previousVersion = previousImage?.split(':').pop() ?? null;

    await set({
      phase: 'pulling',
      progress: 10,
      message: `Pulling ${targetImage}...`,
      targetVersion,
      previousVersion,
      currentVersion: previousVersion,
      error: null,
      startedAt: new Date().toISOString(),
    });

    const pullResult = await pullImage(endpoint, targetImage);
    if (!pullResult.success) throw new Error(`Pull failed: ${pullResult.stderr}`);

    const oldBase64 = previousImage ? toBase64(previousImage) : null;
    const newBase64 = toBase64(targetImage);

    if (oldBase64) {
      const patchResult = await patchStartScript(endpoint, oldBase64, newBase64);
      if (!patchResult.success) throw new Error(`Patch script failed: ${patchResult.stderr}`);
    }

    await set({ phase: 'stopping', progress: 50, message: 'Stopping container...' });
    const stopResult = await stopContainer(endpoint);
    if (!stopResult.success) console.warn(`[UPDATE] Stop warning: ${stopResult.stderr}`);

    await set({ phase: 'restarting', progress: 60, message: 'Restarting service...' });
    const restartResult = await restartService(endpoint);
    if (!restartResult.success) throw new Error(`Restart failed: ${restartResult.stderr}`);

    await set({ phase: 'verifying', progress: 80, message: 'Verifying new container...' });
    const verifyResult = await verifyContainer(endpoint, targetImage);
    if (!verifyResult.success) throw new Error(`Verify failed: ${verifyResult.stderr}`);

    await db
      .update(sandboxes)
      .set({
        metadata: { ...meta, updateStatus: undefined, version: targetVersion },
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.sandboxId, sandboxId));

    await set({
      phase: 'complete',
      progress: 100,
      message: `Updated to v${targetVersion}`,
      currentVersion: targetVersion,
    });

    console.log(`[UPDATE] Sandbox ${sandboxId} updated to ${targetImage}`);
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    await set({
      phase: 'failed',
      progress: 0,
      message: `Update failed: ${errorMsg}`,
      error: errorMsg,
    });
    console.error(`[UPDATE] Sandbox ${sandboxId} update failed:`, errorMsg);
    throw err;
  }
}
