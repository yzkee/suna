import { eq, and, sql, asc } from 'drizzle-orm';
import { sandboxes, poolResources } from '@kortix/db';
import { db } from '../../shared/db';
import { config, SANDBOX_VERSION } from '../../config';
import { createApiKey } from '../../repositories/api-keys';
import {
  getProvider,
  type ProviderName,
} from '../providers';

export interface PoolResourceRow {
  id: string;
  provider: string;
  serverType: string;
  location: string;
  desiredCount: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PoolStatus {
  enabled: boolean;
  available: number;
  provisioning: number;
  resources: PoolResourceRow[];
}

export interface PoolClaimResult {
  sandbox: typeof sandboxes.$inferSelect;
  serviceKey: string;
}

async function countPool(): Promise<{ available: number; provisioning: number }> {
  const rows = await db
    .select({ status: sandboxes.status })
    .from(sandboxes)
    .where(
      sql`${sandboxes.status} IN ('pooled', 'provisioning')
        AND (${sandboxes.metadata}->>'poolIntent')::boolean = true`,
    );

  let available = 0;
  let provisioning = 0;
  for (const r of rows) {
    if (r.status === 'pooled') available++;
    else if (r.status === 'provisioning') provisioning++;
  }
  return { available, provisioning };
}

async function getEnabledResources(): Promise<PoolResourceRow[]> {
  return db
    .select()
    .from(poolResources)
    .where(eq(poolResources.enabled, true));
}

export async function getAllResources(): Promise<PoolResourceRow[]> {
  return db.select().from(poolResources);
}

export async function createResource(input: {
  provider: string;
  serverType: string;
  location: string;
  desiredCount: number;
}): Promise<PoolResourceRow> {
  const [row] = await db
    .insert(poolResources)
    .values({
      provider: input.provider as any,
      serverType: input.serverType,
      location: input.location,
      desiredCount: input.desiredCount,
      enabled: true,
    })
    .returning();
  return row;
}

export async function updateResource(id: string, input: {
  desiredCount?: number;
  enabled?: boolean;
}): Promise<PoolResourceRow | null> {
  const [row] = await db
    .update(poolResources)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(poolResources.id, id))
    .returning();
  return row ?? null;
}

export async function deleteResource(id: string): Promise<boolean> {
  const result = await db
    .delete(poolResources)
    .where(eq(poolResources.id, id))
    .returning({ id: poolResources.id });
  return result.length > 0;
}

export async function getPoolStatus(): Promise<PoolStatus> {
  const counts = await countPool();
  const resources = await getAllResources();
  return {
    enabled: config.isPoolEnabled(),
    ...counts,
    resources,
  };
}

export async function claimFromPool(
  accountId: string,
  userId: string,
): Promise<PoolClaimResult | null> {
  if (!config.isPoolEnabled()) return null;

  const [claimed] = await db
    .update(sandboxes)
    .set({
      accountId,
      status: 'active',
      pooledAt: null,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      eq(sandboxes.sandboxId, sql`(
        SELECT sandbox_id FROM kortix.sandboxes
        WHERE status = 'pooled' AND pooled_at IS NOT NULL
        ORDER BY pooled_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )`),
    )
    .returning();

  if (!claimed) return null;

  const sandboxKey = await createApiKey({
    sandboxId: claimed.sandboxId,
    accountId,
    title: 'Sandbox Token',
    type: 'sandbox',
  });

  await injectEnvVars(claimed, sandboxKey.secretKey);

  await db
    .update(sandboxes)
    .set({
      config: { serviceKey: sandboxKey.secretKey },
      metadata: {
        ...((claimed.metadata as Record<string, unknown>) ?? {}),
        poolIntent: false,
        claimedAt: new Date().toISOString(),
        claimedByAccount: accountId,
        provisioningStage: 'services_ready',
      },
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, claimed.sandboxId));

  console.log(`[POOL] Claimed sandbox ${claimed.sandboxId} for account ${accountId}`);

  const [updated] = await db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.sandboxId, claimed.sandboxId))
    .limit(1);

  return { sandbox: updated, serviceKey: sandboxKey.secretKey };
}

