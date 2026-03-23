import { eq, and, sql, asc, lt } from 'drizzle-orm';
import { sandboxes, poolResources, poolSandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { config, SANDBOX_VERSION } from '../../config';
import { createApiKey } from '../../repositories/api-keys';
import { getProvider, type ProviderName } from '../providers';

const POOL_ACCOUNT_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

export type PoolResourceRow = typeof poolResources.$inferSelect;
export type PoolSandboxRow = typeof poolSandboxes.$inferSelect;

// ─── Status ──────────────────────────────────────────────────────────────────

export async function getPoolStatus() {
  const resources = await db.select().from(poolResources);

  const inventory = await db
    .select({ status: poolSandboxes.status })
    .from(poolSandboxes)
    .where(sql`${poolSandboxes.status} IN ('ready', 'provisioning')`);

  const ready = inventory.filter((r) => r.status === 'ready').length;
  const provisioning = inventory.filter((r) => r.status === 'provisioning').length;

  return { resources, ready, provisioning };
}

// ─── Resources CRUD ──────────────────────────────────────────────────────────

export async function getAllResources() {
  return db.select().from(poolResources);
}

export async function createResource(input: {
  provider: string;
  serverType: string;
  location: string;
  desiredCount: number;
}) {
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

export async function updateResource(id: string, input: { desiredCount?: number; enabled?: boolean }) {
  const [row] = await db
    .update(poolResources)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(poolResources.id, id))
    .returning();
  return row ?? null;
}

export async function deleteResource(id: string) {
  const result = await db.delete(poolResources).where(eq(poolResources.id, id)).returning({ id: poolResources.id });
  return result.length > 0;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export async function listPoolSandboxes(limit = 50) {
  return db
    .select()
    .from(poolSandboxes)
    .where(sql`${poolSandboxes.status} IN ('ready', 'provisioning')`)
    .orderBy(asc(poolSandboxes.createdAt))
    .limit(limit);
}

// ─── Claim ───────────────────────────────────────────────────────────────────

export async function claimFromPool(
  accountId: string,
  userId: string,
): Promise<{ sandbox: typeof sandboxes.$inferSelect; serviceKey: string } | null> {
  const [pooled] = await db.execute<PoolSandboxRow>(sql`
    DELETE FROM kortix.pool_sandboxes
    WHERE id = (
      SELECT id FROM kortix.pool_sandboxes
      WHERE status = 'ready'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  if (!pooled) return null;

  const sandboxKey = await createApiKey({
    sandboxId: pooled.id,
    accountId,
    title: 'Sandbox Token',
    type: 'sandbox',
  });

  const [sandbox] = await db
    .insert(sandboxes)
    .values({
      accountId,
      name: `sandbox-${accountId.slice(0, 8)}`,
      provider: pooled.provider as any,
      externalId: pooled.externalId,
      status: 'active',
      baseUrl: pooled.baseUrl,
      config: { serviceKey: sandboxKey.secretKey },
      metadata: {
        ...((pooled.metadata as Record<string, unknown>) ?? {}),
        claimedFromPool: true,
        claimedAt: new Date().toISOString(),
        poolServerType: pooled.serverType,
        poolLocation: pooled.location,
        provisioningStage: 'services_ready',
      },
      isIncluded: true,
    })
    .returning();

  await injectEnvVars(sandbox, pooled, sandboxKey.secretKey);

  console.log(`[POOL] Claimed pool sandbox ${pooled.id} → user sandbox ${sandbox.sandboxId} for account ${accountId}`);

  return { sandbox, serviceKey: sandboxKey.secretKey };
}

async function injectEnvVars(
  sandbox: typeof sandboxes.$inferSelect,
  pooled: PoolSandboxRow,
  serviceKey: string,
): Promise<void> {
  const meta = (pooled.metadata as Record<string, unknown>) ?? {};
  const proxyToken = meta.justavpsProxyToken as string | undefined;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (proxyToken) headers['X-Proxy-Token'] = proxyToken;
  if (serviceKey) headers['Authorization'] = `Bearer ${serviceKey}`;

  const envKeys: Record<string, string> = {
    KORTIX_API_URL: config.KORTIX_URL.replace(/\/v1\/router\/?$/, ''),
    ENV_MODE: 'cloud',
    INTERNAL_SERVICE_KEY: serviceKey,
    KORTIX_TOKEN: serviceKey,
    KORTIX_SANDBOX_VERSION: SANDBOX_VERSION,
  };

  const url = `${pooled.baseUrl}/env`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ keys: envKeys }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[POOL] Env injection returned ${res.status}: ${text.slice(0, 200)}`);
    } else {
      console.log(`[POOL] Env vars injected into ${pooled.externalId}`);
    }
  } catch (err) {
    console.warn(`[POOL] Env injection failed for ${pooled.externalId}:`, err);
  }
}

