import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { createApiKey } from '../../repositories/api-keys';
import {
  getProvider,
  getDefaultProviderName,
  type ProviderName,
} from '../providers';
import { config } from '../../config';
import { checkCredits } from '../../router/services/billing';
import * as pool from '../../pool';

export interface EnsureSandboxResult {
  row: typeof sandboxes.$inferSelect;
  created: boolean;
}

export async function ensureSandbox(opts: {
  accountId: string;
  userId: string;
  provider?: ProviderName;
  hetznerServerType?: string;
  hetznerLocation?: string;
  isIncluded?: boolean;
}): Promise<EnsureSandboxResult> {
  const { accountId, userId } = opts;
  const providerName = opts.provider || getDefaultProviderName();

  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);

  const existing = await findExistingSandbox(accountId);
  if (existing) return existing;

  const reactivated = await tryReactivateStaleSandbox(accountId);
  if (reactivated) return reactivated;

  const claimed = await tryClaimFromPool(accountId, userId, opts.hetznerServerType, opts.hetznerLocation);
  if (claimed) return claimed;

  await checkProviderCredits(providerName, accountId, opts.isIncluded);

  return provisionNewSandbox(accountId, userId, providerName, opts);
}

async function findExistingSandbox(accountId: string): Promise<EnsureSandboxResult | null> {
  const [active] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.accountId, accountId), eq(sandboxes.status, 'active')))
    .limit(1);

  if (active) return { row: active, created: false };

  const [provisioning] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.accountId, accountId), eq(sandboxes.status, 'provisioning')))
    .limit(1);

  if (provisioning) return { row: provisioning, created: false };

  return null;
}

async function tryReactivateStaleSandbox(accountId: string): Promise<EnsureSandboxResult | null> {
  const [stale] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.accountId, accountId), inArray(sandboxes.status, ['stopped', 'archived'])))
    .orderBy(desc(sandboxes.updatedAt))
    .limit(1);

  if (!stale?.externalId) return null;

  try {
    const provider = getProvider(stale.provider);
    await provider.start(stale.externalId);

    const [reactivated] = await db
      .update(sandboxes)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(sandboxes.sandboxId, stale.sandboxId))
      .returning();

    return { row: reactivated, created: false };
  } catch (err) {
    console.warn(`[ensureSandbox] Failed to reactivate ${stale.sandboxId}:`, err);
    return null;
  }
}

async function tryClaimFromPool(accountId: string, userId: string, serverType?: string, location?: string): Promise<EnsureSandboxResult | null> {
  if (!config.isPoolEnabled()) return null;

  try {
    const claimed = await pool.grab({ serverType, location });
    if (!claimed) return null;

    const sandboxKey = await createApiKey({
      sandboxId: claimed.poolSandbox.id,
      accountId,
      title: 'Sandbox Token',
      type: 'sandbox',
    });

    const [sandbox] = await db
      .insert(sandboxes)
      .values({
        accountId,
        name: `sandbox-${accountId.slice(0, 8)}`,
        provider: claimed.poolSandbox.provider as any,
        externalId: claimed.externalId,
        status: 'active',
        baseUrl: claimed.baseUrl,
        config: { serviceKey: sandboxKey.secretKey },
        metadata: claimed.metadata,
        isIncluded: true,
      })
      .returning();

    await pool.injectEnv(claimed, sandboxKey.secretKey);

    console.log(`[ensureSandbox] Claimed from pool → sandbox ${sandbox.sandboxId} for account ${accountId}`);

    pool.replenish().catch((err) => {
      console.error('[ensureSandbox] Background pool replenishment failed:', err);
    });

    return { row: sandbox, created: true };
  } catch (err) {
    console.warn('[ensureSandbox] Pool claim failed, falling back to regular provisioning:', err);
    return null;
  }
}