async function injectEnvVars(
  sandbox: typeof sandboxes.$inferSelect,
  newServiceKey: string,
): Promise<void> {
  const provider = getProvider(sandbox.provider);
  const endpoint = await provider.resolveEndpoint(sandbox.externalId!);

  const envKeys: Record<string, string> = {
    KORTIX_API_URL: config.KORTIX_URL.replace(/\/v1\/router\/?$/, ''),
    ENV_MODE: 'cloud',
    INTERNAL_SERVICE_KEY: newServiceKey,
    KORTIX_TOKEN: newServiceKey,
    KORTIX_SANDBOX_VERSION: SANDBOX_VERSION,
  };

  const url = `${endpoint.url}/env`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...endpoint.headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keys: envKeys }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[POOL] Failed to inject env vars into sandbox ${sandbox.sandboxId}: ${res.status} ${text.slice(0, 200)}`);
    throw new Error(`Env var injection failed: ${res.status}`);
  }

  console.log(`[POOL] Env vars injected into sandbox ${sandbox.sandboxId}`);
}

export async function replenishPool(): Promise<{ created: number }> {
  if (!config.isPoolEnabled()) return { created: 0 };

  const resources = await getEnabledResources();
  if (resources.length === 0) return { created: 0 };

  let totalCreated = 0;

  for (const resource of resources) {
    const existing = await db
      .select({ status: sandboxes.status })
      .from(sandboxes)
      .where(
        sql`(${sandboxes.metadata}->>'poolIntent')::boolean = true
          AND (${sandboxes.metadata}->>'poolResourceId') = ${resource.id}
          AND ${sandboxes.status} IN ('pooled', 'provisioning')`,
      );

    const currentCount = existing.length;
    const deficit = resource.desiredCount - currentCount;

    if (deficit <= 0) continue;

    for (let i = 0; i < deficit; i++) {
      try {
        await createPoolSandbox(resource);
        totalCreated++;
      } catch (err) {
        console.error(`[POOL] Failed to create sandbox for resource ${resource.id} (${resource.provider}/${resource.serverType}/${resource.location}):`, err);
      }
    }
  }

  if (totalCreated > 0) {
    console.log(`[POOL] Replenished: ${totalCreated} sandboxes created`);
  }
  return { created: totalCreated };
}

async function createPoolSandbox(resource: PoolResourceRow): Promise<void> {
  const accountId = config.POOL_ACCOUNT_ID;
  const providerName = resource.provider as ProviderName;
  const provider = getProvider(providerName);

  const [sandbox] = await db
    .insert(sandboxes)
    .values({
      accountId,
      name: `pool-${resource.serverType}-${resource.location}-${Date.now().toString(36)}`,
      provider: providerName,
      externalId: '',
      status: 'provisioning',
      baseUrl: '',
      config: {},
      metadata: {
        poolIntent: true,
        poolResourceId: resource.id,
        poolServerType: resource.serverType,
        poolLocation: resource.location,
      },
      isIncluded: true,
    })
    .returning();

  const sandboxKey = await createApiKey({
    sandboxId: sandbox.sandboxId,
    accountId,
    title: 'Pool Sandbox Token',
    type: 'sandbox',
  });

  const createOpts = {
    accountId,
    userId: accountId,
    name: `pool-${resource.serverType}-${resource.location}`,
    envVars: { KORTIX_TOKEN: sandboxKey.secretKey },
    hetznerServerType: resource.serverType,
    hetznerLocation: resource.location,
  };

  try {
    const result = await provider.create(createOpts);

    const firstStage = provider.provisioning.stages[0];
    await db
      .update(sandboxes)
      .set({
        externalId: result.externalId,
        baseUrl: result.baseUrl || '',
        config: { serviceKey: sandboxKey.secretKey },
        metadata: {
          ...result.metadata,
          poolIntent: true,
          poolResourceId: resource.id,
          poolServerType: resource.serverType,
          poolLocation: resource.location,
          provisioningStage: firstStage?.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

    console.log(`[POOL] Created pool sandbox ${sandbox.sandboxId} (${resource.provider}/${resource.serverType}/${resource.location})`);
  } catch (err) {
    await db
      .update(sandboxes)
      .set({
        status: 'error',
        metadata: {
          poolIntent: true,
          poolResourceId: resource.id,
          provisioningStage: 'error',
          provisioningError: err instanceof Error ? err.message : String(err),
        },
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.sandboxId, sandbox.sandboxId));
    throw err;
  }
}

export async function cleanupPool(): Promise<{ cleaned: number }> {
  if (!config.isPoolEnabled()) return { cleaned: 0 };

  const maxAgeMs = config.POOL_MAX_AGE_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const provisionTimeout = new Date(Date.now() - 15 * 60 * 1000);

  const stale = await db
    .select()
    .from(sandboxes)
    .where(
      sql`(${sandboxes.metadata}->>'poolIntent')::boolean = true
        AND (
          (${sandboxes.status} = 'pooled' AND ${sandboxes.createdAt} < ${cutoff})
          OR (${sandboxes.status} = 'provisioning' AND ${sandboxes.createdAt} < ${provisionTimeout} AND ${sandboxes.accountId} = ${config.POOL_ACCOUNT_ID})
          OR (${sandboxes.status} = 'error' AND ${sandboxes.accountId} = ${config.POOL_ACCOUNT_ID})
        )`,
    );

  let cleaned = 0;

  for (const sandbox of stale) {
    try {
      if (sandbox.externalId) {
        const provider = getProvider(sandbox.provider);
        await provider.remove(sandbox.externalId).catch((err: unknown) => {
          console.warn(`[POOL] Failed to remove provider resource for ${sandbox.sandboxId}:`, err);
        });
      }

      await db
        .update(sandboxes)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

      cleaned++;
      console.log(`[POOL] Cleaned up stale pool sandbox ${sandbox.sandboxId}`);
    } catch (err) {
      console.error(`[POOL] Failed to cleanup ${sandbox.sandboxId}:`, err);
    }
  }

  return { cleaned };
}

export async function drainPool(): Promise<{ drained: number }> {
  const pooled = await db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.status, 'pooled'));

  let drained = 0;

  for (const sandbox of pooled) {
    try {
      if (sandbox.externalId) {
        const provider = getProvider(sandbox.provider);
        await provider.remove(sandbox.externalId).catch(() => {});
      }

      await db
        .update(sandboxes)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

      drained++;
    } catch (err) {
      console.error(`[POOL] Failed to drain ${sandbox.sandboxId}:`, err);
    }
  }

  console.log(`[POOL] Drained ${drained} sandboxes`);
  return { drained };
}

export async function listPooledSandboxes(limit = 50) {
  return db
    .select({
      id: sandboxes.sandboxId,
      external_id: sandboxes.externalId,
      provider: sandboxes.provider,
      pooled_at: sandboxes.pooledAt,
      created_at: sandboxes.createdAt,
      status: sandboxes.status,
      metadata: sandboxes.metadata,
    })
    .from(sandboxes)
    .where(
      sql`(${sandboxes.metadata}->>'poolIntent')::boolean = true
        AND ${sandboxes.status} IN ('pooled', 'provisioning')`,
    )
    .orderBy(asc(sandboxes.pooledAt))
    .limit(limit);
}

export async function forceCreatePool(count: number, resourceId?: string): Promise<{ created: number; failed: number }> {
  if (!config.isPoolEnabled()) return { created: 0, failed: 0 };

  let resources: PoolResourceRow[];
  if (resourceId) {
    const [r] = await db.select().from(poolResources).where(eq(poolResources.id, resourceId));
    if (!r) throw new Error(`Pool resource ${resourceId} not found`);
    resources = [r];
  } else {
    resources = await getEnabledResources();
  }

  if (resources.length === 0) return { created: 0, failed: 0 };

  let created = 0;
  let failed = 0;
  const perResource = Math.ceil(count / resources.length);

  for (const resource of resources) {
    for (let i = 0; i < perResource && (created + failed) < count; i++) {
      try {
        await createPoolSandbox(resource);
        created++;
      } catch {
        failed++;
      }
    }
  }

  return { created, failed };
}