// ─── Replenish ───────────────────────────────────────────────────────────────

export async function replenishPool(): Promise<{ created: number }> {
  const resources = await db.select().from(poolResources).where(eq(poolResources.enabled, true));
  if (resources.length === 0) return { created: 0 };

  let totalCreated = 0;

  for (const resource of resources) {
    const existing = await db
      .select({ id: poolSandboxes.id })
      .from(poolSandboxes)
      .where(
        and(
          eq(poolSandboxes.resourceId, resource.id),
          sql`${poolSandboxes.status} IN ('ready', 'provisioning')`,
        ),
      );

    const deficit = resource.desiredCount - existing.length;
    if (deficit <= 0) continue;

    for (let i = 0; i < deficit; i++) {
      try {
        await createPoolSandbox(resource);
        totalCreated++;
      } catch (err) {
        console.error(`[POOL] Failed to create for ${resource.provider}/${resource.serverType}/${resource.location}:`, err);
      }
    }
  }

  if (totalCreated > 0) console.log(`[POOL] Replenished: ${totalCreated} created`);
  return { created: totalCreated };
}

async function createPoolSandbox(resource: PoolResourceRow): Promise<void> {
  const providerName = resource.provider as ProviderName;
  const provider = getProvider(providerName);

  const result = await provider.create({
    accountId: POOL_ACCOUNT_PLACEHOLDER,
    userId: POOL_ACCOUNT_PLACEHOLDER,
    name: `pool-${resource.serverType}-${resource.location}`,
    envVars: { KORTIX_TOKEN: `pool_placeholder_${Date.now()}` },
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
    metadata: result.metadata,
  });

  console.log(`[POOL] Created pool sandbox (external: ${result.externalId}) for ${resource.serverType}/${resource.location}`);
}

export async function forceCreatePool(count: number, resourceId?: string): Promise<{ created: number; failed: number }> {
  let resources: PoolResourceRow[];
  if (resourceId) {
    const [r] = await db.select().from(poolResources).where(eq(poolResources.id, resourceId));
    if (!r) throw new Error('Resource not found');
    resources = [r];
  } else {
    resources = await db.select().from(poolResources).where(eq(poolResources.enabled, true));
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

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupPool(): Promise<{ cleaned: number }> {
  const maxAgeMs = (config.POOL_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const provisionTimeout = new Date(Date.now() - 15 * 60 * 1000);

  const stale = await db
    .select()
    .from(poolSandboxes)
    .where(
      sql`${poolSandboxes.status} = 'error'
        OR (${poolSandboxes.status} = 'ready' AND ${poolSandboxes.createdAt} < ${cutoff})
        OR (${poolSandboxes.status} = 'provisioning' AND ${poolSandboxes.createdAt} < ${provisionTimeout})`,
    );

  let cleaned = 0;

  for (const ps of stale) {
    try {
      if (ps.externalId) {
        const provider = getProvider(ps.provider as ProviderName);
        await provider.remove(ps.externalId).catch(() => {});
      }
      await db.delete(poolSandboxes).where(eq(poolSandboxes.id, ps.id));
      cleaned++;
    } catch (err) {
      console.error(`[POOL] Failed to cleanup ${ps.id}:`, err);
    }
  }

  if (cleaned > 0) console.log(`[POOL] Cleaned ${cleaned} stale pool sandboxes`);
  return { cleaned };
}

export async function drainPool(): Promise<{ drained: number }> {
  const all = await db.select().from(poolSandboxes);
  let drained = 0;

  for (const ps of all) {
    try {
      if (ps.externalId) {
        const provider = getProvider(ps.provider as ProviderName);
        await provider.remove(ps.externalId).catch(() => {});
      }
      await db.delete(poolSandboxes).where(eq(poolSandboxes.id, ps.id));
      drained++;
    } catch (err) {
      console.error(`[POOL] Failed to drain ${ps.id}:`, err);
    }
  }

  return { drained };
}

// ─── Webhook routing ─────────────────────────────────────────────────────────

export async function handlePoolWebhook(externalId: string, stage?: string, status?: string): Promise<boolean> {
  const [poolSandbox] = await db
    .select()
    .from(poolSandboxes)
    .where(eq(poolSandboxes.externalId, externalId))
    .limit(1);

  if (!poolSandbox) return false;

  if (stage === 'services_ready' || status === 'ready') {
    await db
      .update(poolSandboxes)
      .set({ status: 'ready', readyAt: new Date() })
      .where(eq(poolSandboxes.id, poolSandbox.id));
    console.log(`[POOL] Pool sandbox ${poolSandbox.id} → ready`);
  } else if (status === 'error') {
    await db
      .update(poolSandboxes)
      .set({ status: 'error' })
      .where(eq(poolSandboxes.id, poolSandbox.id));
    console.log(`[POOL] Pool sandbox ${poolSandbox.id} → error`);
  }

  return true;
}
