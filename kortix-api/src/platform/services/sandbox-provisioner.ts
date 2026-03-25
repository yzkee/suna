/**
 * sandbox-provisioner.ts
 *
 * Called by billing webhooks to provision/archive sandboxes.
 * 1 subscription = 1 instance. Deduped by subscription ID.
 */

import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { config } from '../../config';
import * as pool from '../../pool';
import { createSandbox } from './ensure-sandbox';
import { createApiKey } from '../../repositories/api-keys';

const provisioningSubscriptions = new Set<string>();

/** Find sandbox by subscription ID — checks both column and metadata */
async function findBySubscription(accountId: string, subscriptionId: string) {
  const all = await db.select().from(sandboxes).where(eq(sandboxes.accountId, accountId));
  return all.find((s) => {
    if (s.status === 'archived') return false;
    if ((s as any).stripeSubscriptionId === subscriptionId) return true;
    const meta = (s.metadata as Record<string, unknown>) ?? {};
    return meta.stripe_subscription_id === subscriptionId;
  });
}

/**
 * Provision a new sandbox from a completed Stripe checkout.
 * Skips if a sandbox already exists for this subscription.
 */
export async function provisionSandboxFromCheckout(opts: {
  accountId: string;
  subscriptionId: string;
  serverType: string;
  location?: string;
  tierKey: string;
}) {
  const { accountId, subscriptionId, serverType, location, tierKey } = opts;

  if (provisioningSubscriptions.has(subscriptionId)) {
    console.log(`[sandbox-provisioner] Provision already in progress for sub ${subscriptionId}, skipping`);
    return { row: null, created: false };
  }
  provisioningSubscriptions.add(subscriptionId);

  try {
    const existing = await findBySubscription(accountId, subscriptionId);
    if (existing) {
      console.log(`[sandbox-provisioner] Already exists for sub ${subscriptionId}: ${existing.sandboxId}`);
      return { row: existing, created: false };
    }

    // Try pool claim first
    if (config.isPoolEnabled()) {
      try {
        const claimed = await pool.grab({ serverType, location: location || undefined });
        console.log(`[sandbox-provisioner] Pool grab: ${claimed ? 'CLAIMED ' + claimed.externalId : 'empty'}`);

        if (claimed) {
          const [row] = await db
            .insert(sandboxes)
            .values({
              accountId,
              name: `sandbox-${accountId.slice(0, 8)}`,
              provider: claimed.poolSandbox.provider,
              externalId: claimed.externalId,
              status: 'active',
              baseUrl: claimed.baseUrl,
              config: {},
              metadata: claimed.metadata,
              isIncluded: false,
            })
            .returning();

          const sandboxKey = await createApiKey({
            sandboxId: row.sandboxId,
            accountId,
            title: 'Sandbox Token',
            type: 'sandbox',
          });

          await db
            .update(sandboxes)
            .set({ config: { serviceKey: sandboxKey.secretKey }, updatedAt: new Date() })
            .where(eq(sandboxes.sandboxId, row.sandboxId));

          await pool.injectEnv(claimed, sandboxKey.secretKey);

          console.log(`[sandbox-provisioner] Claimed from pool: ${row.sandboxId} (ext: ${claimed.externalId})`);
          return { row, created: true };
        }
      } catch (err) {
        console.warn('[sandbox-provisioner] Pool claim failed, falling back:', err);
      }
    }

    console.log(`[sandbox-provisioner] Provisioning new sandbox for ${accountId} (type=${serverType}, loc=${location})`);
    const result = await createSandbox({
      accountId,
      userId: accountId,
      provider: 'justavps',
      serverType,
      location,
      isIncluded: false,
    });

    // Tag the sandbox with its subscription ID
    if (result.row) {
      const meta = (result.row.metadata as Record<string, unknown>) ?? {};
      await db
        .update(sandboxes)
        .set({
          metadata: { ...meta, stripe_subscription_id: subscriptionId, tier_key: tierKey },
          updatedAt: new Date(),
        })
        .where(eq(sandboxes.sandboxId, result.row.sandboxId));
    }

    return result;
  } finally {
    provisioningSubscriptions.delete(subscriptionId);
  }
}

/**
 * Archive the sandbox tied to a deleted Stripe subscription.
 */
export async function archiveSandboxBySubscription(
  accountId: string,
  subscriptionId: string,
): Promise<void> {
  const match = await findBySubscription(accountId, subscriptionId);
  if (!match) {
    console.warn(`[sandbox-provisioner] No sandbox for sub ${subscriptionId}`);
    return;
  }

  await db
    .update(sandboxes)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(sandboxes.sandboxId, match.sandboxId));

  if (match.externalId) {
    try {
      const { getProvider } = await import('../providers');
      const provider = getProvider(match.provider);
      await provider.stop(match.externalId);
    } catch (err) {
      console.warn(`[sandbox-provisioner] Failed to stop ${match.externalId}:`, err);
    }
  }

  console.log(`[sandbox-provisioner] Archived ${match.sandboxId} (sub=${subscriptionId})`);
}
