import { eq, sql } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../shared/db';
import type { UpdateStatus, UpdatePhase } from './types';
import { IDLE_STATUS } from './types';

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

export async function setUpdateStatus(
  sandboxId: string,
  update: Partial<UpdateStatus>,
): Promise<void> {
  const patch = { updateStatus: { ...update, updatedAt: new Date().toISOString() } };
  await db
    .update(sandboxes)
    .set({
      metadata: sql`metadata || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, sandboxId));
}

export async function setPhase(
  sandboxId: string,
  phase: UpdatePhase,
  progress: number,
  message: string,
  extra?: Partial<UpdateStatus>,
): Promise<void> {
  await setUpdateStatus(sandboxId, { phase, progress, message, ...extra });
}

export async function resetUpdateStatus(sandboxId: string): Promise<void> {
  await setUpdateStatus(sandboxId, { ...IDLE_STATUS });
}

export async function clearUpdateStatus(sandboxId: string, version: string): Promise<void> {
  await db
    .update(sandboxes)
    .set({
      metadata: sql`(metadata - 'updateStatus') || ${JSON.stringify({ version })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, sandboxId));
}