async function checkProviderCredits(providerName: ProviderName, accountId: string, isIncluded?: boolean): Promise<void> {
  if (providerName === 'hetzner' && config.KORTIX_BILLING_INTERNAL_ENABLED && !isIncluded) {
    const creditCheck = await checkCredits(accountId, 0.10);
    if (!creditCheck.hasCredits) {
      throw new Error(`Insufficient credits to provision Hetzner VPS: ${creditCheck.message}`);
    }
  }
}

async function provisionNewSandbox(
  accountId: string,
  userId: string,
  providerName: ProviderName,
  opts: { hetznerServerType?: string; hetznerLocation?: string; isIncluded?: boolean },
): Promise<EnsureSandboxResult> {
  const provider = getProvider(providerName);

  const sandbox = await insertProvisioningRow(accountId, providerName, opts.isIncluded);
  const sandboxKey = await createSandboxApiKey(sandbox.sandboxId, accountId);

  const createOpts = {
    accountId,
    userId,
    name: `sandbox-${accountId.slice(0, 8)}`,
    hetznerServerType: opts.hetznerServerType,
    hetznerLocation: opts.hetznerLocation,
    envVars: { KORTIX_TOKEN: sandboxKey.secretKey },
  };

  if (provider.provisioning.async) {
    return provisionAsync(provider, sandbox, sandboxKey.secretKey, createOpts);
  }

  return provisionSync(provider, sandbox, sandboxKey.secretKey, createOpts);
}

async function insertProvisioningRow(accountId: string, providerName: ProviderName, isIncluded?: boolean) {
  const [sandbox] = await db
    .insert(sandboxes)
    .values({
      accountId,
      name: `sandbox-${accountId.slice(0, 8)}`,
      provider: providerName,
      externalId: '',
      status: 'provisioning',
      baseUrl: '',
      config: {},
      metadata: {},
      isIncluded: isIncluded ?? false,
    })
    .returning();
  return sandbox;
}

async function createSandboxApiKey(sandboxId: string, accountId: string) {
  return createApiKey({
    sandboxId,
    accountId,
    title: 'Sandbox Token',
    type: 'sandbox',
  });
}

async function provisionAsync(
  provider: ReturnType<typeof getProvider>,
  sandbox: typeof sandboxes.$inferSelect,
  serviceKey: string,
  createOpts: Parameters<ReturnType<typeof getProvider>['create']>[0],
): Promise<EnsureSandboxResult> {
  const firstStage = provider.provisioning.stages[0];

  await db
    .update(sandboxes)
    .set({
      config: { serviceKey },
      metadata: { provisioningStage: firstStage?.id, provisioningMessage: firstStage?.message },
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

  try {
    const result = await provider.create(createOpts);
    const [updated] = await db
      .update(sandboxes)
      .set({
        externalId: result.externalId,
        baseUrl: result.baseUrl || '',
        metadata: { ...result.metadata, provisioningStage: firstStage?.id },
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.sandboxId, sandbox.sandboxId))
      .returning();

    return { row: updated, created: true };
  } catch (err) {
    await markSandboxError(sandbox.sandboxId, err);
    throw err;
  }
}

async function provisionSync(
  provider: ReturnType<typeof getProvider>,
  sandbox: typeof sandboxes.$inferSelect,
  serviceKey: string,
  createOpts: Parameters<ReturnType<typeof getProvider>['create']>[0],
): Promise<EnsureSandboxResult> {
  try {
    const result = await provider.create(createOpts);
    const [updated] = await db
      .update(sandboxes)
      .set({
        externalId: result.externalId,
        status: 'active',
        baseUrl: result.baseUrl,
        metadata: result.metadata,
        config: { serviceKey },
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.sandboxId, sandbox.sandboxId))
      .returning();

    return { row: updated, created: true };
  } catch (err) {
    await markSandboxError(sandbox.sandboxId, err);
    throw err;
  }
}

async function markSandboxError(sandboxId: string, err: unknown): Promise<void> {
  await db
    .update(sandboxes)
    .set({
      status: 'error',
      metadata: {
        provisioningStage: 'error',
        provisioningError: err instanceof Error ? err.message : String(err),
      },
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, sandboxId));
}
