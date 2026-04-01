import { eq } from 'drizzle-orm';
import { poolResources } from '@kortix/db';
import { db } from '../shared/db';
import type { PoolResource, ResourceInput } from './types';

export async function list(): Promise<PoolResource[]> {
  return db.select().from(poolResources);
}

export async function listEnabled(): Promise<PoolResource[]> {
  return db.select().from(poolResources).where(eq(poolResources.enabled, true));
}

export async function findById(id: string): Promise<PoolResource | null> {
  const [row] = await db.select().from(poolResources).where(eq(poolResources.id, id)).limit(1);
  return row ?? null;
}

export async function upsert(input: ResourceInput): Promise<PoolResource> {
  const [row] = await db
    .insert(poolResources)
    .values({
      provider: input.provider as any,
      serverType: input.serverType,
      location: input.location,
      desiredCount: input.desiredCount,
    })
    .onConflictDoUpdate({
      target: [poolResources.provider, poolResources.serverType, poolResources.location],
      set: { desiredCount: input.desiredCount, enabled: true, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function update(id: string, input: { desiredCount?: number; enabled?: boolean }): Promise<PoolResource | null> {
  const [row] = await db
    .update(poolResources)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(poolResources.id, id))
    .returning();
  return row ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(poolResources).where(eq(poolResources.id, id)).returning({ id: poolResources.id });
  return result.length > 0;
}
