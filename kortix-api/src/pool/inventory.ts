import { eq, and, asc, sql } from 'drizzle-orm';
import { poolSandboxes } from '@kortix/db';
import { db } from '../shared/db';
import { getProvider, type ProviderName } from '../platform/providers';
import { config } from '../config';
import type { PoolSandbox, PoolResource, ClaimedSandbox, ClaimOpts } from './types';

export async function listActive(limit = 50): Promise<PoolSandbox[]> {
  return db
    .select()
    .from(poolSandboxes)
    .where(sql`${poolSandboxes.status} IN ('ready', 'provisioning')`)
    .orderBy(asc(poolSandboxes.createdAt))
    .limit(limit);
}

export async function countByStatus(): Promise<{ ready: number; provisioning: number }> {
  const rows = await db
    .select({ status: poolSandboxes.status })
    .from(poolSandboxes)
    .where(sql`${poolSandboxes.status} IN ('ready', 'provisioning')`);

  return {
    ready: rows.filter((r) => r.status === 'ready').length,
    provisioning: rows.filter((r) => r.status === 'provisioning').length,
  };
}

export async function countForResource(resourceId: string): Promise<number> {
  const rows = await db
    .select({ id: poolSandboxes.id })
    .from(poolSandboxes)
    .where(and(eq(poolSandboxes.resourceId, resourceId), sql`${poolSandboxes.status} IN ('ready', 'provisioning')`));
  return rows.length;
}

export async function grab(opts?: ClaimOpts): Promise<ClaimedSandbox | null> {
  const conditions = [eq(poolSandboxes.status, 'ready' as any)];
  if (opts?.serverType) conditions.push(eq(poolSandboxes.serverType, opts.serverType));
  if (opts?.location) conditions.push(eq(poolSandboxes.location, opts.location));

  const [candidate] = await db
    .select()
    .from(poolSandboxes)
    .where(and(...conditions))
    .orderBy(asc(poolSandboxes.createdAt))
    .limit(1);

  if (!candidate) return null;

  const [claimed] = await db
    .delete(poolSandboxes)
    .where(and(eq(poolSandboxes.id, candidate.id), eq(poolSandboxes.status, 'ready' as any)))
    .returning();

  if (!claimed) return null;

  console.log(`[POOL] Grabbed ${claimed.id} (${claimed.serverType}/${claimed.location})`);

  return {
    poolSandbox: claimed,
    externalId: claimed.externalId,
    baseUrl: claimed.baseUrl,
    metadata: {
      ...((claimed.metadata as Record<string, unknown>) ?? {}),
      claimedFromPool: true,
      claimedAt: new Date().toISOString(),
      poolServerType: claimed.serverType,
      poolLocation: claimed.location,
      provisioningStage: 'services_ready',
    },
  };
}

export async function provision(resource: PoolResource): Promise<void> {
  const providerName = resource.provider as ProviderName;
  const provider = getProvider(providerName);
  const placeholderToken = `pool_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const result = await provider.create({
    accountId: 'pool',
    userId: 'pool',
    name: `pool-${resource.serverType}-${resource.location}`,
    envVars: { KORTIX_TOKEN: placeholderToken },
    hetznerServerType: resource.serverType,
    hetznerLocation: resource.location,
  });

  await db.insert(poolSandboxes).values({
    resourceId: resource.id,
    provider: providerName,
    externalId: result.externalId,
    baseUrl: result.baseUrl || '',
    serverType: resource.serverType,
    location: resource.location,
    status: 'provisioning',
    metadata: { ...result.metadata, poolPlaceholderToken: placeholderToken },
  });

  console.log(`[POOL] Provisioned ${result.externalId} (${resource.serverType}/${resource.location})`);
}

export async function markReady(id: string): Promise<void> {
  await db.update(poolSandboxes).set({ status: 'ready', readyAt: new Date() }).where(eq(poolSandboxes.id, id));
}

export async function markError(id: string): Promise<void> {
  await db.update(poolSandboxes).set({ status: 'error' }).where(eq(poolSandboxes.id, id));
}

export async function findByExternalId(externalId: string): Promise<PoolSandbox | null> {
  const [row] = await db.select().from(poolSandboxes).where(eq(poolSandboxes.externalId, externalId)).limit(1);
  return row ?? null;
}

export async function destroyOne(ps: PoolSandbox): Promise<void> {
  if (ps.externalId) {
    const provider = getProvider(ps.provider as ProviderName);
    await provider.remove(ps.externalId).catch(() => {});
  }
  await db.delete(poolSandboxes).where(eq(poolSandboxes.id, ps.id));
}

export async function findStale(): Promise<PoolSandbox[]> {
  const maxAgeMs = (config.POOL_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const provisionTimeout = new Date(Date.now() - 15 * 60 * 1000);

  return db
    .select()
    .from(poolSandboxes)
    .where(
      sql`${poolSandboxes.status} = 'error'
        OR (${poolSandboxes.status} = 'ready' AND ${poolSandboxes.createdAt} < ${cutoff})
        OR (${poolSandboxes.status} = 'provisioning' AND ${poolSandboxes.createdAt} < ${provisionTimeout})`,
    );
}

export async function findAll(): Promise<PoolSandbox[]> {
  return db.select().from(poolSandboxes);
}
